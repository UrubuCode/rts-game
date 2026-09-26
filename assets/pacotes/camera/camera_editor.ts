/** @editorOnly */
// Pacote camera: gizmo da Camera (ícone sempre; frustum quando selecionada),
// o item Criar/Câmera e os comandos `camera` e `cameras`.
import { Editor, registerCommand, registerGizmo, Gizmos } from "@editor/api";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { Camera, FUNDOS_CAMERA } from "@engine/core/camera";
import { corHex, lerCorHex } from "@engine/core/cor";
import { definirPoseDeMundo } from "@engine/core/pose";

const COR_CAMERA: number = 0x9AC7F0;
/// Profundidade do frustum desenhado, em unidades de mundo (ou `far`, se menor).
const FRUSTUM_GIZMO: number = 3.0;
const CANTOS: number = 4;
/// Cantos do viewport na ordem (0,0), (1,0), (1,1), (0,1): u e v.
const CANTO_U: number[] = [0.0, 1.0, 1.0, 0.0];
const CANTO_V: number[] = [0.0, 0.0, 1.0, 1.0];
const GRAUS_POR_RAD: number = 57.29577951308232;
/// Faixa do FOV aceita pelo comando, em graus (a do slider do Inspector).
const FOV_MIN_GRAUS: number = 10.0;
const FOV_MAX_GRAUS: number = 150.0;
const NOME_CAMERA: string = "Câmera";
const CASAS: number = 3;

const pos = new Float64Array(3);
const origem = new Float64Array(3);
const raio = new Float64Array(6);
const cantos = new Float64Array(CANTOS * 3);
const pa = new Float64Array(3); const pb = new Float64Array(3);
const pose = new Float64Array(5);

function desenharCamera(g: Gizmos, dono: GameObject, comp: Behavior): void {
  const cam = comp as Camera;
  const t = dono.transform;
  pos[0] = t.wx; pos[1] = t.wy; pos[2] = t.wz;
  g.color(COR_CAMERA);
  g.icon("camera", pos);
  if (g.selecionado) {
    const alcance = cam.far < FRUSTUM_GIZMO ? cam.far : FRUSTUM_GIZMO;
    let k = 0;
    while (k < CANTOS) {
      cam.viewportPointToRay(CANTO_U[k], CANTO_V[k], raio);
      cantos[k * 3] = raio[0] + raio[3] * alcance;
      cantos[k * 3 + 1] = raio[1] + raio[4] * alcance;
      cantos[k * 3 + 2] = raio[2] + raio[5] * alcance;
      // perspectiva: do centro da câmera; ortográfica: da origem do raio (raios paralelos)
      if (cam.ortografica) { origem[0] = raio[0]; origem[1] = raio[1]; origem[2] = raio[2]; }
      else { origem[0] = pos[0]; origem[1] = pos[1]; origem[2] = pos[2]; }
      pb[0] = cantos[k * 3]; pb[1] = cantos[k * 3 + 1]; pb[2] = cantos[k * 3 + 2];
      g.line(origem, pb);
      k = k + 1;
    }
    k = 0;
    while (k < CANTOS) {
      const j = (k + 1) % CANTOS;
      pa[0] = cantos[k * 3]; pa[1] = cantos[k * 3 + 1]; pa[2] = cantos[k * 3 + 2];
      pb[0] = cantos[j * 3]; pb[1] = cantos[j * 3 + 1]; pb[2] = cantos[j * 3 + 2];
      g.line(pa, pb);
      k = k + 1;
    }
  }
}
registerGizmo("Camera", desenharCamera);

/// Cria "Câmera" na cena do editor, na pose da vista de Cena.
function criarCameraNaVista(): GameObject | null {
  const sc = Editor.scene();
  let o: GameObject | null = null;
  if (sc !== null) {
    o = sc.createGameObject(NOME_CAMERA);
    Editor.viewPose(pose);
    o.transform.setPosition(pose[0], pose[1], pose[2]);
    o.transform.ry = pose[3]; o.transform.rx = pose[4];
    o.addBehavior(new Camera());
  }
  return o;
}
export class CameraMenu {
  /** @menuItem Criar/Câmera */
  static camera(): void { criarCameraNaVista(); }
}

