// Modelos 3D estáticos do cliente (não do servidor): as armas do pacote Kenney
// Blaster Kit (CC0, assets/kenney/LICENCA-Kenney-CC0.txt), em OBJ, carregadas
// uma vez por janela. Os personagens são .glb com ossos, animados por
// src/animacao.ts.
import { loadModel, SubMesh } from "@engine/render/model";
import { loadTexture, drawGPUMeshBuf, D_COR, D_EMISSIVO, D_TEX, D_TILE } from "@engine/render/gpu3d";
import io from "@compat/io.ts";

const FPS_ARMAS = ["a", "c", "e"];
export const FPS_ESCALA_ARMA_MAO: f64 = 1.0;
export const FPS_ESCALA_ARMA_TELA: f64 = 0.32;
/// O cano dos blasters Kenney aponta para -Z local: meia volta para a frente do jogador.
export const FPS_GIRO_ARMA: f64 = 3.141592653589793;

export class FpsModelo {
  malhas: number[] = [];
  texturas: number[] = [];
  cores: number[] = [];
}

export class FpsModelos {
  armas: FpsModelo[] = [];
  ambiente: FpsModelo[] = [];
  pronto: boolean = false;
}

export const fpsModelos = new FpsModelos();

function fpsCarregarModelo(win: number, caminho: string): FpsModelo {
  const m = new FpsModelo();
  const partes: SubMesh[] = loadModel(win, caminho);
  let i = 0;
  while (i < partes.length) {
    const p = partes[i];
    if (p.meshId > 0) {
      let tex = 0;
      if (p.texPath.length > 0) {
        try { tex = loadTexture(win, p.texPath); }
        catch (e) { io.print("[modelos] textura " + p.texPath + ": " + String(e)); }
      }
      m.malhas.push(p.meshId);
      m.texturas.push(tex);
      // com textura a cor multiplica: branco; sem textura, a cor do material
      m.cores.push(tex > 0 ? 0xFFFFFF : (((p.cr | 0) << 16) | ((p.cg | 0) << 8) | (p.cb | 0)));
    }
    i = i + 1;
  }
  return m;
}

/// Carrega tudo na primeira chamada (≈1,5 s: decodificar as texturas PNG);
/// modelos que faltarem ficam vazios e o jogo desenha as caixas de antes.
export function fpsCarregarModelos(win: number): void {
  if (fpsModelos.pronto) return;
  const t0 = performance.now();
  let i = 0;
  while (i < FPS_ARMAS.length) {
    fpsModelos.armas.push(fpsCarregarModelo(win, "assets/kenney/armas/blaster-" + FPS_ARMAS[i] + ".obj"));
    i = i + 1;
  }
  const ambiente = ["crate", "container", "tower", "streets"];
  i = 0;
  while (i < ambiente.length) {
    fpsModelos.ambiente.push(fpsCarregarModelo(win, "assets/environment/" + ambiente[i] + ".obj"));
    i = i + 1;
  }
  fpsModelos.pronto = true;
  io.print("[modelos] " + fpsModelos.armas.length + " armas em " + (performance.now() - t0).toFixed(0) + " ms");
}

/// Desenha as partes de um modelo com a mesma pose: `d` (DRAW_FLOATS) traz
/// posição, rotação e escala; cor e textura vêm de cada parte.
export function fpsDesenharModelo(win: number, m: FpsModelo, d: Float64Array): void {
  d[D_EMISSIVO] = 0; d[D_TILE] = 0.0;
  let i = 0;
  while (i < m.malhas.length) {
    d[D_COR] = m.cores[i]; d[D_TEX] = m.texturas[i];
    drawGPUMeshBuf(win, m.malhas[i], d);
    i = i + 1;
  }
}
