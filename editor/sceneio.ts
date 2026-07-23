// Carga/instanciação de cena a partir de JSON — compartilhado por main (carga
// inicial), asset browser (duplo-clique) e controle WS (loadscene). Opera no
// `scene` singleton. Campos opcionais: parent, stationary, emissive, tex,
// scale3 [x,y,z], scripts [].
import fs from "rts:fs";

import { scene, S } from "./control/session";
import { GameObject } from "../engine/core/gameobject";
import { Spinner } from "../scripts/spinner";
import { Bobber } from "../scripts/bobber";
import { Rigidbody } from "../scripts/rigidbody";
import { Mover } from "../scripts/mover";
import { Pulse } from "../scripts/pulse";
import { setLight, setAmbient } from "../engine/render/mesh";

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
      const sd = scr[si];
      const t = sd.type;
      if (t === "spin") go.addBehavior(new Spinner(sd.sy, sd.sx));
      if (t === "bob") go.addBehavior(new Bobber(sd.amp, sd.freq, sd.base));
      if (t === "rigidbody") go.addBehavior(new Rigidbody(sd.g, sd.bounce));
      if (t === "mover") go.addBehavior(new Mover(sd.vx, sd.vy, sd.vz));
      if (t === "pulse") go.addBehavior(new Pulse(sd.amp, sd.freq, sd.base));
      si = si + 1;
    }
  }
  return go;
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
