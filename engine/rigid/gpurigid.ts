// ═══════════════════════════════════════════════════════════════════════════
// RÍGIDOS NA GPU — backend GPU da física de corpos rígidos (campanha
// "rígidos GPU-first", 2026-07-26; ver memória gpu-compute-fluido).
//
// A MESMA física do solver imediato da CPU (engine/core/scene.ts), no modelo
// GATHER de GPU: cada corpo i varre todos os j lendo o estado corrente e
// escreve SÓ o próprio — sem atomics, sem contenção. É o primo Jacobi do
// nosso solver: a CPU resolve pares em sequência (cada par duplicado é uma
// iteração grátis); aqui cada corpo aplica a própria METADE da correção de
// cada par, e os sub-passos fazem o papel das iterações.
//
// Regras portadas 1:1 do solvePair (as lições da campanha do castelo):
//   - eixo de MENOR penetração no box-box;
//   - corte de restituição (contato < 1 u/s não quica);
//   - slop 0.04 com correção de 85%;
//   - HERANÇA DE APOIO: contato vertical lento não gera impulso — o de cima
//     herda o vy do de baixo (mata o ciclo-limite de coluna);
//   - sleeping por velocidade (0.45 u/s por 10 passos), acordado por contato
//     forte ou por vizinho rápido;
//   - teto anti-tunneling de 48 u/s; estacionamento em y=-18.
//
// Estado (tudo na GPU; readback pipelined 1x/frame como o fluido):
//   pos: vec4 (xyz centro, w = contador de sono; w >= 10 dorme)
//   vel: vec4 (xyz, w livre)
//   ext: vec4 (xyz meia-extensão, w = invMass; 0 = infinita/kinemático)
//   world: [0] params (dt, nStaticos, -, -); depois AABBs estáticos (2 vec4)
// ═══════════════════════════════════════════════════════════════════════════
import gpu from "rts:gpu";
import buffer from "rts:buffer";

import { Scene } from "../core/scene";
import { GameObject, COL_BOX } from "../core/gameobject";
import { Transform } from "../core/transform";

export const RB_MAX_STATICS = 256;
export const RB_DT: f64 = 1.0 / 60.0;
const RB_SLEEP_FRAMES = "10.0";
const RB_SLEEP_SPEED2 = "0.2025";   // 0.45 u/s ao quadrado

let rbN = 0;
let rbPipe: i64 = 0;
let rbGPos: i64 = 0;
let rbGVel: i64 = 0;
let rbGExt: i64 = 0;
let rbGWorld: i64 = 0;
let rbPosBuf: i64 = 0;
let rbVelBuf: i64 = 0;
let rbExtBuf: i64 = 0;
let rbWorldBuf: i64 = 0;
let rbGroups = 0;
let rbStatics = 0;

export function rbAvailable(): number { return gpu.available(); }
export function rbCount(): number { return rbN; }
export function rbX(i: number): f64 { return buffer.read_f32(rbPosBuf, (i * 4) * 4); }
export function rbY(i: number): f64 { return buffer.read_f32(rbPosBuf, (i * 4 + 1) * 4); }
export function rbZ(i: number): f64 { return buffer.read_f32(rbPosBuf, (i * 4 + 2) * 4); }
/// Contador de sono (>= 10 = dormindo) — para telemetria/depuração.
export function rbSleep(i: number): f64 { return buffer.read_f32(rbPosBuf, (i * 4 + 3) * 4); }
export function rbVelX(i: number): f64 { return buffer.read_f32(rbVelBuf, (i * 4) * 4); }
export function rbVelY(i: number): f64 { return buffer.read_f32(rbVelBuf, (i * 4 + 1) * 4); }
export function rbVelZ(i: number): f64 { return buffer.read_f32(rbVelBuf, (i * 4 + 2) * 4); }
/// Id do buffer de posições (render instanciado futuro / inspeção).
export function rbPosBufferId(): i64 { return rbGPos; }

