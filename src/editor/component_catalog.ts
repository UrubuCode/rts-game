// Metadados do navegador de componentes, sem dependencias de render ou runtime.
// O nome e a chave usada pela fabrica e pela serializacao: nao traduza essa chave.
export const COMPONENT_CATALOG = [
  { name: "Camera", category: "Renderização", description: "Define a câmera usada pelo jogo.", keywords: "camera visão perspectiva" },
  { name: "MeshRenderer", category: "Renderização", description: "Desenha a malha do objeto.", keywords: "malha modelo mesh" },
  { name: "Material", category: "Renderização", description: "Configura a superfície do objeto.", keywords: "cor textura aparência" },
  { name: "Rigidbody", category: "Física", description: "Aplica gravidade e movimento físico.", keywords: "fisica corpo gravidade" },
  { name: "PhysicsMaterial", category: "Física", description: "Ajusta atrito e restituição.", keywords: "fisica colisão atrito" },
  { name: "AudioSource", category: "Áudio", description: "Emite som a partir do objeto.", keywords: "audio som beep" },
  { name: "Animator", category: "Animação", description: "Anima propriedades com keyframes.", keywords: "animacao keyframe" },
  { name: "Spinner", category: "Scripts", description: "Gira o objeto continuamente.", keywords: "girar rotação" },
  { name: "Bobber", category: "Scripts", description: "Move o objeto para cima e baixo.", keywords: "flutuar oscilar" },
  { name: "Mover", category: "Scripts", description: "Move o objeto em uma direção.", keywords: "mover translação" },
  { name: "Pulse", category: "Scripts", description: "Varia a escala periodicamente.", keywords: "pulsar escala" },
  { name: "Orbit", category: "Scripts", description: "Move o objeto em uma órbita.", keywords: "orbita círculo" },
  { name: "Patrol", category: "Scripts", description: "Move o objeto em ida e volta.", keywords: "patrulha movimento" },
];

export const COMPONENT_NAMES: string[] = [];
export const COMPONENT_CATEGORIES: string[] = [];
let catalogIndex = 0;
while (catalogIndex < COMPONENT_CATALOG.length) {
  const entry = COMPONENT_CATALOG[catalogIndex];
  COMPONENT_NAMES.push(entry.name);
  if (COMPONENT_CATEGORIES.indexOf(entry.category) < 0) COMPONENT_CATEGORIES.push(entry.category);
  catalogIndex = catalogIndex + 1;
}

export function componentMatches(index: number, category: string, query: string): boolean {
  const entry = COMPONENT_CATALOG[index];
  // Uma busca sempre encontra o catalogo inteiro, mesmo dentro de uma categoria.
  if (query.trim().length === 0) return category === entry.category;
  const haystack = (entry.name + " " + entry.category + " " + entry.keywords).toLowerCase();
  return haystack.indexOf(query.trim().toLowerCase()) >= 0;
}

export class ComponentBrowser {
  category: string = "";
  query: string = "";
  rows: number[] = [];
  selected: number = 0;
  scroll: number = 0;

  isRoot(): boolean { return this.category.length === 0 && this.query.trim().length === 0; }

  reset(): void {
    this.category = "";
    this.query = "";
    this.refresh();
  }

  refresh(): void {
    this.rows = [];
    this.selected = 0;
    this.scroll = 0;
    const root = this.isRoot();
    const count = root ? COMPONENT_CATEGORIES.length : COMPONENT_CATALOG.length;
    let rowIndex = 0;
    while (rowIndex < count) {
      if (root || componentMatches(rowIndex, this.category, this.query)) this.rows.push(rowIndex);
      rowIndex = rowIndex + 1;
    }
  }

  move(delta: number, visible: number): void {
    this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + delta));
    if (this.selected < this.scroll) this.scroll = this.selected;
    if (this.selected >= this.scroll + visible) this.scroll = this.selected - visible + 1;
  }

  activate(): string {
    if (this.rows.length === 0) return "";
    const index = this.rows[this.selected];
    if (this.isRoot()) {
      this.category = COMPONENT_CATEGORIES[index];
      this.refresh();
      return "";
    }
    return COMPONENT_CATALOG[index].name;
  }
}
