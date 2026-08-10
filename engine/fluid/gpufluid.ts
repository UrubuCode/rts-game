// ═══════════════════════════════════════════════════════════════════════════
// FLUIDO NA GPU — módulo do motor (SPH em WGSL via rts:gpu).
//
// A física inteira (densidade, pressão, viscosidade, integração e COLISÃO com
// o mundo) roda na GPU; o TS sobe o estado uma vez, sincroniza os colisores da
// cena quando ela muda e lê só as posições de volta, uma vez por frame.
//
// COLISÃO COM O MUNDO: os mesmos colisores do solver CPU (`GameObject.colShape
// === COL_BOX`, meia-extensão = t.sx*0.5, posição mundial wx/wy/wz) são
// enviados como AABBs para o kernel — a água escorre pelos MESMOS blocos que
// os corpos rígidos empilham. Fronteira assimétrica de propósito: o mundo
// empurra a água; a água (por enquanto) não empurra o mundo.
//
// RELÓGIO PRÓPRIO (estilo FixedUpdate): `gfStep` primeiro LÊ o resultado do
// frame anterior (a GPU teve o frame inteiro para terminar — a leitura é quase
// grátis) e depois SUBMETE os sub-passos deste frame sem esperar. 1 frame de
// latência; o jogo nunca trava esperando a física.
//
// Lições do fluido CPU (scripts/fluid.ts) carregadas para cá:
//   - sub-passo FIXO (dt real de um frame lento vira explosão);
//   - pressão SIMÉTRICA (assimetria cria energia do nada);
//   - REST calibrada na grade do spawn (rest errada = atração ou explosão);
//   - paredes ABSORVEM (refletir devolve energia e o líquido nunca assenta);
//   - near-pressure de Clavet (só pressão deixa partícula entrar em partícula).
//
// Sem GPU (`gfAvailable() === 0`) nada aqui pode ser usado — o jogo decide o
// fallback (fluido CPU ou nada). Nenhuma função quebra: viram no-op.
// ═══════════════════════════════════════════════════════════════════════════
import gpu from "rts:gpu";
import buffer from "../../compat/buffer.ts";

import { Scene } from "../core/scene";
import { GameObject, COL_BOX } from "../core/gameobject";
import { Transform } from "../core/transform";

/// Máximo de AABBs enviados ao kernel (12 KB de buffer; a fortaleza usa ~400).
export const GF_MAX_COLLIDERS = 768;
/// GRID espacial: célula = H; 8192 buckets (hash), 32 vagas por bucket.
/// Colisão de hash só gera candidato extra (o teste de r² filtra).
const GF_NCELLS = 8192;
const GF_SLOT = 32;
/// Base (em vec4) da região de IMPULSOS na cauda do buffer WORLD:
/// [0] params, [1 .. 1+768*2) estáticos, [IMP_BASE .. IMP_BASE+768) impulsos.
const GF_IMP_BASE = 1537;
const GF_WORLD_VEC4 = 1537 + 768;
/// Raio de kernel SPH. As demais constantes derivam dele nos shaders.
const GF_H = "0.45";
/// Sub-passo fixo da física (lição do CPU: NUNCA integrar com dt real).
export const GF_DT: f64 = 1.0 / 240.0;
/// "Caroço duro" da partícula na colisão com o mundo.
const GF_RADIUS: f64 = 0.16;

// A DENSIDADE vive no `w` do vec4 de posição — não num buffer próprio. Não é
// estética: com uma JANELA aberta o device nasce com limites downlevel (máx. 4
// storage buffers por estágio) e o kernel de força precisa de pos+vel+params+
// cols. O quinto buffer não cabe; o w da posição estava sobrando.
let gfN = 0;
let gfPipeDens: i64 = 0;
let gfPipeForce: i64 = 0;
let gfGPos: i64 = 0;
let gfGVel: i64 = 0;
let gfGWorld: i64 = 0;    // params + colisores + IMPULSOS (limite de 4 buffers)
let gfGGrid: i64 = 0;     // grid espacial: [0..NC) contagens, depois as vagas
let gfPipeGrid: i64 = 0;
let gfPosBuf: i64 = 0;      // espelho CPU das posições (leitura pós-readback)
let gfVelBuf: i64 = 0;
let gfWorldBuf: i64 = 0;
let gfGridZero: i64 = 0;  // zeros p/ limpar as CONTAGENS do grid por sub-passo
/// indice de cena de cada colisor k (para aplicar o impulso de volta)
const gfColScene: number[] = [];
let gfGroups = 0;
let gfRest: f64 = 0.0;
let gfColCount = 0;

