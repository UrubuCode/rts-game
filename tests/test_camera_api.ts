// Teste SEM JANELA da Camera: raio a partir da tela e do viewport, projeção de
// mundo para tela (perspectiva e ortográfica), ida e volta, viewport, câmera
// filha de pai girado, Camera.main()/all(), ordem das vistas, formato salvo.
//
//   rts.exe run tests/test_camera_api.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Camera } from "@engine/core/camera";
import { setActiveScene } from "@engine/core/active_scene";
import { VistasDeCamera, coletarCameras, frustumDasVistas, MAX_VISTAS } from "@engine/render/camera_views";
import { inFrustumFast, frustumFar } from "@engine/render/gpu3d";
import { recreateBehavior } from "@editor/sceneio";
import { componentToData } from "@engine/components";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: number, b: number): boolean { return Math.abs(a - b) < 1e-6; }
function camera(sc: Scene, nome: string, x: number, y: number, z: number): Camera {
  const o = sc.createGameObject(nome);
  o.transform.setPosition(x, y, z);
  const c = new Camera(); o.addBehavior(c);
  return c;
}
const out = new Float64Array(6);
const tela = new Float64Array(3);
const sc = new Scene("cameras");
setActiveScene(sc);
const cam = camera(sc, "Cam", 1.0, 2.0, 3.0);
cam.fov = 2.0 * Math.atan(0.5);            // tanV = 0,5
cam.definirRetangulo(0.0, 0.0, 800.0, 600.0); // aspecto 4/3 → tanH = 2/3
sc.computeWorld();
const tanH = 0.5 * 800.0 / 600.0;

