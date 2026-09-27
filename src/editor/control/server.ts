// Servidor de controle WebSocket — sobre a API de EVENTOS do pacote `ws`.
//
// A versão anterior era um POLL: `ws.recv` devolvia "" quando não havia dados, e
// `ctrlPoll` perguntava ao socket 1x por frame. Aquele namespace (`rts:ws`) era
// do motor antigo e não existe mais; o que existe é a superfície do `ws` do npm,
// onde as mensagens CHEGAM por callback em vez de serem buscadas.
//
// A troca não muda quem manda no tempo, e isso é o ponto: um callback do `ws` só
// roda quando o laço do host anda, e o laço do host só anda entre as instruções
// de topo do programa — coisa que um laço de render, sendo um `while` que nunca
// retorna, nunca oferece. Por isso `ctrlPoll` continua sendo chamada 1x por
// frame: ela deixou de perguntar ao socket e passou a CEDER o controle com
// `pumpEvents()`, que é o ponto seguro (entre dois frames) onde os callbacks
// podem rodar sem reentrar no meio de um frame do editor.
import { WebSocketServer } from "ws";

import { S } from "./session";
import { execCommand } from "./dispatch";
import { Adiado, ehRespostaAdiada, tomarAdiado, avancarAdiado } from "@editor/control/adiado";
import { logInfo, logError } from "@engine/core/logger";
import { novaConexao, definirConexaoAtual, conexaoFechou } from "@editor/control/conexao";
import { haTarefasDeFundo, rodarTarefasDeFundo } from "@editor/control/processos";

/// Uma conexão: as linhas que chegaram e ainda não rodaram, e a resposta
/// adiada que está segurando essas linhas (ver adiado.ts). As linhas de uma
/// conexão rodam EM ORDEM: `input click` seguido de `shot` só captura depois
/// que o clique aconteceu.
class ConexaoControle {
  ws: any;
  /// Identidade (conexao.ts): dona da entrada simulada e do lote que abrir.
  id: number;
  fila: string[] = [];
  espera: Adiado | null = null;
  /// A linha cuja resposta está adiada (para o log da resposta final).
  linhaEmEspera: string = "";
  constructor(ws: any) { this.ws = ws; this.id = novaConexao(); }
}
/// Conexões com uma resposta adiada pendente (olhadas 1x por quadro só
/// quando a lista não está vazia).
const esperando: ConexaoControle[] = [];

/// Roda as linhas enfileiradas da conexão até acabar ou uma adiar a resposta.
function processarFila(c: ConexaoControle): void {
  while (c.espera === null && c.fila.length > 0) {
    const linha = c.fila.shift();
    definirConexaoAtual(c.id);
    const out = execCommand(curW, curH, linha);
    definirConexaoAtual(0);
    if (ehRespostaAdiada(out)) {
      const a = tomarAdiado();
      if (a !== null) { c.espera = a; c.linhaEmEspera = linha; esperando.push(c); return; }
      c.ws.send("[erro] " + linha.split(" ")[0] + ": resposta adiada sem espera registrada");
    } else c.ws.send(out);
  }
}

/// Conclui as esperas prontas ou vencidas e retoma a fila dessas conexões.
function retomarEsperas(): void {
  let i = 0;
  while (i < esperando.length) {
    const c = esperando[i];
    const a = c.espera;
    if (a === null || avancarAdiado(a)) {
      esperando.splice(i, 1);
      c.espera = null;
      if (a !== null) {
        if (a.texto.indexOf("[erro]") === 0) logError(c.linhaEmEspera + "  ->  " + a.texto);
        else logInfo(c.linhaEmEspera + "  ->  " + a.texto);
        c.ws.send(a.texto);
      }
      processarFila(c);
    } else i = i + 1;
  }
}

