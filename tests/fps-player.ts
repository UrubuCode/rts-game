// Testes do movimento do jogador do FPS (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { setSpatialScene, spatialRebuildIndex, createOverlapHit, OverlapHit } from "@engine/core/spatial_queries";
import { fpsEsfera } from "../src/shared/consultas";
import { FPS_CAMADA_MAPA } from "../src/shared/layers";
import { fpsMapaCaixa } from "../src/shared/map";
import { fpsInputVazio, FpsPlayerInput, fpsAcumularBorda } from "../src/shared/input";
import { fpsNovoJogador, fpsSimulatePlayer, FpsPlayerState } from "../src/shared/player";
import { FPS_TICK_DT, FPS_RAIO_CORPO } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function cenaComChao(nome: string): Scene {
  const sc = new Scene(nome);
  fpsMapaCaixa(sc, "chao", 0.0, -0.5, 0.0, 100.0, 1.0, 100.0, 80, 80, 80);
  return sc;
}

function preparar(sc: Scene): void {
  sc.computeWorld();
  setSpatialScene(sc);
  spatialRebuildIndex(sc);
}

function rodar(p: FpsPlayerState, inp: FpsPlayerInput, ticks: number, sc: Scene): void {
  let t = 0;
  while (t < ticks) { fpsSimulatePlayer(p, inp, FPS_TICK_DT, sc); t = t + 1; }
}

io.print("=== fps-player ===");

// 1. cai e para no chão
{
  const sc = cenaComChao("cair");
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 3.0, 0.0);
  rodar(p, fpsInputVazio(), 120, sc);
  check("cai e para no chão", Math.abs(p.y) < 0.02 && p.noChao, "y=" + p.y + " noChao=" + p.noChao);
}

// 2. queda rápida não atravessa o chão
{
  const sc = cenaComChao("queda");
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 60.0, 0.0);
  rodar(p, fpsInputVazio(), 400, sc);
  check("queda de 60 u não atravessa o chão", Math.abs(p.y) < 0.02, "y=" + p.y);
}

// 3. andar contra parede não atravessa
{
  const sc = cenaComChao("parede");
  fpsMapaCaixa(sc, "parede", 5.0, 2.0, 0.0, 1.0, 4.0, 10.0, 100, 100, 100);
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.5;   // olhando para +X
  rodar(p, inp, 300, sc);
  check("andar 5 s contra parede não atravessa", p.x <= 4.5 - FPS_RAIO_CORPO + 0.02, "x=" + p.x);
}

// 4. desliza ao longo da parede
{
  const sc = cenaComChao("desliza");
  fpsMapaCaixa(sc, "parede", 5.0, 2.0, 0.0, 1.0, 4.0, 60.0, 100, 100, 100);   // longa: o jogador não chega à ponta
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.25;  // diagonal +X +Z
  rodar(p, inp, 300, sc);
  check("desliza pela parede em vez de travar", p.z > 5.0 && p.x <= 4.5 - FPS_RAIO_CORPO + 0.02, "x=" + p.x + " z=" + p.z);
}

// 5. sobe degrau de 0,3
{
  const sc = cenaComChao("degrau_baixo");
  fpsMapaCaixa(sc, "degrau", 12.0, 0.15, 0.0, 20.0, 0.3, 4.0, 100, 100, 100);  // de x=2 a x=22
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  rodar(p, fpsInputVazio(), 30, sc);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.5;
  rodar(p, inp, 90, sc);
  check("sobe degrau de 0,3", Math.abs(p.y - 0.3) < 0.05 && p.x > 3.0, "x=" + p.x + " y=" + p.y);
}

// 6. não sobe degrau de 0,6
{
  const sc = cenaComChao("degrau_alto");
  fpsMapaCaixa(sc, "degrau", 12.0, 0.3, 0.0, 20.0, 0.6, 4.0, 100, 100, 100);   // de x=2 a x=22
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  rodar(p, fpsInputVazio(), 30, sc);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.5;
  rodar(p, inp, 90, sc);
  check("não sobe degrau de 0,6", p.y < 0.05 && p.x < 2.0, "x=" + p.x + " y=" + p.y);
}

// 7. pulo só no chão
{
  const sc = cenaComChao("pulo");
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  rodar(p, fpsInputVazio(), 30, sc);
  const pula = fpsInputVazio();
  pula.pulo = true;
  fpsSimulatePlayer(p, pula, FPS_TICK_DT, sc);
  rodar(p, fpsInputVazio(), 9, sc);
  const vyAntes = p.vy;
  fpsSimulatePlayer(p, pula, FPS_TICK_DT, sc);   // pulo no ar não pode dar impulso
  check("pulo sai do chão", p.y > 0.3, "y=" + p.y);
  check("pulo no ar não dá novo impulso", p.vy < vyAntes, "vyAntes=" + vyAntes + " vy=" + p.vy);
}

// 8. canto muro + caixote a 0,69 u (geometria do fps-resistencia): não penetra.
//    Cobertura extra: este caminho de entrada não reproduz o aperto; a regressão
//    é provada pelo próprio fps-resistencia.
{
  const sc = cenaComChao("fresta");
  // geometria real achada pelo fps-resistencia (semente padrão): um caixote
  // gerado a 0,69 u de um muro, menos que os 0,8 u do corpo
  fpsMapaCaixa(sc, "muro", -40.0, 0.6, -65.0, 6.0, 1.2, 0.4, 100, 100, 100);
  fpsMapaCaixa(sc, "caixote", -36.707, 0.653, -66.545, 1.305, 1.305, 1.305, 100, 100, 100);
  preparar(sc);
  const p = fpsNovoJogador(0, -39.0, 0.0, -65.6);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.5;   // anda +X, direto para dentro da fresta
  const hits: OverlapHit[] = [];
  let q = 0; while (q < 8) { hits.push(createOverlapHit()); q = q + 1; }
  let pior = 0.0;
  let t = 0;
  while (t < 120) {
    fpsSimulatePlayer(p, inp, FPS_TICK_DT, sc);
    let e = 0;
    while (e < 2) {
      const cy = e === 0 ? p.y + FPS_RAIO_CORPO : p.y + 1.4;
      const n = fpsEsfera(p.x, cy, p.z, FPS_RAIO_CORPO, hits, 8, FPS_CAMADA_MAPA, sc);
      let h = 0; while (h < n && h < 8) { if (hits[h].depth > pior) pior = hits[h].depth; h = h + 1; }
      e = e + 1;
    }
    t = t + 1;
  }
  check("canto apertado muro + caixote: não penetra", pior <= 0.02, "pior=" + pior + " x=" + p.x);
}

// 9. borda de tecla (G, R) sobrevive a frames sem tick até ser consumida
{
  let g = false;
  g = fpsAcumularBorda(g, true);    // frame 1: apertou, não houve tick
  g = fpsAcumularBorda(g, false);   // frame 2: tecla já solta
  check("borda de tecla acumulada até o tick consumir", g === true);
}

if (falhas === 0) io.print("[PASSOU] fps-player"); else io.print("[FALHOU] fps-player: " + falhas + " falha(s)");
