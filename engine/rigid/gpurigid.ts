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
//   vel: vec4 (xyz, w = FORMA do colisor — 0 esfera, 1 caixa)
//   ext: vec4 (xyz meia-extensão, w = invMass; 0 = infinita/kinemático)
//   world: [0] params (dt, nStaticos, tamCélula, -); estáticos; grid na cauda
//
// ── A FORMA MORA NO `vel.w`, e por quê ──────────────────────────────────────
//
// Este cabeçalho declarava aquele campo "livre", e ele era o único que estava.
// Os outros candidatos foram descartados por motivo, não por gosto:
//
//   pos.w — já é o contador de sono, que é ESTADO evoluindo a cada passo.
//   ext.w — é o invMass. Daria para embutir a forma no SINAL dele, que hoje é
//           sempre positivo, e funcionaria; mas faria um campo significar duas
//           coisas por um truque que só o autor enxerga, e no dia em que alguém
//           escrever invMass 0 para um cinemático a forma fica indefinida.
//   buffer novo — esbarra no teto de 4 storage buffers por estágio que o device
//           ganha com uma JANELA aberta (a mesma razão que pôs o grid na cauda
//           do `world`). O kernel já liga os quatro.
//
// Um campo livre resolvia, então nenhum buffer foi inventado. O kernel preserva
// `vel.w` na escrita final — era ali que ele escrevia um 0 constante.
//
// O RAIO de uma esfera é `min(ext.xyz)`, a mesma regra do `radiusOf` da CPU
// (metade da MENOR escala): a esfera cabe dentro da caixa, então nunca há
// empurrão fantasma. Está calculado no kernel a partir de `ext` para que não
// exista um segundo lugar onde o raio possa divergir.
// ═══════════════════════════════════════════════════════════════════════════
import gpu from "../../compat/gpu.ts";
import buffer from "../../compat/buffer.ts";

import { Scene } from "../core/scene";
import { GameObject, COL_BOX } from "../core/gameobject";
import { Transform } from "../core/transform";

export const RB_MAX_STATICS = 256;
export const RB_DT: f64 = 1.0 / 60.0;
const RB_SLEEP_FRAMES = "10.0";
const RB_SLEEP_SPEED2 = "0.2025";   // 0.45 u/s ao quadrado

// ── GRID ESPACIAL (a mesma estrutura do gfPipeGrid do fluido) ───────────────
//
// 8192 buckets por hash 3D, 32 vagas por bucket, contagens antes das vagas, e
// os atomics ISOLADOS num kernel minúsculo — a lição medida que o fluido deixa
// escrita em `gpufluid.ts:109`: atomic dentro do kernel quente pessimiza o pass
// inteiro no DX12 (+33 ms/frame lá). Mesmo `cellHash` e mesmos números de
// propósito: duas respostas diferentes para "vizinhança na GPU" neste projeto
// seriam piores que o O(n²) que isto remove.
const RB_NCELLS_N = 8192;
const RB_SLOT_N = 32;

// ONDE o grid mora: na CAUDA do buffer `world`, e não num buffer próprio.
//
// Não é economia de memória — é o limite de 4 storage buffers por estágio que o
// device ganha quando há uma JANELA aberta, documentado em `gpufluid.ts:53`. O
// kernel de colisão já liga quatro (pos, vel, ext, world); um quinto compilaria
// headless e falharia no jogo, que é o pior lugar para descobrir isso. O fluido
// resolveu o mesmo aperto enfiando a densidade no `w` da posição e os impulsos
// na cauda do `world`; aqui a cauda do `world` recebe o grid.
//
// O `world` é `vec4<f32>` para quem colide e `atomic<i32>` para quem constrói —
// o tipo é por PIPELINE, o buffer é o mesmo. Por isso o lado que lê faz
// `bitcast`: os bits guardados ali são de i32.
//
//   [0]           params: dt, nEstaticos, tamanhoDaCélula, -
//   [1 .. 513)    estáticos (centro, meia-extensão)
//   513*4 = 2052  ← daqui, em i32: 8192 contagens, depois 8192*32 vagas
const RB_GRID_I32_N = 2052;
const RB_WORLD_BYTES = (RB_GRID_I32_N + RB_NCELLS_N + RB_NCELLS_N * RB_SLOT_N) * 4;
// Grupos do kernel que zera as contagens (uma thread por bucket).
const RB_CLEAR_GROUPS = RB_NCELLS_N / 64;