/// Tamanho lógico do último frame. Antes chegava por parâmetro e era usado na
/// hora, porque o comando era LIDO dentro do próprio `ctrlPoll`. Com eventos, o
/// comando é executado dentro de um callback que não recebe parâmetro nenhum, e
/// `res`/`drop`/`pickat` precisam do tamanho ATUAL — daí o estado de módulo.
///
/// Não há janela em que fique defasado: o único ponto em que um callback roda é
/// o `pumpEvents()` no fim de `ctrlPoll`, e a atribuição acontece antes dele.
// O servidor vive numa variável de MÓDULO, não local de `ctrlServe`.
//
// O lado nativo guarda o endereço da célula da instância JS, e o coletor move
// células: um `wss` local sai de escopo quando `ctrlServe` retorna, e o que o
// Rust guardou envelhece — o `'connection'` deixa de ser entregue, com a porta
// escutando e o handshake completando (a thread de accept é nativa e não
// depende disto). Medido: `conexoes=0` depois de 2040 polls com um cliente
// conectado.
let wssRef: any = null;
/// A porta de controle executa comandos que mudam a cena e gravam arquivos: só
/// escuta no loopback. O `ws` do runtime escuta em 0.0.0.0 sem `host`.
export const CONTROLE_HOST: string = "127.0.0.1";
/// Nomes aceitos no cabeçalho Host (com ou sem ":porta").
const HOSTS_LOCAIS: string[] = ["127.0.0.1", "localhost", "[::1]"];
/// Código de fechamento "policy violation" (RFC 6455 §7.4.1).
const WS_FECHA_POLITICA: number = 1008;

/// O cabeçalho Host de uma conexão à porta de controle é local? Recusa o que
/// chega por outro nome — a defesa contra DNS rebinding, em que uma página
/// externa resolve o próprio domínio para 127.0.0.1. O `ws` do runtime não
/// expõe o `Origin` no servidor (só `req.headers.host`), então uma página
/// aberta no navegador ainda consegue abrir ws://127.0.0.1:<porta>; ver
/// docs/editor-workspace.md. Vazio (cliente sem Host) é aceito.
export function hostDeControleAceito(host: string, port: number): boolean {
  if (host.length === 0) return true;
  let nome = host.toLowerCase();
  const sufixo = ":" + port;
  if (nome.length > sufixo.length && nome.slice(nome.length - sufixo.length) === sufixo) nome = nome.slice(0, nome.length - sufixo.length);
  return HOSTS_LOCAIS.indexOf(nome) >= 0;
}
let curW = 0;
let curH = 0;

/// Porta padrão da porta de controle.
export const CONTROLE_PORTA_PADRAO: number = 7777;
/// A porta pedida em RTS_CTRL_PORT ("" ou inválida = a padrão).
export function portaDeControle(env: string): number {
  const p = Number(env);
  return env.length > 0 && p === Math.floor(p) && p >= 1 && p <= 65535 ? p : CONTROLE_PORTA_PADRAO;
}