export function gfAvailable(): number { return gpu.available(); }

/// Posição da partícula `i` (válida após um `gfStep`).
export function gfX(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4) * 4); }
export function gfY(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4 + 1) * 4); }
export function gfZ(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4 + 2) * 4); }
export function gfCount(): number { return gfN; }
/// Id do buffer de POSIÇÕES na GPU (vec4: xyz + densidade assinada) — para o
/// render instanciado (`drawWaterGPU`) desenhar direto, sem readback.
export function gfPosBufferId(): i64 { return gfGPos; }
/// `w` ASSINADO da partícula `i`: |w| = densidade; w < 0 = CERCADA nas 6
/// direções (invisível de qualquer ângulo — o render pode cortar com
/// segurança; ver o kernel de densidade).
export function gfDens(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4 + 3) * 4); }
/// 1 se a partícula está cercada (pode ser cortada do desenho em QUALQUER
/// ângulo de câmera); 0 se faz parte da casca visível.
export function gfHidden(i: number): number {
  return buffer.read_f32(gfPosBuf, (i * 4 + 3) * 4) < 0.0 ? 1 : 0;
}
/// Densidade de repouso calibrada no spawn (referência para o corte de casca).
export function gfRestDensity(): f64 { return gfRest; }

/// Cria os pipelines e buffers para `n` partículas. 1 ok, 0 sem GPU/erro.
export function gfInit(n: number): number {
  if (gpu.available() === 0) return 0;
  gfN = n;
  gfGroups = ((n + 63) / 64) | 0;

  // hash 3D compartilhado (o mesmo do buildSceneGrid da CPU)
  const hashFn = `
fn cellHash(gx: i32, gy: i32, gz: i32) -> u32 {
  return u32((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & 8191u;
}
`;
  // CONSTRUCAO do grid: os UNICOS atomics do fluido, isolados neste kernel
  // minusculo (licao medida: atomic no kernel quente pessimiza o pass inteiro
  // no DX12 — +33 ms/frame). Contagens em [0..NC); vagas em [NC + c*SLOT ...).
  const gridSrc = `
@group(0) @binding(0) var<storage, read> pos: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> grid: array<atomic<i32>>;
${hashFn}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&pos);
  if (id.x >= n) { return; }
  let p = pos[id.x].xyz;
  let c = cellHash(i32(floor(p.x / ${GF_H})), i32(floor(p.y / ${GF_H})), i32(floor(p.z / ${GF_H})));
  let s = atomicAdd(&grid[c], 1);
  if (s < 32) { atomicStore(&grid[8192u + c * 32u + u32(s)], i32(id.x)); }
}
`;
  gfPipeGrid = gpu.shader(gridSrc);
  if (gfPipeGrid === 0) return 0;

  const densSrc = `
@group(0) @binding(0) var<storage, read_write> pos: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> grid: array<i32>;
${hashFn}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&pos);
  if (id.x >= n) { return; }
  let h = ${GF_H};
  let h2 = h * h;
  let p = pos[id.x].xyz;
  var d: f32 = 0.0;
  var cover: u32 = 0u;
  let bx0 = i32(floor(p.x / h));
  let by0 = i32(floor(p.y / h));
  let bz0 = i32(floor(p.z / h));
  // 27 celulas vizinhas via grid: O(N*vizinhos) — era O(N^2) (~17 ms/frame)
  for (var cz: i32 = -1; cz <= 1; cz = cz + 1) {
  for (var cy: i32 = -1; cy <= 1; cy = cy + 1) {
  for (var cx: i32 = -1; cx <= 1; cx = cx + 1) {
    let cell = cellHash(bx0 + cx, by0 + cy, bz0 + cz);
    let cnt = u32(clamp(grid[cell], 0, 32));
    for (var s: u32 = 0u; s < cnt; s = s + 1u) {
      let j = u32(grid[8192u + cell * 32u + s]);
      let dv = p - pos[j].xyz;
      let r2 = dot(dv, dv);
      if (r2 < h2) { let w = h2 - r2; d = d + w * w * w; }
      // COBERTURA por 8 octantes SOLIDOS (sinal do w = cercada) — ver testes
      if (j != id.x && r2 < 0.3025) {
        let nb = pos[j].xyz - p;
        if (abs(nb.x) > 0.13 && abs(nb.y) > 0.13 && abs(nb.z) > 0.13) {
          let obx = select(0u, 1u, nb.x > 0.0);
          let oby = select(0u, 1u, nb.y > 0.0);
          let obz = select(0u, 1u, nb.z > 0.0);
          cover = cover | (1u << (obx | (oby << 1u) | (obz << 2u)));
        }
      }
    }
  }}}
  let cercada = cover == 255u;
  pos[id.x].w = select(d, -d, cercada);
}
`;
  // params: [0]=dt [1]=rest [2]=colCount [3]=raio da particula
  // cols:  pares de vec4 — [k*2]=centro, [k*2+1]=meia-extensao
  const forceSrc = `
@group(0) @binding(0) var<storage, read_write> pos: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> vel: array<vec4<f32>>;
// WORLD (read_write): [0] params (dt, rest, colCount, raio); [1..1537)
// estaticos (centro, meia-ext); [1537..2305) IMPULSOS por colisor (vec4:
// soma dos delta-v + contagem, f32 com corrida — agregado tolera; atomics
// aqui custavam +33 ms no pass inteiro).
@group(0) @binding(2) var<storage, read_write> world: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> grid: array<i32>;
${hashFn}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&pos);
  if (id.x >= n) { return; }
  let h = ${GF_H};
  let h2 = h * h;
  let dt = world[0].x;
  let rest = world[0].y;
  let stiff = 90.0;
  let visc = 4.0;
  let hHalf = h * 0.55;
  let p = pos[id.x].xyz;
  let v = vel[id.x].xyz;
  let wi = pos[id.x].w;      // w ASSINADO (sinal = cercada; ver kernel de densidade)
  let di = abs(wi);
  let pi = stiff * max(di - rest, 0.0);
  var f = vec3<f32>(0.0, -9.8, 0.0);
  let bx0 = i32(floor(p.x / h));
  let by0 = i32(floor(p.y / h));
  let bz0 = i32(floor(p.z / h));
  for (var cz: i32 = -1; cz <= 1; cz = cz + 1) {
  for (var cy: i32 = -1; cy <= 1; cy = cy + 1) {
  for (var cx: i32 = -1; cx <= 1; cx = cx + 1) {
    let cell = cellHash(bx0 + cx, by0 + cy, bz0 + cz);
    let cnt = u32(clamp(grid[cell], 0, 32));
    for (var sl: u32 = 0u; sl < cnt; sl = sl + 1u) {
    let j = u32(grid[8192u + cell * 32u + sl]);
    if (j == id.x) { continue; }
    let dv = p - pos[j].xyz;
    let r2 = dot(dv, dv);
    if (r2 < h2 && r2 > 0.000001) {
      let r = sqrt(r2);
      let dj = max(abs(pos[j].w), 0.0001);
      let pj = stiff * max(dj - rest, 0.0);
      // pressao SIMETRICA + viscosidade (mesmas equacoes do fluido CPU)
      let push = (pi + pj) * 0.5 * (h - r) * (h - r) / dj;
      f = f + dv * (push / r);
      f = f + (vel[j].xyz - v) * (visc * (h - r) / dj);
      // near-pressure (Clavet): o carogo duro entre particulas
      if (r < hHalf) {
        let q = 1.0 - r / hHalf;
        f = f + dv * (55.0 * q * q / r);
      }
    }
    }
  }}}
  var nv = v + f * dt;
  let sp = length(nv);
  if (sp > 14.0) { nv = nv * (14.0 / sp); }
  var np = p + nv * dt;
  // ── COLISAO COM O MUNDO: os AABBs da cena (mesma semantica do solver CPU) ──
  let m = u32(world[0].z);
  let pr = world[0].w;
  for (var k: u32 = 0u; k < m; k = k + 1u) {
    let cc = world[1u + k * 2u].xyz;
    let hh = world[2u + k * 2u].xyz;
    let cp = clamp(np, cc - hh, cc + hh);
    let dc = np - cp;
    let d2 = dot(dc, dc);
    if (d2 < pr * pr) {
      if (d2 > 0.000001) {
        // fora da caixa mas encostando: empurra pela normal do ponto mais proximo
        let d = sqrt(d2);
        let nrm = dc / d;
        np = cp + nrm * pr;
        let vn = dot(nv, nrm);
        // absorve (reflete so 20%): parede que devolve energia nunca assenta
        if (vn < 0.0) {
          let dvv = nrm * (vn * 1.2);
          nv = nv - dvv;
          // ACAO E REACAO — SO colisor DINAMICO e SO IMPACTO DE VERDADE
          // (|dvv| > 0.2; contato de repouso tem dv ~ g*dt = 0.05 e NAO
          // transfere momento util). Sem o corte, agua assentada contra a
          // muralha fazia atomicAdd em massa nos mesmos enderecos e a fila da
          // GPU crescia sem teto (medido: 20 -> 45 ms/frame).
          // impulso agregado na CAUDA do world (f32 com corrida; so colisor
          // DINAMICO e so impacto real — ver historico no git)
          if (world[2u + k * 2u].w > 0.5 && dot(dvv, dvv) > 0.04) {
            world[1537u + k] = world[1537u + k] + vec4<f32>(dvv, 1.0);
          }
        }
      } else {
        // centro DENTRO da caixa: sai pela face mais rasa
        let q = (hh + vec3<f32>(pr, pr, pr)) - abs(np - cc);
        if (q.x < q.y && q.x < q.z) {
          let sx = select(-1.0, 1.0, np.x >= cc.x);
          np.x = cc.x + sx * (hh.x + pr); nv.x = nv.x * -0.2;
        } else if (q.y < q.z) {
          let sy = select(-1.0, 1.0, np.y >= cc.y);
          np.y = cc.y + sy * (hh.y + pr); nv.y = nv.y * -0.2;
        } else {
          let sz = select(-1.0, 1.0, np.z >= cc.z);
          np.z = cc.z + sz * (hh.z + pr); nv.z = nv.z * -0.2;
        }
      }
    }
  }
  // rede de seguranca: nada cai do mundo
  if (np.y < -20.0) { np.y = -20.0; nv.y = 0.0; }
  pos[id.x] = vec4<f32>(np, wi);   // preserva o SINAL (veredito de cobertura)
  vel[id.x] = vec4<f32>(nv, 0.0);
}
`;
  gfPipeDens = gpu.shader(densSrc);
  gfPipeForce = gpu.shader(forceSrc);
  if (gfPipeDens === 0 || gfPipeForce === 0) return 0;

  gfGPos = gpu.buffer(n * 4 * 4);
  gfGVel = gpu.buffer(n * 4 * 4);
  gfGWorld = gpu.buffer(GF_WORLD_VEC4 * 16);
  gfGGrid = gpu.buffer((GF_NCELLS + GF_NCELLS * GF_SLOT) * 4);
  gfPosBuf = buffer.alloc(n * 4 * 4);
  gfVelBuf = buffer.alloc(n * 4 * 4);
  gfWorldBuf = buffer.alloc(GF_WORLD_VEC4 * 16);
  let z = 0;
  while (z < GF_WORLD_VEC4 * 4) { buffer.write_f32(gfWorldBuf, z * 4, 0.0); z = z + 1; }
  gfGridZero = buffer.alloc(GF_NCELLS * 4);
  z = 0;
  while (z < GF_NCELLS) { buffer.write_i32(gfGridZero, z * 4, 0); z = z + 1; }

  gpu.bind_buffer(gfPipeGrid, 0, gfGPos);
  gpu.bind_buffer(gfPipeGrid, 1, gfGGrid);
  gpu.bind_buffer(gfPipeDens, 0, gfGPos);
  gpu.bind_buffer(gfPipeDens, 1, gfGGrid);
  gpu.bind_buffer(gfPipeForce, 0, gfGPos);
  gpu.bind_buffer(gfPipeForce, 1, gfGVel);
  gpu.bind_buffer(gfPipeForce, 2, gfGWorld);
  gpu.bind_buffer(gfPipeForce, 3, gfGGrid);
  return 1;
}

