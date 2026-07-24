// Engine RTS — LOADERS DE MODELO 3D (.obj/.mtl e .glb/.gltf).
//
// Todos produzem o mesmo resultado: um array de SUBMESHES, cada uma com um mesh
// id já na VRAM (layout de 8 f32/vértice — [x,y,z, nx,ny,nz, u,v], ver
// gpu3d.upload) + a aparência daquela parte (cor difusa e path de textura).
// Um formato multi-material vira N submeshes; o chamador (editor/dnd.ts) monta
// um GameObject por submesh, porque a cadeia de render é 1 objeto → 1 mesh →
// 1 material → 1 draw call.
//
// Cache POR PATH: carregar o mesmo modelo em 50 unidades = 1 parse + 1 upload.
// (o loadTexture do gpu3d.ts já fazia isso pras imagens; aqui é o análogo.)

import buffer from "rts:buffer";
import math from "rts:math";
import fs from "rts:fs";

import { upload } from "./gpu3d";

/// Uma parte do modelo: geometria na VRAM + a aparência que veio do arquivo.
export class SubMesh {
  meshId: number;      // id na VRAM (0 = inválida)
  name: string;        // nome do grupo/objeto/primitive (pra nomear o GameObject)
  cr: number; cg: number; cb: number;   // cor difusa 0..255 (do .mtl / glTF baseColor)
  texPath: string;     // textura difusa, "" = nenhuma (path no disco)
  constructor(meshId: number, name: string) {
    this.meshId = meshId;
    this.name = name;
    this.cr = 200; this.cg = 200; this.cb = 210;
    this.texPath = "";
  }
}

// ── cache de modelo por path ────────────────────────────────────────────────
// Um `const … = new Map()` de módulo é o padrão de singleton que o motor promove
// com class-tracking, então .get/.set despacham mesmo lidos de dentro de função.
const modelCache = new Map<string, SubMesh[]>();

/// Limpa o cache (só o mapa; os meshes seguem na VRAM). Útil ao trocar de projeto.
export function clearModelCache(): void { modelCache.clear(); }

// ── utilidades de texto ─────────────────────────────────────────────────────
// tira o \r final (arquivos CRLF) — sem isto o último token de cada linha vem
// com \r grudado e quebra o parse de `usemtl`/`mtllib`.
function stripCR(s: string): string {
  const n = s.length;
  if (n > 0 && s.charCodeAt(n - 1) === 13) return s.substring(0, n - 1);
  return s;
}
// divide por espaços DESCARTANDO vazios (tolera espaços múltiplos/indentação).
function tokens(line: string): string[] {
  const raw = line.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const t = raw[i];
    if (t.length > 0 && t.charCodeAt(0) !== 9) out.push(t);   // ignora vazio e TAB solto
    i = i + 1;
  }
  return out;
}
/// pasta de um path ("a/b/c.obj" -> "a/b"); "" se não houver.
export function dirOf(path: string): string {
  let cut = 0 - 1;
  let i = 0;
  while (i < path.length) { if (path.charCodeAt(i) === 47) cut = i; i = i + 1; }
  if (cut < 0) return "";
  return path.substring(0, cut);
}
// resolve um path RELATIVO ao arquivo que o referencia (.mtl, textura do .mtl).
function resolveRel(baseDir: string, rel: string): string {
  if (baseDir.length === 0) return rel;
  if (rel.length > 0 && rel.charCodeAt(0) === 47) return rel;   // já absoluto
  return baseDir + "/" + rel;
}

// ── .MTL: biblioteca de materiais que acompanha o .obj ──────────────────────
// Guarda, por nome de material, a cor difusa (Kd) e a textura difusa (map_Kd).
// Sem isto todo modelo importado renderiza cinza.
class MtlLib {
  names: string[];
  crs: number[]; cgs: number[]; cbs: number[];
  texs: string[];
  constructor() { this.names = []; this.crs = []; this.cgs = []; this.cbs = []; this.texs = []; }
  idx(name: string): number {
    let i = 0;
    while (i < this.names.length) { if (this.names[i] === name) return i; i = i + 1; }
    return 0 - 1;
  }
}

