import fs from "@compat/fs.ts";
import { SceneAssetLoadOperation } from "@engine/render/scene_asset_loading";
import { loadSkeletonAsset } from "@engine/render/gltf_anim";

// `SceneAssetLoadOperation` prepara os recursos da cena ANTES do primeiro
// desenho, e é isso que tira a pausa do quadro em que a cena aparece. Ela
// coletava o `meshPath` do MeshRenderer e as texturas dos materiais, mas não
// o `modelPath` dos esqueletos — então o GLB de um personagem continuava
// fazendo parse no primeiro quadro desenhado, que é justamente o quadro que
// não pode ter pausa.
//
// A cena deste teste tem SÓ um esqueleto: sem textura e sem modelo, ela não
// toca no carregador nativo de textura, e a falha aponta para uma coisa só.
function check(ok: boolean, label: string): void { if (!ok) throw new Error(label); }

const MODEL = "assets/kenney/personagens/character-a.glb";
if (!fs.exists(MODEL)) {
  println("SKIP scene-asset-skeleton: " + MODEL + " ausente");
} else {
  const FIXTURE = "build/scene-asset-skeleton.json";
  fs.write(FIXTURE, JSON.stringify({
    objects: [
      { name: "chao", mesh: 0, color: [200, 200, 200], pos: [0, 0, 0], rot: [0, 0], scale: 1, parent: -1 },
      {
        name: "ator", mesh: 0, color: [255, 255, 255], pos: [0, 0, 0], rot: [0, 0], scale: 1, parent: -1,
        scripts: [{ type: "skeleton", modelPath: MODEL }],
      },
    ],
  }));

  // `win` = 0: o percurso é o mesmo, sem tocar na GPU.
  const prep = new SceneAssetLoadOperation(0, FIXTURE);
  const deadline = Date.now() + 30000;
  let ticks = 0;
  while (!prep.done && Date.now() < deadline) { prep.tick(); ticks++; }
  check(prep.done, "a preparação não terminou no prazo");
  check(prep.error.length === 0, "a preparação falhou: " + prep.error);

  // Se o GLB foi preparado, a próxima carga vem do cache e não cede nenhum
  // checkpoint — o checkpoint só é chamado quando há trabalho pesado de fato.
  let reparsed = 0;
  loadSkeletonAsset(0, MODEL, (): void => { reparsed++; });
  check(reparsed === 0,
    "o esqueleto não foi preparado na carga: o GLB fez parse agora (" + reparsed +
    " checkpoints), e no jogo isso cairia no primeiro quadro desenhado");

  println("PASS scene-asset-skeleton: GLB de esqueleto preparado antes do desenho (" + ticks + " ticks)");
  prep.release();
}
