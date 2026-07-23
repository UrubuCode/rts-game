// Despacho de comandos de controle — um SWITCH que roteia para o handler de cada
// comando (definidos em commands/*.ts). Devolve a resposta em texto.
import { cmdState, cmdRes, cmdHelp } from "./commands/query";
import { cmdSpawn } from "./commands/spawn";
import { cmdMove, cmdScl, cmdMesh, cmdColor, cmdSpin } from "./commands/transform";
import { cmdSelect, cmdDelete, cmdCam, cmdPlay, cmdPause, cmdClear, cmdLoad } from "./commands/scene";

export function execCommand(w: number, h: number, line: string): string {
  const parts = line.split(" ");
  const cmd = parts[0];
  const np = parts.length;
  switch (cmd) {
    case "state": return cmdState();
    case "res": return cmdRes(w, h);
    case "help": return cmdHelp();
    case "spawn": return cmdSpawn(parts, np);
    case "move": return cmdMove(parts);
    case "scl": return cmdScl(parts);
    case "mesh": return cmdMesh(parts);
    case "color": return cmdColor(parts);
    case "spin": return cmdSpin(parts, np);
    case "select": return cmdSelect(parts);
    case "delete": return cmdDelete(parts);
    case "cam": return cmdCam(parts);
    case "play": return cmdPlay();
    case "pause": return cmdPause();
    case "clear": return cmdClear();
    case "loadscene": return cmdLoad(parts);
    default: return "[erro] desconhecido: " + cmd;
  }
}
