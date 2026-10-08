# Plano sequencial para consolidar a engine

Estado: implementação iniciada em 08/10/2026. Evidências: [auditoria](engine-foundation-audit-2026-10-08.md). F00 e F01 estão parciais; os itens marcados têm evidência local descrita no registro de execução. IDs F são etapas de consolidação; os IDs E do roadmap anterior permanecem como referência histórica.

## Regras de execução

Cada etapa entrega contrato, implementação reutilizável, migração dos consumidores, regressões e documentação. Nada de uma implementação separada para cada demo. Preservar o código útil existente; não iniciar uma reescrita completa.

Antes de marcar concluído: caso de sucesso, falha, cancelamento quando aplicável, Play/Stop, salvar/carregar, descarte e executável exportado. Testes de desempenho devem declarar build/hardware/carga e separar baseline de meta. Não exigir zero alocações em eventos frios; medir alocações contínuas e limites de retenção.

A sequência abaixo é a ordem recomendada de implementação. Correções localizadas de perda de dados, uso de recurso destruído e vazamentos podem antecipar qualquer etapa. Não começar água/iluminação mais sofisticadas antes dos bloqueios iniciais.

## F00 — Tornar a validação confiável

**Depende de:** nada. **Evidência:** A07.

- [x] Runner comum para testes RTS: timeout, resultado final esperado, status nativo, exceções e rejeições não observadas.
- [ ] Corrigir o runtime para rejeição não tratada resultar em falha observável; manter proteção no runner.
- [ ] Separar suítes headless, GPU, integração de editor/jogo e benchmarks. CI executa as obrigatórias, sem confundir compile com execução.
- [ ] Registrar baseline das cenas padrão, carga pesada e ciclos de cena, com runtime fixado.

**Aceite:** teste que falha antes/depois de um await, rejeição desacoplada, crash e timeout nunca aparecem como sucesso. Teste bem-sucedido sem GPU não depende de janela. Uma falha deliberada bloqueia o job de CI. Aproveitar a checagem já existente em tools/test-world.mjs.

## F01 — Corrigir propriedade e descarte existentes

**Depende de:** F00 para regressão automatizada. **Evidência:** A04/A05.

- [x] WorldStream conserva os donos/leases de Material e não libera IDs compartilhados diretamente.
- [ ] Auditar demais chamadas materialFree/meshFree e usos de APIs legadas; definir dono para cada handle.
- [x] GameObject.releaseResources, Scene.clear, Scene.removeAt e remoção de componente mantêm limpeza/estrutura consistente quando um disposer falha.
- [ ] Completar cancelamento de jobs por escopo e auditar os caminhos de rollback quando o próprio descarte lança.
- [ ] Testar substituição de cena, remoção, cancelamento, duplicação, duas janelas e fechamento.

**Aceite:** dois mundos e um objeto compartilham material; destruir um não invalida os demais; destruir todos retorna referências ao baseline, com descarte após o frame. Sem referência abandonada após dezenas de ciclos. Não confundir esse aceite com liberação de texturas, que depende de F05.

## F02 — Um núcleo de execução para editor e jogo

**Depende de:** F00/F01. **Evidência:** A01/A02.

- [ ] Extrair contexto de runtime, carregamento/serialização da engine, passo de simulação e render de cena sem dependência de @editor.
- [ ] Editor, Play, step manual, jogo exportado e testes chamam esse mesmo núcleo.
- [ ] Separar update de frame, passo físico, apresentação interpolada, áudio e trabalho de carga. Um acumulador por contexto; evitar relógio global cruzando mundos.
- [ ] Uniformizar PBR, bounds, hierarquia active/enabled, cameras e descarte no passe comum.
- [ ] Definir ordem de lifecycle e mutação de objetos durante update/contatos; manter contratos de rollback.

**Aceite:** cena de referência exportada reproduz materiais, objetos ocultos por pai, câmera filha e movimento do Play. Entrada gravada em 30/60/144 FPS produz estado físico equivalente dentro de tolerância definida. Pausa e step não simulam duas vezes. Game build não importa módulos de editor.

## F03 — Contrato comum de trabalhos assíncronos

**Depende de:** F01/F02. **Evidência:** A03.

