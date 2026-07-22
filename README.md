# Engine RTS — game engine estilo Unity, 100% em TypeScript

Uma game engine 3D no modelo **Unity** (tudo é `GameObject`, componentes com ciclo
`mount → update(dt) → render`), escrita inteiramente em **TypeScript** e rodando
sobre o motor **RTS** (`rts.exe`, um compilador/runtime TS→nativo via Cranelift).
O 3D é **software rendering em TS** (rasterizador próprio com z-buffer + shading),
apresentado pela camada `render.*` do RTS (backend egui).

```
rts.exe run main.ts          # editor visual (janela): toolbar, hierarquia, inspector, viewport 3D
rts.exe run harness.ts       # porta de controle headless (stdin) — pra testar/dirigir por script
rts.exe run netharness.ts    # porta de controle TCP (:7777) + janela ao vivo
```

## Modelo (Unity-like)

- **GameObject** — a unidade da cena. Tem `Transform`, um mesh, cor, uma lista de
  `Behavior` (scripts) e um `parent` (hierarquia).
- **Transform** — posição/rotação/escala **locais** + posição/rotação de **mundo**
  (compostas com o pai por `Scene.computeWorld`).
- **Behavior** (o "MonoBehaviour") — script de gameplay. Sobrescreve `mount()` /
  `update(dt)` e se serializa via `toData()`. Rodam num array polimórfico.
- **Scene** — lista de GameObjects + `update(dt)` polimórfico + `resolveCollisions()`
  + `computeWorld()`.

```
engine/core/    transform.ts · behavior.ts · gameobject.ts · scene.ts · camera.ts
engine/render/  raster.ts (z-buffer + shading) · mesh.ts (geometria data-driven) · draw.ts (wireframe)
engine/testkit/ dump.ts (preview ASCII / estado / PPM)
scripts/        spinner · bobber · rigidbody · mover · pulse   (componentes de gameplay)
```

## O que já tem

- **Render 3D software**: projeção perspectiva, faces sólidas, **z-buffer**,
  shading por normal·luz, câmera-fly, **picking** por clique.
- **4 meshes** data-driven: cubo, pirâmide, octaedro, **esfera** (UV lat/long).
- **Luz direcional** + ambiente controláveis.
- **Física**: `Rigidbody` (gravidade + colisão com o chão + quique) e **colisão
  esfera-esfera entre objetos** (empilhamento).
- **Hierarquia parent/child**: o filho orbita **e** herda a rotação do pai.
- **Componentes**: Spinner, Bobber, Rigidbody, Mover, Pulse — componíveis (um
  objeto pode cair + girar + pulsar ao mesmo tempo).
- **Editor**: toolbar (Play/Pause, +Cubo/+Esfera/Deletar), hierarquia clicável,
  inspector com sliders de transform.
- **Serialização de cena em JSON** (`JSON.stringify`/`parse` nativos do motor);
  os componentes se serializam sozinhos e voltam anexados no load.
- **Portas de controle** (stdin + TCP) pra dirigir/testar tudo sem depender de
  screenshot — ver [TESTING.md](TESTING.md).

## Portas de controle

Ambas aceitam o mesmo protocolo de comandos (um por linha). Exemplo:

```bash
printf 'spawn box 0 1.5 0 1.2\nspin 0 1.0\nrigid 0\nmesh 0 4\nstep 30\nstate\nframe\nquit\n' \
  | ./rts.exe run harness.ts
```

Comandos: `spawn move rot scale mesh spin bob rigid mover pulse parent select cam
light ambient play pause step frame state lit save savescene loadscene delete dup
color name quit`. Detalhes em [TESTING.md](TESTING.md).

## Notas de motor

O `rts.exe` é copiado do repo `rts` (gitignored). Durante o desenvolvimento, dois
bugs do motor foram encontrados e **corrigidos no próprio motor RTS**: colisão de
nome de classe com shims do prelude (`Transform`/`Duplex`/…) e `const`/`let` de
módulo lido dentro de função. A engine explora esses fixes (geometria e scratch
de render vivem em arrays/consts de módulo lidos pelas funções de render).

Limitação de codegen respeitada em toda a engine: **método sobre parâmetro
tipado-classe não despacha** — por isso o render pass extrai os campos no call
site e passa primitivos (funções top-level chamando namespaces).
