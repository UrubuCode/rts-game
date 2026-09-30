// Testes do FpsWorld: jogadores, morte, renascimento e determinismo (humanos).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsInputVazio, FpsPlayerInput } from "../src/shared/input";
import { FPS_ALTURA_CORPO, FPS_TEMPO_RENASCER, FPS_TICK_DT } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function ehSpawn(w: FpsWorld, x: f64, z: f64): boolean {
  let i = 0;
  while (i < w.mapa.spawnX.length) {
    if (Math.abs(w.mapa.spawnX[i] - x) < 0.01 && Math.abs(w.mapa.spawnZ[i] - z) < 0.01) return true;
    i = i + 1;
  }
  return false;
}

function digital(w: FpsWorld): string {
  let s = "";
  let i = 0;
  while (i < w.jogadores.length) {
    const p = w.jogadores[i];
    s = s + p.x.toFixed(6) + "," + p.y.toFixed(6) + "," + p.z.toFixed(6) + "," + p.vida + "," + p.mortes + ";";
    i = i + 1;
  }
  return s;
}

function roteiro(w: FpsWorld, ticks: number): void {
  const inputs: FpsPlayerInput[] = [fpsInputVazio(), fpsInputVazio(), fpsInputVazio()];
  let semente = 42;
  let t = 0;
  while (t < ticks) {
    let k = 0;
    while (k < inputs.length) {
      semente = ((semente * 1664525 + 1013904223) | 0);
      const r = (semente >>> 0) / 4294967296.0;
      inputs[k].seq = t;
      inputs[k].frente = r < 0.7 ? 1 : 0;
      inputs[k].lado = r < 0.2 ? -1 : (r > 0.8 ? 1 : 0);
      inputs[k].pulo = r > 0.95;
      inputs[k].yaw = inputs[k].yaw + (r - 0.5) * 0.1;
      k = k + 1;
    }
    w.passo(inputs);
    t = t + 1;
  }
}

io.print("=== fps-world ===");

// 1. jogadores nascem em pontos de renascimento distintos
{
  const w = new FpsWorld(new Scene("w1"), 7, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(false);
  const a = w.jogadores[0]; const b = w.jogadores[1];
  check("jogadores nascem vivos em pontos de renascimento",
        a.vivo && b.vivo && ehSpawn(w, a.x, a.z) && ehSpawn(w, b.x, b.z));
  check("pontos de renascimento distintos", Math.abs(a.x - b.x) + Math.abs(a.z - b.z) > 1.0);
  w.passo([]);
  const c = w.corpos[0];
  check("o corpo acompanha o jogador", Math.abs(c.transform.wy - (a.y + FPS_ALTURA_CORPO * 0.5)) < 0.001,
        "wy=" + c.transform.wy + " y=" + a.y);
}

// 2. cair abaixo de Y_MORTE mata; renasce após FPS_TEMPO_RENASCER
{
  const w = new FpsWorld(new Scene("w2"), 8, 0.0);
  w.adicionarJogador(false);
  const p = w.jogadores[0];
  p.y = -60.0;
  w.passo([]);
  check("abaixo de Y_MORTE morre", !p.vivo && p.mortes === 1 && w.corpos[0].active === 0);
  const ticks = Math.ceil(FPS_TEMPO_RENASCER / FPS_TICK_DT) + 1;
  let t = 0;
  while (t < ticks) { w.passo([]); t = t + 1; }
  check("renasce depois do tempo", p.vivo && w.corpos[0].active === 1 && ehSpawn(w, p.x, p.z) && p.vida === 100.0);
}

// 3. remover bot tira o corpo da cena
{
  const w = new FpsWorld(new Scene("w3"), 9, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(true);
  const antes = w.scene.objects.length;
  check("remover o último bot", w.removerUltimoBot() && w.scene.objects.length === antes - 1 && w.jogadores.length === 1);
  check("não remove humano", !w.removerUltimoBot() && w.jogadores.length === 1);
}

// 4. determinismo com humanos roteirizados
{
  const w1 = new FpsWorld(new Scene("d1"), 11, 0.3);
  w1.adicionarJogador(false); w1.adicionarJogador(false); w1.adicionarJogador(false);
  roteiro(w1, 600);
  const w2 = new FpsWorld(new Scene("d2"), 11, 0.3);
  w2.adicionarJogador(false); w2.adicionarJogador(false); w2.adicionarJogador(false);
  roteiro(w2, 600);
  const d1 = digital(w1); const d2 = digital(w2);
  check("mesma semente e mesmos inputs dão o mesmo estado (600 ticks)", d1 === d2, d1 + " | " + d2);
}

// 5. vagas de jogador: liberar e ocupar de novo (para clientes de rede)
{
  const w = new FpsWorld(new Scene("vagas"), 21, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(false);
  w.liberarJogador(1);
  let t = 0;
  while (t < 300) { w.passo([]); t = t + 1; }
  check("vaga liberada fica fora do jogo e não renasce",
        !w.ocupado[1] && !w.jogadores[1].vivo && w.corpos[1].active === 0);
  const i = w.ocuparJogador(false);
  check("ocupar reaproveita a vaga livre e renasce", i === 1 && w.ocupado[1] && w.jogadores[1].vivo &&
        w.jogadores.length === 2);
  check("sem vaga livre, ocupar cria um jogador novo", w.ocuparJogador(true) === 2 && w.jogadores.length === 3);
}

if (falhas === 0) io.print("[PASSOU] fps-world"); else io.print("[FALHOU] fps-world: " + falhas + " falha(s)");
