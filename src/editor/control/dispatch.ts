// Despacho de comandos de controle — um SWITCH que roteia para o handler de cada
// comando (definidos em commands/*.ts). Devolve a resposta em texto.
import { cmdState, cmdRes, cmdHelp, cmdVsync } from "./commands/query";
import { cmdSpawn } from "./commands/spawn";
import { cmdMove, cmdScl, cmdMesh, cmdColor, cmdSpin, cmdTool, cmdSnap, cmdReset, cmdAlign } from "./commands/transform";
import { cmdSelect, cmdDelete, cmdCam, cmdFocus, cmdPlay, cmdPause, cmdClear, cmdLoad, cmdInstScene, cmdDup, cmdSaveScene, cmdSelectAdd, cmdSelectClear, cmdRename, cmdView, cmdGrid, cmdVis, cmdDupN, cmdIso, cmdGroup, cmdUngroup, cmdFrameAll, cmdDelSel, cmdLight, cmdHier, cmdSnd, cmdLog, cmdFluid} from "./commands/scene";
import { logInfo, logError } from "@engine/core/logger";
import { cmdComps, cmdCompList, cmdAddComp, cmdRmComp, cmdSetField } from "./commands/component";
import { cmdAddSkel, cmdBones, cmdPose, cmdResetPose, cmdSelBone, cmdAnims, cmdAnim } from "./commands/skeleton";
import { cmdAnimator } from "./commands/animator";
import { cmdTree, cmdParent, cmdMoveTree } from "./commands/hierarchy";
import { cmdLs, cmdMkdir, cmdRmpath, cmdReadFile, cmdWriteFile, cmdMv, cmdLoadObj, cmdSetCustom, cmdLoadTex, cmdMakePrefab, cmdInstPrefab } from "./commands/files";
import { cmdDrop, cmdDropAt, cmdDropOn, cmdPickAt, cmdGroundAt, cmdThumb } from "./commands/dnd";
import { cmdDoc } from "./commands/doc";
import { cmdDescribe, cmdScene } from "@editor/control/commands/describe";
import { cmdGizmoAt } from "./commands/gizmo";
import { cmdMenu } from "./commands/menu";
import { cmdGameView } from "./commands/gameview";
import { commandIndex, commandMutates, runCommand } from "../api";
import { comandoEmbutido, MUTA_SIM } from "@editor/control/builtin_commands";
import { sceneToJSON, sceneFromJSON } from "@editor/sceneio";
import { scene, S } from "./session";
import { history } from "../undo";
import { cmdStop } from "./commands/scene";
import { playMode } from "../play_mode";
import { inFrustum } from "@engine/render/gpu3d";
import { rigidBackendName, rigidBodyCount, rigidSetMode, rigidMode, rigidReport, rigidGridOverflow } from "@engine/core/physics_backend";
import { profReport, profEnable, profReset, profEnabled } from "@engine/core/profiler";
import { stepsLastFrame, stepDiscards, stepAlpha } from "@engine/core/fixedstep";

/// Comandos que MUTAM a cena (o dispatch tira um snapshot antes, pro undo):
/// os marcados `MUTA_SIM` no manifesto (builtin_commands.ts).
function isMutating(c: string): boolean {
  const info = comandoEmbutido(c);
  return info !== null && info.muta === MUTA_SIM;
}

/// Consultas: não vão para o log (encheriam o histórico com as próprias
/// perguntas — inclusive a consulta ao log).
const NAO_REGISTRAR: string[] = ["log", "state", "help", "doc", "describe", "scene"];
const ERRO_PREFIXO: string = "[erro]";

/// Executa um comando e REGISTRA no log. O corpo real é `execCommandInner`,
/// chamado por `execProtegido`; esta camada existe só para o registro, porque
/// o `switch` lá dentro tem `return` em cada caso e capturar em todos seria
/// repetir 80 vezes.
export function execCommand(w: number, h: number, line: string): string {
  const out = execProtegido(w, h, line);
  const c = line.split(" ")[0];
  if (NAO_REGISTRAR.indexOf(c) < 0) {
    // erro do comando vira nível de erro: é o que se procura ao investigar
    if (out.indexOf(ERRO_PREFIXO) === 0) logError(line + "  ->  " + out);
    else logInfo(line + "  ->  " + out);
  }
  return out;
}

