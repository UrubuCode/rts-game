import { Material, materialFromData } from "@engine/core/material";

function expect(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}
const old = materialFromData({type: "material", emissive: 0, texturePath: ""});
expect(old.matPbr() === 0, "old scenes must retain legacy shading");
const m = new Material();
m.pbr = 1; m.roughness = 0.23; m.metallic = 0.85; m.normalScale = 0.7;
m.normalPath = "assets/n.png"; m.metallicRoughnessPath = "assets/mr.png";
m.occlusionPath = "assets/ao.png"; m.occlusionStrength = 0.6;
m.emissivePath = "assets/e.png"; m.emissiveR = 3; m.emissiveG = 0.5; m.emissiveB = 0.1;
const copy = materialFromData(m.toData());
expect(JSON.stringify(copy.toData()) === JSON.stringify(m.toData()), "PBR roundtrip lost material data");
expect(copy.matPbr() === 1, "restored PBR material is inactive");
expect(m.fieldCount() > 4, "PBR controls missing in inspector");
expect(m.toData().gpuMaterial === undefined, "GPU handles must not be serialized");
println("PASS pbr-material: legacy defaults, maps, HDR emission, roundtrip, inspector");
