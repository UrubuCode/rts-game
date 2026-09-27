// Opcoes de criacao do editor: um registro serve aos dois menus e a fabrica.
// Luzes e câmera vêm dos pacotes (itens @menuItem Criar/Luz/* e Criar/Câmera).
import type { Behavior } from "@engine/core/behavior";
import { ParticleSystem } from "@scripts/particlesystem";
import { FORMA_ESFERA, FORMA_CONE, FORMA_CAIXA } from "@engine/particles/desc";

/// `componentes` opcional: fábrica dos Behaviors do preset (ex.: os 4 de
/// partículas abaixo). Chamada de novo a cada criação — devolve instâncias
/// NOVAS, nunca compartilhadas entre dois objetos nascidos do mesmo preset
/// (cada ParticleSystem tem seu próprio pool).
export type ObjectPreset = { label: string; name: string; meshKind: number; r: number; g: number; b: number; componentes?: () => Behavior[] };

/// Preset "Fogo": cone estreito para cima, aditivo, laranja→vermelho→some.
function presetFogo(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_CONE; p.anguloCone = 15.0; p.rateOverTime = 30.0; p.modo = 1;   // aditivo
  p.startColorR = 1.0; p.startColorG = 0.5; p.startColorB = 0.1;
  p.startSpeedMin = 1.0; p.startSpeedMax = 2.0;
  p.startLifetimeMin = 0.6; p.startLifetimeMax = 1.0;
  p.startSizeMin = 0.3; p.startSizeMax = 0.6;
  // gradiente: laranja opaco → vermelho → transparente (some no fim da vida)
  const g0 = new Float64Array([0.0, 1.0, 0.5, 0.1, 1.0]);
  const g1 = new Float64Array([0.5, 1.0, 0.15, 0.0, 0.9]);
  const g2 = new Float64Array([1.0, 0.4, 0.0, 0.0, 0.0]);
  p.setChaveGradiente(0, g0); p.setChaveGradiente(1, g1); p.setChaveGradiente(2, g2);
  return [p];
}
/// Preset "Fumaça": cone largo e lento, alfa, cinza crescendo e sumindo.
function presetFumaca(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_CONE; p.anguloCone = 25.0; p.rateOverTime = 8.0; p.modo = 0;   // alfa
  p.startColorR = 0.5; p.startColorG = 0.5; p.startColorB = 0.5;
  p.startSpeedMin = 0.3; p.startSpeedMax = 0.6;
  p.startLifetimeMin = 2.0; p.startLifetimeMax = 3.0;
  p.startSizeMin = 0.5; p.startSizeMax = 1.2;
  p.arrasto = 0.3;
  // gradiente: cinza translúcido crescendo em alfa e sumindo no fim
  const g0 = new Float64Array([0.0, 0.5, 0.5, 0.5, 0.0]);
  const g1 = new Float64Array([0.3, 0.55, 0.55, 0.55, 0.5]);
  const g2 = new Float64Array([1.0, 0.6, 0.6, 0.6, 0.0]);
  p.setChaveGradiente(0, g0); p.setChaveGradiente(1, g1); p.setChaveGradiente(2, g2);
  // curva de tamanho: cresce ao longo da vida (fumaça se dispersa)
  const t0 = new Float64Array([0.0, 0.6]);
  const t1 = new Float64Array([1.0, 1.8]);
  p.setChaveTamanho(0, t0); p.setChaveTamanho(1, t1);
  return [p];
}
/// Preset "Faíscas": esfera pontual, aditivo, rápido, cai com a gravidade, vida curta.
function presetFaiscas(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_ESFERA; p.raio = 0.05; p.rateOverTime = 0.0; p.modo = 1;   // aditivo; só burst
  p.startColorR = 1.0; p.startColorG = 0.9; p.startColorB = 0.4;
  p.startSpeedMin = 2.0; p.startSpeedMax = 5.0;
  p.startLifetimeMin = 0.3; p.startLifetimeMax = 0.6;
  p.startSizeMin = 0.05; p.startSizeMax = 0.1;
  p.gravityModifier = 6.0;
  p.setBurst(0, 0.0, 30.0);
  // gradiente: amarelo brilhante → laranja sumindo
  const g0 = new Float64Array([0.0, 1.0, 0.9, 0.4, 1.0]);
  const g1 = new Float64Array([1.0, 1.0, 0.4, 0.0, 0.0]);
  p.setChaveGradiente(0, g0); p.setChaveGradiente(1, g1);
  return [p];
}
/// Preset "Chuva": caixa larga e rasa acima, alfa, azulada, rápida e fina para baixo.
function presetChuva(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_CAIXA; p.caixaX = 5.0; p.caixaY = 0.1; p.caixaZ = 5.0; p.rateOverTime = 200.0; p.modo = 0;   // alfa
  p.startColorR = 0.7; p.startColorG = 0.8; p.startColorB = 1.0;
  p.startSpeedMin = 4.0; p.startSpeedMax = 5.0;
  p.startLifetimeMin = 1.0; p.startLifetimeMax = 1.5;
  p.startSizeMin = 0.02; p.startSizeMax = 0.03;
  p.gravityModifier = 9.8;
  const g0 = new Float64Array([0.0, 0.7, 0.8, 1.0, 0.6]);
  const g1 = new Float64Array([1.0, 0.7, 0.8, 1.0, 0.3]);
  p.setChaveGradiente(0, g0); p.setChaveGradiente(1, g1);
  return [p];
}

export const OBJECT_PRESETS: ObjectPreset[] = [
  { label: "Cubo", name: "Cube", meshKind: 1, r: 150, g: 180, b: 220 },
  { label: "Esfera", name: "Sphere", meshKind: 4, r: 220, g: 170, b: 150 },
  { label: "Pirâmide", name: "Pyramid", meshKind: 2, r: 170, g: 210, b: 170 },
  { label: "Octaedro", name: "Octa", meshKind: 3, r: 200, g: 180, b: 230 },
  { label: "Objeto vazio", name: "Empty", meshKind: 0, r: 0, g: 0, b: 0 },
  { label: "Fogo", name: "Fogo", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetFogo },
  { label: "Fumaça", name: "Fumaça", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetFumaca },
  { label: "Faíscas", name: "Faíscas", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetFaiscas },
  { label: "Chuva", name: "Chuva", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetChuva },
];

/// Nome do preset "Criar/Áudio/Fonte" (`assets/pacotes/audio/audio_editor.ts`
/// e o drop de um tile de áudio na viewport/hierarquia — `src/editor/dnd.ts`,
/// item 2/4 do brief de arquivos universais). Aqui e não em `dnd.ts` pra
/// evitar `dnd.ts` importar um pacote `@editorOnly` (risco de ciclo).
export const AUDIO_PRESET_NOME_FONTE: string = "Fonte de áudio";

export const OBJECT_PRESET_LABELS: string[] = [];
let presetIndex = 0;
while (presetIndex < OBJECT_PRESETS.length) {
  OBJECT_PRESET_LABELS.push(OBJECT_PRESETS[presetIndex].label);
  presetIndex = presetIndex + 1;
}
