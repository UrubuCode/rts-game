// Roda com o tsconfig do build do jogo (o mais próximo da ENTRADA): o alias
// "@engine/generated/components" tem de cair no registro sem @editorOnly.
//   npm run check:game-build   (ou: rts.exe run tools/game-build/check-registro.ts)
import io from "@compat/io.ts";
import { REGISTRO } from "@engine/generated/components";
import { createComponent } from "@editor/components";
import { gizmoDrawerIndex } from "@engine/core/gizmos";
import { commandIndex } from "@editor/api";
if (REGISTRO !== "jogo") throw new Error("o build do jogo deveria usar components_game, veio " + REGISTRO);
if (createComponent("Light").kind() !== 7) throw new Error("componente comum sumiu do jogo");
// controles de câmera (assets/pacotes/camera) são scripts de jogo; gizmos, menus e comandos do pacote não
const controles: string[] = ["CameraPrimeiraPessoa", "CameraOrbita", "CameraSeguir", "CameraRTS", "CicloDoDia"];
let i = 0;
while (i < controles.length) {
  if (createComponent(controles[i]).typeName() !== controles[i]) throw new Error("controle de câmera ausente do jogo: " + controles[i]);
  i = i + 1;
}
if (gizmoDrawerIndex("Light") >= 0 || gizmoDrawerIndex("Camera") >= 0) throw new Error("desenhador de gizmo @editorOnly entrou no jogo");
if (commandIndex("luz") >= 0 || commandIndex("camera") >= 0 || commandIndex("ambiente") >= 0 || commandIndex("ambienteinfo") >= 0) throw new Error("comando WS @editorOnly entrou no jogo");
io.print("[PASSOU] build do jogo usa o registro sem @editorOnly (com os 4 controles de câmera e o CicloDoDia, sem gizmos/comandos dos pacotes)");