let rbN = 0;
let rbPipe: i64 = 0;
let rbPipeGrid: i64 = 0;    // constrói o grid — os ÚNICOS atomics daqui
let rbPipeClear: i64 = 0;   // zera as contagens entre sub-passos
// Meia-extensão MÁXIMA vista: é ela que dimensiona a célula (ver rbWriteWorld).
let rbMaxHalf: f64 = 0.0;
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

  // O MESMO hash 3D do fluido (gpufluid.ts:105) e do buildSceneGrid da CPU.
  const hashFn = `
fn cellHash(gx: i32, gy: i32, gz: i32) -> u32 {
  return u32((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & 8191u;
}
`;

  // CONSTRUÇÃO do grid: um corpo, um bucket. Note que quem indexa é o CENTRO —
  // um corpo cabe em mais de uma célula, e o que garante que o par não escapa é
  // a célula ser >= o maior DIÂMETRO (ver rbWriteWorld), não o corpo caber nela.
  const gridSrc = `
@group(0) @binding(0) var<storage, read> pos: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> world: array<atomic<i32>>;
${hashFn}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&pos);
  if (id.x >= n) { return; }
  let cs = max(bitcast<f32>(atomicLoad(&world[2])), 0.001);
  let p = pos[id.x].xyz;
  let c = cellHash(i32(floor(p.x / cs)), i32(floor(p.y / cs)), i32(floor(p.z / cs)));
  let s = atomicAdd(&world[${RB_GRID_I32_N}u + c], 1);
  if (s < ${RB_SLOT_N}) {
    atomicStore(&world[${RB_GRID_I32_N + RB_NCELLS_N}u + c * ${RB_SLOT_N}u + u32(s)], i32(id.x));
  }
}
`;

  // Zera SÓ as contagens (as vagas viram lixo inalcançável, como no fluido).
  //
  // Um kernel em vez do `gpu.write` de zeros que o fluido usa: lá o buffer de
  // grid é próprio e o upload é de 32 KB; aqui o zero teria de cair no MEIO do
  // `world`, o que exige `writeAt` — e `writeAt` mudou de forma na superfície
  // nova (passou a receber objeto de opções) enquanto o shim ainda o chama
  // posicional. Um dispatch não depende disso e não paga travessia por
  // sub-passo, que é tráfego que o caminho quente não tem por que pagar.
  const clearSrc = `
@group(0) @binding(0) var<storage, read_write> world: array<atomic<i32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${RB_NCELLS_N}u) { return; }
  atomicStore(&world[${RB_GRID_I32_N}u + id.x], 0);
}
`;

  const src = `
@group(0) @binding(0) var<storage, read_write> pos: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> vel: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> ext: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> world: array<vec4<f32>>;
${hashFn}

// penetração por eixo entre os AABBs (a, ha) e (b, hb); negativa = separados
fn pen(a: vec3<f32>, ha: vec3<f32>, b: vec3<f32>, hb: vec3<f32>) -> vec3<f32> {
  return (ha + hb) - abs(a - b);
}

// raio da esfera de colisão: METADE DA MENOR extensão, igual ao radiusOf da CPU.
fn raio(h: vec3<f32>) -> f32 { return min(h.x, min(h.y, h.z)); }

// CONTATO entre duas formas — a porta única da narrow-phase deste kernel.
//
// Responde xyz = normal apontando de B PARA A (o gather aplica só a própria
// metade, então quem chama é sempre A) e w = profundidade; w <= 0 = sem
// contato. Os três casos e as constantes são os do solvePair da CPU
// (engine/core/scene.ts): é dele que esta função é a tradução, e qualquer
// divergência aqui aparece como os dois backends terminando em lugares
// diferentes — que é o que o teste de paridade mede.
fn contato(pa: vec3<f32>, ha: vec3<f32>, sa: f32,
           pb: vec3<f32>, hb: vec3<f32>, sb: f32) -> vec4<f32> {
  let d = pa - pb;
  let vazio = vec4<f32>(0.0, 0.0, 0.0, 0.0);

  if (sa > 0.5 && sb > 0.5) {
    // CAIXA x CAIXA — eixo de MENOR penetração. É o que faz um cubo caindo num
    // chão largo ser empurrado para CIMA e não para o lado.
    let o = (ha + hb) - abs(d);
    if (o.x <= 0.0 || o.y <= 0.0 || o.z <= 0.0) { return vazio; }
    if (o.y <= o.x && o.y <= o.z) { return vec4<f32>(0.0, select(-1.0, 1.0, d.y >= 0.0), 0.0, o.y); }
    if (o.x <= o.z) { return vec4<f32>(select(-1.0, 1.0, d.x >= 0.0), 0.0, 0.0, o.x); }
    return vec4<f32>(0.0, 0.0, select(-1.0, 1.0, d.z >= 0.0), o.z);
  }

  if (sa < 0.5 && sb < 0.5) {
    // ESFERA x ESFERA — distância de centros contra a soma dos raios.
    let rs = raio(ha) + raio(hb);
    let d2 = dot(d, d);
    if (d2 >= rs * rs || d2 <= 0.0001) { return vazio; }
    let dist = sqrt(d2);
    return vec4<f32>(d / dist, rs - dist);
  }

  // ESFERA x CAIXA — ponto da caixa mais próximo do centro da esfera.
  // sinal converte a normal (que sai da caixa para a esfera) na convenção
  // B->A: +1 quando A é a esfera, -1 quando A é a caixa.
  var bc = pa; var bh = ha; var sc = pb; var r = raio(hb); var sinal = -1.0;
  if (sb > 0.5) { bc = pb; bh = hb; sc = pa; r = raio(ha); sinal = 1.0; }
  let q = clamp(sc - bc, -bh, bh);
  let w = sc - (bc + q);
  let d2 = dot(w, w);
  if (d2 >= r * r) { return vazio; }
  if (d2 > 0.000001) {
    let dist = sqrt(d2);
    return vec4<f32>(w / dist * sinal, r - dist);
  }
  // centro DENTRO da caixa: empurra pela face de menor folga.
  let g = bh - abs(q);
  if (g.y <= g.x && g.y <= g.z) { return vec4<f32>(0.0, select(-1.0, 1.0, q.y >= 0.0) * sinal, 0.0, g.y + r); }
  if (g.x <= g.z) { return vec4<f32>(select(-1.0, 1.0, q.x >= 0.0) * sinal, 0.0, 0.0, g.x + r); }
  return vec4<f32>(0.0, 0.0, select(-1.0, 1.0, q.z >= 0.0) * sinal, g.z + r);
}

// O grid vive na cauda do world, gravado como i32 por outro pipeline — daí o
// bitcast e a indexação de componente: world aqui é um array de vec4<f32>.
fn gridAt(k: u32) -> i32 {
  return bitcast<i32>(world[k / 4u][k % 4u]);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&pos);
  if (id.x >= n) { return; }
  let dt = world[0].x;
  let m = u32(world[0].y);
  let cs = max(world[0].z, 0.001);
  var p = pos[id.x].xyz;
  var slp = pos[id.x].w;
  var v = vel[id.x].xyz;
  let forma = vel[id.x].w;      // 0 = esfera, 1 = caixa (COL_SPHERE/COL_BOX)
  let h = ext[id.x].xyz;
  let im = ext[id.x].w;

  // ── DORMINDO: só escaneia por um vizinho RÁPIDO encostando (senão sai) ───
  // A varredura de acordar também passou pelo grid. Ela era O(n) POR CORPO
  // DORMINDO, ou seja, a cena em repouso — o caso que o sleeping existe para
  // baratear — era justamente a que pagava n² inteiro todo passo.
  let bx0 = i32(floor(p.x / cs));
  let by0 = i32(floor(p.y / cs));
  let bz0 = i32(floor(p.z / cs));
  if (slp >= ${RB_SLEEP_FRAMES}) {
    var acordar = false;
    for (var cz: i32 = -1; cz <= 1; cz = cz + 1) {
    for (var cy: i32 = -1; cy <= 1; cy = cy + 1) {
    for (var cx: i32 = -1; cx <= 1; cx = cx + 1) {
      let cell = cellHash(bx0 + cx, by0 + cy, bz0 + cz);
      let cnt = u32(clamp(gridAt(${RB_GRID_I32_N}u + cell), 0, ${RB_SLOT_N}));
      for (var s: u32 = 0u; s < cnt; s = s + 1u) {
        let j = u32(gridAt(${RB_GRID_I32_N + RB_NCELLS_N}u + cell * ${RB_SLOT_N}u + s));
        if (j == id.x) { continue; }
        let vj = vel[j].xyz;
        if (dot(vj, vj) > 0.64) {                  // vizinho a > 0.8 u/s
          let c = contato(p, h, forma, pos[j].xyz, ext[j].xyz, vel[j].w);
          if (c.w > 0.0) { acordar = true; }
        }
      }
    }}}
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
    // Estáticos são sempre CAIXA — rbSyncStatics só aceita COL_BOX. Uma
    // esfera dinâmica sobre o chão passa pelo caso esfera-caixa, que é o
    // contato mais visível de todos e o que antes era resolvido como AABB.
    let c = contato(p, h, forma, sc, sh, 1.0);
    if (c.w > 0.0) {
      let nr = c.xyz;
      // Estático não cede: a correção inteira é minha (85%, slop 0.04).
      p = p + nr * max(c.w - 0.04, 0.0) * 0.85;
      let vn = dot(v, nr);
      // Só a componente que ENTRA no estático é zerada — para um eixo puro isto
      // é exatamente o if (v.y * s < 0) { v.y = 0 } de antes.
      if (vn < 0.0) { v = v - nr * vn; }
      // atrito de chão: contato vertical freia o deslize
      if (nr.y > 0.5) { v.x = v.x * 0.92; v.z = v.z * 0.92; }
    }
  }

  // ── PARES DINÂMICOS (gather: eu aplico SÓ a minha metade) ────────────────
  // Jacobi precisa de RELAXAÇÃO menor que o sequencial: um corpo soterrado
  // soma correções de DEZENAS de vizinhos no mesmo passo — com 0.85 a pilha
  // profunda explodia (o castelo "sumiu" no colapso total). 0.30 por par +
  // teto de deslocamento total por passo mantêm o monte coeso.
  let pAntes = p;
  // Célula RECALCULADA: p já andou (integração + estáticos) desde a varredura
  // de acordar, e indexar pela posição velha deixaria escapar o par que o
  // próprio passo criou.
  let gx0 = i32(floor(p.x / cs));
  let gy0 = i32(floor(p.y / cs));
  let gz0 = i32(floor(p.z / cs));
  for (var cz: i32 = -1; cz <= 1; cz = cz + 1) {
  for (var cy: i32 = -1; cy <= 1; cy = cy + 1) {
  for (var cx: i32 = -1; cx <= 1; cx = cx + 1) {
    let cell = cellHash(gx0 + cx, gy0 + cy, gz0 + cz);
    let cnt = u32(clamp(gridAt(${RB_GRID_I32_N}u + cell), 0, ${RB_SLOT_N}));
    for (var sl: u32 = 0u; sl < cnt; sl = sl + 1u) {
    let j = u32(gridAt(${RB_GRID_I32_N + RB_NCELLS_N}u + cell * ${RB_SLOT_N}u + sl));
    if (j == id.x) { continue; }
    let pj = pos[j].xyz;
    let hj = ext[j].xyz;
    let c = contato(p, h, forma, pj, hj, vel[j].w);
    if (c.w <= 0.0) { continue; }
    let nr = c.xyz;
    let imj = ext[j].w;
    let share = im / max(im + imj, 0.0001);
    let vj = vel[j].xyz;
    // Velocidade relativa projetada na normal. Negativa = nos aproximando.
    let vn = dot(v - vj, nr);
    // As regras da coluna valiam para o EIXO Y; agora valem para a normal
    // vertical, que é o mesmo teste que a CPU faz (resting, |ny| > 0.5). Para
    // um contato caixa-caixa alinhado a normal É um eixo, então nada muda ali.
    if (nr.y > 0.5 || nr.y < -0.5) {
      if (vn < -1.0) {
        // impacto de verdade: impulso normal (e=0 — pedra não quica)
        v = v - nr * vn * share;
        slp = 0.0;
      } else if (vn < 0.5 && nr.y > 0.5) {
        // HERANÇA DE APOIO: estou EM CIMA, descendo devagar — herdo o vy do
        // suporte (sem impulso: impulso aqui é o ciclo-limite de coluna)
        v.y = vj.y;
        // atrito de empilhamento
        v.x = v.x + (vj.x - v.x) * 0.10;
        v.z = v.z + (vj.z - v.z) * 0.10;
      }
    } else if (vn < 0.0) {
      v = v - nr * vn * share;
      if (vn < -1.0) { slp = 0.0; }
    }
    p = p + nr * max(c.w - 0.04, 0.0) * 0.30 * share;
  }}}}
  // teto de correção posicional POR PASSO (anti-explosão de monte profundo)
  let dcorr = p - pAntes;
  let dlen = length(dcorr);
  if (dlen > 0.25) { p = pAntes + dcorr * (0.25 / dlen); }

  // quem caiu do mundo estaciona (mesma regra da demo do castelo)
  if (p.y < -18.0) { p = vec3<f32>(p.x, -18.0, p.z); v = vec3<f32>(0.0, 0.0, 0.0); }

  // QUARENTENA DE NaN (visto ao vivo: posicoes NaN sumiam o castelo e NaN
  // nunca dorme — comparacoes com NaN sao falsas). Corpo contaminado e
  // estacionado em -18 com v=0 em vez de espalhar NaN pelos vizinhos no
  // proximo gather. A CACA a origem fica registrada para a proxima sessao.
  if (p.x != p.x || p.y != p.y || p.z != p.z ||
      v.x != v.x || v.y != v.y || v.z != v.z) {
    p = vec3<f32>(0.0, -18.0, 0.0);
    v = vec3<f32>(0.0, 0.0, 0.0);
    slp = 10.0;
  }

  // ── SLEEPING por velocidade pós-resolução (a regra que funcionou) ────────
  if (dot(v, v) < ${RB_SLEEP_SPEED2}) { slp = slp + 1.0; } else { slp = 0.0; }

  pos[id.x] = vec4<f32>(p, slp);
  vel[id.x] = vec4<f32>(v, forma);   // a forma sobrevive ao passo
}
`;
  rbPipe = gpu.shader(src);
  if (rbPipe === 0) return 0;
  rbPipeGrid = gpu.shader(gridSrc);
  if (rbPipeGrid === 0) return 0;
  rbPipeClear = gpu.shader(clearSrc);
  if (rbPipeClear === 0) return 0;
  rbMaxHalf = 0.0;
  rbGPos = gpu.buffer(n * 16);
  rbGVel = gpu.buffer(n * 16);
  rbGExt = gpu.buffer(n * 16);
  // O `world` cresceu para caber o grid na cauda; o espelho do host NÃO — a CPU
  // só escreve params + estáticos, e o grid é escrito e lido só pela GPU.
  rbGWorld = gpu.buffer(RB_WORLD_BYTES);
  rbPosBuf = buffer.alloc(n * 16);
  rbVelBuf = buffer.alloc(n * 16);
  rbExtBuf = buffer.alloc(n * 16);
  rbWorldBuf = buffer.alloc((1 + RB_MAX_STATICS * 2) * 16);
  gpu.bind_buffer(rbPipe, 0, rbGPos);
  gpu.bind_buffer(rbPipe, 1, rbGVel);
  gpu.bind_buffer(rbPipe, 2, rbGExt);
  gpu.bind_buffer(rbPipe, 3, rbGWorld);
  gpu.bind_buffer(rbPipeGrid, 0, rbGPos);
  gpu.bind_buffer(rbPipeGrid, 1, rbGWorld);
  gpu.bind_buffer(rbPipeClear, 0, rbGWorld);
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
  // CAIXA por default. Não é preferência: era o que TODO corpo era antes desta
  // mudança, então quem já chamava `rbSetBody` continua vendo exatamente a
  // física de ontem — inclusive `tools/test_gpurigid.ts`, que é a rede da
  // campanha do castelo e não pode mudar de significado junto com o kernel.
  // Quem tem uma esfera chama `rbSetShape` depois.
  buffer.write_f32(rbVelBuf, (i * 4 + 3) * 4, 1.0);
  buffer.write_f32(rbExtBuf, (i * 4) * 4, hx);
  buffer.write_f32(rbExtBuf, (i * 4 + 1) * 4, hy);
  buffer.write_f32(rbExtBuf, (i * 4 + 2) * 4, hz);
  buffer.write_f32(rbExtBuf, (i * 4 + 3) * 4, mass > 0.0 ? 1.0 / mass : 1.0);
  // A célula é dimensionada pelo MAIOR corpo (ver rbWriteWorld); acompanhar
  // aqui é o único lugar que vê todas as extensões sem varrer nada de novo.
  if (hx > rbMaxHalf) rbMaxHalf = hx;
  if (hy > rbMaxHalf) rbMaxHalf = hy;
  if (hz > rbMaxHalf) rbMaxHalf = hz;
}

