# Gerenciador de recursos

`src/engine/core/resources.ts` fornece um registro comum de caches por categoria, referências de uso (`ResourceLease`) e grupos de referências (`ResourceScope`). Dados de posição, reprodução de áudio e pose continuam pertencendo a cada instância.

## Integrações

- Texturas comuns e mapas PBR usam o mesmo registro, separados por janela, caminho normalizado e interpretação de cor/dados. O mesmo arquivo não é carregado novamente só por escrever `./assets/...` em vez de `assets/...`.
- Modelos e assets de esqueleto/animação usam o registro com identidade da janela. Isso evita reutilizar um ID de GPU pertencente a outra janela.
- Áudio usa caminho normalizado e taxa de amostragem. Arquivos WAV/OGG de AudioSource, prévias, vozes e agendamentos usam referências independentes. Ícones usam sua identidade no catálogo.
- Pedidos assíncronos de textura compartilham um trabalho pendente. Cada pedido segura uma referência; cancelar um pedido não cancela os demais. A última referência cancela um trabalho ainda pendente. Sucesso e erro removem o trabalho quando seus consumidores terminam.
- Materiais PBR com parâmetros e mapas iguais compartilham o recurso GPU. Uma alteração adquire outro recurso; não modifica o material compartilhado pelos demais. Remoção de componente ou limpeza de cena libera a referência pelo `releaseResources()` existente.
- Modelos estáticos importados pelo editor e pelo carregamento de cenas usam `acquireModel`. Cada GameObject possui uma referência, compartilhada por duplicação e pelas cópias de Play. A pré-carga mantém um `ResourceScope` até a montagem; cancelar libera o que preparou.
- O descarte dos modelos e materiais GPU ocorre depois de `endFrame` da janela correspondente, preservando os recursos dos comandos já enfileirados.

## API

```ts
const buffers = resourceCache<Float32Array>("my-buffers");
const scope = new ResourceScope();
const lease = scope.keep(buffers.acquire("shared-grid", () => new Float32Array(4096)));
const buffer = lease.value;
// Outros consumidores de shared-grid recebem o mesmo buffer.
scope.release(); // libera as referências deste dono; chamada repetida é segura
```

`acquire(key, factory, dispose)` chama o factory somente se não houver recurso. O factory também pode devolver um objeto que representa uma operação pendente, como o carregador de textura. Para recursos nativos, o terceiro argumento realiza o descarte. Não utilizar `lease.value` depois de liberar a referência.

`lease.retain()` cria uma referência independente ao mesmo recurso; não ressuscita uma referência já liberada. `GameObject.setModelResource(lease, path, part)` assume a referência recebida. Não a libere no chamador depois de transferir.

`set` mantém uma referência do próprio cache, indicada por `pinned`. `evict` remove essa retenção; referências de consumidores ativos continuam protegendo o recurso. `clear` aplica essa regra a todo o cache. Uma falha em um descarte de `ResourceScope` não impede a liberação das demais referências.

`resourcePath` normaliza caminhos lexicalmente e preserva data URIs e nomes procedurais. Não deduplica arquivos diferentes com conteúdo igual, links simbólicos ou hard links.

## Diagnóstico

O comando do editor `assets resources` e a função `resourceStatistics()` mostram, por categoria:

- `entries`: recursos ou trabalhos registrados;
- `references`: referências explícitas de consumidores;
- `pinned`: entradas retidas pelo cache;
- `hits`, `misses`, `loads`, `disposals`: contadores acumulados de reutilização e ciclo de vida.

Esses contadores não são uma medição de bytes de RAM/VRAM. `disposals` registra retiradas de entradas e chamadas de descarte; para caches legados isso não significa necessariamente memória nativa liberada.

## Compatibilidade e limites

Modelos estáticos dos fluxos do editor/cena, materiais e trabalhos de textura usam referências explícitas. `loadModel` continua como API de compatibilidade com retenção até `clearModelCache`; a limpeza respeita referências ativas e descarta as malhas ao final do quadro. Código novo deve usar `acquireModel`. IDs atribuídos diretamente a `customMesh` continuam emprestados: não estabelecem propriedade.

Texturas prontas e ícones ainda entregam objetos/IDs diretamente: suas entradas permanecem retidas, sem descarte automático por GameObject. Limpar o registro não inventa um destrutor para esses recursos. Em especial, o runtime atual não expõe `textureFree`; a vida das texturas GPU continua vinculada ao contexto da janela.

