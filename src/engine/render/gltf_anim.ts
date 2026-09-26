// Engine RTS — LEITOR DE NÓS + CLIPES DE ANIMAÇÃO do glTF (.glb/.gltf).
//
// model.ts já sabe ler geometria/material de um glTF; este módulo lê a outra
// metade do arquivo que model.ts ignora de propósito: a HIERARQUIA de nós
// (osso = nó) e os `animations[]` (clipe = curva por osso/propriedade).
//
// Os personagens Kenney "Blocky Characters" são hierarquias RÍGIDAS (sem
// skinning): cada nó tem 0 ou 1 malha e a pose vem só da transform do nó, por
// isso 1 osso = 1 nó, sem peso de vértice. `Skeleton`/`AnimationPlayer` (fora
// deste arquivo) compõem a pose num laço único percorrendo os ossos em ORDEM
// DE ÍNDICE — por isso a hierarquia aqui é gravada em PRÉ-ORDEM (pai sempre
// antes do filho).

import buffer from "@compat/buffer.ts";
import type { Buf } from "@compat/buffer.ts";

import { dirOf, glbChunks, readAccessor, buildPrimitive } from "./model";
import { upload, loadTexture } from "./gpu3d";

// canal por (osso, propriedade) — mesma codificação do glTF `target.path`.
const CH_TRANSLATION = 0;
const CH_ROTATION = 1;
const CH_SCALE = 2;

/// Um clipe de animação: N canais paralelos, um por (osso, propriedade).
/// `chTimes[c]`/`chValues[c]` são `Float64Array` pra o AnimationPlayer poder
/// fazer busca binária + lerp/nlerp sem alocar por frame.
export class AnimClip {
  name: string;
  duration: f64;
  chBone: number[];
  chPath: number[];         // 0=translation(3) 1=rotation(4) 2=scale(3), ver CH_*
  chTimes: Float64Array[];
  chValues: Float64Array[];
  constructor(name: string) {
    this.name = name;
    this.duration = 0.0;
    this.chBone = [];
    this.chPath = [];
    this.chTimes = [];
    this.chValues = [];
  }
}

/// Esqueleto + peças (partes visíveis) + clipes de UM arquivo glTF.
/// `boneParent[i] < i` sempre (pré-ordem): compor a pose é UM laço `i = 0..N`
/// sem precisar resolver dependência de pai — o pai já foi composto.
export class SkeletonAsset {
  path: string;
  boneNames: string[];
  boneParent: number[];                          // -1 = raiz
  restT: Float64Array; restR: Float64Array; restS: Float64Array;   // 3/4/3 por osso
  partBone: number[]; partMesh: number[]; partTex: number[]; partColor: number[];
  clips: AnimClip[];
  /// Janela para a qual `partMesh`/`partTex` foram subidos (0 = nenhuma: o
  /// asset veio de uma carga sem janela e as peças não desenham ainda).
  uploadedWin: number;
  // Origem de cada peça no glTF (malha, primitive) — para subir as peças
  // DEPOIS, sem reler nós nem animações.
  partSrcMesh: number[]; partSrcPrim: number[];
  constructor(path: string) {
    this.path = path;
    this.boneNames = [];
    this.boneParent = [];
    this.restT = new Float64Array(0);
    this.restR = new Float64Array(0);
    this.restS = new Float64Array(0);
    this.partBone = [];
    this.partMesh = [];
    this.partTex = [];
    this.partColor = [];
    this.clips = [];
    this.uploadedWin = 0;
    this.partSrcMesh = [];
    this.partSrcPrim = [];
  }
  /// índice do clipe pelo nome, -1 se não existir (evita indexOf duplicado nos chamadores).
  clipIndex(name: string): number {
    let i = 0;
    while (i < this.clips.length) { if (this.clips[i].name === name) return i; i = i + 1; }
    return 0 - 1;
  }
}

// ── cache por path ──────────────────────────────────────────────────────────
const skeletonCache = new Map<string, SkeletonAsset>();

/// Lê um `.glb`/`.gltf` → esqueleto (nós em pré-ordem) + peças + clipes.
/// `win = 0` faz o parse SEM tocar na GPU (nenhum upload de malha, nenhum
/// loadTexture) — uso em teste headless; `partMesh`/`partTex` ficam 0.
/// Cacheado por `path`: a 2ª chamada devolve a MESMA instância. Se ela veio de
/// uma carga sem janela (ou de outra janela) e agora chega um `win` real, as
/// peças sobem para ESSA janela aqui — o asset não fica "preso" sem malha.
export function loadSkeletonAsset(win: number, path: string): SkeletonAsset {
  const hit = skeletonCache.get(path);
  if (hit !== undefined) {
    if (skeletonNeedsUpload(hit, win)) uploadSkeletonParts(win, hit);
    return hit;
  }
  const asset = buildSkeletonAsset(win, path);
  if (win !== 0) asset.uploadedWin = win;
  skeletonCache.set(path, asset);
  return asset;
}

