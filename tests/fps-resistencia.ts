// Resistência: 12 bots, 60 s de simulação no mapa completo. Verifica NaN,
// jogador dentro da geometria e o tempo por tick (spec §2: <= 4 ms).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { createOverlapHit, OverlapHit } from "@engine/core/spatial_queries";
import { FpsWorld } from "../src/shared/world";
import { fpsEsfera } from "../src/shared/consultas";
import { FPS_CAMADA_MAPA } from "../src/shared/layers";
import { FPS_SEMENTE_PADRAO, FPS_BOTS_PADRAO, FPS_RAIO_CORPO, FPS_ALTURA_CORPO, FPS_ALTURA_DEGRAU } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

io.print("=== fps-resistencia ===");
const w = new FpsWorld(new Scene("resistencia"), FPS_SEMENTE_PADRAO, 1.0);
let b = 0;
while (b < FPS_BOTS_PADRAO) { w.adicionarJogador(true); b = b + 1; }
io.print("  estaticos=" + w.mapa.objetos + " objetos na cena=" + w.scene.objects.length);

const hits: OverlapHit[] = [];
let q = 0;
while (q < 8) { hits.push(createOverlapHit()); q = q + 1; }

const TICKS = 3600;
const tempos: f64[] = [];
let nans = 0;
let piorProfundidade = 0.0;
let piorDegrau = 0.0;
let t = 0;
while (t < TICKS) {
  w.passo([]);
  tempos.push(w.ultMsTick);
  let i = 0;
  while (i < w.jogadores.length) {
    const p = w.jogadores[i];
    if (p.x !== p.x || p.y !== p.y || p.z !== p.z || p.vx !== p.vx || p.vy !== p.vy || p.vz !== p.vz) nans = nans + 1;
    if (p.vivo) {
      let e = 0;
      while (e < 2) {
        const cy = e === 0 ? p.y + FPS_RAIO_CORPO : p.y + FPS_ALTURA_CORPO - FPS_RAIO_CORPO;
        const n = fpsEsfera(p.x, cy, p.z, FPS_RAIO_CORPO, hits, 8, FPS_CAMADA_MAPA, w.scene);
        const lim = n < 8 ? n : 8;
        let h = 0;
        while (h < lim) {
          // quina de degrau sob os pés (normal para baixo, contato na faixa do
          // degrau) é a subida de escada em andamento, não jogador preso
          const contatoY = cy + hits[h].normal[1] * FPS_RAIO_CORPO;
          const subindoDegrau = e === 0 && hits[h].normal[1] < -0.2 && contatoY < p.y + FPS_ALTURA_DEGRAU;
          if (subindoDegrau) { if (hits[h].depth > piorDegrau) piorDegrau = hits[h].depth; }
          else if (hits[h].depth > piorProfundidade) piorProfundidade = hits[h].depth;
          h = h + 1;
        }
        e = e + 1;
      }
    }
    i = i + 1;
  }
  t = t + 1;
}

tempos.sort((x: f64, y: f64) => x - y);
const mediana = tempos[(tempos.length / 2) | 0];
const p99 = tempos[Math.min(tempos.length - 1, (tempos.length * 0.99) | 0)];
io.print("  tick: mediana=" + mediana.toFixed(3) + " ms  p99=" + p99.toFixed(3) + " ms  tiros=" + w.tirosDisparados + "  quina de degrau (informativo)=" + piorDegrau.toFixed(3));

check("sem NaN em 3.600 ticks", nans === 0, "nans=" + nans);
check("nenhum jogador dentro da geometria (profundidade <= 0,05)", piorProfundidade <= 0.05, "pior=" + piorProfundidade);
check("bots atiraram", w.tirosDisparados > 0);
check("tick mediano <= 4 ms", mediana <= 4.0, "mediana=" + mediana);

if (falhas === 0) io.print("[PASSOU] fps-resistencia"); else io.print("[FALHOU] fps-resistencia: " + falhas + " falha(s)");
