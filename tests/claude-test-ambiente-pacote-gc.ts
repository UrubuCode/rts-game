// Teste de ALOCAÇÃO da Task 10: CicloDoDia, a aba Jogo (faixas, coleta de
// câmeras, seletores de proporção/câmera) e a janela Janela/Ambiente no
// Inspector. Rodar com RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os
// marcadores "FASE" (as coletas antes do primeiro marcador são do setup).
// Portão: ZERO "rts-gc" em todas as fases com GC_N=200000 (1k/10k não pegam
// um vazamento de 1 a 2 objetos por quadro).
//
//   RTS_GC_DEBUG=1 GC_N=200000 rts.exe run tests/claude-test-ambiente-pacote-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: `ciclo` (CicloDoDia.update: sol + cores do céu), `jogo` (areaComFaixas
// + coletarCameras de 2 câmeras + frustum/posição da vista + cameraEscolhida),
// `abas` (WorkspaceViews.tabs na aba Jogo, com os dois seletores) e `janela`
// (Inspector em modo janela com o AmbienteInspector no modo panorama).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import "@engine/generated/components";
import "@engine/generated/editor_extensions";
import { CicloDoDia } from "../assets/pacotes/ambiente/ciclo_do_dia";
import { criarLuzDirecionalPadrao } from "@engine/core/light";
import { Camera } from "@engine/core/camera";
import { VistasDeCamera, coletarCameras, frustumDasVistas, posicaoDaVista } from "@engine/render/camera_views";
import { fParams } from "@engine/render/scenedraw";
import { areaComFaixas } from "@editor/game_view";
import { WorkspaceViews } from "@editor/workspace_views";
import { Inspector } from "@editor/inspector";
import { instalarEditorReal } from "@editor/editor_host";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { scene, S } from "@editor/control/session";
import type { Behavior } from "@engine/core/behavior";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));
class TestApp {
  _win: number = 0; focus: number = -1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  at(x: number, y: number, w: number, h: number): void {}
  textField(id: number, value: string, enabled: boolean): string { return value; }
  clickableAt(id: number): number { return 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}

scene.clear();
criarLuzDirecionalPadrao(scene);
const ciclo = new CicloDoDia(); ciclo.duracao = 60.0;
scene.createGameObject("Relógio").addBehavior(ciclo);
const a = scene.createGameObject("A"); a.addBehavior(new Camera());
const b = scene.createGameObject("B"); const cb = new Camera(); cb.isMain = 0; cb.profundidade = 1.0; cb.viewportW = 0.3; cb.viewportH = 0.3; b.addBehavior(cb);
scene.computeWorld();
scene.ambiente.ceu.modo = "panorama"; scene.ambiente.ceu.textura = "assets/editor/icons/info.png";

const app = new TestApp();
const views = new WorkspaceViews(app);
const inspector = new Inspector(app);
const host = instalarEditorReal();
host.janela = (bh: Behavior, titulo: string) => { inspector.abrirJanela(bh, titulo); };
S.selected = 0; S.selection = [0];
executarItemDeMenu(indiceDoCaminho("Janela/Ambiente"), 0 - 1);
const vistas = new VistasDeCamera(); const area = new Float64Array(4); const luzCam = new Float64Array(3);
area[0] = 250.0; area[1] = 97.0; area[2] = 660.0; area[3] = 400.0;
vistas.tela[0] = 1200.0; vistas.tela[1] = 720.0;
S.gameView = 1; views.game = true; S.gameAspect = 1; S.gameCamera = null;

const dt = 1.0 / 60.0;
// aquece fora das fases
ciclo.update(dt);
areaComFaixas(area, 16.0 / 9.0, vistas.area); coletarCameras(vistas, scene, views.cameraEscolhida());
views.tabs(250.0, 70.0, 500.0, false);
inspector.area(910.0, 70.0, 290.0, 650.0); inspector.mouse(0 - 1, 0 - 1, 0, 0); inspector.render(app, false, 0, 0);
io.print("aquecido: vistas " + vistas.n + " janela " + (inspector.janela !== null ? 1 : 0) + " controles " + inspector.ui.controls.length);

io.print("FASE ciclo " + n);
let f = 0;
while (f < n) { ciclo.update(dt); f = f + 1; }
io.print("FASE jogo");
f = 0;
while (f < n) {
  areaComFaixas(area, 16.0 / 9.0, vistas.area);
  const nv = coletarCameras(vistas, scene, views.cameraEscolhida());
  if (nv > 0) { posicaoDaVista(vistas, luzCam); frustumDasVistas(vistas, fParams); }
  f = f + 1;
}
io.print("FASE abas");
f = 0;
while (f < n) { views.tabs(250.0, 70.0, 500.0, false); f = f + 1; }
// referência: as mesmas abas na aba Cena (4 botões, sem os seletores)
views.game = false;
io.print("FASE abascena");
f = 0;
while (f < n) { views.tabs(250.0, 70.0, 500.0, false); f = f + 1; }
views.game = true;
io.print("FASE janela");
f = 0;
while (f < n) { inspector.area(910.0, 70.0, 290.0, 650.0); inspector.mouse(0 - 1, 0 - 1, 0, 0); inspector.render(app, false, 0, 0); f = f + 1; }
// referência: o Inspector normal com um objeto com Camera (GUI própria), sem janela
inspector.janela = null; S.selected = 3; S.selection = [3];
inspector.area(910.0, 70.0, 290.0, 650.0); inspector.mouse(0 - 1, 0 - 1, 0, 0); inspector.render(app, false, 0, 0);
io.print("FASE inspetor");
f = 0;
while (f < n) { inspector.area(910.0, 70.0, 290.0, 650.0); inspector.mouse(0 - 1, 0 - 1, 0, 0); inspector.render(app, false, 0, 0); f = f + 1; }
// marcador constante: a concatenação do resumo não cai numa fase medida
io.print("FASE fim");
io.print("resumo " + ciclo.hora + " " + vistas.n + " " + scene.ambiente.ceu.topo[0] + " " + inspector.ui.controls.length);
