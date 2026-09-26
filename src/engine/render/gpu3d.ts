// Engine RTS — caminho de render 3D por GPU (pipeline wgpu no rts-egui).
//
// Em vez de rasterizar por software (raster.ts/mesh.ts), sobe as meshes pra VRAM
// UMA vez (meshUpload) e por frame só manda câmera/luz + 1 drawMesh por objeto —
// a GPU faz projeção/rasterização/shading/depth. A UI do egui é composta por cima.
//
// Geometria: pos+normal+uv interleaved (8 f32/vértice). meshKind: 1=cubo,
// 2=pirâmide, 3=octaedro, 4=esfera.
//
// ── PORTE PRO MOTOR NOVO ────────────────────────────────────────────────────
//
// A superfície `rts:egui` do motor novo difere da antiga em três pontos, e os
// três atravessam este arquivo (`crates/rts-ui/src/lib.rs` é quem os enumera):
//
//  1. A geometria chega como VIEW TIPADA, não como endereço. O `upload()` antigo
//     alocava com `buffer.alloc`, escrevia com `buffer.write_f32` e passava
//     `buffer.ptr(...)`. Isso não é um nome que mudou: o coletor MOVE células, e
//     um endereço lido pode não apontar mais pro buffer quando o Rust o usa. O
//     caminho aqui monta `Float32Array`/`Uint32Array` e some com o `rts:buffer`.
//  2. Os desenhos recebem um OBJETO DE OPÇÕES em vez de 13 posicionais (a
//     convenção de chamada do motor novo carrega 4 argumentos). Exceção que a
//     doc do `scene.rs` marca: `setClearColor(win, r, g, b)` continua posicional.
//  3. Onde antes era número agora há `boolean` de verdade — `setVsync` recebe um.
//
// Os `f64`/`i64` das assinaturas viraram `number`: eram anotações de
// representação do motor antigo, e o novo tem uma só. Ninguém que chama sente.
//
// ── O QUE NÃO EXISTE NO MOTOR NOVO ──────────────────────────────────────────
//
//  · `rts:imgdec` — o decodificador de PNG/JPG/BMP/WebP. Sem ele não há como ir
//    de um arquivo até pixels RGBA8, então `loadTexture` LANÇA (ver a doc dela).
//  · `egui.drawWater` — o draw INSTANCIADO de partículas lendo um buffer de
//    compute. Não foi renomeado nem substituído: não está na superfície nova
//    (`crates/rts-ui/src/scene.rs` lista os dez membros do pass 3D, e ele não é
//    um deles). `drawWaterGPU` lança pelo mesmo motivo.
//
// Nos dois casos a escolha foi lançar em vez de devolver 0: um 0 silencioso vira
// uma textura invisível ou uma água que não aparece, e o tempo até alguém
// entender por quê é maior que o do erro.

import {
  meshUpload, textureUpload, setCamera, setLight, setShadow as eguiSetShadow,
  drawMesh, drawMeshBatch, setVsync as eguiSetVsync,
  winWidth as eguiWinWidth, winHeight as eguiWinHeight,
} from "rts:egui";
import math from "@compat/math.ts";
import { decodePNG } from "./png";
import fs from "@compat/fs.ts";

const PI: number = 3.14159265358979;

// ids das meshes na GPU (0 = não carregada)
let idCube = 0;
let idPyra = 0;
let idOcta = 0;
let idSphere = 0;
let ready = 0;
let idSphereLow: number = 0;

/// O RAIO da esfera que envolve cada mesh, por id, em unidades de MALHA.
///
/// O culling usava `max(escala) * 0.87` para todo mundo, e 0.87 é
/// `sqrt(3)/2` — o raio de um CUBO UNITÁRIO. Vale para as primitivas, que são
/// unitárias por construção, e é ficção para um `.obj`: um modelo de dois
/// metros com escala 1 tem raio 1,0 e desaparecia da tela antes de sair do
/// campo de visão. O raio sai dos VÉRTICES, no upload, que é o único lugar que
/// os vê — e um id desconhecido responde 0.87, que é o que havia antes.
const meshRadii = new Map<number, number>();

