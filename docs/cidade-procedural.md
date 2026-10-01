# Cidade procedural e carregamento

```powershell
.\run-pbr.ps1 -Scene city -Seed 42
.\run-pbr.ps1 -Scene city -Seed 1234
```

A mesma seed reproduz os mesmos lotes. `CityLayout` varia altura, largura,
profundidade, recuo, fachada e skyline. A avenida, calçadas e rotas ainda têm
topologia fixa: esta versão não gera redes arbitrárias de ruas nem cidades infinitas.
O teste `tests/city-layout.ts` verifica repetibilidade e separação de lotes/rotas
em 100 seeds. Os pedestres e carros continuam usando os controladores de rota.

`LoadingScreen` desenha céu de pôr do sol, silhuetas, etapa, porcentagem e barra
animada. É reutilizável: chame `draw(win, label, progress)` entre beginFrame/endFrame.
Não controla o carregamento nem fabrica progresso. A cidade e o exemplo `loading`
fornecem o progresso de suas tarefas. Esc cancela e fecha. O layout acompanha
o tamanho da janela e não precisa carregar imagens para aparecer.

Para revisar somente o desenho: `.\run-pbr.ps1 -Scene loading_preview`.
Essa prévia identifica a simulação na tela, anima o indicador e fecha após 90 s.
Não representa uma cidade sendo carregada.

## Correção do bloqueio dos pedestres

`TextureLoadOperation` faz leitura, decodificação PNG e preparação de mipmaps
numa thread nativa. `tick()` consulta o resultado sem esperar e envia a textura
à GPU quando pronta; o cache existente evita decodificá-la novamente no Skeleton.
Expõe `progress`, `done`, `texture`, `error` e `cancel()`. Por enquanto são PNGs
de cor sRGB, até 4096 por dimensão/64 MiB; cancelamento descarta o resultado,
mas não interrompe uma decodificação nativa já iniciada.

A importação GLB usa TextDecoder nativo, preservando nomes UTF-8. O carregador
de esqueletos aceita um callback de atualização entre ossos/canais. Esse callback
deve somente atualizar a UI, sem carregar outro modelo: os accessors ainda
compartilham o offset BIN. A leitura/parse do GLB e cada primitive/canal individual
continuam síncronos; não há garantia de orçamento para modelos arbitrários.

Medição local em runtime debug, RTX 2080 Ti, VSync, seed 42:

- Antes: abertura após entrada no script **23,77 s**, maior trecho **5.436,75 ms**.
- Depois, com nova UI e geração por seed: **4,81 s**, pedestres **11,43 ms**.
- Maior trecho de toda a montagem: **241,37 ms**, inicialização gráfica.
- Primeiro quadro 3D ainda custa aproximadamente **1,1 s**; isso não é FPS estável.

São execuções pontuais, não benchmark de release. Compilação do TypeScript antes
da entrada no script não está incluída. Log: `build/pbr-city-async.log`.