/// Escreve params + estáticos do espelho para a GPU.
///
/// O TAMANHO DA CÉLULA sai daqui, e é a única decisão de verdade do grid: dois
/// corpos só se tocam se os centros distarem menos que `hi + hj` em cada eixo,
/// então uma célula de lado >= 2*maiorMeiaExtensão garante que todo par que
/// colide cai em células vizinhas — e a varredura de 27 é exata, não uma
/// aproximação. Menor que isso perderia contato e mudaria a física; maior só
/// desperdiça candidatos.
function rbWriteWorld(): void {
  if (rbPipe === 0) return;
  buffer.write_f32(rbWorldBuf, 0, RB_DT);
  buffer.write_f32(rbWorldBuf, 4, rbStatics * 1.0);
  buffer.write_f32(rbWorldBuf, 8, rbMaxHalf > 0.0 ? rbMaxHalf * 2.0 : 1.0);
  gpu.write(rbGWorld, rbWorldBuf, (1 + rbStatics * 2) * 16);
}

/// A FORMA do colisor: `COL_SPHERE` (0) ou `COL_BOX` (1) de `gameobject.ts`.
///
/// Separada de `rbSetBody` em vez de ser um nono parâmetro dele porque este
/// projeto não usa parâmetro com default em lugar nenhum — a varredura não achou
/// um só — e um argumento novo no fim de uma função com oito calaria em todos os
/// chamadores existentes como `undefined`, que aqui vira `NaN` e depois uma
/// forma que não é nem esfera nem caixa. `rbSetVel` já é um escritor pequeno
/// pelo mesmo motivo.
///
/// Chame DEPOIS de `rbSetBody`, que reescreve o campo com o default.
export function rbSetShape(i: number, shape: number): void {
  buffer.write_f32(rbVelBuf, (i * 4 + 3) * 4, shape === 0 ? 0.0 : 1.0);
}