function objetoComCamera(indice: string): GameObject | null {
  const sc = Editor.scene(); const i = parseFloat(indice);
  let o: GameObject | null = null;
  if (sc !== null && i === Math.floor(i) && i >= 0 && i < sc.objects.length && sc.objects[i].camIdx >= 0) o = sc.objects[i];
  return o;
}
function numeroValido(v: number): boolean { return v === v && v > -1e30 && v < 1e30; }
function xyz(a: number, b: number, c: number): string { return "(" + a.toFixed(CASAS) + ", " + b.toFixed(CASAS) + ", " + c.toFixed(CASAS) + ")"; }

/// `camera <obj> set <campo> <valores>`: valida tudo antes do snapshot.
function cmdCameraSet(p: string[]): string {
  const o = objetoComCamera(p[1]);
  if (o === null) return "[erro] objeto sem Camera: " + p[1];
  const cam = o.behaviors[o.camIdx] as Camera;
  const campo = p[3]; const texto = p[4];
  const v = parseFloat(texto);
  let out = "";
  if (campo === "fundo") {
    if (FUNDOS_CAMERA.indexOf(texto) < 0) out = "[erro] fundo: use " + FUNDOS_CAMERA.join(", ");
    else { Editor.snapshot("camera fundo"); cam.fundo = texto; cam.onValidate("fundo"); out = "[ok] fundo=" + cam.fundo; }
  } else if (campo === "cor") {
    const c = lerCorHex(texto);
    if (c < 0) out = "[erro] cor: use #RRGGBB";
    else { Editor.snapshot("camera cor"); cam.corFundo = c; cam.onValidate("corFundo"); out = "[ok] cor=" + corHex(cam.corFundo); }
  } else if (campo === "viewport") {
    const completo = p.length >= 8;
    const y = completo ? parseFloat(p[5]) : 0.0; const w = completo ? parseFloat(p[6]) : 0.0; const h = completo ? parseFloat(p[7]) : 0.0;
    if (!completo || !numeroValido(v) || !numeroValido(y) || !numeroValido(w) || !numeroValido(h)) out = "[erro] valor numérico: viewport x y w h";
    else {
      Editor.snapshot("camera viewport");
      cam.viewportX = v; cam.viewportY = y; cam.viewportW = w; cam.viewportH = h; cam.onValidate("viewportX");
      out = "[ok] viewport=(" + cam.viewportX + "," + cam.viewportY + "," + cam.viewportW + "," + cam.viewportH + ")";
    }
  } else if (!numeroValido(v)) out = "[erro] valor numérico";
  else if (campo === "fov") {
    Editor.snapshot("camera fov");
    const g = v < FOV_MIN_GRAUS ? FOV_MIN_GRAUS : (v > FOV_MAX_GRAUS ? FOV_MAX_GRAUS : v);
    cam.fov = g / GRAUS_POR_RAD; cam.onValidate("fov"); out = "[ok] fov=" + g;
  }
  else if (campo === "near") { Editor.snapshot("camera near"); cam.near = v; cam.onValidate("near"); out = "[ok] near=" + cam.near + " far=" + cam.far; }
  else if (campo === "far") { Editor.snapshot("camera far"); cam.far = v; cam.onValidate("far"); out = "[ok] far=" + cam.far; }
  else if (campo === "orto") { Editor.snapshot("camera orto"); cam.ortografica = v !== 0.0; cam.onValidate("ortografica"); out = "[ok] orto=" + (cam.ortografica ? 1 : 0); }
  else if (campo === "tamanho") { Editor.snapshot("camera tamanho"); cam.tamanhoOrto = v; cam.onValidate("tamanhoOrto"); out = "[ok] tamanho=" + cam.tamanhoOrto; }
  else if (campo === "profundidade") { Editor.snapshot("camera profundidade"); cam.profundidade = v; cam.onValidate("profundidade"); out = "[ok] profundidade=" + cam.profundidade; }
  else if (campo === "principal") { Editor.snapshot("camera principal"); cam.isMain = v !== 0.0 ? 1 : 0; cam.onValidate("isMain"); out = "[ok] principal=" + cam.isMain; }
  else out = "[erro] campo: fov, near, far, orto, tamanho, fundo, cor, viewport, profundidade, principal";
  return out;
}
function cmdCamera(p: string[]): string {
  let out = "[erro] uso: camera add | camera main <obj> | camera ray <x> <y> | camera <obj> set <campo> <valores> | camera <obj> alinhar";
  const sc = Editor.scene();
  if (sc === null) out = "[erro] sem cena";
  else if (p.length >= 2 && p[1] === "add") {
    Editor.snapshot("camera add");
    const o = criarCameraNaVista();
    if (o !== null) { Editor.select(o); out = "[ok] #" + sc.objects.indexOf(o) + " " + o.name; }
  } else if (p.length >= 3 && p[1] === "main") {
    const o = objetoComCamera(p[2]);
    if (o === null) out = "[erro] objeto sem Camera: " + p[2];
    else {
      Editor.snapshot("camera main");
      let i = 0;
      while (i < sc.camObjs.length) { const c = sc.camObjs[i]; (c.behaviors[c.camIdx] as Camera).isMain = c === o ? 1 : 0; i = i + 1; }
      out = "[ok] principal #" + p[2] + " " + o.name;
    }
  } else if (p.length >= 4 && p[1] === "ray") {
    const x = parseFloat(p[2]); const y = parseFloat(p[3]);
    const cam = Camera.main();
    if (!numeroValido(x) || !numeroValido(y)) out = "[erro] valor numérico";
    else if (cam === null) out = "[erro] sem câmera principal";
    else {
      cam.screenPointToRay(x, y, raio);
      out = "[ok] origem " + xyz(raio[0], raio[1], raio[2]) + " direcao " + xyz(raio[3], raio[4], raio[5]);
    }
  } else if (p.length >= 3 && p[2] === "alinhar") {
    const o = objetoComCamera(p[1]);
    if (o === null) out = "[erro] objeto sem Camera: " + p[1];
    else {
      Editor.snapshot("camera alinhar");
      Editor.viewPose(pose); definirPoseDeMundo(sc, o, pose);
      out = "[ok] #" + p[1] + " alinhada com a vista";
    }
  } else if (p.length >= 5 && p[2] === "set") out = cmdCameraSet(p);
  return out;
}
function cmdCameras(p: string[]): string {
  const sc = Editor.scene();
  let out = "[cameras]";
  if (sc !== null) {
    let i = 0;
    while (i < sc.objects.length) {
      const o = sc.objects[i];
      if (o.camIdx >= 0) {
        const c = o.behaviors[o.camIdx] as Camera;
        const r = c.retanguloPx();
        out = out + " | #" + i + " " + o.name + " fov=" + (c.fov * GRAUS_POR_RAD).toFixed(1) + " orto=" + (c.ortografica ? 1 : 0) +
          " viewport=(" + c.viewportX + "," + c.viewportY + "," + c.viewportW + "," + c.viewportH + ") prof=" + c.profundidade +
          " main=" + c.isMain + " rect=(" + r[0] + "," + r[1] + "," + r[2] + "," + r[3] + ")" + (o.active !== 0 ? "" : " (inativa)");
      }
      i = i + 1;
    }
  }
  return out;
}
registerCommand("camera", "camera add | camera main <obj> | camera ray <x> <y> | camera <obj> set <campo> <valores> | camera <obj> alinhar :: cria, escolhe a principal, lança um raio da tela, muda um campo (fov em graus, fundo ceu|cor|nada, cor #RRGGBB, viewport x y w h) ou alinha com a vista :: camera 3 set fov 70", false, cmdCamera);
registerCommand("cameras", "cameras :: lista as câmeras da cena (fov em graus, orto, viewport, profundidade, principal, retângulo em pixels) :: cameras", false, cmdCameras);
