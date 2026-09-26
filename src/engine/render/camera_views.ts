// Várias câmeras por frame: cada câmera ativa desenha a cena na sua viewport,
// em ordem de profundidade (a maior por cima, a Main por último no empate). O
// mesmo código serve ao jogo exportado (game.ts), à aba Jogo e à prévia do editor.
import { Camera, ordenarCameras } from "../core/camera";
import { activeInScene } from "../core/gameobject";
import type { Scene } from "../core/scene";
import math from "@compat/math.ts";
import { setViewportBuf, setCamBuf, setFundoCor, setFundoCeu, CAM_FLOATS } from "./gpu3d";

export const MAX_VISTAS: number = 8;

export class VistasDeCamera {
  cams: Camera[];
  n: number;
  /// Área de destino em pixels da janela: x, y, w, h.
  area: Float64Array;
  /// Tamanho da janela em pixels: largura, altura.
  tela: Float64Array;
  camBuf: Float64Array;
  vpBuf: Float64Array;
  constructor() {
    this.cams = []; this.n = 0;
    this.area = new Float64Array(4); this.tela = new Float64Array(2);
    this.camBuf = new Float64Array(CAM_FLOATS); this.vpBuf = new Float64Array(5);
  }
}

/// Coleta as câmeras ativas (ou só `so`, ocupando a área inteira), ordena e
/// calcula o retângulo de cada uma. Devolve quantas.
export function coletarCameras(v: VistasDeCamera, sc: Scene, so: Camera | null): number {
  v.n = 0;
  const lista = sc.camObjs;
  let i = 0;
  while (i < lista.length && v.n < MAX_VISTAS) {
    const o = lista[i];
    const c = o.behaviors[o.camIdx] as Camera;
    if (c.enabled !== 0 && activeInScene(sc.objects, o) && (so === null || so === c)) {
      if (v.cams.length <= v.n) v.cams.push(c); else v.cams[v.n] = c;
      v.n = v.n + 1;
    }
    i = i + 1;
  }
  ordenarCameras(v.cams, v.n);
  const a = v.area;
  let k = 0;
  while (k < v.n) {
    const c = v.cams[k];
    if (so !== null) c.definirRetangulo(a[0], a[1], a[2], a[3]);
    else c.definirRetangulo(a[0] + c.viewportX * a[2], a[1] + c.viewportY * a[3], c.viewportW * a[2], c.viewportH * a[3]);
    k = k + 1;
  }
  return v.n;
}

/// Uma vista por câmera: viewport, fundo e câmera. Chamar antes dos desenhos.
export function aplicarVistas(win: number, v: VistasDeCamera): void {
  let k = 0;
  while (k < v.n) {
    const c = v.cams[k];
    const r = c.retanguloPx();
    v.vpBuf[0] = r[0] / v.tela[0]; v.vpBuf[1] = r[1] / v.tela[1];
    v.vpBuf[2] = r[2] / v.tela[0]; v.vpBuf[3] = r[3] / v.tela[1];
    v.vpBuf[4] = c.fundo === "nada" ? 0.0 : 1.0;
    setViewportBuf(win, v.vpBuf);
    if (c.fundo === "cor") setFundoCor(win, c.corFundo);
    else if (c.fundo === "ceu") setFundoCeu(win);
    c.parametrosDeRender(v.camBuf);
    setCamBuf(win, v.camBuf);
    k = k + 1;
  }
}

/// Os 9 números de frustum de `drawSceneObjects`. Com mais de uma vista (ou
/// uma ortográfica), tanH = -1: o laço não descarta ninguém — a fila de
/// desenho é uma só para todas as vistas.
export function frustumDasVistas(v: VistasDeCamera, out: f64[]): void {
  if (v.n === 1 && !v.cams[0].ortografica) {
    const c = v.cams[0];
    c.parametrosDeRender(v.camBuf);
    const b = v.camBuf;
    out[0] = b[0]; out[1] = b[1]; out[2] = b[2];
    out[3] = math.cos(b[3]); out[4] = math.sin(b[3]); out[5] = math.cos(b[4]); out[6] = math.sin(b[4]);
    out[8] = math.tan(b[5] * 0.5); out[7] = out[8] * b[6];
  } else {
    out[7] = 0.0 - 1.0; out[8] = 0.0 - 1.0;
  }
}

/// Posição [x, y, z] da câmera de cima (a última desenhada): ordena as luzes.
export function posicaoDaVista(v: VistasDeCamera, out: Float64Array): void {
  if (v.n > 0) { const t = v.cams[v.n - 1].host; out[0] = t.wx; out[1] = t.wy; out[2] = t.wz; }
}
