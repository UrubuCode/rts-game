// ═══════════════════════════════════════════════════════════════════════════
// CASTELO 100% GPU — rígidos E água na GPU; a CPU só orquestra.
//
//   rts.exe run castelo_gpu_demo.ts
//
// Os 346 blocos da fortaleza rodam no solver rígido de GPU (engine/rigid/
// gpurigid.ts, modelo gather/Jacobi) — o pico de ~15 ms do impacto no solver
// CPU é o alvo. Depois do readback pipelined, as posições são ESPELHADAS nos
// Transforms da cena: render, água (colisores) e WebSocket seguem intactos.
//
// RÍGIDOS na CPU (o solver com sleeping — canhão, muralhas, demolição) e a
// ÁGUA na GPU (SPH em WGSL via rts:gpu, 8.192 partículas): um tsunami vem do
// leste e quebra contra a fortaleza ENQUANTO o canhão a bombardeia do oeste.
// Os colisores da cena são re-sincronizados com o kernel durante a demolição —
// a água escoa pelos buracos que os tiros abrem na muralha.
//
// Fronteira assimétrica (nível 1 do plano perto-CPU/longe-GPU): o mundo
// empurra a água; a água ainda não empurra os blocos.
//
// Um castelo de ~130 blocos (muralha, ameias, duas torres com telhado) e um
// canhão que dispara balas de metal incandescentes a cada ~2,5 s, variando a
// mira. A demolição ACUMULA: cada tiro arranca um pedaço, os blocos deslizam,
// as torres desabam. Depois de 10 tiros o castelo se reconstrói e o ciclo
// recomeça.
//
// Por que é um bom teste: TODOS os corpos são dinâmicos ao mesmo tempo durante
// o desabamento (pior caso da colisão), a massa vem de densidade × volume
// (bala de metal ~32 contra bloco de pedra ~4.5), e o som do disparo sai do
// mixer da engine. O que as 14 asserções de tools/test_physics.ts provam
// headless, aqui vira espetáculo.
//
// Controles: WASD voa, botão DIREITO gira, ESPAÇO sobe, R reconstrói já.
// Porta de controle: ws://127.0.0.1:7777 (`state` lista todos os corpos).
// ═══════════════════════════════════════════════════════════════════════════
import io from "./compat/io.ts";
import math from "./compat/math.ts";
import input from "rts:input";
import time from "./compat/time.ts";

import { scene, S } from "./editor/control/session";
import { GameObject } from "./engine/core/gameobject";
import { Transform } from "./engine/core/transform";
import { PhysicsMaterial, MAT_STONE, MAT_WOOD, MAT_METAL } from "./scripts/physicsmaterial";
import { initAudio, pumpAudio, playNoise, playSquare,
         playNoiseAt, playSquareAt } from "./engine/audio/audio";
import { setListener, setRolloff } from "./engine/audio/spatial";
import { initMeshes, setCam, setLgt, setShadow, drawGPU, drawWaterGPU,
         frustumBegin, inFrustumFast, winWidth, winHeight, setVsync } from "./engine/render/gpu3d";
import { ctrlServe, ctrlPoll } from "./editor/control/server";
import { RB_DT } from "./engine/rigid/gpurigid";
import { rbInit, rbSetBody, rbSetVel, rbUpload, rbSyncStatics, rbStep,
         rbPoke, rbX, rbY, rbZ, rbSleep } from "./engine/rigid/gpurigid";
import { flInit, flSpawnBlock, flSyncColliders, flStep, flApplyForces,
         flX, flY, flZ, flHidden, flBackend, flPosGpuBuf } from "./engine/fluid/fluid";

// Prefixo CD_ em TUDO de topo: nomes colidem em silêncio entre módulos neste
// runtime (o `let H` de uma demo já corrompeu o raio do kernel do fluido).
let CD_W = 1500;
let CD_H = 950;
const app = createAppAt("RTS — Castelo 100% GPU", CD_W, CD_H, 60, 40);
// Raio de ganho cheio e alcance: o castelo tem ~40 unidades de ponta a ponta,
// então 60 deixa o canhão audível de qualquer ponto da cena e cala o que estiver
// fora dela.
setRolloff(2.0, 60.0);
const WIN = app._win;
const CD_FOV: f64 = 1.05;

