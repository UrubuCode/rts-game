import { ResourceLease } from "./resources";
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

/**
 * @componentCategory Renderização
 * @componentDescription Configura a superfície do objeto.
 * @componentKeywords cor textura aparência
 */
export class Material extends Behavior {
  textureId: number;    // id de textura de imagem real (>=2, via loadTexture) ou 0
  texturePath: string;  // path da imagem (exibição + serialização da cena)
  emissive: number;     // 1 = brilha (não sombreado) — ex.: o Sol
  texChecker: number;   // xadrez procedural quando NÃO há imagem: 0/1
  /// Tiling: repetições da textura por unidade de MUNDO (0 = UV da malha, a
  /// imagem cobre cada face). Com tiling uma parede de 40 u repete a textura em
  /// vez de esticá-la.
  tile: number;
  /// Textura procedural (`proc_textures.ts`: concreto, tijolo, asfalto, metal,
  /// madeira, piso) quando não há imagem. "" = nenhuma.
  procedural: string;
  pbr: number = 0;
  metallic: number = 0;
  roughness: number = 0.7;
  normalScale: number = 1;
  occlusionStrength: number = 1;
  emissiveR: number = 0;
  emissiveG: number = 0;
  emissiveB: number = 0;
  normalPath: string = "";
  metallicRoughnessPath: string = "";
  occlusionPath: string = "";
  emissivePath: string = "";
  // Runtime GPU caches: never serialized.
  /** @nonSerialized */
  gpuLease: ResourceLease<any> | null = null;
  gpuMaterial: number = 0;
  gpuWindow: number = 0;
  gpuState: Float64Array = new Float64Array(11);
  gpuLast: Float64Array = new Float64Array(11);
  gpuNormalPath: string = "";
  gpuMrPath: string = "";
  gpuAoPath: string = "";
  gpuEmissivePath: string = "";

  constructor() {
    super();
    this.textureId = 0;
    this.texturePath = "";
    this.emissive = 0;
    this.texChecker = 0;
    this.tile = 0.0;
    this.procedural = "";
  }

  typeName(): string { return "Material"; }
  releaseResources():void {
    if(this.gpuLease!==null){this.gpuLease.release();this.gpuLease=null;}
    this.gpuMaterial=0;this.gpuWindow=0;
  }

  // ── config numérica no inspector (a textura é setada via asset/ws, não aqui) ──
  fieldCount(): number { return 16; }
  fieldType(i: number): string {
    if (i === 4) return "boolean";
    if (i >= 12) return "string";
    if (i >= 5) return "number";
    if (i === 2) return "number";
    if (i === 3) return "string";
    return "boolean";
  }
  fieldLabel(i: number): string {
    if (i === 4) return "PBR";
    if (i === 5) return "Metalicidade";
    if (i === 6) return "Rugosidade";
    if (i === 7) return "Normal: intensidade";
    if (i === 8) return "Oclusão: intensidade";
    if (i === 9) return "Emissão R (linear)";
    if (i === 10) return "Emissão G (linear)";
    if (i === 11) return "Emissão B (linear)";
    if (i === 12) return "Normal map (PNG)";
    if (i === 13) return "Metal/Rough (PNG)";
    if (i === 14) return "Oclusão (PNG)";
    if (i === 15) return "Emissão (PNG)";
    if (i === 0) return "Emis";
    if (i === 1) return "Xadrez";
    if (i === 2) return "Tiling";
    if (i === 3) return "Procedural";
    return "";
  }
  fieldGet(i: number): f64 {
    if (i === 4) return this.pbr;
    if (i === 5) return this.metallic;
    if (i === 6) return this.roughness;
    if (i === 7) return this.normalScale;
    if (i === 8) return this.occlusionStrength;
    if (i === 9) return this.emissiveR;
    if (i === 10) return this.emissiveG;
    if (i === 11) return this.emissiveB;
    if (i === 0) return this.emissive;
    if (i === 1) return this.texChecker;
    if (i === 2) return this.tile;
    return 0.0;
  }
  fieldSet(i: number, v: f64): void {
    if (!Number.isFinite(v)) return;
    if (i === 4) this.pbr = v >= 0.5 ? 1 : 0;
    if (i === 5) this.metallic = Math.max(0, Math.min(1, v));
    if (i === 6) this.roughness = Math.max(0.045, Math.min(1, v));
    if (i === 7) this.normalScale = Math.max(0, Math.min(8, v));
    if (i === 8) this.occlusionStrength = Math.max(0, Math.min(1, v));
    if (i === 9) this.emissiveR = Math.max(0, Math.min(65504, v));
    if (i === 10) this.emissiveG = Math.max(0, Math.min(65504, v));
    if (i === 11) this.emissiveB = Math.max(0, Math.min(65504, v));
    if (i === 0) this.emissive = (v >= 0.5) ? 1 : 0;
    if (i === 1) this.texChecker = (v >= 0.5) ? 1 : 0;
    if (i === 2) this.tile = v < 0.0 ? 0.0 : v;
  }
  fieldStringGet(i: number): string {
    if (i === 12) return this.normalPath;
    if (i === 13) return this.metallicRoughnessPath;
    if (i === 14) return this.occlusionPath;
    if (i === 15) return this.emissivePath;
    return i === 3 ? this.procedural : "";
  }
  fieldStringSet(i: number, v: string): void {
    if (i === 12) this.normalPath = v;
    if (i === 13) this.metallicRoughnessPath = v;
    if (i === 14) this.occlusionPath = v;
    if (i === 15) this.emissivePath = v;
    // trocar a textura procedural descarta o id resolvido: a próxima
    // resolução gera a nova.
    if (i === 3 && v !== this.procedural) { this.procedural = v; this.textureId = 0; }
  }

