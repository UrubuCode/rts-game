// Carga/instanciação de cena a partir de JSON — compartilhado por main (carga
// inicial), asset browser (duplo-clique) e controle WS (loadscene). Opera no
// `scene` singleton. Campos opcionais: parent, stationary, emissive, tex,
// scale3 [x,y,z], scripts [].
import fs from "rts:fs";

import { scene, S } from "./control/session";
import { GameObject } from "../engine/core/gameobject";
import { Behavior } from "../engine/core/behavior";
import { SceneRef } from "../engine/core/sceneref";
import { Spinner } from "../scripts/spinner";
import { Bobber } from "../scripts/bobber";
import { Rigidbody } from "../scripts/rigidbody";
import { Mover } from "../scripts/mover";
import { Pulse } from "../scripts/pulse";
import { Orbit } from "../scripts/orbit";
import { setLight, setAmbient } from "../engine/render/mesh";

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
  if (t === "sceneRef") return new SceneRef(sd.scenePath);
  return new Behavior();
}

/// Clona um GameObject: transform+aparência (cloneShallow) + os SCRIPTS de gameplay
/// (kind SCRIPT, recriados via toData→recreateBehavior). Material/MeshRenderer/
/// SceneRef não são clonados (aparência vem dos campos; SceneRef é marcador).
export function cloneObject(src: GameObject): GameObject {
  const g = src.cloneShallow();
  let i = 0;
  while (i < src.behaviors.length) {
    const b = src.behaviors[i];
    if (b.kind() === 0) {   // KIND_SCRIPT
      const d = b.toData();
      if (d !== null) g.addBehavior(recreateBehavior(d));
    }
    i = i + 1;
  }
  return g;
}

/// Constrói 1 GameObject a partir de um descritor JSON.
export function buildObject(od: any): GameObject {
  const go = new GameObject(od.name);
  if (od.parent !== undefined) go.parent = od.parent;
  if (od.stationary !== undefined) go.stationary = od.stationary;
  if (od.emissive !== undefined) go.emissive = od.emissive;
  if (od.tex !== undefined) go.tex = od.tex;
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