S.win = WIN;
initMeshes(WIN);
initAudio();
ctrlServe(7777);

// ── terreno ─────────────────────────────────────────────────────────────────
{
  const g = new GameObject("Campo");
  g.setMesh(1, 74, 96, 66);
  g.transform.setPosition(0.0, 0.0, 0.0);
  g.transform.sx = 90.0; g.transform.sy = 1.0; g.transform.sz = 60.0;
  g.stationary = 1;
  g.transform.friction = 0.55;
  scene.add(g);
}

// ── estado de RESET (arrays achatados; closures perdem prova de tipo) ───────
const rIdx: number[] = [];
const rX: f64[] = [];
const rY: f64[] = [];
const rZ: f64[] = [];

/// Bloco do castelo: cor com leve variação para a muralha não parecer plástico.
let tintSeed = 7;
function tint(): number {
  tintSeed = (tintSeed * 1103515245 + 12345) & 0x7FFFFFFF;
  return tintSeed % 22;
}
function block(x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64,
               cr: number, cg: number, cb: number, mat: number): GameObject {
  const o = new GameObject("Bloco");
  const v = tint();
  o.setMesh(1, cr + v, cg + v, cb + v);
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx; o.transform.sy = sy; o.transform.sz = sz;
  o.addBehavior(new PhysicsMaterial(mat));
  scene.add(o);
  rIdx.push(scene.objects.length - 1);
  rX.push(x); rY.push(y); rZ.push(z);
  return o;
}

// ── a FORTALEZA (quadrada, centrada em x=20) ───────────────────────────────
// 4 muralhas fechando um pátio, 4 torres de canto com telhado, e a TORRE DE
// MENAGEM (o torreão central) mais alta que tudo. ~380 blocos, todos dinâmicos
// — o pior caso da colisão quando uma parede inteira desaba.
const FORT_X: f64 = 20.0;
const FORT_HALF: f64 = 9.0;   // meia-largura do pátio

// muralha reta ao longo de Z (em x fixo) ou ao longo de X (em z fixo)
function wallZ(x: f64, zc: f64, len: number, rows: number, gap: number): void {
  let row = 0;
  while (row < rows) {
    let col = 0;
    while (col < len) {
      // `gap` pula os blocos centrais da fileira de baixo (o portão)
      const isGate = gap !== 0 && row < 2 && col >= (len / 2 | 0) - 1 && col <= (len / 2 | 0);
      if (!isGate) {
        block(x, 1.15 + row * 1.32, zc - (len - 1) * 0.825 + col * 1.65,
              1.25, 1.3, 1.6, 118, 120, 126, MAT_STONE);
      }
      col = col + 1;
    }
    row = row + 1;
  }
  // ameias no topo
  let a = 0;
  while (a < ((len / 2) | 0)) {
    block(x, 1.15 + rows * 1.32 - 0.2, zc - (len - 1) * 0.825 + a * 3.3,
          1.1, 0.8, 1.1, 128, 130, 136, MAT_STONE);
    a = a + 1;
  }
}
function wallX(z: f64, xc: f64, len: number, rows: number): void {
  let row = 0;
  while (row < rows) {
    let col = 0;
    while (col < len) {
      block(xc - (len - 1) * 0.825 + col * 1.65, 1.15 + row * 1.32, z,
            1.6, 1.3, 1.25, 118, 120, 126, MAT_STONE);
      col = col + 1;
    }
    row = row + 1;
  }
  let a = 0;
  while (a < ((len / 2) | 0)) {
    block(xc - (len - 1) * 0.825 + a * 3.3, 1.15 + rows * 1.32 - 0.2, z,
          1.1, 0.8, 1.1, 128, 130, 136, MAT_STONE);
    a = a + 1;
  }
}
// frente (com portão), fundo, e duas laterais.
// As muralhas PARAM ANTES dos cantos: a primeira versão as levava até lá e os
// blocos nasciam INTERPENETRADOS com as torres (sobreposição de ~0.6) — o
// solver expulsava os cantos com violência e a fortaleza inteira desabava
// sozinha, antes do primeiro tiro. Peças de construção nunca podem nascer
// sobrepostas: para o solver, sobreposição é colisão em andamento.
wallZ(FORT_X - FORT_HALF, 0.0, 9, 4, 1);
wallZ(FORT_X + FORT_HALF, 0.0, 9, 4, 0);
wallX(0.0 - FORT_HALF, FORT_X, 8, 4);
wallX(FORT_HALF, FORT_X, 8, 4);

