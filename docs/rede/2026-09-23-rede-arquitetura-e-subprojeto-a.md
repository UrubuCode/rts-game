# Rede do motor: arquitetura e subprojeto A (desenho)

- **Data:** 2026-09-23
- **Issue:** [UrubuCode/rts-game#11](https://github.com/UrubuCode/rts-game/issues/11)
- **Onde nasce:** `rts-fps/src/net/`, com API genérica (nada de FPS dentro). Vira PR no rts-game quando estiver estável.
- **Primeiro usuário:** o FPS (`src/server.ts` novo e `src/client.ts`).

## 1. Objetivo

Dar ao motor um sistema de rede no nível dos motores maduros (a replicação
e a predição da Unreal, o Photon Fusion, o Netcode for Entities da Unity),
com uma cara familiar para quem vem da Unity (`NetworkObject`, componentes
de rede, RPC), mas sem prender o desempenho a essa API.

## 2. Arquitetura em camadas

```
 6  Compensação de lag  histórico do índice espacial para validar tiro "no passado"
 5  Predição            por objeto: previsto (o seu), interpolado (os outros) ou autoridade
 4  RPC e variáveis     chamadas confiáveis/não confiáveis; estado declarativo replicado
 3  Replicação          NetworkObject, criação/destruição, snapshots, relevância, banda
 2  Tick e relógio      tick fixo compartilhado, estimativa do tick do servidor, buffer de inputs
 1  Transporte          UDP, canal confiável e não confiável, conexão, batimento, perda
```

**Princípios:**
- **O núcleo é por tick:** clientes mandam **inputs** por tick, e o servidor autoritativo manda **snapshots** de estado. É o único modelo que aguenta jogo rápido pela internet, e combina com o `FpsWorld`, que já é tick fixo e determinístico.
- **A predição é opcional por objeto** (camada 5): um jogo de turno não usa, um FPS usa no próprio jogador.
- **Compensação de lag no motor** (camada 6): mexe no índice espacial, e nenhum jogo consegue fazê-la bem por fora.
- **Transporte plugável:** UDP em produção e um **transporte em memória** para testes determinísticos, com perda e atraso simulados.
- **Porta aberta para lockstep:** jogos com milhares de unidades costumam mandar só inputs e simular tudo em cada máquina. As camadas 1 e 2 servem a esse modo. **Fora de escopo agora.**

## 3. Roteiro

| # | subprojeto | camadas | ao terminar dá para... |
|---|---|---|---|
| **A** | transporte, tick e replicação básica | 1–3 | abrir duas janelas e ver o outro jogador andar (sem predição: o próprio movimento chega com o atraso do ping) |
| B | RPC e variáveis sincronizadas | 4 | tiro, dano, morte e placar em rede |
| C | predição e interpolação | 5 | jogar pela internet sem sentir atraso no próprio movimento |
| D | compensação de lag | 6 | acertar o que você viu, com ping de 100 ms |

Cada subprojeto tem spec, plano e entrega jogável próprios. **Esta spec detalha só o A.**

## 4. Subprojeto A: escopo

**Entra:**
- transporte UDP e em memória;
- conexão com versão e recusa;
- batimento e desconexão por tempo;
- canal confiável ordenado e canal não confiável;
- `NetworkObject` com criação e destruição replicadas;
- `NetworkTransform`;
- gancho `NetworkBehaviour` para estado customizado;
- snapshots completos a taxa fixa;
- inputs do cliente com redundância;
- integração no FPS: `server.ts` sem janela e modo "conectar" no cliente, só com **movimento**.

**Não entra (vai para B, C e D):**
- tiro, dano e placar em rede;
- RPC e variáveis declarativas;
- predição e interpolação (no A, os objetos remotos saltam de snapshot em snapshot);
- snapshots em delta;
- relevância por distância;
- compensação de lag;
- criptografia e autenticação.

## 5. Critérios de sucesso do A

1. Duas janelas do cliente (mesmo PC, UDP em `127.0.0.1`) conectam num `server.ts` e cada uma vê o outro jogador se mover.
2. Teste sem janela: servidor e **16 clientes** no transporte em memória. O input de cada cliente move o jogador dele no servidor, e todos os outros veem a posição nova em até 4 ticks de snapshot.
3. Com **20% de perda** simulada, a conexão se mantém e **toda** mensagem confiável chega, em ordem e sem duplicata.
4. Banda do servidor para cada cliente **≤ 30 KB/s** com 16 jogadores a 30 snapshots/s, medida e colada.
5. Custo da rede no tick do servidor com 16 clientes **≤ 0,5 ms** (mediana), medido e colado.
6. Cliente que some é desconectado em 5 s, e o jogador dele sai do mundo de todos.

## 6. Estrutura

```
src/net/                      genérico: nada importa src/shared/ nem conhece FPS
  config.ts                   constantes NET_*
  buffer.ts                   NetWriter / NetReader (DataView, little-endian)
  protocol.ts                 cabeçalho, tipos de mensagem, versão
  transport.ts                interface NetTransport + NetTransporteMemoria (perda/atraso, PRNG semeado)
  transport_udp.ts            NetTransporteUdp (node:dgram)
  connection.ts               estado por par: seq/ack/ackBits, fila confiável, RTT, último contato
  replication.ts              registro de NetworkObject, spawn/despawn, montar/aplicar snapshot
  components.ts               NetworkObject, NetworkTransform, interface NetworkBehaviour
  server.ts                   NetServidor: aceita conexões, recebe inputs, envia snapshots
  client.ts                   NetCliente: conecta, envia inputs, aplica snapshots
src/servidor_jogo.ts          FPS: FpsServidorJogo (sem janela, testável)
src/cliente_rede.ts           FPS: FpsClienteRede (sem janela, testável)
src/server.ts                 FPS: laço do servidor dedicado (UDP)
src/client_rede.ts            FPS: janela do modo conectado
src/entrada.ts, src/render.ts teclado/mouse e desenho, usados pelos dois clientes
tests/net-*.ts                testes sem janela sobre o transporte em memória
```

`src/net/` segue as mesmas regras do `CLAUDE.md` com prefixo `Net`/`net`/`NET_`, e **não importa nada de `src/shared/`**. Um teste importa só `src/net/` para provar isso.

## 7. Transporte (camada 1)

```
interface NetTransport {
  enviar(destino: number, dados: Uint8Array, tamanho: number): void;
  bombear(aoReceber: (origem: number, dados: Uint8Array, tamanho: number) => void): void;
  fechar(): void;
}
```

- Os pares são identificados por **número**. O transporte UDP mapeia `"ip:porta"` → id.
- **`NetTransporteUdp`:** um socket `node:dgram`. `bombear` chama uma função do dgram para os eventos pendentes chegarem (medido: sem isso nada chega), guarda as mensagens num buffer próprio e entrega em ordem de chegada. Lê os bytes do `Uint8Array` diretamente (o motor não entrega `Buffer`).
- **`NetTransporteMemoria`:** pares em memória com `perda` (0..1), `atrasoTicks` e PRNG semeado. Os testes ficam determinísticos.
- **Tamanho máximo de pacote:** `NET_MTU = 1200` bytes.

## 8. Protocolo

**Cabeçalho de todo pacote (12 bytes, little-endian):**

| campo | tipo | uso |
|---|---|---|
| magia | u16 | `0x4652` ("RF") |
| versão | u8 | `NET_VERSAO_PROTOCOLO`; diferente = recusa |
| tipo | u8 | ver tabela abaixo |
| seq | u16 | número deste pacote (cresce, com volta) |
| ack | u16 | último seq recebido do par |
| ackBits | u32 | bit i = recebeu `ack - 1 - i` |

**Tipos:**

| tipo | sentido | canal | conteúdo |
|---|---|---|---|
| `CONECTAR` | c→s | repetido até resposta | nada além do cabeçalho |
| `BEMVINDO` | s→c | confiável | id do cliente, tick do servidor, taxa de tick, taxa de snapshot, bytes de "boas-vindas" do jogo (o FPS manda a semente e a escala do mapa) |
| `RECUSADO` | s→c | direto | motivo (u8: versão, lotado) |
| `DESCONECTAR` | ambos | direto, 3 vezes | motivo |
| `DADOS` | ambos | misto | seção confiável (mensagens com id e bytes) + seção não confiável |

**Canal confiável ordenado:** cada mensagem confiável tem `idMsg` (u16) e vai **junto de todo pacote enviado** até o par confirmar, pelo ack, o recebimento de um pacote que a continha. O receptor entrega em ordem (`idMsg` esperado), guarda as adiantadas e descarta as repetidas. Até `NET_MAX_CONFIAVEIS_PENDENTES = 64` por par; acima disso a conexão cai (o par não está confirmando).

**Mensagens do A dentro de `DADOS`:**

| mensagem | canal | conteúdo |
|---|---|---|
| `SPAWN` | confiável | netId (u16), tipo (u16), dono (u8, 255 = servidor), bytes iniciais |
| `DESPAWN` | confiável | netId |
| `SNAPSHOT` | não confiável | tick (u32), n (u16), para cada objeto: netId + bytes dos componentes |
| `INPUT` | não confiável | os últimos `NET_INPUTS_REDUNDANTES = 3` inputs, cada um com seq (u16) + bytes do jogo |

Se um snapshot passa do MTU, ele é dividido em vários pacotes `SNAPSHOT` do mesmo tick, e o cliente aplica cada um ao chegar. O estado é completo por objeto, então aplicar parcialmente não quebra nada.

## 9. Tick, relógio e inputs (camada 2)

- O servidor roda o tick do jogo (60 Hz no FPS) e envia snapshots a `NET_TAXA_SNAPSHOT = 30` Hz.
- **RTT:** o remetente guarda o instante de envio de cada `seq`; quando o ack volta, calcula a amostra e suaviza (média móvel exponencial, α = 0,1).
- **Tick estimado do servidor no cliente:** o tick do último snapshot + o tempo desde que ele chegou, em ticks. No A isso serve só para depuração; ganha uso na predição (C).
- **Inputs:** o cliente produz um input por tick seu, com `seq` crescente, e manda os 3 últimos em cada pacote. Com isso, perder um pacote não perde input. O servidor guarda o maior `seq` já aplicado por cliente e aplica **um input por tick de servidor**, o mais antigo ainda não aplicado. Sem input novo, **repete o último**, o comportamento padrão de FPS.

## 10. Replicação e componentes (camada 3)

```
class NetworkObject extends Behavior      // identidade de rede do GameObject
  netId: number; tipo: number; dono: number;

interface NetworkBehaviour                 // qualquer componente que tenha estado de rede
  netEscrever(w: NetWriter): void;         // servidor: estado atual
  netLer(r: NetReader): void;              // cliente: aplica o estado

class NetworkTransform extends Behavior implements NetworkBehaviour
  // posição f32 × 3 + yaw quantizado em u16
```

- **Servidor:** `netSpawn(go, tipo, dono)` dá um `netId` (reaproveitado só depois que todos os clientes confirmaram o `DESPAWN`), manda `SPAWN` para todos e, a quem conectar depois, os `SPAWN` de tudo o que existe. `netDespawn(go)` manda `DESPAWN`.
- **Cliente:** o jogo registra fábricas `netRegistrarTipo(tipo, (netId, r) => GameObject)`. Ao receber `SPAWN`, a fábrica cria o objeto e a camada de rede o põe na cena com `scene.add`.
- **Snapshot:** para cada `NetworkObject`, o servidor escreve o `netId` e depois os `NetworkBehaviour` do objeto, em ordem fixa de componente. O cliente lê na mesma ordem.
- **Ordem determinística:** objetos em ordem crescente de `netId`, componentes na ordem de `behaviors`.

## 11. Integração com o FPS

- **`src/server.ts`**, sem janela, rodado com `rts.exe run`:
  - cria o `FpsWorld` (semente e escala mandadas no `BEMVINDO`) e o `NetServidor` na porta `27015`;
  - cada cliente que conecta vira um jogador (`adicionarJogador(false)`) cujo corpo ganha `NetworkObject` + `NetworkTransform`, e bots opcionais (`FPS_BOTS_SERVIDOR`) também são replicados;
  - o input do cliente vira o `FpsPlayerInput` daquele jogador no `passo`;
  - loop: bombear a rede, `passo`, a cada 2 ticks enviar snapshot, dormir até o próximo tick.
- **`src/client_rede.ts`** (arquivo de entrada novo; o `src/client.ts` continua sendo o modo local contra bots, sem mudança de comportamento):
  - conecta em `FPS_SERVIDOR=ip:porta` (padrão `127.0.0.1:27015`);
  - gera o mapa localmente a partir da semente do `BEMVINDO`, não simula os jogadores, cria os remotos pelas fábricas, envia o seu input a cada tick e desenha o estado replicado;
  - a câmera segue o próprio jogador **replicado** (sem predição no A).
  - O runtime não escolhe módulo em tempo de execução, por isso são dois arquivos de entrada. Leitura de teclado/mouse e desenho da cena passam para `src/entrada.ts` e `src/render.ts`, usados pelos dois.
- A lógica sem janela fica em `src/servidor_jogo.ts` (`FpsServidorJogo`) e `src/cliente_rede.ts` (`FpsClienteRede`), para ser testada sem socket; `server.ts` e `client_rede.ts` só fazem o laço.
- O `FpsPlayerInput` ganha `fpsEscreverInput(w, inp)` e `fpsLerInput(r, inp)`, com um formato binário fixo de 7 bytes (frente, lado, bits de ação, yaw quantizado, pitch em i16).

## 12. Testes

Todos sem janela, sobre o `NetTransporteMemoria`:

| arquivo | verifica |
|---|---|
| `net-buffer.ts` | ida e volta de u8/u16/u32/i16/f32 e ângulo quantizado; leitura além do fim é erro detectado, não lixo |
| `net-conexao.ts` | conecta, recebe `BEMVINDO` com os bytes do jogo; versão errada é recusada; servidor lotado recusa; silêncio de 5 s desconecta dos dois lados |
| `net-confiavel.ts` | 1.000 mensagens confiáveis com 20% de perda e atraso: todas chegam, em ordem, sem duplicata |
| `net-replicacao.ts` | `SPAWN`/`DESPAWN` chegam; quem conecta depois recebe o que já existia; o snapshot aplica posição e yaw; `netId` não é reaproveitado antes da confirmação |
| `net-fps.ts` | servidor FPS + 16 clientes em memória: o input move o jogador certo e todos veem em até 4 snapshots; mede banda por cliente e custo de rede no tick (critérios 4 e 5) |

E a verificação manual: duas janelas via UDP local (critério 1).

## 13. Riscos

- **Custo do dgram com 16 pares:** o teste de viabilidade mediu 1 par. O `net-fps` mede com 16 no transporte em memória, e a verificação manual confere o UDP real com 2.
- **Fábrica do cliente × `scene.add`:** criar objetos no meio do frame precisa respeitar a fila incremental do índice espacial. Os objetos remotos são dinâmicos, e a fila foi feita para isso.
- **Tamanho do snapshot:** 16 jogadores × ~15 bytes ≈ 240 bytes, bem abaixo do MTU. A divisão em vários pacotes existe para quando os objetos crescerem (projéteis no B).