function parseMtl(path: string): MtlLib {
  const lib = new MtlLib();
  if (!fs.exists(path)) return lib;
  const baseDir = dirOf(path);
  const lines = fs.read_text(path).split("\n");
  let cur = 0 - 1;
  let li = 0;
  while (li < lines.length) {
    const tk = tokens(stripCR(lines[li]));
    if (tk.length >= 2) {
      const t = tk[0];
      if (t === "newmtl") {
        lib.names.push(tk[1]);
        lib.crs.push(200); lib.cgs.push(200); lib.cbs.push(210);
        lib.texs.push("");
        cur = lib.names.length - 1;
      } else if (cur >= 0 && t === "Kd" && tk.length >= 4) {
        // Kd vem em 0..1; a engine usa 0..255 por canal
        lib.crs[cur] = clamp255(parseFloat(tk[1]) * 255.0);
        lib.cgs[cur] = clamp255(parseFloat(tk[2]) * 255.0);
        lib.cbs[cur] = clamp255(parseFloat(tk[3]) * 255.0);
      } else if (cur >= 0 && t === "map_Kd") {
        // o path da textura é relativo ao .mtl; ignora as flags (-s, -o…) pegando
        // o ÚLTIMO token, que é o arquivo.
        lib.texs[cur] = resolveRel(baseDir, tk[tk.length - 1]);
      }
    }
    li = li + 1;
  }
  return lib;
}
function clamp255(v: f64): number {
  if (v < 0.0) return 0;
  if (v > 255.0) return 255;
  return v | 0;
}

// ── .OBJ ────────────────────────────────────────────────────────────────────
// Acumulador de uma submesh em construção (um grupo `o`/`g` ou um `usemtl`).
export class Part {
  verts: f64[];        // [x,y,z, nx,ny,nz, u,v] por vértice
  inds: number[];
  vi: number;          // próximo índice a emitir
  name: string;        // nome do grupo (`o`/`g`) ou grupo:material
  mtl: string;         // nome do material do .mtl (resolvido no fim do parse)
  cr: number; cg: number; cb: number;
  texPath: string;
  constructor(name: string, mtl: string) {
    this.verts = []; this.inds = []; this.vi = 0;
    this.name = name; this.mtl = mtl;
    this.cr = 200; this.cg = 200; this.cb = 210;
    this.texPath = "";
  }
  /// nº de triângulos (3 vértices cada, sem indexação compartilhada).
  triCount(): number { return this.inds.length / 3; }
}

/// Carrega um .obj (com o .mtl que ele referenciar) → submeshes na VRAM.
/// Suporta: quads e n-gons (TRIANGULAÇÃO EM FAN), índices NEGATIVOS (relativos
/// ao fim), `o`/`g` (vira uma submesh por grupo), `usemtl`/`mtllib` (cor +
/// textura), faces `v`, `v/vt`, `v//vn`, `v/vt/vn`, e arquivos CRLF.
/// Sem `vn` a NORMAL DA FACE é calculada (senão o shading fica chapado).
export function loadObjParts(win: i64, path: string): SubMesh[] {
  const parts = parseObj(path);
  const out: SubMesh[] = [];
  let pi = 0;
  while (pi < parts.length) {
    const p = parts[pi];
    if (p.verts.length > 0) {
      const id = upload(win, p.verts, p.inds);
      if (id > 0) {
        const sm = new SubMesh(id, p.name);
        sm.cr = p.cr; sm.cg = p.cg; sm.cb = p.cb;
        sm.texPath = p.texPath;
        out.push(sm);
      }
    }
    pi = pi + 1;
  }
  return out;
}

