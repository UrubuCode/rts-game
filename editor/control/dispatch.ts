// Despacho de comandos de controle — um SWITCH que roteia para o handler de cada
// comando (definidos em commands/*.ts). Devolve a resposta em texto.
import { cmdState, cmdRes, cmdHelp, cmdVsync } from "./commands/query";
import { cmdSpawn } from "./commands/spawn";
import { cmdMove, cmdScl, cmdMesh, cmdColor, cmdSpin, cmdTool, cmdSnap, cmdReset, cmdAlign } from "./commands/transform";
import { cmdSelect, cmdDelete, cmdCam, cmdFocus, cmdPlay, cmdPause, cmdClear, cmdLoad, cmdInstScene, cmdDup, cmdSaveScene, cmdSelectAdd, cmdSelectClear, cmdRename, cmdView, cmdGrid, cmdVis, cmdDupN, cmdIso, cmdGroup, cmdUngroup, cmdFrameAll, cmdDelSel, cmdLight, cmdHier, cmdSnd, cmdLog, cmdFluid} from "./commands/scene";
import { logInfo, logError } from "../../engine/core/logger";
import { cmdComps, cmdCompList, cmdAddComp, cmdRmComp, cmdSetField } from "./commands/component";
import { cmdTree, cmdParent, cmdMoveTree } from "./commands/hierarchy";
import { cmdLs, cmdMkdir, cmdRmpath, cmdReadFile, cmdWriteFile, cmdMv, cmdLoadObj, cmdSetCustom, cmdLoadTex, cmdMakePrefab, cmdInstPrefab } from "./commands/files";
import { cmdDrop, cmdDropAt, cmdDropOn, cmdPickAt, cmdGroundAt, cmdThumb } from "./commands/dnd";
import { cmdDoc } from "./commands/doc";
import { scene, S } from "./session";
import { history } from "../undo";
import { inFrustum } from "../../engine/render/gpu3d";

/// Comandos que MUTAM a cena (o dispatch tira um snapshot antes, pro undo).
function isMutating(c: string): boolean {
  return c === "spawn" || c === "move" || c === "scl" || c === "mesh" || c === "color" ||
    c === "spin" || c === "delete" || c === "dup" || c === "clear" || c === "loadscene" ||
    c === "instscene" || c === "parent" || c === "movetree" || c === "addcomp" ||
    c === "rmcomp" || c === "setfield" || c === "loadobj" || c === "loadtex" ||
    c === "rename" || c === "reset" || c === "grid" || c === "instprefab" ||
    c === "drop" || c === "dropat" || c === "dropon";
}

/// Executa um comando e REGISTRA no log. O corpo real é `execCommandInner`;
/// esta camada existe só para o registro, porque o `switch` lá dentro tem
/// `return` em cada caso e capturar em todos seria repetir 60 vezes.
///
/// `log` e `state` não são registrados: são consultas, e registrá-las encheria
/// o histórico com as próprias perguntas — inclusive a consulta ao log.
export function execCommand(w: number, h: number, line: string): string {
  const out = execCommandInner(w, h, line);
  const c = line.split(" ")[0];
  if (c !== "log" && c !== "state" && c !== "help" && c !== "doc") {
    // erro do comando vira nível de erro: é o que se procura ao investigar
    if (out.length > 6 && out.charCodeAt(1) === 101 && out.charCodeAt(2) === 114) {
      logError(line + "  ->  " + out);
    } else {
      logInfo(line + "  ->  " + out);
    }
  }
  return out;
}

function execCommandInner(w: number, h: number, line: string): string {
  const parts = line.split(" ");
  const cmd = parts[0];
  const np = parts.length;
  // UNDO: snapshot da cena ANTES de qualquer operação mutante.
  if (isMutating(cmd)) history.snapshot();
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
      return "[dbg] fps=" + S.fpsLast + " ativos=" + activeN + " wouldDraw=" + wouldDraw + " drawnLast=" + S.drawnLast +
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
    case "groundat": return cmdGroundAt(parts, w, h);
    case "thumb": return cmdThumb(parts);
    case "doc": return cmdDoc(parts);
    default: return "[erro] desconhecido: " + cmd;
  }
}
