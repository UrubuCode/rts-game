// Teste de ALOCAÇÃO por frame de luzes, ambiente, câmeras, gizmos e controles.
// Rodar com RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores
// "FASE" (as de antes do primeiro marcador são do setup). Portão: 1.000 e
// 10.000 frames dão a MESMA contagem por fase.
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-luzes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-luzes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import "@engine/generated/editor_extensions";
import { scene, S } from "@editor/control/session";
import { Light } from "@engine/core/light";
import { Camera } from "@engine/core/camera";
import { aplicarLuzes, aplicarAmbiente } from "@engine/render/scene_lighting";
import { VistasDeCamera, coletarCameras, aplicarVistas, frustumDasVistas } from "@engine/render/camera_views";
import { gizmosBegin } from "@engine/core/gizmos";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { CameraOrbita } from "../assets/pacotes/camera/camera_orbita";
import { CameraSeguir } from "../assets/pacotes/camera/camera_seguir";
import { CameraRTS } from "../assets/pacotes/camera/camera_rts";
import { CicloDoDia } from "../assets/pacotes/ambiente/ciclo_do_dia";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));
const DT: f64 = 1.0 / 60.0;
scene.clear();
const tipos: string[] = ["pontual", "pontual", "pontual", "pontual", "pontual", "pontual", "pontual", "pontual", "spot", "spot", "direcional", "direcional"];
let k = 0;
while (k < tipos.length) {
  const o = scene.createGameObject("L" + k); o.transform.setPosition(k * 2.0, 3.0, 0.0);
  const l = new Light(); l.tipo = tipos[k]; l.sombra = k === 10; o.addBehavior(l); k = k + 1;
}
const alvo = scene.createGameObject("Alvo");
const c1 = scene.createGameObject("C1"); c1.addBehavior(new Camera()); const orb = new CameraOrbita(); orb.alvo = "Alvo"; c1.addBehavior(orb);
const c2 = scene.createGameObject("C2"); const cam2 = new Camera(); cam2.viewportX = 0.5; cam2.viewportW = 0.5; cam2.isMain = 0; c2.addBehavior(cam2);
const seg = new CameraSeguir(); seg.alvo = "Alvo"; c2.addBehavior(seg);
const c3 = scene.createGameObject("C3"); const cam3 = new Camera(); cam3.isMain = 0; cam3.profundidade = 1.0; cam3.ortografica = true; c3.addBehavior(cam3); c3.addBehavior(new CameraRTS());
const rel = scene.createGameObject("Relogio"); const ciclo = new CicloDoDia(); ciclo.duracao = 10.0; rel.addBehavior(ciclo);
scene.ambiente.ceu.modo = "procedural";
scene.computeWorld();
const cam = new Float64Array(3); const legado = new Float64Array(4); legado[1] = 10.0; legado[3] = 0.25;
const vistas = new VistasDeCamera(); vistas.area[2] = 1280.0; vistas.area[3] = 720.0; vistas.tela[0] = 1280.0; vistas.tela[1] = 720.0;
const fp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const raio = new Float64Array(6); const tela = new Float64Array(3);
const pose = new Float64Array(8); pose[2] = 0 - 20.0; pose[5] = 1.0; pose[6] = 1280.0; pose[7] = 720.0;
// aquece tudo fora das fases
aplicarLuzes(0, scene, cam, legado); aplicarAmbiente(0, scene); coletarCameras(vistas, scene, null);
gizmosBegin(gizmosDoEditor, pose); coletarGizmos(gizmosDoEditor, scene, 0);

io.print("FASE luzes " + n);
let f = 0;
while (f < n) { cam[0] = (f % 40) * 0.5; aplicarLuzes(0, scene, cam, legado); f = f + 1; }
io.print("FASE ambiente " + n);
f = 0;
while (f < n) { scene.ambiente.ceu.topo[0] = (f % 100) * 0.01; aplicarAmbiente(0, scene); f = f + 1; }
io.print("FASE camera " + n);
f = 0;
while (f < n) {
  coletarCameras(vistas, scene, null); aplicarVistas(0, vistas); frustumDasVistas(vistas, fp);
  cam2.screenPointToRay((f % 640) + 640.0, 360.0, raio); cam2.worldToScreenPoint(1.0, 2.0, 10.0, tela); cam3.viewportPointToRay(0.25, 0.75, raio);
  f = f + 1;
}
io.print("FASE gizmos " + n);
f = 0;
while (f < n) { gizmosBegin(gizmosDoEditor, pose); coletarGizmos(gizmosDoEditor, scene, f % tipos.length); f = f + 1; }
io.print("FASE controles " + n);
f = 0;
while (f < n) { scene.update(DT); scene.computeWorld(); f = f + 1; }
io.print("FASE fim");
