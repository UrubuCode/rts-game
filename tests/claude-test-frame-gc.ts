// Sonda de ALOCAÇÃO dos caminhos por quadro tocados na Task 10.5. Rodar com
// RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as
// coletas antes do primeiro marcador são do setup):
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-frame-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Portão: 0 coletas em cada fase. GC_N (padrão 200000) é o número de
// iterações das fases baratas; as fases de painel inteiro (Inspector, Project,
// Hierarquia, jogo) rodam GC_N/20 quadros. Com alocação por chamada, 200k
// iterações dão várias coletas (o heap começa em 64k células); sem, zero.
// Sem janela: os nativos de desenho recebem a janela 0 e não desenham, mas a
// marshalling do TS (o que aloca) é a mesma do editor.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { pincel, caixa, texto, estiloTexto, traco, linha, imagemEm, imagem } from "@compat/draw2d.ts";
import { drawGPUBuf, drawGPUMeshQBuf, DRAW_FLOATS, setCamBuf, frustumBeginBuf, CAM_FLOATS } from "@engine/render/gpu3d";
import { projPt, axisMove, pickAxis, VISTA_FLOATS, GIZMO_FLOATS } from "@editor/gizmo";
import { Inspector } from "@editor/inspector";
import { scene, S } from "@editor/control/session";
import { loadSceneFrom } from "@editor/sceneio";
import { aplicarLuzes, aplicarAmbiente } from "@engine/render/scene_lighting";
import { assetsInit, assetsArea, assetsMouse, drawAssets } from "@editor/assets";
import { drawSceneObjects, prepararDesenho, fParams, DS_FLOATS } from "@engine/render/scenedraw";
import { rigidStep } from "@engine/core/physics_backend";
import { gizmosDoEditor, passeDeGizmosProtegido, pintarGizmos } from "@editor/gizmo_pass";
import { Scene } from "@engine/core/scene";
import { gizmosBegin } from "@engine/core/gizmos";
import { editorIcon, iconAt, drawEditorIcon } from "@editor/icon_images";
import { interpolateSync } from "@engine/core/interpolate";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const nPainel = (n / 20) | 0;