/// O raio envolvente da mesh `id`, em unidades de malha.
export function meshRadius(id: number): number {
  const r = meshRadii.get(id);
  if (r === undefined) return 0.87;
  return r;
}

/// Sobe uma mesh pra VRAM e devolve o mesh id (0 = falhou).
/// Layout do vértice: 8 f32 INTERLEAVED — [x,y,z, nx,ny,nz, u,v].
/// Exportada porque os LOADERS de modelo (engine/render/model.ts: .obj, .glb)
/// montam os arrays e só precisam deste passo final.
///
/// Continua recebendo arrays comuns, e não as views prontas, porque é o que os
/// chamadores já têm nas mãos: `model.ts` monta `p.verts`/`p.inds` empurrando
/// número a número. A conversão pra view acontece aqui, num lugar só — os
/// comprimentos saem das próprias views do outro lado, então some também a
/// chance de declarar uma contagem que discorde dos dados.
export function upload(win: number, verts: number[], inds: number[]): number {
  const id = meshUpload(win, new Float32Array(verts), new Uint32Array(inds));
  if (id > 0) meshRadii.set(id, raioDe(verts));
  return id;
}

/// A maior distância de um vértice à origem. O layout é 8 f32 por vértice e a
/// posição são os três primeiros (ver `upload`); o resto é normal e uv, que não
/// entram num raio.
function raioDe(verts: number[]): number {
  let maior: number = 0.0;
  let i = 0;
  while (i + 2 < verts.length) {
    const x = verts[i]; const y = verts[i + 1]; const z = verts[i + 2];
    const d = x * x + y * y + z * z;
    if (d > maior) maior = d;
    i = i + 8;
  }
  return math.sqrt(maior);
}

// adiciona um vértice (pos + normal suave = pos normalizada + uv) ao array (esfera).
function pushV(a: number[], x: number, y: number, z: number, u: number, v: number): void {
  const l = math.sqrt(x * x + y * y + z * z);
  let nx = 0.0; let ny = 1.0; let nz = 0.0;
  if (l > 0.0001) { nx = x / l; ny = y / l; nz = z / l; }
  a.push(x); a.push(y); a.push(z);
  a.push(nx); a.push(ny); a.push(nz);
  a.push(u); a.push(v);
}

// mesh FLAT (facetada): cada face vira 3 vértices com a NORMAL DA FACE (arestas
// duras — cubo parece cubo). Winding + normal forçados pra FORA (culling ok).
function buildFlat(win: number, corners: number[], faces: number[]): number {
  const verts: number[] = [];
  const inds: number[] = [];
  let f = 0;
  let vi = 0;
  while (f < faces.length) {
    const ia = faces[f]; const ib = faces[f + 1]; const ic = faces[f + 2];
    const ax = corners[ia * 3]; const ay = corners[ia * 3 + 1]; const az = corners[ia * 3 + 2];
    let bx = corners[ib * 3]; let by = corners[ib * 3 + 1]; let bz = corners[ib * 3 + 2];
    let cx = corners[ic * 3]; let cy = corners[ic * 3 + 1]; let cz = corners[ic * 3 + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    // centróide (corners centrados na origem) aponta pra fora
    const dot: number = nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz);
    if (dot < 0) {
      const tx = bx; const ty = by; const tz = bz; bx = cx; by = cy; bz = cz; cx = tx; cy = ty; cz = tz;
      nx = 0 - nx; ny = 0 - ny; nz = 0 - nz;
    }
    const l = math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 0.0001) { nx = nx / l; ny = ny / l; nz = nz / l; }
    // uv planar por face: os 3 cantos do triângulo mapeiam (0,0)/(1,0)/(0,1) —
    // cada face recebe a textura inteira (simples, sem stretching esquisito).
    verts.push(ax); verts.push(ay); verts.push(az); verts.push(nx); verts.push(ny); verts.push(nz); verts.push(0.0); verts.push(0.0);
    verts.push(bx); verts.push(by); verts.push(bz); verts.push(nx); verts.push(ny); verts.push(nz); verts.push(1.0); verts.push(0.0);
    verts.push(cx); verts.push(cy); verts.push(cz); verts.push(nx); verts.push(ny); verts.push(nz); verts.push(0.0); verts.push(1.0);
    inds.push(vi); inds.push(vi + 1); inds.push(vi + 2);
    vi = vi + 3;
    f = f + 3;
  }
  return upload(win, verts, inds);
}

