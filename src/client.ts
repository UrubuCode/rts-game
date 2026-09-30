// ═══════════════════════════════════════════════════════════════════════════
// FPS do rts-game: cliente com janela (entrega 1, local contra bots).
//
//   ../rts/target/release/examples/ui_fixture.exe src/client.ts
//
// Este arquivo só lê teclado e mouse, monta um FpsPlayerInput por frame,
// chama FpsWorld.passo em tick fixo e desenha. Toda regra de jogo está em
// src/shared/, que não conhece janela.
// ═══════════════════════════════════════════════════════════════════════════
import io from "@compat/io.ts";
import { createAppAt } from "@compat/app.ts";
import { scene, S } from "@editor/control/session";
import { ctrlServe, ctrlPoll } from "@editor/control/server";
import fs from "@compat/fs.ts";
import process from "@compat/process.ts";
import { initMeshes, winWidth, winHeight, setVsync } from "@engine/render/gpu3d";
import { profFrameBegin, profFrameEnd, profSection, secBegin, secEnd } from "@engine/core/profiler";
import { FpsWorld } from "./shared/world";
import { FpsPlayerInput } from "./shared/input";
import { FpsHud } from "./hud";
import { FpsEntrada, FPS_TECLA_F3, FPS_TECLA_N, FPS_TECLA_M } from "./entrada";
import { fpsPrepararCamera, fpsDesenharCena, fpsCamera,
         FPS_CAM_X, FPS_CAM_Y, FPS_CAM_Z, FPS_CAM_YAW, FPS_CAM_PITCH, FPS_CAM_ASPECTO } from "./render";
import { fpsCarregarModelos } from "./modelos";
import { fpsDesenharArmaNaTela, fpsDesenharEfeitos } from "./efeitos";
import { FpsAnimacao } from "./animacao";
import {
  FPS_TICK_DT, FPS_MAX_TICKS_POR_FRAME, FPS_SEMENTE_PADRAO, FPS_BOTS_PADRAO, FPS_ALTURA_OLHO,
} from "./shared/config";
import { initAudio } from "@engine/audio/audio";
import { FpsSom, fpsSomIniciar, fpsSomQuadro, fpsSomAlternarMusica } from "./som";

// ── câmera ───────────────────────────────────────────────────────────────────
const FPS_ALTURA_CAMERA_MORTO: f64 = 4.0;
const FPS_DT_MAX: f64 = 0.25;
const FPS_JANELA_MIN = 200;
const FPS_TECLA_MUSICA = 115; // P

let fpsW = 1280;
let fpsH = 720;
const fpsApp = createAppAt("rts-game FPS", fpsW, fpsH, 60, 40);
const FPS_WIN = fpsApp._win;
initMeshes(FPS_WIN);
setVsync(FPS_WIN, 1);
// RTS_VSYNC=0 no ambiente: sem vsync, para medir o custo real do quadro (como o game.ts do motor).
if (process.env("RTS_VSYNC") === "0") setVsync(FPS_WIN, 0);
// Comandos da porta de controle que agem na janela (vsync, shot) usam a da sessão.
S.win = FPS_WIN;
fpsCarregarModelos(FPS_WIN);
// Porta de controle por WebSocket (agentes dirigem o jogo): só com
// `config/controle.json` presente. O .exe distribuído vai sem esse arquivo,
// então quem recebe o jogo não fica com uma porta de controle aberta.
const FPS_CONTROLE_ARQUIVO = "config/controle.json";
const FPS_CONTROLE_PORTA_PADRAO = 7777;
let fpsControle = 0;
if (fs.exists(FPS_CONTROLE_ARQUIVO)) {
  let porta = FPS_CONTROLE_PORTA_PADRAO;
  try {
    const cfg = JSON.parse(fs.read_text(FPS_CONTROLE_ARQUIVO));
    if (typeof cfg.porta === "number") porta = cfg.porta;
  } catch (e) { io.print("[controle] " + FPS_CONTROLE_ARQUIVO + " invalido; usando a porta " + porta); }
  ctrlServe(porta);
  fpsControle = 1;
}

