// Sem janela: confere os 4 presets de partículas em OBJECT_PRESETS (Fogo,
// Fumaça, Faíscas, Chuva) — cada um com `componentes` definido, e que
// chamar `componentes()` duas vezes devolve DUAS instâncias distintas de
// ParticleSystem (não compartilha pool entre dois objetos criados a partir
// do mesmo preset).
import process from "@compat/process.ts";
import { OBJECT_PRESETS } from "@editor/object_presets";
import { ParticleSystem } from "@scripts/particlesystem";

function falhar(msg: string): void { console.log("[FALHOU] " + msg); process.exit(1); }

const ESPERADOS = ["Fogo", "Fumaça", "Faíscas", "Chuva"];
let ei = 0;
while (ei < ESPERADOS.length) {
  const rotulo = ESPERADOS[ei];
  let preset: any = null;
  let pi = 0;
  while (pi < OBJECT_PRESETS.length) { if (OBJECT_PRESETS[pi].label === rotulo) preset = OBJECT_PRESETS[pi]; pi = pi + 1; }
  if (preset === null) falhar("preset '" + rotulo + "' não encontrado em OBJECT_PRESETS");
  if (typeof preset.componentes !== "function") falhar("preset '" + rotulo + "' sem componentes()");

  const a = preset.componentes();
  const b = preset.componentes();
  if (!Array.isArray(a) || a.length === 0) falhar("preset '" + rotulo + "': componentes() deveria devolver ao menos 1 Behavior");
  if (!(a[0] instanceof ParticleSystem)) falhar("preset '" + rotulo + "': componentes()[0] deveria ser ParticleSystem");
  if (!(b[0] instanceof ParticleSystem)) falhar("preset '" + rotulo + "': 2ª chamada deveria devolver ParticleSystem também");
  if (a[0] === b[0]) falhar("preset '" + rotulo + "': duas chamadas de componentes() devolveram a MESMA instância (compartilhamento de pool entre objetos)");
  ei = ei + 1;
}

console.log("[PASSOU] test_editor_particulas_presets");