/// Sobe as 4 meshes primitivas (1×). Chame depois de abrir a janela.
export function initMeshes(win: number): void {
  if (ready !== 0) return;

  // ── cubo / pirâmide / octaedro: FLAT (arestas duras) ──
  const cc: number[] = [
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  -0.5,0.5,-0.5,  0.5,0.5,-0.5,
    -0.5,-0.5,0.5,   0.5,-0.5,0.5,   -0.5,0.5,0.5,   0.5,0.5,0.5
  ];
  const cf: number[] = [
    1,3,7, 1,7,5,   0,6,2, 0,4,6,   2,6,7, 2,7,3,
    0,1,5, 0,5,4,   4,5,7, 4,7,6,   0,2,3, 0,3,1
  ];
  idCube = buildFlat(win, cc, cf);

  const pc: number[] = [ -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5, 0.0,0.6,0.0 ];
  const pf: number[] = [ 0,2,1, 0,3,2,  0,1,4, 1,2,4, 2,3,4, 3,0,4 ];
  idPyra = buildFlat(win, pc, pf);

  const oc: number[] = [ 0.6,0,0, -0.6,0,0, 0,0.6,0, 0,-0.6,0, 0,0,0.6, 0,0,-0.6 ];
  const of: number[] = [ 2,4,0, 2,1,4, 2,5,1, 2,0,5,  3,0,4, 3,4,1, 3,1,5, 3,5,0 ];
  idOcta = buildFlat(win, oc, of);

  // ── esfera (UV lat/long, alta tesselação — a GPU aguenta) ──
  const sv: number[] = [];
  const sf: number[] = [];
  const LAT = 16;
  const LON = 24;
  let ii = 0;
  while (ii <= LAT) {
    const theta: number = PI * (ii / LAT);
    const st: number = math.sin(theta);
    const ct: number = math.cos(theta);
    let jj = 0;
    while (jj < LON) {
      const phi: number = 2.0 * PI * (jj / LON);
      // uv lat/long: u ao redor (jj/LON), v do polo ao polo (ii/LAT).
      pushV(sv, 0.5 * st * math.cos(phi), 0.5 * ct, 0.5 * st * math.sin(phi), jj / LON, ii / LAT);
      jj = jj + 1;
    }
    ii = ii + 1;
  }
  let ri = 0;
  while (ri < LAT) {
    let jj = 0;
    while (jj < LON) {
      let jn = jj + 1;
      if (jn >= LON) jn = 0;
      const a = ri * LON + jj;
      const b = ri * LON + jn;
      const c = (ri + 1) * LON + jn;
      const d = (ri + 1) * LON + jj;
      sf.push(a); sf.push(c); sf.push(b);
      sf.push(a); sf.push(d); sf.push(c);
      jj = jj + 1;
    }
    ri = ri + 1;
  }
  idSphere = upload(win, sv, sf);

  // ── esfera LOD-BAIXO p/ ÁGUA instanciada: LAT 6 × LON 8 = 96 tris. A cheia
  // (768 tris) × 16k partículas = 12M tris/frame de gordura pura; a baixa dá
  // 1,5M e ninguém vê a diferença numa gota de 0.3 de raio.
  //
  // Continua sendo subida mesmo com `drawWaterGPU` sem destino no motor novo: é
  // uma mesh comum, e quem quiser desenhar as partículas uma a uma com
  // `drawGPUMesh` precisa exatamente deste id. Jogá-la fora agora custaria
  // reescrevê-la no dia em que o draw instanciado voltar.
  const wv: number[] = [];
  const wf: number[] = [];
  const WLAT = 6;
  const WLON = 8;
  let wi = 0;
  while (wi <= WLAT) {
    const theta: number = PI * (wi / WLAT);
    const st: number = math.sin(theta);
    const ct: number = math.cos(theta);
    let wj = 0;
    while (wj < WLON) {
      const phi: number = 2.0 * PI * (wj / WLON);
      pushV(wv, 0.5 * st * math.cos(phi), 0.5 * ct, 0.5 * st * math.sin(phi), wj / WLON, wi / WLAT);
      wj = wj + 1;
    }
    wi = wi + 1;
  }
  let wr = 0;
  while (wr < WLAT) {
    let wj = 0;
    while (wj < WLON) {
      let wn = wj + 1;
      if (wn >= WLON) wn = 0;
      const a = wr * WLON + wj;
      const b = wr * WLON + wn;
      const c = (wr + 1) * WLON + wn;
      const d = (wr + 1) * WLON + wj;
      wf.push(a); wf.push(c); wf.push(b);
      wf.push(a); wf.push(d); wf.push(c);
      wj = wj + 1;
    }
    wr = wr + 1;
  }
  idSphereLow = upload(win, wv, wf);

  ready = 1;
}

