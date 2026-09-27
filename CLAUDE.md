# Convenções deste projeto

## Interface do editor

- Centralize medidas de layout, limites de painéis, espaçamentos, rótulos de menus e cores em `src/editor/ui_config.ts`. Não espalhe esses valores por `main.ts` ou por widgets novos.
- Não introduza números mágicos para posicionamento. Expresse posições derivadas a partir de medidas nomeadas. Exemplo: o início da lista da Hierarquia é `UI_BAR_H + UI_HIER_HEADER_H + UI_HIER_SEARCH_H`, não `UI_BAR_H + 82`.
- Use nomes semânticos para estados visuais (como `UI_C.toolHover` e `UI_C.toolIdle`) em vez de literais hexadecimais dentro de condições ou chamadas de desenho.
- Reutilize as mesmas constantes para desenho e detecção de mouse; a área clicável deve acompanhar o elemento visível quando uma medida mudar.
- Valores de estado que o usuário pode modificar (largura dos painéis, ferramenta selecionada, filtro) continuam mutáveis no editor; seus padrões e limites ficam na configuração.
- Constantes de matemática, física e renderização 3D não pertencem ao tema visual; mantenha-as próximas do sistema correspondente, também com nomes quando não forem óbvias.
- Ao alterar a UI, verifique a compilação e, quando possível, o comportamento visual e de interação na janela do editor.
- Abas, Console e confirmações são controles reutilizáveis da `UIScene`; IDs de controles devem ser únicos na janela, não apenas no painel. Centralize também seus rótulos e medidas.
- Ícones do editor são assets PNG com fonte em `assets/editor/icons/source.json`; regenere com `npm run icons` e confira `npm run icons:check`. Reutilize `icon_images.ts` e seu cache, sem ler/decodificar imagens por frame. Teste transparência e a imagem real na UI, não apenas um substituto textual.
- Abrir/nova cena pela UI deve passar por `SceneDocument` e confirmar alterações pendentes. Nunca limpe a cena antes de validar o JSON. Salvar só limpa o estado de alterações após verificar escrita e substituição do arquivo; o runtime pode falhar em I/O sem lançar exceção.
- Build usa um snapshot em pasta própria, sem sobrescrever o arquivo de autoria. Informe sucesso/falha e destino no Console; mantenha processos nativos referenciados durante eventos e teste o build com o editor aberto.
- O catálogo e a fábrica são gerados por `tools/generate-components.mjs` a partir das classes exportadas que estendem `Behavior` em `src/engine/core`, `src/scripts` e `assets/scripts`. Não mantenha listas ou factories manuais no editor e não edite `src/engine/generated` à mão.
- Categoria, descrição, termos de busca e presets opcionais pertencem ao arquivo da classe (`@componentCategory`, `@componentDescription`, `@componentKeywords`, `@componentFactory`). Construtores de componentes precisam aceitar zero argumentos; os padrões ficam na classe.
- Widgets de seleção devolvem a escolha; a mutação da cena e o snapshot de Desfazer/Refazer ficam no editor. Cubra busca, categorias, navegação e estado vazio com testes sem janela.

## Criação de objetos

- Arrastar scripts deve resolver o caminho de origem no catálogo gerado, nunca adivinhar a classe pelo nome do arquivo. Reutilize o ciclo de anexar/montar do seletor, preserve Desfazer/Refazer e rejeite destinos inválidos, scripts não compilados ou ambíguos. O duplo clique usa o editor escolhido nas preferências locais; sem escolha, usa a associação do sistema. Trate caminhos como dados literais e nunca altere associações. A lista de editores só mostra executáveis detectados; instalações diferentes usam Procurar. Cancelar não deve salvar nem apagar a escolha anterior.

- Controles novos do editor devem ser GameObjects criados por `UIScene.createGameObject`, com componentes responsáveis pelo desenho e input. Reutilize suas identidades entre frames; não crie uma árvore nova por frame.
- Scripts novos expõem campos públicos `number/f64`, `boolean` e `string` automaticamente. Campos privados/protegidos ficam ocultos salvo `@serializeField`; `@hideInInspector` oculta sem excluir da cena, `@nonSerialized` exclui. Métodos, getters, static e readonly não são parâmetros. Não use decorators de runtime: estas marcações são JSDoc lidas no build.
- Um campo `string` que guarda um CAMINHO de asset (áudio, imagem, modelo, prefab, cena, script) marca `@asset <kind>` (`kind` = `audio`/`imagem`/`modelo`/`prefab`/`cena`/`script`) em vez de escrever código de Inspector: o campo vira um ObjectField completo (caixa+ícone, seletor, ping no Project, arrastar um tile ou um arquivo do Explorer, Delete) sozinho, em qualquer componente — do motor, de um pacote ou de um script do usuário. Tipo mostrado, extensões aceitas e ícone de cada `kind` ficam centralizados em `UI_ASSET_KINDS` (`src/editor/ui_config.ts`); não repita esses valores no componente. Nunca escreva o `ObjectField` à mão para um campo assim.
- `fieldCount/fieldLabel/fieldType/fieldGet/fieldSet` continuam como extensão para inspectores personalizados legados. Scripts comuns não precisam implementá-los. Não adicione testes de nome de componente no Inspector para escolher controles. Use `onValidate(field)` para dados derivados.
- Salvar, duplicar e Rodar devem usar `componentToData` para preservar também os campos automáticos de componentes com formato legado. Valores do Inspector pertencem à instância na cena; nunca reescreva o `.ts` do usuário.
- Depois de alterar scripts, rode `npm run components`, `npm run test:components` e `npm run components:check`. Os builds oficiais geram o catálogo antes de chamar RTS. Versione a saída gerada; execução direta de `rts run/compile` requer regeneração prévia. Recarga de código durante uma sessão ainda não está implementada.
- Scripts podem importar `createComponent` de `@engine/components`, mas nunca importar o registro gerado: o RTS não linka ciclos de import. O bootstrap do editor/jogo instala o provider uma vez.
- Mantenha os GameObjects da UI em uma cena separada da cena editada. Visibilidade deve respeitar `active` dos ancestrais e `enabled` do componente; a UI não deve aparecer no arquivo do jogo.
- Rodar deve simular cópias da cena. Parar restaura os objetos originais, a seleção e o histórico. Bloqueie salvar/build durante a simulação e recuse componentes sem suporte a cópia antes de trocar a cena.