/// PARSE puro do .obj (sem tocar na GPU) — devolve as partes com os arrays de
/// vértice/índice já montados. Separado do upload pra ser testável no harness
/// headless (contagem de triângulos, normais geradas, materiais do .mtl).
export function parseObj(path: string): Part[] {
  const empty: Part[] = [];
  if (!fs.exists(path)) return empty;

  const baseDir = dirOf(path);
  const lines = fs.read_text(path).split("\n");

  // pools de atributos do arquivo (índices do .obj são GLOBAIS, 1-based)
  const pxs: f64[] = []; const pys: f64[] = []; const pzs: f64[] = [];
  const nxs: f64[] = []; const nys: f64[] = []; const nzs: f64[] = [];
  const txs: f64[] = []; const tys: f64[] = [];

  let lib = new MtlLib();
  const parts: Part[] = [];
  let cur = new Part("mesh", "");
  parts.push(cur);

  let li = 0;
  while (li < lines.length) {
    const tk = tokens(stripCR(lines[li]));
    if (tk.length > 0) {
      const t = tk[0];
      if (t === "v" && tk.length >= 4) {
        pxs.push(parseFloat(tk[1])); pys.push(parseFloat(tk[2])); pzs.push(parseFloat(tk[3]));
      } else if (t === "vn" && tk.length >= 4) {
        nxs.push(parseFloat(tk[1])); nys.push(parseFloat(tk[2])); nzs.push(parseFloat(tk[3]));
      } else if (t === "vt" && tk.length >= 3) {
        txs.push(parseFloat(tk[1])); tys.push(parseFloat(tk[2]));
      } else if (t === "mtllib" && tk.length >= 2) {
        lib = parseMtl(resolveRel(baseDir, tk[1]));
      } else if ((t === "o" || t === "g") && tk.length >= 2) {
        // novo grupo → nova submesh (a anterior fica; vazias são descartadas no fim)
        cur = new Part(tk[1], cur.mtl);
        parts.push(cur);
      } else if (t === "usemtl" && tk.length >= 2) {
        // troca de material DENTRO do mesmo objeto também quebra a submesh,
        // porque 1 submesh = 1 material (limite de 1 draw call por objeto).
        if (cur.verts.length === 0) cur.mtl = tk[1];
        else { cur = new Part(cur.name + ":" + tk[1], tk[1]); parts.push(cur); }
      } else if (t === "f" && tk.length >= 4) {
        emitFace(tk, pxs, pys, pzs, nxs, nys, nzs, txs, tys, cur);
      }
    }
    li = li + 1;
  }

  // resolve o material de cada parte (cor/textura do .mtl) e descarta as vazias
  const out: Part[] = [];
  let pi = 0;
  while (pi < parts.length) {
    const p = parts[pi];
    if (p.verts.length > 0) {
      const mi = lib.idx(p.mtl);
      if (mi >= 0) {
        p.cr = lib.crs[mi]; p.cg = lib.cgs[mi]; p.cb = lib.cbs[mi];
        p.texPath = lib.texs[mi];
      }
      out.push(p);
    }
    pi = pi + 1;
  }
  return out;
}

// Emite uma face do .obj na parte `p`, TRIANGULANDO EM FAN: uma face de N
// corners vira N-2 triângulos (0,1,2), (0,2,3), (0,3,4)… — correto para faces
// convexas, que é o caso de quase todo exportador.
function emitFace(tk: string[], pxs: f64[], pys: f64[], pzs: f64[],
                  nxs: f64[], nys: f64[], nzs: f64[], txs: f64[], tys: f64[], p: Part): void {
  const n = tk.length - 1;
  if (n < 3) return;
  // resolve os índices de cada corner uma vez
  const vI: number[] = []; const nI: number[] = []; const tI: number[] = [];
  let c = 1;
  while (c < tk.length) {
    const seg = tk[c].split("/");
    vI.push(refIdx(seg[0], pxs.length));
    if (seg.length >= 2 && seg[1].length > 0) tI.push(refIdx(seg[1], txs.length)); else tI.push(0 - 1);
    if (seg.length >= 3 && seg[2].length > 0) nI.push(refIdx(seg[2], nxs.length)); else nI.push(0 - 1);
    c = c + 1;
  }
  let k = 1;
  while (k + 1 < n) {
    emitTri(vI[0], tI[0], nI[0], vI[k], tI[k], nI[k], vI[k + 1], tI[k + 1], nI[k + 1],
            pxs, pys, pzs, nxs, nys, nzs, txs, tys, p);
    k = k + 1;
  }
}

// Índice de referência do .obj → índice 0-based. POSITIVO é 1-based; NEGATIVO é
// relativo ao fim da lista (-1 = último), como manda o formato.
function refIdx(s: string, count: number): number {
  const v = parseFloat(s) | 0;
  if (v > 0) return v - 1;
  if (v < 0) return count + v;
  return 0 - 1;
}

function emitTri(a: number, at: number, an: number, b: number, bt: number, bn: number,
                 cc: number, ct: number, cn: number,
                 pxs: f64[], pys: f64[], pzs: f64[], nxs: f64[], nys: f64[], nzs: f64[],
                 txs: f64[], tys: f64[], p: Part): void {
  // índice de posição inválido = face corrompida; descarta (não gera NaN no VBO)
  if (a < 0 || b < 0 || cc < 0 || a >= pxs.length || b >= pxs.length || cc >= pxs.length) return;
  // normal da FACE (usada quando o corner não traz vn): (b-a) × (c-a) normalizado
  const ux = pxs[b] - pxs[a]; const uy = pys[b] - pys[a]; const uz = pzs[b] - pzs[a];
  const vx = pxs[cc] - pxs[a]; const vy = pys[cc] - pys[a]; const vz = pzs[cc] - pzs[a];
  let fnx = uy * vz - uz * vy;
  let fny = uz * vx - ux * vz;
  let fnz = ux * vy - uy * vx;
  const fl = math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
  if (fl > 0.000001) { fnx = fnx / fl; fny = fny / fl; fnz = fnz / fl; }
  else { fnx = 0.0; fny = 1.0; fnz = 0.0; }   // face degenerada
  pushCorner(a, at, an, fnx, fny, fnz, pxs, pys, pzs, nxs, nys, nzs, txs, tys, p);
  pushCorner(b, bt, bn, fnx, fny, fnz, pxs, pys, pzs, nxs, nys, nzs, txs, tys, p);
  pushCorner(cc, ct, cn, fnx, fny, fnz, pxs, pys, pzs, nxs, nys, nzs, txs, tys, p);
}

