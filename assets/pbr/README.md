Texturas procedurais de referência geradas por `node tools/pbr-assets.mjs`.
Sem downloads ou assets externos. Servem para verificar o pipeline, não como
substitutas de materiais escaneados para a arte final.

- `*-base.png`: sRGB.
- `*-normal.png`: dados lineares, normal tangent-space +Y (glTF).
- `*-orm.png`: dados lineares, R=oclusão, G=rugosidade, B=metalicidade.

O mesmo ORM é usado nos slots metallicRoughness e occlusion.
