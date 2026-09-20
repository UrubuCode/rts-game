// Opcoes de criacao do editor: um registro serve aos dois menus e a fabrica.
export const OBJECT_PRESETS = [
  { label: "Cubo", name: "Cube", meshKind: 1, r: 150, g: 180, b: 220, camera: 0 },
  { label: "Esfera", name: "Sphere", meshKind: 4, r: 220, g: 170, b: 150, camera: 0 },
  { label: "Pirâmide", name: "Pyramid", meshKind: 2, r: 170, g: 210, b: 170, camera: 0 },
  { label: "Octaedro", name: "Octa", meshKind: 3, r: 200, g: 180, b: 230, camera: 0 },
  { label: "Objeto vazio", name: "Empty", meshKind: 0, r: 0, g: 0, b: 0, camera: 0 },
  { label: "Câmera", name: "Camera", meshKind: 0, r: 0, g: 0, b: 0, camera: 1 },
];

export const OBJECT_PRESET_LABELS: string[] = [];
let presetIndex = 0;
while (presetIndex < OBJECT_PRESETS.length) {
  OBJECT_PRESET_LABELS.push(OBJECT_PRESETS[presetIndex].label);
  presetIndex = presetIndex + 1;
}
