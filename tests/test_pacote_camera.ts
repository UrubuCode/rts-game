// Teste SEM JANELA do pacote camera/: matemática dos controles (FPS, órbita,
// amortecimento crítico, zoom), os componentes rodando sem entrada, o item
// Criar/Câmera, os comandos `camera`/`cameras` e o gizmo da câmera.
//   rts.exe run tests/test_pacote_camera.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { olharFps, orbitaPose, amortecerCritico, limitarZoom, PITCH_LIMITE_FPS } from "../assets/pacotes/camera/camera_matematica";
import { CameraOrbita } from "../assets/pacotes/camera/camera_orbita";
import { CameraSeguir } from "../assets/pacotes/camera/camera_seguir";
import { CameraRTS } from "../assets/pacotes/camera/camera_rts";
import { CameraPrimeiraPessoa } from "../assets/pacotes/camera/camera_primeira_pessoa";
import { vooDoJogo, VOO_VELOCIDADE, VOO_POSE_FLOATS } from "@engine/core/voo_livre";
import { simularTecla, TECLA_W } from "@engine/core/entrada";
import { Camera } from "@engine/core/camera";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { OBJECT_PRESET_LABELS } from "@editor/object_presets";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { gizmosBegin } from "@engine/core/gizmos";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
instalarEditorReal();

// FPS: pitch preso em ±89°
const ang = new Float64Array(3);
olharFps(ang, 100.0, 0 - 1000000.0, 0.005);
check(ang[1] === PITCH_LIMITE_FPS && Math.abs(ang[0] - 0.5) < 1e-12, "olhar para cima preso em 89°");
olharFps(ang, 0.0, 2000000.0, 0.005);
check(ang[1] === 0.0 - PITCH_LIMITE_FPS, "olhar para baixo preso em -89°");
// órbita: distância e mira constantes
const alvo = new Float64Array(3); alvo[0] = 1.0; alvo[1] = 2.0; alvo[2] = 3.0;
const pose = new Float64Array(5);
const yaws: number[] = [0.0, 1.0, 2.5]; const pitches: number[] = [0 - 0.6, 0.0, 0.7];
let a = 0;
while (a < 3) {
  let b = 0;
  while (b < 3) {
    ang[0] = yaws[a]; ang[1] = pitches[b]; ang[2] = 6.0;
    orbitaPose(alvo, ang, pose);
    const dx = alvo[0] - pose[0]; const dy = alvo[1] - pose[1]; const dz = alvo[2] - pose[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fx = Math.sin(pose[3]) * Math.cos(pose[4]); const fy = Math.sin(pose[4]); const fz = Math.cos(pose[3]) * Math.cos(pose[4]);
    check(Math.abs(d - 6.0) < 1e-9 && Math.abs((dx * fx + dy * fy + dz * fz) / d - 1.0) < 1e-9, "órbita mantém distância e mira");
    b = b + 1;
  }
  a = a + 1;
}
// amortecimento crítico: converge sem ultrapassar, subindo e descendo, com dt pequeno e grande
const est = new Float64Array(6); const cfg = new Float64Array(2); cfg[0] = 0.3; cfg[1] = 1.0 / 60.0;
let k = 0; let anterior = 0.0;
while (k < 600) { amortecerCritico(est, 0, 10.0, cfg); check(est[0] <= 10.0 && est[0] >= anterior, "sobe sem ultrapassar"); anterior = est[0]; k = k + 1; }
check(Math.abs(est[0] - 10.0) < 1e-3, "converge: " + est[0]);
cfg[1] = 0.5; est[2] = 10.0; est[3] = 0.0; k = 0;
while (k < 50) { amortecerCritico(est, 1, 0.0, cfg); check(est[2] >= 0.0, "desce sem ultrapassar com dt grande"); k = k + 1; }
// zoom
let z = 20.0; k = 0; while (k < 1000) { z = limitarZoom(z, 5.0, 5.0, 60.0); k = k + 1; }
check(z === 60.0, "zoom máximo");
k = 0; while (k < 1000) { z = limitarZoom(z, 0 - 5.0, 5.0, 60.0); k = k + 1; }
check(z === 5.0 && limitarZoom(0.0, 0.0, 60.0, 5.0) === 5.0, "zoom mínimo e limites trocados");

// componentes (sem janela: sem entrada)
scene.clear();
const alvoObj = scene.createGameObject("Alvo"); alvoObj.transform.setPosition(1.0, 2.0, 3.0);
const co = scene.createGameObject("Orbita"); co.transform.ry = 0.4; co.transform.rx = 0 - 0.3;
const orb = new CameraOrbita(); orb.alvo = "Alvo"; orb.distancia = 6.0; co.addBehavior(orb);
scene.computeWorld(); orb.update(1.0 / 60.0);
const odx = 1.0 - co.transform.px; const ody = 2.0 - co.transform.py; const odz = 3.0 - co.transform.pz;
check(Math.abs(Math.sqrt(odx * odx + ody * ody + odz * odz) - 6.0) < 1e-9, "CameraOrbita mantém a distância do alvo");
const cs = scene.createGameObject("Segue"); cs.transform.setPosition(0.0, 0.0, 0 - 30.0);
const seg = new CameraSeguir(); seg.alvo = "Alvo"; cs.addBehavior(seg);
k = 0; let zAntes = 0 - 30.0;
while (k < 600) { seg.update(1.0 / 60.0); check(cs.transform.pz >= zAntes && cs.transform.pz <= 3.0 + seg.deslocZ + 1e-9, "CameraSeguir sem ultrapassar"); zAntes = cs.transform.pz; k = k + 1; }
check(Math.abs(cs.transform.pz - (3.0 + seg.deslocZ)) < 1e-3 && Math.abs(cs.transform.py - (2.0 + seg.deslocY)) < 1e-3, "CameraSeguir converge ao deslocamento");
const cr = scene.createGameObject("RTS"); const rts = new CameraRTS(); cr.addBehavior(rts);
rts.zoomMin = 80.0; rts.zoomMax = 10.0; rts.onValidate("zoomMin");
check(rts.zoomMin === 10.0 && rts.zoomMax === 80.0, "limites trocados são corrigidos");
rts.zoom = 500.0; rts.update(1.0 / 60.0);
check(cr.transform.py === 80.0 && Math.abs(cr.transform.rx + rts.inclinacao * Math.PI / 180.0) < 1e-9, "CameraRTS respeita o zoom máximo e a inclinação");

// Criar/Câmera substitui o preset antigo
check(OBJECT_PRESET_LABELS.indexOf("Câmera") < 0, "o preset Câmera saiu de object_presets.ts");
history.u = []; history.r = [];
S.camX = 2.0; S.camY = 3.0; S.camZ = 4.0; S.camYaw = 0.25; S.camPitch = 0 - 0.1;
check(executarItemDeMenu(indiceDoCaminho("Criar/Câmera"), 0 - 1) === "", "item Criar/Câmera");
const nova = scene.objects[S.selected];
check(nova.name === "Câmera" && nova.camIdx >= 0 && nova.transform.px === 2.0 && nova.transform.ry === 0.25, "câmera na pose da vista");
check(history.undoDepth() === 1, "Criar entra no Desfazer");

// comandos
const ci = S.selected;
check(execCommand(800, 600, "camera " + ci + " set fov 70").indexOf("[ok]") === 0, "camera set fov");
const cam = nova.behaviors[nova.camIdx] as Camera;
check(Math.abs(cam.fov * 180.0 / Math.PI - 70.0) < 1e-9 && history.undoDepth() === 2, "fov em graus, com Desfazer");
check(execCommand(800, 600, "camera " + ci + " set viewport 0.5 0 0.5 1").indexOf("[ok]") === 0 && cam.viewportX === 0.5, "viewport");
check(execCommand(800, 600, "camera " + ci + " set fundo marrom").indexOf("[erro]") === 0, "fundo inválido = erro");
check(execCommand(800, 600, "camera main " + ci).indexOf("[ok]") === 0 && cam.isMain === 1, "camera main");
cam.definirRetangulo(0.0, 0.0, 800.0, 600.0); nova.transform.ry = 0.0; nova.transform.rx = 0.0; scene.computeWorld();
const antes = history.undoDepth();
const ray = execCommand(800, 600, "camera ray 400 300");
check(ray.indexOf("direcao (0.000, 0.000, 1.000)") > 0 && history.undoDepth() === antes, "camera ray é consulta: " + ray);
check(execCommand(800, 600, "cameras").indexOf("Câmera") > 0 && history.undoDepth() === antes, "cameras lista sem Desfazer");
check(execCommand(800, 600, "camera 999 set fov 60").indexOf("[erro]") === 0, "objeto sem câmera = erro");
// gizmo da câmera: ícone sempre; frustum (4 raios + 4 bordas) só selecionada
const gp = new Float64Array(8); gp[2] = 0 - 20.0; gp[5] = 1.0; gp[6] = 1280.0; gp[7] = 720.0;
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0 - 1);
check(gizmosDoEditor.nIc >= 1 && gizmosDoEditor.nSeg === 0, "não selecionada: só o ícone");
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, ci);
check(gizmosDoEditor.nSeg === 8, "selecionada: frustum com 8 linhas: " + gizmosDoEditor.nSeg);

