// A aba Jogo desenha as câmeras dentro da área da vista, com faixas quando a
// proporção pedida não bate com a da área (letterbox/pillarbox).
/// area/out = [x, y, w, h] em pixels; razao = largura/altura (0 = livre).
export function areaComFaixas(area: Float64Array, razao: number, out: Float64Array): void {
  out[0] = area[0]; out[1] = area[1]; out[2] = area[2]; out[3] = area[3];
  if (razao > 0.0 && area[2] > 0.0 && area[3] > 0.0) {
    if (area[2] / area[3] > razao) { out[2] = area[3] * razao; out[0] = area[0] + (area[2] - out[2]) * 0.5; }
    else { out[3] = area[2] / razao; out[1] = area[1] + (area[3] - out[3]) * 0.5; }
  }
}