/// Escreve velocidade (disparos/handoff) e ACORDA o corpo.
export function rbSetVel(i: number, vx: f64, vy: f64, vz: f64): void {
  buffer.write_f32(rbVelBuf, (i * 4) * 4, vx);
  buffer.write_f32(rbVelBuf, (i * 4 + 1) * 4, vy);
  buffer.write_f32(rbVelBuf, (i * 4 + 2) * 4, vz);
  buffer.write_f32(rbPosBuf, (i * 4 + 3) * 4, 0.0);
}

/// Cutuca UM corpo na GPU: escreve pos+vel do espelho SÓ dele (write_at).
/// É o caminho do disparo/respawn em pleno jogo — o upload completo
/// reescrevia as velocidades de TODOS com valores velhos do espelho.
export function rbPoke(i: number): void {
  if (rbPipe === 0) return;
  gpu.write_at(rbGPos, rbPosBuf, i * 16, i * 16, 16);
  gpu.write_at(rbGVel, rbVelBuf, i * 16, i * 16, 16);
}

/// Sobe TODO o estado dos espelhos para a GPU (chamar após spawn/handoff).
export function rbUpload(): void {
  if (rbPipe === 0) return;
  gpu.write(rbGPos, rbPosBuf, rbN * 16);
  gpu.write(rbGVel, rbVelBuf, rbN * 16);
  gpu.write(rbGExt, rbExtBuf, rbN * 16);
  // Também os params: o tamanho da célula só é conhecido depois dos rbSetBody,
  // e há duas ordens de chamada em uso (o teste sincroniza estáticos ANTES de
  // criar os corpos, o bench DEPOIS). Escrever nos dois pontos é o que faz o
  // grid nascer dimensionado em qualquer uma das duas.
  rbWriteWorld();
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
  rbWriteWorld();
}

