# Assets reais da cena de cachoeira

Fonte: Poly Haven, licen?a CC0-1.0 (https://polyhaven.com/license).

- Rochas: https://polyhaven.com/a/rock_moss_set_01
- Pinheiros: https://polyhaven.com/a/pine_sapling_small
- Samambaias: https://polyhaven.com/a/fern_02
- Solo: https://polyhaven.com/a/forest_ground_04

`sources.json` registra URLs, MD5 fornecido pelo cat?logo e SHA-256 local dos arquivos originais. Os modelos mant?m a geometria integral; o pacote de texturas escolhido ? 1k. A cena instancia aproximadamente 1,37 milh?o de tri?ngulos nos modelos, al?m de terreno e ?gua.

## Reproduzir

Na raiz do projeto, com Python, Pillow e curl instalados:

```
python tools/import-polyhaven-waterfall.py
python tools/prepare-polyhaven-waterfall.py
npm run build:editor
```

Abra `scenes/waterfall-polyhaven.json` no editor, ou use `RTS_SCENE=scenes/waterfall-polyhaven.json` ao iniciar `build/RTSEditor.exe`.

A convers?o mant?m os originais. Os arquivos `runtime-*.gltf` separam as variantes de cada conjunto, preservando o buffer bin?rio. PNGs derivados preservam os pixels RGB decodificados do JPEG e incorporam as m?scaras de opacidade nas folhas. Usam filtro zero e compress?o zero para reduzir o trabalho do decodificador atual. Isso aumenta o tamanho em disco. A cena associa os mapas de material explicitamente.

## Limites do teste

- O passe opaco descarta pixels com alpha menor que 0,5. N?o implementa transpar?ncia gradual de materiais glTF BLEND nem cutoff configur?vel por material.
- Sombras dos modelos ainda usam a geometria completa, sem recorte alpha.
- Esta cena usa inst?ncias GameObject por primitiva; n?o ? um sistema de vegeta??o com instancing, LOD ou streaming de texturas.
- A ?gua e a cachoeira s?o efeitos de superf?cie e part?culas, sem simula??o volum?trica de preenchimento.
- O carregamento desses modelos/texturas ainda exercita caminhos s?ncronos; a cena ? um teste pesado, n?o uma promessa de carregamento fluido.
