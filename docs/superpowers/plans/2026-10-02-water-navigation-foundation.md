# Tarefa: consolidar água, física naval e streaming

ID: **ENG-NAV-001**. Estado: **planejada, não iniciada**.
Data: 2026-10-02. Base: `669ab9f`.
Especificação: [contratos e critérios](../specs/2026-10-02-water-navigation-foundation.md).

Objetivo: retirar as limitações estruturais dos protótipos e entregar componentes
de água/navegação que possam ser usados por outros jogos.
Esta é uma tarefa registrada no repositório, não uma execução agendada nem uma issue remota.

## Como retomar

Começar pela primeira caixa pendente, verificar o código atual e ler a seção
correspondente da spec. Executar uma etapa por entrega. Só avançar quando o
aceite da anterior estiver atendido; corrigir regressões antes de acrescentar
recursos. Registrar ao fim: resultado, comandos/testes, métricas, limitações e hash.
Se uma dependência já tiver sido implementada por outro trabalho, validar e
registrar a evidência antes de marcá-la concluída.

**Próxima ação:** executar e concluir a sonda interrompida de SailboatController/
SailboatRenderer, isolando qual caminho aloca e estabelecendo baseline confiável.

## Sequência obrigatória

| Ordem | Entrega | Depende de | Prioridade |
|---|---|---|---|
| 01 | Baseline e alocações | — | P0 |
| 02 | Rotação completa na engine | 01 | P0 |
| 03 | Dinâmica angular e colisores orientados | 02 | P0 |
| 04 | Consulta espacial unificada de água | 01, 03 | P0 |
| 05 | Empuxo multiponto com torque | 03, 04 | P0 |
| 06 | Controle naval integrado à física | 05 | P0 |
| 07 | Curvas e escavação em background | 04, 06 | P1 |
| 08 | Cache unificado, LOD e terreno reversível | 07 | P1 |
| 09 | Reflexos fora da câmera | 08 | P1 |
| 10 | Aceitação integrada da fundação | 01–09 | P1 |
| 11 | Personagem em plataforma móvel e leme | 10 | P2 |
| 12 | Multiplayer naval autoritativo | 11 | P2 |

Mesmo quando há dependências técnicas menores, a ordem acima é a ordem de
implementação escolhida. P2 é uma expansão futura, não requisito para concluir
o marco da fundação na etapa 10.

### 01 — Desempenho medido

- [ ] Separar sondas de controlador, renderer e consultas; concluir 200 mil iterações por caminho estável sem GC.
- [ ] Corrigir alocações encontradas, mantendo buffers e malhas persistentes.
- [ ] Repetir benchmark oculto/visível em condições controladas, mínimo três execuções, sem outros testes/janelas de jogo concorrentes.
- [ ] Registrar perfil de máquina, build e métricas; confirmar ou revisar metas da spec com justificativa.

Pontos iniciais: `tests/sailboat-gc.ts`, `tests/sailboat.ts`, `bench/claude-frame-bench.mjs`, `src/engine/core/sailboat_*.ts`.
Aceite: sonda completa, relatório reproduzível e nenhuma conclusão baseada no benchmark anterior com CPU a 100%.

### 02 — Pose completa

- [ ] Auditar Transform, hierarquia, pose, interpolação, render em lote/individual e serialização.
- [ ] Definir quaternion canônico e compatibilidade com campos Euler existentes.
- [ ] Propagar rotação para filhos, bounds, picking e gizmos; preservar fast path medido onde possível.
- [ ] Substituir a exceção de orientação do barco pelo contrato comum quando equivalente.

Aceite: caixa e barco com yaw/pitch/roll, filho deslocado corretamente, seleção coerente, salvar/carregar e Play/Stop preservados; cena antiga sem roll mantém aparência.

### 03 — Física angular

- [ ] Cruzar a implementação com o plano geral de física e evitar outro solver paralelo.
- [ ] Implementar força no ponto, torque, inércia e integração angular no passo fixo.
- [ ] Integrar formas orientadas e contatos; declarar capacidade/fallback por backend.
- [ ] Cobrir sleeping, corpos estáticos/cinemáticos, teleporte e limpeza de forças.

Aceite: força central não gira; força excêntrica gira no sentido esperado; contato inclinado não usa somente AABB como resposta; ausência de dupla integração e teste de estabilidade prolongado.

### 04 — Serviço de água

- [ ] Unificar consultas de WaterSurface, WaterBody e ProceduralWorld com saída reutilizada.
- [ ] Implementar registro espacial, identidade/revisão e seleção determinística em sobreposição.
- [ ] Tratar disable, remoção, unload e origem móvel; solicitar dados físicos para corpos ativos.
- [ ] Migrar Buoyancy e controlador para a consulta comum, mantendo compatibilidade das APIs públicas atuais.

Aceite: mesma água para visual e física; água fora da câmera continua válida; remover um corpo de água não deixa referência ativa; consulta indisponível tem comportamento explícito; custo medido com muitos corpos.