let rbTicket: i64 = 0;
let rbTicketAge = 0;

/// FÍSICA COMO SERVIÇO (assíncrona): nunca espera a GPU. Se o resultado do
/// passo anterior CHEGOU, aplica nos espelhos, despacha o próximo passo e
/// agenda a próxima leitura; senão, devolve 0 e o jogo desenha o estado
/// antigo. Devolve 1 quando os espelhos têm estado novo.
export function rbService(substeps: number): number {
  if (rbPipe === 0) return 0;
  if (rbTicket === 0) {
    rbKick(substeps);
    rbTicket = gpu.read_begin(rbGPos, rbN * 16);
    return 0;
  }
  const got = gpu.read_poll(rbTicket, rbPosBuf);
  if (got === 0) {
    // WATCHDOG: ticket preso (>60 frames sem resposta) e abandonado — a
    // simulacao NUNCA pode congelar por uma leitura perdida.
    rbTicketAge = rbTicketAge + 1;
    if (rbTicketAge > 60) { rbTicket = 0; rbTicketAge = 0; }
    return 0;
  }
  rbTicketAge = 0;
  rbTicket = 0;
  if (got < 0) return 0;
  rbKick(substeps);
  rbTicket = gpu.read_begin(rbGPos, rbN * 16);
  return 1;
}

