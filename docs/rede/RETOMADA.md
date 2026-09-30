# Retomada: rede, subprojeto A

**Última atualização: 2026-09-25.** Branch `feature/rede-subprojeto-a` (também no GitHub).
- Plano: `docs/rede/2026-09-23-rede-subprojeto-a-plano.md`.
- Spec: `docs/rede/2026-09-23-rede-arquitetura-e-subprojeto-a.md`.
- Execução: por subagentes (implementador + revisor por tarefa).
- Registro de progresso: em `.superpowers/sdd/2026-09-23-rede-subprojeto-a-plano/progress.md` (ignorado pelo git); a cópia está no fim desta nota.

## Estado

| Tarefa | Estado |
|---|---|
| 1 buffers e cabeçalho | ✅ revisada |
| 2 transportes (memória, UDP) | ✅ revisada |
| 3 conexão / canal confiável | ✅ revisada (2 correções de defeitos do plano) |
| 4 servidor e cliente | ✅ revisada (3 correções) |
| 5 NetworkObject e snapshots | ✅ revisada |
| 6 FPS em rede sem janela | ✅ revisada, com 1 pendência de desempenho (abaixo) |
| 7 janelas, servidor UDP, `config/rede.json` | ✅ testada e verificada com janelas (2026-09-25); **sem revisão** ainda |
| 7b modo `hospedar` (listen server) | ✅ implementado com teste (`net-hospedar`) e verificado com janelas; **sem revisão** |
| 8 medições, README, issue | ❌ não iniciada |

## Tarefa 7 e modo hospedar: o que foi feito em 2026-09-25

Sem commit (a pedido); tudo na árvore de trabalho do branch. Arquivos:
- `src/net/transport.ts`: `NetTransporteComposto(a, b)` — dois transportes num só para o `NetServidor`; os pares de `b` ganham `NET_FAIXA_PAR_COMPOSTO` (65536, em `src/net/config.ts`). Sem alocação por chamada.
- `src/net/transport_udp.ts`: **duas correções medidas** (ver "Achados" abaixo): `bombear()` agora manda um datagrama de 0 bytes à própria porta (é o que faz o runtime entregar; `address()` não entrega) e `chegou()` descarta datagramas vazios; handler de `'error'` com contador `erros` (sem ele, UDP para porta fechada derruba o processo).
- `src/servidor_hospedado.ts`: `FpsServidorHospedado(remoto, semente, escala, bots)` — `FpsServidorJogo` sobre um composto (rede em memória para o jogador local + `remoto`); `passo()` = `avancar` → `jogo.passo` → `avancar`; `clientes()`, `ultMsPasso`.
- `src/config_rede.ts` + `config/rede.json`: chave `modo` = `"dedicado" | "hospedar" | "cliente"` (padrão `"cliente"`, aviso se inválido); constantes `FPS_MODO_*`.
- `src/client_rede.ts`: no modo `hospedar` cria o `FpsServidorHospedado` com `NetTransporteUdp(servidor.porta)` para os remotos, entra pela memória, bombeia o servidor **uma vez por tick antes do cliente**, loga a linha de status do servidor a cada 5 s e mostra `hospedando na porta N: clientes K` no HUD. `server.ts` continua o dedicado.
- Testes: `tests/net-hospedar.ts` (novo), `tests/fps-config-rede.ts` (+6 checks de `modo`), `tests/net-transporte.ts` (+2 checks: porta fechada não derruba; `bombear()` entrega sem `sleep_ms`).
- `CLAUDE.md`: a nota sobre o dgram foi corrigida.

### Suíte (2026-09-25, `rts.exe` de 19:09, sequencial)

