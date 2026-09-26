// Teste de ALOCAÇÃO dos pacotes luz/ e camera/ (Task 9). Rodar com
// RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as
// coletas antes do primeiro marcador são do setup). Portão: 1.000 e 10.000
// quadros dão o MESMO número por fase. Um vazamento pequeno (1 a 2 objetos
// por quadro em uma só fase) só dispara coleta com mais quadros: confira
// também com GC_N=200000 (esperado: zero "rts-gc" em todas as fases).
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-pacotes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-pacotes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: `update` dos quatro controles de câmera (sem janela a entrada responde
// 0; a primeira pessoa roda com exigirBotaoDireito = false para passar pelo
// olharFps), depois o passe de gizmos com as luzes (direcional, pontual, spot)
// e a câmera: sem seleção (só ícones) e com cada uma selecionada (seta,
// esfera, cone e frustum), uma fase por caso.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import "@engine/generated/components";   // instala a reflexão (typeName de Light)
import "@engine/generated/editor_extensions";
import { Light } from "@engine/core/light";
import { Camera } from "@engine/core/camera";
import { CameraPrimeiraPessoa } from "../assets/pacotes/camera/camera_primeira_pessoa";
import { CameraOrbita } from "../assets/pacotes/camera/camera_orbita";
import { CameraSeguir } from "../assets/pacotes/camera/camera_seguir";
import { CameraRTS } from "../assets/pacotes/camera/camera_rts";
import { gizmosBegin } from "@engine/core/gizmos";
import { coletarGizmos, gizmosDoEditor } from "@editor/gizmo_pass";
import { scene } from "@editor/control/session";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));

scene.clear();
const alvo = scene.createGameObject("Alvo"); alvo.transform.setPosition(1.0, 2.0, 3.0);
const fps = new CameraPrimeiraPessoa(); fps.exigirBotaoDireito = false;
scene.createGameObject("FPS").addBehavior(fps);
const orb = new CameraOrbita(); orb.alvo = "Alvo";
scene.createGameObject("Orbita").addBehavior(orb);
const seg = new CameraSeguir(); seg.alvo = "Alvo";
const os = scene.createGameObject("Segue"); os.transform.setPosition(0.0, 0.0, 0.0 - 30.0); os.addBehavior(seg);
const rts = new CameraRTS();
scene.createGameObject("RTS").addBehavior(rts);
const tipos: string[] = ["direcional", "pontual", "spot"];
let k = 0;
while (k < 3) {
  const l = new Light(); l.tipo = tipos[k];
  const o = scene.createGameObject("Luz" + k); o.transform.setPosition(k * 2.0 - 2.0, 3.0, 6.0); o.transform.rx = 0.0 - 0.5;
  o.addBehavior(l);
  k = k + 1;
}
const oc = scene.createGameObject("Cam"); oc.transform.setPosition(0.0, 1.0, 2.0); oc.addBehavior(new Camera());
const primeiroGizmo = scene.objects.length - 4;
scene.computeWorld();

const dt = 1.0 / 60.0;
// aquece fora das fases
fps.update(dt); orb.update(dt); seg.update(dt); rts.update(dt);
const pose = new Float64Array(8);
pose[2] = 0.0 - 20.0; pose[5] = 1.05; pose[6] = 1280.0; pose[7] = 720.0;
const g = gizmosDoEditor;
k = 0;
while (k < 4) { gizmosBegin(g, pose); g.lado = 24.0; coletarGizmos(g, scene, primeiroGizmo + k); k = k + 1; }
io.print("aquecido: segmentos " + g.nSeg + " icones " + g.nIc);

io.print("FASE controles " + n);
let f = 0;
while (f < n) {
  fps.update(dt); orb.update(dt); seg.update(dt); rts.update(dt);
  f = f + 1;
}
// uma fase por seleção: nenhuma (só ícones), direcional (seta), pontual (esfera), spot (cone), câmera (frustum)
const fases: string[] = ["FASE icones", "FASE direcional", "FASE pontual", "FASE spot", "FASE camera"];
let q = 0;
while (q < fases.length) {
  io.print(fases[q]);
  const sel = q === 0 ? 0 - 1 : primeiroGizmo + q - 1;
  f = 0;
  while (f < n) {
    pose[0] = (f % 100) * 0.001;
    gizmosBegin(g, pose); g.lado = 24.0;
    coletarGizmos(g, scene, sel);
    f = f + 1;
  }
  q = q + 1;
}
// marcador constante: a concatenação do resumo não cai numa fase medida
io.print("FASE fim");
io.print("resumo " + g.nSeg + " " + orb.distancia + " " + os.transform.pz);