/// O mesh id da esfera de LOD baixo (0 antes do initMeshes). Exposto porque era
/// o único uso dela — o `drawWaterGPU` — e ele não tem para onde ir aqui.
export function lowPolySphereId(): number { return idSphereLow; }

// Cache de textura POR PATH: aplicar a mesma imagem em N objetos = 1 upload pra
// VRAM (as demais reusam o texId). Um `const … = new Map()` de módulo é o padrão
// de singleton que o motor promove com class-tracking, então `.get/.set`
// despacham mesmo lido/escrito de dentro de funções. (Uma janela só no editor;
// se um dia houver várias, o cache viraria por-janela — o texId é da cena.)
const texCache = new Map<string, number>();

/// Sobe pixels RGBA8 (sRGB) já decodificados → id de textura (≥2) usável como
/// `tex` no drawGPU/drawGPUMesh. 0 em falha.
///
/// Este é o caminho que SOBREVIVEU ao porte, porque é o que não depende de
/// decodificar formato nenhum: quem já tem os bytes na mão — um gerador
/// procedural, um atlas montado em código, um decode feito em outro lugar —
/// chega aqui direto. `key` só serve pro cache; passe `""` pra não memorizar.
export function uploadTexture(win: number, pixels: Uint8Array, w: number, h: number, key: string): number {
  if (key.length > 0) {
    const hit = texCache.get(key);
    if (hit !== undefined && hit > 0) return hit;
  }
  const texId = textureUpload(win, pixels, w, h);
  if (texId > 0 && key.length > 0) texCache.set(key, texId);
  return texId;
}

/// Carrega uma textura de IMAGEM do disco e devolve o id de GPU (cacheado pelo
/// caminho: a segunda chamada não relê nem reenvia).
///
/// Só PNG (RGBA ou RGB, 8 bits, sem interlace), decodificado em TypeScript por
/// `png.ts`: o runtime novo não tem `rts:imgdec`. Outro formato lança com o
/// motivo — lançar, e não devolver 0, porque um 0 vira um objeto sem textura
/// vários frames depois e o erro fica longe da causa.
/// Maior lado aceito para uma textura de imagem.
const LOAD_TEXTURE_MAX_PIXELS = 4096;

export function loadTexture(win: number, path: string): number {
  const hit = texCache.get(path);
  if (hit !== undefined && hit > 0) return hit;
  if (!path.toLowerCase().endsWith(".png")) {
    throw new Error("loadTexture: so PNG e suportado neste runtime (sem rts:imgdec); '" + path + "' nao e .png");
  }
  if (!fs.exists(path)) throw new Error("loadTexture: arquivo nao encontrado: " + path);
  const img = decodePNG(fs.read_all(path), LOAD_TEXTURE_MAX_PIXELS);
  return uploadTexture(win, img.pixels, img.width, img.height, path);
}

