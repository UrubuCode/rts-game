// Teste HEADLESS do leitor de nós/clipes glTF (engine/render/gltf_anim.ts).
// win = 0 -> sem janela, sem GPU: só malha/textura ficam 0.
//
//   ./rts.exe run tests/test_gltf_anim.ts
import io from "@compat/io.ts";
import { loadSkeletonAsset } from "@engine/render/gltf_anim";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

const a = loadSkeletonAsset(0, "assets/models/kenney/character-a.glb");
check(a.boneNames.length === 8, "8 nos: " + a.boneNames.join(","));
const torso = a.boneNames.indexOf("torso");
check(a.boneParent[a.boneNames.indexOf("head")] === torso, "head e filho do torso");
check(a.boneParent[a.boneNames.indexOf("arm-right")] === torso, "arm-right e filho do torso");
check(a.boneParent[0] === -1, "primeiro osso e a raiz");
let i = 0; while (i < a.boneNames.length) { check(a.boneParent[i] < i, "pai antes do filho: " + a.boneNames[i]); i = i + 1; }
check(Math.abs(a.restT[torso * 3 + 1] - 0.7) < 1e-6, "torso em y=0.7 no repouso");
check(Math.abs(a.restS[a.boneNames.indexOf("head") * 3] - 0.1) < 1e-6, "head com escala 0.1");
check(a.clips.length === 27, "27 clipes");
const walk = a.clips[a.clipIndex("walk")];
check(Math.abs(walk.duration - 0.6666667) < 1e-4, "walk 0,667 s: " + walk.duration);
check(walk.chBone.length === 6, "walk tem 6 canais");
check(a.clipIndex("corrida") === -1, "clipe inexistente = -1");
check(a.partBone.length === 6, "6 pecas (pernas, torso, bracos, cabeca)");
// win = 0 não sobe nada pra GPU: partMesh/partTex ficam 0.
i = 0;
while (i < a.partMesh.length) {
  check(a.partMesh[i] === 0, "win=0 nao sobe malha (parte " + i + ")");
  check(a.partTex[i] === 0, "win=0 nao carrega textura (parte " + i + ")");
  i = i + 1;
}
io.print("[PASSOU] gltf_anim: hierarquia, repouso, 27 clipes, walk");

// cache por caminho: a 2a chamada devolve a MESMA instância.
const a2 = loadSkeletonAsset(0, "assets/models/kenney/character-a.glb");
check(a2 === a, "cache por caminho: mesma instancia");
io.print("[PASSOU] gltf_anim: cache por caminho");

// arquivo sem 'animations' e com 1 nó só (quad.glb, já usado por test_model):
// clips vazio e um osso por nó com malha.
const q = loadSkeletonAsset(0, "assets/models/_fixtures/quad.glb");
check(q.clips.length === 0, "sem animations -> clips vazio");
check(q.boneNames.length === 1, "quad.glb tem 1 no");
check(q.boneParent[0] === -1, "no unico e raiz");
check(q.partBone.length === 1, "quad.glb tem 1 peca (1 primitive)");
io.print("[PASSOU] gltf_anim: sem animacoes, 1 no com malha");

// partColor: 0xRRGGBB PURO (formato de drawGPUMesh/scenedraw.ts), sem byte de
// alfa — quad.glb tem baseColorFactor 0.9/0.2/0.15 -> 229/51/38 -> 0xE53326.
// Com o empacotamento ERRADO (0xAABBGGRR, formato do framebuffer em software
// de mesh.ts/raster.ts) este valor sairia bem diferente (byte de alfa
// deslocado pra posição errada e alfa 0xFF ligado no bit 31, virando um
// numero negativo em i32), então a checagem abaixo falharia com o bug antigo.
check(q.partColor[0] === 0xE53326, "quad.glb partColor = 0xRRGGBB (229,51,38): " + q.partColor[0].toString(16));
// character-a.glb não define baseColorFactor no material (só baseColorTexture),
// então cr/cg/cb ficam no default de Part (200,200,210) -> 0xC8C8D2.
i = 0;
while (i < a.partColor.length) {
  check(a.partColor[i] === 0xC8C8D2, "character-a partColor[" + i + "] = 0xRRGGBB (200,200,210): " + a.partColor[i].toString(16));
  i = i + 1;
}
io.print("[PASSOU] gltf_anim: partColor em 0xRRGGBB (sem alfa)");

// arquivo inexistente/inválido -> lança com o path e o motivo.
let threw = false;
let msg = "";
try { loadSkeletonAsset(0, "assets/models/kenney/nao-existe.glb"); }
catch (e) { threw = true; msg = e.message; }
check(threw, "arquivo inexistente deveria lancar");
check(msg.indexOf("nao-existe.glb") >= 0, "mensagem de erro cita o path: " + msg);
io.print("[PASSOU] gltf_anim: arquivo invalido lanca com o motivo");

io.print("[PASSOU] gltf_anim (todos os casos)");