export function rbInit(n: number): number {
  if (gpu.available() === 0) return 0;
  rbN = n;
  rbGroups = ((n + 63) / 64) | 0;

  const src = `
@group(0) @binding(0) var<storage, read_write> pos: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> vel: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> ext: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> world: array<vec4<f32>>;

// penetração por eixo entre os AABBs (a, ha) e (b, hb); negativa = separados
fn pen(a: vec3<f32>, ha: vec3<f32>, b: vec3<f32>, hb: vec3<f32>) -> vec3<f32> {
  return (ha + hb) - abs(a - b);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&ext);
  if (id.x >= n) { return; }
  let dt = world[0].x;
  let m = u32(world[0].y);
  var p = pos[id.x].xyz;
  var slp = pos[id.x].w;
  var v = vel[id.x].xyz;
  let h = ext[id.x].xyz;
  let im = ext[id.x].w;

  // ── DORMINDO: só escaneia por um vizinho RÁPIDO encostando (senão sai) ───
  if (slp >= ${RB_SLEEP_FRAMES}) {
    var acordar = false;
    for (var j: u32 = 0u; j < n; j = j + 1u) {
      if (j == id.x) { continue; }
      let vj = vel[j].xyz;
      if (dot(vj, vj) > 0.64) {                  // vizinho a > 0.8 u/s
        let d = pen(p, h, pos[j].xyz, ext[j].xyz);
        if (d.x > 0.0 && d.y > 0.0 && d.z > 0.0) { acordar = true; break; }
      }
    }
    if (!acordar) { return; }
    slp = 0.0;
  }

  // ── INTEGRAÇÃO (passo fixo; teto anti-tunneling de 48 u/s) ───────────────
  v.y = v.y - 9.8 * dt;
  let sp2 = dot(v, v);
  if (sp2 > 2304.0) { v = v * (48.0 / sqrt(sp2)); }
  p = p + v * dt;

  // ── ESTÁTICOS (AABBs do world): expulsa pelo eixo mais raso, absorve ─────
  for (var k: u32 = 0u; k < m; k = k + 1u) {
    let sc = world[1u + k * 2u].xyz;
    let sh = world[2u + k * 2u].xyz;
    let d = pen(p, h, sc, sh);
    if (d.x > 0.0 && d.y > 0.0 && d.z > 0.0) {
      if (d.y <= d.x && d.y <= d.z) {
        let s = select(-1.0, 1.0, p.y >= sc.y);
        p.y = p.y + s * max(d.y - 0.04, 0.0) * 0.85;
        if (v.y * s < 0.0) { v.y = 0.0; }
        // atrito de chão: contato vertical freia o deslize
        v.x = v.x * 0.92; v.z = v.z * 0.92;
      } else if (d.x <= d.z) {
        let s = select(-1.0, 1.0, p.x >= sc.x);
        p.x = p.x + s * max(d.x - 0.04, 0.0) * 0.85;
        if (v.x * s < 0.0) { v.x = 0.0; }
      } else {
        let s = select(-1.0, 1.0, p.z >= sc.z);
        p.z = p.z + s * max(d.z - 0.04, 0.0) * 0.85;
        if (v.z * s < 0.0) { v.z = 0.0; }
      }
    }
  }

  // ── PARES DINÂMICOS (gather: eu aplico SÓ a minha metade) ────────────────
  for (var j: u32 = 0u; j < n; j = j + 1u) {
    if (j == id.x) { continue; }
    let pj = pos[j].xyz;
    let hj = ext[j].xyz;
    let d = pen(p, h, pj, hj);
    if (d.x <= 0.0 || d.y <= 0.0 || d.z <= 0.0) { continue; }
    let imj = ext[j].w;
    let share = im / max(im + imj, 0.0001);
    let vj = vel[j].xyz;
    // eixo de MENOR penetração (a lição: o eixo errado explode a pilha)
    if (d.y <= d.x && d.y <= d.z) {
      let s = select(-1.0, 1.0, p.y >= pj.y);
      let vn = (v.y - vj.y) * s;
      if (vn < -1.0) {
        // impacto de verdade: impulso normal (e=0 — pedra não quica)
        v.y = v.y - s * vn * share;
        slp = 0.0;
      } else if (vn < 0.5 && s > 0.5) {
        // HERANÇA DE APOIO: estou EM CIMA, descendo devagar — herdo o vy do
        // suporte (sem impulso: impulso aqui é o ciclo-limite de coluna)
        v.y = vj.y;
        // atrito de empilhamento
        v.x = v.x + (vj.x - v.x) * 0.10;
        v.z = v.z + (vj.z - v.z) * 0.10;
      }
      p.y = p.y + s * max(d.y - 0.04, 0.0) * 0.85 * share;
    } else if (d.x <= d.z) {
      let s = select(-1.0, 1.0, p.x >= pj.x);
      let vn = (v.x - vj.x) * s;
      if (vn < 0.0) { v.x = v.x - s * vn * share; if (vn < -1.0) { slp = 0.0; } }
      p.x = p.x + s * max(d.x - 0.04, 0.0) * 0.85 * share;
    } else {
      let s = select(-1.0, 1.0, p.z >= pj.z);
      let vn = (v.z - vj.z) * s;
      if (vn < 0.0) { v.z = v.z - s * vn * share; if (vn < -1.0) { slp = 0.0; } }
      p.z = p.z + s * max(d.z - 0.04, 0.0) * 0.85 * share;
    }
  }

  // quem caiu do mundo estaciona (mesma regra da demo do castelo)
  if (p.y < -18.0) { p = vec3<f32>(p.x, -18.0, p.z); v = vec3<f32>(0.0, 0.0, 0.0); }

  // ── SLEEPING por velocidade pós-resolução (a regra que funcionou) ────────
  if (dot(v, v) < ${RB_SLEEP_SPEED2}) { slp = slp + 1.0; } else { slp = 0.0; }

  pos[id.x] = vec4<f32>(p, slp);
  vel[id.x] = vec4<f32>(v, 0.0);
}
`;
  rbPipe = gpu.shader(src);
  if (rbPipe === 0) return 0;
  rbGPos = gpu.buffer(n * 16);
  rbGVel = gpu.buffer(n * 16);
  rbGExt = gpu.buffer(n * 16);
  rbGWorld = gpu.buffer((1 + RB_MAX_STATICS * 2) * 16);
  rbPosBuf = buffer.alloc(n * 16);
  rbVelBuf = buffer.alloc(n * 16);
  rbExtBuf = buffer.alloc(n * 16);
  rbWorldBuf = buffer.alloc((1 + RB_MAX_STATICS * 2) * 16);
  gpu.bind_buffer(rbPipe, 0, rbGPos);
  gpu.bind_buffer(rbPipe, 1, rbGVel);
  gpu.bind_buffer(rbPipe, 2, rbGExt);
  gpu.bind_buffer(rbPipe, 3, rbGWorld);
  return 1;
}

