// A aba Jogo desenha as câmeras dentro da área da vista, com faixas quando a
// proporção pedida não bate com a da área (letterbox/pillarbox).
import { VistasDeCamera, coletarCameras } from "@engine/render/camera_views";
import type { Camera } from "@engine/core/camera";
import type { Scene } from "@engine/core/scene";
/// area/out = [x, y, w, h] em pixels; razao = largura/altura (0 = livre).
export function areaComFaixas(area: Float64Array, razao: number, out: Float64Array): void {
  out[0] = area[0]; out[1] = area[1]; out[2] = area[2]; out[3] = area[3];
  if (razao > 0.0 && area[2] > 0.0 && area[3] > 0.0) {
    if (area[2] / area[3] > razao) { out[2] = area[3] * razao; out[0] = area[0] + (area[2] - out[2]) * 0.5; }
    else { out[3] = area[2] / razao; out[1] = area[1] + (area[3] - out[3]) * 0.5; }
  }
}

/// Prévia da câmera na vista de Cena: coleta `cam` em `v.area` guardando antes o
/// retângulo de runtime dela em `guarda` — `screenPointToRay`/`aspecto()` seguem
/// com o da aba Jogo. Chamar `restaurarPrevia` logo depois de `aplicarVistas`.
export function prepararPrevia(v: VistasDeCamera, sc: Scene, cam: Camera, guarda: Float64Array): number {
  const r = cam.retanguloPx();
  guarda[0] = r[0]; guarda[1] = r[1]; guarda[2] = r[2]; guarda[3] = r[3];
  return coletarCameras(v, sc, cam);
}
export function restaurarPrevia(v: VistasDeCamera, guarda: Float64Array): void {
  if (v.n > 0) v.cams[0].definirRetangulo(guarda[0], guarda[1], guarda[2], guarda[3]);
}