// torre de canto: 2x2 de base, `lvls` de altura, telhado de pirâmide
function tower(xc: f64, zc: f64, lvls: number): void {
  let lvl = 0;
  while (lvl < lvls) {
    let q = 0;
    while (q < 4) {
      block(xc + (q % 2) * 1.35 - 0.67, 1.15 + lvl * 1.32, zc + ((q / 2) | 0) * 1.35 - 0.67,
            1.3, 1.3, 1.3, 132, 128, 122, MAT_STONE);
      q = q + 1;
    }
    lvl = lvl + 1;
  }
  const roof = new GameObject("Telhado");
  roof.setMesh(2, 178, 62, 54);
  roof.transform.setPosition(xc, 1.15 + lvls * 1.32 + 0.9, zc);
  roof.transform.sx = 3.4; roof.transform.sy = 2.4; roof.transform.sz = 3.4;
  roof.addBehavior(new PhysicsMaterial(MAT_WOOD));
  scene.add(roof);
  rIdx.push(scene.objects.length - 1);
  rX.push(xc); rY.push(1.15 + lvls * 1.32 + 0.9); rZ.push(zc);
}
tower(FORT_X - FORT_HALF, 0.0 - FORT_HALF, 7);
tower(FORT_X - FORT_HALF, FORT_HALF, 7);
tower(FORT_X + FORT_HALF, 0.0 - FORT_HALF, 7);
tower(FORT_X + FORT_HALF, FORT_HALF, 7);

// TORRE DE MENAGEM: 3x3 de base, 9 níveis, o alvo mais satisfatório de todos
{
  let lvl = 0;
  while (lvl < 9) {
    let q = 0;
    while (q < 9) {
      block(FORT_X + (q % 3) * 1.35 - 1.35, 1.15 + lvl * 1.32, ((q / 3) | 0) * 1.35 - 1.35,
            1.3, 1.3, 1.3, 140, 134, 126, MAT_STONE);
      q = q + 1;
    }
    lvl = lvl + 1;
  }
  const roof = new GameObject("TelhadoMor");
  roof.setMesh(2, 190, 58, 48);
  roof.transform.setPosition(FORT_X, 1.15 + 9.0 * 1.32 + 1.2, 0.0);
  roof.transform.sx = 5.0; roof.transform.sy = 3.2; roof.transform.sz = 5.0;
  roof.addBehavior(new PhysicsMaterial(MAT_WOOD));
  scene.add(roof);
  rIdx.push(scene.objects.length - 1);
  rX.push(FORT_X); rY.push(1.15 + 9.0 * 1.32 + 1.2); rZ.push(0.0);
}

// ── o CANHÃO (visual estático) e as BALAS (pool reciclado) ──────────────────
{
  const barrel = new GameObject("Canhao");
  barrel.setMesh(1, 52, 54, 60);
  barrel.transform.setPosition(0.0 - 26.0, 2.2, 0.0);
  barrel.transform.sx = 3.6; barrel.transform.sy = 1.1; barrel.transform.sz = 1.1;
  barrel.stationary = 1;
  scene.add(barrel);
  const base = new GameObject("Reparo");
  base.setMesh(1, 96, 70, 46);
  base.transform.setPosition(0.0 - 26.6, 1.0, 0.0);
  base.transform.sx = 2.4; base.transform.sy = 1.4; base.transform.sz = 2.2;
  base.stationary = 1;
  scene.add(base);
}
/// Pool de 6 balas: recicladas em vez de criadas (nada de alocar em jogo).
/// Incandescentes (emissive): o rastro escuro do metal vira brasa na tela.
const ballIdx: number[] = [];
{
  let b = 0;
  while (b < 6) {
    const o = new GameObject("Bala" + b);
    o.setMesh(4, 255, 176, 92);
    o.emissive = 1;
    o.transform.setPosition(0.0 - 26.0 - b * 4.0, 0.0 - 16.0, 0.0);   // estacionadas fora de cena
    o.transform.setScale(1.7);
    o.addBehavior(new PhysicsMaterial(MAT_METAL));
    scene.add(o);
    ballIdx.push(scene.objects.length - 1);
    b = b + 1;
  }
}