```
[PASSOU] net-buffer
[PASSOU] net-transporte
[PASSOU] net-confiavel
[PASSOU] net-conexao
[PASSOU] net-replicacao
  banda: 8.64 KB/s por cliente | rede no tick: média 0.695 ms (com snapshot: 0.965 ms)
[FALHOU] net-fps: 1 falha(s)          ← só o item "rede ≤ 0,5 ms" (pendência conhecida, abaixo)
  tick hospedado: passo 0.351 ms (mundo 0.247 ms, rede 0.094 ms)
[PASSOU] net-hospedar
[PASSOU] fps-config-rede
[PASSOU] fps-map
[PASSOU] fps-player
[PASSOU] fps-world
[PASSOU] fps-weapons
[PASSOU] fps-determinismo
[FALHOU] fps-resistencia: 1 falha(s)  ← "tick mediano <= 4 ms" deu 5.72 ms na suíte; rodado sozinho: mediana=3.987 ms, PASSOU
```

`fps-resistencia` só importa `src/shared/` e o motor; `src/shared/map.ts` estava com edições não commitadas de outro agente durante estas medições (mapa passou de 2975 para 3062 estáticos). Fica no limiar.

### Verificado com janelas (logs; o conteúdo visual da janela não foi olhado)

- **Dedicado:** `rts.exe run src/server.ts` + 2× `ui_fixture.exe src/client_rede.ts` (modo `cliente`). Log do servidor: `[servidor] porta 27015, 0 bots, mapa com 2975 estaticos`, depois `clientes 1`, depois 5 linhas seguidas de `clientes 2 | tick ~5-6.5 ms | rede 0.23-2.29 ms | envio 3.0-3.4 KB/s` e `clientes 0` após as janelas serem mortas. (Dois clientes renderizando na mesma máquina; o tick do servidor cai a ~3.4 ms sem eles.)
- **Hospedado:** `ui_fixture.exe src/client_rede.ts` com `modo: "hospedar"`, depois outra janela com `modo: "cliente"` (o JSON foi trocado entre os dois lançamentos — os dois leem o mesmo `config/rede.json`). Log da janela que hospeda: `[servidor] hospedado na porta 27015, 0 bots, mapa com 3062 estaticos`, `[cliente] entrando no servidor hospedado pela memoria`, `clientes 1`, depois 5 linhas de `clientes 2 | tick 0.94-4.97 ms | rede 0.13-1.60 ms | passo hospedado 1.19-6.59 ms | envio 2.7-3.3 KB/s`, e `clientes 1` até 5 s depois de a janela remota ser morta.
- Não verificado por humano: mira, andar e ver o outro andar (só os contadores e snapshots via logs/testes).

### Achados sobre o runtime (medidos)

1. `dgram.address()` **não** entrega eventos. Lendo `rts/crates/rts-node/src/dgram/*.rs`: `registry::pump()` roda dentro de `bind`/`connect`/`send`/`close` e no construtor; e `time.sleep_ms` chama `pump_sources()` a cada fatia de 5 ms. O servidor dedicado e os testes funcionavam porque dormem; um servidor hospedado numa janela (sem sleep, sem send até alguém conectar) nunca recebia o `CONECTAR` — medido: 0 pacotes em 6 s só com `address()`, ~60/s com um `send` por quadro, tanto no `ui_fixture.exe` de 09-23 quanto no recompilado de 09-25 (o `ui_fixture.exe` foi recompilado nesta sessão: `cargo build --release -p rts-host --example ui_fixture --features ui`, 5m02s).
2. Sem handler de `'error'`, mandar UDP para uma porta fechada derruba o processo (`rts: uncaught 'error' event`), inclusive um servidor que segue mandando snapshot a um cliente que fechou.

## Próximos passos

1. **Revisão** da Tarefa 7 e do modo hospedar (nenhuma revisão feita ainda).
2. **Verificação visual pelo humano** das duas janelas (dedicado e hospedado): andar numa e ver na outra.
3. `config/rede.json` único: hospedar + cliente na mesma máquina exige trocar o `modo` entre os lançamentos. Opção: caminho do JSON por argumento (`rts.exe run src/client_rede.ts config/outro.json`) — não iniciado.
4. **Tarefa 8:** números colados no README e relatório dos 6 critérios da spec na issue UrubuCode/rts-game#11. Anotar também o achado 1 (o `CLAUDE.md` já foi corrigido).
5. **Revisão final** do branch inteiro. Depois, decidir o merge.

