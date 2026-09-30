// Personagens animados (Task 9): escolha do clipe pela velocidade, morte uma
// vez só, tiro no braço e passo sincronizado com o chão (decisão 9: o pé de
// apoio não escorrega) e controlador ausente. Sem janela: o .glb carrega sem
// subir peças. O custo por quadro fica em bench/fps-animacao-bench.ts.
import io from "@compat/io.ts";
import { FpsAnimacao, fpsPeZ, FPS_VEL_PARADO } from "../src/animacao";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome + (detalhe !== undefined ? " (" + detalhe + ")" : "")); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

const DT: f64 = 1.0 / 60.0;
const anim = new FpsAnimacao();
check("controlador e modelo carregam", anim.erro === "", anim.erro);
io.print("  limiares " + anim.limiares[0] + "/" + anim.limiares[1] + "/" + anim.limiares[2] +
         " | passada (u/ciclo) " + anim.passada[0].toFixed(3) + "/" + anim.passada[1].toFixed(3) + "/" + anim.passada[2].toFixed(3) +
         " | duracao " + anim.duracao[0].toFixed(3) + "/" + anim.duracao[1].toFixed(3) + "/" + anim.duracao[2].toFixed(3));
const natWalk = anim.velocidadeNatural(anim.limiares[1]);
const natSprint = anim.velocidadeNatural(anim.limiares[2]);
io.print("  velocidade natural: walk " + natWalk.toFixed(3) + " u/s, sprint " + natSprint.toFixed(3) + " u/s");
check("idle nao anda (passada 0)", anim.passada[0] === 0.0, "" + anim.passada[0]);
check("walk e sprint tem passada medida (> 0)", anim.passada[1] > 0.0 && anim.passada[2] > anim.passada[1],
      anim.passada[1].toFixed(3) + " < " + anim.passada[2].toFixed(3));

anim.garantir(8);
const pe = anim.sks[0].boneIndex("leg-left");

/// Maior |x| do quaternion LOCAL da perna esquerda em `quadros` quadros com a vaga `j` a `v` u/s.
function amplitudePerna(j: number, v: f64, quadros: number): f64 {
  anim.visivel[j] = 1; anim.vivo[j] = 1; anim.vel[j] = v;
  let maxQ: f64 = 0.0;
  let f = 0;
  while (f < quadros) {
    anim.passo(j + 1, DT);
    const q = Math.abs(anim.sks[j].poseR[pe * 4]);
    if (f > 30 && q > maxQ) maxQ = q;   // depois do começo da mistura
    f = f + 1;
  }
  return maxQ;
}

// amplitude de referência de cada clipe puro: walk ±60° (x = 0,5), sprint ±86,5° (x = 0,685)
const aIdle = amplitudePerna(0, 0.0, 180);
check("velocidade 0 -> idle (pernas paradas)", aIdle < 0.01, "max |q.x| = " + aIdle.toFixed(4));
check("velocidade 0 -> estado Locomocao, taxa 1", anim.ans[0].stateName(0) === "Locomocao" && anim.taxa[0] === 1.0,
      anim.ans[0].stateName(0) + " taxa " + anim.taxa[0]);
const aWalk = amplitudePerna(1, 4.0, 240);
check("4 u/s -> walk (amplitude do walk puro)", Math.abs(aWalk - 0.5) < 0.01, "max |q.x| = " + aWalk.toFixed(4));
const aSprint = amplitudePerna(2, 8.0, 240);
check("8 u/s -> sprint (amplitude do sprint puro)", Math.abs(aSprint - 0.685) < 0.01, "max |q.x| = " + aSprint.toFixed(4));
check("abaixo de " + FPS_VEL_PARADO + " u/s conta como parado", anim.taxaDoPasso(FPS_VEL_PARADO * 0.5) === 1.0);

// ── morte: die uma vez, sem laço; renascer volta à locomoção ────────────────
{
  const j = 3;
  amplitudePerna(j, 4.0, 60);
  anim.vivo[j] = 0;
  let entradas = 0;
  let antes = anim.ans[j].stateName(0);
  let tAnt: f64 = 0.0 - 1.0;
  let monotono = true;
  let f = 0;
  const pose2s = new Float64Array(anim.sks[j].poseR.length);
  while (f < 240) {
    anim.passo(j + 1, DT);
    const agora = anim.ans[j].stateName(0);
    if (agora === "Morto" && antes !== "Morto") entradas = entradas + 1;
    if (agora === "Morto") {
      const t = anim.ans[j].stateTime(0);
      if (t < tAnt) monotono = false;
      tAnt = t;
    }
    antes = agora;
    if (f === 120) pose2s.set(anim.sks[j].poseR);
    f = f + 1;
  }
  check("morto -> estado Morto (die)", antes === "Morto", antes);
  check("die entra uma vez so em 4 s", entradas === 1, "entradas " + entradas);
  check("die nao repete (tempo so cresce)", monotono, "t final " + tAnt.toFixed(2));
  let igual = true;
  let k = 0;
  while (k < pose2s.length) { if (Math.abs(pose2s[k] - anim.sks[j].poseR[k]) > 1e-9) igual = false; k = k + 1; }
  check("die para no ultimo quadro (pose de 2 s = pose de 4 s)", igual);
  check("morto: taxa 1", anim.taxa[j] === 1.0, "" + anim.taxa[j]);
  anim.vivo[j] = 1;
  f = 0;
  while (f < 30) { anim.passo(j + 1, DT); f = f + 1; }
  check("renasceu -> volta para Locomocao", anim.ans[j].stateName(0) === "Locomocao", anim.ans[j].stateName(0));
}