function pushCorner(vi: number, ti: number, ni: number, fnx: f64, fny: f64, fnz: f64,
                    pxs: f64[], pys: f64[], pzs: f64[], nxs: f64[], nys: f64[], nzs: f64[],
                    txs: f64[], tys: f64[], p: Part): void {
  p.verts.push(pxs[vi]); p.verts.push(pys[vi]); p.verts.push(pzs[vi]);
  if (ni >= 0 && ni < nxs.length) { p.verts.push(nxs[ni]); p.verts.push(nys[ni]); p.verts.push(nzs[ni]); }
  else { p.verts.push(fnx); p.verts.push(fny); p.verts.push(fnz); }   // normal da face
  // uv: OBJ tem origem inferior-esquerda; a textura, superior — V invertido.
  if (ti >= 0 && ti < txs.length) { p.verts.push(txs[ti]); p.verts.push(1.0 - tys[ti]); }
  else { p.verts.push(0.0); p.verts.push(0.0); }
  p.inds.push(p.vi); p.vi = p.vi + 1;
}

// ── .GLB / .GLTF ────────────────────────────────────────────────────────────
// glTF 2.0: um JSON descrevendo nós/malhas/materiais + buffers binários com os
// vértices. `.glb` empacota tudo num arquivo (header + chunk JSON + chunk BIN);
// `.gltf` é o JSON solto com os .bin ao lado.
//
// Importamos GEOMETRIA ESTÁTICA + cor/textura base — que é o que esta engine
// sabe desenhar. Skinning/animação/PBR (metallic, normal map) são ignorados de
// propósito: não há esqueleto nem canais extras no shader.

// Extrai [off, off+len) de um buffer como string. `buffer.to_string(b)` converte
// o buffer INTEIRO (não aceita range), então montamos por bytes — em BLOCOS, que
// concatenar caractere a caractere num JSON de megabytes seria O(n²).
function sliceUtf8(b: i64, off: number, len: number): string {
  let out = "";
  let chunk = "";
  let i = 0;
  while (i < len) {
    chunk = chunk + String.fromCharCode(buffer.read_u8(b, off + i));
    if (chunk.length >= 1024) { out = out + chunk; chunk = ""; }
    i = i + 1;
  }
  if (chunk.length > 0) out = out + chunk;
  return out;
}

const GLB_MAGIC = 0x46546C67;   // "glTF" em little-endian
const CHUNK_JSON = 0x4E4F534A;  // "JSON"
const CHUNK_BIN = 0x004E4942;   // "BIN\0"

// offset do chunk BIN dentro do buffer (0 no .gltf com .bin externo; no .glb é
// onde o chunk começa). Var de MÓDULO: os leitores de accessor a consultam sem
// ter que carregá-la por toda a cadeia de chamadas.
let binOff = 0;

// tipos de componente do glTF (accessor.componentType)
const CT_I8 = 5120; const CT_U8 = 5121;
const CT_I16 = 5122; const CT_U16 = 5123;
const CT_U32 = 5125; const CT_F32 = 5126;

/// Carrega .glb (binário) ou .gltf (JSON + .bin ao lado) → submeshes na VRAM.
export function loadGltfParts(win: i64, path: string): SubMesh[] {
  const parts = parseGltf(path);
  const out: SubMesh[] = [];
  let pi = 0;
  while (pi < parts.length) {
    const p = parts[pi];
    if (p.verts.length > 0) {
      const id = upload(win, p.verts, p.inds);
      if (id > 0) {
        const sm = new SubMesh(id, p.name);
        sm.cr = p.cr; sm.cg = p.cg; sm.cb = p.cb;
        sm.texPath = p.texPath;
        out.push(sm);
      }
    }
    pi = pi + 1;
  }
  return out;
}

