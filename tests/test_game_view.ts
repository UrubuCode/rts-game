// Teste SEM JANELA da aba Jogo: faixas (letterbox) por proporção, comando
// gameview e a escolha de câmera.
//   rts.exe run tests/test_game_view.ts
import io from "@compat/io.ts";
import { areaComFaixas } from "@editor/game_view";
import { cmdGameView } from "@editor/control/commands/gameview";
import { WorkspaceViews } from "@editor/workspace_views";
import { scene, S } from "@editor/control/session";
import { Camera } from "@engine/core/camera";
import { definirEntradaAtiva, entradaAtiva, teclaSegurada, mouseDX, TECLA_W } from "@engine/core/entrada";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: number, b: number): boolean { return Math.abs(a - b) < 1e-9; }
const area = new Float64Array(4); const out = new Float64Array(4);
area[0] = 250.0; area[1] = 97.0; area[2] = 660.0; area[3] = 400.0;
areaComFaixas(area, 16.0 / 9.0, out);
check(perto(out[0], 250.0) && perto(out[1], 111.375) && perto(out[2], 660.0) && perto(out[3], 371.25), "16:9 numa área larga de menos: faixas em cima e embaixo");
area[0] = 0.0; area[1] = 0.0; area[2] = 1000.0; area[3] = 500.0;
areaComFaixas(area, 4.0 / 3.0, out);
check(perto(out[0], 166.66666666666666) && perto(out[2], 666.6666666666666) && perto(out[3], 500.0), "4:3 numa área larga: faixas dos lados");
areaComFaixas(area, 0.0, out);
check(perto(out[2], 1000.0) && perto(out[3], 500.0), "Livre = a área toda");

scene.clear();
const a = scene.createGameObject("A"); a.addBehavior(new Camera());
const b = scene.createGameObject("B"); const cb = new Camera(); cb.isMain = 0; cb.profundidade = 1.0; b.addBehavior(cb);
check(cmdGameView(["gameview", "jogo"]).indexOf("[ok]") === 0 && S.gameView === 1, "gameview jogo");
check(cmdGameView(["gameview", "proporcao", "16:9"]).indexOf("[ok]") === 0 && S.gameAspect === 1, "proporção");
check(cmdGameView(["gameview", "proporcao", "21:9"]).indexOf("[erro]") === 0, "proporção inválida");
check(cmdGameView(["gameview", "camera", "1"]).indexOf("[ok]") === 0 && S.gameCamera === 1, "câmera escolhida");
check(cmdGameView(["gameview", "camera", "5"]).indexOf("[erro]") === 0, "objeto sem câmera");
check(cmdGameView(["gameview", "previa", "on"]).indexOf("[ok]") === 0 && S.cameraPreview === 1, "prévia");
check(cmdGameView(["gameview"]).indexOf("aba=jogo proporcao=16:9 camera=#1 previa=on") > 0, "consulta: " + cmdGameView(["gameview"]));
const views = new WorkspaceViews({ _win: 0 });
check(views.cameraEscolhida() === cb, "cameraEscolhida resolve o índice");
views.proximaCamera();
check(S.gameCamera === 0 - 1 && views.cameraEscolhida() === null, "depois da última: Todas");
views.proximaCamera();
check(S.gameCamera === 0, "Todas → a primeira por profundidade");
cmdGameView(["gameview", "camera", "todas"]); cmdGameView(["gameview", "cena"]); cmdGameView(["gameview", "previa", "off"]);
check(S.gameCamera === 0 - 1 && S.gameView === 0 && S.cameraPreview === 0, "volta ao padrão");
// entrada dos scripts: o editor a desliga fora da aba Jogo; desligada, tudo 0
check(entradaAtiva(), "entrada ligada por padrão (jogo exportado)");
definirEntradaAtiva(false);
check(!entradaAtiva() && !teclaSegurada(TECLA_W) && mouseDX() === 0.0, "entrada desligada responde 0");
definirEntradaAtiva(true);
io.print("[PASSOU] game view: faixas, gameview, escolha de câmera");