/// Preenche um bloco de `cols × rows × layers` a partir de (x0,y0,z0), sobe o
/// estado e CALIBRA a densidade de repouso na própria grade (lição do CPU).
export function gfSpawnBlock(cols: number, rows: number, layers: number,
                             x0: f64, y0: f64, z0: f64, spacing: f64): void {
  if (gfPipeDens === 0) return;
  let i = 0;
  let c = 0;
  while (c < cols) {
    let r = 0;
    while (r < rows) {
      let l = 0;
      while (l < layers) {
        if (i < gfN) {
          buffer.write_f32(gfPosBuf, (i * 4) * 4, x0 + c * spacing);
          buffer.write_f32(gfPosBuf, (i * 4 + 1) * 4, y0 + r * spacing);
          buffer.write_f32(gfPosBuf, (i * 4 + 2) * 4, z0 + l * spacing);
          buffer.write_f32(gfPosBuf, (i * 4 + 3) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4 + 1) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4 + 2) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4 + 3) * 4, 0.0);
        }
        i = i + 1;
        l = l + 1;
      }
      r = r + 1;
    }
    c = c + 1;
  }
  gpu.write(gfGPos, gfPosBuf, gfN * 4 * 4);
  gpu.write(gfGVel, gfVelBuf, gfN * 4 * 4);

  // REST = 85% da densidade média da grade inicial (1 passe + readback, 1x)
  if (gfRest === 0.0) {
    gpu.dispatch(gfPipeDens, gfGroups, 1, 1);
    gpu.read(gfGPos, gfPosBuf, gfN * 4 * 4);
    let acc: f64 = 0.0;
    let k = 0;
    while (k < gfN) {
      let d: f64 = buffer.read_f32(gfPosBuf, (k * 4 + 3) * 4);
      if (d < 0.0) d = 0.0 - d;      // w assinado: |w| e a densidade
      acc = acc + d;
      k = k + 1;
    }
    gfRest = (acc / gfN) * 0.85;
  }
  buffer.write_f32(gfWorldBuf, 0, GF_DT);
  buffer.write_f32(gfWorldBuf, 4, gfRest);
  buffer.write_f32(gfWorldBuf, 8, gfColCount * 1.0);
  buffer.write_f32(gfWorldBuf, 12, GF_RADIUS);
  gpu.write(gfGWorld, gfWorldBuf, 16);
}