// ── ÁGUA (GPU): tsunami do LESTE, 16x16x32 = 8192 partículas ───────────────
// A demo fala SÓ com a fachada (engine/fluid/fluid.ts): o decisor calibrado
// escolhe o backend no init, e a tecla T troca EM PLENO VOO (handoff).
const CD_NAGUA = 4096;   // 16x16x16
const CD_TEM_AGUA = 1;   // a fachada sempre funciona (sem GPU cai p/ CPU)
function soltaAgua(): void {
  // bloco alto colado na muralha leste (x=29): desaba e vira onda contra ela
  flSpawnBlock(16, 16, 16, FORT_X + FORT_HALF + 3.0, 1.4, 0.0 - 2.7, 0.36);
}
const CD_AGUA = 0;   // DISCRIMINADOR NaN: 0 = agua totalmente desligada
scene.computeWorld();
if (CD_AGUA !== 0) {
  flInit(CD_NAGUA);
  flSyncColliders(scene);
  soltaAgua();
}
io.print("[castelo] agua ligada: " + CD_NAGUA + " particulas, backend " +
         (flBackend() === 1 ? "GPU" : "CPU (fallback)"));

// ── RÍGIDOS NA GPU: blocos + balas viram corpos do gpurigid ─────────────────
const RB_N = rIdx.length + ballIdx.length;
if (rbInit(RB_N) === 0) { io.print("[castelo] SEM GPU p/ rigidos"); app.close(); }
rbSyncStatics(scene);
{
  let k = 0;
  while (k < rIdx.length) {
    const t: Transform = scene.objects[rIdx[k]].transform;
    let bm: f64 = t.mass;
    if (bm < 0.1) bm = 4.0;
    rbSetBody(k, t.px, t.py, t.pz, t.sx * 0.5, t.sy * 0.5, t.sz * 0.5, bm);
    k = k + 1;
  }
  let b = 0;
  while (b < ballIdx.length) {
    const t: Transform = scene.objects[ballIdx[b]].transform;
    rbSetBody(rIdx.length + b, t.px, t.py, t.pz, 0.85, 0.85, 0.85, 32.0);
    b = b + 1;
  }
  rbUpload();
}

io.print("[castelo] " + rIdx.length + " blocos + " + ballIdx.length + " balas RIGIDOS NA GPU | ws://127.0.0.1:7777");
io.print("[castelo] WASD voa | botao DIR gira | R reconstroi");

/// Reconstrói o castelo (na GPU) e estaciona as balas.
function rebuild(): void {
  let k = 0;
  while (k < rIdx.length) {
    const t: Transform = scene.objects[rIdx[k]].transform;
    let bm: f64 = t.mass;
    if (bm < 0.1) bm = 4.0;
    rbSetBody(k, rX[k], rY[k], rZ[k], t.sx * 0.5, t.sy * 0.5, t.sz * 0.5, bm);
    k = k + 1;
  }
  k = 0;
  while (k < ballIdx.length) {
    rbSetBody(rIdx.length + k, 0.0 - 26.0 - k * 4.0, 0.0 - 16.0, 0.0, 0.85, 0.85, 0.85, 32.0);
    k = k + 1;
  }
  rbUpload();
  soltaAgua();
}

