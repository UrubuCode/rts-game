// Carga/instanciação de cena a partir de JSON — compartilhado por main (carga
// inicial), asset browser (duplo-clique) e controle WS (loadscene). Opera no
// `scene` singleton. Campos opcionais: parent, stationary, emissive, tex,
// scale3 [x,y,z], scripts [].
import fs from "../compat/fs.ts";
import { writeFileSync, renameSync, unlinkSync, openSync, closeSync } from "node:fs";

import { scene, S } from "./control/session";
import { Scene } from "../engine/core/scene";
import { GameObject, getNextGameObjectId, setNextGameObjectId } from "../engine/core/gameobject";
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
import { Animator } from "../scripts/animator";
import { AudioSource } from "../scripts/audiosource";
import { PhysicsMaterial } from "../scripts/physicsmaterial";
import { Collider, SHAPE_BOX } from "../engine/core/collider";
import { hullForMesh } from "../engine/core/hullmesh";
import { setLight, setAmbient } from "../engine/render/mesh";
import { loadModel } from "../engine/render/model";
import { restoreRegisteredComponent } from "../engine/generated/components";
import { componentToData } from "../engine/components";
import { componentMetadata } from "../engine/core/component_metadata";
import { MissingScript } from "../engine/core/missing_script";

/// Recria 1 Behavior a partir do seu descritor (o que toData() produz). Fábrica
/// única usada pelo load, clone e Play. Scripts gerados usam seus metadados;
/// os descritores antigos continuam aceitos. Tipo ausente preserva os dados
/// num MissingScript, em vez de descarta-los silenciosamente ao salvar.
export function recreateBehavior(sd: any): Behavior {
  const component = recreateBehaviorInner(sd);
  componentMetadata.provider.restoreLegacyFields(component, sd.componentFields);
  if (sd._enabled !== undefined) component.enabled = sd._enabled !== 0 ? 1 : 0;
  if (sd._collapsed !== undefined) component.collapsed = sd._collapsed !== 0 ? 1 : 0;
  return component;
}

