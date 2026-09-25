// Engine RTS — LOG com histórico consultável.
//
// `io.print` escreve no stdout do processo, que some assim que a janela do
// editor abre: para ler qualquer coisa era preciso redirecionar a saída para um
// arquivo ANTES de rodar, e mesmo assim não dava para consultar o passado sem
// fechar o programa. Isso quebra o fluxo de trabalho desta engine, em que a
// verificação é feita por comando WebSocket com o editor VIVO.
//
// Aqui as mensagens ficam num anel em memória, consultáveis por `log` no
// WebSocket — inclusive filtrando por texto e por nível. Um script pode chamar
// `logInfo("cheguei aqui")` e a resposta aparece no cliente, não numa janela
// que talvez esteja coberta.
//
// Uso:
//   logInfo("carreguei " + n + " objetos");
//   logWarn("textura ausente: " + path);
//   logError("cena invalida");
//   ... e no WebSocket: `log`, `log 50`, `log erro`, `log warn`

import io from "@compat/io.ts";

/// Níveis. `LOG_DEBUG` sai por padrão (ver `minLevel`) — é para rastreio pesado
/// que não deve poluir o histórico de quem só quer ver o que deu errado.
export const LOG_DEBUG = 0;
export const LOG_INFO = 1;
export const LOG_WARN = 2;
export const LOG_ERROR = 3;

/// Tamanho do anel. 512 cobre bem mais que um episódio de investigação e não
/// cresce sem limite num jogo que roda por horas — o log é diagnóstico, não
/// armazenamento.
const CAP = 512;

let msgs: string[] = [];
let lvls: number[] = [];
let lgSources: string[] = [];
let lgLines: number[] = [];
let lgIds: number[] = [];
/// Frame em que cada mensagem foi gravada. Nome com prefixo `lg` porque um
/// `let` de topo COLIDE em silêncio entre módulos neste runtime: chamando-se
/// `frames`, ele batia com o `let frames` do main.ts e o carimbo saía
/// "fundefined" — só no editor, nunca em teste isolado.
let lgFrames: number[] = [];
/// Índice de escrita no anel e total já escrito (para numerar as mensagens de
/// forma estável mesmo depois de dar a volta).
let head = 0;
let total = 0;
let lgRevision = 0;
/// Abaixo disto a mensagem é descartada na origem.
let minLevel = LOG_INFO;
/// 1 = também escreve no stdout. Ligado por padrão: em execução headless
/// (testes, harness) o stdout é o único canal, e desligá-lo esconderia tudo.
let echo = 1;
/// Frame atual, para carimbar as mensagens. Quem roda o laço chama `logTick`.
let lgCurFrame = 0;

export function setLogLevel(l: number): void { minLevel = l; }
export function setLogEcho(on: number): void { echo = on; }
/// Avança o contador de frames do log. Chamar UMA vez por frame.
///
/// O contador vive AQUI e não é recebido de fora: passar `frames` do main.ts
/// chegava como `undefined` (a armadilha do gcell — um `let` de módulo lido
/// dentro de uma função), e o carimbo saía "fundefined". Manter o estado no
/// mesmo módulo que o consome contorna isso.
export function logTick(): void { lgCurFrame = lgCurFrame + 1; }

function push(level: number, msg: string, source: string = "", line: number = 0): void {
  if (level < minLevel) return;
  while (msgs.length < CAP) { msgs.push(""); lvls.push(0); lgFrames.push(0); lgSources.push(""); lgLines.push(0); lgIds.push(0); }
  msgs[head] = msg;
  lvls[head] = level;
  lgFrames[head] = lgCurFrame;
  lgSources[head] = source; lgLines[head] = line;
  lgIds[head] = total + 1;
  head = head + 1;
  if (head >= CAP) head = 0;
  total = total + 1;
  lgRevision = lgRevision + 1;
  if (echo !== 0) io.print(tag(level) + " " + msg);
}

function tag(level: number): string {
  if (level === LOG_ERROR) return "[erro]";
  if (level === LOG_WARN) return "[aviso]";
  if (level === LOG_DEBUG) return "[debug]";
  return "[info]";
}

