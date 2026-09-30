// Cliente do FPS sem janela: conecta, gera o mapa pela semente do BEMVINDO,
// cria os jogadores remotos pela fábrica e manda o input a cada tick.
// client_rede.ts só adiciona janela, entrada e desenho.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { NetTransport } from "./net/transport";
import { NetCliente } from "./net/client";
import { NetFabrica, NetReplicacaoCliente } from "./net/replication";
import { NetworkObject, NetworkTransform } from "./net/components";
import { NetWriter, NetReader } from "./net/buffer";
import { NET_ESTADO_CONECTADO } from "./net/config";
import { FpsPlayerInput, fpsEscreverInput, FPS_TAM_INPUT_REDE } from "./shared/input";
import { FpsMapa, fpsGerarMapa } from "./shared/map";
import { FPS_NET_TIPO_JOGADOR, FPS_MEIA_LARGURA_CAIXA, FPS_ALTURA_CORPO } from "./shared/config";
import { FPS_CAMADA_JOGADOR } from "./shared/layers";

export class FpsFabricaRede extends NetFabrica {
  criar(tipo: number, netId: number, dono: number): NetworkObject | null {
    if (tipo !== FPS_NET_TIPO_JOGADOR) return null;
    const go = new GameObject("remoto" + netId);
    go.setMesh(1, 200, 120, 60);
    go.transform.sx = FPS_MEIA_LARGURA_CAIXA * 2.0;
    go.transform.sy = FPS_ALTURA_CORPO;
    go.transform.sz = FPS_MEIA_LARGURA_CAIXA * 2.0;
    go.layer = FPS_CAMADA_JOGADOR;
    const no = new NetworkObject(tipo, dono);
    no.go = go;
    no.adicionar(new NetworkTransform(go.transform));
    go.addBehavior(no);
    return no;
  }
}

export class FpsClienteRede {
  scene: Scene;
  cli: NetCliente;
  rep: NetReplicacaoCliente;
  mapa: FpsMapa | null;
  seqInput: number;
  w: NetWriter;

  constructor(t: NetTransport, servidor: number, agora: f64) {
    this.scene = new Scene("cliente");
    this.cli = new NetCliente(t);
    this.rep = new NetReplicacaoCliente(this.cli, this.scene, new FpsFabricaRede());
    this.mapa = null;
    this.seqInput = 0;
    this.w = new NetWriter(FPS_TAM_INPUT_REDE + 4);
    this.cli.conectar(servidor, agora);
  }

  conectado(): boolean { return this.cli.estado === NET_ESTADO_CONECTADO; }

  passo(agora: f64, inp: FpsPlayerInput): void {
    this.cli.passo(agora);
    if (this.conectado() && this.mapa === null) {
      const r = new NetReader(16);
      r.abrir(this.cli.boasVindas, 0, this.cli.boasVindasTam);
      const semente = r.u32();
      const escala = r.f32();
      this.mapa = fpsGerarMapa(this.scene, semente, escala);
    }
    if (this.mapa !== null) this.rep.processar();
    if (this.conectado()) {
      this.w.reiniciar();
      fpsEscreverInput(this.w, inp);
      this.cli.enviarInput(this.seqInput, this.w.buf, this.w.pos);
      this.seqInput = (this.seqInput + 1) & 0xFFFF;
      this.cli.enviar(agora);
    }
    this.scene.computeWorld();
  }

  meuObjeto(): NetworkObject | null {
    return this.rep.porDono(this.cli.clienteId);
  }
}