/// Abre a porta de controle e registra os handlers.
///
/// Vários clientes são aceitos, ao contrário da versão de poll — que só podia
/// atender um porque `S.wsClient` era UM handle e `recv` era perguntado a ele.
/// Com eventos cada conexão traz o seu próprio `ws` no callback, e a resposta
/// volta para quem perguntou sem que exista slot algum a disputar; suportar um
/// só custaria uma linha de rejeição em vez de economizar código.
export function ctrlServe(port: number): void {
  const wss = new WebSocketServer({ port: port, host: CONTROLE_HOST });
  wssRef = wss;
  // Os campos da Session viram CONTADORES: nada mais no editor os lê, e um
  // handle não cabe mais neles (o `ws` agora é objeto, não número).
  //
  // ZERO até o `'listening'` CHEGAR, e isto não é preciosismo. O `bind` acontece
  // numa thread de accept, então `new WebSocketServer` retorna antes de saber se
  // a porta abriu. Marcar 1 aqui fazia o editor se dizer servindo por cerca de
  // dez segundos numa porta que nunca abriu — medido: com a 7777 ocupada, o
  // `S.wsServer` só caiu para 0 depois de 600 polls, e nesse meio-tempo toda
  // tentativa de diagnóstico apontava para o lugar errado.
  //   0 = ainda não sei (o bind está em voo)   1 = escutando   -1 = falhou
  S.wsServer = 0;

  // OBRIGATÓRIO, e a falta disto DERRUBAVA O EDITOR: um `EventEmitter` que emite
  // `'error'` sem ninguém escutando LANÇA — é o que o Node faz e o que este motor
  // copia. Uma segunda instância do editor (ou qualquer processo na 7777) faz o
  // bind falhar, o servidor emite `'error'`, e o editor inteiro morria com
  // "uncaught 'error' event: an object" — uma porta ocupada matando um programa
  // gráfico que não tem nada a ver com isso.
  //
  // A porta de controle é um EXTRA: sem ela o editor abre e funciona, só não
  // aceita comandos. Então o erro é avisado e engolido, e essa é a diferença
  // entre um recurso opcional e um requisito.
  // A confirmação de que a porta É NOSSA. Só a partir daqui o `ctrlPoll` bombeia.
  wss.on("listening", () => {
    S.wsServer = 1;
    println("[controle] ws://" + CONTROLE_HOST + ":" + port + " pronto");
  });

  wss.on("error", (erro: any) => {
    println("[controle] porta " + port + " indisponivel (" + erro.message +
            ") — o editor segue sem controle remoto");
    S.wsServer = 0 - 1;
  });

  wss.on("connection", (ws: any, req: any) => {
    const host = req !== undefined && req !== null && req.headers !== undefined && typeof req.headers.host === "string" ? req.headers.host : "";
    if (!hostDeControleAceito(host, port)) {
      println("[controle] conexão recusada: Host '" + host + "' não é local");
      ws.on("error", (_e: any) => { });
      ws.close(WS_FECHA_POLITICA, "host nao local");
      return;
    }
    S.wsClient = S.wsClient + 1;
    ws.send("[engine] editor conectado. envie 'help' (lista), 'doc' (detalhes+exemplos) ou 'doc json' (manifesto p/ IA).");

    const con = new ConexaoControle(ws);
    ws.on("message", (dados: any) => {
      // `data` pode ser string ou Buffer conforme o frame; `toString()` é o que
      // vale para os dois, e o protocolo daqui é texto em qualquer caso.
      const msg = dados.toString();
      const lines = msg.split("\n");
      // Uma mensagem que começa com a linha `batch` (ou `txn`) sozinha é um
      // LOTE inteiro: vira `batch begin` + as linhas + `batch end` (lote.ts).
      const primeira = lines.length > 1 ? lines[0].split("\r")[0].trim() : "";
      const loteNaMensagem = primeira === "batch" || primeira === "txn";
      let li = loteNaMensagem ? 1 : 0;
      if (loteNaMensagem) con.fila.push(primeira + " begin");
      while (li < lines.length) {
        const l = lines[li].split("\r")[0];
        if (l.length > 0) con.fila.push(l);
        li = li + 1;
      }
      if (loteNaMensagem) con.fila.push(primeira + " end");
      processarFila(con);
    });

    ws.on("close", () => {
      S.wsClient = S.wsClient - 1;
      // quem fechou não recebe mais nada: a espera dele é abandonada
      con.fila = [];
      const k = esperando.indexOf(con);
      if (k >= 0) esperando.splice(k, 1);
      if (con.espera !== null) con.espera.abandonado = true;
      con.espera = null;
      // solta a entrada simulada e desfaz o lote que esta conexão deixou
      conexaoFechou(con.id);
    });
    // Sem este handler um erro de socket sobe como exceção não capturada e leva
    // o editor junto — o cliente que caiu não deve derrubar a cena de quem está
    // olhando a tela.
    ws.on("error", (_e: any) => { });
  });
}

/// Chamar 1x por frame. Não lê o socket: entrega ao motor a janela em que os
/// callbacks registrados acima podem rodar. `w`/`h` são guardados para os
/// comandos que dependem do tamanho da tela.
export function ctrlPoll(w: number, h: number): void {
  curW = w;
  curH = h;
  // processos da porta (testes, captura): prazo e limpeza com ou sem cliente
  if (haTarefasDeFundo()) rodarTarefasDeFundo();
  // -1 é a ÚNICA saída cedo. Com 0 (bind em voo) é obrigatório bombear: quem
  // entrega o `'listening'` é justamente o `pumpEvents` abaixo, e sair aqui
  // faria o estado nunca sair de 0 — o servidor abriria a porta e o editor
  // nunca ficaria sabendo. Foi o impasse que a correção do estado otimista
  // criou, e é o motivo de haver TRÊS estados em vez de dois.
  if (S.wsServer < 0) return;
  if (esperando.length > 0) retomarEsperas();
  // O booleano devolvido ("alguém ainda tem trabalho") é para um laço que
  // decide dormir; aqui quem dita o ritmo é o frame, então é ignorado.
  pumpEvents();
}