/// Enfileira um draw de um mesh id ARBITRÁRIO (ex.: .obj carregado), fora do
/// mapeamento meshKind→primitivo. Mesmos params de transform/cor de drawGPU.
///
/// Os `| 0` que existiam aqui foram embora com a razão deles: eram contra o
/// marshalling posicional do motor antigo, que BITCASTAVA os bits de um `number`
/// em repr f64 num param U64 (5.0 virava 0x4014…). Um objeto de opções é lido
/// campo a campo como número — não há param tipado pra bitcastar.
export function drawGPUMesh(win: number, meshId: number, px: number, py: number, pz: number,
                           rx: number, ry: number, sx: number, sy: number, sz: number,
                           color: number, emissive: number, tex: number, tileArg?: number): void {
  const tile: number = tileArg !== undefined ? tileArg : 0.0;
  drawMesh(win, {
    mesh: meshId, x: px, y: py, z: pz, rx: rx, ry: ry,
    sx: sx, sy: sy, sz: sz, color: color, emissive: emissive, tex: tex, tile: tile,
  });
}

/// Como `drawGPUMesh`, com a rotação dada por um QUATERNION `q` = [x, y, z, w]
/// (glTF) em vez de pitch/yaw: é como o Skeleton desenha cada osso. Com
/// qualquer componente de `q` ≠ 0 o runtime ignora rx/ry. Sem tiling.
export function drawGPUMeshQ(win: number, meshId: number, px: number, py: number, pz: number,
                             q: Float64Array, sx: number, sy: number, sz: number,
                             color: number, emissive: number, tex: number): void {
  drawMesh(win, {
    mesh: meshId, x: px, y: py, z: pz, rx: 0.0, ry: 0.0,
    qx: q[0], qy: q[1], qz: q[2], qw: q[3],
    sx: sx, sy: sy, sz: sz, color: color, emissive: emissive, tex: tex, tile: 0.0,
  });
}

/// Liga/desliga o VSYNC da janela (1 = Fifo, o padrão; 0 = sem espera).
///
/// Com vsync o FPS fica preso ao refresh do monitor (~60 Hz), o que é o certo
/// pra uma UI mas ESCONDE a performance real: um frame de 5 ms e um de 16 ms
/// medem os mesmos 60 fps. Desligar revela o custo verdadeiro do frame — é o
/// que o comando ws `vsync 0` faz pra medir otimizações.
///
/// Continua recebendo NÚMERO, e converte aqui: a superfície nova quer `boolean`,
/// mas os chamadores (`query.ts`, os demos) passam o 0/1 que vem do comando de
/// texto. Traduzir num lugar só é mais barato que mexer em todos eles.
export function setVsync(win: number, on: number): void {
  eguiSetVsync(win, on !== 0);
}

/// Define a câmera do frame 3D (fly cam). Ângulos em RADIANOS; base canhota,
/// `yaw` 0 olha para +Z (é a mesma convenção de antes).
export function setCam(win: number, cx: number, cy: number, cz: number,
                       yaw: number, pitch: number, fovY: number, aspect: number): void {
  setCamera(win, { x: cx, y: cy, z: cz, yaw: yaw, pitch: pitch, fov: fovY, aspect: aspect });
}
/// Define a luz PONTUAL (posição) + ambiente.
export function setLgt(win: number, dx: number, dy: number, dz: number, ambient: number): void {
  setLight(win, { x: dx, y: dy, z: dz, ambient: ambient });
}
/// Configura o shadow map: direção da luz + centro/raio da caixa coberta (raio<=0 desliga).
export function setShadow(win: number, dx: number, dy: number, dz: number,
                          cx: number, cy: number, cz: number, radius: number): void {
  eguiSetShadow(win, { dx: dx, dy: dy, dz: dz, cx: cx, cy: cy, cz: cz, radius: radius });
}
/// Largura/altura LÓGICA atual da janela (segue o resize).
export function winWidth(win: number): number { return eguiWinWidth(win); }
export function winHeight(win: number): number { return eguiWinHeight(win); }

