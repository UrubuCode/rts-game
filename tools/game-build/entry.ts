// Entrada do BUILD do jogo. O `tsconfig.json` desta pasta (o mais próximo da
// entrada, que é o que o RTS lê) troca o alias exato
// "@engine/generated/components" pelo registro sem as classes @editorOnly.
// O jogo em si é o game.ts da raiz.
import "../../game.ts";
