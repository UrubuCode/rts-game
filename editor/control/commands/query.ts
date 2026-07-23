// Comandos de CONSULTA (só leem estado): state, res, help.
import { scene, S } from "../session";

/// Estado completo da cena + câmera (para a IA inspecionar).
export function cmdState(): string {
  let m = "[state] objs=" + scene.objects.length + " sel=" + S.selected + " playing=" + S.playing + " drawn=" + S.drawnLast +
          " cam=(" + S.camX + "," + S.camY + "," + S.camZ + ") yaw=" + S.camYaw + " pitch=" + S.camPitch;
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i];
    m = m + " | #" + i + " " + o.name + " k" + o.meshKind +
        " pos(" + o.transform.px + "," + o.transform.py + "," + o.transform.pz + ")" +
        " scl(" + o.transform.sx + "," + o.transform.sy + "," + o.transform.sz + ")";
    i = i + 1;
  }
  return m;
}

/// Resolução lógica atual da janela.
export function cmdRes(w: number, h: number): string {
  return "[res] " + w + " x " + h;
}

/// Autodescrição: lista de comandos + assinatura (a IA descobre o que pode fazer).
export function cmdHelp(): string {
  return "[help] comandos:" +
    " state | res | help" +
    " | spawn <nome> <x> <y> <z> [kind] [scale]  (kind 1=cubo 2=piramide 3=octaedro 4=esfera)" +
    " | move <i> <x> <y> <z>" +
    " | scl <i> <sx> <sy> <sz>" +
    " | mesh <i> <kind>" +
    " | color <i> <r> <g> <b>  (0..255)" +
    " | spin <i> <spdY> [spdX]" +
    " | select <i> | delete <i>" +
    " | cam <x> <y> <z> <yaw> <pitch>" +
    " | play | pause | clear" +
    " | loadscene <path>";
}
