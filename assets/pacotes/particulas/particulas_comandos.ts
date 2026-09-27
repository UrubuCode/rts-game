/** @editorOnly */
// Pacote partículas (editor): o comando `particulas` do WebSocket — tocar,
// parar, emitir, limpar e INSPECIONAR o efeito por número (vivas, max,
// tocando, tempo, bbox), porque a IA não vê a janela (spec §5). No molde de
// `audio_comandos.ts` (que separa o comando do resto do pacote de editor).
import { Editor, registerCommand } from "@editor/api";
import type { GameObject } from "@engine/core/gameobject";
import { ParticleSystem } from "@scripts/particlesystem";

const AJUDA_PARTICULAS: string =
  "particulas <obj> play|stop|emit <n>|clear|info :: toca, para, emite, limpa e inspeciona o efeito por número (vivas, max, tocando, t, bbox), sem depender da janela :: particulas Fogo info";
const USO_PARTICULAS: string = "[erro] particulas: uso particulas <obj> play|stop|emit <n>|clear|info";

function n3(v: f64): string { return v.toFixed(3); }

function particleSystemDe(o: GameObject): ParticleSystem | null {
  let i = 0;
  while (i < o.behaviors.length) {
    const b = o.behaviors[i];
    if (b instanceof ParticleSystem) return b as ParticleSystem;
    i = i + 1;
  }
  return null;
}
function formatarBBox(p: ParticleSystem): string {
  const b = p.bboxAtual();
  return "bbox=(" + n3(b[0]) + "," + n3(b[1]) + "," + n3(b[2]) + ")-(" + n3(b[3]) + "," + n3(b[4]) + "," + n3(b[5]) + ")";
}
function cmdInfo(p: ParticleSystem): string {
  return "vivas=" + p.particleCount + " max=" + p.maxParticles + " tocando=" + (p.isPlaying() ? 1 : 0) +
         " t=" + n3(p.time) + " " + formatarBBox(p);
}

export function cmdParticulas(partes: string[]): string {
  if (partes.length < 3) return USO_PARTICULAS;
  const o = Editor.object(partes[1]);
  if (o === null) return "[erro] particulas: objeto '" + partes[1] + "' não encontrado";
  const p = particleSystemDe(o);
  if (p === null) return "[erro] particulas: '" + o.name + "' não tem ParticleSystem";
  const cmd = partes[2];
  if (cmd === "play") { p.play(); return "tocando"; }
  if (cmd === "stop") { p.stop(false); return "parado"; }
  if (cmd === "clear") { p.clear(); return "limpo"; }
  if (cmd === "emit") {
    const n = partes.length > 3 ? parseFloat(partes[3]) : 1.0;
    if (n !== n || n <= 0.0) return "[erro] particulas: quantidade inválida";
    p.emit(n);
    return "emitidas " + n;
  }
  if (cmd === "info") return cmdInfo(p);
  return USO_PARTICULAS;
}
registerCommand("particulas", AJUDA_PARTICULAS, false, cmdParticulas);
