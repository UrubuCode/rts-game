# Especificação: consolidação da água e navegação na engine

Data: 2026-10-02. Estado: planejado; implementação futura.
Base de referência: `669ab9f` na `master`.
Execução: [tarefa sequencial](../plans/2026-10-02-water-navigation-foundation.md).

## 1. Objetivo

Transformar os protótipos de água e veleiro em recursos reutilizáveis da engine,
com física consistente, edição responsiva, consumo limitado de recursos e
integração com o mundo procedural. A demo Mar Aberto será uma cena de aceitação,
não o lugar onde os sistemas gerais ficam implementados.

O primeiro marco termina com barcos físicos, rios editados sem bloquear a
interface, água integrada ao streaming e reflexão fora da câmera principal.
Personagem no convés e multiplayer naval são marcos posteriores. Canhões,
inventário, economia, tripulação e simulação volumétrica de todo o oceano
não fazem parte desta especificação.

## 2. Situação verificada na base

| Área | Existe | Limite atual |
|---|---|---|
| Mundo | Geração em worker, cache e LOD | WaterBody autorado usa cache próprio |
| WaterSurface | Ondas, refração, espuma e SSR | Plano horizontal; SSR depende da tela |
| Spline/WaterBody | Editor de pontos, rios, lagos, corrente e escavação | Reconstrução síncrona; sem orçamento/LRU do mundo |
| Buoyancy | Empuxo e arrasto nos caminhos CPU/GPU/Rust | Aproximação vertical, sem torque |
| SailboatController | Velas, vento, leme, âncora e amostragem de ondas | Integração cinemática; obstáculos na demo |
| SailboatRenderer | Casco, convés e vela com quaternion | Solução própria de pitch/roll, sem suporte geral equivalente |
| Rede | UDP, NetworkManager/Object/Transform e estados próprios | Transform replica posição/yaw; barco não está integrado |
| Validação | Testes funcionais e de componentes | Sonda longa do veleiro interrompida; benchmarks contaminados por carga concorrente |

Detalhes atuais: [veleiro](../../sailing.md), [água](../../water.md),
[curvas](../../water-splines.md), [rede](../../networking.md).
Não registrar metas abaixo como resultados já atingidos.

## 3. Regras de arquitetura

1. GameObjects e componentes continuam sendo a API de autoria. Recursos,
   filas, handles, velocidades e relógios são estado de runtime.
2. Um único sistema integra cada corpo por passo. O controlador de barco envia
   comandos/forças; não altera a pose em paralelo ao Rigidbody.
3. Consulta física de água independe da câmera, do frustum e da malha visual.
4. Geometria e consultas usam a mesma revisão de autoria e o mesmo relógio de ondas.
5. Workers produzem dados CPU. Upload, publicação e descarte de recursos gráficos
   respeitam a afinidade de thread do renderer.
6. Filas, memória, uploads e trabalho por quadro têm limites explícitos.
7. Cenas existentes abrem com os mesmos padrões. Migrações precisam de versão
   e teste de ida e volta; não reinterpretar silenciosamente campos existentes.
8. CPU, Rust e GPU anunciam capacidades reais. Recurso angular não suportado
   exige fallback declarado; nunca descartar torque silenciosamente.

Os nomes de APIs novos abaixo são propostas. Confirmar as interfaces existentes
na tarefa correspondente antes de introduzir outro serviço com a mesma função.

## 4. Contratos propostos

### 4.1 Pose e física angular

Definir uma orientação quaternion canônica de runtime. Euler do Inspector é
uma representação de autoria; não manter duas orientações mutáveis independentes.
Preservar a convenção atual: yaw positivo leva +Z para +X; pitch positivo levanta
a proa. Definir e testar o sinal de roll e a ordem de composição.

Transformação de filhos, render individual/em lote, bounds, picking, gizmos,
colisores, serialização e Play devem concordar. Rotações arbitrárias precisam
de OBB/shape compatível; AABB pode continuar no broad phase, não substituir
silenciosamente o teste estreito de uma caixa inclinada.