function recreateBehaviorInner(sd: any): Behavior {
  const registered = restoreRegisteredComponent(sd);
  if (registered !== null) return registered;
  const t = sd.type !== undefined ? sd.type : sd.t;
  if (t === "spin") return new Spinner(sd.sy, sd.sx);
  if (t === "bob") return new Bobber(sd.amp, sd.freq, sd.base);
  if (t === "rigidbody") {
    const rb = new Rigidbody(sd.g, sd.bounce);
    if (sd.mass !== undefined) rb.mass = sd.mass;
    if (sd.drag !== undefined) rb.drag = sd.drag;
    if (sd.floorY !== undefined) rb.floorY = sd.floorY;
    if (sd.bodyType !== undefined) rb.bodyType = sd.bodyType;
    return rb;
  }
  if (t === "mover") return new Mover(sd.vx, sd.vy, sd.vz);
  if (t === "pulse") return new Pulse(sd.amp, sd.freq, sd.base);
  if (t === "orbit") return new Orbit(sd.radius, sd.speed, sd.cx, sd.cz);
  if (t === "patrol") return new Patrol(sd.range, sd.speed);
  if (t === "animator") {
    const animator = new Animator(sd.channel, sd.ease);
    animator.loop = sd.loop; animator.speed = sd.speed;
    let keyIndex = 0;
    while (keyIndex < sd.kt.length) { animator.key(sd.kt[keyIndex], sd.kv[keyIndex]); keyIndex = keyIndex + 1; }
    return animator;
  }
  if (t === "audiosource") {
    const audio = new AudioSource(sd.kind, sd.freq, sd.dur, sd.gain);
    audio.every = sd.every;
    return audio;
  }
  if (t === "physicsmaterial") {
    const physical = new PhysicsMaterial(sd.preset);
    physical.density = sd.density; physical.restitution = sd.restitution; physical.friction = sd.friction;
    return physical;
  }
  if (t === "sceneRef") return new SceneRef(sd.scenePath);
  // COLLIDER. A forma que colide, incluindo a que ACOMPANHA a geometria.
  //
  // A casca NÃO é serializada: `hullId` é um índice num registro de processo, e
  // gravá-lo num arquivo faria uma cena carregada noutra ordem apontar para
  // outra malha. O que a cena grava é `hullMesh` — qual malha gerar a casca de —
  // e o registro devolve o id de hoje. Um id num arquivo é um ponteiro salvo em
  // disco, que é a classe de bug que só aparece na segunda cena.
  if (t === "collider" || t === "Collider") {
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
  return new MissingScript(sd);
}

/// Clona um GameObject: transform+aparência (cloneShallow) + os SCRIPTS de gameplay
/// (kind SCRIPT, recriados via toData→recreateBehavior). Material/MeshRenderer/
/// SceneRef não são clonados (aparência vem dos campos; SceneRef é marcador).
export function cloneObject(src: GameObject): GameObject {
  const g = src.cloneShallow();
  let i = 0;
  while (i < src.behaviors.length) {
    const d = componentToData(src.behaviors[i]);
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
    const d = componentToData(go.behaviors[i]);
    if (d !== null) { d._enabled = go.behaviors[i].enabled; d._collapsed = go.behaviors[i].collapsed; scripts.push(d); }
    i = i + 1;
  }
  const t = go.transform;
  return {
    id: go.id,
    name: go.name,
    active: go.active,
    mesh: go.meshKind,
    color: [go.cr, go.cg, go.cb],
    pos: [t.px, t.py, t.pz],
    rot: [t.rx, t.ry, t.rz],
    scale3: [t.sx, t.sy, t.sz],
    parent: go.parent,
    stationary: go.stationary,
    layer: go.layer,
    mask: go.mask,
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
    name: scene.name,
    objects: objs,
    camera: [S.camX, S.camY, S.camZ, S.camYaw, S.camPitch],
    light: [S.lightX, S.lightY, S.lightZ, S.lightAmb]
  };
  return JSON.stringify(data);
}

/// Constrói um conjunto com os IDs de todos os objetos existentes na cena (para busca O(1)).
export function buildIdSet(sc: Scene): Set<number> {
  const s = new Set<number>();
  const objs = sc.objects;
  const n = objs.length;
  let i = 0;
  while (i < n) {
    s.add(objs[i].id);
    i = i + 1;
  }
  return s;
}

function isIdInScene(id: number, sc: Scene): boolean {
  let i = 0;
  const objs = sc.objects;
  const n = objs.length;
  while (i < n) {
    if (objs[i].id === id) return true;
    i = i + 1;
  }
  return false;
}

/// Restaura a cena a partir de um string JSON (SUBSTITUI a atual). Base do load E
/// do undo/redo.
function validateVector(value: any, size: number, label: string): void {
  if (!Array.isArray(value) || value.length < size) throw new Error("Vetor invalido: " + label);
  let i = 0;
  while (i < value.length) {
    if (typeof value[i] !== "number" || !Number.isFinite(value[i])) throw new Error("Numero invalido: " + label);
    i = i + 1;
  }
}

export function sceneFromJSON(s: string, sc?: Scene): void {
  const targetScene = sc !== undefined ? sc : scene;
  const data = JSON.parse(s);
  if (data === null || !Array.isArray(data.objects)) throw new Error("Cena invalida: objects deve ser uma lista.");
  const arr = data.objects;
  if (data.camera !== undefined) validateVector(data.camera, 5, "camera");
  if (data.light !== undefined) validateVector(data.light, 4, "light");
  const next: GameObject[] = [];
  const idSet = buildIdSet(targetScene);
  let i = 0;
  while (i < arr.length) {
    const item = arr[i];
    if (item === null || typeof item.name !== "string" || !Array.isArray(item.pos) || !Array.isArray(item.rot) || !Array.isArray(item.color)) throw new Error("Objeto invalido na cena: " + i);
    if (item.pos.length < 3 || item.rot.length < 2 || item.color.length < 3) throw new Error("Transform ou cor incompletos: " + i);
    validateVector(item.pos, 3, "pos"); validateVector(item.rot, 2, "rot"); validateVector(item.color, 3, "color");
    if (item.scale3 !== undefined) validateVector(item.scale3, 3, "scale3");
    if (item.scale !== undefined && (typeof item.scale !== "number" || !Number.isFinite(item.scale))) throw new Error("Escala invalida: " + i);
    if (item.scripts !== undefined && !Array.isArray(item.scripts)) throw new Error("Scripts invalidos: " + i);
    if (item.parent !== undefined && (typeof item.parent !== "number" || item.parent < -1 || item.parent >= arr.length || item.parent === i || item.parent !== Math.floor(item.parent))) throw new Error("Pai invalido: " + i);
    next.push(buildObject(item, targetScene, idSet)); i = i + 1;
  }
  // Validate ancestry before touching the live scene.
  i = 0;
  while (i < next.length) {
    let parent = next[i].parent; let depth = 0;
    while (parent >= 0) { if (depth >= next.length) throw new Error("Hierarquia ciclica."); parent = next[parent].parent; depth = depth + 1; }
    i = i + 1;
  }
  const previous = targetScene.objects.slice();
  targetScene.clear();
  try {
    i = 0; while (i < next.length) { targetScene.add(next[i]); i = i + 1; }
  } catch (error) {
    targetScene.clear(); i = 0; while (i < previous.length) { targetScene.add(previous[i], false); i = i + 1; }
    throw error;
  }
  if (typeof data.name === "string") targetScene.name = data.name;
  if (targetScene !== scene) return;
  if (Array.isArray(data.camera) && data.camera.length >= 5) {
    S.camX = data.camera[0]; S.camY = data.camera[1]; S.camZ = data.camera[2]; S.camYaw = data.camera[3]; S.camPitch = data.camera[4];
  }
  if (Array.isArray(data.light) && data.light.length >= 4) {
    S.lightX = data.light[0]; S.lightY = data.light[1]; S.lightZ = data.light[2]; S.lightAmb = data.light[3];
  }
}

/// SALVA a cena inteira num arquivo JSON — fecha o loop com loadSceneFrom.
const sceneSaveSequence = { next: 0 };
export function saveScene(path: string): number {
  // A simulacao e descartavel; nunca sobrescreva o arquivo de autoria com ela.
  if (S.simulating !== 0) return 0 - 1;
  sceneSaveSequence.next = sceneSaveSequence.next + 1;
  const temporary = path + ".rts-saving-" + Date.now() + "-" + sceneSaveSequence.next;
  const contents = sceneToJSON();
  // RTS reports some native filesystem failures as undefined, not exceptions.
  // Reserve our own temporary file, verify bytes, then replace the destination.
  const fd = openSync(temporary, "wx");
  if (typeof fd !== "number") throw new Error("Nao foi possivel criar arquivo temporario: " + temporary);
  closeSync(fd);
  try {
    writeFileSync(temporary, contents, "utf8");
    if (fs.read_text(temporary) !== contents) throw new Error("Falha ao verificar escrita: " + temporary);
    renameSync(temporary, path);
    if (fs.exists(temporary) || fs.read_text(path) !== contents) throw new Error("Falha ao substituir cena: " + path);
  }
  catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  return scene.objects.length;
}

/// Constrói 1 GameObject a partir de um descritor JSON.
export function buildObject(od: any, sc?: Scene, idSet?: Set<number>): GameObject {
  const targetScene = sc !== undefined ? sc : scene;
  const go = new GameObject(od.name);
  if (od.active !== undefined) go.active = od.active;
  if (od.id !== undefined) {
    const isConflict = idSet !== undefined
      ? idSet.has(od.id)
      : (targetScene !== null && targetScene !== undefined && isIdInScene(od.id, targetScene));
    if (isConflict) {
      const newId = getNextGameObjectId();
      go.id = newId;
      setNextGameObjectId(newId + 1);
      if (idSet !== undefined) idSet.add(newId);
    } else {
      go.id = od.id;
      if (od.id >= getNextGameObjectId()) {
        setNextGameObjectId(od.id + 1);
      }
      if (idSet !== undefined) idSet.add(od.id);
    }
  }
  if (od.parent !== undefined) go.parent = od.parent;
  if (od.stationary !== undefined) go.stationary = od.stationary;
  if (od.layer !== undefined) go.layer = od.layer;
  if (od.mask !== undefined) go.mask = od.mask;
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
  if (r.length > 2) go.transform.rz = r[2];
  if (od.scale3 !== undefined) {
    const s3 = od.scale3;
    go.transform.sx = s3[0]; go.transform.sy = s3[1]; go.transform.sz = s3[2];
  } else {
    go.transform.setScale(od.scale !== undefined ? od.scale : 1);
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
export function instantiateSceneUnder(path: string, hostIdx: number, sc?: Scene): number {
  const targetScene = sc !== undefined ? sc : scene;
  if (!fs.exists(path)) return 0;
  const data = JSON.parse(fs.read_text(path));
  const arr = data.objects;
  if (arr === undefined) return 0;
  const base = targetScene.objects.length;   // offset dos índices que entram
  const idSet = buildIdSet(targetScene);
  let n = 0;
  let ci = 0;
  while (ci < arr.length) {
    const go = buildObject(arr[ci], targetScene, idSet);
    if (go.parent < 0) go.parent = hostIdx;        // raiz da sub-cena → filha do host
    else go.parent = base + go.parent;              // desloca o parent interno
    targetScene.add(go);
    n = n + 1;
    ci = ci + 1;
  }
  // marca o host como instância desta cena (component SceneRef — serializa + inspector)
  if (n > 0 && hostIdx >= 0 && hostIdx < targetScene.objects.length) {
    targetScene.objects[hostIdx].addBehavior(new SceneRef(path));
  }
  return n;
}

/// Carrega uma cena inteira ({ objects: [...] }), SUBSTITUINDO a atual.
export function loadSceneFrom(path: string, sc?: Scene): void {
  if (!fs.exists(path)) throw new Error("Cena nao encontrada: " + path);
  const targetScene = sc !== undefined ? sc : scene;
  sceneFromJSON(fs.read_text(path), targetScene);
  if (targetScene === scene) S.selected = 0;
  setLight(0.35, 1.0, 0.25);
  setAmbient(0.2);
  let ei = 0;
  while (ei < targetScene.objects.length) {
    if (targetScene.objects[ei].name === "Sun") targetScene.objects[ei].emissive = 1;
    ei = ei + 1;
  }
}

/// Instancia 1 prefab (arquivo com UM objeto) na cena atual, sem limpá-la.
export function instantiatePrefab(path: string, sc?: Scene): void {
  if (!fs.exists(path)) return;
  const targetScene = sc !== undefined ? sc : scene;
  const idSet = buildIdSet(targetScene);
  targetScene.add(buildObject(JSON.parse(fs.read_text(path)), targetScene, idSet));
}
