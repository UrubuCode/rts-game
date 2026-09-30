// IA dos bots: produz um FpsPlayerInput por tick, pelo mesmo caminho dos
// humanos. Não importa world.ts; recebe por parâmetro o que precisa.
import { Scene } from "@engine/core/scene";
import { RaycastHit } from "@engine/core/spatial_queries";
import {
  FPS_TICK_DT, FPS_ALTURA_OLHO, FPS_ALTURA_CORPO, FPS_VISAO_BOT, FPS_TICKS_ENTRE_VISADAS,
  FPS_TEMPO_PARADO_BOT, FPS_DIST_CHEGOU_BOT, FPS_REACAO_BOT,
} from "./config";
import { FPS_CAMADA_MAPA } from "./layers";
import { FpsPlayerInput, fpsInputVazio } from "./input";
import { FpsPlayerState } from "./player";
import { fpsRaio } from "./consultas";

export const FPS_BOT_PATRULHA = 0;
export const FPS_BOT_ATIRAR = 1;

export interface FpsBotState {
  estado: number;
  alvo: number;
  destino: number;
  tempoParado: f64;
  refX: f64;
  refZ: f64;
  semente: number;
  ladoTempo: f64;
  ladoSinal: number;
  reacaoRestante: f64;
  input: FpsPlayerInput;
}

export function fpsNovoBot(indice: number): FpsBotState {
  return {
    estado: FPS_BOT_PATRULHA, alvo: -1, destino: -1, tempoParado: 0.0, refX: 0.0, refZ: 0.0,
    semente: 1000 + indice * 7919, ladoTempo: 0.0, ladoSinal: 1, reacaoRestante: FPS_REACAO_BOT, input: fpsInputVazio(),
  };
}

function fpsBotRnd(b: FpsBotState): f64 {
  b.semente = ((b.semente * 1664525 + 1013904223) | 0);
  return (b.semente >>> 0) / 4294967296.0;
}

/// Jogador vivo mais próximo, dentro de FPS_VISAO_BOT, com linha de visada livre.
function fpsBotProcurarAlvo(eu: number, jog: FpsPlayerState[], sc: Scene, out: RaycastHit): number {
  const p = jog[eu];
  const ex = p.x; const ey = p.y + FPS_ALTURA_OLHO; const ez = p.z;
  let melhor = -1;
  let melhorD2 = FPS_VISAO_BOT * FPS_VISAO_BOT;
  let j = 0;
  while (j < jog.length) {
    const q = jog[j];
    if (j !== eu && q.vivo) {
      const dx = q.x - ex; const dy = q.y + FPS_ALTURA_CORPO * 0.5 - ey; const dz = q.z - ez;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < melhorD2 && d2 > 0.000001) {
        const d = Math.sqrt(d2);
        if (!fpsRaio(ex, ey, ez, dx / d, dy / d, dz / d, d, out, FPS_CAMADA_MAPA, sc)) {
          melhor = j;
          melhorD2 = d2;
        }
      }
    }
    j = j + 1;
  }
  return melhor;
}

export function fpsBotInput(b: FpsBotState, eu: number, jog: FpsPlayerState[], spawnX: f64[], spawnZ: f64[],
                            tick: number, sc: Scene, out: RaycastHit): FpsPlayerInput {
  const inp = b.input;
  const p = jog[eu];
  inp.seq = tick;
  inp.frente = 0; inp.lado = 0;
  inp.pulo = false; inp.atirar = false; inp.recarregar = false; inp.granada = false;
  inp.yaw = p.yaw; inp.pitch = p.pitch;
  if (!p.vivo) {
    b.estado = FPS_BOT_PATRULHA; b.alvo = -1; b.destino = -1;
    return inp;
  }

  // visada escalonada: o bot i só procura nos ticks i, i+12, i+24...
  if ((tick % FPS_TICKS_ENTRE_VISADAS) === (eu % FPS_TICKS_ENTRE_VISADAS)) {
    const anterior = b.alvo;
    b.alvo = fpsBotProcurarAlvo(eu, jog, sc, out);
    if (b.alvo !== anterior) b.reacaoRestante = FPS_REACAO_BOT;
    b.estado = b.alvo >= 0 ? FPS_BOT_ATIRAR : FPS_BOT_PATRULHA;
  }

  if (b.estado === FPS_BOT_ATIRAR && b.alvo >= 0 && b.alvo < jog.length && jog[b.alvo].vivo) {
    const q = jog[b.alvo];
    const dx = q.x - p.x;
    const dy = q.y + FPS_ALTURA_CORPO * 0.5 - (p.y + FPS_ALTURA_OLHO);
    const dz = q.z - p.z;
    inp.yaw = Math.atan2(dx, dz);
    inp.pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    b.reacaoRestante = Math.max(0.0, b.reacaoRestante - FPS_TICK_DT);
    inp.atirar = b.reacaoRestante <= 0.0;
    b.ladoTempo = b.ladoTempo - FPS_TICK_DT;
    if (b.ladoTempo <= 0.0) {
      b.ladoTempo = 0.5 + fpsBotRnd(b);
      b.ladoSinal = fpsBotRnd(b) < 0.5 ? -1 : 1;
    }
    inp.lado = b.ladoSinal;
    if (p.municao === 0) inp.recarregar = true;
    return inp;
  }

  // patrulha entre pontos de renascimento
  if (b.destino < 0) {
    b.destino = Math.floor(fpsBotRnd(b) * spawnX.length) % spawnX.length;
    b.tempoParado = 0.0;
    b.refX = p.x; b.refZ = p.z;
  }
  const tx = spawnX[b.destino] - p.x;
  const tz = spawnZ[b.destino] - p.z;
  if (tx * tx + tz * tz < FPS_DIST_CHEGOU_BOT * FPS_DIST_CHEGOU_BOT) {
    b.destino = -1;
    return inp;
  }
  inp.yaw = Math.atan2(tx, tz);
  inp.pitch = 0.0;
  inp.frente = 1;
  b.tempoParado = b.tempoParado + FPS_TICK_DT;
  if (b.tempoParado >= FPS_TEMPO_PARADO_BOT) {
    const mx = p.x - b.refX; const mz = p.z - b.refZ;
    if (mx * mx + mz * mz < 1.0) { b.destino = -1; inp.pulo = true; }
    b.tempoParado = 0.0;
    b.refX = p.x; b.refZ = p.z;
  }
  return inp;
}
