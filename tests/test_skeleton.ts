// Teste HEADLESS do componente Skeleton (engine/core/skeleton.ts): pose de
// repouso, yaw do objeto, hierarquia, override manual, reset, dados por
// instância, cópia (duplicar/Rodar) e round-trip de cena. win = 0: sem GPU.
//
//   ./rts.exe run tests/test_skeleton.ts
import io from "@compat/io.ts";
import { GameObject } from "@engine/core/gameobject";
import { Scene } from "@engine/core/scene";
import { Skeleton } from "@engine/core/skeleton";
import { MeshRenderer } from "@engine/core/meshrenderer";
import { quatFromYawPitchInto } from "@engine/render/quat";
import { componentToData } from "@engine/components";
import { recreateBehavior } from "@editor/sceneio";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64): boolean { return Math.abs(a - b) < 1e-6; }
const cena = new Scene("teste-skeleton");
const g = new GameObject("heroi");
const sk = new Skeleton("assets/models/kenney/character-a.glb");
g.addBehavior(sk);
cena.add(g);
sk.ensureAsset(0);
check(sk.boneCount() === 8, "8 ossos");
const head = sk.boneIndex("head"); const torso = sk.boneIndex("torso");
cena.computeWorld(); sk.compose();
// repouso: head em torso(0,0.7,0) + (0,1.2,0) = y 1.9, objeto na origem
check(perto(sk.worldT[head * 3 + 1], 1.9), "cabeca em y=1.9 no repouso: " + sk.worldT[head * 3 + 1]);
// objeto andou e virou 90 graus: o braco direito (local x=-0.4, z=-0.1 no
// torso) vai para z=+0.4 e x=-0.1 (yaw 90: X local -> -Z, Z local -> +X)
g.transform.setPosition(10.0, 0.0, 5.0); g.transform.ry = Math.PI / 2;
cena.computeWorld(); sk.compose();
const arm = sk.boneIndex("arm-right");
check(perto(sk.worldT[arm * 3], 9.9) && perto(sk.worldT[arm * 3 + 2], 5.4), "braco segue o yaw do objeto: " + sk.worldT[arm * 3] + "," + sk.worldT[arm * 3 + 2]);
// girar o torso 90 em Y leva a cabeca junto (filha) e marca override
const q = new Float64Array(4); quatFromYawPitchInto(q, Math.PI / 2, 0.0);
g.transform.setPosition(0.0, 0.0, 0.0); g.transform.ry = 0.0;
cena.computeWorld();
sk.setBoneRotation(torso, q); sk.compose();
check(sk.overrideMask[torso] === 1, "torso marcado como posicionado a mao");
check(perto(sk.worldR[head * 4 + 1], q[1]) && perto(sk.worldR[head * 4 + 3], q[3]), "cabeca herda a rotacao do torso");
sk.resetPose(); sk.compose();
check(sk.overrideMask[torso] === 0 && perto(sk.worldR[head * 4 + 3], 1.0), "resetPose volta ao repouso");
// dados por instancia: um segundo Skeleton do mesmo modelo nao compartilha a pose
const sk2 = new Skeleton("assets/models/kenney/character-a.glb"); sk2.ensureAsset(0);
sk.setBoneRotation(torso, q);
check(sk2.poseR[torso * 4 + 3] === 1.0, "pose e por instancia");

// pose manual separada da pose de trabalho: um clipe (que so escreve poseR)
// nao corrompe o que vai para a cena; applyManualPose() restaura repouso+manual.
sk.poseR[torso * 4 + 3] = 0.5;
check(sk.manualR[torso * 4 + 3] === q[3], "pose manual separada da pose de trabalho");
sk.applyManualPose();
check(sk.poseR[torso * 4 + 3] === q[3], "applyManualPose reescreve a pose manual");
sk.setBonePosition(head, 0.0, 1.5, 0.25);

// round-trip de cena (JSON) preserva caminho e pose manual (so ossos com override)
const dados = componentToData(sk);
const texto = JSON.stringify(dados);
const volta = recreateBehavior(JSON.parse(texto)) as Skeleton;
check(volta.typeName() === "Skeleton", "restaurado como Skeleton: " + volta.typeName());
check(volta.modelPath === "assets/models/kenney/character-a.glb", "modelPath restaurado: " + volta.modelPath);
volta.ensureAsset(0);
check(volta.overrideMask[torso] === 1 && volta.overrideMask[head] === 1, "mascara restaurada");
check(volta.overrideMask[arm] === 0, "osso sem override continua em repouso");
check(perto(volta.poseR[torso * 4 + 1], q[1]) && perto(volta.poseR[torso * 4 + 3], q[3]), "rotacao manual restaurada");
check(perto(volta.poseT[head * 3 + 1], 1.5) && perto(volta.poseT[head * 3 + 2], 0.25), "posicao manual restaurada");
check(perto(volta.manualT[head * 3 + 1], 1.5), "manualT restaurado");

// copia (duplicar / Rodar usam componentToData -> recreateBehavior): arrays proprios
const copia = recreateBehavior(componentToData(sk)) as Skeleton;
copia.ensureAsset(0);
check(copia.poseR !== sk.poseR && copia.manualR !== sk.manualR, "copia nao compartilha os buffers");
copia.setBoneRotation(arm, q);
check(sk.overrideMask[arm] === 0 && perto(sk.manualR[arm * 4 + 3], 1.0), "mexer na copia nao altera o original");
// pose salva por NOME de osso (sobrevive a um modelo que reordene os nos)
const dadosNome = componentToData(sk);
check(typeof dadosNome.pose[0][0] === "string", "pose salva pelo nome do osso: " + dadosNome.pose[0][0]);
// registro antigo por indice continua aceito; nome desconhecido e descartado
const legado = recreateBehavior({ type: "skeleton", modelPath: "assets/models/kenney/character-a.glb",
  pose: [[torso, 0.0, 0.7, 0.0, q[0], q[1], q[2], q[3]], ["osso-que-nao-existe", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]] }) as Skeleton;
legado.ensureAsset(0);
check(legado.overrideMask[torso] === 1 && perto(legado.manualR[torso * 4 + 3], q[3]), "registro por indice restaurado");
let marcados = 0; let mi = 0;
while (mi < legado.overrideMask.length) { marcados = marcados + legado.overrideMask[mi]; mi = mi + 1; }
check(marcados === 1, "nome desconhecido descartado: " + marcados);
check(componentToData(legado).pose.length === 1, "descartado nao volta ao salvar");

// Skeleton num objeto que JA tem MeshRenderer assume o desenho (rendIdx)
const obj = new GameObject("com-malha");
obj.addBehavior(new MeshRenderer(1));
check(obj.rendIdx === 0, "MeshRenderer e o renderer");
const skObj = new Skeleton("assets/models/kenney/character-a.glb");
obj.addBehavior(skObj);
check(obj.rendIdx === 1, "Skeleton assume o desenho: rendIdx=" + obj.rendIdx);
obj.removeBehavior(1);
check(obj.rendIdx === 0, "sem Skeleton volta ao MeshRenderer: rendIdx=" + obj.rendIdx);
const obj2 = new GameObject("skeleton-primeiro");
obj2.addBehavior(new Skeleton("assets/models/kenney/character-a.glb"));
obj2.addBehavior(new MeshRenderer(1));
check(obj2.rendIdx === 0, "Skeleton antes do MeshRenderer continua o renderer");

io.print("[PASSOU] skeleton: repouso, yaw do objeto, hierarquia, override, reset, instancias, copia, round-trip, nomes, renderer preferido");
