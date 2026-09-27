// Comandos de CONSULTA (só leem estado): state, res, help.
import { scene, S } from "../session";
import { setVsync } from "@engine/render/gpu3d";
import { argInt, graus } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";

/// Estado completo da cena + câmera (para a IA inspecionar).
export function cmdState(): string {
  let m = "[state] objs=" + scene.objects.length + " sel=" + S.selected + " playing=" + S.playing + " drawn=" + S.drawnLast +
          " tool=" + S.tool + " cam=(" + S.camX + "," + S.camY + "," + S.camZ + ") yaw=" + S.camYaw + " pitch=" + S.camPitch;
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i];
    m = m + " | #" + i + " " + o.name + " k" + o.meshKind + " cm" + o.customMesh +
        " pos(" + o.transform.px + "," + o.transform.py + "," + o.transform.pz + ")" +
        " rot(" + graus(o.transform.ry) + "," + graus(o.transform.rx) + "," + graus(o.transform.rz) + ")" +
        " scl(" + o.transform.sx + "," + o.transform.sy + "," + o.transform.sz + ")";
    i = i + 1;
  }
  return m;
}

/// Resolução lógica atual da janela.
export function cmdRes(w: number, h: number): string {
  return "[res] " + w + " x " + h;
}

/// vsync [0|1] — liga/desliga a espera pelo refresh do monitor.
///
/// Com vsync ligado (padrão) o FPS satura em ~60 e ESCONDE o custo real do
/// frame: 5 ms e 16 ms medem igual. Desligar mede a performance de verdade.
export function cmdVsync(parts: string[]): string {
  const pedido = argInt(parts, 1);
  if (pedido !== 0 && pedido !== 1) return erroUso("vsync");
  const on = pedido;
  setVsync(S.win, on);
  return "[ok] vsync " + (on !== 0 ? "LIGADO (limitado ao monitor)" : "DESLIGADO (mede o frame real)");
}