/// 1 caso `asset` precise subir as peças para `win` (janela real ainda não
/// atendida). Separado para ser testável sem janela.
export function skeletonNeedsUpload(asset: SkeletonAsset, win: number): boolean {
  return win !== 0 && asset.uploadedWin !== win;
}

/// Reconstrói a geometria de cada peça a partir do arquivo (só malhas e
/// texturas; nós e clipes ficam como estão) e, com `win` real, sobe para a
/// GPU e grava `uploadedWin`. Devolve quantas peças foram reconstruídas.
/// `win = 0` percorre o mesmo caminho sem tocar na GPU (teste headless).
export function uploadSkeletonParts(win: number, asset: SkeletonAsset): number {
  const chunks = glbChunks(asset.path);
  const g = chunks.json;
  const bin = chunks.bin;
  const baseDir = dirOf(asset.path);
  let built = 0;
  let k = 0;
  while (k < asset.partSrcMesh.length) {
    const mi = asset.partSrcMesh[k];
    const pi = asset.partSrcPrim[k];
    const mesh = g.meshes[mi];
    const prims = mesh.primitives;
    let mname = "mesh" + mi;
    if (mesh.name !== undefined) mname = mesh.name;
    const part = buildPrimitive(g, prims[pi], bin, mname, baseDir, prims.length > 1 ? pi : 0 - 1);
    if (part !== null) {
      if (win !== 0) {
        asset.partMesh[k] = upload(win, part.verts, part.inds);
        let texId = 0;
        if (part.texPath.length > 0) {
          try { texId = loadTexture(win, part.texPath); } catch (e) { texId = 0; }
        }
        asset.partTex[k] = texId;
      }
      built = built + 1;
    }
    k = k + 1;
  }
  buffer.free(bin);
  if (win !== 0) asset.uploadedWin = win;
  return built;
}

function buildSkeletonAsset(win: number, path: string): SkeletonAsset {
  const chunks = glbChunks(path);   // lança com o motivo se o arquivo faltar/for inválido
  const g = chunks.json;
  const bin = chunks.bin;
  const baseDir = dirOf(path);

  const nodes = g.nodes;
  if (nodes === undefined) { buffer.free(bin); throw new Error("gltf_anim: arquivo sem 'nodes': " + path); }
  const scenesArr = g.scenes;
  const sceneIdx = g.scene !== undefined ? (g.scene | 0) : 0;
  if (scenesArr === undefined || scenesArr[sceneIdx] === undefined) { buffer.free(bin); throw new Error("gltf_anim: arquivo sem 'scenes' (ou scene invalida): " + path); }
  const rootIdxs = scenesArr[sceneIdx].nodes;
  if (rootIdxs === undefined) { buffer.free(bin); throw new Error("gltf_anim: cena sem 'nodes': " + path); }

  const asset = new SkeletonAsset(path);
  // nó (índice original do glTF) -> osso (índice em pré-ordem, o que esta
  // classe expõe). Precisa disso pra traduzir target.node dos canais.
  const nodeToBone: number[] = [];
  let ni = 0;
  while (ni < nodes.length) { nodeToBone.push(0 - 1); ni = ni + 1; }

  const restT: f64[] = []; const restR: f64[] = []; const restS: f64[] = [];

  // pilha de PRÉ-ORDEM: empilha filhos em ordem REVERSA pra desempilhar na
  // ordem original (mesma técnica de DFS iterativo pré-ordem).
  const stackNode: number[] = [];
  const stackParent: number[] = [];
  let ri = rootIdxs.length - 1;
  while (ri >= 0) { stackNode.push(rootIdxs[ri] | 0); stackParent.push(0 - 1); ri = ri - 1; }

  while (stackNode.length > 0) {
    const nIdx = stackNode.pop() as number;
    const parentBone = stackParent.pop() as number;
    const node = nodes[nIdx];
    const boneIdx = asset.boneNames.length;
    nodeToBone[nIdx] = boneIdx;

    let name = "node" + nIdx;
    if (node.name !== undefined) name = node.name;
    asset.boneNames.push(name);
    asset.boneParent.push(parentBone);

    pushRestPose(node, restT, restR, restS);

    if (node.mesh !== undefined) buildParts(g, bin, node.mesh | 0, boneIdx, baseDir, win, asset);

    const children = node.children;
    if (children !== undefined) {
      let ci = children.length - 1;
      while (ci >= 0) { stackNode.push(children[ci] | 0); stackParent.push(boneIdx); ci = ci - 1; }
    }
  }

  asset.restT = toF64Array(restT);
  asset.restR = toF64Array(restR);
  asset.restS = toF64Array(restS);

  readClips(g, bin, nodeToBone, asset);

  buffer.free(bin);
  return asset;
}

