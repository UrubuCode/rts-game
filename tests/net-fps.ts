// FPS em rede sem janela: servidor + 16 clientes em memória. Critérios 2, 4, 5
// e 6 da spec do subprojeto A.
import io from "@compat/io.ts";
import { NetRedeMemoria } from "../src/net/transport";
import { NetWriter, NetReader } from "../src/net/buffer";
import { netEscreverCabecalho } from "../src/net/protocol";
import { NET_PKT_CONECTAR, NET_PKT_DESCONECTAR } from "../src/net/config";
import { FpsServidorJogo } from "../src/servidor_jogo";
import { FpsClienteRede } from "../src/cliente_rede";
import { FpsPlayerInput, fpsInputVazio, fpsEscreverInput, fpsLerInput, FPS_TAM_INPUT_REDE } from "../src/shared/input";
import { FPS_TICK_DT, FPS_ALTURA_CORPO, FPS_MAX_CLIENTES } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

io.print("=== net-fps ===");

// input em 7 bytes, ida e volta
{
  const a = fpsInputVazio();
  a.frente = -1; a.lado = 1; a.pulo = true; a.atirar = true; a.granada = true; a.yaw = 2.5; a.pitch = -0.7;
  const w = new NetWriter(16);
  fpsEscreverInput(w, a);
  const r = new NetReader(16);
  r.abrir(w.buf, 0, w.pos);
  const b = fpsInputVazio();
  fpsLerInput(r, b);
  check("input em 7 bytes, ida e volta", w.pos === FPS_TAM_INPUT_REDE && b.frente === -1 && b.lado === 1 &&
        b.pulo && b.atirar && !b.recarregar && b.granada && Math.abs(b.yaw - 2.5) < 0.0002 &&
        Math.abs(b.pitch + 0.7) < 0.0002);
}

const CLIENTES = 16;
const rede = new NetRedeMemoria(0.0, 1, 3);
const tS = rede.criarPonta();
const jogo = new FpsServidorJogo(tS, 77, 0.0, 0);
const clis: FpsClienteRede[] = [];
const inps: FpsPlayerInput[] = [];
const ativos: boolean[] = [];
let k = 0;
while (k < CLIENTES) {
  clis.push(new FpsClienteRede(rede.criarPonta(), tS.endereco, 0.0));
  const inp = fpsInputVazio();
  inp.frente = 1;
  inp.yaw = k * 0.39;
  inps.push(inp);
  ativos.push(true);
  k = k + 1;
}

let tick = 0;
const msRede: f64[] = [];
const msRedeComSnapshot: boolean[] = [];
function rodar(ticks: number): void {
  let t = 0;
  while (t < ticks) {
    const agora = tick * FPS_TICK_DT;
    let c = 0;
    while (c < CLIENTES) { if (ativos[c]) clis[c].passo(agora, inps[c]); c = c + 1; }
    rede.avancar();
    jogo.passo(agora);
    rede.avancar();
    msRede.push(jogo.ultMsRede);
    msRedeComSnapshot.push(jogo.tick % jogo.ticksPorSnapshot === 0);
    tick = tick + 1;
    t = t + 1;
  }
}

rodar(60);
const inicioX: f64[] = [];
const inicioZ: f64[] = [];
k = 0;
while (k < CLIENTES) {
  const eu = clis[k].meuObjeto();
  inicioX.push(eu !== null && eu.go !== null ? eu.go.transform.px : 0.0);
  inicioZ.push(eu !== null && eu.go !== null ? eu.go.transform.pz : 0.0);
  k = k + 1;
}
const bytesAntes = tS.bytesEnviados;
rodar(60);
const kbPorCliente = (tS.bytesEnviados - bytesAntes) / CLIENTES / 1024.0;

let conectados = 0;
let veemTodos = 0;
let andaramCerto = 0;
k = 0;
while (k < CLIENTES) {
  if (clis[k].conectado()) conectados = conectados + 1;
  if (clis[k].rep.objetos.length === CLIENTES) veemTodos = veemTodos + 1;
  const eu = clis[k].meuObjeto();
  if (eu !== null && eu.go !== null) {
    const dx = eu.go.transform.px - inicioX[k];
    const dz = eu.go.transform.pz - inicioZ[k];
    const ao = dx * Math.sin(inps[k].yaw) + dz * Math.cos(inps[k].yaw);
    if (ao > 4.0) andaramCerto = andaramCerto + 1;
  }
  k = k + 1;
}
check("16 clientes conectados e cada um vê os 16 jogadores", conectados === CLIENTES && veemTodos === CLIENTES,
      "conectados=" + conectados + " veemTodos=" + veemTodos);
check("o input de cada cliente move o jogador dele na direção da mira", andaramCerto === CLIENTES,
      "certos=" + andaramCerto);

let pior = 0.0;
k = 0;
while (k < CLIENTES) {
  const i = jogo.jogadorDoCliente[k];
  const p = jogo.mundo.jogadores[i];
  const visto = clis[0].rep.porDono(k);
  if (visto !== null && visto.go !== null) {
    const dx = visto.go.transform.px - p.x;
    const dy = visto.go.transform.py - (p.y + FPS_ALTURA_CORPO * 0.5);
    const dz = visto.go.transform.pz - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > pior) pior = d;
  } else pior = 1.0e9;
  k = k + 1;
}
check("o cliente 0 vê todos a no máximo 4 snapshots de atraso (≤ 1,0 u)", pior <= 1.0, "pior=" + pior);

