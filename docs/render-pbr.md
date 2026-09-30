# Primeira etapa de renderização PBR

Implementada na branch `feature/render-pbr` do jogo e na branch de mesmo nome do runtime em `build/rts-pbr` (base `c47f13b0a`). O executável de desenvolvimento está em `build/pbr-target/debug/examples/ui_fixture.exe`.

## Executar

Na raiz do jogo:

```powershell
.\run-pbr.ps1
# Cidade ao pôr do sol:
.\run-pbr.ps1 -Scene city
# Escultura de terreno:
.\run-pbr.ps1 -Scene terrain
# Carregamento de cena com progresso:
.\run-pbr.ps1 -Scene loading
# Recompilar o runtime antes de abrir:
.\run-pbr.ps1 -Build
# Captura da cena 3D e encerramento automático:
.\run-pbr.ps1 -Frames 12 -Capture build/pbr-courtyard.ppm
node tools/pbr-preview.mjs build/pbr-courtyard.ppm build/pbr-courtyard.png
```

`-Release -Build` compila a versão otimizada. A validação realizada usou debug, sem promessa de desempenho. A cena `examples/pbr_courtyard.ts` usa materiais de pedra, madeira e metal, normal maps, sombras e cinco esferas com rugosidades diferentes. As texturas procedurais podem ser regeneradas com `node tools/pbr-assets.mjs`.

Câmera livre: WASD movimenta; segurar o botão direito e mover o mouse gira a visão; Q/E desce/sobe; Shift acelera; R restaura o enquadramento inicial; Esc sai. O botão X também encerra o laço, que agora verifica `isOpen` depois de bombear eventos. É uma câmera de inspeção sem colisão. O contador mostra FPS e tempo médio por quadro, com VSync ligado.

`examples/pbr_city.ts` cria uma avenida com prédios, vitrines, janelas emissivas, carros estacionados, árvores, postes, sinalização, skyline e névoa ao pôr do sol. A arquitetura estática é agrupada em 11 malhas por material. Agora há 20 pedestres Kenney com animações walk/idle e 8 carros em circulação nos dois sentidos. Os pedestres usam RoutePath e RouteAgent; os veículos usam o mesmo controlador de estados. Os postes/janelas têm emissão visual, sem luzes pontuais próprias. O sol é a luz direcional com sombras; não há reflexos dos edifícios no vidro (o reflexo ainda vem do céu).

## Componentes de rotas e terreno

`RoutePath`, `RouteAgent` e `Terrain` estão registrados no catálogo da engine ativa e preservados pela serialização da cena. Veja [rotas e terreno](rotas-e-terreno.md) para configuração, controles e limites. O fechamento por Esc foi testado com entrada simulada nos mesmos laços usados pelas demonstrações; o caminho do X usa a condição nativa `isOpen`.

O novo [carregador assíncrono](carregamento-assincrono.md) prepara o JSON em um worker e distribui a criação de objetos entre quadros. A cidade procedural também apresenta progresso durante a construção. O custo de compilação anterior à janela é medido separadamente com `RTS_LOAD_TIMING=1`.

## O que mudou

- Materiais opt-in com BRDF Cook–Torrance/GGX, metallic, roughness, normal map, oclusão ambiente e emissão HDR.
- Texturas de cor em sRGB; normal, metallic/roughness e AO em espaço linear. Mipmaps completos e filtragem anisotrópica. Metallic no canal B, roughness no G e AO no R.
- Alvo HDR RGBA16Float e tone mapping ACES com exposição. O overlay da interface é composto depois.
- Importação glTF de fatores e mapas PBR, PNG externo, data URI e PNG embutido em GLB; emissão estendida por `KHR_materials_emissive_strength`. Materiais `KHR_materials_unlit` mantêm o caminho sem iluminação.
- Material e exposição preservados na serialização, campos PBR no inspector e materiais também usados pelas peças animadas.
- Captura PPM da cena 3D pelo renderer real, utilizada na demonstração e para diagnóstico.

Em `Material`, habilite `pbr = 1` e configure `metallic`, `roughness`, `normalScale`, `occlusionStrength`, `normalPath`, `metallicRoughnessPath`, `occlusionPath`, `emissivePath` e `emissiveR/G/B`. `texturePath` continua sendo a cor base. Os identificadores GPU são locais à janela e não são serializados.

Em `Ambiente`, `exposicao = 1` habilita o tone mapping com exposição neutra. Zero desliga o tone mapping e é o padrão para cenas antigas. O caminho de material legado permanece disponível com `pbr = 0`.

## Limites e próximas etapas

A iluminação de ambiente usa uma aproximação com panorama e mipmaps ou céu procedural. Ainda faltam convolução especular GGX, LUT da BRDF e probes locais para IBL mais fiel. Não há GI, SSR ou ray tracing nesta entrega. A geometria e as texturas da demonstração são referências técnicas; realismo também exige modelos, materiais e composição de iluminação de produção.

O novo importador de mapas aceita PNG e UV0; recusa explicitamente outros formatos de imagem, outros conjuntos UV e transformações de textura não identidade. Materiais transparentes, clearcoat e outras extensões não fazem parte deste marco. O alvo HDR existe também quando a exposição está desligada; medir custo em release e em cenas grandes é a próxima etapa antes de definir presets de qualidade.

## Validação realizada

- 35 testes nativos de scene3d passaram, incluindo teste opt-in de pixels em GPU NVIDIA RTX 2080 Ti/DX12: metallic, roughness, normal map, emissão HDR e exposição.
- `tests/pbr-material.ts`, `tests/pbr-gltf.ts` e `tests/pbr-roundtrip.ts` passaram.
- Regressões de fixedstep, interpolação e animação FPS passaram.
- Demonstração executada por 12 frames; captura `build/pbr-courtyard.png` inspecionada visualmente.
- Patches conferidos com `git apply --reverse --check` nas árvores modificadas.

```powershell
# A partir de build/rts-pbr (usar caminho absoluto para target-dir):
cargo test -p rts-egui --lib frame::scene3d --offline --target-dir C:/Users/nexga/Documents/GitHub/rts-game/build/pbr-target -- --include-ignored --nocapture
# A partir da raiz do jogo:
build/pbr-target/debug/examples/ui_fixture.exe tests/pbr-material.ts
build/pbr-target/debug/examples/ui_fixture.exe tests/pbr-gltf.ts
build/pbr-target/debug/examples/ui_fixture.exe tests/pbr-roundtrip.ts
```

## Revisão e reprodução das alterações

O workspace já continha uma cópia não versionada de `engine/` e aliases em `tsconfig.json` apontando para ela. As alterações foram feitas nessa engine ativa, preservando o trabalho existente. Não foi feito stage em massa, commit ou push das alterações preexistentes.

Como `build/` é ignorado, `patches/render-pbr-runtime.patch` preserva todas as mudanças nativas, inclusive arquivos novos. Para outro checkout do runtime na base indicada:

```powershell
git -C <checkout-do-runtime> apply --check <caminho-absoluto>/patches/render-pbr-runtime.patch
git -C <checkout-do-runtime> apply <caminho-absoluto>/patches/render-pbr-runtime.patch
```

Coloque esse checkout em `build/rts-pbr` para usar o script de execução. `patches/render-pbr-engine.patch` registra somente as mudanças desta entrega sobre a cópia de `engine/src` que já existia; ele requer essa mesma base, não a engine antiga de `src/engine`. Os patches já estão aplicados neste workspace: não reaplicá-los aqui. Demonstração, testes, ferramentas e assets estão fora dos patches, nos respectivos diretórios do jogo.