// centro da tela = fwd; origem no plano near
cam.screenPointToRay(400.0, 300.0, out);
check(perto(out[0], 1.0) && perto(out[1], 2.0) && perto(out[2], 3.1), "origem no near: " + out[0] + "," + out[1] + "," + out[2]);
check(perto(out[3], 0.0) && perto(out[4], 0.0) && perto(out[5], 1.0), "raio do centro = fwd");
// ponto à frente → centro, profundidade d
check(cam.worldToScreenPoint(1.0, 2.0, 13.0, tela) === 1, "à frente");
check(perto(tela[0], 400.0) && perto(tela[1], 300.0) && perto(tela[2], 10.0), "centro com profundidade 10");
cam.worldToScreenPoint(1.0 + 10.0 * tanH, 2.0, 13.0, tela);
check(perto(tela[0], 800.0), "borda direita: " + tela[0]);
cam.worldToScreenPoint(1.0, 7.0, 13.0, tela);
check(perto(tela[1], 0.0), "borda de cima (tanV·10 = 5): " + tela[1]);
check(cam.worldToScreenPoint(1.0, 2.0, -5.0, tela) === 0, "atrás da câmera = 0");
// ida e volta
cam.screenPointToRay(123.0, 456.0, out);
cam.worldToScreenPoint(out[0] + out[3] * 7.0, out[1] + out[4] * 7.0, out[2] + out[5] * 7.0, tela);
check(Math.abs(tela[0] - 123.0) < 1e-6 && Math.abs(tela[1] - 456.0) < 1e-6, "ida e volta tela → mundo → tela");
// viewport (u, v com v para cima)
cam.viewportPointToRay(1.0, 1.0, out);
const l = Math.sqrt(tanH * tanH + 0.25 + 1.0);
check(perto(out[3], tanH / l) && perto(out[4], 0.5 / l) && perto(out[5], 1.0 / l), "canto superior direito do viewport");
// yaw 90° e pitch 30° seguem a convenção do renderer
sc.objects[0].transform.ry = Math.PI / 2.0; sc.computeWorld();
cam.screenPointToRay(400.0, 300.0, out);
check(perto(out[3], 1.0) && perto(out[5], 0.0), "yaw 90° olha para +X");
sc.objects[0].transform.ry = 0.0; sc.objects[0].transform.rx = Math.PI / 6.0; sc.computeWorld();
cam.screenPointToRay(400.0, 300.0, out);
check(perto(out[4], 0.5) && perto(out[5], Math.cos(Math.PI / 6.0)), "pitch > 0 olha para cima");
sc.objects[0].transform.rx = 0.0; sc.computeWorld();
// câmera filha de pai com yaw 90°: fwd de mundo girado
const pai = sc.createGameObject("Pai"); pai.transform.ry = Math.PI / 2.0;
const filha = camera(sc, "Filha", 0.0, 0.0, 0.0);
(filha.owner as GameObject).parent = sc.objects.indexOf(pai);
filha.definirRetangulo(0.0, 0.0, 800.0, 600.0);
sc.computeWorld();
filha.screenPointToRay(400.0, 300.0, out);
check(perto(out[3], 1.0), "filha herda o yaw do pai");
// ortográfica
cam.ortografica = true; cam.tamanhoOrto = 5.0;
cam.screenPointToRay(800.0, 300.0, out);
check(perto(out[0], 1.0 + 5.0 * 800.0 / 600.0) && perto(out[5], 1.0), "orto: origem desloca, direção = fwd");
cam.worldToScreenPoint(1.0, 7.0, 50.0, tela);
check(perto(tela[0], 400.0) && perto(tela[1], 0.0) && perto(tela[2], 47.0), "orto: meia altura 5 = borda de cima");
cam.ortografica = false;
// viewport: retângulo direito de 1280x720
const vistas = new VistasDeCamera();
vistas.area[2] = 1280.0; vistas.area[3] = 720.0; vistas.tela[0] = 1280.0; vistas.tela[1] = 720.0;
cam.viewportX = 0.5; cam.viewportW = 0.5;
filha.enabled = 0;
check(coletarCameras(vistas, sc, cam) === 1, "só a câmera pedida");
check(perto(cam.retanguloPx()[0], 0.0) && perto(cam.retanguloPx()[2], 1280.0), "câmera escolhida ocupa a área inteira");
check(coletarCameras(vistas, sc, null) === 1, "desligada fica fora");
check(perto(cam.retanguloPx()[0], 640.0) && perto(cam.retanguloPx()[2], 640.0), "viewport (0,5, 0, 0,5, 1) → 640..1280");
cam.screenPointToRay(960.0, 360.0, out);
check(perto(out[5], 1.0), "centro da viewport = fwd");
// ordem: profundidade, e a Main por último no empate
cam.viewportX = 0.0; cam.viewportW = 1.0;
filha.enabled = 1; filha.isMain = 0; cam.isMain = 1;
const outra = camera(sc, "Outra", 0.0, 0.0, 0.0); outra.isMain = 0; outra.profundidade = 1.0;
sc.computeWorld();
check(coletarCameras(vistas, sc, null) === 3, "três câmeras");
check(vistas.cams[0] === filha && vistas.cams[1] === cam && vistas.cams[2] === outra, "ordem: profundidade 0 (Main por último), depois 1");
const fp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
frustumDasVistas(vistas, fp);
check(fp[7] < 0.0, "várias vistas: culling desligado (sentinela)");
pai.active = 0;
check(coletarCameras(vistas, sc, null) === 2, "filha de pai inativo fica fora");
// Camera.main() / all()
check(Camera.main() === cam, "main = a marcada isMain");
cam.enabled = 0;
check(Camera.main() === outra, "sem main ativa: a primeira ativa");
cam.enabled = 1;
check(Camera.all().length === 2 && Camera.all()[1] === outra, "all() ordenada por profundidade");
// validação e formato salvo
cam.tamanhoOrto = 0.0; cam.onValidate("tamanhoOrto");
check(cam.tamanhoOrto > 0.0, "tamanhoOrto preso acima de zero");
cam.near = 0.0; cam.onValidate("near"); check(cam.near > 0.0, "near preso acima de zero");
cam.far = 0.0; cam.onValidate("far"); check(cam.far > cam.near, "far > near");
cam.viewportX = 0.9; cam.viewportW = 0.5; cam.onValidate("viewportW");
check(perto(cam.viewportW, 0.1), "x + w preso em 1");
const legado = recreateBehavior({ type: "camera", fov: 0.9, isMain: 0 }) as Camera;
check(perto(legado.fov, 0.9) && legado.isMain === 0 && perto(legado.near, 0.1), "cena antiga carrega com padrões");
cam.ortografica = true; cam.fundo = "cor"; cam.corFundo = 0x102030;
const d = componentToData(cam);
check(d.type === "camera" && d.componentFields.ortografica === true, "formato antigo + campos novos");
const volta = recreateBehavior(d) as Camera;
check(volta.ortografica && volta.fundo === "cor" && volta.corFundo === 0x102030, "ida e volta dos campos novos");
// cena antiga: duas câmeras de tela cheia, ambas isMain, mesma profundidade →
// a imagem final (última vista) tem de ser a de Camera.main() (a primeira).
const sc2 = new Scene("legado");
setActiveScene(sc2);
const a1 = camera(sc2, "A", 0.0, 0.0, 0.0);
const a2 = camera(sc2, "B", 5.0, 0.0, 0.0);
sc2.computeWorld();
const v2 = new VistasDeCamera();
v2.area[2] = 1280.0; v2.area[3] = 720.0; v2.tela[0] = 1280.0; v2.tela[1] = 720.0;
check(coletarCameras(v2, sc2, null) === 2, "duas câmeras legadas");
check(Camera.main() === a1 && v2.cams[1] === a1, "Main (a primeira isMain) é a última vista");
check(Camera.all()[1] === a1, "all() também põe a Main por último no empate");
a2.profundidade = 2.0;
coletarCameras(v2, sc2, null);
check(v2.cams[1] === a2, "profundidade maior ainda vence a Main");
// viewport e lente degeneradas: validação prende, raio fica finito
a1.viewportX = NaN; a1.viewportW = 0.0; a1.viewportH = NaN; a1.near = NaN; a1.tamanhoOrto = NaN; a1.fov = NaN;
a1.onValidate("viewportX");
check(a1.viewportX === 0.0 && perto(a1.viewportW, 0.01) && a1.viewportH === 1.0, "viewport NaN/0 presa");
check(a1.near > 0.0 && a1.tamanhoOrto > 0.0 && a1.fov > 0.0, "lente NaN presa");
a1.definirRetangulo(0.0, 0.0, 0.0, 0.0);
a1.screenPointToRay(10.0, 10.0, out);
check(Number.isFinite(out[0]) && Number.isFinite(out[3]) && Number.isFinite(out[5]), "retângulo vazio: raio finito");
a1.ortografica = true; a1.screenPointToRay(10.0, 10.0, out);
check(Number.isFinite(out[0]) && Number.isFinite(out[5]), "orto com retângulo vazio: raio finito");
// Inspector: FOV em graus (preso), Main como caixa; os demais pelos automáticos
check(a1.fieldType(1) === "boolean" && a1.fieldLabel(0) === "FOV", "Main é caixa, FOV rotulado");
a1.fieldSet(0, 60.0);
check(perto(a1.fov, Math.PI / 3.0) && perto(a1.fieldGet(0), 60.0), "FOV: graus ida e volta");
a1.fieldSet(0, 500.0);
check(a1.fov <= 3.1241393610698496 + 1e-9, "FOV preso em 179°");
a1.fieldSet(2, 0.5);
check(perto(a1.near, 0.5) && perto(a1.fieldGet(2), 0.5) && a1.fieldType(2) === "number" && a1.fieldLabel(2) === "Near", "campo automático (near) via super");
a1.fieldSet(1, 0.0); check(a1.isMain === 0, "Main desmarcada"); a1.fieldSet(1, 1.0);
// cena salva com lente/viewport fora da faixa: a carga valida e os raios ficam finitos
const ruim = recreateBehavior({ type: "camera", fov: 0.0, isMain: 1,
  componentFields: { near: 0.0, tamanhoOrto: 0.0, viewportW: 0.0, far: 0.0 } }) as Camera;
