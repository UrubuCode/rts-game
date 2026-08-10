// Editor RTS — THUMBNAILS do Project: em vez de um ícone genérico por extensão,
// mostra o CONTEÚDO real do asset no tile.
//   • imagem        → a própria imagem, reamostrada pro tamanho do tile
//   • modelo        → render 3D da malha do arquivo (.obj/.glb/.gltf)
//   • prefab / cena → render 3D do que o descritor JSON vira: primitivo (ou o
//                     modelo referenciado) com a escala, rotação e cor do asset
//
// Tudo é rasterizado UMA vez por asset num buffer RGBA de 48×48 e depois
// blitado com render.image — igual ao framebuffer 3D do editor. O resultado fica
// em cache por path (gerar é caro; desenhar é só um blit).

import buffer from "../compat/buffer.ts";
import math from "../compat/math.ts";
import fs from "../compat/fs.ts";
import imgdec from "rts:imgdec";
import ptr from "rts:ptr";
import render from "../compat/render.ts";

import { parseObj, parseGltf, primitivePart, Part } from "../engine/render/model";

// resolução do thumbnail (quadrado). 48 casa com o ícone do tile e mantém o
// custo de rasterização baixo mesmo pra malhas de milhares de triângulos.
const TH_SIZE = 48;
const TH_NPIX = TH_SIZE * TH_SIZE;
// cinza de fundo do thumbnail (RGB 0x2A2A2A em byte-order RGBA, sem alpha)
const TH_BG = 42 + 42 * 256 + 42 * 65536;

// ── cache: path → buffer RGBA pronto (0 = ainda não gerado / falhou) ─────────
const thumbCache = new Map<string, i64>();
// paths que JÁ tentamos e falharam — evita re-tentar todo frame.
const thumbFailed = new Map<string, number>();

/// Descarta os thumbnails (libera os buffers). Chamar ao trocar de projeto.
export function clearThumbs(): void {
  thumbCache.clear();
  thumbFailed.clear();
}

/// Desenha o thumbnail do asset em (x,y,s). Devolve 1 se desenhou algo real,
/// 0 se não há preview (o chamador então desenha o ícone genérico).
/// Gera sob demanda no primeiro frame em que o tile aparece.
export function drawThumb(win: i64, path: string, kind: number, x: number, y: number, s: number): number {
  const buf = getThumb(win, path, kind);
  if (buf === 0) return 0;
  render.image(win, x, y, s, s, buffer.ptr(buf), TH_SIZE, TH_SIZE);
  return 1;
}

// KIND_* espelham os tipos do asset browser que têm preview.
export const TH_SCENE = 1;
export const TH_PREFAB = 2;
export const TH_IMAGE = 3;
export const TH_MODEL = 6;

/// INSPEÇÃO do thumbnail pela porta de controle (comando ws `thumb`) — a IA
/// valida o preview sem screenshot: gera o thumb e devolve estatísticas dos
/// pixels + um preview ASCII. `kind` = TH_IMAGE/TH_MODEL.
/// Formato: "<ok> <coloridos> <fundo> <cores distintas>\n<ascii>"
export function thumbReport(win: i64, path: string, kind: number, cols: number): string {
  const buf = getThumb(win, path, kind);
  if (buf === 0) return "0 0 0 0\n(sem preview)";
  const BG = TH_BG;
  let lit = 0;      // pixels != fundo (o modelo/imagem de fato desenhou)
  let bg = 0;
  // assinatura barata de "quantas cores distintas": conta trocas na varredura
  let distinct = 0;
  let prev = 0 - 1;
  let i = 0;
  while (i < TH_NPIX) {
    const c = buffer.read_i32(buf, i * 4);
    if (c === BG) bg = bg + 1; else lit = lit + 1;
    if (c !== prev) { distinct = distinct + 1; prev = c; }
    i = i + 1;
  }
  // preview ASCII por LUMINÂNCIA (mesmo alfabeto do harness: " .:-=+*#%@")
  let art = "";
  const step = TH_SIZE / cols;
  let ry = 0;
  while (ry < cols) {
    let rx = 0;
    while (rx < cols) {
      const sx = (rx * step) | 0;
      const sy = (ry * step) | 0;
      // Lê os canais BYTE A BYTE: read_i32 é SIGNED, então um pixel branco
      // (0xFFFFFFFF) volta como -1 e desmontar por divisão daria lixo.
      const o = (sy * TH_SIZE + sx) * 4;
      const r = buffer.read_u8(buf, o);
      const g = buffer.read_u8(buf, o + 1);
      const b = buffer.read_u8(buf, o + 2);
      const lum = (r * 30 + g * 59 + b * 11) / 100;
      art = art + lumChar(lum);
      rx = rx + 1;
    }
    art = art + "|";   // separador de linha do ASCII (ver thumbReport)
    ry = ry + 1;
  }
  return lit + " " + bg + " " + distinct + "\n" + art;   // \n separa cabeçalho do ASCII
}
function lumChar(l: f64): string {
  if (l < 26.0) return " ";
  if (l < 51.0) return ".";
  if (l < 77.0) return ":";
  if (l < 102.0) return "-";
  if (l < 128.0) return "=";
  if (l < 153.0) return "+";
  if (l < 179.0) return "*";
  if (l < 204.0) return "#";
  if (l < 230.0) return "%";
  return "@";
}