/// PARSE puro do glTF (sem GPU) — mesma separação do parseObj, pra testar
/// headless que os accessors foram lidos certo.
export function parseGltf(path: string): Part[] {
  const empty: Part[] = [];
  if (!fs.exists(path)) return empty;
  const baseDir = dirOf(path);

  let js = "";
  let binBuf: i64 = 0;      // buffer com o chunk BIN (0 = nenhum)
  let binLen = 0;
  let fileBuf: i64 = 0;     // buffer do arquivo inteiro (.glb) — liberado no fim

  if (isGlb(path)) {
    const sz = fs.size(path) | 0;
    if (sz < 20) return empty;
    fileBuf = buffer.alloc(sz);
    const got = fs.read_all(path, buffer.ptr(fileBuf), sz) | 0;
    if (got < 20) { buffer.free(fileBuf); return empty; }
    if (buffer.read_i32(fileBuf, 0) !== GLB_MAGIC) { buffer.free(fileBuf); return empty; }
    // header: magic(4) version(4) length(4), depois chunks: len(4) type(4) data
    let off = 12;
    while (off + 8 <= got) {
      const clen = buffer.read_i32(fileBuf, off) | 0;
      const ctype = buffer.read_i32(fileBuf, off + 4) | 0;
      const cdata = off + 8;
      if (clen < 0 || cdata + clen > got) break;      // chunk corrompido
      if (ctype === CHUNK_JSON) js = sliceUtf8(fileBuf, cdata, clen);
      else if (ctype === CHUNK_BIN) { binBuf = fileBuf; binLen = clen; binOff = cdata; }
      off = cdata + clen;
      if ((off % 4) !== 0) off = off + (4 - (off % 4));   // chunks são alinhados a 4
    }
  } else {
    js = fs.read_text(path);
    binOff = 0;
  }
  if (js.length === 0) { if (fileBuf !== 0) buffer.free(fileBuf); return empty; }

  const g = JSON.parse(js);
  const out: Part[] = [];
  const meshes = g.meshes;
  if (meshes === undefined) { if (fileBuf !== 0) buffer.free(fileBuf); return empty; }

  // .gltf externo: carrega os buffers referenciados (uri) sob demanda
  let extBuf: i64 = 0;
  let extLen = 0;
  if (binBuf === 0) {
    const bufs = g.buffers;
    if (bufs !== undefined && bufs.length > 0 && bufs[0].uri !== undefined) {
      const bp = resolveRel(baseDir, bufs[0].uri);
      if (fs.exists(bp)) {
        const bsz = fs.size(bp) | 0;
        if (bsz > 0) {
          extBuf = buffer.alloc(bsz);
          extLen = fs.read_all(bp, buffer.ptr(extBuf), bsz) | 0;
          binBuf = extBuf; binLen = extLen; binOff = 0;
        }
      }
    }
  }
  if (binBuf === 0) { if (fileBuf !== 0) buffer.free(fileBuf); return empty; }

  let mi = 0;
  while (mi < meshes.length) {
    const mesh = meshes[mi];
    const prims = mesh.primitives;
    let mname = "mesh" + mi;
    if (mesh.name !== undefined) mname = mesh.name;
    if (prims !== undefined) {
      let pi = 0;
      while (pi < prims.length) {
        const sm = buildPrimitive(g, prims[pi], binBuf, mname, baseDir, prims.length > 1 ? pi : 0 - 1);
        if (sm !== null) out.push(sm);
        pi = pi + 1;
      }
    }
    mi = mi + 1;
  }
  if (fileBuf !== 0) buffer.free(fileBuf);
  if (extBuf !== 0 && extBuf !== fileBuf) buffer.free(extBuf);
  return out;
}

function isGlb(path: string): boolean {
  const n = path.length;
  if (n < 4) return false;
  return path.charCodeAt(n - 4) === 46 &&
         (path.charCodeAt(n - 3) === 103 || path.charCodeAt(n - 3) === 71) &&
         (path.charCodeAt(n - 2) === 108 || path.charCodeAt(n - 2) === 76) &&
         (path.charCodeAt(n - 1) === 98 || path.charCodeAt(n - 1) === 66);   // .glb
}