/// Dispara a próxima bala do pool, variando a mira (LCG determinístico).
let aimSeed = 4242;
let nextBall = 0;
let shots = 0;
function fire(): void {
  aimSeed = (aimSeed * 1103515245 + 12345) & 0x7FFFFFFF;
  const vz: f64 = ((aimSeed % 100) - 50) * 0.16;        // -8 .. +8 (varre a fortaleza inteira)
  aimSeed = (aimSeed * 1103515245 + 12345) & 0x7FFFFFFF;
  const vy: f64 = 2.0 + (aimSeed % 60) * 0.14;          // 2 .. 10.3 (as altas acertam o torreão)
  // POKE PARCIAL (gpu.write_at): so a bala e escrita na GPU. O caminho antigo
  // (rbReadState + rbUpload COMPLETOS) reescrevia as velocidades de todos os
  // corpos com valores velhos em pleno colapso — e era o vetor provavel da
  // infeccao de NaN (leitura completa flaky do modo janela re-subida inteira).
  rbSetBody(rIdx.length + nextBall, 0.0 - 24.0, 2.4, 0.0, 0.85, 0.85, 0.85, 32.0);
  rbSetVel(rIdx.length + nextBall, 34.0, vy, vz);
  rbPoke(rIdx.length + nextBall);
  nextBall = nextBall + 1;
  if (nextBall >= ballIdx.length) nextBall = 0;
  shots = shots + 1;
  // ESTRONDO: ruído (a explosão) + quadrada grave (o corpo do disparo)
  // O estrondo sai DO CANHÃO, não da cabeça do jogador: a bala nasce em
  // (-24, 2.4, 0) e é de lá que o som parte.
  playNoiseAt(0.22, 0.5, 0.0 - 24.0, 2.4, 0.0);
  playSquareAt(62.0, 0.28, 0.34, 0.0 - 24.0, 2.4, 0.0);
}

// ── câmera: diagonal alta, vendo canhão e castelo ──────────────────────────
S.camX = 0.0 - 22.0; S.camY = 22.0; S.camZ = 0.0 - 40.0;
S.camYaw = 0.62; S.camPitch = 0.0 - 0.36;
S.lightX = 12.0; S.lightY = 26.0; S.lightZ = 0.0 - 14.0; S.lightAmb = 0.34;
// VSYNC DESLIGADO de propósito (medido 2026-07-26): com FIFO, cada gpu.read
// bloqueante alinha ao vblank e o frame acumulava 2-3 esperas de 16 ms
// (fisCPU 3.5 -> 44 ms só de fence). O teto de fps é por SONO no fim do
// frame (time.sleep_ms): CPU baixa E sem fence de vblank nos reads.
setVsync(WIN, 0);

/// Acumulador do PASSO FIXO da física. A física roda a 16 ms SEMPRE — as
/// suítes headless passavam e a demo ao vivo explodia porque a demo integrava
/// com o dt REAL do frame (até 60 ms): penetrações profundas escolhem o eixo
/// errado no solver e o caos se auto-sustenta. Mesma lição do fluido (SUBSTEP).
/// Teto de 3 sub-passos: frame muito lento vira câmera lenta, não instabilidade.
let phAcc: f64 = 0.0;
// medidor honesto de fps: media e pior frame por janela de 300
let dtSum: f64 = 0.0;
let dtMax: f64 = 0.0;

/// Um tiro a cada ~2,5 s; 10 tiros por rodada; reconstrói 6 s após o último.
/// Intervalo entre tiros em SEGUNDOS. Era em FRAMES, e por isso o canhão
/// atirava três vezes mais rápido quando o fps subia — o bug ficou visível
/// quando o instancing levou de 81 para 176 fps.
const FIRE_EVERY_S: f64 = 2.0;
const SHOTS_PER_ROUND = 16;
let frames = 0;
let prevR = 0;
// fatias do frame (média por janela de 300) — para achar o custo da demolição
let tFis: f64 = 0.0;
let tSyn: f64 = 0.0;
let tAgu: f64 = 0.0;
let tDrC: f64 = 0.0;
let tDrA: f64 = 0.0;
let tFim: f64 = 0.0;      // endFrame: egui + submissao + PRESENT (espera a GPU)
let tFimMax: f64 = 0.0;
let rigApl = 0;           // quantas vezes o servico rigido APLICOU na janela
/// Sobra de tempo real que ainda não virou passo de física (ver o acumulador).
let acumulado: f64 = 0.0;
/// Relógio do demo, em segundos — o que o canhão e a rodada consultam.
let tempo: f64 = 0.0;
let tRodada: f64 = 0.0;
let tDesdeTiro: f64 = 0.0;

