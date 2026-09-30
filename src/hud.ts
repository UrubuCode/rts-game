// HUD dos clientes, desenhado por `@compat/draw2d.ts` (no máximo 4 parâmetros
// por chamada: no RTS, 5+ parâmetros escalares alocam a cada chamada).
//
// Rótulos em cache: cada texto guarda os valores que mostra e só é remontado
// quando algum muda. O contador de fps é olhado no máximo a cada
// FPS_HUD_INTERVALO_TEXTO_MS (e só remontado se o valor mudou); as linhas de
// depuração (F3), cujos tempos mudam todo quadro, são remontadas nesse
// intervalo. Nada aqui monta string por quadro enquanto os valores ficam iguais.
import { texto, estiloTexto, pincel, caixa, traco, linha } from "@compat/draw2d.ts";
import { FpsPlayerState } from "./shared/player";
import { FpsWorld } from "./shared/world";
import { FPS_GRANADAS_POR_JOGADOR, FPS_VIDA_MAX, FPS_PENTE, FPS_TEMPO_RECARGA } from "./shared/config";

/// Estado mostrado pelo FpsHudRede.
export const FPS_HUD_REDE_DESCONECTADO = 0;
export const FPS_HUD_REDE_CONECTANDO = 1;
export const FPS_HUD_REDE_RECUSADO = 2;
export const FPS_HUD_REDE_CONECTADO = 3;

// ── medidas e cores nomeadas ───────────────────────────────────────────────
const FPS_HUD_MARGEM = 14;
const FPS_HUD_LINHA = 20;
const FPS_HUD_LINHA_DEBUG = 16;
const FPS_HUD_TAM = 16;
const FPS_HUD_TAM_DEBUG = 13;
const FPS_HUD_TAM_MIRA = 20;
const FPS_HUD_MEIA_MIRA_X = 5;
const FPS_HUD_MEIA_MIRA_Y = 11;
const FPS_HUD_TOPO_DEBUG = 70;
const FPS_HUD_AVISO_DY = 40;
const FPS_HUD_AVISO_MEIA_LARGURA = 170;
const FPS_HUD_VIDA_BAIXA: f64 = 30.0;
/// Largura reservada ao contador de fps no canto superior direito.
const FPS_HUD_FPS_LARGURA = 190;
/// Textos que mudam quase todo quadro (fps, depuração) são refeitos no máximo nesse intervalo.
const FPS_HUD_INTERVALO_TEXTO_MS: f64 = 250.0;
/// Décimos de segundo (contagem do renascimento).
const FPS_HUD_DECIMOS: f64 = 10.0;
const FPS_COR_TEXTO = 0xE8F0FFFF;
const FPS_COR_ALERTA = 0xFF6060FF;
const FPS_COR_DEBUG = 0x9FB4C8FF;
const FPS_COR_MIRA = 0xFFFFFFFF;
const FPS_COR_AJUDA = 0x708096FF;
const FPS_HUD_PAINEL = 0x101D27E8;
const FPS_HUD_BORDA = 0x48616DFF;
const FPS_HUD_ACENTO = 0xE3B565FF;
const FPS_HUD_VERDE = 0x64D5B5FF;
const FPS_HUD_BASE = 0x31434DFF;
const FPS_HUD_CARD_W = 270;
const FPS_HUD_CARD_H = 108;
const FPS_HUD_RECUO = 24;
const FPS_HUD_DANO_MS = 450;
const FPS_ESTILO_NUMERO = estiloTexto(FPS_COR_TEXTO, 34);
const FPS_ESTILO_TITULO = estiloTexto(FPS_HUD_ACENTO, 19);
const FPS_ESTILO_LABEL = estiloTexto(0xA7BDC7FF, 12);

// estilos empacotados (cor + tamanho) calculados uma vez
const FPS_ESTILO_TEXTO = estiloTexto(FPS_COR_TEXTO, FPS_HUD_TAM);
const FPS_ESTILO_ALERTA = estiloTexto(FPS_COR_ALERTA, FPS_HUD_TAM);
const FPS_ESTILO_DEBUG = estiloTexto(FPS_COR_DEBUG, FPS_HUD_TAM_DEBUG);
const FPS_ESTILO_MIRA = estiloTexto(FPS_COR_MIRA, FPS_HUD_TAM_MIRA);
const FPS_ESTILO_AJUDA = estiloTexto(FPS_COR_AJUDA, FPS_HUD_TAM_DEBUG);

const FPS_TXT_MIRA = "+";
const FPS_TXT_CLIQUE = "clique para jogar (Esc solta o mouse)";
const FPS_TXT_AJUDA = "WASD anda | espaco pula | clique atira | R recarrega | G granada | N/M bot +/- | F3 depuracao";