// Monta UMA primitive (= uma submesh) lendo os accessors POSITION/NORMAL/TEXCOORD_0.
function buildPrimitive(g: any, prim: any, bin: i64, mname: string,
                        baseDir: string, primIdx: number): Part {
  const attrs = prim.attributes;
  if (attrs === undefined || attrs.POSITION === undefined) return null;
  // modo 4 = TRIANGLES (default). Outros (strip/fan/lines) não são suportados.
  if (prim.mode !== undefined && prim.mode !== 4) return null;

  const pos = readAccessor(g, bin, attrs.POSITION | 0);
  if (pos.length === 0) return null;
  const nrm = attrs.NORMAL !== undefined ? readAccessor(g, bin, attrs.NORMAL | 0) : [];
  const uv = attrs.TEXCOORD_0 !== undefined ? readAccessor(g, bin, attrs.TEXCOORD_0 | 0) : [];
  const nv = pos.length / 3;

  // índices: com accessor próprio, ou sequenciais quando a primitive não é indexada
  const idx: number[] = [];
  if (prim.indices !== undefined) {
    const ia = readAccessorInt(g, bin, prim.indices | 0);
    let i = 0;
    while (i < ia.length) { idx.push(ia[i]); i = i + 1; }
  } else {
    let i = 0;
    while (i < nv) { idx.push(i); i = i + 1; }
  }
  if (idx.length < 3) return null;

  // interleave no layout da engine: [x,y,z, nx,ny,nz, u,v]
  const verts: f64[] = [];
  let v = 0;
  while (v < nv) {
    verts.push(pos[v * 3]); verts.push(pos[v * 3 + 1]); verts.push(pos[v * 3 + 2]);
    if (nrm.length >= (v + 1) * 3) { verts.push(nrm[v * 3]); verts.push(nrm[v * 3 + 1]); verts.push(nrm[v * 3 + 2]); }
    else { verts.push(0.0); verts.push(1.0); verts.push(0.0); }
    if (uv.length >= (v + 1) * 2) { verts.push(uv[v * 2]); verts.push(uv[v * 2 + 1]); }
    else { verts.push(0.0); verts.push(0.0); }
    v = v + 1;
  }
  let nm = mname;
  if (primIdx >= 0) nm = mname + "_" + primIdx;
  const p = new Part(nm, "");
  p.verts = verts;
  p.inds = idx;
  p.vi = nv;
  applyGltfMaterial(g, prim, p, baseDir);
  return p;
}

// Cor base + textura difusa do material da primitive (ignora metallic/roughness/
// normal map: o shader tem uma difusa só).
function applyGltfMaterial(g: any, prim: any, sm: Part, baseDir: string): void {
  if (prim.material === undefined) return;
  const mats = g.materials;
  if (mats === undefined) return;
  const m = mats[prim.material | 0];
  if (m === undefined) return;
  const pbr = m.pbrMetallicRoughness;
  if (pbr === undefined) return;
  const bcf = pbr.baseColorFactor;
  if (bcf !== undefined && bcf.length >= 3) {
    sm.cr = clamp255(bcf[0] * 255.0); sm.cg = clamp255(bcf[1] * 255.0); sm.cb = clamp255(bcf[2] * 255.0);
  }
  // textura: material → texture → image → uri (só imagem EXTERNA; embutida no
  // BIN exigiria escrever um arquivo temporário, o que não fazemos aqui).
  const bct = pbr.baseColorTexture;
  if (bct === undefined || g.textures === undefined || g.images === undefined) return;
  const tex = g.textures[bct.index | 0];
  if (tex === undefined || tex.source === undefined) return;
  const img = g.images[tex.source | 0];
  if (img === undefined || img.uri === undefined) return;
  const p = resolveRel(baseDir, img.uri);
  if (fs.exists(p)) sm.texPath = p;
}

// Lê um accessor FLOAT (posição/normal/uv) como array plano de f64.
function readAccessor(g: any, bin: i64, ai: number): f64[] {
  const out: f64[] = [];
  const accs = g.accessors;
  if (accs === undefined) return out;
  const acc = accs[ai];
  if (acc === undefined || acc.bufferView === undefined) return out;
  const bv = g.bufferViews[acc.bufferView | 0];
  if (bv === undefined) return out;
  const comps = compCount(acc.type);
  if (comps === 0) return out;
  const ct = acc.componentType | 0;
  const count = acc.count | 0;
  let base = binOff;
  if (bv.byteOffset !== undefined) base = base + (bv.byteOffset | 0);
  if (acc.byteOffset !== undefined) base = base + (acc.byteOffset | 0);
  const elem = comps * compSize(ct);
  let stride = elem;
  if (bv.byteStride !== undefined && (bv.byteStride | 0) > 0) stride = bv.byteStride | 0;
  let i = 0;
  while (i < count) {
    let c = 0;
    while (c < comps) {
      const off = base + i * stride + c * compSize(ct);
      out.push(readComp(bin, off, ct));
      c = c + 1;
    }
    i = i + 1;
  }
  return out;
}

