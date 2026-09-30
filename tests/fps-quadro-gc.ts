// Sonda de ALOCAÇÃO dos caminhos por quadro do cliente (HUD, câmera, cena,
// efeitos e personagens animados). Sem janela: os nativos de desenho recebem a
// janela 0 e não desenham, mas a marshalling do TS (o que aloca) é a mesma.
// Rodar com RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores FASE
// (as de antes do primeiro são do setup):
//
//   RTS_GC_DEBUG=1 rts.exe run tests/fps-quadro-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Portão: 0 coletas em cada fase. GC_N (padrão 200000) é o número de
// iterações das fases baratas; a dos personagens (13 animados e desenhados por
// quadro) roda GC_N/10 quadros e a da cena (≈3000 objetos por quadro), GC_N/200.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsInputVazio, FpsPlayerInput } from "../src/shared/input";
import { FPS_SEMENTE_PADRAO, FPS_BOTS_PADRAO, FPS_EFEITO_TRACADOR, FPS_EFEITO_EXPLOSAO, FPS_EFEITO_MARCA } from "../src/shared/config";
import { FpsHud } from "../src/hud";
import { fpsPrepararCamera, fpsDesenharCena, fpsCamera, FPS_CAM_X, FPS_CAM_Y, FPS_CAM_Z } from "../src/render";
import { fpsDesenharEfeitos } from "../src/efeitos";
import { FpsAnimacao } from "../src/animacao";
import { fpsModelos, FpsModelo } from "../src/modelos";
import { initAudio, AUDIO_NULO } from "@engine/audio/audio";
import { FpsSom, fpsSomIniciar, fpsSomQuadro } from "../src/som";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const nCena = (n / 200) | 0;

const sc = new Scene("gc");
const mundo = new FpsWorld(sc, FPS_SEMENTE_PADRAO, 1.0);
mundo.adicionarJogador(false);
let b = 0;
while (b < FPS_BOTS_PADRAO) { mundo.adicionarJogador(true); b = b + 1; }
const inps: FpsPlayerInput[] = [fpsInputVazio()];
let k = 0;
while (k < 30) { mundo.passo(inps); k = k + 1; }
const eu = mundo.jogadores[0];
fpsCamera[FPS_CAM_X] = eu.x; fpsCamera[FPS_CAM_Y] = eu.y + 1.6; fpsCamera[FPS_CAM_Z] = eu.z;
// efeitos vivos para a fase de efeitos
mundo.adicionarEfeito(FPS_EFEITO_TRACADOR, 0.0, 1.0, 0.0, 10.0, 1.0, 0.0, 1000.0);
mundo.adicionarEfeito(FPS_EFEITO_EXPLOSAO, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1000.0);
mundo.adicionarEfeito(FPS_EFEITO_MARCA, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1000.0);

// personagens: 13 vagas (humano + 12 bots) andando, atirando e morrendo; uma
// "arma" de uma parte para o caminho do desenho da arma no osso também rodar
const arma = new FpsModelo();
arma.malhas.push(1); arma.texturas.push(0); arma.cores.push(0xFFFFFF);
fpsModelos.armas.push(arma); fpsModelos.pronto = true;
const anim = new FpsAnimacao();
const nAnim = mundo.jogadores.length;
anim.garantir(nAnim);
function fpsGcAnimar(f: number): void {
  let j = 0;
  while (j < nAnim) {
    anim.x[j] = j * 2.0; anim.y[j] = 0.0; anim.z[j] = 5.0; anim.yaw[j] = j * 0.3;
    anim.vel[j] = ((f + j * 7) % 90) * 0.1;          // 0..8,9 u/s: idle, walk, sprint e misturas
    anim.vivo[j] = (f + j * 13) % 600 < 540 ? 1 : 0;  // morre e renasce
    if ((f + j) % 30 === 0) anim.disparos[j] = anim.disparos[j] + 1;
    anim.visivel[j] = 1;
    j = j + 1;
  }
  anim.passo(nAnim, 1.0 / 60.0);
  fpsGcPersonagens = anim.desenharTodos(0, nAnim);
}
let fpsGcPersonagens = 0;
const hud = new FpsHud();
hud.fps = 60.0;
// aquece: rótulos montados uma vez, aparências da cena resolvidas
hud.desenhar(eu, mundo);
fpsPrepararCamera(0, fpsCamera);
fpsDesenharCena(0, sc, null);
fpsGcAnimar(0);

io.print("FASE hud " + n);
let f = 0;
while (f < n) {
  hud.agoraMs = f * 16.0;   // o intervalo de remontagem passa, os valores não mudam
  hud.desenhar(eu, mundo);
  f = f + 1;
}
io.print("FASE camera " + n);
f = 0;
while (f < n) { fpsPrepararCamera(0, fpsCamera); f = f + 1; }
io.print("FASE efeitos " + n);
f = 0;
while (f < n) { fpsDesenharEfeitos(0, mundo); f = f + 1; }
const nAnimQ = (n / 10) | 0;
io.print("FASE anim " + nAnimQ);
f = 0;
while (f < nAnimQ) { fpsGcAnimar(f); f = f + 1; }
io.print("FASE cena " + nCena + " (personagens desenhados por quadro na fase anim: " + fpsGcPersonagens + ")");
let desenhados = 0;
f = 0;
while (f < nCena) { desenhados = fpsDesenharCena(0, sc, null); f = f + 1; }

initAudio(AUDIO_NULO);
const somGc = new FpsSom();
fpsSomIniciar(somGc, 0);
const poseGc = somGc.pose;
io.print("FASE som " + n);
let fs2 = 0;
while (fs2 < n) {
  if ((fs2 % 50) === 0) mundo.adicionarEfeito(FPS_EFEITO_TRACADOR, 1.0, 1.0, 1.0, 5.0, 1.0, 1.0, 0.08);
  mundo.jogadores[0].x = mundo.jogadores[0].x + 0.01;
  fpsSomQuadro(somGc, mundo, poseGc, 0.016);
  fs2 = fs2 + 1;
}
io.print("FASE fim (desenhados por quadro: " + desenhados + ")");