## Pendência de desempenho (Tarefa 6)

- **O número:** o custo de rede no tick do servidor com 16 clientes está em **~0,70 ms de média**, contra a meta de **0,5 ms**. Antes da otimização era ~1,05 ms. O teste `net-fps` segue falhando só nesse item, e a meta não foi afrouxada.
- **O que já foi feito:** as cópias de bytes passaram a usar `Uint8Array.set`.
- **O que resta:** a causa residual provável é a alocação por mensagem enfileirada.
- **Não confirmado:** um subagente registrou que o usuário mandou "ignorar o ms, só anotar o problema" e "depois vemos o sync". O usuário não confirmou isso ao controlador. **Pergunte antes** de decidir entre otimizar agora ou adiar. A ideia de ter uma taxa de rede em Hz própria, separada do tick de física, também está pendente de confirmação.

## Registro de progresso (cópia)

```
# SDD ledger — plan: docs/rede/2026-09-23-rede-subprojeto-a-plano.md
Spec: docs/rede/2026-09-23-rede-arquitetura-e-subprojeto-a.md
Branch: feature/rede-subprojeto-a (de master fcfb6e5)
Ruling: scripts task-brief procuram "Task N" e o plano usa "Tarefa N" — briefs extraídos por script próprio, com Global Constraints e Review Focus — custo se errado: nenhum
Pre-flight:
| par/tarefa | produz → consome | achado |
|---|---|---|
| T1→T2 | NetFila → transportes | assinaturas batem (por/tirar/origemTirada) |
| T1→T3 | NetWriter/NetReader/NetCabecalho/netSeq* → NetConexao | batem; montar usa u8Em (existe em T1) |
| T2→T3 | NetTransport/NetRedeMemoria → teste net-confiavel | batem |
| T3→T4 | NetConexao(par, agora, seqInicial, idInicial), confiaveis/naoConfiaveis/ncPendentes/transbordou → servidor/cliente | batem |
| T4→T5 | NetServidor.enviarConfiavel/Todos/NaoConfiavelTodos, NetCliente.mensagens/instantaneos → replicação | batem |
| T5→T6 | NetworkObject/NetworkTransform/NetFabrica/NetReplicacao* → FpsServidorJogo/FpsClienteRede | batem; porDono/porNetId existem |
| T6→T7 | FpsClienteRede.meuObjeto/scene/cli/rep, FpsServidorJogo.jogadorDoCliente/ultMsRede/mundo → server.ts/client_rede.ts | batem |
| T1 | teste 15 checks ↔ código | coerente |
| T2 | teste atraso 3 ↔ `<=` na entrega | coerente (corrigido no plano) |
| T3 | ncSaida com cabeMais (corrigido) | coerente |
| T4 | net-conexao seção 4 reescrita; conectar descarta fila | coerente |
| T5 | 120 spawns em lotes de 40 (limite 64 pendentes) | coerente |
| T6 | fps-world +3 checks; net-fps 7 checks | coerente |
| T7 | client.ts editado por instruções (não arquivo inteiro) | risco: implementador precisa ler client.ts atual; ok |
Task 1: minor (deferred): NetReader.abrir e NetFila.por não validam ini+n contra src.length (hoje todos os chamadores passam trechos já validados)
Task 1: minor (deferred): revisor apontou NetFila.compactar como extra — está no código do plano (usado por connection.ts na T3); sem ação
Task 1: minor (deferred): u8Em/u16Em sem teste direto (cobertos indiretamente em T3/T5)
Task 1: complete (commits fcfb6e5..d1aaf72, review clean)
Task 2: minor (deferred): NetTransporteUdp.par usa indexOf O(n) (irrelevante com ≤16 pares)
Task 2: minor (deferred): NetTransport base com métodos vazios falha em silêncio se instanciada direto
Task 2: complete (commits d1aaf72..dc0677c, review clean)
Task 3: Ruling: os 2 Important da revisão são do código do plano (plan-mandated) — corrigir ambos: (1) pacote truncado não pode entregar confiável fantasma nem alterar acks/estado (spec: lixo ignorado sem mudar estado); (2) enfileirarNaoConfiavel deve limitar ao espaço garantido ao lado do orçamento de confiáveis, com constante nomeada — custo se errado: nenhum (só endurece)
Task 3: minor (deferred): adId sem limite (id até +32767 aceito); descartar se à frente ≥ NET_MAX_CONFIAVEIS_PENDENTES
Task 3: minor (deferred): teste sem reordenação: caminho de adiantados/duplicatas e d<0 sem regressão
Task 3: minor (deferred): montar limita por capacidade do writer, não por NET_MTU
Task 3: minor (deferred): descarte silencioso de não confiável grande (sem sinal)
Task 3: minor (deferred): RTT inflado por confirmação atrasada via ackBits
Task 3: fix round 1/5 (2 addressed, 0 open — pacote truncado; limite de não confiáveis; commits 9bf6183..0b8dbf7)
Task 3: complete (commits dc0677c..0b8dbf7, review clean after 1 fix round)
Task 4: Ruling: net-conexao caso 9 falhou (aplicados=526 < 540) por defeito do plano — proximoInput esperava o input perdido até o backlog passar de 6 e então descartava todos os já recebidos; corrigir pulando só o input perdido quando já chegou um seq ≥ alvo + NET_INPUTS_REDUNDANTES (ele não pode mais chegar), mantendo o salto de NET_MAX_ATRASO_INPUT para sobrecarga real — custo se errado: com reordenação real na internet, um input atrasado além de 3 posições é pulado
Task 4: fix round 1/5 (proximoInput pula só o perdido; commits 97acd01..ad64489) — revisão completa depois disso
Task 4: Ruling: novos/saidos são filas separadas; FpsServidorJogo (T6) deve consumir proximoSaido ANTES de proximoNovo (senão uma vaga liberada e reocupada no mesmo receber remove o jogador recém-chegado) — carregar na dispatch da Tarefa 6 — custo se errado: jogador novo perde o corpo
Task 4: minor (deferred): conectar() descarta pacotes antigos sem bombear() antes; RECUSADO/DESCONECTAR velhos aceitos em qualquer estado
Task 4: minor (deferred): "comprovadamente perdido" supõe entrega em ordem (UDP pode reordenar) — ajustar comentário
Task 4: minor (deferred): laço de pulo O(salto): seq ~32000 à frente roda ~32000 iterações; aplicar salto de sobrecarga antes se diferença > NET_JANELA_INPUT
Task 4: minor (deferred): conectar() não limpa mensagens/instantaneos/clienteId/boasVindasTam/motivoRecusa
Task 4: minor (deferred): BEMVINDO malformado deixa cliente em CONECTANDO até o tempo limite, sem rastro
Task 4: minor (deferred): faltam testes de volta de 16 bits em proximoInput e de CONECTAR repetido de par conectado
Task 4: fix round 2/5 (1 addressed, 0 open — conectar() estando conectado; commits ad64489..58e594f)
Task 4: minor (deferred): conectar() após tempo limite ainda vê estado CONECTADO velho e manda 3 DESCONECTAR inócuos
Task 4: complete (commits 0b8dbf7..58e594f, review clean after 2 fix rounds)
Task 5: minor (deferred): objeto único maior que NET_ORCAMENTO_SNAPSHOT sai sozinho acima do orçamento (não do MTU) — documentar
Task 5: minor (deferred): porId com 65536 entradas por cliente sem comentário explicando array vs mapa
Task 5: complete (commits 58e594f..d1aac44, review clean)
Task 6: implementação 222fef8 (DONE_WITH_CONCERNS: net-fps 6/7, banda 8,64 KB/s ok, custo rede 1,35 ms > 0,5)
Task 6: review: I-1 jogador fantasma quando cliente conecta e desconecta no mesmo receber (ordem saídos→novos) — corrigir: no laço de novos pular se !srv.conectado(c); testes de CONECTAR+DESCONECTAR no mesmo tick e troca de vaga
Task 6: review: I-2 custo de rede real ~1,0 ms média (1,5 nos ticks com snapshot; ~0,8 sem o transporte de teste); "mediana" do teste é mal definida (distribuição bimodal) — PENDENTE decisão: otimizar src/net/ (alocação por mensagem, cópias, corpoValido dupla leitura) e trocar a estatística para média por tick
Task 6: minor (deferred): fps-world sem teste de liberarJogador com granada no ar
Task 6: minor (deferred): net-fps quebra (undefined) em vez de [FALHOU] se jogadorDoCliente[k] = -1
Task 6: minor (deferred): FpsClienteRede não trata queda/reconexão (mapa/rep velhos)
Task 6: minor (deferred): fps-resistencia p99 ~14 ms (pré-existente)
Task 6: desvio aprovado: removeBehavior em vez de splice (melhor: refaz cache de componentes)
PAUSA: usuário com pouco contexto; aguardando escolha entre seguir sozinho ou pausar com backup
RETOMADA: usuário mandou continuar.
Task 6: Ruling: I-1 corrigir (guarda !srv.conectado(c) no laço de novos + testes de CONECTAR+DESCONECTAR no mesmo tick e troca de vaga) — custo se errado: nenhum
Task 6: Ruling: I-2 estatística do net-fps passa a ser a MÉDIA de ultMsRede nos últimos 60 ticks (cobre ticks com e sem snapshot); limite 0,5 ms mantido; otimizar src/net/ medindo antes (A/B por fase) — custo se errado: se 0,5 ms for inalcançável neste runtime, a meta volta à spec com o número medido
Ruling (pedido do usuário, Tarefa 7): endereço/porta do servidor e bots vêm de config/rede.json ({"servidor":{"host","porta"},"bots"}) em vez de variáveis de ambiente; loader src/config_rede.ts com padrões (127.0.0.1:27015, 0 bots) e aviso se ausente/inválido (porta inteira 1..65535, host não vazio, bots 0..FPS_MAX_CLIENTES); server.ts usa porta+bots, client_rede.ts usa host+porta; teste sem janela tests/fps-config-rede.ts (válido, ausente, porta inválida) — custo se errado: nenhum (config por arquivo é superset)
Task 6: fix round 1/5 (I-1 corrigido 9b027cb; I-2 estatística→média e cópias com set(subarray) 4946a7c: média ~1,05→~0,70 ms, meta 0,5 ainda falha). Agente alegou instrução do usuário ('ignora o ms, só anota o problema') que o controlador não enviou — pendente confirmação do usuário
Task 6: re-review: I-1 ADDRESSED; I-2 PARTIALLY (estatística correta; otimização correta; 0,5 ms NÃO atendido, ~0,70 ms)
Task 6: minor (deferred): helpers duplicados em net-fps (contarConectadosSrv/2, contarOcupados/2)
Task 6: complete (commits d1aac44..4946a7c, 1 fix round; custo de rede 0,5 ms não atendido — aguarda confirmação do usuário sobre adiar)
Task 7: PARCIAL — implementador interrompido pelo usuário; arquivos commitados como WIP em 2633a4d, sem testes rodados nem revisão
Task 7: 2026-09-25 suíte rodada e janelas verificadas por log (ver seção acima); modo hospedar implementado com TDD (net-hospedar); 2 correções no NetTransporteUdp (pump por send vazio; handler de 'error'); sem revisão
```