// Pose de repouso de UM nó: TRS explícito com os defaults do glTF, ou `matrix`
// decomposto SÓ quando T/R/S estão todos ausentes (os Kenney usam TRS; a
// decomposição existe pra não quebrar num arquivo que use `matrix`).
function pushRestPose(node: any, restT: f64[], restR: f64[], restS: f64[]): void {
  if (node.matrix !== undefined && node.translation === undefined &&
      node.rotation === undefined && node.scale === undefined) {
    const d = decomposeMatrix(node.matrix);
    restT.push(d[0]); restT.push(d[1]); restT.push(d[2]);
    restR.push(d[3]); restR.push(d[4]); restR.push(d[5]); restR.push(d[6]);
    restS.push(d[7]); restS.push(d[8]); restS.push(d[9]);
    return;
  }
  let tx = 0.0, ty = 0.0, tz = 0.0;
  let rx = 0.0, ry = 0.0, rz = 0.0, rw = 1.0;
  let sx = 1.0, sy = 1.0, sz = 1.0;
  const t = node.translation; if (t !== undefined) { tx = t[0]; ty = t[1]; tz = t[2]; }
  const r = node.rotation; if (r !== undefined) { rx = r[0]; ry = r[1]; rz = r[2]; rw = r[3]; }
  const s = node.scale; if (s !== undefined) { sx = s[0]; sy = s[1]; sz = s[2]; }
  restT.push(tx); restT.push(ty); restT.push(tz);
  restR.push(rx); restR.push(ry); restR.push(rz); restR.push(rw);
  restS.push(sx); restS.push(sy); restS.push(sz);
}