- [ ] API de tarefa com dono, revisão, prioridade, dependências, estados terminais e cancelamento.
- [ ] Filas limitadas por quantidade e bytes; resultados antigos nunca publicados depois de troca de cena/regeneração.
- [ ] Separar tarefas CPU/I/O de uploads e mutações que exigem a thread da janela.
- [ ] Aproveitar workers existentes de cenas/chunks/texturas; generalizar primeiro o necessário ao carregamento.
- [ ] Instrumentar tempo em fila, execução, aplicação e memória temporária. Nada de bloquear esperando worker dentro de update/draw.

**Aceite:** centenas de pedidos/cancelamentos não crescem sem limite; desligar a cena encerra seus trabalhos; uma resposta atrasada não altera cena nova. Worker falho não trava progresso para sempre. Criar corrotina não conta como execução em background.

## F04 — Carregamento completo de cenas e assets

**Depende de:** F02/F03. **Evidência:** A03.

- [ ] Operação única no editor, importação, jogo e troca de cena: descobrir dependências, preparar CPU, enviar GPU, montar, ativar.
- [ ] Tirar leitura/parse/hash/decodificação dos modelos da thread principal, incluindo caminhos sem cache e formatos suportados.
- [ ] Dividir uploads grandes; limitar bytes e tempo por tick. Componentes de mount pesado devem preparar dados antes da ativação.
- [ ] Progresso por fase, cancelamento, retry de falha e publicação transacional; cena antiga permanece válida até a nova estar pronta.
- [ ] Fallback de cache inválido continua assíncrono. Cache é otimização, não requisito para evitar travamento.

**Aceite:** carregar a cachoeira com cache frio, quente, ausente e corrompido; cancelar em cada fase; arquivo ausente e worker falho preservam cena anterior. Medir p95/p99 e maior passo, incluindo maior modelo/textura e ativação. Alvo inicial: 2–3 ms de trabalho principal por tick no perfil de referência; desvios documentados e sem alegação de orçamento rígido para chamadas indivisíveis. Testar abrindo pelo editor e pelo exe, não somente a API isolada.

## F05 — Memória e cache com orçamento real

**Depende de:** F01/F03; integra F04.

- [ ] API nativa textureFree e invalidação segura de materiais/dependências.
- [ ] Leases para texturas e caminhos procedurais; contabilizar CPU, GPU, upload e recursos aguardando descarte.
- [ ] Orçamento comum com reservas, cache configurável e expulsão de recursos sem consumidores.
- [ ] Conectar orçamento dos chunks; tratar saturação com pausa da produção/erro recuperável, sem desalocar recursos ativos.

**Aceite:** 100 trocas de cena e trajeto ida/volta de streaming estabilizam consumo após aquecimento; recursos compartilhados continuam válidos; GPU nativa e cache têm números reconciliáveis. Pico de carga cabe no limite definido ou falha de forma controlada.

## F06 — Identidade de assets, formatos e persistência

**Depende de:** F02/F04; pode preparar o formato antes, sem bloquear os fixes iniciais.

- [ ] AssetId estável, catálogo de dependências, versão do importador e artefatos derivados por conteúdo/configuração.
- [ ] Mover/renomear asset não quebra cena; referências ausentes têm diagnóstico e reparo.
- [ ] schemaVersion da cena e migrações testadas; definir IDs/referências para objetos e componentes.
- [ ] Distinguir autoria/prefab, estado de runtime e save de gameplay; writes atômicos/verificados e recuperação de falha.
- [ ] Cook/build usa dependências declaradas e valida conteúdo antes de empacotar.

**Aceite:** cena antiga migra sem perda; formato futuro é recusado com clareza; mover textura/modelo preserva uso; interromper save não destrói último estado válido; jogo exportado não precisa da árvore original de arquivos.

## F07 — Transformação e física coerentes

**Depende de:** F02/F06 para migração segura. **Evidência:** A06.

- [ ] Pose local/mundial completa, composição de orientação e escala; estabelecer política explícita para shear/escala não uniforme.
- [ ] Migrar render, picking, gizmos, câmera, bounds, consultas, serialização e física juntos.
- [ ] Terrain produz collider atualizado pelo mesmo dado de altura.
- [ ] Validar capacidades dos backends; física angular, formas orientadas e CCD nos cenários críticos escolhidos.

**Aceite:** testes de escala/roll do pai passam; reparenteamento preserva pose conforme contrato; collider acompanha terreno esculpido; projétil de referência não atravessa parede; rodar a mesma cena em backends suportados respeita tolerâncias. Não prometer todos os tipos de collider em todos os backends.

## F08 — Streaming e persistência de mundo