// Devolve (gerando se preciso) o buffer do thumbnail; 0 = sem preview.
function getThumb(win: i64, path: string, kind: number): i64 {
  const hit = thumbCache.get(path);
  if (hit !== undefined) return hit;
  if (thumbFailed.get(path) !== undefined) return 0;

  let buf: i64 = 0;
  if (kind === TH_IMAGE) buf = renderImageThumb(path);
  else if (kind === TH_MODEL) buf = renderModelThumb(path);
  else if (kind === TH_PREFAB) buf = renderPrefabThumb(path, 0);
  else if (kind === TH_SCENE) buf = renderPrefabThumb(path, 1);

  if (buf === 0) { thumbFailed.set(path, 1); return 0; }
  thumbCache.set(path, buf);
  return buf;
}

// ── thumbnail de IMAGEM: decodifica e reamostra (nearest) pro quadrado ──────
function renderImageThumb(path: string): i64 {
  if (!fs.exists(path)) return 0;
  const sz = fs.size(path) | 0;
  if (sz <= 0) return 0;
  const raw = buffer.alloc(sz);
  const n = fs.read_all(path, buffer.ptr(raw), sz) | 0;
  const dec = imgdec.decode(buffer.ptr(raw), n);
  buffer.free(raw);
  if (dec === 0) return 0;
  const sw = imgdec.width(dec) | 0;
  const sh = imgdec.height(dec) | 0;
  if (sw <= 0 || sh <= 0) return 0;
  const src = imgdec.pixelsPtr(dec);

  const out = buffer.alloc(TH_NPIX * 4);
  // "cover": recorta o lado maior pra imagem não distorcer no quadrado
  let side = sw;
  if (sh < side) side = sh;
  const ox = (sw - side) / 2;
  const oy = (sh - side) / 2;
  let py = 0;
  while (py < TH_SIZE) {
    const syp = oy + (py * side) / TH_SIZE;
    let px = 0;
    while (px < TH_SIZE) {
      const sxp = ox + (px * side) / TH_SIZE;
      // `src` é um PONTEIRO cru (imgdec.pixelsPtr), não um handle de buffer —
      // então lê com ptr.read_i32(endereço), não com buffer.read_i32(handle,off).
      const c = ptr.read_i32(src + ((syp | 0) * sw + (sxp | 0)) * 4);
      buffer.write_i32(out, (py * TH_SIZE + px) * 4, c);
      px = px + 1;
    }
    py = py + 1;
  }
  return out;
}

// ── thumbnail de MODELO: rasteriza a malha em software (z-buffer + luz) ─────
// Não dá pra usar o pipeline de GPU aqui: ele desenha na viewport 3D, não num
// buffer solto. Como é 48×48 e roda UMA vez por asset, um rasterizador simples
// resolve — e ainda funciona sem a malha estar na VRAM.
function renderModelThumb(path: string): i64 {
  return renderParts(loadParts(path));
}