class TestApp {
  _win: number = 0; focus: number = -1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  at(x: number, y: number, w: number, h: number): void {}
  textField(id: number, value: string, enabled: boolean): string { return value; }
  clickableAt(id: number): number { return 0; }
  clickable(x: number, y: number, w: number, h: number): number { return 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  button(label: string): boolean { return false; }
  keyPressed(code: number): number { return 0; }
}

// ── setup (fora das fases) ────────────────────────────────────────────────
const cena = process.env("GC_CENA") === "" ? "scenes/vitrine.json" : process.env("GC_CENA");
loadSceneFrom(cena);
scene.computeWorld();
const app = new TestApp();
const inspector = new Inspector(app);
S.selected = 1;
const d = new Float64Array(DRAW_FLOATS);
d[5] = 1.0; d[6] = 1.0; d[7] = 1.0; d[15] = 1.0;
const vista = new Float64Array(VISTA_FLOATS);
vista[3] = 1.0; vista[5] = 1.0; vista[7] = 600.0; vista[8] = 1200.0; vista[9] = 720.0;
const g = new Float64Array(GIZMO_FLOATS);
g[2] = 50.0; g[5] = 50.0; g[6] = 30.0; g[7] = 30.0; g[8] = 1.0;
const pOut = new Float64Array(3); const pIn = new Float64Array(3);
const cam = new Float64Array(CAM_FLOATS);
cam[1] = 3.0; cam[2] = 0.0 - 12.0; cam[5] = 1.05; cam[6] = 1.6; cam[7] = 0.1; cam[8] = 500.0; cam[10] = 5.0;
const luzCam = new Float64Array(3); const legado = new Float64Array(4);
const cfg = new Float64Array(DS_FLOATS);
const pixels = new Uint8Array(16 * 16 * 4);
assetsInit();
// aquece cada caminho uma vez (caches, rótulos, texturas, strings de 1ª vez)
function painelInspector(): void { inspector.area(910.0, 70.0, 290.0, 650.0); inspector.mouse(0 - 1, 0 - 1, 0, 0); inspector.renderProtegido(app, false, 0, 0); }
function painelProject(): void { assetsArea(250.0, 500.0, 660.0, 200.0); assetsMouse(0 - 1, 0 - 1, 0, 0); drawAssets(0); }
function quadroJogo(): void {
  scene.update(1.0 / 60.0);
  if (rigidStep(scene, 0) === 0) scene.resolveCollisions();
  scene.computeWorld();
  setCamBuf(0, cam); frustumBeginBuf(cam);
  aplicarLuzes(0, scene, luzCam, legado); aplicarAmbiente(0, scene);
  prepararDesenho(cfg, fParams, 0 - 1, 1.0);
  drawSceneObjects(scene, scene.objects.length, 0, cfg);
}
painelInspector(); painelInspector(); painelProject(); painelProject();
let w = 0; while (w < 120) { quadroJogo(); w = w + 1; }

io.print("FASE ui2d " + n);
let i = 0;
while (i < n) {
  pincel(0x40404080, 1, 0x232323FF, 3); caixa(i * 0.001, 1.0, 20.0, 10.0);
  texto(i * 0.001, 2.0, "abc", estiloTexto(0xFFFFFFFF, 12));
  traco(1, 0xFF0000FF); linha(0.0, 0.0, i * 0.001, 5.0);
  imagemEm(1.0, 1.0, 16.0, 16.0); imagem(pixels, 16, 16);
  i = i + 1;
}
io.print("FASE icones " + n);
editorIcon("info"); drawEditorIcon("info");
i = 0;
let nIc = 0;
while (i < n) { if (editorIcon("warning") !== null) nIc = nIc + 1; iconAt(1.0, 1.0, 16.0); drawEditorIcon("info"); i = i + 1; }
io.print("FASE draw3d " + n);
i = 0;
while (i < n) {
  d[0] = i * 0.001; drawGPUBuf(0, 1, d); drawGPUMeshQBuf(0, 1, d);
  i = i + 1;
}
io.print("FASE gizmo " + n);
i = 0;
let soma: f64 = 0.0;
while (i < n) {
  pIn[0] = i * 0.001; pIn[2] = 5.0; projPt(pOut, vista, pIn);
  soma = soma + pOut[0] + axisMove(1.0, 2.0, g, i % 3) + pickAxis(10.0, 10.0, g);
  i = i + 1;
}
io.print("FASE luzes " + n);
i = 0;
while (i < n) { luzCam[0] = i * 0.001; aplicarLuzes(0, scene, luzCam, legado); aplicarAmbiente(0, scene); i = i + 1; }
io.print("FASE gizmos " + nPainel);
const poseGiz = new Float64Array(8);
poseGiz[1] = 3.0; poseGiz[2] = 0.0 - 12.0; poseGiz[5] = 1.05; poseGiz[6] = 1200.0; poseGiz[7] = 720.0;
i = 0;
while (i < nPainel) { gizmosBegin(gizmosDoEditor, poseGiz); passeDeGizmosProtegido(gizmosDoEditor, scene, 1); pintarGizmos(app, 0, gizmosDoEditor); i = i + 1; }
// O `try` do passe protegido (uma chamada por quadro) isolado, em GC_N
// chamadas: numa cena vazia o custo é só o da função que contém o `try`.
const cenaVazia = new Scene("vazia");
io.print("FASE try-gizmos " + n);
i = 0;
while (i < n) { passeDeGizmosProtegido(gizmosDoEditor, cenaVazia, 0 - 1); i = i + 1; }
io.print("FASE inspector " + nPainel);
i = 0;
while (i < nPainel) { painelInspector(); i = i + 1; }
io.print("FASE project " + nPainel);
i = 0;
while (i < nPainel) { painelProject(); i = i + 1; }
io.print("FASE cena-editor " + nPainel);
i = 0;
while (i < nPainel) {
  scene.computeWorld(); interpolateSync(scene);
  setCamBuf(0, cam); frustumBeginBuf(cam);
  prepararDesenho(cfg, fParams, 1, 1.0);
  drawSceneObjects(scene, scene.objects.length, 0, cfg);
  i = i + 1;
}
io.print("FASE update " + nPainel);
i = 0;
while (i < nPainel) { scene.update(1.0 / 60.0); i = i + 1; }
io.print("FASE fisica " + nPainel);
i = 0;
while (i < nPainel) { if (rigidStep(scene, 0) === 0) scene.resolveCollisions(); scene.computeWorld(); i = i + 1; }
io.print("FASE jogo " + nPainel);
i = 0;
while (i < nPainel) { quadroJogo(); i = i + 1; }
io.print("FASE fim " + soma);
