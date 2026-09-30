// Invólucros das consultas espaciais: contam chamadas e tempo para o painel F3.
import { Scene } from "@engine/core/scene";
import { raycastNonAlloc, overlapSphereNonAlloc, RaycastHit, OverlapHit } from "@engine/core/spatial_queries";
import { FPS_CAMADA_JOGADOR } from "./layers";

export interface FpsStatsConsultas {
  raios: number;
  esferas: number;
  ms: f64;
}

export const fpsStats: FpsStatsConsultas = { raios: 0, esferas: 0, ms: 0.0 };

export function fpsZerarStats(): void {
  fpsStats.raios = 0;
  fpsStats.esferas = 0;
  fpsStats.ms = 0.0;
}

export function fpsRaio(ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, maxD: f64,
                        out: RaycastHit, mascara: number, sc: Scene): boolean {
  const t0 = performance.now();
  const r = raycastNonAlloc(ox, oy, oz, dx, dy, dz, maxD, out, mascara, FPS_CAMADA_JOGADOR, false, sc);
  fpsStats.ms = fpsStats.ms + (performance.now() - t0);
  fpsStats.raios = fpsStats.raios + 1;
  return r;
}

export function fpsEsfera(cx: f64, cy: f64, cz: f64, r: f64, out: OverlapHit[], max: number,
                          mascara: number, sc: Scene): number {
  const t0 = performance.now();
  const n = overlapSphereNonAlloc(cx, cy, cz, r, out, max, mascara, FPS_CAMADA_JOGADOR, false, sc);
  fpsStats.ms = fpsStats.ms + (performance.now() - t0);
  fpsStats.esferas = fpsStats.esferas + 1;
  return n;
}
