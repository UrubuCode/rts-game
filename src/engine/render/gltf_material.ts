// glTF metallic/roughness material decoding, independent of GPU/window state.
import { Material } from "../core/material";
import { Buffer } from "node:buffer";

export function gltfMaterial(g: any, index: number, baseDir: string, binary?: Uint8Array): Material {
  const out = new Material(); out.pbr = 1; out.metallic = 1; out.roughness = 1;
  if (g.materials === undefined || index < 0 || index >= g.materials.length) return out;
  const m = g.materials[index]; const p = m.pbrMetallicRoughness;
  if (m.extensions !== undefined && m.extensions.KHR_materials_unlit !== undefined) {
    out.pbr = 0; out.emissive = 1;
  }
  if (p !== undefined) {
    if (typeof p.metallicFactor === "number") out.fieldSet(5, p.metallicFactor);
    if (typeof p.roughnessFactor === "number") out.fieldSet(6, p.roughnessFactor);
    out.texturePath = gltfTexturePath(g, p.baseColorTexture, baseDir, binary);
    out.metallicRoughnessPath = gltfTexturePath(g, p.metallicRoughnessTexture, baseDir, binary);
  }
  out.normalPath = gltfTexturePath(g, m.normalTexture, baseDir, binary);
  out.occlusionPath = gltfTexturePath(g, m.occlusionTexture, baseDir, binary);
  out.emissivePath = gltfTexturePath(g, m.emissiveTexture, baseDir, binary);
  if (m.normalTexture !== undefined && typeof m.normalTexture.scale === "number") out.fieldSet(7, m.normalTexture.scale);
  if (m.occlusionTexture !== undefined && typeof m.occlusionTexture.strength === "number") out.fieldSet(8, m.occlusionTexture.strength);
  let strength = 1;
  if (m.extensions !== undefined && m.extensions.KHR_materials_emissive_strength !== undefined) {
    const value = m.extensions.KHR_materials_emissive_strength.emissiveStrength;
    if (typeof value === "number" && Number.isFinite(value)) strength = Math.max(0, value);
  }
  if (Array.isArray(m.emissiveFactor) && m.emissiveFactor.length >= 3) {
    out.fieldSet(9, m.emissiveFactor[0] * strength);
    out.fieldSet(10, m.emissiveFactor[1] * strength);
    out.fieldSet(11, m.emissiveFactor[2] * strength);
  }
  return out;
}

function gltfTexturePath(g: any, info: any, baseDir: string, binary?: Uint8Array): string {
  if (info === undefined) return "";
  if (info.texCoord !== undefined && info.texCoord !== 0) throw new Error("PBR: apenas TEXCOORD_0 é suportado.");
  if (info.extensions !== undefined && info.extensions.KHR_texture_transform !== undefined) {
    const tr = info.extensions.KHR_texture_transform;
    if ((tr.texCoord !== undefined && tr.texCoord !== 0) || (tr.rotation !== undefined && tr.rotation !== 0) ||
        (tr.offset !== undefined && (tr.offset[0] !== 0 || tr.offset[1] !== 0)) ||
        (tr.scale !== undefined && (tr.scale[0] !== 1 || tr.scale[1] !== 1))) {
      throw new Error("PBR: KHR_texture_transform não identidade ainda não é suportado.");
    }
  }
  const texture = g.textures !== undefined ? g.textures[info.index] : undefined;
  const image = texture !== undefined && g.images !== undefined ? g.images[texture.source] : undefined;
  if (image === undefined) throw new Error("PBR: índice de imagem glTF inválido.");
  if (typeof image.uri === "string") {
    if (image.uri.indexOf("data:") === 0) {
      if (image.uri.indexOf("data:image/png;base64,") !== 0) throw new Error("PBR: imagem embutida precisa ser PNG.");
      return image.uri;
    }
    const uri = decodeURIComponent(image.uri);
    if (!uri.toLowerCase().endsWith(".png")) throw new Error("PBR: converta as texturas para PNG.");
    return baseDir.length > 0 ? baseDir + "/" + uri : uri;
  }
  if (image.mimeType !== "image/png" || binary === undefined || g.bufferViews === undefined) throw new Error("PBR: imagem GLB ausente ou não PNG.");
  const view = g.bufferViews[image.bufferView];
  if (view === undefined || (view.buffer !== undefined && view.buffer !== 0)) throw new Error("PBR: buffer de imagem inválido.");
  const start = view.byteOffset !== undefined ? view.byteOffset : 0;
  const end = start + view.byteLength;
  if (start < 0 || end > binary.length || end <= start) throw new Error("PBR: imagem GLB truncada.");
  return "data:image/png;base64," + Buffer.from(binary.subarray(start, end)).toString("base64");
}
