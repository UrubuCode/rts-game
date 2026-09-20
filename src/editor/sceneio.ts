// Carga/instanciação de cena a partir de JSON — compartilhado por main (carga
// inicial), asset browser (duplo-clique) e controle WS (loadscene). Opera no
// `scene` singleton. Campos opcionais: parent, stationary, emissive, tex,
// scale3 [x,y,z], scripts [].
import fs from "../compat/fs.ts";

import { scene, S } from "./control/session";
import { GameObject } from "../engine/core/gameobject";
import { Behavior } from "../engine/core/behavior";
import { Material } from "../engine/core/material";
import { MeshRenderer } from "../engine/core/meshrenderer";
import { Camera } from "../engine/core/camera";
import { SceneRef } from "../engine/core/sceneref";
import { Spinner } from "../scripts/spinner";
import { Bobber } from "../scripts/bobber";
import { Rigidbody } from "../scripts/rigidbody";
import { Mover } from "../scripts/mover";
import { Pulse } from "../scripts/pulse";
import { Orbit } from "../scripts/orbit";
import { Patrol } from "../scripts/patrol";
import { Collider, SHAPE_BOX } from "../engine/core/collider";
import { hullForMesh } from "../engine/core/hullmesh";
import { setLight, setAmbient } from "../engine/render/mesh";
import { loadModel } from "../engine/render/model";

/// Recria 1 Behavior a partir do seu descritor (o que toData() produz). Fábrica
/// única usada pelo load (buildObject) E pelo clone (cloneObject). Tipo desconhecido
/// → Behavior base (no-op inofensivo). Não trata material/meshRenderer (a aparência
/// vai pelos campos do GameObject; o SceneRef é marcador e não re-instancia).
export function recreateBehavior(sd: any): Behavior {
  const t = sd.type;
  if (t === "spin") return new Spinner(sd.sy, sd.sx);
  if (t === "bob") return new Bobber(sd.amp, sd.freq, sd.base);
  if (t === "rigidbody") return new Rigidbody(sd.g, sd.bounce);
  if (t === "mover") return new Mover(sd.vx, sd.vy, sd.vz);
  if (t === "pulse") return new Pulse(sd.amp, sd.freq, sd.base);
  if (t === "orbit") return new Orbit(sd.radius, sd.speed, sd.cx, sd.cz);
  if (t === "patrol") return new Patrol(sd.range, sd.speed);
  if (t === "sceneRef") return new SceneRef(sd.scenePath);
  // COLLIDER. A forma que colide, incluindo a que ACOMPANHA a geometria.
  //
  // A casca NÃO é serializada: `hullId` é um índice num registro de processo, e
  // gravá-lo num arquivo faria uma cena carregada noutra ordem apontar para
  // outra malha. O que a cena grava é `hullMesh` — qual malha gerar a casca de —
  // e o registro devolve o id de hoje. Um id num arquivo é um ponteiro salvo em
  // disco, que é a classe de bug que só aparece na segunda cena.
  if (t === "collider") {
    const c = new Collider(sd.shape);
    c.cx = sd.cx; c.cy = sd.cy; c.cz = sd.cz;
    c.hx = sd.hx; c.hy = sd.hy; c.hz = sd.hz;
    c.trigger = sd.trigger !== undefined ? sd.trigger : 0;
    if (sd.hullMesh !== undefined && sd.hullMesh > 0) {
      c.hullId = hullForMesh(sd.hullMesh);
      // A casca pode degenerar (malha vazia, ou toda coplanar) e aí `hullForMesh`
      // devolve 0. Cair para CAIXA é o comportamento certo e é VISÍVEL — a
      // alternativa, manter `SHAPE_HULL` com id 0, faria o solver percorrer zero
      // planos e concluir "sem contato" para todo par: um objeto que atravessa
      // tudo em silêncio.
      if (c.hullId === 0) c.shape = SHAPE_BOX;
    }
    return c;
  }
  if (t === "camera") {
    const c = new Camera(sd.fov);
    if (sd.isMain !== undefined) c.isMain = sd.isMain;
    return c;
  }
  if (t === "material") {
    const m = new Material();
    m.emissive = sd.emissive; m.texChecker = sd.texChecker; m.texturePath = sd.texturePath;
    return m;   // textureId (GPU) não serializa; re-aplicar via loadtex/path
  }
  if (t === "meshRenderer") {
    const r = new MeshRenderer(sd.meshKind);
    r.customMesh = sd.customMesh;
    return r;
  }
  return new Behavior();
}

