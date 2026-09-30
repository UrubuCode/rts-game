// Vagas de personagem dos remotos: netId -> vaga reaproveitável.
//
// O netId é monotônico e sem reuso (subprojeto A), então usá-lo direto como
// índice fazia a animação crescer um GameObject + Skeleton + Animator por
// entrada na partida, para sempre. Aqui cada netId visto no quadro ocupa uma
// vaga; um netId que some do snapshot (desconectou, saiu da replicação) libera
// a vaga no fim do quadro, e o próximo que entrar a reaproveita. No máximo
// FPS_MAX_VAGAS_REDE vagas: acima disso o remoto não é animado (`vaga` = -1).
//
// Por quadro: `comecar()`, `vaga(netId)` por remoto, `terminar()`. Sem
// alocação: busca linear em arrays fixos (dezenas de jogadores).
export const FPS_MAX_VAGAS_REDE = 64;

export class FpsVagasRede {
  /// netId de cada vaga (-1 = livre).
  netIdDa: Int32Array;
  private vista: Uint8Array;
  /// Maior vaga já usada + 1 (limite dos laços de animação/desenho).
  usadas: number = 0;
  /// A última `vaga()` acabou de ser ocupada (o chamador zera o estado dela).
  nova: boolean = false;

  constructor() {
    this.netIdDa = new Int32Array(FPS_MAX_VAGAS_REDE);
    this.vista = new Uint8Array(FPS_MAX_VAGAS_REDE);
    let i = 0;
    while (i < FPS_MAX_VAGAS_REDE) { this.netIdDa[i] = 0 - 1; i = i + 1; }
  }

  comecar(): void {
    let i = 0;
    while (i < this.usadas) { this.vista[i] = 0; i = i + 1; }
  }

  /// Vaga do `netId` neste quadro (ocupa uma livre se preciso); -1 = sem vaga.
  vaga(netId: number): number {
    this.nova = false;
    let livre = 0 - 1;
    let i = 0;
    while (i < this.usadas) {
      const n = this.netIdDa[i];
      if (n === netId) { this.vista[i] = 1; return i; }
      if (n < 0 && livre < 0) livre = i;
      i = i + 1;
    }
    if (livre < 0) {
      if (this.usadas >= FPS_MAX_VAGAS_REDE) return 0 - 1;
      livre = this.usadas;
      this.usadas = this.usadas + 1;
    }
    this.netIdDa[livre] = netId;
    this.vista[livre] = 1;
    this.nova = true;
    return livre;
  }

  /// Libera as vagas cujo netId não apareceu neste quadro.
  terminar(): void {
    let i = 0;
    while (i < this.usadas) {
      if (this.vista[i] === 0) this.netIdDa[i] = 0 - 1;
      i = i + 1;
    }
  }

  /// A vaga `i` está ocupada neste quadro.
  ocupada(i: number): boolean { return i >= 0 && i < this.usadas && this.netIdDa[i] >= 0; }
}
