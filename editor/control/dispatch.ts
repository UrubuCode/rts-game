// Despacho de comandos de controle — um SWITCH que roteia para o handler de cada
// comando (definidos em commands/*.ts). Devolve a resposta em texto.
import { cmdState, cmdRes, cmdHelp } from "./commands/query";
import { cmdSpawn } from "./commands/spawn";
import { cmdMove, cmdScl, cmdMesh, cmdColor, cmdSpin } from "./commands/transform";
import { cmdSelect, cmdDelete, cmdCam, cmdPlay, cmdPause, cmdClear, cmdLoad } from "./commands/scene";
import { scene, S } from "./session";
import { inFrustum } from "../../engine/render/gpu3d";

export function execCommand(w: number, h: number, line: string): string {
  const parts = line.split(" ");
  const cmd = parts[0];
  const np = parts.length;
  switch (cmd) {
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
      return "[dbg] ativos=" + activeN + " wouldDraw=" + wouldDraw + " drawnLast=" + S.drawnLast + "
        " | ultimo " + last.name + " local(" + last.transform.px + "," + last.transform.py + "," + last.transform.pz + ")" +
        " world(" + last.transform.wx + "," + last.transform.wy + "," + last.transform.wz + ")";
    }
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