**Depende de:** F03–F07.

- [ ] Contrato compartilhado para altura, vegetação, render, colisão, navegação e água por região.
- [ ] Edições do terreno/blocos persistem separadas da geração base, com seed e versão.
- [ ] Ativação/remoção coordenada dos dados e colisores; cache por identidade do conteúdo.
- [ ] LOD e budgets de CPU/GPU separados; avaliar precisão/origem flutuante conforme tamanho escolhido.

**Aceite:** editar, sair da região, voltar e reiniciar mantém a alteração; revisões antigas não repõem geometria/colisão obsoletas; girar a câmera não gera chunks novos; budget cobre o trajeto inteiro.

## F09 — Base de gameplay reutilizável

**Depende de:** F02/F07/F08.

- [ ] Ações de input, remapeamento, foco/captura e gamepad.
- [ ] Controlador de personagem com colisão, rampas/degraus e plataformas móveis.
- [ ] Serviço de navegação com caminho, obstáculos, desvio e atualização por região.
- [ ] Formalizar pooling/lifecycle para entidades frequentes quando os perfis justificarem.

**Aceite:** controles funcionam no editor e jogo; mudar tecla não exige editar script; personagem e agentes navegam o mesmo terreno/colisores; custo por quantidade de agentes é medido. RouteAgent continua útil para rotas autorais, sem fingir ser NavMesh.

## F10 — Orçamentos de animação, áudio e render

**Depende de:** F02/F05/F07; o profiler começa já em F00.

- [ ] Profiler CPU/GPU e memória por subsistema, percentis, picos e capturas reproduzíveis.
- [ ] Otimizar animação/água/partículas a partir das medições, usando kernels nativos quando apropriado.
- [ ] LOD de animação/vegetação, instanciamento e atualização de buffers sem recarga integral.
- [ ] Política de streaming de áudio longo, descarte procedural, sombras/alpha e qualidade gráfica.
- [ ] IBL, reflexos e efeitos avançados somente após orçamento base medido.

**Aceite:** cena-alvo tem custo distribuído dentro de um orçamento declarado e comparação controlada; controles de qualidade reduzem custo de forma previsível. Zero GC não substitui meta de tempo ou memória.

## F11 — Multiplayer sobre a base consolidada

**Depende de:** F02/F06/F07; mundo persistente usa F08.

- [ ] Interpolação, predição/reconciliação, autoridade e eventos únicos.
- [ ] Entrada tardia em lotes, interesse por região, protocolos/esquemas versionados e limites resistentes a entradas inválidas.
- [ ] Servidor headless, teste de perda/atraso/desconexão e sincronização de alterações persistentes.
- [ ] Definir autenticação/segurança e relay/NAT antes de expor partidas na internet.

**Aceite:** servidor e clientes em processos independentes convergem sob perda/latência; entrada tardia de mundo grande não esgota janela confiável; cliente não escolhe estado autoritativo; consumo permanece limitado.

## F12 — Validar produto, distribuição e ferramentas

**Depende de:** etapas relevantes ao perfil do jogo, com F00–F07 obrigatórias.

- [ ] Dois jogos pequenos de gêneros diferentes usam os mesmos sistemas e são exportados pela IDE.
- [ ] Testar instalação fora do checkout, caminhos com espaços, falta de asset, save/load, fechamento e logs.
- [ ] Validar workflows de editor/WS e recuperação de erro, sem depender de capturas que não provem janela visível.
- [ ] Atualizar matriz de capacidades e limitações junto com cada entrega.

**Aceite:** conteúdo novo não exige copiar um loop de engine da demo; a pessoa cria, testa, exporta, abre e fecha o jogo com os recursos documentados. Declaração de suporte corresponde aos casos realmente exercitados.

## Primeiro lote concreto

F00 e F01 são pequenos e verificáveis: runner confiável e correção das referências de WorldStream. Em seguida F02 elimina a divergência editor/exportado. F03–F05 fecham a infraestrutura de carregamento e memória que deveria ter sido priorizada antes das cenas pesadas. Até esse lote passar, não considerar a base encerrada.

## Registro de execução — primeiro lote