// Decompõe uma matriz 4x4 column-major (16 f64) em T/R/S.
// [tx,ty,tz, rx,ry,rz,rw, sx,sy,sz]
function decomposeMatrix(m: number[]): f64[] {
  const tx = m[12], ty = m[13], tz = m[14];
  let sx = colLen(m, 0), sy = colLen(m, 4), sz = colLen(m, 8);
  if (sx === 0.0) sx = 1.0; if (sy === 0.0) sy = 1.0; if (sz === 0.0) sz = 1.0;
  // colunas da base normalizadas (matriz de rotação pura)
  const m00 = m[0] / sx, m01 = m[1] / sx, m02 = m[2] / sx;
  const m10 = m[4] / sy, m11 = m[5] / sy, m12 = m[6] / sy;
  const m20 = m[8] / sz, m21 = m[9] / sz, m22 = m[10] / sz;
  const q = quatFromMat3(m00, m01, m02, m10, m11, m12, m20, m21, m22);
  return [tx, ty, tz, q[0], q[1], q[2], q[3], sx, sy, sz];
}
function colLen(m: number[], o: number): f64 {
  return sqrt(m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2]);
}
function sqrt(v: f64): f64 { return Math.sqrt(v); }
// Quaternion [x,y,z,w] a partir de uma matriz 3x3 de rotação pura, colunas
// (m00,m01,m02)=eixo X, (m10,m11,m12)=eixo Y, (m20,m21,m22)=eixo Z — método
// do traço (Shepperd), estável nos 4 quadrantes.
function quatFromMat3(m00: f64, m01: f64, m02: f64, m10: f64, m11: f64, m12: f64,
                      m20: f64, m21: f64, m22: f64): f64[] {
  const tr = m00 + m11 + m22;
  if (tr > 0.0) {
    const s = sqrt(tr + 1.0) * 2.0;
    return [(m12 - m21) / s, (m20 - m02) / s, (m01 - m10) / s, 0.25 * s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = sqrt(1.0 + m00 - m11 - m22) * 2.0;
    return [0.25 * s, (m01 + m10) / s, (m20 + m02) / s, (m12 - m21) / s];
  }
  if (m11 > m22) {
    const s = sqrt(1.0 + m11 - m00 - m22) * 2.0;
    return [(m01 + m10) / s, 0.25 * s, (m21 + m12) / s, (m20 - m02) / s];
  }
  const s = sqrt(1.0 + m22 - m00 - m11) * 2.0;
  return [(m20 + m02) / s, (m21 + m12) / s, 0.25 * s, (m01 - m10) / s];
}

// Uma peça por primitive de um nó com malha (`buildPrimitive` já monta a
// geometria/material; aqui só decide se sobe pra GPU — win=0 não sobe nada).
function buildParts(g: any, bin: Buf, meshIdx: number, boneIdx: number, baseDir: string,
                    win: number, asset: SkeletonAsset): void {
  const meshes = g.meshes;
  if (meshes === undefined) return;
  const mesh = meshes[meshIdx];
  if (mesh === undefined || mesh.primitives === undefined) return;
  let mname = "mesh" + meshIdx;
  if (mesh.name !== undefined) mname = mesh.name;
  const prims = mesh.primitives;
  let pi = 0;
  while (pi < prims.length) {
    const part = buildPrimitive(g, prims[pi], bin, mname, baseDir, prims.length > 1 ? pi : 0 - 1);
    if (part !== null) {
      let meshId = 0;
      let texId = 0;
      if (win !== 0) {
        meshId = upload(win, part.verts, part.inds);
        if (part.texPath.length > 0) {
          try { texId = loadTexture(win, part.texPath); } catch (e) { texId = 0; }
        }
      }
      asset.partBone.push(boneIdx);
      asset.partSrcMesh.push(meshIdx);
      asset.partSrcPrim.push(pi);
      asset.partMesh.push(meshId);
      asset.partTex.push(texId);
      asset.partColor.push(packColor(part.cr, part.cg, part.cb));
    }
    pi = pi + 1;
  }
}
// Empacota RGB (0..255 cada) em 0xRRGGBB, sem canal alfa — é a convenção de
// `drawGPUMesh` (scenedraw.ts: `(rr << 16) | (gg << 8) | bbv`), quem consome
// `partColor`. NÃO é o layout 0xAABBGGRR de mesh.ts/raster.ts (framebuffer em
// software): são consumidores diferentes.
function packColor(cr: number, cg: number, cb: number): number {
  return ((cr | 0) << 16) | ((cg | 0) << 8) | (cb | 0);
}

// Lê `animations[]` → um AnimClip por animação, um canal por (osso, path)
// suportado (translation/rotation/scale — glTF ainda tem `weights`, sem uso
// aqui porque não há morph target nestes personagens).
function readClips(g: any, bin: Buf, nodeToBone: number[], asset: SkeletonAsset): void {
  const anims = g.animations;
  if (anims === undefined) return;
  let ai = 0;
  while (ai < anims.length) {
    const anim = anims[ai];
    let cname = "clip" + ai;
    if (anim.name !== undefined) cname = anim.name;
    const clip = new AnimClip(cname);
    const channels = anim.channels;
    const samplers = anim.samplers;
    if (channels !== undefined && samplers !== undefined) {
      let ci = 0;
      while (ci < channels.length) {
        readChannel(g, bin, channels[ci], samplers, nodeToBone, clip);
        ci = ci + 1;
      }
    }
    asset.clips.push(clip);
    ai = ai + 1;
  }
}
function readChannel(g: any, bin: Buf, ch: any, samplers: any[], nodeToBone: number[], clip: AnimClip): void {
  const target = ch.target;
  if (target === undefined || target.node === undefined || target.path === undefined) return;
  const pathCode = pathToCode(target.path);
  if (pathCode < 0) return;
  const boneIdx = nodeToBone[target.node | 0];
  if (boneIdx < 0) return;
  const sampler = samplers[ch.sampler | 0];
  if (sampler === undefined) return;

  const times = readAccessor(g, bin, sampler.input | 0);
  if (times.length === 0) return;
  const values = readAccessor(g, bin, sampler.output | 0);

  clip.chBone.push(boneIdx);
  clip.chPath.push(pathCode);
  clip.chTimes.push(toF64Array(times));
  clip.chValues.push(toF64Array(values));

  // duração do clipe = maior `max` entre os inputs dos samplers usados —
  // ler direto do accessor (em vez de `times[times.length-1]`) porque é o
  // valor que o próprio arquivo garante como limite, sem depender de o
  // array vir ordenado.
  const accs = g.accessors;
  if (accs !== undefined) {
    const acc = accs[sampler.input | 0];
    if (acc !== undefined && acc.max !== undefined && acc.max.length > 0) {
      const mx: f64 = acc.max[0];
      if (mx > clip.duration) clip.duration = mx;
    }
  }
}
function pathToCode(p: string): number {
  if (p === "translation") return CH_TRANSLATION;
  if (p === "rotation") return CH_ROTATION;
  if (p === "scale") return CH_SCALE;
  return 0 - 1;
}

function toF64Array(list: f64[]): Float64Array {
  const out = new Float64Array(list.length);
  let i = 0;
  while (i < list.length) { out[i] = list[i]; i = i + 1; }
  return out;
}