/// Clona um GameObject: transform+aparência (cloneShallow) + os SCRIPTS de gameplay
/// (kind SCRIPT, recriados via toData→recreateBehavior). Material/MeshRenderer/
/// SceneRef não são clonados (aparência vem dos campos; SceneRef é marcador).
export function cloneObject(src: GameObject): GameObject {
  const g = src.cloneShallow();
  let i = 0;
  while (i < src.behaviors.length) {
    const d = src.behaviors[i].toData();   // clona TODOS os componentes que serializam
    if (d !== null) g.addBehavior(recreateBehavior(d));
    i = i + 1;
  }
  return g;
}

/// Serializa 1 GameObject no descritor que buildObject lê (round-trip). Os
/// behaviors viram `scripts` via toData() (pula os que devolvem null).
export function objectToData(go: GameObject): any {
  const scripts: any[] = [];
  let i = 0;
  while (i < go.behaviors.length) {
    const d = go.behaviors[i].toData();
    if (d !== null) scripts.push(d);
    i = i + 1;
  }
  const t = go.transform;
  return {
    name: go.name,
    mesh: go.meshKind,
    color: [go.cr, go.cg, go.cb],
    pos: [t.px, t.py, t.pz],
    rot: [t.rx, t.ry],
    scale3: [t.sx, t.sy, t.sz],
    parent: go.parent,
    stationary: go.stationary,
    emissive: go.emissive,
    tex: go.tex,
    meshPath: go.meshPath,   // modelo do objeto (o id de GPU não serializa; recarrega no load)
    meshPart: go.meshPart,   // qual submesh do modelo (multi-material)
    scripts: scripts
  };
}

/// Serializa a cena inteira num string JSON ({ objects: [...] }). Base do save E
/// do undo/redo (snapshot).
export function sceneToJSON(): string {
  const objs: any[] = [];
  let i = 0;
  while (i < scene.objects.length) { objs.push(objectToData(scene.objects[i])); i = i + 1; }
  // A CÂMERA vai junto: o runtime do jogo (game.ts) não tem controles de editor,
  // então ele abre exatamente no ponto de vista que o autor deixou salvo.
  // Também guarda a luz, que é estado de cena e não do editor.
  const data = {
    objects: objs,
    camera: [S.camX, S.camY, S.camZ, S.camYaw, S.camPitch],
    light: [S.lightX, S.lightY, S.lightZ, S.lightAmb]
  };
  return JSON.stringify(data);
}

/// Restaura a cena a partir de um string JSON (SUBSTITUI a atual). Base do load E
/// do undo/redo.
export function sceneFromJSON(s: string): void {
  scene.clear();
  const data = JSON.parse(s);
  const arr = data.objects;
  if (arr === undefined) return;
  let i = 0;
  while (i < arr.length) { scene.add(buildObject(arr[i])); i = i + 1; }
}

/// SALVA a cena inteira num arquivo JSON — fecha o loop com loadSceneFrom.
export function saveScene(path: string): number {
  fs.write(path, sceneToJSON());
  return scene.objects.length;
}

