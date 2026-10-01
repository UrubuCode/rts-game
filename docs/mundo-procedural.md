# Mundo procedural em background

```powershell
.\run-pbr.ps1 -Scene infinite -Seed 42
```

O exemplo é um ambiente explorável de bairros, montanhas, rio, margens, árvores,
ruas e pontes simples, com céu de pôr do sol e neblina. Começa com um personagem
de protótipo em terceira pessoa: WASD anda, Shift corre, Espaço pula e botão
direito gira a câmera. F alterna para câmera livre, com WASD e Q/E para altura.
R retorna ao início e Esc fecha. O personagem acompanha o terreno e as pontes;
possui colisão horizontal com as caixas de prédios e troncos dos chunks ativos.
A cidade anterior, com personagens e tráfego, permanece em `-Scene city`.
Essa população ainda não foi integrada ao exemplo de mundo contínuo.

## Geração e streaming

Chunks de 128 × 128 unidades. Uma janela de 5 × 5 chunks acompanha a câmera;
o anel central de 3 × 3 é priorizado para começar a exploração enquanto os
arredores continuam carregando. No máximo 25 chunks ativos e um em preparação.
Os que saem dessa janela entram num cache de malhas na GPU, limitado a 25
chunks inativos e 32 MiB de buffers estimados. O mais antigo é liberado quando
um limite é excedido. As 11 configurações de material são compartilhadas.
Voltar a um chunk em cache reutiliza os mesmos handles, sem gerar ou subir
geometria novamente. Após expulsão do cache, ele é recalculado pela seed.
O cache dura a sessão; ainda não há persistência em disco.

Girar a câmera não altera a janela de chunks. Só cruzar uma fronteira em X/Z
muda os chunks ativos. Os arredores que ainda estavam carregando podem aparecer
durante uma rotação inicial; o HUD distingue ativos, cache, gerados e reutilizados.

`FpsWorldField` calcula alturas por coordenadas globais, com noise interpolado,
planície inicial, montanhas e leito contínuo de rio. Bordas e normais usam
amostras globais iguais entre vizinhos. Prédios ocupam locais de pouca inclinação.
Ruas seguem uma grade; trechos sobre o rio viram pontes simples.

`FpsWorldChunkLoader` executa **um worker nativo real** para o chunk pendente.
Noise, escolha de lotes/vegetação, vértices, índices e serialização acontecem
no worker, sem acesso à janela/GPU. Não é apenas um Promise ou trabalho de
geometria dividido na thread principal.

O worker envia uma malha pequena por pedido, com até 768 vértices. Só existe um
pedido em voo. `tick()` recebe e faz um upload por chamada. Cancelar sinaliza a
thread e impede publicar o resultado; o gerador verifica o sinal entre passos.
Uploads GPU, interpretação das mensagens e renderização continuam na thread
principal. Sua duração não tem garantia de tempo real.

O runtime atual aceita workers com código `eval` e mensagens serializadas.
`assets/pbr/world-worker.js` é um bundle gerado de `world_streaming.ts` e
`world_geometry.ts`, sem uma segunda implementação manual do gerador:

```powershell
node tools/create-world-worker.mjs
node tools/create-world-worker.mjs --check
```

O gerador usa o TypeScript instalado por `npm ci`; também aceita as instalações de desenvolvimento em `engine/node_modules` e `build/engine-audit/node_modules`.

O render usa uma origem local que acompanha o chunk da câmera, evitando mandar
coordenadas globais grandes à GPU. O mundo não possui uma borda predefinida,
mas há limites numéricos de coordenadas/noise; não é infinito matematicamente.

## Validação

- `tests/world-streaming.ts`: determinismo, mudanças de seed, bordas idênticas,
  coordenadas negativas, limite residente e alturas de montanhas/leito do rio.
- `tests/world-worker.ts`: worker real, índices válidos após divisão das malhas,
  tamanho máximo das mensagens e cancelamento sem publicação.
- `RTS_WORLD_TEST=1` no demo: atravessa regiões positivas e negativas, retorna
  à origem, verifica o limite de 25 chunks e libera recursos ao fechar.
- `tests/chunk-cache.ts`: identidade, reutilização, expulsão do mais antigo,
  limites de quantidade/bytes e liberação.
- `RTS_WORLD_TEST=cache`: gira a câmera por uma volta completa, atravessa uma
  fronteira e retorna; verifica contadores e preservação dos handles GPU.

Execução local debug, RTX 2080 Ti, antes da inclusão do cache: o teste de viagem gerou **98 chunks**,
descarregou **73** durante a exploração e manteve **25 residentes** ao final
de cada região. Maior `tick` de recepção/upload: **9,16 ms**.
No teste sem janela, um chunk levou **373,87 ms no worker**, enquanto o maior
tick principal foi **3,44 ms** (incluindo validação de índices do teste).
São amostras pontuais, não benchmark de release nem tempo total de quadro.

Com cache, o teste de rotação gerou **zero chunks adicionais** ao girar. A
travessia/volta reutilizou **3 chunks** com os mesmos handles de malha. Maior
tick principal: **5,02 ms**. Tempo de quadro p95: **17,34 ms**, máximo observado
**33,34 ms**, em 304 amostras (exclui os três primeiros quadros 3D e captura).
Esses números não garantem ausência de pausas em todo hardware ou percurso.
Log: `build/pbr-world-cache-test.log`.

Os demos da cidade e do mundo agora têm VSync e limite de 60 FPS. A primeira
inicialização do pipeline gráfico ainda pode pausar. Log de viagem:
`build/pbr-infinite-test.log`.

## Limites atuais

Terreno heightfield, água opaca estática, árvores estilizadas e grade de ruas.
Ainda não há cavernas/voxels destrutíveis, construção persistida por chunk,
biomas completos, impostores ou população distribuída. A câmera livre voa e mantém uma altura mínima sobre o terreno. A geração
em background e o descarregamento são a base para acrescentar esses sistemas.

## Recursos, visibilidade e colisões

O orçamento global limita buffers estimados de malha a 128 MiB e 4096 handles,
incluindo chunks ativos, cache e preparação. Texturas e overhead do driver não
entram nessa estimativa. Ao faltar espaço, o cache frio é liberado; uma falha
de geração/upload descarta o chunk parcial e é apresentada no carregamento.
O encerramento cancela o worker, libera malhas/materiais e limpa colisores;
o teste GPU verifica os contadores zerados e encerramento repetido.

O desenho corta chunks fora do frustum, com margem para sombras. O LOD de
objetos remove detalhes de janelas e troca copas por malhas mais simples:
passa para longe acima de 190 unidades e volta abaixo de 155, evitando
alternância perto do limite. O terreno agora tem dois níveis, descritos em [LOD do mundo](world-lod.md). Não há
occlusion culling, HLOD entre múltiplos chunks ou imagens impostoras nesta versão.

As caixas de colisão são geradas no worker e publicadas junto do chunk completo.
Ao desativar um chunk, suas colisões são removidas. O personagem desliza pelas
paredes com passos pequenos e não entra em chunks ainda ausentes. É colisão
estática horizontal: não substitui física geral, suporte em telhados ou navmesh.

Na integração em master, o teste GPU de cache passou: zero geração ao girar,
três chunks reaproveitados com identidade preservada, pico de buffers 3,36 MiB,
6 chunks visíveis, 3 cortados e 76 chamadas de desenho no último quadro.
Em debug: p95 de quadro 19,65 ms, máximo 33,65 ms em 340 amostras;
maior tick de carregamento 19,15 ms. São medidas locais, sem garantia de FPS.