/// Mira no centro da tela (os dois clientes).
export function fpsDesenharMira(w: number, h: number): void {
  const x = w / 2; const y = h / 2;
  traco(2, FPS_COR_MIRA);
  linha(x - 12, y, x - 5, y); linha(x + 5, y, x + 12, y);
  linha(x, y - 12, x, y - 5); linha(x, y + 5, x, y + 12);
}

/// HUD do cliente local. O cliente preenche os campos de quadro (tamanho da
/// janela, fps, tempos) e chama `desenhar(eu, mundo)`.
export class FpsHud {
  // ── entrada por quadro ──
  w: number = 1280;
  h: number = 720;
  travado: number = 0;
  debug: number = 0;
  fps: f64 = 0.0;
  agoraMs: f64 = 0.0;
  msSim: f64 = 0.0;
  msRender: f64 = 0.0;
  msAnim: f64 = 0.0;
  desenhados: number = 0;
  objetos: number = 0;
  musicaMuda: boolean = false;
  private danoAte: f64 = 0;
  private vidaAnterior: f64 = -1;
  private txtVida: string = "";
  private txtMunicao: string = "";
  private txtGranadas: string = "";

  // ── caches ──
  private vida: number = 0 - 1;
  private municao: number = 0 - 1;
  private recarga: number = 0 - 1;
  private granadas: number = 0 - 1;
  private txtStatus: string = "";
  private abates: number = 0 - 1;
  private mortes: number = 0 - 1;
  private bots: number = 0 - 1;
  private txtPlacar: string = "";
  private decimos: number = 0 - 1;
  private txtMorto: string = "";
  private ultTextoMs: f64 = 0.0 - FPS_HUD_INTERVALO_TEXTO_MS;
  private txtFps: string = "";
  private fpsInt: number = 0 - 1;
  private msDecimos: number = 0 - 1;
  private txtDbg1: string = "";
  private txtDbg2: string = "";
  private txtDbg3: string = "";