/// Define o estado de um corpo nos espelhos (spawn/handoff). `mass<=0` = 1.
export function rbSetBody(i: number, x: f64, y: f64, z: f64,
                          hx: f64, hy: f64, hz: f64, mass: f64): void {
  buffer.write_f32(rbPosBuf, (i * 4) * 4, x);
  buffer.write_f32(rbPosBuf, (i * 4 + 1) * 4, y);
  buffer.write_f32(rbPosBuf, (i * 4 + 2) * 4, z);
  buffer.write_f32(rbPosBuf, (i * 4 + 3) * 4, 0.0);
  buffer.write_f32(rbVelBuf, (i * 4) * 4, 0.0);
  buffer.write_f32(rbVelBuf, (i * 4 + 1) * 4, 0.0);
  buffer.write_f32(rbVelBuf, (i * 4 + 2) * 4, 0.0);
  buffer.write_f32(rbVelBuf, (i * 4 + 3) * 4, 0.0);
  buffer.write_f32(rbExtBuf, (i * 4) * 4, hx);
  buffer.write_f32(rbExtBuf, (i * 4 + 1) * 4, hy);
  buffer.write_f32(rbExtBuf, (i * 4 + 2) * 4, hz);
  buffer.write_f32(rbExtBuf, (i * 4 + 3) * 4, mass > 0.0 ? 1.0 / mass : 1.0);
}