/// Envia os colisores BOX da cena para o kernel (mesma semântica do solver
/// CPU: meia-extensão = sx*0.5, posição mundial). Chamar após `computeWorld`
/// quando a cena muda — com tudo dormindo não precisa reenviar.
export function gfSyncColliders(sc: Scene): void {
  if (gfPipeForce === 0) return;
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const n = objs.length;
  gfColScene.length = 0;
  let m = 0;
  let i = 0;
  while (i < n && m < GF_MAX_COLLIDERS) {
    const o: GameObject = objs[i];
    if (o.colShape === COL_BOX && o.active !== 0) {
      const t: Transform = trs[i];
      const base = 4 + m * 8;             // [0..4) e o header de params
      buffer.write_f32(gfWorldBuf, (base) * 4, t.wx);
      buffer.write_f32(gfWorldBuf, (base + 1) * 4, t.wy);
      buffer.write_f32(gfWorldBuf, (base + 2) * 4, t.wz);
      buffer.write_f32(gfWorldBuf, (base + 3) * 4, 0.0);
      buffer.write_f32(gfWorldBuf, (base + 4) * 4, t.sx * 0.5);
      buffer.write_f32(gfWorldBuf, (base + 5) * 4, t.sy * 0.5);
      buffer.write_f32(gfWorldBuf, (base + 6) * 4, t.sz * 0.5);
      // w da meia-extensao = flag DINAMICO (1 recebe impulso da agua; estatico
      // nao acumula — evita a contencao de atomics no chao)
      buffer.write_f32(gfWorldBuf, (base + 7) * 4, o.stationary === 0 ? 1.0 : 0.0);
      gfColScene.push(i);
      m = m + 1;
    }
    i = i + 1;
  }
  gfColCount = m;
  buffer.write_f32(gfWorldBuf, 8, m * 1.0);
  gpu.write(gfGWorld, gfWorldBuf, (1 + m * 2) * 16);
}