  desenhar(eu: FpsPlayerState, mundo: FpsWorld): void {
    if (eu.vivo) fpsDesenharMira(this.w, this.h);
    if (this.vidaAnterior >= 0 && eu.vida < this.vidaAnterior) this.danoAte = this.agoraMs + FPS_HUD_DANO_MS;
    this.vidaAnterior = eu.vida;
    this.atualizarStatus(eu, mundo);
    const pad = FPS_HUD_RECUO;
    const bottom = this.h - FPS_HUD_CARD_H - 45;
    const right = this.w - FPS_HUD_CARD_W - pad;
    pincel(FPS_HUD_PAINEL, 1, FPS_HUD_BORDA, 8);
    caixa(pad, 20, 338, 72);
    caixa(pad, bottom, FPS_HUD_CARD_W, FPS_HUD_CARD_H);
    caixa(right, bottom, FPS_HUD_CARD_W, FPS_HUD_CARD_H);
    texto(pad + 16, 30, "DISTRITO 09 / OPERACAO", FPS_ESTILO_TITULO);
    texto(pad + 16, 60, this.txtPlacar, FPS_ESTILO_LABEL);
    texto(pad + 16, bottom + 12, "VITALIDADE", FPS_ESTILO_LABEL);
    texto(pad + 16, bottom + 32, this.txtVida, FPS_ESTILO_NUMERO);
    texto(pad + 92, bottom + 47, eu.vida < FPS_HUD_VIDA_BAIXA ? "PROCURE COBERTURA" : "EM COMBATE", FPS_ESTILO_LABEL);
    texto(right + 16, bottom + 12, "FUZIL / AUTOMATICO", FPS_ESTILO_LABEL);
    texto(right + 16, bottom + 32, this.txtMunicao, FPS_ESTILO_NUMERO);
    texto(right + 145, bottom + 47, this.txtGranadas, FPS_ESTILO_LABEL);
    pincel(FPS_HUD_BASE, 0, 0, 2);
    caixa(pad + 16, bottom + 84, 238, 7); caixa(right + 16, bottom + 84, 238, 7);
    pincel(eu.vida < FPS_HUD_VIDA_BAIXA ? FPS_COR_ALERTA : FPS_HUD_VERDE, 0, 0, 2);
    caixa(pad + 16, bottom + 84, 238 * Math.max(0, eu.vida) / FPS_VIDA_MAX, 7);
    pincel(FPS_HUD_ACENTO, 0, 0, 2);
    caixa(right + 16, bottom + 84, 238 * (eu.tempoRecarga > 0 ? 1 - eu.tempoRecarga / FPS_TEMPO_RECARGA : eu.municao / FPS_PENTE), 7);
    if (eu.tempoRecarga > 0) texto(this.w / 2 - 64, this.h / 2 + 35, "RECARREGANDO", FPS_ESTILO_TITULO);
    if (this.agoraMs < this.danoAte && eu.vivo) {
      pincel(0xDA514BCC, 0, 0, 0);
      caixa(0, 0, this.w, 5); caixa(0, this.h - 5, this.w, 5);
      caixa(0, 0, 5, this.h); caixa(this.w - 5, 0, 5, this.h);
      texto(this.w / 2 - 46, this.h / 2 - 66, "SOB FOGO", FPS_ESTILO_ALERTA);
    }
    if (!eu.vivo) {
      const d = Math.round(Math.max(0.0, eu.tempoRenascer) * FPS_HUD_DECIMOS);
      if (d !== this.decimos) {
        this.decimos = d;
        this.txtMorto = "voce morreu, renascendo em " + (d / FPS_HUD_DECIMOS).toFixed(1) + " s";
      }
      pincel(FPS_HUD_PAINEL, 1, FPS_HUD_BORDA, 10);
      caixa(this.w / 2 - 210, this.h / 2 - 60, 420, 134);
      texto(this.w / 2 - 120, this.h / 2 - 43, "VOCE FOI ELIMINADO", FPS_ESTILO_TITULO);
      texto(this.w / 2 - 170, this.h / 2, this.txtMorto, FPS_ESTILO_TEXTO);
      texto(this.w / 2 - 145, this.h / 2 + 34, "Use os caixotes para quebrar a linha de tiro", FPS_ESTILO_LABEL);
    } else if (this.travado === 0) {
      texto(this.w / 2 - FPS_HUD_AVISO_MEIA_LARGURA, this.h / 2 + FPS_HUD_AVISO_DY, FPS_TXT_CLIQUE, FPS_ESTILO_TEXTO);
    }
    texto(pad, this.h - 27, "WASD mover   ESPACO pular   R recarregar   G granada   ESC cursor", FPS_ESTILO_LABEL);
    texto(this.w - 260, 24, this.musicaMuda ? "[P] MUSICA DESLIGADA" : "[P] NIGHT SHIFT / MUSICA ON", FPS_ESTILO_LABEL);
    if (this.agoraMs - this.ultTextoMs >= FPS_HUD_INTERVALO_TEXTO_MS) {
      this.ultTextoMs = this.agoraMs;
      this.remontarMedidas(mundo);
    }
    // fps sempre visível (canto superior direito); com vsync o teto é o monitor
    texto(this.w - 260, 46, this.txtFps, FPS_ESTILO_LABEL);
    if (this.debug !== 0) {
      let yd = FPS_HUD_TOPO_DEBUG;
      texto(FPS_HUD_MARGEM, yd, this.txtDbg1, FPS_ESTILO_DEBUG);
      yd = yd + FPS_HUD_LINHA_DEBUG;
      texto(FPS_HUD_MARGEM, yd, this.txtDbg2, FPS_ESTILO_DEBUG);
      yd = yd + FPS_HUD_LINHA_DEBUG;
      texto(FPS_HUD_MARGEM, yd, this.txtDbg3, FPS_ESTILO_DEBUG);
    }
  }

  // Vida/munição/granadas e placar: remontados só quando um valor muda.
  private atualizarStatus(eu: FpsPlayerState, mundo: FpsWorld): void {
    const vida = Math.round(eu.vida);
    const recarga = eu.tempoRecarga > 0.0 ? 1 : 0;
    const granadas = FPS_GRANADAS_POR_JOGADOR - eu.granadasVivas;
    if (vida !== this.vida || eu.municao !== this.municao || recarga !== this.recarga || granadas !== this.granadas) {
      this.vida = vida; this.municao = eu.municao; this.recarga = recarga; this.granadas = granadas;
      this.txtVida = "" + Math.max(0, vida);
      this.txtMunicao = eu.municao + " / " + FPS_PENTE;
      this.txtGranadas = "G  " + granadas;
      this.txtStatus = "vida " + vida + "   municao " + eu.municao + (recarga !== 0 ? " (recarregando)" : "") +
                       "   granadas " + granadas;
    }
    const bots = mundo.jogadores.length - 1;
    if (eu.abates !== this.abates || eu.mortes !== this.mortes || bots !== this.bots) {
      this.abates = eu.abates; this.mortes = eu.mortes; this.bots = bots;
      this.txtPlacar = "abates " + eu.abates + "   mortes " + eu.mortes + "   bots " + bots;
    }
  }

