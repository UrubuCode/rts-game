// Opcoes de criacao do editor: um registro serve aos dois menus e a fabrica.
// Luzes e câmera vêm dos pacotes (itens @menuItem Criar/Luz/* e Criar/Câmera).
export const OBJECT_PRESETS = [
  { label: "Cubo", name: "Cube", meshKind: 1, r: 150, g: 180, b: 220 },
  { label: "Esfera", name: "Sphere", meshKind: 4, r: 220, g: 170, b: 150 },
  { label: "Pirâmide", name: "Pyramid", meshKind: 2, r: 170, g: 210, b: 170 },
  { label: "Octaedro", name: "Octa", meshKind: 3, r: 200, g: 180, b: 230 },
  { label: "Objeto vazio", name: "Empty", meshKind: 0, r: 0, g: 0, b: 0 },
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
