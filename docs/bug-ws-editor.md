# Bug aberto: o `'connection'` não chega ao editor

**Status: não resolvido.** Escrito em 2026-08-10, com o que foi verificado, para
que a próxima investigação comece onde esta parou em vez de repetir as quatro
hipóteses já mortas.

## O sintoma

O editor (`main.ts`) abre a porta 7777, um cliente WebSocket conecta, o handshake
completa — e o editor nunca responde. Nenhum comando (`dbg`, `state`, `fisica`)
chega ao `execCommand`.

A mesma porta de controle **funciona** em `demo_ws_controlada.ts`, que usa a
mesma superfície `ws` do motor.

## O que foi VERIFICADO (não suposto)

Instrumentei o `ctrlPoll` para escrever o estado num arquivo, porque o `stdout`
do editor não descarrega enquanto ele vive:

```
polls=2040 wsServer=1 clientes=0 conexoes=0
```

com um cliente conectado durante a medição. Disso sai o que está descartado:

| hipótese | veredito |
|---|---|
| O `ctrlPoll` não está sendo chamado | **falsa** — 2040 polls |
| A porta não abriu / está ocupada | **falsa** — `wsServer=1` vem do evento `'listening'` |
| O `pumpEvents` não roda | **falsa** — é ele que entrega o `'listening'` |
| A referência ao `wss` morreu (GC movendo a célula) | **falsa** — testado com o servidor numa variável de MÓDULO, mesmo resultado |
| O handshake falha | **falsa** — um cliente TCP cru recebe `HTTP/1.1 101 Switching Protocols` com `Sec-WebSocket-Accept` correto |

## A pista mais fina

**`'listening'` É entregue e `'connection'` NÃO.**

Os dois passam pela mesma tabela (`conn::with_servers`), são drenados pelo mesmo
`drain_servers`, filtrados pelo mesmo `owner`/`instance`, e emitidos pelo mesmo
`emit`. O que os distingue:

- `Listening` é empurrado **antes** do laço de accept, direto na thread do
  servidor.
- `Connected` é empurrado **depois** de `apertar_mao` e de `adopt`, e carrega
  DOIS argumentos para o JS (o socket e o objeto de requisição), sendo que o
  socket é uma instância JS criada dentro do próprio pump (`make_socket`).

Ou seja: a diferença está em `Connected` construir objetos JS durante a entrega,
ou em carregar dois argumentos, ou em `adopt` rodar na thread de accept.

## Por onde eu começaria

1. Instrumentar `crates/rts-node/src/ws/api.rs::pump` com `eprintln!` no ramo
   `ServerEvent::Connected` — saber se ele CHEGA a rodar separa "o evento não é
   drenado" de "o evento roda e o `emit` não acha o handler".
2. Se ele roda, comparar o `instancia` (u64) usado no `emit` com o que
   `bind_server_instance` guardou. Um handler que não é achado com o objeto certo
   é outro problema que não o de entrega.
3. Comparar com `demo_ws_controlada.ts` INSTRUMENTADA do mesmo jeito: ela
   funciona, e a diferença entre os dois caminhos é o que sobra.

## Por que não foi resolvido agora

A sessão tinha um objetivo declarado — física — e esta porta é uma FERRAMENTA de
medição, não o objetivo. A física foi medida por benchmarks headless
(`tools/claude-bench-*.ts`), que não dependem dela. Registrado aqui em vez de
esquecido, porque uma porta de controle que não responde no editor é justamente o
que impede medir os dois backends na mesma cena sem depender de alguém olhando a
tela.