/// AGUA EMPURRA O MUNDO (fronteira nivel 2): le os impulsos agregados que o
/// kernel acumulou por colisor e aplica como delta de velocidade nos blocos
/// NAO-estaticos (que acordam pelo caminho normal do solver). `strength` faz o
/// papel da massa da particula: dv_bloco = -impulso * strength / massa_bloco.
/// Chamar 1x por frame, DEPOIS de gfStep. Zera o acumulador na GPU.
let gfImpRead: i64 = 0;   // espelho da leitura do world (cauda de impulsos)

export function gfApplyWaterForces(sc: Scene, strength: f64): void {
  if (gfPipeForce === 0 || gfColCount === 0) return;
  if (gfImpRead === 0) gfImpRead = buffer.alloc(GF_WORLD_VEC4 * 16);
  gpu.read(gfGWorld, gfImpRead, (GF_IMP_BASE + gfColCount) * 16);
  // zera a cauda reescrevendo o world do espelho (cauda do espelho é 0 sempre)
  gpu.write(gfGWorld, gfWorldBuf, GF_WORLD_VEC4 * 16);
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  let k = 0;
  while (k < gfColCount) {
    const base = (GF_IMP_BASE + k) * 4;
    const cnt = buffer.read_f32(gfImpRead, (base + 3) * 4);
    if (cnt > 0.5) {
      const o: GameObject = objs[gfColScene[k]];
      if (o.stationary === 0) {
        const t: Transform = trs[gfColScene[k]];
        let mass: f64 = t.mass;
        if (mass < 0.1) mass = 0.1;
        const f: f64 = strength / mass;
        // o kernel soma dvv; a PARTICULA recebe -dvv, o bloco recebe +dvv.
        // ZONA MORTA (0.06 u/s): agua encostada nao acorda bloco p/ sempre.
        const dvx: f64 = buffer.read_f32(gfImpRead, (base) * 4) * f;
        const dvy: f64 = buffer.read_f32(gfImpRead, (base + 1) * 4) * f;
        const dvz: f64 = buffer.read_f32(gfImpRead, (base + 2) * 4) * f;
        if (dvx * dvx + dvy * dvy + dvz * dvz > 0.0036) {
          t.vx = t.vx + dvx;
          t.vy = t.vy + dvy;
          t.vz = t.vz + dvz;
          t.asleep = 0;
          t.quiet = 0;
        }
      }
    }
    k = k + 1;
  }
}