Pools de partículas, buffers mutáveis de simulação, chunks e pipelines internos continuam com seus donos especializados. Podem adotar leases, mas não foram todos migrados para liberação automática neste trabalho. O registro unifica as integrações acima sem tratar estado mutável de dois objetos como um único recurso.

Não há ainda orçamento global de memória, expulsão por uso recente ou contabilização exata de bytes. Importações síncronas continuam síncronas; deduplicação de trabalhos pendentes foi integrada ao carregamento de texturas.

## Migração dos modelos

`Scene.clear(false)` desanexa sem destruir recursos, exclusivamente para transferir a propriedade dos objetos: Play guarda os originais, e a troca transacional de cena os preserva até a montagem dar certo. A limpeza padrão e remoção de objetos chamam `GameObject.releaseResources`. Cópias recusadas, cenas parcialmente construídas e falhas de factory liberam suas referências.

Ao restaurar JSON, um MeshRenderer associado a `meshPath` recebe o identificador atual da malha. Nunca deve reutilizar o identificador numérico gravado numa sessão ou antes de um descarte. O descarte remove também o raio armazenado para culling.

Teste da cachoeira após a migração: 59 referências de objetos compartilham 13 modelos, sem entradas fixadas (`pinned=0`). Em Play são 118 referências aos mesmos 13 modelos; ao parar voltam a 59. Os materiais seguem em 5 recursos GPU e 60 referências após parar. Nenhum novo carregamento de modelos, texturas ou materiais nesse ciclo; zero exceções e assets com falha. Preparação e montagem: 3,249 segundos nesta execução (não é comparação controlada de desempenho).

`tests/resources-model-lifecycle.ts` valida na GPU: handoff da pré-carga, duplicação, remoção, três ciclos de Play destruindo a cópia, rejeição de Play, falha de cena/factory, restauração antes e depois do descarte, API legada e cancelamento da preparação.

## Migração dos esqueletos

`acquireSkeletonAsset(win, path)` compartilha hierarquia, clipes e malhas por janela/caminho normalizado. Cada Skeleton retém seu asset; poses de trabalho, overrides e transformações dos ossos continuam independentes. Remover o componente ou limpar a cena solta sua referência. A última referência agenda o descarte das malhas e materiais GPU; as texturas continuam no cache da janela.

A transição de CPU (`win=0`) para GPU adota o asset da janela sem modificar o asset dos demais consumidores headless e preserva os buffers de pose. Essa transição antes podia deixar o componente apontando para o asset CPU mesmo depois do upload. Caminhos equivalentes não causam reconstrução a cada frame.

`loadSkeletonAsset` permanece como API legada com retenção até `clearSkeletonCache()`. O exemplo de cidade usa uma referência temporária durante a pré-carga dos pedestres, transferida ao Skeleton ao montar. Falhas de carga descartam malhas parciais e não publicam uma entrada incompleta no cache.

No benchmark `ed-padrao` (300 quadros), o quadro médio foi de 3,069 para 3,547 ms e a CPU TS de 2,165 para 2,366 ms, ambos com zero GC/objetos por quadro. A carga geral da máquina variou de 19,77% para 27,53%; uma amostra por versão não isola o efeito da alteração.

As regressões de pose, Inspector, WS e carregamento passaram, junto de 28 testes estáticos. As metas antigas de tempo NÃO passaram neste runtime: AnimationPlayer mediu 3,186 ms para 17 personagens (limite 0,3), e Animator 5,748 ms (limite 0,7). Um microbenchmark equivalente com Skeleton anterior também ficou acima da meta: 3,066 ms; a versão migrada mediu 3,438 ms em outra execução. Amostras únicas, sem conclusão de melhora ou regressão; a otimização das animações permanece pendente. Os testes originais mantêm seus limites. O teste antigo de cor foi atualizado para a conversão linear→sRGB já existente no importador, após reproduzir sua falha com o loader anterior.

Validação: `tests/resources-skeleton-lifecycle.ts` testa CPU/GPU, poses independentes, remoção, três ciclos de Play, falha/retry e compatibilidade; `tests/resources-skeleton-gc.ts` completa 200 mil consultas por duas instâncias com zero GC entre os marcadores.

## Migração do áudio