// Lê um accessor de ÍNDICES (u16/u32/u8) como inteiros.
function readAccessorInt(g: any, bin: i64, ai: number): number[] {
  const out: number[] = [];
  const accs = g.accessors;
  if (accs === undefined) return out;
  const acc = accs[ai];
  if (acc === undefined || acc.bufferView === undefined) return out;
  const bv = g.bufferViews[acc.bufferView | 0];
  if (bv === undefined) return out;
  const ct = acc.componentType | 0;
  const count = acc.count | 0;
  let base = binOff;
  if (bv.byteOffset !== undefined) base = base + (bv.byteOffset | 0);
  if (acc.byteOffset !== undefined) base = base + (acc.byteOffset | 0);
  const sz = compSize(ct);
  let stride = sz;
  if (bv.byteStride !== undefined && (bv.byteStride | 0) > 0) stride = bv.byteStride | 0;
  let i = 0;
  while (i < count) { out.push(readComp(bin, base + i * stride, ct) | 0); i = i + 1; }
  return out;
}

function compCount(t: string): number {
  if (t === "SCALAR") return 1;
  if (t === "VEC2") return 2;
  if (t === "VEC3") return 3;
  if (t === "VEC4") return 4;
  return 0;
}
function compSize(ct: number): number {
  if (ct === CT_I8 || ct === CT_U8) return 1;
  if (ct === CT_I16 || ct === CT_U16) return 2;
  return 4;   // U32 / F32
}
// Lê 1 componente no offset (little-endian). u16/u8 são montados por bytes,
// porque o buffer só expõe read_u8/i32/f32/f64.
function readComp(bin: i64, off: number, ct: number): f64 {
  if (ct === CT_F32) return buffer.read_f32(bin, off);
  if (ct === CT_U32) return buffer.read_i32(bin, off);
  if (ct === CT_U16) return buffer.read_u8(bin, off) + buffer.read_u8(bin, off + 1) * 256;
  if (ct === CT_I16) {
    const raw = buffer.read_u8(bin, off) + buffer.read_u8(bin, off + 1) * 256;
    if (raw >= 32768) return raw - 65536;
    return raw;
  }
  if (ct === CT_U8) return buffer.read_u8(bin, off);
  if (ct === CT_I8) {
    const r8 = buffer.read_u8(bin, off);
    if (r8 >= 128) return r8 - 256;
    return r8;
  }
  return 0.0;
}

// ── PRIMITIVOS em software (mesma geometria que o gpu3d sobe pra VRAM) ──────
// O thumbnail de PREFAB precisa desenhar cubo/pirâmide/octaedro/esfera sem GPU,
// então a forma é gerada aqui como Part — o mesmo formato dos loaders de arquivo.
// meshKind: 1=cubo 2=pirâmide 3=octaedro 4=esfera (igual ao GameObject.meshKind).

/// Geometria de um primitivo como Part (normais de face, arestas duras).
export function primitivePart(kind: number): Part {
  const p = new Part("primitive", "");
  if (kind === 2) {
    const pc: f64[] = [ 0.0 - 0.5, 0.0 - 0.5, 0.0 - 0.5,  0.5, 0.0 - 0.5, 0.0 - 0.5,
                        0.5, 0.0 - 0.5, 0.5,  0.0 - 0.5, 0.0 - 0.5, 0.5,  0.0, 0.6, 0.0 ];
    const pf: number[] = [ 0,2,1, 0,3,2,  0,1,4, 1,2,4, 2,3,4, 3,0,4 ];
    flatFaces(p, pc, pf);
  } else if (kind === 3) {
    const oc: f64[] = [ 0.6,0.0,0.0,  0.0 - 0.6,0.0,0.0,  0.0,0.6,0.0,
                        0.0,0.0 - 0.6,0.0,  0.0,0.0,0.6,  0.0,0.0,0.0 - 0.6 ];
    const of: number[] = [ 2,4,0, 2,1,4, 2,5,1, 2,0,5,  3,0,4, 3,4,1, 3,1,5, 3,5,0 ];
    flatFaces(p, oc, of);
  } else if (kind === 4) {
    sphereInto(p, 10, 14);   // tesselação menor que a da GPU: é um thumb de 48px
  } else {
    const cc: f64[] = [
      0.0 - 0.5, 0.0 - 0.5, 0.0 - 0.5,   0.5, 0.0 - 0.5, 0.0 - 0.5,
      0.0 - 0.5, 0.5, 0.0 - 0.5,         0.5, 0.5, 0.0 - 0.5,
      0.0 - 0.5, 0.0 - 0.5, 0.5,         0.5, 0.0 - 0.5, 0.5,
      0.0 - 0.5, 0.5, 0.5,               0.5, 0.5, 0.5
    ];
    const cf: number[] = [
      1,3,7, 1,7,5,   0,6,2, 0,4,6,   2,6,7, 2,7,3,
      0,1,5, 0,5,4,   4,5,7, 4,7,6,   0,2,3, 0,3,1
    ];
    flatFaces(p, cc, cf);
  }
  return p;
}

