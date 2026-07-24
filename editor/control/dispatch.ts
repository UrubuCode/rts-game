// Despacho de comandos de controle — um SWITCH que roteia para o handler de cada
// comando (definidos em commands/*.ts). Devolve a resposta em texto.
import { cmdState, cmdRes, cmdHelp } from "./commands/query";
import { cmdSpawn } from "./commands/spawn";
import { cmdMove, cmdScl, cmdMesh, cmdColor, cmdSpin, cmdTool, cmdSnap, cmdReset } from "./commands/transform";
import { cmdSelect, cmdDelete, cmdCam, cmdFocus, cmdPlay, cmdPause, cmdClear, cmdLoad, cmdInstScene, cmdDup, cmdSaveScene, cmdSelectAdd, cmdSelectClear, cmdRename, cmdView, cmdGrid } from "./commands/scene";
import { cmdComps, cmdCompList, cmdAddComp, cmdRmComp, cmdSetField } from "./commands/component";
import { cmdTree, cmdParent, cmdMoveTree } from "./commands/hierarchy";
import { cmdLs, cmdMkdir, cmdRmpath, cmdReadFile, cmdWriteFile, cmdMv, cmdLoadObj, cmdSetCustom, cmdLoadTex, cmdMakePrefab, cmdInstPrefab } from "./commands/files";
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
    c === "rename" || c === "reset" || c === "grid" || c === "instprefab";
}

export function execCommand(w: number, h: number, line: string): string {
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
      return "[dbg] ativos=" + activeN + " wouldDraw=" + wouldDraw + " drawnLast=" + S.drawnLast +
        " | ultimo " + last.name + " world(" + last.transform.wx + "," + last.transform.wy + "," + last.transform.wz + ")";
    }
    case "res": return cmdRes(w, h);
    case "help": return cmdHelp();
    case "spawn": return cmdSpawn(parts, np);
    case "move": return cmdMove(parts);
    case "scl": return cmdScl(parts);
    case "tool": return cmdTool(parts);
    case "snap": return cmdSnap(parts);
    case "reset": return cmdReset(parts);
    case "mesh": return cmdMesh(parts);
    case "color": return cmdColor(parts);
    case "spin": return cmdSpin(parts, np);
    case "select": return cmdSelect(parts);
    case "selectadd": return cmdSelectAdd(parts);
    case "selectclear": return cmdSelectClear(parts);
    case "rename": return cmdRename(parts);
    case "delete": return cmdDelete(parts);
    case "cam": return cmdCam(parts);
    case "focus": return cmdFocus(parts);
    case "view": return cmdView(parts);
    case "grid": return cmdGrid(parts);
    case "play": return cmdPlay();
    case "pause": return cmdPause();
    case "clear": return cmdClear();
    case "loadscene": return cmdLoad(parts);
    case "savescene": return cmdSaveScene(parts);
    case "instscene": return cmdInstScene(parts);
    case "dup": return cmdDup(parts);
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
    case "doc": return cmdDoc(parts);
    default: return "[erro] desconhecido: " + cmd;
  }
}
