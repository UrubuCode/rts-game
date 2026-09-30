// Constantes da camada de rede (genérica: nada aqui conhece o jogo).

// ── protocolo ──────────────────────────────────────────────────────────────
export const NET_MAGIA = 0x4652;               // "RF"
export const NET_VERSAO_PROTOCOLO = 1;
export const NET_TAM_CABECALHO = 12;
export const NET_MTU = 1200;
// NetTransporteComposto: os pares da parte B ficam deslocados por esta faixa
// (a parte A usa 0..faixa-1). Um transporte só não passa disso: são índices.
export const NET_FAIXA_PAR_COMPOSTO = 65536;
export const NET_FLAG_ACK = 0x80;              // no byte de tipo: o campo ack é válido

// tipos de pacote
export const NET_PKT_CONECTAR = 1;
export const NET_PKT_RECUSADO = 2;
export const NET_PKT_DESCONECTAR = 3;
export const NET_PKT_DADOS = 4;

// mensagens dentro de DADOS
export const NET_MSG_BEMVINDO = 1;
export const NET_MSG_SPAWN = 2;
export const NET_MSG_DESPAWN = 3;
export const NET_MSG_SNAPSHOT = 4;
export const NET_MSG_INPUT = 5;

// motivos de recusa
export const NET_RECUSA_VERSAO = 1;
export const NET_RECUSA_LOTADO = 2;

// ── conexão ────────────────────────────────────────────────────────────────
export const NET_JANELA_SEQ = 1024;            // registro de pacotes enviados (anel)
export const NET_MAX_CONFIAVEIS_PENDENTES = 64;
export const NET_ORCAMENTO_CONFIAVEL = 400;    // bytes de confiáveis por pacote
export const NET_MAX_TAM_CONFIAVEL = 380;
// maior mensagem não confiável que cabe garantidamente num pacote mesmo com
// confiáveis pendentes ocupando todo o orçamento: cabeçalho + contagem de
// confiáveis (1) + orçamento de confiáveis + contagem de não confiáveis (1) +
// tamanho da própria mensagem (2).
export const NET_MAX_TAM_NAO_CONFIAVEL =
  NET_MTU - NET_TAM_CABECALHO - 1 - NET_ORCAMENTO_CONFIAVEL - 1 - 2;
export const NET_TEMPO_LIMITE_S: f64 = 5.0;
export const NET_INTERVALO_CONECTAR_S: f64 = 0.25;
export const NET_ALFA_RTT: f64 = 0.1;
export const NET_REPETICOES_DESCONECTAR = 3;
export const NET_MAX_PACOTES_POR_ENVIO = 8;

// estados do cliente
export const NET_ESTADO_DESCONECTADO = 0;
export const NET_ESTADO_CONECTANDO = 1;
export const NET_ESTADO_CONECTADO = 2;
export const NET_ESTADO_RECUSADO = 3;

// ── inputs ─────────────────────────────────────────────────────────────────
export const NET_INPUTS_REDUNDANTES = 3;
export const NET_JANELA_INPUT = 64;
export const NET_MAX_ATRASO_INPUT = 6;         // ticks de input acumulados antes de pular
export const NET_MAX_TAM_INPUT = 32;

// ── replicação ─────────────────────────────────────────────────────────────
export const NET_TAXA_SNAPSHOT = 30;           // por segundo
export const NET_ORCAMENTO_SNAPSHOT = 700;     // bytes por mensagem de snapshot
export const NET_MAX_NETID = 65535;
export const NET_DONO_SERVIDOR = 255;