/// Escreve velocidade (disparos/handoff) e ACORDA o corpo.
export function rbSetVel(i: number, vx: f64, vy: f64, vz: f64): void {
  buffer.write_f32(rbVelBuf, (i * 4) * 4, vx);
  buffer.write_f32(rbVelBuf, (i * 4 + 1) * 4, vy);
  buffer.write_f32(rbVelBuf, (i * 4 + 2) * 4, vz);
  buffer.write_f32(rbPosBuf, (i * 4 + 3) * 4, 0.0);
}

/// Sobe TODO o estado dos espelhos para a GPU (chamar após spawn/handoff).
export function rbUpload(): void {
  if (rbPipe === 0) return;
  gpu.write(rbGPos, rbPosBuf, rbN * 16);
  gpu.write(rbGVel, rbVelBuf, rbN * 16);
  gpu.write(rbGExt, rbExtBuf, rbN * 16);
}

/// Envia os ESTÁTICOS da cena (colShape BOX + stationary) para o kernel.
export function rbSyncStatics(sc: Scene): void {
  if (rbPipe === 0) return;
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const n = objs.length;
  let m = 0;
  let i = 0;
  while (i < n && m < RB_MAX_STATICS) {
    const o: GameObject = objs[i];
    if (o.colShape === COL_BOX && o.active !== 0 && o.stationary !== 0) {
      const t: Transform = trs[i];
      const base = 4 + m * 8;
      buffer.write_f32(rbWorldBuf, (base) * 4, t.wx);
      buffer.write_f32(rbWorldBuf, (base + 1) * 4, t.wy);
      buffer.write_f32(rbWorldBuf, (base + 2) * 4, t.wz);
      buffer.write_f32(rbWorldBuf, (base + 3) * 4, 0.0);
      buffer.write_f32(rbWorldBuf, (base + 4) * 4, t.sx * 0.5);
      buffer.write_f32(rbWorldBuf, (base + 5) * 4, t.sy * 0.5);
      buffer.write_f32(rbWorldBuf, (base + 6) * 4, t.sz * 0.5);
      buffer.write_f32(rbWorldBuf, (base + 7) * 4, 0.0);
      m = m + 1;
    }
    i = i + 1;
  }
  rbStatics = m;
  buffer.write_f32(rbWorldBuf, 0, RB_DT);
  buffer.write_f32(rbWorldBuf, 4, m * 1.0);
  gpu.write(rbGWorld, rbWorldBuf, (1 + m * 2) * 16);
}

/// Um frame: LÊ o resultado do frame anterior (pipelined) e submete
/// `substeps` passos novos sem esperar — o mesmo relógio próprio do fluido.
export function rbStep(substeps: number): void {
  if (rbPipe === 0) return;
  gpu.read(rbGPos, rbPosBuf, rbN * 16);
  let s = 0;
  while (s < substeps) {
    gpu.dispatch(rbPipe, rbGroups, 1, 1);
    s = s + 1;
  }
}

/// Sincroniza TAMBÉM as velocidades (handoff GPU->CPU; posições já vêm no step).
export function rbReadState(): void {
  if (rbPipe === 0) return;
  gpu.read(rbGPos, rbPosBuf, rbN * 16);
  gpu.read(rbGVel, rbVelBuf, rbN * 16);
}