export function logDebug(m: string): void { push(LOG_DEBUG, m); }
export function logInfo(m: string): void { push(LOG_INFO, m); }
export function logWarn(m: string): void { push(LOG_WARN, m); }
export function logError(m: string, source: string = "", line: number = 0): void { push(LOG_ERROR, m, source, line); }

export class LogEntry {
  id: number = 0;
  message: string; level: number; frame: number; source: string; line: number;
  constructor(message: string, level: number, frame: number, source: string, line: number) {
    this.message = message; this.level = level; this.frame = frame; this.source = source; this.line = line;
  }
}

// Structured snapshot for editor consumers; never expose the mutable ring.
export function logEntries(level: number = LOG_INFO, query: string = ""): LogEntry[] {
  const result: LogEntry[] = [];
  const start = total > CAP ? head : 0;
  let i = 0;
  while (i < msgs.length) {
    const index = (start + i) % CAP;
    if (msgs[index].length > 0 && lvls[index] >= level && msgs[index].toLowerCase().indexOf(query.toLowerCase()) >= 0) {
      const entry = new LogEntry(msgs[index], lvls[index], lgFrames[index], lgSources[index], lgLines[index]);
      entry.id = lgIds[index]; result.push(entry);
    }
    i = i + 1;
  }
  return result;
}

/// Quantas mensagens já passaram pelo log (não o que cabe no anel).
export function logCount(): number { return total; }
export function logRevision(): number { return lgRevision; }

/// Quantas foram gravadas com nível >= `level`. É o resumo que responde "deu
/// erro em algum momento?" sem ler o histórico inteiro.
export function logCountAtLeast(level: number): number {
  const n = msgs.length < CAP ? msgs.length : CAP;
  let c = 0;
  let i = 0;
  while (i < n) {
    if (msgs[i] !== "" && lvls[i] >= level) c = c + 1;
    i = i + 1;
  }
  return c;
}

/// As últimas `n` mensagens, da mais ANTIGA para a mais nova (ordem de leitura
/// natural), opcionalmente filtradas por nível mínimo e por um trecho de texto.
/// `filter` vazio = sem filtro de texto.
export function logTail(n: number, level: number, filter: string): string {
  const cap = msgs.length < CAP ? msgs.length : CAP;
  if (cap === 0) return "[log] vazio";
  // percorre do mais antigo ao mais novo dentro do anel
  const start = total > CAP ? head : 0;
  const out: string[] = [];
  let i = 0;
  while (i < cap) {
    let idx = start + i;
    if (idx >= CAP) idx = idx - CAP;
    const m = msgs[idx];
    if (m !== "" && lvls[idx] >= level) {
      if (filter === "" || contains(m, filter)) {
        out.push("f" + lgFrames[idx] + " " + tag(lvls[idx]) + " " + m);
      }
    }
    i = i + 1;
  }
  if (out.length === 0) return "[log] nenhuma mensagem casa com o filtro";
  // devolve só as ÚLTIMAS n
  let from = out.length - n;
  if (from < 0) from = 0;
  let s = "[log] " + (out.length - from) + " de " + total + " total";
  let k = from;
  while (k < out.length) { s = s + " | " + out[k]; k = k + 1; }
  return s;
}

/// `indexOf` de substring — o subset não expõe um, e comparar por fatia é o
/// caminho que já funciona no resto do editor.
function contains(hay: string, needle: string): number {
  const hn = hay.length;
  const nn = needle.length;
  if (nn === 0) return 1;
  if (nn > hn) return 0;
  let i = 0;
  while (i <= hn - nn) {
    let j = 0;
    let hit = 1;
    while (j < nn) {
      if (hay.charCodeAt(i + j) !== needle.charCodeAt(j)) { hit = 0; j = nn; }
      else j = j + 1;
    }
    if (hit !== 0) return 1;
    i = i + 1;
  }
  return 0;
}

/// Esvazia o histórico (não o total acumulado, que segue contando).
export function logClear(): void {
  lgRevision = lgRevision + 1;
  let i = 0;
  while (i < msgs.length) { msgs[i] = ""; i = i + 1; }
  head = 0;
}