/// Rasteriza um conjunto de partes num thumbnail (enquadra pela bounding box).
/// Compartilhado por MODELO (arquivo .obj/.glb) e PREFAB (primitivo do JSON).
function renderParts(parts: Part[]): i64 {
  if (parts.length === 0) return 0;

  // 1) bounding box de TODAS as partes, pra enquadrar o modelo no quadro
  let mnx: f64 = 1e30; let mny: f64 = 1e30; let mnz: f64 = 1e30;
  let mxx: f64 = 0.0 - 1e30; let mxy: f64 = 0.0 - 1e30; let mxz: f64 = 0.0 - 1e30;
  let pi = 0;
  while (pi < parts.length) {
    const v = parts[pi].verts;
    let i = 0;
    while (i + 2 < v.length) {
      if (v[i] < mnx) mnx = v[i];
      if (v[i] > mxx) mxx = v[i];
      if (v[i + 1] < mny) mny = v[i + 1];
      if (v[i + 1] > mxy) mxy = v[i + 1];
      if (v[i + 2] < mnz) mnz = v[i + 2];
      if (v[i + 2] > mxz) mxz = v[i + 2];
      i = i + 8;
    }
    pi = pi + 1;
  }
  if (mnx > mxx) return 0;
  const cx = (mnx + mxx) * 0.5;
  const cy = (mny + mxy) * 0.5;
  const cz = (mnz + mxz) * 0.5;
  let ext = mxx - mnx;
  if (mxy - mny > ext) ext = mxy - mny;
  if (mxz - mnz > ext) ext = mxz - mnz;
  if (ext < 0.000001) ext = 1.0;
  const scl = (TH_SIZE * 0.62) / ext;   // deixa uma margem no quadro

  const out = buffer.alloc(TH_NPIX * 4);
  const zbuf = buffer.alloc(TH_NPIX * 8);
  // fundo: o mesmo cinza do tile, pro thumbnail não "flutuar"
  let bi = 0;
  while (bi < TH_NPIX) {
    putPixel(out, bi * 4, TH_BG);
    buffer.write_f64(zbuf, bi * 8, 1e30);
    bi = bi + 1;
  }

  // vista 3/4 (yaw 35°, pitch 25°) — a pose clássica de preview de asset
  const yaw: f64 = 0.6;
  const pit: f64 = 0.44;
  const cyw = math.cos(yaw); const syw = math.sin(yaw);
  const cpt = math.cos(pit); const spt = math.sin(pit);

  pi = 0;
  while (pi < parts.length) {
    const p = parts[pi];
    rasterPart(p, out, zbuf, cx, cy, cz, scl, cyw, syw, cpt, spt);
    pi = pi + 1;
  }
  buffer.free(zbuf);
  return out;
}

// ── thumbnail de PREFAB / CENA: monta a geometria descrita no JSON ──────────
// Um prefab é um descritor ({mesh, color, scale/scale3, rot}); uma cena é uma
// lista deles. Aqui o preview é montado a partir do descritor — primitivo pela
// forma (mesh 1..4) ou o modelo do meshPath — aplicando escala, rotação e cor,
// pra o tile mostrar o que o asset realmente vira na cena.
function renderPrefabThumb(path: string, isScene: number): i64 {
  if (!fs.exists(path)) return 0;
  const txt = fs.read_text(path);
  if (txt.length === 0) return 0;
  const data = JSON.parse(txt);
  const parts: Part[] = [];
  if (isScene !== 0) {
    const arr = data.objects;
    if (arr === undefined) return 0;
    let i = 0;
    while (i < arr.length) { appendObjParts(arr[i], parts); i = i + 1; }
  } else {
    appendObjParts(data, parts);
  }
  return renderParts(parts);
}