// ── HANDOFF (fachada engine/fluid/fluid.ts): ler/escrever o estado completo —
// é o que permite TROCAR de backend em pleno voo sem a água teleportar.

/// Sincroniza os DOIS espelhos CPU (posição E velocidade) com a GPU agora.
export function gfReadState(): void {
  if (gfPipeForce === 0) return;
  gpu.read(gfGPos, gfPosBuf, gfN * 4 * 4);
  gpu.read(gfGVel, gfVelBuf, gfN * 4 * 4);
}
export function gfVelX(i: number): f64 { return buffer.read_f32(gfVelBuf, (i * 4) * 4); }
export function gfVelY(i: number): f64 { return buffer.read_f32(gfVelBuf, (i * 4 + 1) * 4); }
export function gfVelZ(i: number): f64 { return buffer.read_f32(gfVelBuf, (i * 4 + 2) * 4); }

/// Escreve o estado de uma partícula nos espelhos (chamar `gfUploadState` ao
/// final para efetivar na GPU).
export function gfSetState(i: number, x: f64, y: f64, z: f64,
                           vx: f64, vy: f64, vz: f64): void {
  buffer.write_f32(gfPosBuf, (i * 4) * 4, x);
  buffer.write_f32(gfPosBuf, (i * 4 + 1) * 4, y);
  buffer.write_f32(gfPosBuf, (i * 4 + 2) * 4, z);
  buffer.write_f32(gfPosBuf, (i * 4 + 3) * 4, 0.0);
  buffer.write_f32(gfVelBuf, (i * 4) * 4, vx);
  buffer.write_f32(gfVelBuf, (i * 4 + 1) * 4, vy);
  buffer.write_f32(gfVelBuf, (i * 4 + 2) * 4, vz);
  buffer.write_f32(gfVelBuf, (i * 4 + 3) * 4, 0.0);
}
export function gfUploadState(): void {
  if (gfPipeForce === 0) return;
  gpu.write(gfGPos, gfPosBuf, gfN * 4 * 4);
  gpu.write(gfGVel, gfVelBuf, gfN * 4 * 4);
}
/// Fixa a densidade de repouso vinda do OUTRO backend (handoff) — sem isso a
/// água recalibraria num estado comprimido e mudaria de comportamento.
export function gfSetRest(v: f64): void {
  gfRest = v;
  buffer.write_f32(gfWorldBuf, 4, v);
  gpu.write(gfGWorld, gfWorldBuf, 16);
}

