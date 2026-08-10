// Editor RTS — THUMBNAILS do Project: em vez de um ícone genérico por extensão,
// mostra o CONTEÚDO real do asset no tile.
//   • imagem        → AUSENTE no motor novo (ver renderImageThumb)
//   • modelo        → render 3D da malha do arquivo (.obj/.glb/.gltf)
//   • prefab / cena → render 3D do que o descritor JSON vira: primitivo (ou o
//                     modelo referenciado) com a escala, rotação e cor do asset
//
// Tudo é rasterizado UMA vez por asset num buffer RGBA de 48×48 e depois
// blitado com render.image. O resultado fica em cache por path (gerar é caro;
// desenhar é só um blit).
//
// ── PORTE PRO MOTOR NOVO ────────────────────────────────────────────────────
//
// O rasterizador em si não mudou uma linha de matemática: projeção ortográfica,
// z-buffer, luz difusa e baricêntricas são código de jogo e não conhecem motor.
// O que mudou é onde os pixels moram.
//
//  · Os "handles" de `rts:buffer` viraram VIEWS TIPADAS. `compat/buffer.ts`
//    explica por que `ptr()` não existe — um endereço envelhece porque o coletor
//    move células — e aqui a consequência é boa: `out` já É o `Uint8Array` que o
//    `drawImage` novo quer receber, então o blit deixou de precisar de tradução.
//  · O z-buffer é `Float64Array` e o framebuffer é `Uint8Array`, DIRETOS, sem
//    passar pelo `compat/buffer.ts`. Aquele shim é `Uint8Array` + `DataView` com
//    uma busca em `Map` por acesso, e o z-buffer é lido e escrito uma vez POR
//    PIXEL POR TRIÂNGULO — é o laço mais quente do arquivo, e a busca seria o
//    preço de uma generalidade que este uso não tem (offset sempre alinhado,
//    sempre f64). `putPixel` só escreve bytes, então nem `DataView` precisa.
//    Com isso o `compat/buffer.ts` saiu inteiro dos imports deste arquivo.
//  · `rts:imgdec` NÃO EXISTE no motor novo, e `rts:ptr` foi eliminado por
//    decisão. Os dois só apareciam na miniatura de IMAGEM; ver renderImageThumb.
//
// "Sem thumbnail" deixou de ser `0` e passou a ser `null`: o buffer virou um
// objeto, e `0` era o valor-sentinela de um handle numérico que não existe mais.

import math from "../compat/math.ts";
import fs from "../compat/fs.ts";
import render from "../compat/render.ts";

import { parseObj, parseGltf, primitivePart, Part } from "../engine/render/model";

// resolução do thumbnail (quadrado). 48 casa com o ícone do tile e mantém o
// custo de rasterização baixo mesmo pra malhas de milhares de triângulos.
const TH_SIZE = 48;
const TH_NPIX = TH_SIZE * TH_SIZE;
// cinza de fundo do thumbnail (RGB 0x2A2A2A empacotado com R no byte 0, SEM
// alpha — quem escreve o pixel põe o alpha; ver putPixel e mixColor)
const TH_BG = 42 + 42 * 256 + 42 * 65536;

// ── cache: path → framebuffer RGBA pronto (null = sem preview) ──────────────
const thumbCache = new Map<string, Uint8Array>();
// paths que JÁ tentamos e falharam — evita re-tentar todo frame.
const thumbFailed = new Map<string, number>();

/// Descarta os thumbnails. Chamar ao trocar de projeto.
///
/// Não "libera" mais nada: os framebuffers são células do heap gerenciado, e
/// esvaziar o cache é exatamente o que os torna coletáveis.
export function clearThumbs(): void {
  thumbCache.clear();
  thumbFailed.clear();
}

