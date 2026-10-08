# Assets do Vale da Cachoeira

`tools/create-waterfall-world.py` gera as malhas OBJ e a cena
`scenes/waterfall-world.json`. Rochas, troncos, copas e capim sao agrupados por
material; nao ha um GameObject por planta. Sao malhas estaticas, ainda sem
instancing GPU, LOD individual ou pintura de vegetacao no Terrain.

`rock-moss-base.png` foi gerada pela ferramenta integrada image_gen em
03/10/2026 e copiada para esta pasta. E uma textura de cor; nao e material
escaneado e nao tem normal map derivado. Os materiais usam rugosidade escalar.
Madeira reutiliza os mapas de referencia de `assets/pbr`.

`rock-moss-runtime.png` preserva exatamente os pixels da original, mas usa
PNG sem filtros e sem compressao DEFLATE. Gerado por
`tools/prepare-waterfall-texture.py` (Pillow), com comparacao byte a byte dos
pixels. O decoder real da engine validou 1254x1254 em 16.184 ms neste runtime
de desenvolvimento. A carga ainda e sincrona; este empacotamento nao substitui
o trabalho futuro de decodificacao em background e tela de progresso.

A cena foi aberta com zero falhas de assets apos corrigir a inicializacao da
janela/GPU antes de carregar a cena no editor. Na medicao final interativa,
o intervalo mediano de 120 quadros ficou em 31,32 ms (aproximadamente 32 FPS).
O visual ainda usa vegetacao procedural simples, sem pretensao de arte final.

Prompt final usado:

> Create one square seamless tileable physically based rendering BASE COLOR texture for a realistic 3D forest waterfall game environment. Orthographic flat scan, completely fills frame: naturally weathered irregular gray sandstone rock, muted olive moss in small cracks, fine granular rough stone detail, subtle darker wet mineral streaks. Mostly neutral gray tan stone 80%, sparse desaturated moss 20%. Natural erosion and irregular strata, NO bricks, NO paving stones, NO grid, NO geometric tiles. Uniform diffuse illumination, no directional lighting, no highlights, no cast shadows, no perspective, no horizon, no text or borders. Seamless on all four edges, fine detail, restrained contrast. This is a reusable game material texture, NOT a landscape illustration.

A cachoeira combina WaterBody/Spline e particulas de gotas/nevoa. Nao simula
conservacao de volume, transbordamento ou preenchimento dinamico das margens.