const fpsMundo = new FpsWorld(scene, FPS_SEMENTE_PADRAO, 1.0);
const FPS_HUMANO = fpsMundo.adicionarJogador(false);
// Som: sem placa de som, `initAudio` devolve 0 e o jogo segue mudo.
initAudio();
const fpsSom = new FpsSom();
fpsSomIniciar(fpsSom, FPS_HUMANO);
let fpsB = 0;
while (fpsB < FPS_BOTS_PADRAO) { fpsMundo.adicionarJogador(true); fpsB = fpsB + 1; }
io.print("[fps] mapa com " + fpsMundo.mapa.objetos + " estaticos, " + FPS_BOTS_PADRAO + " bots. Clique para jogar.");

const fpsEntrada = new FpsEntrada(fpsMundo.jogadores[FPS_HUMANO].yaw);
const fpsInputs: FpsPlayerInput[] = [fpsEntrada.inp];
let fpsDebug = 0;
let fpsAcumulador: f64 = 0.0;
let fpsUltimo: f64 = performance.now();
let fpsMsSimFrame: f64 = 0.0;
let fpsMsRender: f64 = 0.0;
let fpsDesenhados = 0;
let fpsMsAnim: f64 = 0.0;
let fpsUltimoQuadro: f64 = performance.now();
/// Personagens animados (Skeleton + Animator por jogador, fora da cena).
const fpsAnim = new FpsAnimacao();
if (fpsAnim.erro !== "") io.print("[animacao] " + fpsAnim.erro + "; personagens viram caixas");
fpsAnim.subirModelos(FPS_WIN);
const fpsHudLocal = new FpsHud();
// seções do profiler (`prof on` na porta de controle); desligado, cada par custa um `if`
const FPS_SEC_SIM = profSection("fps.sim");
const FPS_SEC_RENDER = profSection("fps.render");
const FPS_SEC_HUD = profSection("fps.hud");
const FPS_SEC_ANIM = profSection("fps.anim");
const FPS_SEC_PERSONAGENS = profSection("fps.personagens");
const FPS_SEC_FIM = profSection("fps.endFrame");
const FPS_SEC_SOM = profSection("fps.som");

function fpsLerEntrada(): void {
  fpsEntrada.ler(fpsApp, FPS_WIN);
  if (fpsApp.keyPressed(FPS_TECLA_F3) !== 0) fpsDebug = 1 - fpsDebug;
  if (fpsApp.keyPressed(FPS_TECLA_MUSICA) !== 0) fpsSomAlternarMusica(fpsSom);
  if (fpsApp.keyPressed(FPS_TECLA_N) !== 0) fpsMundo.adicionarJogador(true);
  if (fpsApp.keyPressed(FPS_TECLA_M) !== 0) fpsMundo.removerUltimoBot();
}

function fpsSimular(): void {
  const agora = performance.now();
  let dt = (agora - fpsUltimo) / 1000.0;
  fpsUltimo = agora;
  if (dt > FPS_DT_MAX) dt = FPS_DT_MAX;
  fpsAcumulador = fpsAcumulador + dt;
  const t0 = performance.now();
  let ticks = 0;
  while (fpsAcumulador >= FPS_TICK_DT && ticks < FPS_MAX_TICKS_POR_FRAME) {
    fpsMundo.passo(fpsInputs);
    // bordas (tecla apertada neste frame) valem um tick só
    fpsEntrada.consumirBordas();
    fpsAcumulador = fpsAcumulador - FPS_TICK_DT;
    ticks = ticks + 1;
  }
  if (ticks === FPS_MAX_TICKS_POR_FRAME) fpsAcumulador = 0.0;
  fpsMsSimFrame = performance.now() - t0;
}

/// Estado de cada jogador -> personagem animado (o humano não se vê: primeira pessoa).
function fpsAnimar(dt: f64): void {
  const js = fpsMundo.jogadores;
  const n = js.length;
  const a = fpsAnim;
  a.garantir(n);
  let j = 0;
  while (j < n) {
    const p = js[j];
    a.x[j] = p.x; a.y[j] = p.y; a.z[j] = p.z; a.yaw[j] = p.yaw;
    a.vel[j] = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    a.vivo[j] = p.vivo ? 1 : 0;
    a.disparos[j] = p.disparos;
    a.visivel[j] = j !== FPS_HUMANO ? 1 : 0;
    j = j + 1;
  }
  a.passo(n, dt);
}