  // fps e depuração: mudam quase todo quadro, então têm intervalo mínimo.
  private remontarMedidas(mundo: FpsWorld): void {
    const msQuadro = this.fps > 0.0 ? 1000.0 / this.fps : 0.0;
    const fpsInt = Math.floor(this.fps);
    const msDecimos = Math.round(msQuadro * FPS_HUD_DECIMOS);
    if (this.txtFps.length === 0 || fpsInt !== this.fpsInt || msDecimos !== this.msDecimos) {
      this.fpsInt = fpsInt; this.msDecimos = msDecimos;
      this.txtFps = fpsInt + " fps  " + (msDecimos / FPS_HUD_DECIMOS).toFixed(1) + " ms (vsync)";
    }
    // depuração (F3): tempos mudam todo quadro; remontada a cada intervalo
    if (this.debug === 0) return;
    const m = mundo;
    const consultas = m.ultRaios + m.ultEsferas;
    const usPorConsulta = consultas > 0 ? (m.ultMsConsultas * 1000.0 / consultas) : 0.0;
    this.txtDbg1 = "fps " + Math.floor(this.fps) + "   sim/frame " + this.msSim.toFixed(2) +
                   " ms   ultimo tick " + m.ultMsTick.toFixed(2) + " ms   render " + this.msRender.toFixed(2) +
                   " ms   anim " + this.msAnim.toFixed(2) + " ms";
    this.txtDbg2 = "consultas/tick: raios " + m.ultRaios + "  esferas " + m.ultEsferas +
                   "  (" + usPorConsulta.toFixed(1) + " us cada)";
    this.txtDbg3 = "estaticos " + m.mapa.objetos + "   objetos " + this.objetos +
                   "   desenhados " + this.desenhados + "   tiros " + m.tirosDisparados;
  }
}

/// Linha de status do cliente em rede. O cliente preenche os campos do
/// quadro e lê `linhaAtual()`, remontada só quando algum deles muda.
export class FpsHudRede {
  // ── entrada por quadro ──
  /// FPS_HUD_REDE_*.
  estado: number = 0;
  ping: number = 0;
  motivo: number = 0;
  clienteId: number = 0;
  jogadores: number = 0;
  /// Clientes do servidor hospedado (só com hospedagem).
  clientes: number = 0;

  private alvo: string;
  private hospedagem: string;
  private cEstado: number = 0 - 1;
  private cPing: number = 0 - 1;
  private cMotivo: number = 0 - 1;
  private cId: number = 0 - 1;
  private cJogadores: number = 0 - 1;
  private cClientes: number = 0 - 1;
  private linha: string = "";

  /// `alvo` = "host:porta"; `portaHospedada` > 0 = hospedando nessa porta.
  constructor(alvo: string, portaHospedada: number) {
    this.alvo = alvo;
    this.hospedagem = portaHospedada > 0 ? " | hospedando na porta " + portaHospedada + ": clientes " : "";
  }

  linhaAtual(): string {
    if (this.linha.length > 0 && this.estado === this.cEstado && this.ping === this.cPing && this.motivo === this.cMotivo &&
        this.clienteId === this.cId && this.jogadores === this.cJogadores && this.clientes === this.cClientes) return this.linha;
    this.cEstado = this.estado; this.cPing = this.ping; this.cMotivo = this.motivo;
    this.cId = this.clienteId; this.cJogadores = this.jogadores; this.cClientes = this.clientes;
    if (this.estado === FPS_HUD_REDE_CONECTANDO) this.linha = "conectando em " + this.alvo + "...";
    else if (this.estado === FPS_HUD_REDE_RECUSADO) this.linha = "recusado pelo servidor (motivo " + this.motivo + ")";
    else if (this.estado === FPS_HUD_REDE_CONECTADO) {
      this.linha = "conectado: jogador " + this.clienteId + " | ping " + this.ping + " ms | jogadores " + this.jogadores;
      if (this.hospedagem.length > 0) this.linha = this.linha + this.hospedagem + this.clientes;
    } else this.linha = "desconectado do servidor";
    return this.linha;
  }

  /// Estilo da linha: alerta quando desconectado ou recusado.
  estilo(): number {
    return this.estado === FPS_HUD_REDE_CONECTANDO || this.estado === FPS_HUD_REDE_CONECTADO ? FPS_ESTILO_TEXTO : FPS_ESTILO_ALERTA;
  }
}

/// Aviso "clique para jogar" do cliente em rede, sob a linha de status.
export function fpsDesenharStatusRede(hud: FpsHudRede, travado: number): void {
  texto(FPS_HUD_MARGEM, FPS_HUD_MARGEM, hud.linhaAtual(), hud.estilo());
  if (travado === 0) texto(FPS_HUD_MARGEM, FPS_HUD_MARGEM + FPS_HUD_LINHA, FPS_TXT_CLIQUE, FPS_ESTILO_TEXTO);
}
