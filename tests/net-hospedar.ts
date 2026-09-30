// Servidor hospedado (listen server) sem janela: o mesmo FpsServidorJogo roda
// no processo do jogador local, que entra pelo transporte em memória; um
// segundo cliente entra por um transporte "remoto" (aqui, outra rede em
// memória com atraso, no lugar do UDP). Cobre o transporte composto, os dois
// clientes vendo um ao outro, determinismo e o custo do tick hospedado.
import io from "@compat/io.ts";
import { NetRedeMemoria, NetTransporteComposto } from "../src/net/transport";
import { NET_FAIXA_PAR_COMPOSTO } from "../src/net/config";
import { FpsServidorHospedado } from "../src/servidor_hospedado";
import { FpsClienteRede } from "../src/cliente_rede";
import { FpsWorld } from "../src/shared/world";
import { FpsPlayerInput, fpsInputVazio } from "../src/shared/input";
import { FPS_TICK_DT, FPS_ALTURA_CORPO } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

io.print("=== net-hospedar ===");

// 1. transporte composto: cada parte tem a própria faixa de pares e a origem
// recebida volta já com o deslocamento da parte.
{
  const redeA = new NetRedeMemoria(0.0, 0, 1);
  const redeB = new NetRedeMemoria(0.0, 0, 2);
  const srvA = redeA.criarPonta();
  const cliA = redeA.criarPonta();
  const srvB = redeB.criarPonta();
  const cliB = redeB.criarPonta();
  const comp = new NetTransporteComposto(srvA, srvB);
  const pkt = new Uint8Array(2);
  const buf = new Uint8Array(16);
  pkt[0] = 11; comp.enviar(cliA.endereco, pkt, 1);
  pkt[0] = 22; comp.enviar(NET_FAIXA_PAR_COMPOSTO + cliB.endereco, pkt, 1);
  redeA.avancar(); redeB.avancar();
  const nA = cliA.receber(buf); const vA = buf[0];
  const nB = cliB.receber(buf); const vB = buf[0];
  check("composto: destino abaixo da faixa vai pela parte A, acima vai pela B",
        nA === 1 && vA === 11 && nB === 1 && vB === 22, "nA=" + nA + " vA=" + vA + " nB=" + nB + " vB=" + vB);
  check("composto: bytes enviados somam as duas partes", comp.bytesEnviados === 2, "bytes=" + comp.bytesEnviados);
  pkt[0] = 33; cliA.enviar(srvA.endereco, pkt, 1);
  pkt[0] = 44; cliB.enviar(srvB.endereco, pkt, 1);
  redeA.avancar(); redeB.avancar();
  comp.bombear();
  const r1 = comp.receber(buf); const o1 = comp.origemRecebida; const v1 = buf[0];
  const r2 = comp.receber(buf); const o2 = comp.origemRecebida; const v2 = buf[0];
  const r3 = comp.receber(buf);
  check("composto: recebe das duas partes com a origem deslocada pela faixa",
        r1 === 1 && v1 === 33 && o1 === cliA.endereco &&
        r2 === 1 && v2 === 44 && o2 === NET_FAIXA_PAR_COMPOSTO + cliB.endereco && r3 === 0,
        "r1=" + r1 + " o1=" + o1 + " r2=" + r2 + " o2=" + o2 + " r3=" + r3);
}

// 2. servidor hospedado + cliente local (memória) + cliente remoto ("UDP"
// simulado por outra rede em memória, atraso 1).
function digital(w: FpsWorld): string {
  let s = "";
  let i = 0;
  while (i < w.jogadores.length) {
    const p = w.jogadores[i];
    s = s + p.x.toFixed(6) + "," + p.y.toFixed(6) + "," + p.z.toFixed(6) + "," + p.vida.toFixed(3) + ";";
    i = i + 1;
  }
  return s;
}

class Partida {
  redeUdp: NetRedeMemoria;
  hosp: FpsServidorHospedado;
  local: FpsClienteRede;
  remoto: FpsClienteRede;
  inpLocal: FpsPlayerInput;
  inpRemoto: FpsPlayerInput;
  tick: number;
  msPasso: f64[];
  msTick: f64[];
  msRede: f64[];

  constructor() {
    this.redeUdp = new NetRedeMemoria(0.0, 1, 5);
    const pontaRemotaSrv = this.redeUdp.criarPonta();
    const pontaRemotaCli = this.redeUdp.criarPonta();
    this.hosp = new FpsServidorHospedado(pontaRemotaSrv, 77, 0.0, 0);
    this.local = new FpsClienteRede(this.hosp.pontaLocal, this.hosp.pontaServidor.endereco, 0.0);
    this.remoto = new FpsClienteRede(pontaRemotaCli, pontaRemotaSrv.endereco, 0.0);
    this.inpLocal = fpsInputVazio();
    this.inpRemoto = fpsInputVazio();
    this.tick = 0;
    this.msPasso = []; this.msTick = []; this.msRede = [];
  }