### 05 — Flutuação física

- [ ] Definir pontos/volumes de deslocamento e visualização no editor.
- [ ] Aplicar empuxo e arrasto relativo por ponto através do Rigidbody, incluindo torque.
- [ ] Implementar amortecimento angular e testes de equilíbrio sem sobrescrever a orientação diretamente.
- [ ] Preservar o comportamento simples de Buoyancy por configuração/migração.

Aceite: barco retorna de inclinação moderada em água calma, responde a ondas e corrente, corpo mais denso afunda; resultados dentro das tolerâncias com apresentação em 30/60/120 Hz.

### 06 — Navegação física

- [ ] Separar comandos de jogador/IA de forças do leme, vento, velas e âncora.
- [ ] Migrar demo para um único integrador; manter modo cinemático legado documentado.
- [ ] Usar colisores reais para cais, ilhas e barcos, com proteção contra atravessamento.
- [ ] Validar recuperação, reinício, duas câmeras e encerramento da janela.

Aceite: navegar, virar, ancorar e colidir sem teleporte, NaN ou regra exclusiva da demo substituindo a física; reset recupera a partida. Não exige andar no convés ainda.

### 07 — Edição assíncrona

- [ ] Criar jobs revisionados de triangulação, subdivisão e preparação da escavação.
- [ ] Adicionar cancelamento, combinação de edições rápidas, progresso e erros recuperáveis.
- [ ] Publicar resultado atomicamente com orçamento; manter revisão anterior até a nova ficar pronta.
- [ ] Cobrir Undo/Redo, exclusão e troca de cena durante o job.

Aceite: arrastar uma curva complexa continua responsivo; resultado atrasado nunca substitui revisão nova; UI não aguarda worker de forma bloqueante; nenhum job acessa diretamente recursos de render fora da thread correta.

### 08 — Streaming e terreno

- [ ] Integrar trechos autorados ao orçamento CPU/GPU e LRU do streaming existente.
- [ ] Implementar pinning físico, limite de uploads e LOD com bordas/fase consistentes.
- [ ] Resolver teto de superfícies com agrupamento/orçamento e diagnóstico explícito.
- [ ] Introduzir modificadores de escavação reversíveis sobre o terreno base.

Aceite: girar câmera não reconstrói; ir/voltar reutiliza cache; memória estabiliza; origem móvel não muda ondas; mover/remover rio restaura área antiga sem apagar outras edições; clear libera recursos.

### 09 — Reflexão planar

- [ ] Adicionar captura planar limitada para água horizontal próxima, agrupando planos equivalentes.
- [ ] Implementar recorte, exclusão da água, controle de resolução/frequência e fallback SSR/ambiente.
- [ ] Medir custo GPU e memória; validar múltiplas câmeras e descarte dos alvos.

Aceite: objeto fora da câmera principal aparece no reflexo quando visível pela câmera espelhada; sem recursão, geometria submersa indevida ou explosão do número de passes.

### 10 — Marco da fundação

- [ ] Executar todas as cenas de aceitação da spec e regressões dos componentes afetados.
- [ ] Fazer teste prolongado de navegação/streaming, edição repetida e Play/Stop.
- [ ] Consolidar métricas, exemplos, documentação e patch nativo reproduzível.
- [ ] Registrar limitações remanescentes sem apresentar os recursos P2 como concluídos.

Aceite: etapas 01–09 concluídas com evidência; outra cena consegue usar os componentes sem copiar lógica de física/render da demo.

### 11 — Personagem e convés

- [ ] Implementar plataformas móveis no controlador de personagem, com velocidade angular da base.
- [ ] Adicionar embarque, desembarque, salto e estados de água/recuperação definidos.
- [ ] Criar interação de assumir/soltar o leme com câmera e entrada desacopladas.

Aceite: personagem fica e anda no convés durante curvas/ondas, salta herdando movimento e sai do leme sem ficar preso; testes cobrem troca de referencial.

### 12 — Rede naval

- [ ] Reusar NetworkManager/Object/State; definir esquema versionado de comandos e snapshots completos.
- [ ] Implementar autoridade do servidor, posse do leme e deduplicação de ações de âncora/interação.
- [ ] Adicionar interpolação/reconciliação, entrada tardia e desconexão segura.
- [ ] Validar MTU, limites de filas e envio gradual do estado inicial.

Aceite: servidor e dois clientes compartilham barco/passageiros sob perda, atraso e jitter da spec; cliente não impõe pose física ao servidor; reconectar não duplica entidades ou ações.

## Registro por etapa

Copiar e preencher ao concluir cada entrega:

```text
Etapa:
Estado: pendente | em andamento | concluída | bloqueada
Commit:
Mudanças e migrações:
Testes executados e resultados:
Métricas / ambiente / arquivos de evidência:
Limitações e pendências:
Próxima etapa liberada:
```

Nenhuma etapa de implementação está concluída na criação deste planejamento.