/// Um frame de física: LÊ o resultado do frame anterior (pipelining — a GPU já
/// terminou) e submete `substeps` sub-passos novos sem esperar.
export function gfStep(substeps: number): void {
  gfPull();
  gfKick(substeps);
}
let gfTicket: i64 = 0;

/// FÍSICA COMO SERVIÇO (assíncrona; ver rbService): aplica quando chega,
/// nunca espera. 1 = espelhos com estado novo neste frame.
export function gfService(substeps: number): number {
  if (gfPipeForce === 0) return 0;
  if (gfTicket === 0) {
    gfKick(substeps);
    gfTicket = gpu.read_begin(gfGPos, gfN * 4 * 4);
    return 0;
  }
  const got = gpu.read_poll(gfTicket, gfPosBuf);
  if (got === 0) return 0;
  gfTicket = 0;
  if (got < 0) return 0;
  gfKick(substeps);
  gfTicket = gpu.read_begin(gfGPos, gfN * 4 * 4);
  return 1;
}

/// PULL: só o readback (encostar no único ponto de espera do frame).
export function gfPull(): void {
  if (gfPipeForce === 0) return;
  gpu.read(gfGPos, gfPosBuf, gfN * 4 * 4);
}
/// KICK: só os dispatches (zero espera). Cada sub-passo reconstrói o grid
/// (limpa as contagens + kernel de build) antes de densidade/força.
export function gfKick(substeps: number): void {
  if (gfPipeForce === 0) return;
  let s = 0;
  while (s < substeps) {
    gpu.write(gfGGrid, gfGridZero, GF_NCELLS * 4);
    gpu.dispatch(gfPipeGrid, gfGroups, 1, 1);
    gpu.dispatch(gfPipeDens, gfGroups, 1, 1);
    gpu.dispatch(gfPipeForce, gfGroups, 1, 1);
    s = s + 1;
  }
}