// Emite faces com normal DA FACE, forçando o winding pra fora (dot com o
// centróide) — mesma regra do buildFlat do gpu3d.
function flatFaces(p: Part, corners: f64[], faces: number[]): void {
  let f = 0;
  while (f + 2 < faces.length) {
    const ia = faces[f]; const ib = faces[f + 1]; const ic = faces[f + 2];
    const ax = corners[ia * 3]; const ay = corners[ia * 3 + 1]; const az = corners[ia * 3 + 2];
    let bx = corners[ib * 3]; let by = corners[ib * 3 + 1]; let bz = corners[ib * 3 + 2];
    let cx = corners[ic * 3]; let cy = corners[ic * 3 + 1]; let cz = corners[ic * 3 + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const dot: f64 = nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz);
    if (dot < 0.0) {
      const tx = bx; const ty = by; const tz = bz;
      bx = cx; by = cy; bz = cz; cx = tx; cy = ty; cz = tz;
      nx = 0.0 - nx; ny = 0.0 - ny; nz = 0.0 - nz;
    }
    const l = math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 0.0001) { nx = nx / l; ny = ny / l; nz = nz / l; }
    pushRaw(p, ax, ay, az, nx, ny, nz);
    pushRaw(p, bx, by, bz, nx, ny, nz);
    pushRaw(p, cx, cy, cz, nx, ny, nz);
    f = f + 3;
  }
}

// Esfera UV (normais suaves = posição normalizada), triangulada direto na Part.
function sphereInto(p: Part, lat: number, lon: number): void {
  let i = 0;
  while (i < lat) {
    const t0: f64 = 3.14159265358979 * (i / lat);
    const t1: f64 = 3.14159265358979 * ((i + 1) / lat);
    let j = 0;
    while (j < lon) {
      const f0: f64 = 6.28318530717958 * (j / lon);
      const f1: f64 = 6.28318530717958 * ((j + 1) / lon);
      // 4 cantos do quad esférico → 2 triângulos
      sphTri(p, t0, f0, t0, f1, t1, f1);
      sphTri(p, t0, f0, t1, f1, t1, f0);
      j = j + 1;
    }
    i = i + 1;
  }
}
function sphTri(p: Part, ta: f64, fa: f64, tb: f64, fb: f64, tc: f64, fc: f64): void {
  sphV(p, ta, fa); sphV(p, tb, fb); sphV(p, tc, fc);
}
function sphV(p: Part, theta: f64, phi: f64): void {
  const st = math.sin(theta);
  const x = 0.5 * st * math.cos(phi);
  const y = 0.5 * math.cos(theta);
  const z = 0.5 * st * math.sin(phi);
  // normal suave = posição normalizada (raio 0.5 → ×2)
  pushRaw(p, x, y, z, x * 2.0, y * 2.0, z * 2.0);
}
function pushRaw(p: Part, x: f64, y: f64, z: f64, nx: f64, ny: f64, nz: f64): void {
  p.verts.push(x); p.verts.push(y); p.verts.push(z);
  p.verts.push(nx); p.verts.push(ny); p.verts.push(nz);
  p.verts.push(0.0); p.verts.push(0.0);
  p.inds.push(p.vi); p.vi = p.vi + 1;
}

// ── API ÚNICA (o que o resto da engine usa) ─────────────────────────────────

/// 1 se a extensão é um formato de modelo que sabemos carregar.
export function isModelPath(path: string): boolean {
  return endsWithCI(path, ".obj") || endsWithCI(path, ".glb") || endsWithCI(path, ".gltf");
}
function endsWithCI(s: string, suf: string): boolean {
  const n = s.length; const m = suf.length;
  if (m > n) return false;
  let i = 0;
  while (i < m) {
    let a = s.charCodeAt(n - m + i);
    const b = suf.charCodeAt(i);
    if (a >= 65 && a <= 90) a = a + 32;   // case-insensitive (.OBJ, .GLB)
    if (a !== b) return false;
    i = i + 1;
  }
  return true;
}

/// Carrega QUALQUER formato suportado → submeshes na VRAM, com CACHE por path.
/// Chamar 50 vezes o mesmo modelo = 1 parse + 1 upload.
export function loadModel(win: i64, path: string): SubMesh[] {
  const hit = modelCache.get(path);
  if (hit !== undefined) return hit;
  let parts: SubMesh[] = [];
  if (endsWithCI(path, ".obj")) parts = loadObjParts(win, path);
  else if (endsWithCI(path, ".glb") || endsWithCI(path, ".gltf")) parts = loadGltfParts(win, path);
  if (parts.length > 0) modelCache.set(path, parts);
  return parts;
}
