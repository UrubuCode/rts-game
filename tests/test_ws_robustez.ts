// Teste SEM JANELA da ROBUSTEZ da porta de controle: argumento faltando,
// inválido ou fora da faixa responde `[erro] <motivo>` (nunca lança nem age no
// objeto 0 por engano); um comando que lança (embutido ou de pacote) responde
// `[erro] <cmd>: <mensagem>`; em todos os casos a cena e as pilhas de
// Desfazer/Refazer ficam como estavam.
//
//   rts.exe run tests/test_ws_robustez.ts
import fs from "@compat/fs.ts";
import { registerCommand } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene, S } from "@editor/control/session";
import { sceneToJSON } from "@editor/sceneio";
import { selectBone } from "@editor/bone_gizmo";
import { skeletonOfObject } from "@editor/skeleton_preview";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
/// A cena serializada SEM os ids: voltar ao snapshot (como o Desfazer) recria
/// os objetos, e ids novos não são mudança de conteúdo.
function cena(): string {
  const d = JSON.parse(sceneToJSON());
  let k = 0;
  while (k < d.objects.length) { d.objects[k].id = 0; k = k + 1; }
  return JSON.stringify(d);
}
instalarEditorReal();
check(registerCommand("teste_lanca", "teste_lanca :: lança", false, (p: string[]) => { throw new Error("quebrou"); }), "registra o que lança");
check(registerCommand("teste_lanca_muta", "teste_lanca_muta :: muda a cena e lança", true, (p: string[]) => {
  scene.objects[0].name = "Estragado"; throw new Error("pifou no meio");
}), "registra o que muta e lança");

scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "spawn A 1 2 3").indexOf("[ok]") === 0, "spawn A");
check(execCommand(800, 600, "spawn B 4 5 6").indexOf("[ok]") === 0, "spawn B");
// um Refazer não vazio: prova que o erro não o zera
check(execCommand(800, 600, "move 0 1 1 1").indexOf("[ok]") === 0, "move ok");
check(execCommand(800, 600, "undo").indexOf("[ok]") === 0, "undo");
S.selected = 1;
const cenaAntes = cena();
const undoAntes = history.undoDepth();
const redoAntes = history.redoDepth();
check(redoAntes === 1, "setup: Refazer com 1");

fs.create_dir_all("build");
fs.write("build/claude-cena-invalida.json", "{ isto nao e json");
const ruins: string[] = [
  "move 999 0 0 0", "move 0 1 2", "move 0 a b c", "move", "move abc 1 2 3",
  "scl abc", "scl 0 1 x 1", "scl 99 1 1 1",
  "mesh 5 x", "mesh 0 x", "mesh 0 9", "mesh",
  "color", "color 0 1 2", "color 0 1 2 x", "color 7 1 2 3",
  "spin", "spin 0 abc", "spin 99 1", "spin 0 1 x",
  "select 99", "select", "selectadd 99", "focus", "focus 99",
  "cam 1 2", "cam 1 2 3 4 x", "light 1 2 3 x",
  "parent 0 99", "parent 99 0", "parent 0 x", "movetree 99 0 0", "movetree 0 x 0", "movetree",
  "delete 999", "delete", "rename 99 X", "rename 0",
  "setcustom 99 1", "setcustom 0 x",
  "comps", "comps 99", "addcomp", "addcomp 0 NaoExiste", "rmcomp 0 5", "rmcomp 0", "setfield 0 0 0 1", "setfield",
  "bones", "bones 99", "pose", "pose 0", "resetpose", "selbone", "anims", "anim", "anim 0", "animator", "animator 9",
  "addskel", "addskel 99 x.glb",
  "dup 99", "dupn x y", "dupn 2 x", "dupn 2 1 99", "vis 99", "iso 99", "ungroup 99", "reset 99", "align 99", "align 0 x",
  "loadtex 99 a.png", "loadtex", "dropon", "dropon a.png 99", "dropat x", "dropat assets/nao.obj 1 2 x",
  "spawn", "spawn X a b c", "spawn X 1 2", "spawn X 1 2 3 9", "spawn X 1 2 3 1 abc",
  "instscene", "instscene build/claude-cena-invalida.json 99",
  "loadscene", "loadscene build/nao_existe.json", "loadscene build/claude-cena-invalida.json",
  "makeprefab", "makeprefab build/x.json 99",
  "gameview camera 99", "pickat", "pickat x 1", "groundat 1", "gizmoat",
  "vsync", "vsync x", "hier x", "thumb", "snap x", "snap 2", "gizmoat 1x 2", "snd 440x", "fluid x", "rename 0 \"\"",
  "teste_lanca", "teste_lanca_muta",
];
let i = 0;
while (i < ruins.length) {
  const cmd = ruins[i];
  const out = execCommand(800, 600, cmd);
  check(out.indexOf("[erro]") === 0, "'" + cmd + "' deveria ser [erro]: " + out);
  check(out.indexOf("undefined") < 0 && out.indexOf("NaN") < 0, "'" + cmd + "': motivo legivel, sem undefined/NaN: " + out);
  check(cena() === cenaAntes, "'" + cmd + "' mudou a cena: " + out);
  check(history.undoDepth() === undoAntes && history.redoDepth() === redoAntes,
    "'" + cmd + "' mexeu no Desfazer/Refazer (" + history.undoDepth() + "/" + history.redoDepth() + "): " + out);
  i = i + 1;
}
check(execCommand(800, 600, "teste_lanca") === "[erro] teste_lanca: quebrou", "comando de pacote que lança: [erro] <cmd>: <mensagem>");
check(execCommand(800, 600, "teste_lanca_muta") === "[erro] teste_lanca_muta: pifou no meio", "muta e lança: mensagem");
check(scene.objects[0].name === "A", "muta e lança: a cena volta ao snapshot");
const semArquivo = execCommand(800, 600, "loadscene build/nao_existe.json");
check(semArquivo.indexOf("[erro] loadscene") === 0 && semArquivo.indexOf("nao_existe") > 0, "embutido que lança: [erro] <cmd>: <mensagem>: " + semArquivo);
check(S.selected === 1, "seleção intacta");
// o editor segue respondendo depois dos erros
check(execCommand(800, 600, "move 1 7 8 9").indexOf("[ok]") === 0 && scene.objects[1].transform.px === 7.0, "segue funcionando");
check(history.undoDepth() === undoAntes + 1 && history.redoDepth() === 0, "o comando valido empilha 1 Desfazer");

