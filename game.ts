// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — RUNTIME DO JOGO (o entrypoint da BUILD).
//
// É o que o botão "Build" compila: `rts.exe compile game.ts MeuJogo.exe`.
// Diferente do main.ts (o EDITOR), aqui NÃO há hierarquia, inspector, Project,
// gizmo nem porta de controle — só carrega a cena, roda os scripts e renderiza.
// O jogador recebe um .exe que abre direto no jogo.
//
// A cena carregada é a `assets/scene.json` (a que o editor salva com "Salvar").
// O build copia os assets junto; ver tools/build.ts.
//
//   rts.exe run game.ts        → testa o runtime sem compilar
//   rts.exe compile game.ts    → gera o .exe distribuível
// ═══════════════════════════════════════════════════════════════════════════
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { logTick } from "@engine/core/logger";
import process from "@compat/process.ts";
import { setVsync } from "rts:egui";
import { benchInit, benchFrameBegin, benchCpuEnd, benchFrameEnd } from "@engine/core/frame_bench";
// `createAppAt` era um GLOBAL do motor antigo, e este arquivo era o ultimo a
// ainda contar com isso — `main.ts` ja importava do shim. No motor novo nada e
// global sem alguem instalar.
import { createAppAt } from "@compat/app.ts";
import { tituloJanela, janelaX, janelaY } from "@engine/core/janela_env";

import { scene, S } from "@editor/control/session";
import { Transform } from "@engine/core/transform";
import { loadSceneFrom } from "@editor/sceneio";
import { drawGameUI } from "@engine/ui/game_ui";
import { rigidStep } from "@engine/core/physics_backend";
import { resolveMaterialTexture } from "@engine/render/material_tex";
import { GameObject } from "@engine/core/gameobject";
import { initMeshes, setCamBuf, drawGPUMeshBuf, meshIdFor, setFundoCeu, setViewportBuf,
         frustumBeginBuf, frustumParams, inFrustumFast, winWidth, winHeight, CAM_FLOATS, CAM_ORTO_PADRAO,
         FRUSTUM_NEAR_PADRAO, FRUSTUM_FAR_PADRAO, DRAW_FLOATS, D_X, D_Y, D_Z, D_RX, D_RY, D_SX, D_SY, D_SZ,
         D_COR, D_EMISSIVO, D_TEX, D_TILE } from "@engine/render/gpu3d";
import { aplicarLuzes, aplicarAmbiente } from "@engine/render/scene_lighting";
import { Camera } from "@engine/core/camera";
import { definirJanelaEntrada } from "@engine/core/entrada";
import { vooDoJogo, VOO_POSE_FLOATS } from "@engine/core/voo_livre";
import { VistasDeCamera, coletarCameras, aplicarVistas, frustumDasVistas,
         posicaoDaVista } from "@engine/render/camera_views";
import { initAudio, audioEntrarJogo } from "@engine/audio/audio";
import { audioQuadro, definirPoseEditor, Audio } from "@engine/audio/audio_system";
import { carregarMixer, MIXER_ARQUIVO } from "@engine/audio/mixer_grupos";
import { configUsuario } from "@engine/core/config_usuario";
import { coroutineResume } from "@engine/core/coroutine_scheduler";

// ── janela do JOGO (sem os painéis do editor: a tela toda é o jogo) ─────────
let W = 1280;
let H = 720;
const app = createAppAt(tituloJanela("RTS Game"), W, H, janelaX(100), janelaY(60));
const WIN = app._win;

const FOV: f64 = 1.05;

// Cena a carregar: a que o editor salvou. Fallback pros demos do repo, pro
// runtime rodar mesmo num checkout limpo.
let sceneFile = "assets/scene.json";
// Sem cena salva, a build abre na VITRINE: física com blocos girados, eventos
// de contato, gatilho e HUD — o que o RTS entrega hoje (tools/gerar-vitrine.ts).
if (!fs.exists(sceneFile)) sceneFile = "scenes/vitrine.json";
if (!fs.exists(sceneFile)) sceneFile = "scenes/shadowdemo.json";
if (!fs.exists(sceneFile)) sceneFile = "scenes/solar.json";