// Média em vez de mediana: a distribuição do custo de rede tem dois picos
// (ticks sem e com snapshot), então a mediana cai bem na fronteira entre os
// dois grupos e não resume o custo real por tick — a média sim.
const ultimos = msRede.slice(msRede.length - 60);
const ultimosComSnapshot = msRedeComSnapshot.slice(msRedeComSnapshot.length - 60);
let somaRede = 0.0;
let somaRedeSnapshot = 0.0;
let nSnapshot = 0;
let iu = 0;
while (iu < ultimos.length) {
  somaRede = somaRede + ultimos[iu];
  if (ultimosComSnapshot[iu]) { somaRedeSnapshot = somaRedeSnapshot + ultimos[iu]; nSnapshot = nSnapshot + 1; }
  iu = iu + 1;
}
const mediaRede = somaRede / ultimos.length;
const mediaRedeSnapshot = nSnapshot > 0 ? somaRedeSnapshot / nSnapshot : 0.0;
io.print("  banda: " + kbPorCliente.toFixed(2) + " KB/s por cliente | rede no tick: média " + mediaRede.toFixed(3) +
         " ms (com snapshot: " + mediaRedeSnapshot.toFixed(3) + " ms)");
check("banda ≤ 30 KB/s por cliente", kbPorCliente <= 30.0, "kb=" + kbPorCliente);
check("rede ≤ 0,5 ms no tick com 16 clientes (média)", mediaRede <= 0.5, "ms=" + mediaRede);

// cliente 3 some: em 5 s sai do mundo de todos
ativos[3] = false;
rodar(330);
check("cliente em silêncio sai do servidor e do mundo dos outros",
      jogo.jogadorDoCliente[3] === -1 && clis[0].rep.objetos.length === CLIENTES - 1,
      "jogador=" + jogo.jogadorDoCliente[3] + " objetos=" + clis[0].rep.objetos.length);

// I-1 (a): um transporte cru manda CONECTAR e DESCONECTAR no mesmo tick —
// não pode sobrar jogador fantasma (vaga ocupada nem objeto replicado a mais)
{
  function contarConectadosSrv(): number {
    let n = 0;
    let c = 0;
    while (c < FPS_MAX_CLIENTES) { if (jogo.srv.conectado(c)) n = n + 1; c = c + 1; }
    return n;
  }
  function contarOcupados(): number {
    let n = 0;
    let i = 0;
    while (i < jogo.mundo.ocupado.length) { if (jogo.mundo.ocupado[i]) n = n + 1; i = i + 1; }
    return n;
  }

  const bruto = rede.criarPonta();
  const wB = new NetWriter(16);
  netEscreverCabecalho(wB, NET_PKT_CONECTAR, 0, 0, 0, false);
  bruto.enviar(tS.endereco, wB.buf, wB.pos);
  wB.reiniciar();
  netEscreverCabecalho(wB, NET_PKT_DESCONECTAR, 0, 0, 0, false);
  bruto.enviar(tS.endereco, wB.buf, wB.pos);
  // ambos os pacotes chegam juntos no mesmo receber(): CONECTAR entra em
  // "novos" e DESCONECTAR (do mesmo par, já sem conexão) entra em "saidos"
  // no mesmo tick.
  rede.avancar();
  let agora = tick * FPS_TICK_DT;
  jogo.passo(agora);
  rede.avancar();
  tick = tick + 1;
  rodar(5);   // dá tempo de qualquer efeito colateral se manifestar
  const ocupados = contarOcupados();
  const conectadosSrv = contarConectadosSrv();
  check("conectar e desconectar no mesmo tick não deixa jogador fantasma",
        ocupados === conectadosSrv && jogo.rep.objetos.length === conectadosSrv,
        "ocupados=" + ocupados + " conectadosSrv=" + conectadosSrv + " objetos=" + jogo.rep.objetos.length);
}

// I-1 (b): um cliente sai e outro entra no mesmo índice de cliente, no mesmo
// tick — as contagens de vagas ocupadas e objetos replicados continuam
// batendo com o número de conectados de verdade.
{
  function contarConectadosSrv2(): number {
    let n = 0;
    let c = 0;
    while (c < FPS_MAX_CLIENTES) { if (jogo.srv.conectado(c)) n = n + 1; c = c + 1; }
    return n;
  }
  function contarOcupados2(): number {
    let n = 0;
    let i = 0;
    while (i < jogo.mundo.ocupado.length) { if (jogo.mundo.ocupado[i]) n = n + 1; i = i + 1; }
    return n;
  }

  const alvo = 5;
  ativos[alvo] = false;
  clis[alvo].cli.desconectar();
  const novo = new FpsClienteRede(rede.criarPonta(), tS.endereco, tick * FPS_TICK_DT);
  rede.avancar();
  let agora = tick * FPS_TICK_DT;
  novo.passo(agora, fpsInputVazio());
  jogo.passo(agora);
  rede.avancar();
  tick = tick + 1;
  let t = 0;
  while (t < 10) {
    agora = tick * FPS_TICK_DT;
    novo.passo(agora, fpsInputVazio());
    let c = 0;
    while (c < CLIENTES) { if (ativos[c]) clis[c].passo(agora, inps[c]); c = c + 1; }
    rede.avancar();
    jogo.passo(agora);
    rede.avancar();
    tick = tick + 1;
    t = t + 1;
  }
  const ocupados = contarOcupados2();
  const conectadosSrv = contarConectadosSrv2();
  check("cliente sai e outro entra no mesmo índice: vagas e objetos batem com os conectados",
        ocupados === conectadosSrv && jogo.rep.objetos.length === conectadosSrv && novo.conectado(),
        "ocupados=" + ocupados + " conectadosSrv=" + conectadosSrv + " objetos=" + jogo.rep.objetos.length);
}

if (falhas === 0) io.print("[PASSOU] net-fps"); else io.print("[FALHOU] net-fps: " + falhas + " falha(s)");
