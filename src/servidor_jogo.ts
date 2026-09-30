// Servidor do FPS sem janela: FpsWorld + NetServidor + replicação. Cada
// cliente que conecta ocupa uma vaga de jogador; o corpo dele ganha
// NetworkObject + NetworkTransform. server.ts só faz o laço com UDP.
import { Scene } from "@engine/core/scene";
import { NetTransport } from "./net/transport";
import { NetServidor } from "./net/server";
import { NetReplicacaoServidor } from "./net/replication";
import { NetworkObject, NetworkTransform } from "./net/components";
import { NetWriter, NetReader } from "./net/buffer";
import { NET_MAX_TAM_INPUT, NET_TAXA_SNAPSHOT, NET_DONO_SERVIDOR } from "./net/config";
import { FpsWorld } from "./shared/world";
import { FpsPlayerInput, fpsInputVazio, fpsLerInput } from "./shared/input";
import { FPS_TICK_DT, FPS_NET_TIPO_JOGADOR, FPS_MAX_CLIENTES } from "./shared/config";

export class FpsServidorJogo {
  scene: Scene;
  mundo: FpsWorld;
  srv: NetServidor;
  rep: NetReplicacaoServidor;
  jogadorDoCliente: number[];
  redeDoJogador: (NetworkObject | null)[];
  inputs: FpsPlayerInput[];
  bufInput: Uint8Array;
  rIn: NetReader;
  tick: number;
  ticksPorSnapshot: number;
  ultMsRede: f64;

  constructor(t: NetTransport, semente: number, escala: f64, bots: number) {
    this.scene = new Scene("servidor");
    this.mundo = new FpsWorld(this.scene, semente, escala);
    const taxaTick = Math.round(1.0 / FPS_TICK_DT);
    this.srv = new NetServidor(t, FPS_MAX_CLIENTES, taxaTick);
    const w = new NetWriter(16);
    w.u32(semente);
    w.f32(escala);
    this.srv.definirBoasVindas(w.buf, w.pos);
    this.rep = new NetReplicacaoServidor(this.srv);
    this.jogadorDoCliente = [];
    let c = 0;
    while (c < FPS_MAX_CLIENTES) { this.jogadorDoCliente.push(-1); c = c + 1; }
    this.redeDoJogador = [];
    this.inputs = [];
    this.bufInput = new Uint8Array(NET_MAX_TAM_INPUT);
    this.rIn = new NetReader(NET_MAX_TAM_INPUT);
    this.tick = 0;
    this.ticksPorSnapshot = Math.max(1, Math.round(taxaTick / NET_TAXA_SNAPSHOT));
    this.ultMsRede = 0.0;
    let b = 0;
    while (b < bots) {
      const i = this.mundo.ocuparJogador(true);
      this.garantirVagas();
      this.replicarJogador(i, NET_DONO_SERVIDOR);
      b = b + 1;
    }
  }

  garantirVagas(): void {
    while (this.inputs.length < this.mundo.jogadores.length) {
      this.inputs.push(fpsInputVazio());
      this.redeDoJogador.push(null);
    }
  }

  replicarJogador(i: number, dono: number): void {
    const corpo = this.mundo.corpos[i];
    const no = new NetworkObject(FPS_NET_TIPO_JOGADOR, dono);
    no.go = corpo;
    no.adicionar(new NetworkTransform(corpo.transform));
    corpo.addBehavior(no);
    this.rep.spawn(no);
    this.redeDoJogador[i] = no;
  }

  pararReplicacao(i: number): void {
    const no = this.redeDoJogador[i];
    if (no === null) return;
    this.rep.despawn(no);
    const corpo = this.mundo.corpos[i];
    const k = corpo.behaviors.indexOf(no);
    if (k >= 0) corpo.removeBehavior(k);
    this.redeDoJogador[i] = null;
  }

  passo(agora: f64): void {
    const t0 = performance.now();
    this.srv.receber(agora);
    this.srv.verificarTempo(agora);
    // Trata primeiro quem SAIU e só depois quem ENTROU: NetServidor guarda
    // novos e saídos em filas separadas, e no mesmo receber() a vaga de um
    // cliente pode ser liberada e reocupada por outro. Tratar "novos"
    // primeiro faria o laço de "saídos" remover o jogador que acabou de
    // chegar (mesmo índice de cliente reaproveitado).
    let c = this.srv.proximoSaido();
    while (c >= 0) {
      const i = this.jogadorDoCliente[c];
      if (i >= 0) {
        this.pararReplicacao(i);
        this.mundo.liberarJogador(i);
        this.inputs[i] = fpsInputVazio();
      }
      this.jogadorDoCliente[c] = -1;
      c = this.srv.proximoSaido();
    }
    c = this.srv.proximoNovo();
    while (c >= 0) {
      // Um cliente pode conectar e desconectar no mesmo receber(): "novos" e
      // "saidos" guardam o mesmo c, e o laço de saídos (acima) já não achou
      // vaga para liberar (jogadorDoCliente[c] ainda era -1 nesse momento).
      // Sem este check, ocuparíamos uma vaga e replicaríamos um jogador para
      // um cliente que já não existe — um fantasma que nunca sai.
      if (this.srv.conectado(c)) {
        const i = this.mundo.ocuparJogador(false);
        this.garantirVagas();
        this.jogadorDoCliente[c] = i;
        this.rep.aoConectar(c);
        this.replicarJogador(i, c);
      }
      c = this.srv.proximoNovo();
    }
    c = 0;
    while (c < FPS_MAX_CLIENTES) {
      const i = this.jogadorDoCliente[c];
      if (i >= 0) {
        const n = this.srv.proximoInput(c, this.bufInput);
        if (n > 0) {
          this.rIn.abrir(this.bufInput, 0, n);
          fpsLerInput(this.rIn, this.inputs[i]);
        }
      }
      c = c + 1;
    }
    const t1 = performance.now();
    this.mundo.passo(this.inputs);
    const t2 = performance.now();
    this.tick = this.tick + 1;
    this.srv.tick = this.tick;
    if (this.tick % this.ticksPorSnapshot === 0) {
      this.rep.enviarSnapshot(this.tick);
      this.srv.enviar(agora);
    }
    this.ultMsRede = (t1 - t0) + (performance.now() - t2);
  }
}