O corpo dinâmico expõe orientação, velocidade angular, tensor de inércia,
força e torque acumulados. Uma aplicação de força num ponto adiciona
`torque = (ponto - centroDeMassa) × força`. Integração e limpeza de acumuladores
ocorrem uma vez por passo fixo. Corpos estáticos/cinemáticos, sleeping e
teleporte têm regras explícitas.

### 4.2 Consulta unificada de água

Introduzir um serviço reutilizável, provisoriamente `WaterSystem.sample(position, out)`.
Usar buffers/estruturas reaproveitados, com até quatro parâmetros nos caminhos
por quadro. O resultado identifica validade, corpo de água/revisão, altura,
normal, profundidade e velocidade da corrente.

Adapters cobrem WaterSurface, WaterBody e água do ProceduralWorld. Uma grade
espacial evita varrer todos os componentes para cada ponto de cada barco.
Sobreposição deve ser determinística: prioridade explícita, maior superfície
que cobre XZ e ID estável como desempate. Não depender da ordem de desenho.

Remoção, disable, alteração de curva, origem móvel e unload invalidam registros.
Ao faltar dado residente, retornar indisponível, não uma altura inventada.
Corpos ativos solicitam/pinam seus dados físicos; se o pedido não puder ser
atendido, suspender a simulação dependente e reportar o motivo, sem queda falsa.

### 4.3 Empuxo e navegação

Buoyancy passa a trabalhar com pontos/volumes de deslocamento configuráveis.
Cada ponto consulta água e acumula força e torque. Arrasto usa a velocidade
relativa do ponto, incluindo `velocidadeAngular × braço`, contra a corrente.
Massa, densidade, volume, profundidade e dimensões seguem unidades documentadas.

O controlador naval transforma leme, abertura/ângulo das velas e âncora em
forças ou restrições. A âncora tem estados levantada, descendo, presa e subindo;
não teleporta o navio. Oferecer assistência de pilotagem como configuração,
separada da física. O modo cinemático atual permanece disponível para cenas
antigas até existir uma migração validada.

O casco participa da colisão geral com terreno, cais, outros barcos e obstáculos
dos chunks. Evitar atravessamento na velocidade máxima por varredura/CCD ou
subpassos com limite medido. Remover da demo a regra especial de parar por
círculos quando a colisão física equivalente estiver pronta.

### 4.4 Reconstrução assíncrona e streaming

Uma edição cria snapshot imutável com ID de corpo, revisão, parâmetros e pontos.
O estado do trabalho é `queued → building → ready → published`, com `cancelled`
e `failed` explícitos. A revisão antiga continua válida até publicação atômica.
Resultados obsoletos, recebidos após Undo, remoção ou troca de cena, são descartados.

Triangulação, subdivisão, particionamento e preparação de escavação rodam em
worker. A interface mostra progresso por fases e erro recuperável; não usa
um percentual que chegue a 100% antes da publicação. Combinar edições rápidas
e limitar trabalhos pendentes por corpo. Identidade de geometria não inclui câmera.

Trechos autorados entram no gerenciador de recursos/streaming existente, com
contabilidade CPU/GPU, LRU, limites de uploads e política de pinning para física.
Chave de cache inclui ID, revisão, célula, LOD e parâmetros que mudam geometria.
Girar a câmera não gera novamente. Origem móvel não altera fase, consulta ou chave.
O limite atual de 128 superfícies deve gerar decisão de orçamento/agrupamento
ou diagnóstico, nunca perda silenciosa de trechos visíveis.

Escavação evolui para modificadores reversíveis sobre o terreno base. Mover ou
remover uma curva recompõe sua área antiga e nova, preservando outras camadas.
Undo cancela jobs antigos e restaura autoria. Não fazer cópia/serialização do
heightmap inteiro a cada movimento do mouse.

### 4.5 Reflexos e distância

Implementar primeiro reflexão planar para corpos de água próximos e horizontais:
câmera espelhada, recorte no nível da água, correção de winding e prevenção
de recursão. Excluir a própria água da captura. Agrupar superfícies coplanares.

