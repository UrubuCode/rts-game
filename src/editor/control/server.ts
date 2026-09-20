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
let curW = 0;
let curH = 0;

/// Abre a porta de controle e registra os handlers.
///
/// Vários clientes são aceitos, ao contrário da versão de poll — que só podia
/// atender um porque `S.wsClient` era UM handle e `recv` era perguntado a ele.
/// Com eventos cada conexão traz o seu próprio `ws` no callback, e a resposta
/// volta para quem perguntou sem que exista slot algum a disputar; suportar um
/// só custaria uma linha de rejeição em vez de economizar código.
export function ctrlServe(port: number): void {
  const wss = new WebSocketServer({ port: port });
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
    println("[controle] ws://127.0.0.1:" + port + " pronto");
  });

  wss.on("error", (erro: any) => {
    println("[controle] porta " + port + " indisponivel (" + erro.message +
            ") — o editor segue sem controle remoto");
    S.wsServer = 0 - 1;
  });

  wss.on("connection", (ws: any) => {
    S.wsClient = S.wsClient + 1;
    ws.send("[engine] editor conectado. envie 'help' (lista) ou 'doc' (detalhes+exemplos p/ IA).");

    ws.on("message", (dados: any) => {
      // `data` pode ser string ou Buffer conforme o frame; `toString()` é o que
      // vale para os dois, e o protocolo daqui é texto em qualquer caso.
      const msg = dados.toString();
      const lines = msg.split("\n");
      let li = 0;
      while (li < lines.length) {
        const l = lines[li].split("\r")[0];
        if (l.length > 0) ws.send(execCommand(curW, curH, l));
        li = li + 1;
      }
    });

    ws.on("close", () => { S.wsClient = S.wsClient - 1; });
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
  // -1 é a ÚNICA saída cedo. Com 0 (bind em voo) é obrigatório bombear: quem
  // entrega o `'listening'` é justamente o `pumpEvents` abaixo, e sair aqui
  // faria o estado nunca sair de 0 — o servidor abriria a porta e o editor
  // nunca ficaria sabendo. Foi o impasse que a correção do estado otimista
  // criou, e é o motivo de haver TRÊS estados em vez de dois.
  if (S.wsServer < 0) return;
  // O booleano devolvido ("alguém ainda tem trabalho") é para um laço que
  // decide dormir; aqui quem dita o ritmo é o frame, então é ignorado.
  pumpEvents();
}