`acquireAudioClip(path)` devolve `ResourceLease<AudioClip> | null`. Fontes mantêm sua referência; cada voz e cada agendamento adquire outra. Encerrar ou remover uma fonte não invalida um efeito independente que ainda toca. Vozes em pausa conservam amostras; parar preserva o buffer até acabar a rampa de saída. Fim natural, parada, roubo de voz virtual e fechamento do dispositivo soltam as referências dos slots e seus arrays de amostras.

Cancelar agendamentos e parar o jogo também solta os clipes que ainda não começaram. Após a última referência, o clipe sai da tabela global por ID; os IDs não são reciclados. A tabela conserva posições nulas, mas não os buffers descartados.

`AudioClip.load` mantém a compatibilidade com retenção explícita pelo cache. `clearAudioClipCache()` solta essa retenção e respeita consumidores ativos. `fromSamples` e o gerador legado `toneClip` ainda não foram migrados para descarte automático. O navegador do editor conserva apenas o rótulo de duração; tocar uma prévia pode decodificar novamente um arquivo que ficou sem donos.

Criar uma voz/agendamento para um arquivo gerenciado aloca uma referência no evento; o caminho estável de mixagem não cria referências a cada bloco.

`tests/resources-audio-lifecycle.ts` cobre fontes compartilhadas, última voz, rampas, efeitos independentes, término natural, agendamento/cancelamento, pausa, roubo de voz virtual, API legada e fechamento do dispositivo.

## Verificação

Após a migração do áudio: build AOT passou; 28 testes estáticos passaram, além das regressões de clipes, fontes, mixer, grupos, pump, relógio DSP e Play. `tests/resources-audio-gc.ts` passou com zero GC em 200 mil blocos usando arquivo gerenciado. A sonda `claude-test-audio-gc.ts` também completou 200 mil iterações em cada fase (mixar, pump e quadro) sem GC.

Benchmark local do editor, 300 quadros e 60 de aquecimento: quadro médio 3,060 → 3,086 ms; CPU TS 2,159 → 2,184 ms; zero GC e zero objetos por quadro em ambos. Uma amostra por versão, carga da máquina 18,27% → 27,22%; os números não demonstram ganho de FPS. Artefatos: `build/audio-resources-frame-before.json` e `build/audio-resources-frame-after.json`.

- `tests/resources.ts`: compartilhamento, última referência, idempotência, retenção/evicção, escopo, falha/retry, caminhos e descarte por janela. Sonda de 200 mil consultas, resolução de material estável e flush vazio: zero coletas entre os marcadores.
- `tests/resources-render.ts`: worker único para pedidos equivalentes, cancelamento independente, cache concluído, separação cor/dados, erro compartilhado, modelo compartilhado e materiais GPU com edição isolada e liberação.
- 31 testes existentes de componentes, editor, contrato do runtime e cache de modelos passaram.
- Medição anterior à migração dos modelos, na cena da cachoeira: 60 referências de materiais compartilham 5 recursos GPU; 14 texturas e 13 modelos ficam retidos no cache. Nenhum job pendente, asset faltando ou exceção. Após Rodar/Parar, voltaram os mesmos 5 materiais e 60 referências; as 14 texturas não foram recarregadas. Preparação e montagem da cena: 2,804 segundos nesse teste.
- Benchmark local `ed-padrao`, 300 quadros, 60 de aquecimento, sem vsync: média de quadro 2,873 ms antes e 3,157 ms depois; CPU TS 2,078 → 2,196 ms. Zero GC e zero objetos alocados por quadro em ambos. Uma amostra por versão, com cargas de máquina diferentes; não demonstra ganho de FPS. O benefício desta mudança é o compartilhamento e o controle de vida dos recursos.

## Correção de propriedade do mundo procedural

WorldStream agora conserva os objetos Material que possuem os leases e libera essas referências ao encerrar. Não chama materialFree diretamente sobre IDs compartilhados. O teste resources-world-lifecycle verifica 50 ciclos de dois mundos e um consumidor externo, com retorno das referências ao baseline.

A limpeza de GameObject tenta todos os componentes e o modelo antes de propagar a primeira falha. Scene.clear conclui a limpeza/remoção de todos os objetos; removeAt e removeBehavior deixam os índices/donos consistentes antes de reportar erro de descarte. Teste: resources-cleanup-failure.ts. A auditoria dos demais caminhos de rollback e cancelamento continua pendente em F01.
