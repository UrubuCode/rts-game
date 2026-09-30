// Armas do FPS. Funções puras: calculam e devolvem; quem aplica dano e
// efeitos é o FpsWorld (sem import de world.ts, para não haver ciclo).
import { Scene } from "@engine/core/scene";
import { RaycastHit } from "@engine/core/spatial_queries";
import {
  FPS_ALTURA_OLHO, FPS_ALTURA_CORPO, FPS_MEIA_LARGURA_CAIXA, FPS_ALCANCE, FPS_FRACAO_CABECA,
  FPS_GRAVIDADE, FPS_RAIO_GRANADA, FPS_QUIQUE, FPS_RAIO_EXPLOSAO, FPS_DANO_GRANADA,
} from "./config";
import { FPS_CAMADA_MAPA, FPS_CAMADA_JOGADOR } from "./layers";
import { FpsPlayerState } from "./player";
import { fpsRaio } from "./consultas";

/// Distância, ao longo do raio, até ele SAIR da caixa (origem dentro dela).
export function fpsSaidaDaCaixa(ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64,
                                cx: f64, cy: f64, cz: f64, hx: f64, hy: f64, hz: f64): f64 {
  let t = 1e30;
  if (dx > 0.000000001) { const tx = (cx + hx - ox) / dx; if (tx < t) t = tx; }
  else if (dx < -0.000000001) { const tx = (cx - hx - ox) / dx; if (tx < t) t = tx; }
  if (dy > 0.000000001) { const ty = (cy + hy - oy) / dy; if (ty < t) t = ty; }
  else if (dy < -0.000000001) { const ty = (cy - hy - oy) / dy; if (ty < t) t = ty; }
  if (dz > 0.000000001) { const tz = (cz + hz - oz) / dz; if (tz < t) t = tz; }
  else if (dz < -0.000000001) { const tz = (cz - hz - oz) / dz; if (tz < t) t = tz; }
  if (t < 0.0) t = 0.0;
  return t;
}

/// Raycast do tiro. O olho está DENTRO da própria caixa, e um raio que começa
/// dentro de um corpo acerta esse corpo a distância 0; então o raio parte do
/// ponto em que sai da caixa do atirador. `raioTiro` recebe [ox, oy, oz, dx, dy, dz].
export function fpsTiro(p: FpsPlayerState, yaw: f64, pitch: f64, sc: Scene, out: RaycastHit, raioTiro: f64[]): boolean {
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = Math.cos(yaw) * cp;
  const ex = p.x; const ey = p.y + FPS_ALTURA_OLHO; const ez = p.z;
  const tSai = fpsSaidaDaCaixa(ex, ey, ez, dx, dy, dz,
                               p.x, p.y + FPS_ALTURA_CORPO * 0.5, p.z,
                               FPS_MEIA_LARGURA_CAIXA, FPS_ALTURA_CORPO * 0.5, FPS_MEIA_LARGURA_CAIXA) + 0.001;
  raioTiro[0] = ex + dx * tSai;
  raioTiro[1] = ey + dy * tSai;
  raioTiro[2] = ez + dz * tSai;
  raioTiro[3] = dx; raioTiro[4] = dy; raioTiro[5] = dz;
  return fpsRaio(raioTiro[0], raioTiro[1], raioTiro[2], dx, dy, dz, FPS_ALCANCE - tSai, out,
                 FPS_CAMADA_MAPA | FPS_CAMADA_JOGADOR, sc);
}

export function fpsEhCabeca(alvo: FpsPlayerState, yImpacto: f64): boolean {
  return yImpacto >= alvo.y + FPS_FRACAO_CABECA * FPS_ALTURA_CORPO;
}

/// Um tick de granada: gravidade e quique contra o mapa (raycast no trecho).
export function fpsMoverGranada(pos: f64[], vel: f64[], dt: f64, sc: Scene, out: RaycastHit): void {
  vel[1] = vel[1] - FPS_GRAVIDADE * dt;
  const v = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
  if (v < 0.000001) return;
  const ux = vel[0] / v; const uy = vel[1] / v; const uz = vel[2] / v;
  const trecho = v * dt;
  if (fpsRaio(pos[0], pos[1], pos[2], ux, uy, uz, trecho + FPS_RAIO_GRANADA, out, FPS_CAMADA_MAPA, sc)) {
    const n0 = out.normal[0]; const n1 = out.normal[1]; const n2 = out.normal[2];
    // reposiciona pela NORMAL: em quique rasante, recuar ao longo do raio
    // deixaria o centro mais perto da superfície que o raio da granada
    pos[0] = out.point[0] + n0 * FPS_RAIO_GRANADA;
    pos[1] = out.point[1] + n1 * FPS_RAIO_GRANADA;
    pos[2] = out.point[2] + n2 * FPS_RAIO_GRANADA;
    const vn = vel[0] * n0 + vel[1] * n1 + vel[2] * n2;
    vel[0] = (vel[0] - 2.0 * vn * n0) * FPS_QUIQUE;
    vel[1] = (vel[1] - 2.0 * vn * n1) * FPS_QUIQUE;
    vel[2] = (vel[2] - 2.0 * vn * n2) * FPS_QUIQUE;
  } else {
    pos[0] = pos[0] + vel[0] * dt;
    pos[1] = pos[1] + vel[1] * dt;
    pos[2] = pos[2] + vel[2] * dt;
  }
}

/// Dano de uma explosão em (gx, gy, gz) sobre o alvo; 0 se estiver fora do
/// raio ou se houver mapa no caminho até o centro do corpo.
export function fpsDanoExplosao(gx: f64, gy: f64, gz: f64, alvo: FpsPlayerState, sc: Scene, out: RaycastHit): f64 {
  const dx = alvo.x - gx;
  const dy = alvo.y + FPS_ALTURA_CORPO * 0.5 - gy;
  const dz = alvo.z - gz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d >= FPS_RAIO_EXPLOSAO) return 0.0;
  if (d > 0.000001 && fpsRaio(gx, gy, gz, dx / d, dy / d, dz / d, d, out, FPS_CAMADA_MAPA, sc)) return 0.0;
  return FPS_DANO_GRANADA * (1.0 - d / FPS_RAIO_EXPLOSAO);
}
