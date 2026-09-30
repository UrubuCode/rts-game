// Servidor hospedado (listen server), sem janela: o mesmo FpsServidorJogo do
// modo dedicado, atendendo o jogador local por uma rede em memória e os
// remotos por um transporte externo (UDP no jogo, memória nos testes), os
// dois unidos num NetTransporteComposto. client_rede.ts no modo "hospedar"
// só faz o laço; nada aqui conhece janela.
import { NetTransport, NetRedeMemoria, NetTransporteMemoria, NetTransporteComposto } from "./net/transport";
import { FpsServidorJogo } from "./servidor_jogo";
import { FPS_MAX_CLIENTES } from "./shared/config";

// A rede local não perde nem atrasa; a semente só existe porque o PRNG pede.
const FPS_REDE_LOCAL_PERDA: f64 = 0.0;
const FPS_REDE_LOCAL_ATRASO = 0;
const FPS_REDE_LOCAL_SEMENTE = 1;

export class FpsServidorHospedado {
  redeLocal: NetRedeMemoria;
  pontaServidor: NetTransporteMemoria;
  pontaLocal: NetTransporteMemoria;
  transporte: NetTransporteComposto;
  jogo: FpsServidorJogo;
  ultMsPasso: f64;

  constructor(remoto: NetTransport, semente: number, escala: f64, bots: number) {
    this.redeLocal = new NetRedeMemoria(FPS_REDE_LOCAL_PERDA, FPS_REDE_LOCAL_ATRASO, FPS_REDE_LOCAL_SEMENTE);
    this.pontaServidor = this.redeLocal.criarPonta();
    this.pontaLocal = this.redeLocal.criarPonta();
    this.transporte = new NetTransporteComposto(this.pontaServidor, remoto);
    this.jogo = new FpsServidorJogo(this.transporte, semente, escala, bots);
    this.ultMsPasso = 0.0;
  }

  /// Um tick do servidor. Entrega o que o cliente local mandou desde o tick
  /// anterior, simula, e entrega o snapshot ao cliente local ainda neste
  /// tick (a rede em memória só entrega em avancar()).
  passo(agora: f64): void {
    const t0 = performance.now();
    this.redeLocal.avancar();
    this.jogo.passo(agora);
    this.redeLocal.avancar();
    this.ultMsPasso = performance.now() - t0;
  }

  clientes(): number {
    let n = 0;
    let c = 0;
    while (c < FPS_MAX_CLIENTES) { if (this.jogo.jogadorDoCliente[c] >= 0) n = n + 1; c = c + 1; }
    return n;
  }
}