/// Frustum culling: `true` se a esfera envolvente (centro wx,wy,wz + raio) está
/// (ao menos parcialmente) dentro do campo de visão. Engine-side, transparente —
/// pula o drawMesh de quem está atrás/fora, poupando draw calls em cenas grandes.
export function inFrustum(camx: number, camy: number, camz: number, yaw: number, pitch: number,
                          fovY: number, aspect: number, wx: number, wy: number, wz: number, radius: number): number {
  // conveniência: recalcula a trigonometria (5 chamadas). Num laço sobre a cena
  // prefira frustumBegin() + inFrustumFast(), que fazem isso UMA vez por frame.
  frustumBegin(camx, camy, camz, yaw, pitch, fovY, aspect);
  return inFrustumFast(wx, wy, wz, radius);
}

// ── FRUSTUM CACHEADO (o caminho quente) ─────────────────────────────────────
// A câmera não muda durante o laço de render, mas inFrustum recalculava
// cos/sin/tan POR OBJETO — 5 chamadas trigonométricas × N objetos por frame.
// frustumBegin faz isso uma vez; inFrustumFast só usa os valores.
let fCamX: number = 0.0; let fCamY: number = 0.0; let fCamZ: number = 0.0;
let fCyw: number = 1.0; let fSyw: number = 0.0;
let fCpt: number = 1.0; let fSpt: number = 0.0;
let fTanV: number = 0.5; let fTanH: number = 0.5;

/// Prepara o frustum do frame. Chame UMA vez, antes do laço de objetos.
export function frustumBegin(camx: number, camy: number, camz: number, yaw: number, pitch: number,
                             fovY: number, aspect: number): void {
  fCamX = camx; fCamY = camy; fCamZ = camz;
  fCyw = math.cos(yaw); fSyw = math.sin(yaw);
  fCpt = math.cos(pitch); fSpt = math.sin(pitch);
  fTanV = math.tan(fovY * 0.5);
  fTanH = fTanV * aspect;
}

/// Copia os 9 valores do frustum preparado para `out` (índices 0..8: camX, camY,
/// camZ, cosYaw, sinYaw, cosPitch, sinPitch, tanH, tanV).
///
/// Existe porque o laço de render precisa da MESMA aritmética de `inFrustumFast`
/// mas com os valores em PARÂMETROS, não em variáveis de módulo — medido, é 3×
/// (ver a nota em `main.ts`). Recalcular os cos/sin no chamador daria o mesmo
/// número e uma segunda fonte da verdade; isto entrega a única que existe.
///
/// `out` é preenchido em vez de devolvido: uma vez por frame, sem alocar.
export function frustumParams(out: f64[]): void {
  out[0] = fCamX; out[1] = fCamY; out[2] = fCamZ;
  out[3] = fCyw;  out[4] = fSyw;
  out[5] = fCpt;  out[6] = fSpt;
  out[7] = fTanH; out[8] = fTanV;
}

/// Teste de visibilidade usando o frustum preparado por frustumBegin.
export function inFrustumFast(wx: number, wy: number, wz: number, radius: number): number {
  const dx = wx - fCamX; const dy = wy - fCamY; const dz = wz - fCamZ;
  const x1 = dx * fCyw - dz * fSyw;
  const z1 = dx * fSyw + dz * fCyw;
  const y2 = dy * fCpt - z1 * fSpt;
  const z2 = dy * fSpt + z1 * fCpt;
  if (z2 + radius < 0.1) return 0;         // atrás do near
  if (z2 - radius > 500.0) return 0;       // além do far
  const limH: number = z2 * fTanH;
  if (x1 - radius > limH) return 0;
  if (0.0 - x1 - radius > limH) return 0;
  const limV: number = z2 * fTanV;
  if (y2 - radius > limV) return 0;
  if (0.0 - y2 - radius > limV) return 0;
  return 1;
}

