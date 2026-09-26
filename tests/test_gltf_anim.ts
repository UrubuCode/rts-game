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

// arquivo inexistente/inválido -> lança com o path e o motivo.
let threw = false;
let msg = "";
try { loadSkeletonAsset(0, "assets/models/kenney/nao-existe.glb"); }
catch (e) { threw = true; msg = e.message; }
check(threw, "arquivo inexistente deveria lancar");
check(msg.indexOf("nao-existe.glb") >= 0, "mensagem de erro cita o path: " + msg);
io.print("[PASSOU] gltf_anim: arquivo invalido lanca com o motivo");

io.print("[PASSOU] gltf_anim (todos os casos)");