// Converte UM descritor de objeto em partes posicionadas no espaço do preview.
function appendObjParts(od: any, out: Part[]): void {
  if (od === undefined) return;
  // objeto vazio (nó de grupo) não desenha
  let kind = 0;
  if (od.mesh !== undefined) kind = od.mesh | 0;
  let src: Part[] = [];
  if (od.meshPath !== undefined && od.meshPath.length > 0 && fs.exists(od.meshPath)) {
    src = loadParts(od.meshPath);           // prefab que referencia um .obj/.glb
  } else if (kind !== 0) {
    const one: Part[] = [primitivePart(kind)];
    src = one;
  }
  if (src.length === 0) return;

  // transform do descritor: escala (scale3 ou scale) + rotação Y + posição
  let sx: f64 = 1.0; let sy: f64 = 1.0; let sz: f64 = 1.0;
  if (od.scale3 !== undefined) { const s3 = od.scale3; sx = s3[0]; sy = s3[1]; sz = s3[2]; }
  else if (od.scale !== undefined) { sx = od.scale; sy = sx; sz = sx; }
  let px: f64 = 0.0; let py: f64 = 0.0; let pz: f64 = 0.0;
  if (od.pos !== undefined) { const p3 = od.pos; px = p3[0]; py = p3[1]; pz = p3[2]; }
  let ry: f64 = 0.0;
  if (od.rot !== undefined && od.rot.length > 1) ry = od.rot[1];
  const cry = math.cos(ry); const sry = math.sin(ry);

  // cor do descritor (o preview mostra a cor real do prefab)
  let cr = 200; let cg = 200; let cb = 210;
  if (od.color !== undefined && od.color.length >= 3) { cr = od.color[0] | 0; cg = od.color[1] | 0; cb = od.color[2] | 0; }

  let i = 0;
  while (i < src.length) {
    const s = src[i];
    const d = new Part(s.name, "");
    d.cr = cr; d.cg = cg; d.cb = cb;
    d.texPath = s.texPath;
    let k = 0;
    while (k + 7 < s.verts.length) {
      // escala → rotação Y → translação (o mesmo encadeamento do transform)
      const ex = s.verts[k] * sx; const ey = s.verts[k + 1] * sy; const ez = s.verts[k + 2] * sz;
      d.verts.push(px + ex * cry + ez * sry);
      d.verts.push(py + ey);
      d.verts.push(pz + ez * cry - ex * sry);
      // a normal só gira (escala não-uniforme distorceria, mas pra um preview basta)
      const nx = s.verts[k + 3]; const ny = s.verts[k + 4]; const nz = s.verts[k + 5];
      d.verts.push(nx * cry + nz * sry);
      d.verts.push(ny);
      d.verts.push(nz * cry - nx * sry);
      d.verts.push(s.verts[k + 6]); d.verts.push(s.verts[k + 7]);
      d.inds.push(d.vi); d.vi = d.vi + 1;
      k = k + 8;
    }
    if (d.verts.length > 0) out.push(d);
    i = i + 1;
  }
}

// carrega as partes de um modelo SEM subir pra VRAM (o thumbnail é software).
function loadParts(path: string): Part[] {
  const empty: Part[] = [];
  if (!fs.exists(path)) return empty;
  const n = path.length;
  if (n > 4 && path.charCodeAt(n - 4) === 46 &&
      (path.charCodeAt(n - 3) === 111 || path.charCodeAt(n - 3) === 79)) return parseObj(path);   // .obj
  return parseGltf(path);   // .glb / .gltf
}

// Projeta e rasteriza os triângulos de uma parte no buffer do thumbnail.
function rasterPart(p: Part, out: i64, zbuf: i64, cx: f64, cy: f64, cz: f64, scl: f64,
                    cyw: f64, syw: f64, cpt: f64, spt: f64): void {
  const v = p.verts;
  const idx = p.inds;
  let t = 0;
  while (t + 2 < idx.length) {
    const a = idx[t] * 8; const b = idx[t + 1] * 8; const c = idx[t + 2] * 8;
    if (a + 7 < v.length && b + 7 < v.length && c + 7 < v.length) {
      // projeção ORTOGRÁFICA (preview não precisa de perspectiva) após yaw+pitch
      const ax = proj_x(v[a] - cx, v[a + 2] - cz, cyw, syw) * scl + TH_SIZE * 0.5;
      const ay = proj_y(v[a] - cx, v[a + 1] - cy, v[a + 2] - cz, cyw, syw, cpt, spt) * (0.0 - scl) + TH_SIZE * 0.5;
      const az = proj_z(v[a] - cx, v[a + 1] - cy, v[a + 2] - cz, cyw, syw, cpt, spt);
      const bx = proj_x(v[b] - cx, v[b + 2] - cz, cyw, syw) * scl + TH_SIZE * 0.5;
      const by = proj_y(v[b] - cx, v[b + 1] - cy, v[b + 2] - cz, cyw, syw, cpt, spt) * (0.0 - scl) + TH_SIZE * 0.5;
      const bz = proj_z(v[b] - cx, v[b + 1] - cy, v[b + 2] - cz, cyw, syw, cpt, spt);
      const gx = proj_x(v[c] - cx, v[c + 2] - cz, cyw, syw) * scl + TH_SIZE * 0.5;
      const gy = proj_y(v[c] - cx, v[c + 1] - cy, v[c + 2] - cz, cyw, syw, cpt, spt) * (0.0 - scl) + TH_SIZE * 0.5;
      const gz = proj_z(v[c] - cx, v[c + 1] - cy, v[c + 2] - cz, cyw, syw, cpt, spt);
      // luz difusa simples pela normal do vértice A (chapado por triângulo — é 48px)
      const lam = shade(v[a + 3], v[a + 4], v[a + 5]);
      const col = mixColor(p.cr, p.cg, p.cb, lam);
      thumbTri(out, zbuf, ax, ay, az, bx, by, bz, gx, gy, gz, col);
    }
    t = t + 3;
  }
}