/// Desenha o thumbnail do asset em (x,y,s). Devolve 1 se desenhou algo real,
/// 0 se não há preview (o chamador então desenha o ícone genérico).
/// Gera sob demanda no primeiro frame em que o tile aparece.
export function drawThumb(win: number, path: string, kind: number, x: number, y: number, s: number): number {
  const buf = getThumb(win, path, kind);
  if (buf === null) return 0;
  // A view no lugar do endereço: era `buffer.ptr(buf)`, e é a única mudança
  // deste caminho — o `drawImage` do motor novo lê o comprimento da própria view.
  render.image(win, x, y, s, s, buf, TH_SIZE, TH_SIZE);
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
/// Formato: "<coloridos> <fundo> <cores distintas>\n<ascii>"
export function thumbReport(win: number, path: string, kind: number, cols: number): string {
  const buf = getThumb(win, path, kind);
  if (buf === null) return "0 0 0 0\n(sem preview)";
  const BG = TH_BG;
  let lit = 0;      // pixels != fundo (o modelo/imagem de fato desenhou)
  let bg = 0;
  // assinatura barata de "quantas cores distintas": conta trocas na varredura
  let distinct = 0;
  let prev = 0 - 1;
  let i = 0;
  while (i < TH_NPIX) {
    // Remonta o pixel dos TRÊS bytes de cor, ignorando o alpha, porque é assim
    // que TH_BG está escrito. O código antigo comparava com um `read_i32`, que
    // inclui o alpha 255 no byte alto e é SIGNED: um pixel de fundo voltava
    // 0xFF2A2A2A (negativo) e nunca batia com TH_BG, então `bg` era sempre 0 e
    // `lit` sempre 2304. O relatório mentia; a correção veio de graça com a
    // troca do shim por leitura de bytes.
    const o = i * 4;
    const c = buf[o] + buf[o + 1] * 256 + buf[o + 2] * 65536;
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
      const o = (sy * TH_SIZE + sx) * 4;
      const r = buf[o];
      const g = buf[o + 1];
      const b = buf[o + 2];
      const lum = (r * 30 + g * 59 + b * 11) / 100;
      art = art + lumChar(lum);
      rx = rx + 1;
    }
    art = art + "|";   // separador de linha do ASCII (ver thumbReport)
    ry = ry + 1;
  }
  return lit + " " + bg + " " + distinct + "\n" + art;   // \n separa cabeçalho do ASCII
}
function lumChar(l: number): string {
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

// Devolve (gerando se preciso) o framebuffer do thumbnail; null = sem preview.
function getThumb(win: number, path: string, kind: number): Uint8Array | null {
  const hit = thumbCache.get(path);
  if (hit !== undefined) return hit;
  if (thumbFailed.get(path) !== undefined) return null;

  let buf: Uint8Array | null = null;
  if (kind === TH_IMAGE) buf = renderImageThumb(path);
  else if (kind === TH_MODEL) buf = renderModelThumb(path);
  else if (kind === TH_PREFAB) buf = renderPrefabThumb(path, 0);
  else if (kind === TH_SCENE) buf = renderPrefabThumb(path, 1);

  if (buf === null) { thumbFailed.set(path, 1); return null; }
  thumbCache.set(path, buf);
  return buf;
}

// ── thumbnail de IMAGEM: AUSENTE no motor novo ──────────────────────────────
//
// Decodificava o arquivo com `rts:imgdec` e reamostrava (nearest, recorte
// "cover") lendo os pixels com `ptr.read_i32` sobre o endereço de
// `imgdec.pixelsPtr`. Nenhum dos dois namespaces existe: `rts:ptr` foi eliminado
// por decisão do motor, e `rts:imgdec` nunca foi portado — não há dependência
// `image`/`png`/`jpeg` em nenhum crate do workspace.
//
// A perda é só esta linha do editor: um arquivo de imagem mostra o ícone
// genérico da extensão em vez do próprio conteúdo. É o asset cujo ícone genérico
// menos engana, e `drawThumb` já trata "sem preview" como caminho normal — é
// por isso que aqui devolve `null` em silêncio em vez de lançar, ao contrário do
// `loadTexture` do `gpu3d.ts`: lá a textura ausente vira um objeto errado na
// cena e ninguém liga a causa ao efeito; aqui o resultado visível É o fallback
// que o chamador já desenha de propósito.
//
// Escrever um decodificador de PNG aqui foi considerado e recusado: `node:zlib`
// existe (sobre `flate2`), então inflate + desfiltragem seria possível — e seria
// um decodificador de imagem dentro de um gerador de miniaturas, cobrindo um
// formato só. Se `imgdec` voltar, esta função inteira volta com ele.
function renderImageThumb(path: string): Uint8Array | null {
  return null;
}

// ── thumbnail de MODELO: rasteriza a malha em software (z-buffer + luz) ─────
// Não dá pra usar o pipeline de GPU aqui: ele desenha na viewport 3D, não num
// buffer solto. Como é 48×48 e roda UMA vez por asset, um rasterizador simples
// resolve — e ainda funciona sem a malha estar na VRAM.
function renderModelThumb(path: string): Uint8Array | null {
  return renderParts(loadParts(path));
}

/// Rasteriza um conjunto de partes num thumbnail (enquadra pela bounding box).
/// Compartilhado por MODELO (arquivo .obj/.glb) e PREFAB (primitivo do JSON).
function renderParts(parts: Part[]): Uint8Array | null {
  if (parts.length === 0) return null;

  // 1) bounding box de TODAS as partes, pra enquadrar o modelo no quadro
  let mnx: number = 1e30; let mny: number = 1e30; let mnz: number = 1e30;
  let mxx: number = 0.0 - 1e30; let mxy: number = 0.0 - 1e30; let mxz: number = 0.0 - 1e30;
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
  if (mnx > mxx) return null;
  const cx = (mnx + mxx) * 0.5;
  const cy = (mny + mxy) * 0.5;
  const cz = (mnz + mxz) * 0.5;
  let ext = mxx - mnx;
  if (mxy - mny > ext) ext = mxy - mny;
  if (mxz - mnz > ext) ext = mxz - mnz;
  if (ext < 0.000001) ext = 1.0;
  const scl = (TH_SIZE * 0.62) / ext;   // deixa uma margem no quadro

  const out = new Uint8Array(TH_NPIX * 4);
  const zbuf = new Float64Array(TH_NPIX);
  // fundo: o mesmo cinza do tile, pro thumbnail não "flutuar"
  let bi = 0;
  while (bi < TH_NPIX) {
    putPixel(out, bi * 4, TH_BG);
    zbuf[bi] = 1e30;
    bi = bi + 1;
  }

  // vista 3/4 (yaw 35°, pitch 25°) — a pose clássica de preview de asset
  const yaw: number = 0.6;
  const pit: number = 0.44;
  const cyw = math.cos(yaw); const syw = math.sin(yaw);
  const cpt = math.cos(pit); const spt = math.sin(pit);

  pi = 0;
  while (pi < parts.length) {
    const p = parts[pi];
    rasterPart(p, out, zbuf, cx, cy, cz, scl, cyw, syw, cpt, spt);
    pi = pi + 1;
  }
  return out;
}

// ── thumbnail de PREFAB / CENA: monta a geometria descrita no JSON ──────────
// Um prefab é um descritor ({mesh, color, scale/scale3, rot}); uma cena é uma
// lista deles. Aqui o preview é montado a partir do descritor — primitivo pela
// forma (mesh 1..4) ou o modelo do meshPath — aplicando escala, rotação e cor,
// pra o tile mostrar o que o asset realmente vira na cena.
function renderPrefabThumb(path: string, isScene: number): Uint8Array | null {
  if (!fs.exists(path)) return null;
  const txt = fs.read_text(path);
  if (txt.length === 0) return null;
  const data = JSON.parse(txt);
  const parts: Part[] = [];
  if (isScene !== 0) {
    const arr = data.objects;
    if (arr === undefined) return null;
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
  let sx: number = 1.0; let sy: number = 1.0; let sz: number = 1.0;
  if (od.scale3 !== undefined) { const s3 = od.scale3; sx = s3[0]; sy = s3[1]; sz = s3[2]; }
  else if (od.scale !== undefined) { sx = od.scale; sy = sx; sz = sx; }
  let px: number = 0.0; let py: number = 0.0; let pz: number = 0.0;
  if (od.pos !== undefined) { const p3 = od.pos; px = p3[0]; py = p3[1]; pz = p3[2]; }
  let ry: number = 0.0;
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
function rasterPart(p: Part, out: Uint8Array, zbuf: Float64Array, cx: number, cy: number, cz: number, scl: number,
                    cyw: number, syw: number, cpt: number, spt: number): void {
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
function proj_x(dx: number, dz: number, cyw: number, syw: number): number {
  return dx * cyw - dz * syw;
}
// yaw + pitch → y de tela
function proj_y(dx: number, dy: number, dz: number, cyw: number, syw: number, cpt: number, spt: number): number {
  const z1 = dx * syw + dz * cyw;
  return dy * cpt - z1 * spt;
}
// profundidade (pro z-buffer)
function proj_z(dx: number, dy: number, dz: number, cyw: number, syw: number, cpt: number, spt: number): number {
  const z1 = dx * syw + dz * cyw;
  return dy * spt + z1 * cpt;
}

// luz direcional fixa vinda de cima/frente + ambiente (0.35..1.0)
function shade(nx: number, ny: number, nz: number): number {
  const lx: number = 0.4; const ly: number = 0.78; const lz: number = 0.0 - 0.48;
  let d = nx * lx + ny * ly + nz * lz;
  if (d < 0.0) d = 0.0 - d * 0.35;   // back-lighting suave (não deixa preto chapado)
  return 0.35 + d * 0.65;
}
// Cor RGB (0..255) modulada pela luz, empacotada com R no byte 0 — o mesmo
// layout que `render.image` (agora `drawImage`) lê. O alpha fica de fora; quem
// escreve o pixel põe o alpha.
function mixColor(r: number, g: number, b: number, k: number): number {
  let rr = (r * k) | 0; let gg = (g * k) | 0; let bb = (b * k) | 0;
  if (rr > 255) rr = 255; if (gg > 255) gg = 255; if (bb > 255) bb = 255;
  if (rr < 0) rr = 0; if (gg < 0) gg = 0; if (bb < 0) bb = 0;
  return rr + (gg * 256) + (bb * 65536);
}
// Escreve um pixel RGBA opaco no offset de byte `o`.
function putPixel(out: Uint8Array, o: number, col: number): void {
  out[o] = col % 256;
  out[o + 1] = ((col / 256) | 0) % 256;
  out[o + 2] = ((col / 65536) | 0) % 256;
  out[o + 3] = 255;
}

// Rasteriza um triângulo com z-buffer (bounding box + baricêntricas).
function thumbTri(out: Uint8Array, zbuf: Float64Array, ax: number, ay: number, az: number,
                 bx: number, by: number, bz: number, cx2: number, cy2: number, cz2: number, col: number): void {
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
        if (z < zbuf[o]) {
          zbuf[o] = z;
          putPixel(out, o * 4, col);
        }
      }
      px = px + 1;
    }
    py = py + 1;
  }
}
