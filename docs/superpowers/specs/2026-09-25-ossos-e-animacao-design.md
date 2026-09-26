# Ossos e animação por clipe — desenho

Data: 2026-09-25. Pedido: "precisamos criar o componente de ossos". Motivação
imediata: os personagens do rts-fps deslizam sem animar; os modelos Kenney
(Blocky Characters, CC0) trazem 27 animações em glTF.

## 1. O que o arquivo real tem (medido em `character-a.glb`)

- Hierarquia de **nós rígidos**: `character-a → root → {leg-left, leg-right,
  torso → {arm-left, arm-right, head}}`; cada nó de membro tem uma malha e uma
  pose de repouso (T, R, S).
- **Sem skinning**: nenhum `skins`; os "ossos" são os próprios nós, cada um
  levando a sua peça inteira. (Skinning — malha deformada por vários ossos —
  fica fora deste desenho; §7.)
- 27 clipes, todos LINEAR, canais `rotation` (quaternion), `translation` e
  `scale`: `idle` 1,33 s, `walk` 0,67 s, `sprint`, `die`, `holding-right`,
  `holding-right-shoot`, `sit`, emotes…

## 2. O modelo Unity que seguimos

| Unity | Aqui |
|---|---|
| hierarquia de Transforms (ossos) sob o objeto | `Skeleton`: lista de ossos (pai, pose de repouso, peça) — dados, não GameObjects |
| `SkinnedMeshRenderer` / `MeshRenderer` por peça | o próprio `Skeleton` desenha cada peça na pose do osso |
| `AnimationClip` | `AnimClip`: canais (osso, propriedade, tempos, valores) |
| `Animator` / `Animation.Play(nome)` | componente `AnimationPlayer`: `play(nome, loop, fade)`, `speed`, tempo |

Por que os ossos não viram GameObjects: 17 jogadores × 6 ossos = 102 objetos
a mais na cena (índice espacial, `computeWorld`, serialização) sem ganho —
nada colide nem é selecionado por osso. Ficam como arrays paralelos no
componente, o padrão do motor para dados quentes.

## 3. Peças

### rts (runtime, PR à parte) — rotação completa no `drawMesh`
`drawMesh(win, { …, qx, qy, qz, qw })`: com quaternion presente (`qw` ou
qualquer componente ≠ 0 — default `qw` ausente), a matriz de modelo usa a
rotação do quaternion no lugar de `rx/ry`. Sem ele, idêntico a hoje. Custo:
zero para quem não passa; a matriz já é montada na CPU (`draw_record`), o
shader não muda. Também resolve a arma de primeira pessoa (pitch com yaw ≠ 0).

### rts-game
- `src/engine/render/quat.ts` — funções puras: multiplicar, girar vetor,
  slerp/nlerp, de yaw+pitch, identidade. Sem objeto por chamada: saída em
  `Float64Array` passada pelo chamador (helpers com ≤ 4 parâmetros; ver
  `tools/check-params.mjs` e rts#2760).
- `src/engine/render/gltf_anim.ts` — lê do `.glb` os nós (pai, TRS, malha) e as
  animações (canais, tempos, valores) além das malhas que `model.ts` já sobe.
  Resultado cacheado por caminho: `SkeletonAsset { ossos, pecas, clipes }`.
- `src/engine/core/skeleton.ts` — componente `Skeleton` (`KIND_RENDERER`):
  aponta o asset, guarda a **pose atual** por osso (T, R, S locais em arrays
  paralelos), compõe a pose de mundo pela hierarquia e desenha cada peça com o
  quaternion final (transform do objeto × pose do osso). Pose de repouso sem
  player. Serializa o caminho do modelo.
- `src/engine/core/animation_player.ts` — componente `AnimationPlayer`:
  `play(nome, loop)`, `crossFade(nome, segundos)`, `speed`, `time`; no
  `update(dt)` amostra o clipe (busca binária no tempo, lerp em T/S, nlerp em R)
  e escreve a pose no `Skeleton` do mesmo objeto; com fade, mistura as duas
  poses. Sem alocação por frame.

### rts-fps
Personagens passam a ser `.glb` com `Skeleton` + `AnimationPlayer` (só no
cliente): `idle` parado, `walk`/`sprint` pela velocidade, braço direito em
`holding-right` (e `holding-right-shoot` ao atirar), `die` ao morrer. A arma
vai no osso `arm-right`.

## 4. Custo alvo

Por personagem por frame: amostrar ~6 canais + compor 6 ossos + 6 desenhos.
Meta: 17 personagens animados ≤ 0,3 ms de CPU no frame; zero coletas por
escala (10× frames → mesmas coletas).

## 5. Testes

- `quat`: identidade, composição, rotação de vetor, slerp nos extremos e no
  meio, normalização (sem janela).
- `gltf_anim` sobre o `character-a.glb`: 8 nós com os pais certos, 27 clipes,
  `walk` 0,667 s; amostrar `walk` em t = 0 devolve o primeiro keyframe exato e
  em t = meio caminho entre dois keys devolve o nlerp esperado.
- `AnimationPlayer`: laço volta ao início; sem laço para no fim; crossfade em
  50 % dá a média das poses; troca de clipe sem salto.
- Composição: com o pai girado 90° em Y, a peça filha fica onde a conta manda.
- Custo: 17 personagens × 1.000 frames, tempo médio e coletas.
- Visual: cena de inspeção com os 4 personagens em idle/walk/sprint/die.

## 6. Ordem de entrega

1. rts: quaternion no `drawMesh` (+ testes do scene3d) — PR.
2. rts-game: `quat`, `gltf_anim`, `Skeleton`, `AnimationPlayer`, testes.
3. rts-fps: personagens animados; arma presa no osso.

## 7. Fora deste desenho

Skinning (malha deformada por pesos de vários ossos, o formato dos pacotes
Quaternius/Mixamo): precisa de atributos de peso/índice por vértice e de
matrizes de osso no shader — um PR de renderer maior. O `Skeleton` daqui é a
base (hierarquia, clipes, player) que ele reutilizaria.
