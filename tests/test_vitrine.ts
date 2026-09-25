// A cena de demonstração carrega, roda na CPU dentro do orçamento e os
// sistemas que ela mostra (OBB em Y, eventos de contato, gatilho, HUD, botão)
// de fato acontecem. Sem janela.
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { scene } from "@editor/control/session";
import { sceneFromJSON } from "@editor/sceneio";
import { FIXED_DT } from "@engine/core/fixedstep";
import { rigidSetMode, rigidStep, rigidFlush, rigidYawBoxCount } from "@engine/core/physics_backend";
import { dispatchUIClick } from "@engine/ui/game_ui";
import { vitrine } from "../assets/scripts/VitrineEstado";
import { VitrineHud } from "../assets/scripts/VitrineHud";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function mediana(a: f64[]): f64 {
  const s = a.slice().sort((x: f64, y: f64) => x - y);
  return s[(s.length / 2) | 0];
}

check(fs.exists("scenes/vitrine.json"), "scenes/vitrine.json existe (gerar com rts.exe run tools/gerar-vitrine.ts)");
sceneFromJSON(fs.read_text("scenes/vitrine.json"));
check(scene.objects.length === 1 + 6 + 1 + 36 + 1, "45 objetos carregados");
check(scene.uiObjs.length === 1, "o HUD e o unico objeto de UI");

rigidSetMode(0);
scene.markCollidersDirty();
scene.computeWorld();

let hud: VitrineHud | null = null;
const h = scene.uiObjs[0];
let k = 0;
while (k < h.behaviors.length) { if (h.behaviors[k].typeName() === "VitrineHud") hud = h.behaviors[k] as VitrineHud; k = k + 1; }
check(hud !== null, "VitrineHud restaurado do JSON");

const tempos: f64[] = [];
let i = 0;
while (i < 600) {
  const t0 = performance.now();
  scene.update(FIXED_DT);
  if (rigidStep(scene, 0) === 0) scene.resolveCollisions();
  tempos.push(performance.now() - t0);
  i = i + 1;
}
rigidFlush();
scene.computeWorld();

const ms = mediana(tempos);
io.print("  passo (update + fisica) mediano: " + ms.toFixed(3) + " ms | contatos " + vitrine.contatos + " | gatilhos " + vitrine.gatilhos);
check(ms < 1.0, "passo mediano abaixo de 1 ms (36 corpos): " + ms.toFixed(3));
check(rigidYawBoxCount() > 0, "ha caixas giradas: OBB em Y esta em uso (passo na CPU)");
check(vitrine.contatos > 10, "eventos de contato chegaram aos scripts: " + vitrine.contatos);
check(vitrine.gatilhos > 0, "algum corpo passou pela zona de gatilho: " + vitrine.gatilhos);
let noChao = 0;
let abaixo = 0;
i = 0;
while (i < scene.objects.length) {
  const o = scene.objects[i];
  if (o.name.indexOf("Caixa") === 0) { if (o.transform.py > 0.2) noChao = noChao + 1; else abaixo = abaixo + 1; }
  i = i + 1;
}
check(abaixo === 0, "nenhuma caixa atravessou o chao (" + abaixo + ")");
const texto = (hud as VitrineHud).ultimo();
io.print("  HUD: " + texto);
check(texto.indexOf("fps") > 0 && texto.indexOf("contatos") > 0, "HUD mostra fps e contatos");

// botão: onUIClick("Derrubar") empurra as caixas
const antes = vitrine.derrubadas;
dispatchUIClick(h, "Derrubar");
check(vitrine.derrubadas > antes, "Derrubar empurrou " + (vitrine.derrubadas - antes) + " caixas");
let subiu = 0;
i = 0;
while (i < scene.objects.length) { if (scene.objects[i].name.indexOf("Caixa") === 0 && scene.objects[i].transform.vy > 1.0) subiu = subiu + 1; i = i + 1; }
check(subiu > 30, "as caixas ganharam velocidade para cima: " + subiu);

io.print("[PASSOU] Vitrine: carga, " + ms.toFixed(3) + " ms/passo, OBB, eventos, gatilho, HUD e botao");