/// Constrói 1 GameObject a partir de um descritor JSON.
export function buildObject(od: any): GameObject {
  const go = new GameObject(od.name);
  if (od.parent !== undefined) go.parent = od.parent;
  if (od.stationary !== undefined) go.stationary = od.stationary;
  if (od.emissive !== undefined) go.emissive = od.emissive;
  if (od.tex !== undefined) go.tex = od.tex;
  // modelo do objeto (.obj/.glb/.gltf): o id de GPU não sobrevive ao JSON —
  // recarrega pelo path (o cache do loader evita re-parsear o mesmo arquivo).
  // `meshPart` diz QUAL submesh era, pra modelos multi-material voltarem certos.
  if (od.meshPath !== undefined && od.meshPath.length > 0) {
    go.meshPath = od.meshPath;
    if (fs.exists(od.meshPath)) {
      const parts = loadModel(S.win, od.meshPath);
      let pidx = 0;
      if (od.meshPart !== undefined) pidx = od.meshPart | 0;
      if (pidx >= 0 && pidx < parts.length) {
        go.customMesh = parts[pidx].meshId;
        go.meshPart = pidx;
      }
    }
  }
  const col = od.color;
  go.setMesh(od.mesh, col[0], col[1], col[2]);
  const p = od.pos;
  const r = od.rot;
  go.transform.setPosition(p[0], p[1], p[2]);
  go.transform.rx = r[0];
  go.transform.ry = r[1];
  if (od.scale3 !== undefined) {
    const s3 = od.scale3;
    go.transform.sx = s3[0]; go.transform.sy = s3[1]; go.transform.sz = s3[2];
  } else {
    go.transform.setScale(od.scale);
  }
  const scr = od.scripts;
  if (scr !== undefined) {
    let si = 0;
    while (si < scr.length) {
      const b = recreateBehavior(scr[si]);
      if (b.kind() >= 0) go.addBehavior(b);   // kind()>=0 sempre; guarda defensiva
      si = si + 1;
    }
  }
  return go;
}

/// CENA DENTRO DE CENA (estilo Godot): instancia uma cena inteira ADITIVAMENTE,
/// parenteando suas raízes sob o objeto `hostIdx` (-1 = como raízes da cena). O
/// host vira o "âncora": mover/rotacionar/escalar o host move a sub-cena inteira
/// (via o sistema de parent + computeWorld). Devolve quantos objetos instanciou.
///
/// Remap de índice: as raízes da sub-cena (parent < 0) viram filhas do host; os
/// demais têm o parent deslocado pelo offset (base) onde a sub-cena foi anexada.
export function instantiateSceneUnder(path: string, hostIdx: number): number {
  if (!fs.exists(path)) return 0;
  const data = JSON.parse(fs.read_text(path));
  const arr = data.objects;
  if (arr === undefined) return 0;
  const base = scene.objects.length;   // offset dos índices que entram
  let n = 0;
  let ci = 0;
  while (ci < arr.length) {
    const go = buildObject(arr[ci]);
    if (go.parent < 0) go.parent = hostIdx;        // raiz da sub-cena → filha do host
    else go.parent = base + go.parent;              // desloca o parent interno
    scene.add(go);
    n = n + 1;
    ci = ci + 1;
  }
  // marca o host como instância desta cena (component SceneRef — serializa + inspector)
  if (n > 0 && hostIdx >= 0 && hostIdx < scene.objects.length) {
    scene.objects[hostIdx].addBehavior(new SceneRef(path));
  }
  return n;
}

/// Carrega uma cena inteira ({ objects: [...] }), SUBSTITUINDO a atual.
export function loadSceneFrom(path: string): void {
  if (!fs.exists(path)) return;
  scene.clear();
  S.selected = 0;
  const data = JSON.parse(fs.read_text(path));
  const arr = data.objects;
  let ci = 0;
  while (ci < arr.length) { scene.add(buildObject(arr[ci])); ci = ci + 1; }
  setLight(0.35, 1.0, 0.25);
  setAmbient(0.2);
  let ei = 0;
  while (ei < scene.objects.length) {
    if (scene.objects[ei].name === "Sun") scene.objects[ei].emissive = 1;
    ei = ei + 1;
  }
}

/// Instancia 1 prefab (arquivo com UM objeto) na cena atual, sem limpá-la.
export function instantiatePrefab(path: string): void {
  if (!fs.exists(path)) return;
  scene.add(buildObject(JSON.parse(fs.read_text(path))));
}