  rodar(ticks: number): void {
    let t = 0;
    while (t < ticks) {
      const agora = this.tick * FPS_TICK_DT;
      // mesma ordem do client_rede.ts no modo hospedar: servidor antes do cliente local
      this.hosp.passo(agora);
      this.local.passo(agora, this.inpLocal);
      this.remoto.passo(agora, this.inpRemoto);
      this.redeUdp.avancar();
      this.msPasso.push(this.hosp.ultMsPasso);
      this.msTick.push(this.hosp.jogo.mundo.ultMsTick);
      this.msRede.push(this.hosp.jogo.ultMsRede);
      this.tick = this.tick + 1;
      t = t + 1;
    }
  }
}

function media(v: f64[], ultimos: number): f64 {
  let soma = 0.0;
  let i = v.length - ultimos;
  if (i < 0) i = 0;
  const n = v.length - i;
  while (i < v.length) { soma = soma + v[i]; i = i + 1; }
  return n > 0 ? soma / n : 0.0;
}

const p = new Partida();
p.rodar(60);
check("servidor hospedado vê clientes 2", p.hosp.clientes() === 2, "clientes=" + p.hosp.clientes());
check("cliente local (memória) e remoto (\"UDP\") conectados", p.local.conectado() && p.remoto.conectado(),
      "local=" + p.local.conectado() + " remoto=" + p.remoto.conectado());
check("os dois veem 2 jogadores", p.local.rep.objetos.length === 2 && p.remoto.rep.objetos.length === 2,
      "local=" + p.local.rep.objetos.length + " remoto=" + p.remoto.rep.objetos.length);
check("os dois receberam snapshots", p.local.rep.ultimoTick > 0 && p.remoto.rep.ultimoTick > 0,
      "local=" + p.local.rep.ultimoTick + " remoto=" + p.remoto.rep.ultimoTick);

// o local anda e o remoto vê
const euL = p.local.meuObjeto();
const x0 = euL !== null && euL.go !== null ? euL.go.transform.px : 0.0;
const z0 = euL !== null && euL.go !== null ? euL.go.transform.pz : 0.0;
p.inpLocal.frente = 1;
p.inpLocal.yaw = 0.7;
p.inpRemoto.frente = 1;
p.inpRemoto.yaw = 2.1;
p.rodar(60);
let andou = 0.0;
{
  const eu = p.local.meuObjeto();
  if (eu !== null && eu.go !== null) {
    const dx = eu.go.transform.px - x0;
    const dz = eu.go.transform.pz - z0;
    andou = dx * Math.sin(p.inpLocal.yaw) + dz * Math.cos(p.inpLocal.yaw);
  }
}
check("o input do cliente local move o jogador dele (pela memória)", andou > 4.0, "andou=" + andou);
{
  const idLocal = p.local.cli.clienteId;
  const i = p.hosp.jogo.jogadorDoCliente[idLocal];
  const jog = p.hosp.jogo.mundo.jogadores[i];
  const visto = p.remoto.rep.porDono(idLocal);
  let d = 1.0e9;
  if (visto !== null && visto.go !== null) {
    const dx = visto.go.transform.px - jog.x;
    const dy = visto.go.transform.py - (jog.y + FPS_ALTURA_CORPO * 0.5);
    const dz = visto.go.transform.pz - jog.z;
    d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  check("o remoto vê o jogador local a no máximo 4 snapshots de atraso (≤ 1,0 u)", d <= 1.0, "d=" + d);
}
{
  const idRemoto = p.remoto.cli.clienteId;
  const i = p.hosp.jogo.jogadorDoCliente[idRemoto];
  const jog = p.hosp.jogo.mundo.jogadores[i];
  const visto = p.local.rep.porDono(idRemoto);
  let d = 1.0e9;
  if (visto !== null && visto.go !== null) {
    const dx = visto.go.transform.px - jog.x;
    const dz = visto.go.transform.pz - jog.z;
    d = Math.sqrt(dx * dx + dz * dz);
  }
  check("o local vê o jogador remoto a no máximo 4 snapshots de atraso (≤ 1,0 u)", d <= 1.0, "d=" + d);
}

// custo do tick do servidor hospedado (média dos últimos 60 ticks)
io.print("  tick hospedado: passo " + media(p.msPasso, 60).toFixed(3) + " ms (mundo " + media(p.msTick, 60).toFixed(3) +
         " ms, rede " + media(p.msRede, 60).toFixed(3) + " ms)");

// 3. determinismo: duas partidas com os mesmos inputs dão o mesmo mundo.
function partidaRoteirizada(): string {
  const q = new Partida();
  let t = 0;
  while (t < 240) {
    q.inpLocal.frente = (t % 80) < 40 ? 1 : 0;
    q.inpLocal.yaw = t * 0.02;
    q.inpRemoto.lado = (t % 60) < 30 ? 1 : -1;
    q.inpRemoto.pulo = (t % 45) === 0;
    q.rodar(1);
    t = t + 1;
  }
  return digital(q.hosp.jogo.mundo);
}
const d1 = partidaRoteirizada();
const d2 = partidaRoteirizada();
check("determinismo: duas partidas hospedadas com os mesmos inputs dão o mesmo mundo", d1 === d2 && d1.length > 0);

if (falhas === 0) io.print("[PASSOU] net-hospedar"); else io.print("[FALHOU] net-hospedar: " + falhas + " falha(s)");
