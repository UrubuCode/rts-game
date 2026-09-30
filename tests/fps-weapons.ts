// Testes das armas do FPS (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsMapaCaixa } from "../src/shared/map";
import { fpsInputVazio } from "../src/shared/input";
import { FPS_ALTURA_OLHO, FPS_PENTE, FPS_TEMPO_RECARGA, FPS_TICK_DT } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

/// Mundo vazio com atirador (0) em (0,0,0) e alvo (1) em (10,0,0).
function duelo(nome: string, comParede: boolean): FpsWorld {
  const w = new FpsWorld(new Scene(nome), 5, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(false);
  if (comParede) fpsMapaCaixa(w.scene, "parede", 5.0, 2.0, 0.0, 0.5, 4.0, 4.0, 100, 100, 100);
  const a = w.jogadores[0]; const b = w.jogadores[1];
  a.x = 0.0; a.y = 0.0; a.z = 0.0;
  b.x = 10.0; b.y = 0.0; b.z = 0.0;
  w.sincronizarCorpos();
  return w;
}

function mirar(w: FpsWorld, i: number, alvoY: f64): void {
  const p = w.jogadores[i];
  p.yaw = Math.PI * 0.5;
  p.pitch = Math.atan2(alvoY - (p.y + FPS_ALTURA_OLHO), 10.0);
}

io.print("=== fps-weapons ===");

// 1. o tiro nunca acerta o próprio atirador, em nenhuma direção
{
  const w = duelo("auto", false);
  const a = w.jogadores[0];
  let acertouASiMesmo = 0;
  const pitches: f64[] = [-Math.PI * 0.5, -1.4, -0.7, 0.0, 0.7, 1.4];
  let pi = 0;
  while (pi < pitches.length) {
    let k = 0;
    while (k < 8) {
      a.yaw = k * Math.PI * 0.25;
      a.pitch = pitches[pi];
      if (w.disparar(0, 0.0) !== -2 && w.raio.bodyId === w.corpos[0].id) acertouASiMesmo = acertouASiMesmo + 1;
      k = k + 1;
    }
    pi = pi + 1;
  }
  check("tiro nunca acerta o próprio atirador (48 direções, inclusive reto para baixo)",
        acertouASiMesmo === 0 && a.vida === 100.0, "vezes=" + acertouASiMesmo);
}

// 2. acerta o corpo: dano normal
{
  const w = duelo("corpo", false);
  mirar(w, 0, 0.9);
  const r = w.disparar(0, 0.0);
  check("tiro no corpo acerta e tira 25", r === 1 && w.jogadores[1].vida === 75.0, "r=" + r + " vida=" + w.jogadores[1].vida);
}

// 3. cabeça dobra o dano
{
  const w = duelo("cabeca", false);
  mirar(w, 0, 1.7);
  const r = w.disparar(0, 0.0);
  check("tiro na cabeça tira 50", r === 1 && w.jogadores[1].vida === 50.0, "r=" + r + " vida=" + w.jogadores[1].vida);
}

// 4. parede bloqueia
{
  const w = duelo("parede", true);
  mirar(w, 0, 0.9);
  const r = w.disparar(0, 0.0);
  check("parede bloqueia o tiro", r === -1 && w.jogadores[1].vida === 100.0, "r=" + r);
}

// 5. cadência, pente e recarga automática
{
  const w = duelo("cadencia", false);
  const a = w.jogadores[0];
  a.yaw = 0.0; a.pitch = 0.0;   // atira para +Z, longe do alvo
  const inp = fpsInputVazio();
  inp.atirar = true;
  let t = 0;
  while (t < 60) { w.processarArmas(0, inp); t = t + 1; }
  const gastos = FPS_PENTE - a.municao;
  check("cadência de ~10 tiros por segundo", gastos >= 9 && gastos <= 11, "tiros=" + gastos);
  while (a.municao > 0) { w.processarArmas(0, inp); t = t + 1; }
  const ticksRecarga = Math.ceil(FPS_TEMPO_RECARGA / FPS_TICK_DT) + 2;
  let r = 0;
  while (r < ticksRecarga) { w.processarArmas(0, fpsInputVazio()); r = r + 1; }
  check("pente vazio recarrega sozinho", a.municao === FPS_PENTE, "municao=" + a.municao);
}

// ── granadas ───────────────────────────────────────────────────────────────

function trio(nome: string, comParede: boolean): FpsWorld {
  const w = new FpsWorld(new Scene(nome), 6, 0.0);
  w.adicionarJogador(false); w.adicionarJogador(false); w.adicionarJogador(false);
  if (comParede) fpsMapaCaixa(w.scene, "parede", 1.0, 1.5, 0.0, 0.3, 3.0, 3.0, 100, 100, 100);
  const a = w.jogadores[0]; const b = w.jogadores[1]; const c = w.jogadores[2];
  a.x = 2.0; a.y = 0.0; a.z = 0.0;
  b.x = 4.0; b.y = 0.0; b.z = 0.0;
  c.x = 100.0; c.y = 0.0; c.z = 100.0;
  w.sincronizarCorpos();
  return w;
}

// 6. dano decrescente com a distância
{
  const w = trio("explosao", false);
  const k = w.criarGranada(0.0, 0.3, 0.0, 0.0, 0.0, 0.0, -1);
  w.grTempo[k] = FPS_TICK_DT * 0.5;
  w.passo([]);
  const va = w.jogadores[0].vida; const vb = w.jogadores[1].vida; const vc = w.jogadores[2].vida;
  check("granada: dano decrescente com a distância", va < vb && vb < 100.0 && vc === 100.0,
        "a=" + va + " b=" + vb + " c=" + vc);
  check("granada: explodiu e voltou ao pool", !w.grAtiva[k] && w.grCorpo[k].active === 0);
}

// 7. parede protege
{
  const w = trio("protegido", true);
  const k = w.criarGranada(0.0, 0.3, 0.0, 0.0, 0.0, 0.0, -1);
  w.grTempo[k] = FPS_TICK_DT * 0.5;
  w.passo([]);
  check("granada: parede protege quem está atrás", w.jogadores[0].vida === 100.0 && w.jogadores[1].vida === 100.0,
        "a=" + w.jogadores[0].vida + " b=" + w.jogadores[1].vida);
}

// 8. quica no chão e não atravessa
{
  const w = trio("quique", false);
  const k = w.criarGranada(-20.0, 5.0, 0.0, 3.0, -10.0, 0.0, -1);
  let menorY = 1e30;
  let t = 0;
  while (t < 120) {
    w.grTempo[k] = 10.0;
    w.passo([]);
    if (w.grY[k] < menorY) menorY = w.grY[k];
    t = t + 1;
  }
  check("granada quica e não atravessa o chão", menorY >= 0.13 && w.grY[k] < 0.5, "menorY=" + menorY + " y=" + w.grY[k]);
}

// 9. pool limitado, sem crescer a cena
{
  const w = trio("pool", false);
  const antes = w.scene.objects.length;
  let recusadas = 0;
  let g = 0;
  while (g < 40) { if (w.criarGranada(-50.0, 1.0, -50.0, 0.0, 0.0, 0.0, -1) < 0) recusadas = recusadas + 1; g = g + 1; }
  check("pool de granadas limitado e sem crescer a cena", recusadas === 8 && w.scene.objects.length === antes,
        "recusadas=" + recusadas);
}

// 10. limite por jogador e tempo entre granadas
{
  const w = trio("limite", false);
  const inp = fpsInputVazio();
  inp.granada = true;
  let t = 0;
  while (t < 10) { w.processarArmas(0, inp); t = t + 1; }
  check("uma granada por vez dentro do tempo de recarga", w.jogadores[0].granadasVivas === 1);
  while (t < 10 + 200) { w.processarArmas(0, inp); t = t + 1; }
  check("nunca mais que duas vivas", w.jogadores[0].granadasVivas === 2);
}


// 11. atirar em movimento pelo passo real: o raio não pode ser absorvido pela
//     caixa do atirador que ficou na posição do tick anterior no índice
function atirarAndando(nome: string, frente: number, lado: number, yaw: f64): f64 {
  const w = new FpsWorld(new Scene(nome), 12, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(false);
  const a = w.jogadores[0]; const b = w.jogadores[1];
  a.x = 0.0; a.y = 0.0; a.z = 0.0;
  b.x = Math.sin(yaw) * 30.0; b.y = 0.0; b.z = Math.cos(yaw) * 30.0;
  w.sincronizarCorpos();
  const inp = fpsInputVazio();
  inp.frente = frente; inp.lado = lado; inp.yaw = yaw;
  inp.pitch = Math.atan2(0.9 - FPS_ALTURA_OLHO, 30.0);
  inp.atirar = true;
  const nada = fpsInputVazio();
  let t = 0;
  while (t < 20) { w.passo([inp, nada]); t = t + 1; }
  return b.vida;
}
{
  const re = atirarAndando("re", -1, 0, Math.PI * 0.5);
  check("atirar andando de ré acerta o alvo", re < 100.0, "vida alvo=" + re);
  const diag = atirarAndando("diag", 0, 1, Math.PI / 3.0);
  check("atirar em strafe diagonal (direita) acerta o alvo", diag < 100.0, "vida alvo=" + diag);
  const diag2 = atirarAndando("diag2", 0, -1, Math.PI / 3.0);
  check("atirar em strafe diagonal (esquerda) acerta o alvo", diag2 < 100.0, "vida alvo=" + diag2);
}

// 12. granada de bot removido não credita o bot que entra no mesmo índice
{
  const w = new FpsWorld(new Scene("indice_reusado"), 13, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(true);
  const k = w.lancarGranada(1);
  w.removerUltimoBot();
  w.adicionarJogador(true);
  check("granada órfã perde o dono ao remover o bot", w.grDono[k] === -1 && w.jogadores[1].granadasVivas === 0,
        "dono=" + w.grDono[k] + " vivasNovo=" + w.jogadores[1].granadasVivas);
}

if (falhas === 0) io.print("[PASSOU] fps-weapons"); else io.print("[FALHOU] fps-weapons: " + falhas + " falha(s)");