// yaw no plano XZ → x de tela
function proj_x(dx: f64, dz: f64, cyw: f64, syw: f64): f64 {
  return dx * cyw - dz * syw;
}
// yaw + pitch → y de tela
function proj_y(dx: f64, dy: f64, dz: f64, cyw: f64, syw: f64, cpt: f64, spt: f64): f64 {
  const z1 = dx * syw + dz * cyw;
  return dy * cpt - z1 * spt;
}
// profundidade (pro z-buffer)
function proj_z(dx: f64, dy: f64, dz: f64, cyw: f64, syw: f64, cpt: f64, spt: f64): f64 {
  const z1 = dx * syw + dz * cyw;
  return dy * spt + z1 * cpt;
}

// luz direcional fixa vinda de cima/frente + ambiente (0.35..1.0)
function shade(nx: f64, ny: f64, nz: f64): f64 {
  const lx: f64 = 0.4; const ly: f64 = 0.78; const lz: f64 = 0.0 - 0.48;
  let d = nx * lx + ny * ly + nz * lz;
  if (d < 0.0) d = 0.0 - d * 0.35;   // back-lighting suave (não deixa preto chapado)
  return 0.35 + d * 0.65;
}
// Cor RGB (0..255) modulada pela luz, empacotada em BYTE-ORDER RGBA com R no
// byte 0 — o mesmo layout do imgdec e do render.image. O alpha fica de fora
// (255 no byte 3 estouraria o i32 signed); quem escreve o pixel põe o alpha.
function mixColor(r: number, g: number, b: number, k: f64): number {
  let rr = (r * k) | 0; let gg = (g * k) | 0; let bb = (b * k) | 0;
  if (rr > 255) rr = 255; if (gg > 255) gg = 255; if (bb > 255) bb = 255;
  if (rr < 0) rr = 0; if (gg < 0) gg = 0; if (bb < 0) bb = 0;
  return rr + (gg * 256) + (bb * 65536);
}
// Escreve um pixel RGBA opaco no offset de byte `o`.
function putPixel(out: i64, o: number, col: number): void {
  buffer.write_u8(out, o, col % 256);
  buffer.write_u8(out, o + 1, ((col / 256) | 0) % 256);
  buffer.write_u8(out, o + 2, ((col / 65536) | 0) % 256);
  buffer.write_u8(out, o + 3, 255);
}

// Rasteriza um triângulo com z-buffer (bounding box + baricêntricas).
function thumbTri(out: i64, zbuf: i64, ax: f64, ay: f64, az: f64,
                 bx: f64, by: f64, bz: f64, cx2: f64, cy2: f64, cz2: f64, col: number): void {
  let x0 = ax; if (bx < x0) x0 = bx; if (cx2 < x0) x0 = cx2;
  let x1 = ax; if (bx > x1) x1 = bx; if (cx2 > x1) x1 = cx2;
  let y0 = ay; if (by < y0) y0 = by; if (cy2 < y0) y0 = cy2;
  let y1 = ay; if (by > y1) y1 = by; if (cy2 > y1) y1 = cy2;
  let ix0 = x0 | 0; let ix1 = (x1 | 0) + 1;
  let iy0 = y0 | 0; let iy1 = (y1 | 0) + 1;
  if (ix0 < 0) ix0 = 0; if (iy0 < 0) iy0 = 0;
  if (ix1 > TH_SIZE) ix1 = TH_SIZE; if (iy1 > TH_SIZE) iy1 = TH_SIZE;
  const area = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
  if (area > 0.0 - 0.0001 && area < 0.0001) return;   // degenerado
  let py = iy0;
  while (py < iy1) {
    let px = ix0;
    while (px < ix1) {
      const fx = px + 0.5; const fy = py + 0.5;
      const w0 = ((bx - ax) * (fy - ay) - (by - ay) * (fx - ax)) / area;
      const w1 = ((fx - ax) * (cy2 - ay) - (fy - ay) * (cx2 - ax)) / area;
      const w2 = 1.0 - w0 - w1;
      if (w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0) {
        // w1 pesa C, w0 pesa B, w2 pesa A (ordem das baricêntricas acima)
        const z = az * w2 + bz * w0 + cz2 * w1;
        const o = (py * TH_SIZE + px);
        if (z < buffer.read_f64(zbuf, o * 8)) {
          buffer.write_f64(zbuf, o * 8, z);
          putPixel(out, o * 4, col);
        }
      }
      px = px + 1;
    }
    py = py + 1;
  }
}
