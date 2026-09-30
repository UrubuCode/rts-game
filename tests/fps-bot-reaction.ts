import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsBotInput } from "../src/shared/bots";
const fpsTestWorld = new FpsWorld(new Scene("reaction"), 42, 0.0);
fpsTestWorld.adicionarJogador(true); fpsTestWorld.adicionarJogador(false);
fpsTestWorld.jogadores[0].x = 0; fpsTestWorld.jogadores[0].z = 0;
fpsTestWorld.jogadores[1].x = 0; fpsTestWorld.jogadores[1].z = 10;
fpsTestWorld.sincronizarCorpos();
let fpsEarlyShot = false;
let fpsLateShot = false;
let fpsTestTick = 0;
while (fpsTestTick < 60) {
  const inp = fpsBotInput(fpsTestWorld.bots[0], 0, fpsTestWorld.jogadores,
    fpsTestWorld.mapa.spawnX, fpsTestWorld.mapa.spawnZ, fpsTestTick, fpsTestWorld.scene, fpsTestWorld.raio);
  if (fpsTestTick < 30 && inp.atirar) fpsEarlyShot = true;
  if (fpsTestTick > 45 && inp.atirar) fpsLateShot = true;
  fpsTestTick = fpsTestTick + 1;
}
if (fpsEarlyShot || !fpsLateShot) throw new Error("bot must react before firing, then engage");
console.log("[PASSOU] fps-bot-reaction");