/// O ÚNICO ponto protegido da porta de controle (embutidos e comandos de
/// pacote). Um comando que lança responde `[erro] <cmd>: <mensagem>` em vez de
/// subir pelo `pumpEvents()` até o quadro e derrubar o editor.
///
/// Desfazer: se a resposta é `[erro]` (validação ou exceção), o snapshot que o
/// despacho tirou é descartado e o Refazer volta como estava. Se o comando
/// lançou DEPOIS de mudar a cena, ela volta ao snapshot.
///
/// O `try` fica AQUI, numa função que só roda quando chega um comando: no RTS a
/// função que contém `try` aloca a cada chamada (CLAUDE.md, "Custo por quadro").
function execProtegido(w: number, h: number, line: string): string {
  const undoAntes = history.u.slice();
  const redoAntes = history.r;
  let out = "";
  let lancou = false;
  try { out = execCommandInner(w, h, line); }
  catch (error) {
    lancou = true;
    out = ERRO_PREFIXO + " " + line.split(" ")[0] + ": " + (error instanceof Error ? error.message : String(error));
  }
  if (out.indexOf(ERRO_PREFIXO) === 0 && history.u.length !== undoAntes.length) {
    const antes = history.u[history.u.length - 1];
    if (lancou && antes !== sceneToJSON()) sceneFromJSON(antes);
    history.u = undoAntes; history.r = redoAntes; history.versao = history.versao + 1;
  }
  return out;
}

/// Comando registrado por script (@editor/api). Só `muta = true` tira snapshot
/// de Desfazer; um `[erro]` (ou exceção) descarta o snapshot em `execProtegido`.
function runRegistered(i: number, parts: string[]): string {
  if (commandMutates(i)) history.snapshot();
  return runCommand(i, parts);
}