// voo embutido do jogo (game.ts) × controle por script: W por N quadros anda
// velocidade·dt·N UMA vez (não o dobro); sem controle, o voo embutido anda.
scene.clear();
const DT_VOO = 1.0 / 60.0; const N_VOO = 30;
const poseSessao = new Float64Array(VOO_POSE_FLOATS);
function andarComW(): void {
  simularTecla(TECLA_W, true);
  let q = 0;
  while (q < N_VOO) {
    const main = Camera.main();
    vooDoJogo(main !== null ? main.owner : null, poseSessao, DT_VOO);
    scene.update(DT_VOO);
    q = q + 1;
  }
  simularTecla(TECLA_W, false);
}
const fpsObj = scene.createGameObject("FPS");
const fpsCam = new Camera(); fpsObj.addBehavior(fpsCam);
const fps = new CameraPrimeiraPessoa(); fpsObj.addBehavior(fps);
scene.computeWorld();
check(Camera.main() === fpsCam, "a câmera FPS é a Main");
andarComW();
const esperadoFps = fps.velocidade * DT_VOO * N_VOO;
check(Math.abs(fpsObj.transform.pz - esperadoFps) < 1e-9, "com CameraPrimeiraPessoa anda uma vez só: " + fpsObj.transform.pz + " ≠ " + esperadoFps);
fps.enabled = 0; fpsObj.transform.pz = 0.0;
andarComW();
check(Math.abs(fpsObj.transform.pz - VOO_VELOCIDADE * DT_VOO * N_VOO) < 1e-9, "controle desligado: o voo embutido anda: " + fpsObj.transform.pz);
scene.clear();
check(Camera.main() === null, "cena sem câmera");
andarComW();
check(Math.abs(poseSessao[2] - VOO_VELOCIDADE * DT_VOO * N_VOO) < 1e-9, "sem câmera: o voo move a pose da sessão: " + poseSessao[2]);
io.print("[PASSOU] pacote camera: FPS, órbita, amortecimento, zoom, componentes, Criar/Câmera, comandos, gizmo, voo do jogo");