check(ruim.near > 0.0 && ruim.tamanhoOrto > 0.0 && ruim.viewportW >= 0.01 && ruim.fov > 0.0 && ruim.far > ruim.near, "carga passa pelo onValidate");
function finito(v: Float64Array, n: number): boolean { let i = 0; while (i < n) { if (!Number.isFinite(v[i])) return false; i = i + 1; } return true; }
// campos corrompidos direto (sem onValidate): as leituras defensivas seguram
a2.near = 0.0; a2.fov = 0.0; a2.tamanhoOrto = 0.0; a2.definirRetangulo(0.0, 0.0, 800.0, 600.0);
a2.screenPointToRay(100.0, 100.0, out);
a2.worldToScreenPoint(1.0, 2.0, 3.0, tela);
check(finito(out, 6) && finito(tela, 3), "perspectiva com lente zerada: finito");
a2.ortografica = true;
a2.screenPointToRay(100.0, 100.0, out);
a2.worldToScreenPoint(1.0, 2.0, 3.0, tela);
check(finito(out, 6) && finito(tela, 3), "orto com tamanho zerado: finito");
const rp = new Float64Array(11); a2.parametrosDeRender(rp);
check(rp[5] > 0.0 && rp[7] > 0.0 && rp[8] > rp[7] && rp[10] > 0.0, "parâmetros de render presos");
a2.ortografica = false; a2.near = 0.1; a2.fov = 1.05; a2.tamanhoOrto = 5.0;
// viewport corrompida direto: o retângulo coletado continua válido
a2.viewportW = NaN; a2.viewportX = 2.0;
const v3 = new VistasDeCamera();
v3.area[2] = 1000.0; v3.area[3] = 500.0; v3.tela[0] = 1000.0; v3.tela[1] = 500.0;
coletarCameras(v3, sc2, null);
check(a2.retanguloPx()[2] >= 10.0 - 1e-9 && a2.retanguloPx()[0] + a2.retanguloPx()[2] <= 1000.0 + 1e-9, "viewport NaN/fora coletada dentro da área");
a2.viewportW = 1.0; a2.viewportX = 0.0;
// culling de vista única usa o far da câmera
const sc3 = new Scene("far");
const longe = camera(sc3, "Longe", 0.0, 0.0, 0.0);
longe.far = 1000.0;
sc3.computeWorld();
const v4 = new VistasDeCamera();
v4.area[2] = 800.0; v4.area[3] = 600.0; v4.tela[0] = 800.0; v4.tela[1] = 600.0;
const fp4: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
coletarCameras(v4, sc3, null); frustumDasVistas(v4, fp4);
check(frustumFar() === 1000.0 && inFrustumFast(0.0, 0.0, 800.0, 1.0) === 1, "far 1000: objeto a 800 é visível");
longe.far = 500.0;
coletarCameras(v4, sc3, null); frustumDasVistas(v4, fp4);
check(inFrustumFast(0.0, 0.0, 800.0, 1.0) === 0, "far 500: objeto a 800 é descartado");
// 10 câmeras: ordena antes de cortar; a Main (a última criada) sobrevive
const sc4 = new Scene("dez");
let q = 0;
let ultima: Camera | null = null;
while (q < 10) { const cq = camera(sc4, "C" + q, 0.0, 0.0, 0.0); cq.isMain = q === 9 ? 1 : 0; ultima = cq; q = q + 1; }
sc4.computeWorld();
const v5 = new VistasDeCamera();
v5.area[2] = 800.0; v5.area[3] = 600.0; v5.tela[0] = 800.0; v5.tela[1] = 600.0;
check(coletarCameras(v5, sc4, null) === MAX_VISTAS && v5.cams[MAX_VISTAS - 1] === ultima, "10 câmeras: 8 vistas e a Main por último");
setActiveScene(sc);
io.print("[PASSOU] camera: raio, projeção, orto, viewport, filha, main/all, ordem, validação, formato");
