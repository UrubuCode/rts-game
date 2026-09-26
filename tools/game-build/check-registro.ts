// Roda com o tsconfig do build do jogo (o mais próximo da ENTRADA): o alias
// "@engine/generated/components" tem de cair no registro sem @editorOnly.
//   npm run check:game-build   (ou: rts.exe run tools/game-build/check-registro.ts)
import io from "@compat/io.ts";
import { REGISTRO } from "@engine/generated/components";
import { createComponent } from "@editor/components";
if (REGISTRO !== "jogo") throw new Error("o build do jogo deveria usar components_game, veio " + REGISTRO);
if (createComponent("Light").kind() !== 7) throw new Error("componente comum sumiu do jogo");
io.print("[PASSOU] build do jogo usa o registro sem @editorOnly");
