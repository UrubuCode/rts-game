// Gera scenes/particulas-demo.json pelo próprio motor (os 4 presets reais de
// `object_presets.ts`, no molde de `gerar-vitrine.ts`), para o bench de
// quadro antes/depois (Task 11, "Frame do editor antes/depois"): uma cena
// mínima com Fogo/Fumaça/Faíscas/Chuva ativos e a câmera do editor olhando
// para eles.
//
//   rts.exe run tools/gerar-particulas-demo.ts
import io from "@compat/io.ts";
import { writeFileSync } from "node:fs";
import { scene, S } from "@editor/control/session";
import { sceneToJSON } from "@editor/sceneio";
import { OBJECT_PRESETS } from "../src/editor/object_presets";

scene.clear();
scene.name = "ParticulasDemo";

const NOMES = ["Fogo", "Fumaça", "Faíscas", "Chuva"];
let x = -4.5;
let i = 0;
while (i < OBJECT_PRESETS.length) {
  const preset = OBJECT_PRESETS[i];
  if (NOMES.indexOf(preset.label) >= 0 && preset.componentes) {
    const o = scene.createGameObject(preset.label);
    o.transform.setPosition(x, 0.0, 0.0);
    const behaviors = preset.componentes();
    let b = 0;
    while (b < behaviors.length) { o.addBehavior(behaviors[b]); b = b + 1; }
    x = x + 3.0;
  }
  i = i + 1;
}

// câmera do editor: de frente para a fileira dos 4 presets
S.camX = 0.0; S.camY = 1.5; S.camZ = 0.0 - 9.0; S.camYaw = 0.0; S.camPitch = 0.0;

const json = sceneToJSON();
writeFileSync("scenes/particulas-demo.json", json, "utf8");
io.print("[particulas-demo] scenes/particulas-demo.json com " + scene.count() + " objetos (" + json.length + " bytes)");