function fpsDesenharMundo(): void {
  const eu = fpsMundo.jogadores[FPS_HUMANO];
  const camY = eu.vivo ? eu.y + FPS_ALTURA_OLHO : eu.y + FPS_ALTURA_CAMERA_MORTO;
  const cam = fpsCamera;
  cam[FPS_CAM_X] = eu.x; cam[FPS_CAM_Y] = camY; cam[FPS_CAM_Z] = eu.z;
  cam[FPS_CAM_YAW] = fpsEntrada.yaw; cam[FPS_CAM_PITCH] = fpsEntrada.pitch; cam[FPS_CAM_ASPECTO] = fpsW / fpsH;
  fpsPrepararCamera(FPS_WIN, cam);
  fpsDesenhados = fpsDesenharCena(FPS_WIN, scene, fpsMundo.corpos[FPS_HUMANO]);
  secBegin(FPS_SEC_PERSONAGENS);
  fpsDesenhados = fpsDesenhados + fpsAnim.desenharTodos(FPS_WIN, fpsMundo.jogadores.length);
  secEnd(FPS_SEC_PERSONAGENS);
  if (eu.vivo) fpsDesenharArmaNaTela(FPS_WIN, cam);
  fpsDesenharEfeitos(FPS_WIN, fpsMundo);
}

function fpsQuadro(): void {
  const nw = winWidth(FPS_WIN);
  const nh = winHeight(FPS_WIN);
  if (nw > FPS_JANELA_MIN) fpsW = nw;
  if (nh > FPS_JANELA_MIN) fpsH = nh;
  fpsLerEntrada();
  secBegin(FPS_SEC_SIM);
  fpsSimular();
  secEnd(FPS_SEC_SIM);
  if (fpsControle !== 0) ctrlPoll(fpsW, fpsH);
  const tq = performance.now();
  let dtQuadro = (tq - fpsUltimoQuadro) / 1000.0;
  fpsUltimoQuadro = tq;
  if (dtQuadro > FPS_DT_MAX) dtQuadro = FPS_DT_MAX;
  secBegin(FPS_SEC_ANIM);
  fpsAnimar(dtQuadro);
  fpsMsAnim = performance.now() - tq;
  secEnd(FPS_SEC_ANIM);
  secBegin(FPS_SEC_RENDER);
  const t1 = performance.now();
  fpsDesenharMundo();
  fpsMsRender = performance.now() - t1;
  secEnd(FPS_SEC_RENDER);
  const pose = fpsSom.pose;
  pose[0] = fpsCamera[FPS_CAM_X]; pose[1] = fpsCamera[FPS_CAM_Y]; pose[2] = fpsCamera[FPS_CAM_Z];
  pose[3] = fpsCamera[FPS_CAM_YAW]; pose[4] = fpsCamera[FPS_CAM_PITCH];
  secBegin(FPS_SEC_SOM);
  fpsSomQuadro(fpsSom, fpsMundo, pose, dtQuadro);
  secEnd(FPS_SEC_SOM);
  secBegin(FPS_SEC_HUD);
  const eu = fpsMundo.jogadores[FPS_HUMANO];
  const hud = fpsHudLocal;
  hud.w = fpsW; hud.h = fpsH; hud.travado = fpsEntrada.travado; hud.debug = fpsDebug;
  hud.musicaMuda = fpsSom.musicaMuda;
  hud.fps = fpsApp.fps(); hud.agoraMs = t1;
  hud.msSim = fpsMsSimFrame; hud.msRender = fpsMsRender; hud.msAnim = fpsMsAnim; hud.desenhados = fpsDesenhados; hud.objetos = scene.objects.length;
  hud.desenhar(eu, fpsMundo);
  secEnd(FPS_SEC_HUD);
  secBegin(FPS_SEC_FIM);
  fpsApp.endFrame();
  secEnd(FPS_SEC_FIM);
}

while (fpsApp.running()) {
  if (!fpsApp.beginFrame()) break;
  // quadro medido pelo profiler do motor (`prof on` / `prof frames` na porta de controle)
  profFrameBegin();
  fpsQuadro();
  profFrameEnd();
}
io.print("[fps] encerrado");
fpsApp.close();
