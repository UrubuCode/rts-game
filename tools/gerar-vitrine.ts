// Gera scenes/vitrine.json pelo PRÓPRIO motor (componentes reais +
// sceneToJSON), em vez de JSON à mão: o que o editor salva é o que isto salva.
//
//   rts.exe run tools/gerar-vitrine.ts
//
// A cena mostra o que o RTS entrega hoje: caixas caindo sobre blocos GIRADOS
// (OBB em Y), eventos de contato chegando a scripts, uma zona de gatilho, e um
// HUD com números ao vivo + botão.
import io from "@compat/io.ts";
import { writeFileSync } from "node:fs";
import { scene, S } from "@editor/control/session";
import { sceneToJSON } from "@editor/sceneio";
import { GameObject, COL_BOX, COL_SPHERE } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import { Collider, SHAPE_BOX } from "@engine/core/collider";
import { CONTACT_EVENTS_ENTER_EXIT } from "@engine/core/contact_events";
import { UIText } from "@engine/core/ui_text";
import { UIButton } from "@engine/core/ui_button";
import { ANCHOR_BR } from "@engine/ui/anchor";
import { Material } from "@engine/core/material";
import { VitrineHud } from "../assets/scripts/VitrineHud";
import { VitrineContador } from "../assets/scripts/VitrineContador";

const PI = 3.141592653589793;

/// Material com textura procedural (ou PNG, se `png` != "") e Tiling em mundo.
function material(o: GameObject, procedural: string, png: string, tile: f64): void {
  const m = new Material();
  m.procedural = procedural;
  m.texturePath = png;
  m.tile = tile;
  o.addBehavior(m);
}

function bloco(nome: string, x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64, yaw: f64, r: number, g: number, b: number): GameObject {
  const o = new GameObject(nome);
  o.setMesh(1, r, g, b);
  o.colShape = COL_BOX;
  o.stationary = 1;
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx; o.transform.sy = sy; o.transform.sz = sz;
  o.transform.ry = yaw;
  scene.add(o);
  return o;
}

scene.clear();
scene.name = "Vitrine";

// chão de ladrilhos: 0,25 repetições por unidade = um ladrilho grande a cada 4 u
material(bloco("Chao", 0.0, -0.5, 0.0, 60.0, 1.0, 60.0, 0.0, 225, 225, 230), "piso", "", 0.25);

// muro do fundo com a textura PNG de tijolo (assets/textures/tijolo.png)
material(bloco("Muro", 0.0, 3.0, 14.0, 30.0, 6.0, 1.0, 0.0, 255, 255, 255), "", "assets/textures/tijolo.png", 0.5);

// blocos girados (OBB em Y): uma rampa de plataformas em leque
let i = 0;
while (i < 6) {
  const ang = (i / 6.0) * PI;
  const raio = 7.0;
  material(bloco("Plataforma" + i, Math.cos(ang) * raio, 1.0 + i * 0.5, Math.sin(ang) * raio, 6.0, 0.6, 1.4, ang + PI / 2.0, 235, 225 - i * 10, 210), "madeira", "", 0.5);
  i = i + 1;
}

// zona de gatilho no centro: conta quem entra
{
  const z = new GameObject("Zona");
  z.setMesh(1, 80, 200, 120);
  z.colShape = COL_BOX;
  z.stationary = 1;
  z.transform.setPosition(0.0, 1.5, 0.0);
  z.transform.sx = 4.0; z.transform.sy = 3.0; z.transform.sz = 4.0;
  const c = new Collider(SHAPE_BOX);
  c.trigger = 1;
  c.events = CONTACT_EVENTS_ENTER_EXIT;
  z.addBehavior(c);
  z.addBehavior(new VitrineContador());
  scene.add(z);
}

// caixas caindo, com eventos de contato e contador
i = 0;
while (i < 36) {
  const o = new GameObject("Caixa" + i);
  o.setMesh(i % 2 === 0 ? 1 : 4, 220, 200 - (i % 6) * 20, 120 + (i % 4) * 30);
  o.colShape = i % 2 === 0 ? COL_BOX : COL_SPHERE;
  const ang = (i / 36.0) * 2.0 * PI;
  const raio = 3.0 + (i % 5);
  o.transform.setPosition(Math.cos(ang) * raio, 8.0 + (i % 6) * 1.5, Math.sin(ang) * raio);
  o.transform.setScale(0.8);
  o.transform.ry = (i % 4) * 0.4;
  o.addBehavior(new Rigidbody(0.0 - 9.8, 0.2));
  const c = new Collider(SHAPE_BOX);
  c.events = CONTACT_EVENTS_ENTER_EXIT;
  o.addBehavior(c);
  o.addBehavior(new VitrineContador());
  if (i % 2 === 0) material(o, "metal", "", 1.0);
  scene.add(o);
  i = i + 1;
}

// HUD: texto no canto superior esquerdo + botão no inferior direito + script
{
  const h = new GameObject("HUD");
  h.transform.px = 16; h.transform.py = 16;
  h.addBehavior(new UIText("RTS - vitrine", 16, 0xECEFF4FF, 0));
  h.addBehavior(new UIButton("Derrubar", 160, 36, ANCHOR_BR));
  h.addBehavior(new VitrineHud());
  scene.add(h);
}

// câmera: de frente para o muro de tijolo, vendo o chão e as plataformas
S.camX = 0.0; S.camY = 7.0; S.camZ = -16.0; S.camYaw = 0.0; S.camPitch = 0.0 - 0.25;

const json = sceneToJSON();
writeFileSync("scenes/vitrine.json", json, "utf8");
io.print("[vitrine] scenes/vitrine.json com " + scene.count() + " objetos (" + json.length + " bytes)");