S.win = WIN;
definirJanelaEntrada(WIN);
// RTS_VSYNC=0 no ambiente: sem vsync, para medir o custo real do quadro (como no editor).
if (process.env("RTS_VSYNC") === "0") setVsync(WIN, 0);
benchInit();
initMeshes(WIN);
// Config do USUÁRIO (por máquina/instalação, `config/usuario.json` — nunca a
// cena): a calibração de latência de áudio, ANTES do áudio começar, pra não
// perder amostra nenhuma do relógio já corrigido.
configUsuario.carregar();
if (configUsuario.error !== "") io.print("[jogo] " + configUsuario.error);
Audio.latenciaCalibrada = configUsuario.audioLatenciaMs;
// Áudio antes da cena: no jogo não há botão Play, então `playOnAwake` toca no
// mount da carga. Sem placa de som, `initAudio` devolve 0 e o jogo segue mudo.
initAudio();
const erroMixer = carregarMixer(MIXER_ARQUIVO);
if (erroMixer !== "") io.print("[jogo] " + erroMixer);
audioEntrarJogo();
if (fs.exists(sceneFile)) {
  loadSceneFrom(sceneFile);
  io.print("[jogo] cena '" + sceneFile + "' com " + scene.count() + " objetos");
} else {
  // Sem cena o jogo abriria numa tela vazia sem explicação. As pastas 'assets/'
  // e 'scenes/' têm que estar AO LADO do .exe — o jogo lê a cena do disco.
  io.print("[ERRO] nenhuma cena encontrada. As pastas 'assets/' e 'scenes/'");
  io.print("       precisam ficar ao lado do executavel.");
}

// câmera de jogo: começa na posição salva na sessão (mesma default do editor)
let frames = 0;
const vistas = new VistasDeCamera();
const luzCam = new Float64Array(3); const luzLegada = new Float64Array(4);
const fParams: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
// Buffers do quadro, reaproveitados (Task 10.5: sem chamadas de 5+ parâmetros no laço).
const camLivre = new Float64Array(CAM_FLOATS);
camLivre[7] = FRUSTUM_NEAR_PADRAO; camLivre[8] = FRUSTUM_FAR_PADRAO; camLivre[10] = CAM_ORTO_PADRAO;
const drawBuf = new Float64Array(DRAW_FLOATS);
const posSelf = new Float64Array(3);
const poseSessao = new Float64Array(VOO_POSE_FLOATS);