// ── Desfazer CHEIO (no teto, o snapshot empurra e descarta: o tamanho não muda) ──
function mesmaPilha(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  let k = 0; while (k < a.length) { if (a[k] !== b[k]) return false; k = k + 1; } return true;
}
check(registerCommand("teste_erro_muta", "teste_erro_muta :: muta e recusa", true, (p: string[]) => "[erro] recusado"), "registra");
let n = 0; while (n < 45) { history.snapshot(); n = n + 1; }
check(history.undoDepth() === 40, "setup: Desfazer no teto (" + history.undoDepth() + ")");
history.r = [sceneToJSON()];
const cheioU = history.u.slice(); const cheioR = history.r.slice(); const cheioCena = cena();
const noTeto: string[] = ["move 999 0 0 0", "teste_erro_muta", "teste_lanca_muta", "loadscene build/nao_existe.json", "setfield 0 0 0 1"];
n = 0;
while (n < noTeto.length) {
  const out = execCommand(800, 600, noTeto[n]);
  check(out.indexOf("[erro]") === 0, noTeto[n] + " no teto: " + out);
  check(mesmaPilha(history.u, cheioU) && mesmaPilha(history.r, cheioR), noTeto[n] + ": Desfazer/Refazer identicos no teto");
  check(cena() === cheioCena, noTeto[n] + ": cena identica no teto");
  n = n + 1;
}

// ── exceção depois de mudar a cena, com um osso escolhido ─────────────────────
scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "spawn heroi 0 0 0").indexOf("[ok]") === 0, "spawn heroi");
check(execCommand(800, 600, "addskel 0 assets/models/kenney/character-a.glb").indexOf("[ok]") === 0, "addskel");
const sk = skeletonOfObject(scene.objects[0]);
check(sk !== null, "Skeleton");
const osso = sk!.boneIndex("arm-right");
S.selected = 0;
selectBone(scene.objects[0], osso);
check(S.selectedBone === osso && S.selectedBoneOwner === scene.objects[0], "setup: osso escolhido");
const antigo = scene.objects[0];
check(execCommand(800, 600, "teste_lanca_muta").indexOf("[erro]") === 0, "lanca depois de mudar");
check(scene.objects[0].name === "heroi" && scene.objects[0] !== antigo, "a cena voltou ao snapshot (objetos recriados)");
check(S.selectedBone === osso && S.selectedBoneOwner === scene.objects[0], "o osso escolhido segue no objeto restaurado, sem dono pendurado");
println("[PASSOU] ws robustez: argumentos validados, excecoes viram [erro], cena e Desfazer intactos");
