// Teste SEM JANELA do ENDEREÇAMENTO de objetos pela porta de controle: todo
// argumento <obj> aceita índice (`3` ou `#3`), nome exato (entre aspas se tiver
// espaço) ou caminho `Pai/Filho`; nome ambíguo responde [erro] listando os
// candidatos. `find` lista por trecho do nome. Os comandos de pacote (camera,
// luz) usam o mesmo resolvedor por `Editor.object`.
//
//   rts.exe run tests/test_ws_enderecamento.ts
import "@engine/generated/editor_extensions";
import { Editor } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene, S } from "@editor/control/session";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function ok(cmd: string): string { const out = execCommand(800, 600, cmd); check(out.indexOf("[ok]") === 0, cmd + ": " + out); return out; }
function erro(cmd: string): string { const out = execCommand(800, 600, cmd); check(out.indexOf("[erro]") === 0, cmd + " deveria ser [erro]: " + out); return out; }
function idx(nome: string): number { let i = 0; while (i < scene.objects.length) { if (scene.objects[i].name === nome) return i; i = i + 1; } return 0 - 1; }
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];
ok("spawn Pai 0 0 0"); ok("spawn Cubo 1 0 0"); ok("parent 1 0");          // #0 Pai, #1 Pai/Cubo
ok("spawn Outro 0 0 5"); ok("spawn Cubo 1 0 0"); ok("parent 3 2");        // #2 Outro, #3 Outro/Cubo
ok("spawn Caixa 0 0 0"); ok("rename 4 Caixa Vermelha");                   // #4 "Caixa Vermelha"
ok("spawn 7 0 0 0");                                                       // #5 nome numérico

ok("move Pai 1 2 3");
check(scene.objects[0].transform.px === 1.0 && scene.objects[0].transform.pz === 3.0, "nome exato");
const amb = erro("move Cubo 0 0 0");
check(amb.indexOf("ambiguo") > 0 && amb.indexOf("#1 Pai/Cubo") > 0 && amb.indexOf("#3 Outro/Cubo") > 0, "ambiguo lista os candidatos: " + amb);
ok("move Pai/Cubo 5 0 0");
check(scene.objects[1].transform.px === 5.0 && scene.objects[3].transform.px === 1.0, "caminho Pai/Filho");
ok("move #2 7 0 0");
check(scene.objects[2].transform.px === 7.0, "#indice");
ok("move \"Caixa Vermelha\" 1 1 1");
check(scene.objects[4].transform.px === 1.0, "nome com espaco entre aspas");
ok("move 5 2 2 2");
check(scene.objects[5].transform.px === 2.0, "numero e indice, nao nome");
ok("move \"7\" 3 3 3");
check(scene.objects[5].transform.px === 3.0, "entre aspas e sempre nome");
const nada = erro("select Nada");
check(nada.indexOf("Nada") > 0 && nada.indexOf("find") > 0, "nao encontrado sugere find: " + nada);
erro("comps \"Caixa");
erro("move Pai/Nada 0 0 0");

// comandos com <obj> em posições diversas
check(execCommand(800, 600, "describe Outro/Cubo json").indexOf("\"path\":\"Outro/Cubo\"") > 0, "describe por caminho");
check(execCommand(800, 600, "comps \"Caixa Vermelha\"").indexOf("[comps] #4 Caixa Vermelha") === 0, "comps por nome com espaco");
ok("dup Pai");
ok("rot Outro 90 0");
ok("rename Outro Segundo");
check(scene.objects[2].name === "Segundo", "rename por nome");
ok("rename #5 \"Nome Citado\"");
check(scene.objects[5].name === "Nome Citado", "rename tira as aspas de fora");
ok("rename #5 7");
check(execCommand(800, 600, "scene json Segundo").indexOf("\"name\":\"Segundo\"") > 0, "scene json por nome (posicao 2)");
ok("dupn 2 1 #5");
ok("parent \"Caixa Vermelha\" Segundo");
const cx = idx("Caixa Vermelha");
check(cx >= 0 && scene.objects[cx].parent === idx("Segundo"), "parent por nomes (os indices mudaram)");
ok("parent Segundo/\"Caixa Vermelha\" -1");

// find
const f = execCommand(800, 600, "find cubo");
check(f.indexOf("[find] 2") === 0 && f.indexOf("Pai/Cubo") > 0 && f.indexOf("Segundo/Cubo") > 0, "find por trecho, sem maiusculas: " + f);
check(execCommand(800, 600, "find zzz").indexOf("[find] 0") === 0, "find sem resultado");
erro("find");

// pacotes: Editor.object + camera/luz por nome
ok("camera add");
const cam = scene.objects.length - 1;
ok("rename " + cam + " MinhaCamera");
check(execCommand(800, 600, "camera MinhaCamera set fov 70").indexOf("[ok]") === 0, "camera <obj> por nome");
check(execCommand(800, 600, "camera main MinhaCamera").indexOf("[ok]") === 0, "camera main por nome");
check(execCommand(800, 600, "gameview camera MinhaCamera").indexOf("[ok]") === 0 && S.gameCamera === scene.objects[cam], "gameview camera por nome");
ok("luz add pontual 0 1 0");
ok("rename " + (scene.objects.length - 1) + " Lampada");
check(execCommand(800, 600, "luz Lampada set intensidade 2").indexOf("[ok]") === 0, "luz <obj> por nome");
check(Editor.object("Pai/Cubo") === scene.objects[1] && Editor.object("Cubo") === null && Editor.object("#0") === scene.objects[0], "Editor.object");
println("[PASSOU] ws enderecamento: indice, #indice, nome, \"nome com espaco\", Pai/Filho, ambiguo, find, pacotes");