- Para objetos novos criados pelo editor, use `scene.createGameObject(...)`. A cena deve cuidar de instanciar, registrar, montar e manter os caches sincronizados. Deixe os presets de menu e a posição inicial no editor.
- Mantenha os presets do menu Criar em `src/editor/object_presets.ts`. O menu global, o menu de contexto e a criação devem ler os mesmos registros; não copie rótulos, tipos de malha ou cores para cada menu.
- Use `scene.add(...)` para objetos já construídos (por exemplo, desserialização ou clone), sem recriá-los.

## Custo por quadro (RTS)

- Caminhos por quadro (desenho, UI, física, luzes, scripts): no máximo 4 parâmetros por função/método. No RTS, 5+ parâmetros escalares alocam por chamada (e 5+ com valor padrão também custam ~0,5 µs). Passe vetores/retângulos num `Float64Array` do chamador, ou o estado do próximo desenho por um setter (`pincel`/`caixa`, `texto`/`estiloTexto`, `EditorUI.at`, `area`/`mouse`). `npm run check:params` acusa 5+ parâmetros fora da lista de exceções justificadas em `tools/check-params.mjs`.
- Desenho 2D do editor e do jogo por `@compat/draw2d.ts`; imagens que não mudam por `registrarImagem`/`imagemId` (textura retida), nunca `imagem` por quadro.
- Não monte strings por quadro: guarde o rótulo e refaça só quando o valor mudar (`editor/rotulos.ts`, `EditorControl.legenda`, `CampoCache`). Chaves de controle criadas uma vez.
- `try/catch` fora de funções por quadro: no RTS a função que contém `try` aloca a cada chamada, mesmo sem entrar nele — ponha o caminho lento numa função própria.
- Toda mudança num caminho por quadro vem com sonda de alocação: 200k iterações com `RTS_GC_DEBUG=1`, 0 coletas entre os marcadores (`tests/claude-test-frame-gc.ts`). Meça o quadro com `node bench/claude-frame-bench.mjs` (RTS_VSYNC=0, GC/1000 quadros, carga da máquina) e compare antes/depois na mesma sessão.

## Áudio

- A IA não ouve pelo ouvido, mas verifica sozinha: por número — `audio list`, `audio nivel`, `audio mixer` — e pela saída real da placa com `audio escuta [ms] [sonda]` + `audio escuta resultado` (loopback, não bloqueia a janela; a sonda de 997 Hz separa o som do motor do de outros programas). Testes sem janela rodam no dispositivo nulo (`initAudio(AUDIO_NULO)` + `mixarBloco`). Não dependa do humano para saber se há som.
- Caminhos por quadro do áudio (`pumpAudio`, `mixarBloco`, `audioQuadro`, `audioSincronizar`) seguem "Custo por quadro": estado de voz na tabela `Float64Array`, pedidos de voz reaproveitados, nada de `AudioClip.load` por quadro sem cache.
- Clipes em `assets/audio/`; o mixer do projeto em `assets/audio/mixer.json`, fora do Desfazer da cena.

## Partículas

- A IA verifica o efeito sem olhar a janela: `particulas <obj> info` (vivas, max, tocando, t, bbox). Testes sem janela rodam a simulação pura, sem depender de `drawParticles` nativo (fallback registrado em `logWarn` uma vez).
- Caminhos por quadro (`ParticleSystem.update`, `drawSelf`, `emitirN`, `atualizarVidas`, `aplicarVelocidade`) seguem "Custo por quadro": pool em `Float64Array` (SoA), buffer de saída para o nativo reaproveitado, reciclagem de partícula morta por lista de livres (sem compactar), nada de `AudioClip.load`-like sem cache (aqui, a textura via `resolveMaterialTexture`, já cacheada). A ordenação `sort=1` (back-to-front, só modo alfa) é um bucket sort O(n + baldes), não a inserção O(n²) original — a inserção estourava o orçamento por ~3250x a 10 000 partículas.
- Presets do menu Criar (`Fogo`, `Fumaça`, `Faíscas`, `Chuva`) ficam em `src/editor/object_presets.ts`, com uma fábrica `componentes()` que devolve instâncias NOVAS a cada criação (nunca a mesma instância reaproveitada entre dois objetos).
- Fora do Play, só o objeto SELECIONADO simula (prévia de edição no Inspector); `playOnAwake` só dispara dentro do Play/jogo. Neste runtime interpretado, mesmo sem `sort`, 10 000 partículas vivas já custam bem mais que 1 ms de CPU por quadro (`bench/claude-bench-particulas.ts`) — trate `maxParticles` alto como algo a medir, não como algo garantido barato.
