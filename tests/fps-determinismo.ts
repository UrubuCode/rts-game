// Determinismo com bots e casos de borda do mundo (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsInputVazio, FpsPlayerInput } from "../src/shared/input";
import { FPS_TICK_DT } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function digital(w: FpsWorld): string {
  let s = "";
  let i = 0;
  while (i < w.jogadores.length) {
    const p = w.jogadores[i];
    s = s + p.x.toFixed(6) + "," + p.y.toFixed(6) + "," + p.z.toFixed(6) + "," + p.vida.toFixed(3) + "," +
        p.abates + "," + p.mortes + "," + p.municao + ";";
    i = i + 1;
  }
  return s;
}

function partida(nome: string): FpsWorld {
  const w = new FpsWorld(new Scene(nome), 31, 0.3);
  w.adicionarJogador(false);
  let b = 0;
  while (b < 8) { w.adicionarJogador(true); b = b + 1; }
  w.x0 = []; w.z0 = [];
  let j0 = 0;
  while (j0 < w.jogadores.length) { w.x0.push(w.jogadores[j0].x); w.z0.push(w.jogadores[j0].z); j0 = j0 + 1; }
  const inputs: FpsPlayerInput[] = [fpsInputVazio()];
  let t = 0;
  while (t < 600) {
    inputs[0].seq = t;
    inputs[0].frente = (t % 120) < 60 ? 1 : 0;
    inputs[0].yaw = t * 0.01;
    inputs[0].atirar = (t % 30) === 0;
    w.passo(inputs);
    t = t + 1;
  }
  return w;
}

io.print("=== fps-determinismo ===");

{
  const a = partida("det_a");
  const b = partida("det_b");
  check("com 8 bots: mesma semente e mesmos inputs dão o mesmo estado", digital(a) === digital(b));
  let andou = 0.0;
  let i = 1;
  while (i < a.jogadores.length) {
    andou = andou + Math.abs(a.jogadores[i].x - a.x0[i]) + Math.abs(a.jogadores[i].z - a.z0[i]);
    i = i + 1;
  }
  check("bots se movem", andou > 10.0, "soma=" + andou);
}

// remover um bot com granada no ar não quebra nem credita abate inexistente
{
  const w = new FpsWorld(new Scene("granada_orfa"), 32, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(true);
  const k = w.lancarGranada(1);
  w.removerUltimoBot();
  w.grTempo[k] = FPS_TICK_DT * 0.5;
  w.passo([]);
  check("granada de bot removido explode sem erro", !w.grAtiva[k] && w.jogadores.length === 1 && w.jogadores[0].abates === 0);
}

// todos os renascimentos ocupados: ninguém fica preso morto
{
  const w = new FpsWorld(new Scene("lotado"), 33, 0.0);
  let j = 0;
  while (j < 70) { w.adicionarJogador(false); j = j + 1; }   // humanos parados: bots se matariam amontoados
  let t = 0;
  while (t < 30) { w.passo([]); t = t + 1; }
  let vivos = 0;
  j = 0;
  while (j < w.jogadores.length) { if (w.jogadores[j].vivo) vivos = vivos + 1; j = j + 1; }
  check("70 jogadores para 64 renascimentos: todos nascem", vivos === 70, "vivos=" + vivos);
}

if (falhas === 0) io.print("[PASSOU] fps-determinismo"); else io.print("[FALHOU] fps-determinismo: " + falhas + " falha(s)");
