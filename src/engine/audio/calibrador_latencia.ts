// Calibração de latência de áudio — API de MOTOR (sem UI): mede o atraso
// entre um clique agendado (`Audio.agendarEm`, sample-accurate — a 1ª amostra
// fica audível EXATAMENTE no `tempoDsp` pedido) e a tecla/toque que a pessoa
// dá NA batida. A mediana dos offsets (robusta a um toque perdido/duplo) vira
// `Audio.latenciaCalibrada`.
//
// Fica em `engine/audio` (não em `editor/`) de propósito: um JOGO exportado
// também precisa calibrar (o dispositivo de quem joga é diferente do de quem
// editou) — `iniciar()/toque()/resultado()/salvar()` bastam pra uma tela de
// "calibrar" própria do jogo, sem depender do editor. O painel do editor
// (`editor/calibrar_latencia_panel.ts`) é hoje só UI fina por cima desta
// classe; ele guarda o resultado nas preferências do EDITOR (projeto/local),
// enquanto `salvar()` aqui grava na config do JOGO (`config_usuario.ts`,
// por máquina/instalação) — os dois lados persistem no lugar certo (ver o
// brief de revisão do relógio de áudio).
import { Audio } from "./audio_system";
import { AudioClip } from "./clip";
import { configUsuario } from "@engine/core/config_usuario";

/// O beat agendado mais PRÓXIMO de `tapTempoDsp` (podem faltar batidas: a
/// pessoa erra o toque, ou reage cedo/tarde demais) — `primeiroBeat` e
/// `intervaloSeg` descrevem a grade toda. Devolve `tapTempoDsp − beat`
/// (positivo: o toque veio DEPOIS do clique).
export function offsetMaisProximo(tapTempoDsp: f64, primeiroBeat: f64, intervaloSeg: f64): f64 {
  const n = Math.round((tapTempoDsp - primeiroBeat) / intervaloSeg);
  const beat = primeiroBeat + n * intervaloSeg;
  return tapTempoDsp - beat;
}
/// Mediana (não a média: robusta a UM toque perdido/duplo) dos offsets em
/// SEGUNDOS, em ms. Lista vazia devolve 0 (nenhuma medição ainda).
export function medianaMs(offsetsSeg: f64[]): f64 {
  const n = offsetsSeg.length;
  if (n === 0) return 0.0;
  const copia = offsetsSeg.slice();
  copia.sort((a: f64, b: f64) => a - b);
  const meio = Math.floor(n / 2);
  const medSeg: f64 = n % 2 === 1 ? copia[meio] : (copia[meio - 1] + copia[meio]) / 2.0;
  return medSeg * 1000.0;
}

const CAL_INTERVALO_PADRAO: f64 = 0.5;
const CAL_BATIDAS_PADRAO: number = 16;

/// Uma sessão de calibração. `iniciar(clip)` agenda `batidasAlvo` cliques a
/// cada `intervaloSeg`; cada `toque()` (a UI chama num evento de tecla/clique
/// do JOGADOR) registra o offset contra a grade; ao completar, `resultado()`
/// vira a mediana (NaN antes disso). `aplicar()` só liga em
/// `Audio.latenciaCalibrada` (em memória); `salvar()` aplica E persiste na
/// config do jogo (`config_usuario.ts`) — o jeito mais curto de uma tela de
/// jogo "calibrar" ficar completa.
export class CalibradorLatencia {
  intervaloSeg: f64;
  batidasAlvo: number;
  rodando: boolean = false;
  primeiroBeat: f64 = 0.0;
  offsets: f64[] = [];
  /// Ids de `agendarEm` dos cliques AINDA não disparados desta sessão — pra
  /// `parar()` cancelar de verdade (senão cliques agendados no futuro
  /// tocariam sozinhos depois de `parar()`/fechar a tela).
  private idsAgendados: number[] = [];
  private resultadoMsCache: f64 = 0.0 / 0.0; // NaN: sem resultado ainda
  constructor(intervaloSeg: f64 = CAL_INTERVALO_PADRAO, batidasAlvo: number = CAL_BATIDAS_PADRAO) {
    this.intervaloSeg = intervaloSeg; this.batidasAlvo = batidasAlvo;
  }
  /// Agenda TODAS as batidas de uma vez (a régua inteira já é conhecida —
  /// `primeiroBeat + i·intervalo` — sem reagendar por quadro). A 1ª batida
  /// daqui a 1 s (tempo de a pessoa se preparar).
  iniciar(clip: AudioClip): void {
    this.parar();
    this.rodando = true;
    this.offsets = [];
    this.resultadoMsCache = 0.0 / 0.0;
    this.primeiroBeat = Audio.tempoDsp() + 1.0;
    this.idsAgendados = [];
    let i = 0;
    while (i < this.batidasAlvo) {
      const id = Audio.agendarEm(clip, this.primeiroBeat + i * this.intervaloSeg);
      if (id !== 0) this.idsAgendados.push(id);
      i = i + 1;
    }
  }
  /// Encerra a sessão e cancela os cliques agendados que ainda não tocaram
  /// (os que já tocaram ficam sem ramp extra — `cancelarAgendado` já cuida
  /// dos dois casos, mas aqui só interessam os pendentes).
  parar(): void {
    this.rodando = false;
    let i = 0;
    while (i < this.idsAgendados.length) { Audio.cancelarAgendado(this.idsAgendados[i]); i = i + 1; }
    this.idsAgendados = [];
  }
  /// Um toque chegou NA batida (a UI/jogo chama isto no evento de input).
  toque(): void {
    if (!this.rodando) return;
    const tempo = Audio.tempoDsp();
    this.offsets.push(offsetMaisProximo(tempo, this.primeiroBeat, this.intervaloSeg));
    if (this.offsets.length >= this.batidasAlvo) {
      this.resultadoMsCache = medianaMs(this.offsets);
      this.rodando = false;
      this.idsAgendados = []; // as batidas restantes (se sobrou alguma) já tocaram sozinhas
    }
  }
  /// Quantos toques já foram registrados nesta sessão.
  progresso(): number { return this.offsets.length; }
  /// A mediana em ms, ou NaN enquanto a sessão não completou (compare com
  /// `r !== r` — o jeito sem `isNaN` de sempre neste código).
  resultado(): f64 { return this.resultadoMsCache; }
  /// Só aplica em memória (`Audio.latenciaCalibrada`) — sem persistir.
  aplicar(): void { if (this.resultadoMsCache === this.resultadoMsCache) Audio.latenciaCalibrada = this.resultadoMsCache; }
  /// Aplica E persiste na config do JOGO (`config_usuario.ts` —
  /// `config/usuario.json`, por máquina/instalação). Devolve falso sem
  /// resultado ainda, ou se a escrita falhou (`configUsuario.error` tem o
  /// motivo, já reportado ao Console por `ConfigUsuario`).
  salvar(): boolean {
    if (this.resultadoMsCache !== this.resultadoMsCache) return false;
    this.aplicar();
    return configUsuario.salvarAudioLatenciaMs(this.resultadoMsCache);
  }
}