function frame(): void {
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) CD_W = nw;
  if (nh > 300) CD_H = nh;
  let dt: f64 = app.delta();
  if (dt > 60) dt = 60;
  const dts: f64 = dt / 1000.0;
  tempo = tempo + dts;
  frames = frames + 1;
  dtSum = dtSum + dt;
  if (dt > dtMax) dtMax = dt;

  // câmera livre
  const kW = app.keyDown(122); const kS = app.keyDown(118);
  const kA = app.keyDown(100); const kD = app.keyDown(103);
  const kSp = app.keyDown(3);
  const kR = app.keyDown(114);
  if (input.mouseDown(WIN, 1) !== 0) {
    S.camYaw = S.camYaw + input.mouseDeltaX(WIN) * 0.005;
    S.camPitch = S.camPitch - input.mouseDeltaY(WIN) * 0.005;
  }
  if (S.camPitch > 1.4) S.camPitch = 1.4;
  if (S.camPitch < 0.0 - 1.4) S.camPitch = 0.0 - 1.4;
  const cyw = math.cos(S.camYaw); const syw = math.sin(S.camYaw);
  const cpM = math.cos(S.camPitch); const spM = math.sin(S.camPitch);
  const mv: f64 = 15.0 * dts;
  if (kW !== 0) { S.camX = S.camX + syw * cpM * mv; S.camY = S.camY + spM * mv; S.camZ = S.camZ + cyw * cpM * mv; }
  if (kS !== 0) { S.camX = S.camX - syw * cpM * mv; S.camY = S.camY - spM * mv; S.camZ = S.camZ - cyw * cpM * mv; }
  if (kD !== 0) { S.camX = S.camX + cyw * mv; S.camZ = S.camZ - syw * mv; }
  if (kA !== 0) { S.camX = S.camX - cyw * mv; S.camZ = S.camZ + syw * mv; }
  if (kSp !== 0) S.camY = S.camY + mv;
  if (kR !== 0 && prevR === 0) { rebuild(); frames = 1; shots = 0; }
  prevR = kR;

  ctrlPoll(CD_W, CD_H);

  // ── ciclo do canhão ──────────────────────────────────────────────────────
  // trégua inicial: o castelo assenta e DORME antes do primeiro tiro — dá para
  // ver o repouso de verdade, e é a janela que mede o sleeping sem ruído
  // O canhão anda pelo RELÓGIO, não pelo contador de frames.
  if (tempo >= 5.0 && shots < SHOTS_PER_ROUND) {
    tDesdeTiro = tDesdeTiro + dts;
    if (tDesdeTiro >= FIRE_EVERY_S) { fire(); tDesdeTiro = 0.0; }
  }
  if (shots >= SHOTS_PER_ROUND && tempo - tRodada >= FIRE_EVERY_S * SHOTS_PER_ROUND + 6.0) {
    rebuild();
    shots = 0;
    frames = 1;
    tempo = 0.0;
    tRodada = 0.0;
    tDesdeTiro = 0.0;
  }

  // ── FÍSICA em PASSO FIXO de 16 ms (o mesmo dt das suítes headless) ───────
  const tf0 = performance.now();
  // ── RÍGIDOS NA GPU (física como serviço): aplica o resultado QUANDO chega
  // (1-2 frames de latência) e ESPELHA nos Transforms — render, água e WS
  // seguem intactos. NUNCA espera a GPU; frame sem resultado desenha o
  // estado anterior. O solver da CPU não roda neste demo.
  // PULL SÍNCRONO — decisão final 2026-07-26 após DOIS fixes no runtime não
  // curarem o async em modo janela (Poll genérico E espera dirigida por
  // SubmissionIndex morrem na mesma janela ~3; issue UrubuCode/rts#2007 tem
  // os dados). Com o grid o read síncrono custa 1-2 ms e é à prova de falha:
  // rigApl=300/300 em todas as janelas, frame ~9 ms.
  // ── PASSO FIXO COM ACUMULADOR ────────────────────────────────────────────
  // O kernel integra com `RB_DT` (1/60 s) CRAVADO. Rodá-lo uma vez por frame
  // amarra a simulação à taxa de quadros: a 176 fps o mundo avançava 2,9 s por
  // segundo real, e o castelo desmoronava quase três vezes mais rápido.
  //
  // Agora o tempo real é acumulado e a física dá quantos passos de 1/60 couberem
  // — nem mais, nem menos. O teto de 4 passos é o guarda contra a espiral da
  // morte: se um frame demorar 200 ms, tentar recuperar 12 passos deixaria o
  // frame seguinte ainda mais lento, e o jogo nunca mais alcançaria o relógio.
  // Passar do teto significa perder tempo de mundo, o que é a escolha certa: um
  // jogo que engasga deve ficar em câmera lenta, não travar.
  acumulado = acumulado + dts;
  let passos = 0;
  while (acumulado >= RB_DT && passos < 4) {
    rbStep(1);
    rigApl = rigApl + 1;
    acumulado = acumulado - RB_DT;
    passos = passos + 1;
  }
  if (acumulado > RB_DT * 4.0) acumulado = RB_DT * 4.0;
  {
    const iTrs: Transform[] = scene.trs;
    let mk = 0;
    while (mk < rIdx.length) {
      const t: Transform = iTrs[rIdx[mk]];
      t.px = rbX(mk); t.py = rbY(mk); t.pz = rbZ(mk);
      t.asleep = rbSleep(mk) >= 10.0 ? 1 : 0;
      mk = mk + 1;
    }
    mk = 0;
    while (mk < ballIdx.length) {
      const t: Transform = iTrs[ballIdx[mk]];
      const rb = rIdx.length + mk;
      t.px = rbX(rb); t.py = rbY(rb); t.pz = rbZ(rb);
      mk = mk + 1;
    }
  }
  scene.computeWorld();
  const tf1 = performance.now();
  tFis = tFis + (tf1 - tf0);

  // ── ÁGUA (fachada, relógio próprio): sincroniza os AABBs (a demolição move
  // blocos — sync a cada 2 frames divide o custo) e dá o passo
  if (CD_AGUA !== 0 && frames % 2 === 0) flSyncColliders(scene);
  const tf2 = performance.now();
  tSyn = tSyn + (tf2 - tf1);
  if (CD_AGUA !== 0) flStep(2);
  // agua->bloco DESLIGADO aqui: flApplyForces escreve nos Transforms da CPU e
  // o estado rigido mora na GPU — o acoplamento correto e GPU<->GPU (proximo
  // passo da campanha). bloco->agua segue via colisores espelhados.
  const tf3 = performance.now();
  tAgu = tAgu + (tf3 - tf2);


  if (frames % 300 === 0) {
    let dorm = 0;
    let dq = 0;
    while (dq < scene.objects.length) {
      if (scene.objects[dq].transform.asleep !== 0) dorm = dorm + 1;
      dq = dq + 1;
    }
    // distribuicao de velocidade: quantos abaixo do limiar de sono, o maximo e QUEM
    let lentos = 0;
    let vmx: f64 = 0.0;
    let vmxI = 0;
    let dq2 = 0;
    while (dq2 < scene.objects.length) {
      const tt = scene.objects[dq2].transform;
      const sp2 = tt.vx * tt.vx + tt.vy * tt.vy + tt.vz * tt.vz;
      if (sp2 < 0.09) lentos = lentos + 1;
      if (sp2 > vmx) { vmx = sp2; vmxI = dq2; }
      dq2 = dq2 + 1;
    }
    const tmx = scene.objects[vmxI].transform;
    io.print("[c] f" + frames + " dtMED=" + (math.floor(dtSum / 300.0 * 10.0) / 10.0) + " dtMAX=" + dtMax + " dormindo=" + dorm + " lentos=" + lentos +
             "/" + scene.objects.length + " | vmax=" + (math.floor(math.sqrt(vmx) * 100.0) / 100.0) +
             " " + scene.objects[vmxI].name + " y=" + (math.floor(tmx.py * 100.0) / 100.0) +
             " vy=" + (math.floor(tmx.vy * 100.0) / 100.0));
  }

  // bala que passou da fortaleza volta ao estacionamento do pool
  let rb = 0;
  while (rb < ballIdx.length) {
    const bt: Transform = scene.objects[ballIdx[rb]].transform;
    if (bt.px > 62.0 && bt.py > 0.0 - 17.0) {
      bt.px = 0.0 - 26.0; bt.py = 0.0 - 16.0; bt.pz = 0.0;
      bt.vx = 0.0; bt.vy = 0.0; bt.vz = 0.0;
    }
    rb = rb + 1;
  }

  // ── RENDER ───────────────────────────────────────────────────────────────
  setCam(WIN, S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, CD_FOV, CD_W / CD_H);
  setLgt(WIN, S.lightX, S.lightY, S.lightZ, S.lightAmb);
  setShadow(WIN, 0.0 - S.lightX, 0.0 - S.lightY, 0.0 - S.lightZ, 0.0, 1.0, 0.0, 34.0);
  frustumBegin(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, CD_FOV, CD_W / CD_H);
  const td0 = performance.now();
  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;
  const n = objs.length;
  let drawn = 0;
  let i = 0;
  while (i < n) {
    const o = objs[i];
    const t: Transform = trs[i];
    let rmax: f64 = t.sx;
    if (t.sy > rmax) rmax = t.sy;
    if (t.sz > rmax) rmax = t.sz;
    if (inFrustumFast(t.wx, t.wy, t.wz, rmax * 0.87) !== 0) {
      const col = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
      drawGPU(WIN, o.meshKind, t.wx, t.wy, t.wz, t.wrx, t.wry,
              t.sx, t.sy, t.sz, col, o.emissive, o.tex);
      drawn = drawn + 1;
    }
    i = i + 1;
  }
  S.drawnLast = drawn;
  const td1 = performance.now();
  tDrC = tDrC + (td1 - td0);

  // ÁGUA: backend GPU desenha INSTANCIADO — 1 draw call lendo o buffer da
  // física direto (sem readback, culling de casca no vertex shader). Backend
  // CPU (fallback) cai no laço por partícula de sempre.
  const gb = CD_AGUA !== 0 ? flPosGpuBuf() : 0;
  if (gb !== 0) {
    drawWaterGPU(WIN, gb, CD_NAGUA, 0.32);
  } else {
    let wi = 0;
    while (wi < CD_NAGUA) {
      if (flHidden(wi) === 0) {
        const wx = flX(wi);
        const wy = flY(wi);
        const wz = flZ(wi);
        if (inFrustumFast(wx, wy, wz, 0.35) !== 0) {
          const shade = math.floor(wy * 16.0);
          const wcol = (56 << 16) | ((126 + shade) << 8) | 228;
          drawGPU(WIN, 4, wx, wy, wz, 0.0, 0.0, 0.32, 0.32, 0.32, wcol, 0.0, 0);
        }
      }
      wi = wi + 1;
    }
  }

  tDrA = tDrA + (performance.now() - td1);
  // O ouvinte é a câmera, empurrado na mesma linha do pump para que ganho e som
  // saiam do mesmo instante.
  setListener(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch);
  pumpAudio();
  const te0 = performance.now();

  app.text(14, 12, "CASTELO SOB FOGO E AGUA [" + (flBackend() === 1 ? "agua:GPU" : "agua:CPU") + "] — tiro " + shots + "/" + SHOTS_PER_ROUND + "   fps " + math.floor(app.fps()), 0xD8E8FFFF, 15);
  app.text(14, 34, "WASD voa | botao DIR gira | R reconstroi o castelo", 0x90A8C0FF, 12);
  app.endFrame();
  // LIMITADOR DE FRAME por sono (teto ~60 fps): o que sobrar do orçamento de
  // 16 ms o processo DORME — CPU baixa sem as fences de vblank do vsync.
  const orcamento: f64 = 16.0 - (performance.now() - tf0);
  if (orcamento >= 2.0) time.sleep_ms(orcamento - 1.0);
  {
    const te = performance.now() - te0;
    tFim = tFim + te;
    if (te > tFimMax) tFimMax = te;
  }
  if (frames % 300 === 0) {
    io.print("[t] fisCPU=" + math.floor(tFis / 30.0) / 10.0 +
             " sync=" + math.floor(tSyn / 30.0) / 10.0 +
             " agua=" + math.floor(tAgu / 30.0) / 10.0 +
             " drawCena=" + math.floor(tDrC / 30.0) / 10.0 +
             " drawAgua=" + math.floor(tDrA / 30.0) / 10.0 +
             " endFrame=" + math.floor(tFim / 30.0) / 10.0 +
             " endMAX=" + math.floor(tFimMax) + " rigApl=" + rigApl + "/300 (ms/frame)");
    rigApl = 0;
    dtSum = 0.0; dtMax = 0.0;
    tFis = 0.0; tSyn = 0.0; tAgu = 0.0; tDrC = 0.0; tDrA = 0.0;
    tFim = 0.0; tFimMax = 0.0;
  }
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
}
io.print("[castelo] encerrado apos " + frames + " frames");
app.close();