// ── tiro: camada do braço toca holding-right-shoot e volta ─────────────────
{
  const j = 4;
  amplitudePerna(j, 0.0, 10);
  check("braco segurando a arma", anim.ans[j].stateName(1) === "Segurando", anim.ans[j].stateName(1));
  anim.disparos[j] = anim.disparos[j] + 1;
  anim.passo(j + 1, DT);
  check("tiro -> Atirando", anim.ans[j].stateName(1) === "Atirando", anim.ans[j].stateName(1));
  let f = 0;
  while (f < 30) { anim.passo(j + 1, DT); f = f + 1; }
  check("depois do tiro volta a Segurando", anim.ans[j].stateName(1) === "Segurando", anim.ans[j].stateName(1));
}

// ── passo sincronizado com o chão ───────────────────────────────────────────
// O corpo anda a v u/s em +Z; o pé de apoio (o que recua em relação ao corpo)
// anda v·dt + dz_local no mundo. Escorregar = soma disso / distância andada.
// Com a taxa, ~0; sem a taxa (dt puro), o pé escorrega na diferença entre v e
// a velocidade natural da mistura.
function escorregar(j: number, v: f64, sincronizar: boolean): f64 {
  const an = anim.ans[j];
  const sk = anim.sks[j];
  const pd = sk.boneIndex("leg-right");
  anim.visivel[j] = 1; anim.vivo[j] = 1; anim.vel[j] = v;
  let zeAnt: f64 = 0.0; let zdAnt: f64 = 0.0;
  let desliza: f64 = 0.0; let andou: f64 = 0.0;
  let f = 0;
  while (f < 300) {
    if (sincronizar) anim.passo(j + 1, DT);
    else { an.setFloat("velocidade", v); an.update(DT); }
    sk.host.wry = 0.0;
    sk.composeAt(0.0, 0.0, 0.0);
    const ze = fpsPeZ(sk, pe); const zd = fpsPeZ(sk, pd);
    if (f > 60) {   // depois da mistura assentar
      const dmin = Math.min(ze - zeAnt, zd - zdAnt);
      desliza = desliza + (v * DT + dmin);
      andou = andou + v * DT;
    }
    zeAnt = ze; zdAnt = zd;
    f = f + 1;
  }
  return desliza / andou;
}

const velocidades: f64[] = [2.0, 4.0, 6.0, 8.0];
let vi = 0;
while (vi < velocidades.length) {
  const v = velocidades[vi];
  const com = escorregar(5, v, true);
  io.print("  v=" + v + " u/s: taxa " + anim.taxaDoPasso(v).toFixed(3) + ", escorregar com taxa " + (com * 100.0).toFixed(1) + "%");
  check("v=" + v + ": pe de apoio parado no chao (|escorregar| < 3%)", Math.abs(com) < 0.03, (com * 100.0).toFixed(2) + "%");
  vi = vi + 1;
}
const sem = escorregar(6, 6.0, false);
check("controle: sem a taxa o pe escorrega a 6 u/s (|escorregar| > 10%)", Math.abs(sem) > 0.10, (sem * 100.0).toFixed(1) + "%");
check("taxa = velocidade / velocidade natural (4 u/s = walk puro)",
      Math.abs(anim.taxaDoPasso(4.0) - 4.0 / natWalk) < 1e-9, anim.taxaDoPasso(4.0).toFixed(4));

// ── controlador que não carrega: as vagas não animam, nada lança ────────────
{
  const ruim = new FpsAnimacao("assets/animators/nao-existe.controller.json");
  check("controlador ausente: erro relatado", ruim.erro !== "", ruim.erro);
  ruim.garantir(2);
  ruim.visivel[0] = 1; ruim.vivo[0] = 1; ruim.vel[0] = 4.0; ruim.disparos[0] = 3;
  let f = 0;
  while (f < 10) { ruim.passo(2, DT); f = f + 1; }
  check("controlador ausente: passo nao anima (taxa nao escrita)", ruim.taxa[0] === 0.0, "" + ruim.taxa[0]);
}

// O custo (17 jogadores <= 0,7 ms/quadro) é medido em bench/fps-animacao-bench.ts.

if (falhas === 0) io.print("[PASSOU] fps-animacao");
else io.print("[FALHOU] fps-animacao: " + falhas + " falha(s)");
