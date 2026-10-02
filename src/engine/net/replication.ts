// Replicação por snapshot: o servidor manda SPAWN/DESPAWN (confiáveis) e
// SNAPSHOTs (não confiáveis, divididos por orçamento); o cliente cria os
// objetos pela fábrica do jogo e aplica o estado.
import { Scene } from "@engine/core/scene";
import { NetServidor } from "./server";
import { NetCliente } from "./client";
import { NetWriter, NetReader } from "./buffer";
import { NetworkObject } from "./components";
import { NET_MTU, NET_MSG_SPAWN, NET_MSG_DESPAWN, NET_MSG_SNAPSHOT, NET_ORCAMENTO_SNAPSHOT, NET_MAX_NETID } from "./config";

export class NetFabrica {
  criar(tipo: number, netId: number, dono: number): NetworkObject | null { return null; }
}

export class NetReplicacaoServidor {
  srv: NetServidor;
  objetos: NetworkObject[];
  proximoId: number;
  w: NetWriter;
  wObj: NetWriter;

  constructor(srv: NetServidor) {
    this.srv = srv;
    this.objetos = [];
    this.proximoId = 1;
    this.w = new NetWriter(NET_MTU);
    this.wObj = new NetWriter(NET_MTU);
  }

  /// Dá um netId (monotônico, sem reuso no subprojeto A) e avisa todos. -1 = esgotou.
  spawn(no: NetworkObject): number {
    if (this.proximoId > NET_MAX_NETID) return -1;
    no.netId = this.proximoId;
    this.proximoId = this.proximoId + 1;
    this.objetos.push(no);
    this.montarSpawn(no);
    this.srv.enviarConfiavelTodos(this.w.buf, this.w.pos);
    return no.netId;
  }

  montarSpawn(no: NetworkObject): void {
    const w = this.w;
    w.reiniciar();
    w.u8(NET_MSG_SPAWN);
    w.u16(no.netId);
    w.u16(no.tipo);
    w.u8(no.dono);
    no.escreverEstado(w);
  }

  despawn(no: NetworkObject): void {
    const i = this.objetos.indexOf(no);
    if (i < 0) return;
    this.objetos.splice(i, 1);
    const w = this.w;
    w.reiniciar();
    w.u8(NET_MSG_DESPAWN);
    w.u16(no.netId);
    this.srv.enviarConfiavelTodos(w.buf, w.pos);
  }

  aoConectar(c: number): void {
    let i = 0;
    while (i < this.objetos.length) {
      this.montarSpawn(this.objetos[i]);
      this.srv.enviarConfiavel(c, this.w.buf, this.w.pos);
      i = i + 1;
    }
  }

  enviarSnapshot(tick: number): void {
    const w = this.w;
    const wo = this.wObj;
    w.reiniciar();
    w.u8(NET_MSG_SNAPSHOT);
    w.u32(tick);
    let posN = w.pos;
    w.u16(0);
    let n = 0;
    let i = 0;
    while (i < this.objetos.length) {
      const o = this.objetos[i];
      wo.reiniciar();
      wo.u16(o.netId);
      o.escreverEstado(wo);
      if (n > 0 && w.pos + wo.pos > NET_ORCAMENTO_SNAPSHOT) {
        w.u16Em(posN, n);
        this.srv.enviarNaoConfiavelTodos(w.buf, w.pos);
        w.reiniciar();
        w.u8(NET_MSG_SNAPSHOT);
        w.u32(tick);
        posN = w.pos;
        w.u16(0);
        n = 0;
      }
      w.bytes(wo.buf, wo.pos);
      n = n + 1;
      i = i + 1;
    }
    if (n > 0) {
      w.u16Em(posN, n);
      this.srv.enviarNaoConfiavelTodos(w.buf, w.pos);
    }
  }
}

export class NetReplicacaoCliente {
  cli: NetCliente;
  scene: Scene;
  fab: NetFabrica;
  porId: (NetworkObject | null)[];
  objetos: NetworkObject[];
  r: NetReader;
  msg: Uint8Array;
  ultimoTick: number;

  constructor(cli: NetCliente, scene: Scene, fab: NetFabrica) {
    this.cli = cli;
    this.scene = scene;
    this.fab = fab;
    this.porId = [];
    let i = 0;
    while (i <= NET_MAX_NETID) { this.porId.push(null); i = i + 1; }
    this.objetos = [];
    this.r = new NetReader(NET_MTU);
    this.msg = new Uint8Array(NET_MTU);
    this.ultimoTick = 0;
  }

  porNetId(id: number): NetworkObject | null {
    if (id < 0 || id > NET_MAX_NETID) return null;
    return this.porId[id];
  }

  porDono(dono: number): NetworkObject | null {
    let i = 0;
    while (i < this.objetos.length) {
      if (this.objetos[i].dono === dono) return this.objetos[i];
      i = i + 1;
    }
    return null;
  }

  processar(): void {
    let n = this.cli.mensagens.tirar(this.msg);
    while (n > 0) { this.processarConfiavel(n); n = this.cli.mensagens.tirar(this.msg); }
    n = this.cli.instantaneos.tirar(this.msg);
    while (n > 0) { this.processarSnapshot(n); n = this.cli.instantaneos.tirar(this.msg); }
  }

  processarConfiavel(n: number): void {
    const r = this.r;
    r.abrir(this.msg, 0, n);
    const tipoMsg = r.u8();
    if (tipoMsg === NET_MSG_SPAWN) {
      const netId = r.u16();
      const tipo = r.u16();
      const dono = r.u8();
      if (r.erro || this.porId[netId] !== null) return;
      const no = this.fab.criar(tipo, netId, dono);
      if (no === null || no.go === null) return;
      no.netId = netId;
      no.lerEstado(r);
      if(r.erro)return;
      this.scene.add(no.go);
      this.porId[netId] = no;
      this.objetos.push(no);
    } else if (tipoMsg === NET_MSG_DESPAWN) {
      const netId = r.u16();
      const no = this.porNetId(netId);
      if (no === null) return;
      if (no.go !== null) {
        const idx = this.scene.objects.indexOf(no.go);
        if (idx >= 0) this.scene.removeAt(idx);
      }
      this.porId[netId] = null;
      const k = this.objetos.indexOf(no);
      if (k >= 0) this.objetos.splice(k, 1);
    }
  }

  processarSnapshot(n: number): void {
    const r = this.r;
    r.abrir(this.msg, 0, n);
    if (r.u8() !== NET_MSG_SNAPSHOT) return;
    const tick = r.u32();
    if(r.erro)return;
    if (tick < this.ultimoTick) return;      // chegou atrasado: um mais novo já foi aplicado
    const k = r.u16();
    if(r.erro)return;
    this.ultimoTick = tick;
    let i = 0;
    while (i < k && !r.erro) {
      const netId = r.u16();
      const no = this.porNetId(netId);
      if (no === null) return;               // ainda sem SPAWN: tamanho desconhecido, descarta o resto
      no.lerEstado(r);
      i = i + 1;
    }
  }
}
