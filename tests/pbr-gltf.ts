import { gltfMaterial } from "@engine/render/gltf_material";
function pbrExpect(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
const source = { materials: [{pbrMetallicRoughness: {metallicFactor: 0.4, roughnessFactor: 0.2, metallicRoughnessTexture: {index: 0}}, normalTexture: {index: 1, scale: 0.5}, occlusionTexture: {index: 0, strength: 0.7}, emissiveFactor: [1,0.5,0], extensions: {KHR_materials_emissive_strength: {emissiveStrength: 4}}}], textures: [{source: 0},{source: 1}], images: [{uri: "mr.png"},{uri: "normal%20map.png"}] };
const pbrM = gltfMaterial(source,0,"assets/test");
pbrExpect(pbrM.pbr === 1 && pbrM.metallic === 0.4 && pbrM.roughness === 0.2,"factors");
pbrExpect(pbrM.normalPath === "assets/test/normal map.png" && pbrM.normalScale === 0.5,"normal map");
pbrExpect(pbrM.metallicRoughnessPath === pbrM.occlusionPath && pbrM.occlusionStrength === 0.7,"MR/AO");
pbrExpect(pbrM.emissiveR === 4 && pbrM.emissiveG === 2,"HDR emissive strength");
const def = gltfMaterial({},-1,"");
pbrExpect(def.metallic === 1 && def.roughness === 1,"glTF defaults");
const embedded = gltfMaterial({materials:[{normalTexture:{index:0}}],textures:[{source:0}],images:[{mimeType:"image/png",bufferView:0}],bufferViews:[{byteOffset:1,byteLength:3}]},0,"",new Uint8Array([0,1,2,3,0]));
pbrExpect(embedded.normalPath === "data:image/png;base64,AQID","embedded GLB image");
println("PASS pbr-gltf: maps, factors, embedded GLB, defaults, HDR emission");
const unlit = gltfMaterial({materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0,extensions:{KHR_texture_transform:{texCoord:0}}}},extensions:{KHR_materials_unlit:{}}}],textures:[{source:0}],images:[{uri:"palette.png"}]},0,"assets");
pbrExpect(unlit.pbr === 0 && unlit.emissive === 1 && unlit.texturePath === "assets/palette.png","unlit and identity texture transform compatibility");
println("PASS unlit + identity KHR_texture_transform");