/// AUSENTE NO MOTOR NOVO — lança.
///
/// Desenhava `count` partículas em UMA chamada, lendo as instâncias (vec4: xyz +
/// densidade assinada) direto do buffer de compute `gbuf`, com o culling de
/// casca no vertex shader. Dependia de `egui.drawWater`, que NÃO está entre os
/// dez membros do pass 3D da superfície nova (`crates/rts-ui/src/scene.rs`:
/// meshUpload, meshFree, textureUpload, setCamera, setCameraLookAt,
/// setClearColor, setSkybox, setLight, setShadow, drawMesh).
///
/// Não há como emular: o ponto dele era a GPU ler as posições sem readback, e
/// fazer N `drawGPUMesh` exigiria trazer as partículas de volta pra CPU — o
/// custo exato que o draw instanciado existe para evitar. Quem aceitar esse
/// custo escreve o laço no chamador, com `lowPolySphereId()` como mesh.
export function drawWaterGPU(win: number, gbuf: number, count: number, scale: number): number {
  throw new Error(
    "drawWaterGPU ausente no motor novo: `egui.drawWater` (draw instanciado lendo " +
    "um buffer de compute) não existe na superfície nova. Sem ele, desenhar " +
    count + " partículas exige um drawGPUMesh por partícula, com readback do buffer."
  );
}

/// O mesh id de um meshKind — a MESMA tabela que `drawGPU` aplica.
///
/// Exportada porque o caminho em LOTE precisa do id para escrever no registro da
/// instância, e ele não passa por `drawGPU`. Continua sendo uma tabela só: se
/// `drawGPU` resolvesse por conta própria, um kind novo passaria a desenhar
/// diferente conforme o caminho — que é o tipo de divergência que ninguém vê até
/// a cena estar errada. Por isso `drawGPU` chama esta função.
export function meshIdFor(kind: number): number {
  if (kind === 2) return idPyra;
  if (kind === 3) return idOcta;
  if (kind === 4) return idSphere;
  return idCube;
}

/// Desenha N objetos numa ÚNICA travessia TS→nativo.
///
/// `transforms` = 8 f32 por objeto (x,y,z,rx,ry,sx,sy,sz);
/// `codes` = 4 u32 por objeto (mesh, color, emissive, tex). Responde quantos
/// entraram. Os inteiros vão num `Uint32Array` separado de propósito: uma cor
/// `0xAARRGGBB` com alpha passa de 2^24 e voltaria arredondada de um f32.
///
/// O pass 3D já instanciava — ele ordena por (mesh, tex) e monta um instance
/// buffer desde antes disto. O que isto remove é a FRONTEIRA: eram N idas ao
/// nativo por frame, cada uma materializando um objeto de 12 campos, para no fim
/// empurrar N tuplas na mesma fila.
export function drawBatch(win: number, transforms: Float32Array, codes: Uint32Array): number {
  return drawMeshBatch(win, { transforms: transforms, codes: codes });
}

/// Enfileira 1 objeto pra desenhar na GPU (mapeia meshKind → mesh id).
/// `tile` > 0: textura em coordenada de MUNDO, `tile` repetições por unidade
/// (ver `proc_textures.ts`); 0 = UV da malha. Precisa de runtime com `tile`
/// no `drawMesh` — um runtime antigo ignora o campo e estica a textura.
export function drawGPU(win: number, kind: number, px: number, py: number, pz: number,
                        rx: number, ry: number, sx: number, sy: number, sz: number, color: number,
                        emissive: number, tex: number, tileArg?: number): void {
  const tile: number = tileArg !== undefined ? tileArg : 0.0;
  const id = meshIdFor(kind);
  drawMesh(win, {
    mesh: id, x: px, y: py, z: pz, rx: rx, ry: ry,
    sx: sx, sy: sy, sz: sz, color: color, emissive: emissive, tex: tex, tile: tile,
  });
}