Resolução, frequência, distância, número de capturas e custo por quadro são
configuráveis. Ordem de fallback: planar válida, SSR válido, ambiente. Rios
inclinados e água distante podem ficar no fallback nesta primeira versão.
Somente depois medir a necessidade de probes/HDR e refinamento temporal.

LOD de água mantém bordas e fase compatíveis entre trechos; orçamento de
reflexão e malha é independente do orçamento de consultas físicas.

## 5. Marcos posteriores

### Personagem no convés

Criar suporte geral a plataformas móveis, incluindo velocidade linear/angular
da plataforma, entrar/sair, salto e mudança de referencial. A posse do leme
é uma interação exclusiva e reversível. Câmera a bordo atual não conta como
personagem com colisão. Queda na água precisa de estado de natação ou retorno
controlado explicitamente definido para a demo.

### Multiplayer naval

Reutilizar `src/engine/net`, sem um segundo protocolo paralelo. Servidor é dono
da simulação física. Cliente envia comandos com sequência; snapshot inclui
orientação completa, velocidades e estados das velas/âncora. Negociar versão
do esquema antes de mudar NetworkTransform ou registrar NetworkState naval.

Separar comandos contínuos de ações pontuais deduplicadas. Posse do leme,
entrada tardia, disconnect, orçamento de pacotes e reconstrução de sessão
fazem parte do aceite. Não exigir determinismo bit a bit entre CPU e GPU:
correção vem da autoridade do servidor e da reconciliação/interpolação.

## 6. Validação e metas iniciais

| Medida | Critério proposto |
|---|---|
| Alocação estável | 200 mil iterações por caminho alterado, zero GC entre marcadores após aquecimento |
| Estabilidade física | 10 minutos sem NaN/divergência; testes em 30/60/120 Hz de apresentação com tick físico fixo |
| Flutuação parada | Centro médio a até 5% da altura do casco da referência de equilíbrio, após assentamento |
| Colisão | Sem atravessamento nos casos de velocidade máxima; tolerância de penetração registrada por escala |
| Edição/streaming | Orçamento inicial de publicação/upload de 2 ms de CPU por quadro, configurável; trabalho grande dividido |
| Memória | Teste de ida/volta sem crescimento ilimitado; após clear/Stop retorna ao baseline contabilizado |
| Rede | 1 servidor/2 clientes, perda simulada de 5%, RTT 100 ms e jitter até 30 ms; sem duplicação de ações |

Os valores são metas de projeto, sujeitos a revisão documentada na tarefa 01.
Não são promessas de desempenho em qualquer hardware. Comparar antes/depois
com mesma máquina, build, resolução, cena, aquecimento e VSync; registrar
média, mediana, p95/p99, máximo, CPU/GPU separadas quando disponíveis, GC e carga
externa. Não executar testes concorrentes nem aceitar máquina saturada como
evidência de ganho/regressão. Usar pelo menos três execuções por cenário.

Preservar cenas pequenas e reproduzíveis: barco em água calma; barco com ondas;
contato inclinado com cais; dois barcos; rio com curvas; curva editada rapidamente;
viagem longa com retorno ao cache; reflexo de objeto fora da câmera; passageiro
em plataforma; sessão de rede. Validar pixels/capturas e controles reais, além
de valores numéricos.

## 7. Integração e conclusão

Reusar os planos existentes de física e capacidades de backend; esta spec
coordena sua aplicação à navegação, sem declarar esses planos concluídos.
Consultar [tracking de física](../plans/tracking-issue-geral-fisica-motor.md)
antes de criar integração angular ou narrow phase novos.

Regenerar o catálogo, executar verificações exigidas por CLAUDE.md e manter
documentação por entrega. Alterações nativas entram no patch canônico
`patches/render-pbr-runtime.patch`, aplicado à base documentada em render-pbr.md.
Não versionar executáveis nem supor que o binário oficial antigo tenha a mudança.

Uma etapa só termina com código, testes, evidências, limitações atualizadas e
commit identificado na tarefa. Trabalho parcial continua pendente mesmo que
uma demo pareça funcionar. Nenhuma etapa é iniciada automaticamente por este documento.