function execCommandInner(w: number, h: number, line: string): string {
  const parts = line.split(" ");
  const cmd = parts[0];
  const np = parts.length;
  // UNDO: snapshot da cena ANTES de qualquer operação mutante.
  //
  // `anim ... state` é uma CONSULTA (não muda a pose/clipe/tempo — só lê e
  // formata), mas `cmd` sozinho é só a palavra "anim", igual a `anim ... play`.
  // Sem o `parts[2] !== "state"` abaixo, uma IA que faz polling de
  // `anim N state` empilharia um snapshot por chamada (sem NENHUMA mudança
  // real) e limparia a pilha de redo (history.snapshot() zera `this.r`) a
  // cada leitura — undo/redo ficam inúteis para quem também está editando a
  // pose ao mesmo tempo.
  if (cmd === "clear" || cmd === "loadscene") playMode.stop();
  // `anim ... preview` também não: a prévia é estado do editor (só trocar o
  // clipe entra no undo, e o próprio subcomando faz esse snapshot).
  if (isMutating(cmd) && !(cmd === "anim" && (parts[2] === "state" || parts[2] === "preview"))) history.snapshot();
  const registrado = commandIndex(cmd);
  // `animator` fica FORA do snapshot genérico: `set`/`trigger` mexem em
  // parâmetros (estado de execução), `state`/`params` são consultas (polling
  // não pode zerar o redo, como no `anim ... state`), e `load` tira o próprio
  // snapshot só depois de validar o arquivo (commands/animator.ts).
  switch (cmd) {
    case "undo": {
      if (history.undo() !== 0) return "[ok] undo (estado restaurado)";
      return "[undo] nada pra desfazer";
    }
    case "redo": {
      if (history.redo() !== 0) return "[ok] redo (estado restaurado)";
      return "[redo] nada pra refazer";
    }
    case "state": return cmdState();
    case "describe": return cmdDescribe(parts);
    case "scene": return cmdScene(parts);
    // A TABELA DE DESEMPENHO — onde o frame foi gasto, por seção.
    //
    // Existe porque adivinhar errou duas vezes nesta engine: primeiro culpando o
    // `drawMesh` (era a física), depois culpando a física (o render está preso
    // no vsync e o custo era um round-trip de GPU síncrono). A linha
    // "(resto/vsync)" é a mais importante: é o que ninguém instrumentou, mais a
    // espera do monitor.
    case "prof": {
      const alvo = parts[1];
      if (alvo === "off") { profEnable(0); return "[prof] desligado"; }
      if (alvo === "on") { profEnable(1); profReset(); return "[prof] ligado (zerado)"; }
      if (alvo === "reset") { profReset(); return "[prof] zerado"; }
      if (profEnabled() === 0) return "[prof] desligado — use `prof on`";
      const nl = String.fromCharCode(10);
      return profReport() + nl +
             "  passo fixo: " + stepsLastFrame() + " passos no ultimo frame, alpha=" +
             stepAlpha().toFixed(2) + ", descartes=" + stepDiscards() + nl +
             "  fisica: " + rigidBackendName() + " com " + rigidBodyCount() + " corpos (overflow=" + rigidGridOverflow() + ")";
    }
    // Trocar o backend da física EM TEMPO DE EXECUÇÃO, sem reiniciar o editor.
    //
    // Existe porque medir os dois exige alternar na MESMA cena: reiniciar entre
    // as medições troca a cena, o aquecimento e o estado de sono junto, e aí a
    // diferença deixa de ser do backend. `dbg` logo abaixo reporta qual está
    // ativo, então a dupla responde "o que mudou e quanto custou".
    case "fisica": {
      const alvo = parts[1];
      if (alvo === "gpu") { rigidSetMode(1); return "[fisica] modo=gpu ativo=" + rigidBackendName(); }
      if (alvo === "cpu") { rigidSetMode(0); return "[fisica] modo=cpu ativo=" + rigidBackendName(); }
      if (alvo === "rust") { rigidSetMode(2); return "[fisica] modo=rust ativo=" + rigidBackendName(); }
      if (alvo === "auto") { rigidSetMode(3); return "[fisica] modo=auto ativo=" + rigidBackendName(); }
      if (alvo === "report") { rigidReport(); return "[fisica] relatorio impresso no stdout do editor"; }
      return "[fisica] modo=" + rigidMode() + " ativo=" + rigidBackendName() +
             " | use: fisica cpu | fisica gpu | fisica rust | fisica auto | fisica report";
    }
    case "dbg": {
      // replica a decisão do loop de render pra TODOS os objetos e conta
      let wouldDraw = 0;
      let activeN = 0;
      let oi = 0;
      while (oi < scene.objects.length) {
        const o = scene.objects[oi];
        if (o.active !== 0 && o.meshKind !== 0) {
          activeN = activeN + 1;
          let rmax: f64 = o.transform.sx;
          if (o.transform.sy > rmax) rmax = o.transform.sy;
          if (o.transform.sz > rmax) rmax = o.transform.sz;
          const v = inFrustum(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, 1.05, w / h,
            o.transform.wx, o.transform.wy, o.transform.wz, rmax * 0.87);
          if (v !== 0) wouldDraw = wouldDraw + 1;
        }
        oi = oi + 1;
      }
      const last = scene.objects[scene.objects.length - 1];
      // BACKEND DE FÍSICA: sem isto, quem lê um fps daqui não sabe o que está
      // medindo — CPU e GPU só fazem sentido comparados separadamente. É o nome
      // do que está ATIVO, não do que foi pedido: pedir GPU e cair para a CPU
      // (sem placa, kernel que não compilou) é exatamente o estado que um
      // número inexplicável costuma esconder.
      return "[dbg] fisica=" + rigidBackendName() + " corpos=" + rigidBodyCount() + " grid_overflow=" + rigidGridOverflow() +
        " fps=" + S.fpsLast + " ativos=" + activeN + " wouldDraw=" + wouldDraw + " drawnLast=" + S.drawnLast +
        " | ultimo " + last.name + " world(" + last.transform.wx + "," + last.transform.wy + "," + last.transform.wz + ")";
    }
    case "hier": return cmdHier(parts);
    case "snd": return cmdSnd(parts);
    case "log": return cmdLog(parts);
    case "fluid": return cmdFluid(parts);
    case "res": return cmdRes(w, h);
    case "vsync": return cmdVsync(parts);
    case "help": return cmdHelp();
    case "spawn": return cmdSpawn(parts, np);
    case "move": return cmdMove(parts);
    case "scl": return cmdScl(parts);
    case "tool": return cmdTool(parts);
    case "snap": return cmdSnap(parts);
    case "reset": return cmdReset(parts);
    case "align": return cmdAlign(parts);
    case "mesh": return cmdMesh(parts);
    case "color": return cmdColor(parts);
    case "spin": return cmdSpin(parts, np);
    case "select": return cmdSelect(parts);
    case "selectadd": return cmdSelectAdd(parts);
    case "selectclear": return cmdSelectClear(parts);
    case "rename": return cmdRename(parts);
    case "delete": return cmdDelete(parts);
    case "delsel": return cmdDelSel(parts);
    case "cam": return cmdCam(parts);
    case "focus": return cmdFocus(parts);
    case "view": return cmdView(parts);
    case "frameall": return cmdFrameAll(parts);
    case "light": return cmdLight(parts);
    case "grid": return cmdGrid(parts);
    case "vis": return cmdVis(parts);
    case "iso": return cmdIso(parts);
    case "group": return cmdGroup(parts);
    case "ungroup": return cmdUngroup(parts);
    case "play": return cmdPlay();
    case "pause": return cmdPause();
    case "stop": return cmdStop();
    case "clear": return cmdClear();
    case "loadscene": return cmdLoad(parts);
    case "savescene": return cmdSaveScene(parts);
    case "instscene": return cmdInstScene(parts);
    case "dup": return cmdDup(parts);
    case "dupn": return cmdDupN(parts);
    case "comps": return cmdComps(parts);
    case "complist": return cmdCompList();
    case "addcomp": return cmdAddComp(parts);
    case "rmcomp": return cmdRmComp(parts);
    case "setfield": return cmdSetField(parts);
    case "addskel": return cmdAddSkel(parts);
    case "bones": return cmdBones(parts);
    case "pose": return cmdPose(parts);
    case "resetpose": return cmdResetPose(parts);
    case "selbone": return cmdSelBone(parts);
    case "anims": return cmdAnims(parts);
    case "anim": return cmdAnim(parts);
    case "animator": return cmdAnimator(parts);
    case "tree": return cmdTree();
    case "parent": return cmdParent(parts);
    case "movetree": return cmdMoveTree(parts);
    case "ls": return cmdLs(parts);
    case "mkdir": return cmdMkdir(parts);
    case "rmpath": return cmdRmpath(parts);
    case "readfile": return cmdReadFile(parts);
    case "writefile": return cmdWriteFile(parts);
    case "mv": return cmdMv(parts);
    case "makeprefab": return cmdMakePrefab(parts);
    case "instprefab": return cmdInstPrefab(parts);
    case "loadobj": return cmdLoadObj(parts);
    case "loadtex": return cmdLoadTex(parts);
    case "setcustom": return cmdSetCustom(parts);
    // ── DRAG & DROP de assets (o equivalente WS de arrastar do Project) ──────
    case "drop": return cmdDrop(parts, w, h);
    case "dropat": return cmdDropAt(parts);
    case "dropon": return cmdDropOn(parts);
    case "pickat": return cmdPickAt(parts, w, h);
    // seleção não é mutação da cena: fora de isMutating (sem snapshot)
    case "gizmoat": return cmdGizmoAt(parts);
    // fora de isMutating: o executor tira o proprio snapshot, so para "Criar/"
    case "menu": return cmdMenu(parts);
    // estado da aba Jogo (editor): fora de isMutating, sem Desfazer
    case "gameview": return cmdGameView(parts);
    case "groundat": return cmdGroundAt(parts, w, h);
    case "thumb": return cmdThumb(parts);
    case "doc": return cmdDoc(parts);
    default: return registrado >= 0 ? runRegistered(registrado, parts) : "[erro] desconhecido: " + cmd;
  }
}