/// PULL: lê o resultado do frame anterior (o ÚNICO ponto que espera a GPU).
export function rbPull(): void {
  if (rbPipe === 0) return;
  gpu.read(rbGPos, rbPosBuf, rbN * 16);
}
/// KICK: submete `substeps` passos novos SEM esperar.
export function rbKick(substeps: number): void {
  if (rbPipe === 0) return;
  let s = 0;
  while (s < substeps) {
    // Três dispatches por sub-passo, e a ordem é obrigatória: o grid descreve as
    // posições DESTE sub-passo, então reconstruí-lo depois de colidir daria uma
    // vizinhança de um passo atrás. É a mesma sequência do fluido
    // (`gpufluid.ts:524`), com o zero feito por kernel em vez de upload.
    gpu.dispatch(rbPipeClear, RB_CLEAR_GROUPS, 1, 1);
    gpu.dispatch(rbPipeGrid, rbGroups, 1, 1);
    gpu.dispatch(rbPipe, rbGroups, 1, 1);
    s = s + 1;
  }
}
/// Compat: pull + kick (um frame completo).
export function rbStep(substeps: number): void {
  rbPull();
  rbKick(substeps);
}

/// Sincroniza TAMBÉM as velocidades (handoff GPU->CPU; posições já vêm no step).
export function rbReadState(): void {
  if (rbPipe === 0) return;
  gpu.read(rbGPos, rbPosBuf, rbN * 16);
  gpu.read(rbGVel, rbVelBuf, rbN * 16);
}
