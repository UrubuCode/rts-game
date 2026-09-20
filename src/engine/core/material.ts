// Engine RTS — Material: o component que define a APARÊNCIA do objeto (estilo o
// Material/MeshRenderer do Unity). É um Behavior de DADOS (sem update): o render
// lê dele (via dispatch virtual kind/matTexId/matEmissive/matTexMode) quando
// o objeto o tem, com fallback pros campos do GameObject (cenas antigas).
//
// A textura de IMAGEM (textureId + path) é atribuída de fora — pelo asset browser
// (clique numa imagem) ou pelo comando ws `loadtex` — via setMatTexture(), porque
// um path é string e a config numérica do inspector (fieldGet/Set: f64) não a
// comporta. Os campos NUMÉRICOS (emissivo, xadrez procedural) aparecem no inspector.

import { Behavior, KIND_MATERIAL } from "./behavior";

export class Material extends Behavior {
  textureId: number;    // id de textura de imagem real (>=2, via loadTexture) ou 0
  texturePath: string;  // path da imagem (exibição + serialização da cena)
  emissive: number;     // 1 = brilha (não sombreado) — ex.: o Sol
  texChecker: number;   // xadrez procedural quando NÃO há imagem: 0/1

  constructor() {
    super();
    this.textureId = 0;
    this.texturePath = "";
    this.emissive = 0;
    this.texChecker = 0;
  }

  typeName(): string { return "Material"; }

  // ── config numérica no inspector (a textura é setada via asset/ws, não aqui) ──
  fieldCount(): number { return 2; }
  fieldLabel(i: number): string {
    if (i === 0) return "Emis";
    if (i === 1) return "Xadrez";
    return "";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.emissive;
    if (i === 1) return this.texChecker;
    return 0.0;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) this.emissive = (v >= 0.5) ? 1 : 0;
    if (i === 1) this.texChecker = (v >= 0.5) ? 1 : 0;
  }

  // ── aparência lida pelo render (dispatch virtual, sem cast) ──
  kind(): number { return KIND_MATERIAL; }
  matTexId(): number { return this.textureId; }
  matEmissive(): number { return this.emissive; }
  matTexMode(): number { return this.texChecker; }
  matTexPath(): string { return this.texturePath; }

  /// Aplica a textura de imagem (id da GPU + path). Chamado pelo asset browser/ws.
  setMatTexture(id: number, path: string): void {
    this.textureId = id;
    this.texturePath = path;
  }

  toData(): any {
    return { type: "material", texturePath: this.texturePath, emissive: this.emissive, texChecker: this.texChecker };
  }
}