- Runner compartilhado em tools/checked-process.mjs; tools/rts-run.mjs oferece --expect, --timeout e --json. A suíte de mundo usa o mesmo contrato.
- Nove testes do runner passaram, incluindo timeout e diagnóstico RTS com código zero. Quatro fixtures no runtime real passaram: sucesso, throw, await rejeitado e rejeição desacoplada. No último caso, o runner retorna falha embora o processo nativo retorne zero.
- Workflow inclui test:runner e test:runtime-runner. Execução remota do CI ainda não foi verificada.
- WorldStream conserva Material como dono dos leases. Cinquenta ciclos de dois mundos e um consumidor externo retornaram ao baseline; dispose repetido não duplicou liberação. Apenas o módulo responsável pelo material compartilhado continua chamando materialFree em src.
- Falha injetada em um componente não impede limpeza dos demais/modelo. clear e removeAt preservam estado da cena; removeBehavior desanexa o componente antes de propagar o erro.
- Regressão de modelos/Play/Stop e cinco testes da suíte de mundo passaram. Streaming: 200 mil desenhos sem GC entre marcadores. Não houve alteração do laço de desenho neste lote, nem alegação de ganho de FPS.
- Correção nativa da rejeição não observada, matriz completa de CI, baselines controlados e auditoria de todos os recursos seguem pendentes. Não marcar F00/F01 inteiras como concluídas.
- Fechamento do lote: 30 testes Node (runner, componentes e contrato do runtime) passaram; editor e jogo compilaram em build/RTSEditor-foundation.exe e build/RTSGame-foundation.exe. Compilação não substitui a validação de paridade prevista em F02.

## Registro de execução — recuperação após falhas de descarte

- PlayMode.stop restaura a cena de autoria, seleção e histórico mesmo quando o descarte de um componente da simulação lança. O erro é propagado depois da restauração; um novo ciclo Play/Stop continua possível.
- ResourceCache.clear tenta liberar todas as entradas antes de propagar a primeira falha. ResourceScope e descarte adiado também preservam exceções cujo valor é null, sem perder os recursos das outras janelas.
- Regressões dedicadas em tests/play-stop-cleanup-failure.ts e tests/resources.ts passaram no runtime fixado. Checks de componentes e parâmetros passaram.
- F01 permanece parcial: falhas durante montagem de Play, rollback de sceneFromJSON e cancelamento de jobs ainda precisam ser tratados e testados.
- Integração Git solicitada, mas bloqueada por permissão ao escrever FETCH_HEAD no diretório .git do worktree. Não houve merge ou push neste lote.
- Validação adicional: regressões resources-model-lifecycle e resources-cleanup-failure passaram; editor compilado em build/RTSEditor-cleanup-recovery.exe. Nenhum teste de interação visual foi executado neste lote.

## Registro de execução — rollback de carregamento

- sceneFromJSON tenta descartar todos os objetos preparados quando a validação ou montagem falha. Uma falha secundária de descarte é registrada sem substituir o erro primário nem interromper a restauração dos objetos anteriores.
- O rollback inclui objetos criados por mount antes da falha, desanexa os objetos abandonados e recalcula as transformações da cena restaurada. cloneObject e buildObject também preservam a exceção original caso sua limpeza falhe.
- Depois de uma montagem bem-sucedida, nome/ambiente/câmera/luz são publicados antes de liberar os objetos antigos. Se esse descarte falhar, todos os antigos são visitados e a primeira falha é propagada; a nova cena já está publicada. Isso não deve ser confundido com rollback de montagem.
- tests/scene-rollback-cleanup.ts passou com falhas simultâneas de mount e descarte, objeto criado durante mount, recuperação em uma carga seguinte e descarte completo dos objetos antigos.
- Limites: efeitos externos arbitrários de mount não são revertidos; entrada em Play e instanciação aditiva ainda precisam de recuperação transacional. F01 permanece parcial.
- Validação deste lote: três regressões RTS passaram (rollback, recursos de modelos e Stop com falha), checks de componentes/parâmetros passaram, editor e jogo compilaram em build/RTSEditor-scene-recovery.exe e build/RTSGame-scene-recovery.exe. Não houve teste visual nem medição de FPS neste lote.

## Registro de execução — entrada em Play

- Entrada em Play agora restaura objetos de autoria, câmera, seleção, ambiente e histórico quando a montagem falha. A limpeza inclui cópias ainda não montadas e objetos criados pelos mounts, e preserva o erro primário mesmo quando um disposer falha.
- Regressão tests/play-entry-rollback.ts passou com falha simultânea de montagem e descarte, seguida de um novo ciclo Play/Stop. Efeitos externos arbitrários dos scripts continuam fora da garantia de rollback; instanciação aditiva permanece pendente.