async function frame(): Promise<void> {
  logTick();
  benchFrameBegin();
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) W = nw;
  if (nh > 300) H = nh;
  let dt: f64 = app.delta();
  if (dt > 100) dt = 100;
  const dts: f64 = dt / 1000.0;
  frames = frames + 1;

  // ── CÂMERA DA CENA: o jogo renderiza por todas as câmeras ativas (ver o
  // bloco de render); o controle de voo move a Main (Camera.main()). Se a cena
  // não tiver nenhuma, cai na câmera livre da sessão — assim uma cena antiga
  // ainda abre.
  const camMain = Camera.main();
  const camGo = camMain !== null ? camMain.owner : null;

  // ── CONTROLE: os mesmos controles de voo do editor (WASD + setas + botão dir),
  // NO TRANSFORM do objeto-câmera (quando há um) — a menos que um script do
  // objeto já controle a câmera (pacote camera/): aí só ele move (voo_livre.ts).
  // Sem câmera, a pose livre da sessão.
  poseSessao[0] = S.camX; poseSessao[1] = S.camY; poseSessao[2] = S.camZ;
  poseSessao[3] = S.camYaw; poseSessao[4] = S.camPitch;
  vooDoJogo(camGo, poseSessao, dts);
  if (camGo === null) {
    S.camX = poseSessao[0]; S.camY = poseSessao[1]; S.camZ = poseSessao[2];
    S.camYaw = poseSessao[3]; S.camPitch = poseSessao[4];
  }

  // ── GAMEPLAY: no jogo os scripts rodam SEMPRE (não há botão Play/Pause) ────
  scene.update(dts);
  // Retoma as corrotinas prontas deste quadro (engine/core/coroutine_scheduler.ts) —
  // DEPOIS do Update, como a Unity ("yield return null" retoma antes do
  // próximo Update). Precisa de um `await` de verdade aqui: o motor só drena
  // continuações pendentes num checkpoint real (ver o cabeçalho do módulo).
  await coroutineResume();
  // Mesmo decisor do editor (main.ts): Rust/GPU quando servem, CPU quando o
  // backend recusa (casca, offset, eventos de contato, caixa girada).
  if (rigidStep(scene, 0) === 0) scene.resolveCollisions();
  scene.computeWorld();

  // Sem câmera na cena, o ouvido é a câmera livre da sessão (o último recurso;
  // um script que chame Audio.setListenerPose vence).
  if (camGo === null) definirPoseEditor(poseSessao);
  audioQuadro(scene, dts);

  // ── RENDER pelas câmeras da cena ─────────────────────────────────────────
  // Depois do computeWorld: se a câmera for FILHA de outro objeto, a pose de
  // mundo já está resolvida (uma câmera presa a um veículo segue o veículo).
  // Cada câmera ativa vira uma vista (viewport + fundo + câmera), em ordem de
  // profundidade; a fila de desenho abaixo é uma só para todas.
  vistas.area[0] = 0.0; vistas.area[1] = 0.0; vistas.area[2] = W; vistas.area[3] = H;
  vistas.tela[0] = W; vistas.tela[1] = H;
  const nVistas = coletarCameras(vistas, scene, null);
  if (nVistas > 0) {
    aplicarVistas(WIN, vistas);
    frustumDasVistas(vistas, fParams);
    posicaoDaVista(vistas, luzCam);
  } else {
    // cena sem câmera: a câmera livre da sessão, como antes
    // (vista de tela cheia: um frame anterior com câmeras pode ter deixado um retângulo menor)
    vistas.vpBuf[0] = 0.0; vistas.vpBuf[1] = 0.0; vistas.vpBuf[2] = 1.0; vistas.vpBuf[3] = 1.0; vistas.vpBuf[4] = 1.0;
    setViewportBuf(WIN, vistas.vpBuf);
    setFundoCeu(WIN);
    camLivre[0] = S.camX; camLivre[1] = S.camY; camLivre[2] = S.camZ; camLivre[3] = S.camYaw; camLivre[4] = S.camPitch;
    camLivre[5] = FOV; camLivre[6] = W / H;
    setCamBuf(WIN, camLivre);
    frustumBeginBuf(camLivre);
    frustumParams(fParams);
    luzCam[0] = S.camX; luzCam[1] = S.camY; luzCam[2] = S.camZ;
  }
  luzLegada[0] = S.lightX; luzLegada[1] = S.lightY; luzLegada[2] = S.lightZ; luzLegada[3] = S.lightAmb;
  aplicarLuzes(WIN, scene, luzCam, luzLegada);
  aplicarAmbiente(WIN, scene);   // DEPOIS de aplicarLuzes: usa ultimaN/luzBuf de lá como fallback do sol
  let oi = 0;
  let drawnN = 0;
  const objs: GameObject[] = scene.objects;   // tipado: campos por offset constante
  const objsN = objs.length;
  while (oi < objsN) {
    const o = objs[oi];
    // renderer que se desenha sozinho (Skeleton): pula o desenho por meshKind
    if (o.active !== 0 && o.rendIdx >= 0 && o.behaviors[o.rendIdx].drawsSelf() !== 0) {
      posSelf[0] = o.transform.wx; posSelf[1] = o.transform.wy; posSelf[2] = o.transform.wz;
      if (o.behaviors[o.rendIdx].drawSelf(WIN, posSelf, 0 - 1) !== 0) { drawnN = drawnN + 1; oi = oi + 1; continue; }
    }
    let meshKind = o.meshKind;
    let customMesh = o.customMesh;
    if (o.rendIdx >= 0) {
      const r = o.behaviors[o.rendIdx];
      meshKind = r.rMeshKind() | 0;
      customMesh = r.rCustomMesh() | 0;
    }
    if (o.active !== 0 && (meshKind !== 0 || customMesh > 0)) {
      // hoista o transform: `o.transform.X` repetido vira um acesso aninhado
      // de propriedade por leitura (ver o mesmo padrão no main.ts)
      const tr: Transform = o.transform;
      let rmax: f64 = tr.sx;
      if (tr.sy > rmax) rmax = tr.sy;
      if (tr.sz > rmax) rmax = tr.sz;
      const vis = fParams[7] < 0.0 ? 1 : inFrustumFast(tr.wx, tr.wy, tr.wz, rmax * 0.87);
      if (vis !== 0) {
        const col = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
        let texArg = o.tex;
        if (o.textureId > 0) texArg = o.textureId;
        let emisArg = o.emissive;
        let tileArg = 0.0;
        if (o.matIdx >= 0) {
          const m = o.behaviors[o.matIdx];
          const tid = resolveMaterialTexture(WIN, m);
          tileArg = m.matTile();
          if (tid > 0) texArg = tid; else texArg = m.matTexMode();
          emisArg = m.matEmissive();
        }
        const d = drawBuf;
        d[D_X] = tr.wx; d[D_Y] = tr.wy; d[D_Z] = tr.wz; d[D_RX] = tr.wrx; d[D_RY] = tr.wry;
        d[D_SX] = tr.sx; d[D_SY] = tr.sy; d[D_SZ] = tr.sz;
        d[D_COR] = col; d[D_EMISSIVO] = emisArg; d[D_TEX] = texArg; d[D_TILE] = tileArg;
        drawGPUMeshBuf(WIN, customMesh > 0 ? customMesh : meshIdFor(meshKind), d);
        drawnN = drawnN + 1;
      }
    }
    oi = oi + 1;
  }
  S.drawnLast = drawnN;
  // ── UI do jogo (UIText/UIButton da cena) por cima do 3D ─────────────────
  drawGameUI(scene, WIN, W, H);
  benchCpuEnd();
  app.endFrame();
}

while (app.running()) {
  if (!app.beginFrame()) break;
  await frame();
  if (benchFrameEnd() !== 0) break;
}
io.print("[jogo] encerrado apos " + frames + " frames");
app.close();