  // ── aparência lida pelo render (dispatch virtual, sem cast) ──
  kind(): number { return KIND_MATERIAL; }
  matTexId(): number { return this.textureId; }
  matEmissive(): number { return this.emissive; }
  matTexMode(): number { return this.texChecker; }
  matTexPath(): string { return this.texturePath; }
  matTile(): number { return this.tile; }
  matPbr(): number { return this.pbr; }
  matProc(): string { return this.procedural; }

  /// Aplica a textura de imagem (id da GPU + path). Chamado pelo asset browser/ws.
  setMatTexture(id: number, path: string): void {
    this.textureId = id;
    this.texturePath = path;
  }

  toData(): any {
    return { type: "material", texturePath: this.texturePath, emissive: this.emissive, texChecker: this.texChecker,
             tile: this.tile, procedural: this.procedural,
      pbr: this.pbr,
      metallic: this.metallic,
      roughness: this.roughness,
      normalScale: this.normalScale,
      occlusionStrength: this.occlusionStrength,
      emissiveR: this.emissiveR,
      emissiveG: this.emissiveG,
      emissiveB: this.emissiveB,
      normalPath: this.normalPath,
      metallicRoughnessPath: this.metallicRoughnessPath,
      occlusionPath: this.occlusionPath,
      emissivePath: this.emissivePath };
  }
}

/// Restore material data without persisting any GPU resource handles.
export function materialFromData(d: any): Material {
  const m = new Material();
  if (typeof d.texturePath === "string") m.texturePath = d.texturePath;
  if (typeof d.procedural === "string") m.procedural = d.procedural;
  if (typeof d.emissive === "number") m.fieldSet(0, d.emissive);
  if (typeof d.texChecker === "number") m.fieldSet(1, d.texChecker);
  if (typeof d.tile === "number") m.fieldSet(2, d.tile);
  if (typeof d.pbr === "number") m.fieldSet(4, d.pbr);
  if (typeof d.metallic === "number") m.fieldSet(5, d.metallic);
  if (typeof d.roughness === "number") m.fieldSet(6, d.roughness);
  if (typeof d.normalScale === "number") m.fieldSet(7, d.normalScale);
  if (typeof d.occlusionStrength === "number") m.fieldSet(8, d.occlusionStrength);
  if (typeof d.emissiveR === "number") m.fieldSet(9, d.emissiveR);
  if (typeof d.emissiveG === "number") m.fieldSet(10, d.emissiveG);
  if (typeof d.emissiveB === "number") m.fieldSet(11, d.emissiveB);
  if (typeof d.normalPath === "string") m.normalPath = d.normalPath;
  if (typeof d.metallicRoughnessPath === "string") m.metallicRoughnessPath = d.metallicRoughnessPath;
  if (typeof d.occlusionPath === "string") m.occlusionPath = d.occlusionPath;
  if (typeof d.emissivePath === "string") m.emissivePath = d.emissivePath;
  return m;
}
