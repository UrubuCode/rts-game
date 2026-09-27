# Partículas no modelo da Unity (`ParticleSystem`) — desenho

Data: 2026-09-27. Pedido: um sistema de partículas no modelo da Unity (`ParticleSystem`/Shuriken), seguindo o mesmo princípio do desenho de áudio de 2026-09-27: "o motor ganha só o que um script não consegue fazer; o resto são pacotes". Primeiro efeito visível: fogo, fumaça, faíscas e chuva no próprio editor, sem consumidor externo obrigatório nesta fase.

Rascunho aprovado pelo usuário (ver §10).

## 1. Motivação e o modelo Unity

A Unity divide `ParticleSystem` em módulos, e o desenho segue a mesma divisão, sem o editor de curvas completo:
- **Main**: `duration`, `loop`, `startLifetime`, `startSpeed`, `startSize`, `startRotation`, `startColor`, `gravityModifier`, `maxParticles`, `simulationSpace`, `playOnAwake`.
- **Emission**: `rateOverTime` e até 4 `bursts` (tempo, quantidade).
- **Shape**: ponto, esfera, cone, caixa.
- **Over lifetime**: gradiente de cor (2–4 chaves, com alpha), curva de tamanho (2–4 chaves), velocidade sobre o tempo de vida (constante + arrasto).
- **Renderer**: modo alfa ou aditivo, textura, ordenação por distância.

O motor hoje não desenha nada disso: `drawGPUBuf`/`drawBatch` (spec de áudio, §"O que existe hoje" tem o equivalente para render em `gpu3d.ts`) desenham malhas opacas, com depth write ligado e sem billboard nem blend aditivo. 10 000 partículas por `drawGPUMesh` individual custariam 10 000 travessias TS→nativo por quadro — o mesmo problema que `drawBatch` resolveu para malhas (spec de áudio nunca fala de render, mas o princípio de "uma travessia, N desenhos" é o de `scene_api::draw_mesh_batch`, usado aqui).

## 2. O que existe hoje e os limites

**No rts-game:**
- `src/engine/render/gpu3d.ts` importa de `rts:egui`: `meshUpload`, `textureUpload`, `setCamera`, `setLight`, `setShadow`, `drawMesh`, `drawMeshBatch`, `setVsync`, `winWidth`, `winHeight`, `setLights`, `setSky`, `setFog`, `setViewport`, `setClearColor`, `setSkybox`.
- `drawBatch` (`gpu3d.ts:581`) monta uma única travessia: `transforms: Float32Array` (8 f32 por objeto: x,y,z,rx,ry,sx,sy,sz) + `codes: Uint32Array` (4 u32: mesh, cor `0xAARRGGBB`, emissivo, textura). A cor fica em `Uint32Array` À PARTE porque um `0xAARRGGBB` com alpha alto passa de 2^24 e um `f32` perde bits — o mesmo problema que o desenho de áudio evita ao não guardar ganho em `f32`.
- Há um invólucro **órfão**, `drawWaterGPU` (`gpu3d.ts:547`), que lança erro porque a superfície antiga (`egui.drawWater`, um desenho instanciado lendo um buffer de compute sem readback) não existe no motor novo. O comentário do próprio arquivo diz: "Não há como emular… fazer N `drawGPUMesh` exigiria trazer as partículas de volta pra CPU". É a prova de que já se tentou (e se abandonou) desenhar partículas por readback — este desenho evita o mesmo erro fazendo a CPU (TS) simular e só enviar o buffer de instância já pronto.
- No runtime (`rts`), `crates/rts-egui/src/frame/scene3d/pipeline.rs` tem só o pipeline de malha (`vs`/`fs`, instância de 96 bytes: mat4 + cor, `ALPHA_BLENDING`, `depth_write_enabled: true`), o de céu (sem blend, sem depth write) e o de sombra (depth-only). Há também um **pipeline de água órfão** (`water_pipeline`, `vs_water`, instância de 16 bytes — um `vec4` vindo direto de um storage buffer da física `rts:gpu`) que hoje não é mais alimentado por nenhuma superfície TS. Ele é a referência mais próxima de "muitas instâncias pequenas, blend ligado, sem geometria por instância vinda da CPU": ele lê de um buffer de física; o novo `drawParticles` lê de um `Float32Array` que o TS escreve.
- `crates/rts-ui/src/scene.rs` registra os nativos de cena numa tabela `(nome, função)` — `("drawMesh", draw_mesh), ("drawMeshBatch", draw_mesh_batch), …` — lida por `namespace()` em `rts-ui/src/lib.rs` para montar `rts:egui`. É o ponto de registro de qualquer nativo novo.
- Não há blend aditivo em nenhum pipeline, não há billboard (rotação da partícula sempre de frente para a câmera) e não há disco suave por textura procedural no fragment shader.

**Limites:**
1. **Nenhum desenho em massa não-malha.** Para 10 000 partículas, o único caminho hoje seria 10 000 `drawMesh`, cada um pagando a travessia inteira (o mesmo custo que motivou `drawMeshBatch`).
2. **Sem billboard nem blend aditivo.** O shader de malha (`vs`/`fs`) espera normal e projeta pelo `model` da instância; não gira para a câmera, e o único blend é alfa comum.
3. **Sem componente de simulação.** Não há pool de partículas, curvas sobre o tempo de vida, nem emissor com forma.
4. **Sem gizmo de forma de emissão** (esfera/cone/caixa) e sem prévia no editor sem apertar Play — o padrão de prévia mais próximo é o do áudio (§4 do desenho de áudio: botões Tocar/Parar, prévia fora do Play), mas para áudio a prévia é uma voz; aqui precisa de um acumulador de tempo dentro do próprio componente, avançado pelo laço do editor.

## 3. Motor (mínimo): `drawParticles`

O motor ganha exatamente o que um script não consegue fazer: **um draw instanciado com billboard e blend aditivo opcional na GPU**. Simular (posição, vida, cor, tamanho), decidir a forma do emissor e escrever o buffer de instância são política, e ficam em TS — o mesmo corte que o desenho de áudio faz entre "dispositivo + kernel de mixagem" (motor) e "vozes, grupos, espacialização" (TS).

### 3.1 Runtime (repo `rts`, crate `rts-egui`, PR à parte)

- **Nova primitiva `drawParticles(win, buf: Float32Array, n, modo)`** — 4 parâmetros, dentro do limite do RTS:
  - `buf`: **9 f32 por partícula** — posição (x, y, z), tamanho, rotação em radianos (em torno do eixo da câmera), cor RGBA (4 floats de 0 a 1, não `Uint32`: a cor sobre o tempo de vida interpola continuamente, e um `0xAARRGGBB` por partícula reintroduziria o problema de bits que `drawBatch` evita SÓ porque a cor ali não muda quadro a quadro — aqui muda sempre. É um kernel de DSP visual e não sabe de gradiente nem curva).
  - `n`: partículas a desenhar (pode ser menor que `buf.length/9` quando o TS pré-corta por frustum/pool).
  - `modo`: 0 = alfa comum, 1 = aditivo.
  - Vertex shader: expande cada instância num quad de 2 triângulos usando `cam_right`/`cam_up` (já existem no uniform `Cam` do pipeline de malha) girado por `rotation`, escalado por `size` — o mesmo padrão de billboard que qualquer engine de partícula usa, sem geometria de instância nenhuma vinda da CPU (a malha do quad é fixa, 4 vértices, subida uma vez).
  - Fragment shader: sem textura, um disco suave por `smoothstep` na distância ao centro do quad (o "round soft" default da Unity); com textura, amostra `albedo_tex` como o pipeline de malha já faz.
  - **Depth TEST ligado, depth WRITE desligado** nos dois modos — partículas não escondem umas às outras de forma binária (ficam translúcidas), mas continuam atrás de um muro. É o mesmo `depth_write_enabled: false` que o `sky_pipeline` já usa, só que com depth TEST também ligado (o céu não testa, porque é sempre o fundo).
  - Blend: `modo=0` usa `wgpu::BlendState::ALPHA_BLENDING` (igual ao pipeline de malha); `modo=1` usa um blend aditivo (`src×1 + dst×1`, sem multiplicar pelo alpha do destino).
- **Textura opcional**: `setParticleTexture(win, texId)` — um setter, no molde de `pincel`/`estiloTexto` do desenho 2D do editor (CLAUDE.md, "Custo por quadro"), porque `drawParticles` já usa os 4 parâmetros no limite; a textura vale para as chamadas seguintes até o próximo `setParticleTexture(win, 0)` (sem textura = disco procedural). Alternativa equivalente: `drawParticlesTex(win, buf, n, modo)` lendo uma textura fixada por outro caminho — a Task 1 decide qual das duas com base no que o registro de nativos aceita mais perto do padrão de `drawMesh`.
- **Ordem no `flush` da `Scene3D`**: depois das malhas opacas e da sombra, antes ou junto do céu (o céu não escreve depth; partículas testam depth, então precisam vir depois de qualquer coisa que precise aparecer atrás delas e antes do céu se a intenção for partícula na frente do céu — na prática, desenhadas depois das malhas e antes/junto do céu não muda o resultado visual porque o céu está sempre no infinito). Ordenação partícula-a-partícula (back-to-front) é OPCIONAL e feita pelo TS antes de escrever `buf`, ordenando os índices por distância à câmera — o nativo desenha na ordem que recebe.
- **Onde registrar**: a mesma tabela de `crates/rts-ui/src/scene.rs` que hoje tem `("drawMesh", draw_mesh), ("drawMeshBatch", draw_mesh_batch)`. `drawParticles`/`setParticleTexture` entram ao lado, com uma função `scene_api::draw_particles(win, floats, n, modo)` no molde de `scene_api::draw_mesh_batch`. Registrada nos dois hosts que já expõem `rts:egui` (JIT, via `namespace()` de `rts-ui/src/lib.rs`, e o AOT/`ui_fixture`), do mesmo jeito que `drawMeshBatch` já está nos dois.
- **Testes em Rust**: layout do buffer (9 floats por partícula, leitura correta de posição/tamanho/rotação/cor), criação do pipeline sem janela real (se o crate já tiver um padrão headless — `rts-physics` ou os testes de `scene3d/tests.rs` são o molde a seguir), e um teste de superfície (`rts-host/tests/ui_surface.rs`, no molde do teste que já existe para `drawMeshBatch`) chamando `drawParticles` e conferindo que não retorna erro com `n=0`, `n>capacidade do buf` (recusa, não lê fora) e `modo` inválido (trata como alfa).
- CI compila com warnings-as-errors em Linux/macOS/Windows (como o resto do workspace `rts`). Nunca `cargo fmt`. PR para `main`; o controlador do repo `rts` faz o merge.

### 3.2 Fallback sem a primitiva nova

Um binário `rts.exe`/`ui_fixture` antigo, sem `drawParticles`, não deve travar o editor. `src/compat/` (o mesmo padrão de `compat/audio.ts` para o áudio antes do `cpal`) expõe `temDrawParticles(): boolean`, calculada uma vez (não por quadro): se ausente, o `ParticleSystem` **continua simulando** (a simulação não depende do desenho) mas não chama o nativo, e um aviso único vai para o Console (`logWarn`, uma vez por sessão, não por objeto nem por quadro). Testes sem janela rodam assim mesmo — a simulação é pura TS e não depende do nativo.

## 4. `rts-game`: núcleo em `src/engine/particles/` + componente em `src/scripts/particlesystem.ts`

Segue o molde de `src/engine/audio/` (mixer/DSP puros, sem cena) + `src/scripts/audiosource.ts` (o componente, que importa a cena/behavior).

### 4.1 Estado da simulação (`src/engine/particles/sim.ts`)

- **Pool por sistema** num único `Float64Array` (SoA: um bloco por campo, não por partícula, para o laço "somar velocidade a todas as posições" varrer memória contígua), `PART_FLOATS` colunas × `maxParticles` linhas: posição (x,y,z), velocidade (x,y,z), idade, vida total, tamanho inicial, cor inicial (4), rotação. Layout com constantes nomeadas (`P_X=0, P_Y=1, P_Z=2, P_VX=3, …`), no molde de `mix::D_POS`/`D_PASSO`/… do desenho de áudio.
- **Zero alocação por quadro**: o pool nasce do tamanho de `maxParticles` na primeira `play()`/`onValidate`, e só realoca se `maxParticles` mudar no Inspector. `emitirN(n)` e `atualizar(dt)` recebem o pool por parâmetro (≤ 4 parâmetros), como `mixInto(buf, frames, vozes)` faz para áudio.
- **RNG**: `aleatorio()`/`aleatorioEntre(a, b)` de `src/engine/core/aleatorio.ts` — a mesma semente reaplicada a cada Play (`reaplicarSementeFixada`, já chamado pelo `PlayMode`), então uma emissão é reproduzível entre duas sessões de Play com a mesma semente, sem que o `ParticleSystem` precise saber disso.
- **Frustum**: `frustumBegin`/`inFrustumFast` de `src/engine/render/gpu3d.ts`, aplicado nos LIMITES do emissor (um raio, não por partícula): se a caixa/esfera que envolve o pool inteiro está fora do frustum, `drawSelf` não escreve nada no buffer de instância naquele quadro (a simulação continua, só o desenho é cortado).
- **Saída para o nativo**: um `Float32Array` reaproveitado por sistema (cresce por dobra, nunca encolhe — o padrão de `bufT`/`bufC` em `scenedraw.ts`), preenchido por `atualizar(dt)` só para as partículas vivas, na ordem (ou pré-ordenadas por distância se `sort=distancia`).

### 4.2 Emissão, forma e curvas (`src/engine/particles/desc.ts` + campos do componente)

- **Emission**: `rateOverTime` (partículas por segundo, acumulador fracionário para não perder resto entre quadros) + até 4 `bursts` num `Float64Array` fixo (tempo, quantidade) — igual em espírito aos "4 grupos" fixos do mixer de áudio (`MAX_GRUPOS`), evitando array dinâmico num caminho por quadro.
- **Shape**: `forma` (0 ponto, 1 esfera, 2 cone, 3 caixa) + `raio`, `angulo` (cone), `tamanho` (caixa, 3 componentes). Cada forma sorteia posição e (para esfera/cone) direção inicial da velocidade com `aleatorioEntre`; ponto e caixa saem em direção aleatória na esfera unitária, escalada por `startSpeed`.
- **Over lifetime**: gradiente de cor com 2–4 chaves (tempo 0–1, RGBA) e curva de tamanho com 2–4 chaves (tempo 0–1, escala), ambos interpolados linearmente entre as chaves vizinhas — sem editor de curva (Bézier fica fora, §9). Velocidade sobre o tempo de vida: um vetor constante (vento) somado por quadro, mais um `drag` (arrasto exponencial simples, `v *= (1 - drag*dt)`).
- **Renderer**: `modo` (0 alfa, 1 aditivo), `textura` (caminho, cache pelo carregador de textura existente de Material — `resolveMaterialTexture`/o cache de `textureUpload`), `sort` (0 nenhum, 1 por distância).

### 4.3 API do componente (`ParticleSystem extends Behavior`, `src/scripts/particlesystem.ts`)

- `play()`, `stop(clear: boolean)` (na Unity é `Stop(withChildren, stopBehavior)`; aqui, sem sub-emissores, um booleano "limpar as partículas vivas agora" já cobre `StopEmittingAndClear`), `pause()`, `emit(n)`, `clear()`, `isPlaying(): boolean`, e os campos somente-leitura `particleCount`, `time`.
- Campos públicos automáticos (Inspector gerado): todo o Main/Emission/Shape descrito em §4.2, mais `duration`, `loop`, `startLifetime`min/max, `startSpeed`min/max, `startSize`min/max, `startRotation`, `startColor`, `gravityModifier`, `maxParticles`, `simulationSpace` ("local"|"world"), `playOnAwake`, `prewarm` (opcional: roda `duration` segundos de simulação silenciosa no `mount()` antes do primeiro desenho, para nascer "em regime", como a fogueira já ardendo).
- Gradiente e curva (arrays de chaves) **não** são campo automático simples (`number/boolean/string`): usam Inspector customizado via `onInspectorGUI`, no molde do `MixerInspector` do pacote de áudio (que desenha sliders por grupo lendo um array). `componentToData`/serialização carregam esses arrays como dado próprio do componente (o mesmo caminho que salva os campos automáticos, mais os arrays — ver §4.4 sobre o formato salvo).

### 4.4 Integração com `Scene`/`GameObject`: sem `KIND` novo

Diferente do áudio (que precisou de `KIND_AUDIO` porque um objeto pode ser ouvinte OU fonte, e a cena varre só os que têm papel de áudio), `ParticleSystem` se desenha e simula como o `Skeleton` já faz hoje: `kind() → KIND_RENDERER`, `drawsSelf() → 1`, `drawSelf(win, pos, tint)` escreve o `Float32Array` do sistema e chama o nativo. Isso significa:
- **Nenhuma lista nova em `Scene`** (nada como `audioObjs`): o laço de render já encontra quem tem `drawsSelf()===1` via `GameObject.rendIdx` (mesmo caminho do `Skeleton`, `scenedraw.ts:189-192`).
- **A simulação roda em `update(dt)`**, o hook por-frame comum a todo `Behavior` — não precisa de um sistema separado no editor/jogo/Play como o áudio precisou (`audioQuadro` chamado à mão em `main.ts`/`game.ts`), porque `update(dt)` já é chamado para todo comportamento habilitado.
- **Ciclo do Play**: como qualquer `Behavior`, o `ParticleSystem` é copiado por `componentToData`/`recreateBehavior` ao entrar no Play; `playOnAwake` toca no `mount()` da cópia (mesmo padrão decidido para áudio — não há `start`/`onEnable` no `Behavior`). Ao parar o Play, o original volta sem o estado de simulação da cópia (comportamento padrão do `PlayMode`, sem código extra).
- **Serialização**: campos automáticos + os arrays de gradiente/curva/bursts via `componentToData`, com um formato de dado próprio do componente do jeito que `AudioSource` guarda o formato antigo (`kind/freq/dur/gain/every`) ao lado dos campos novos — aqui não há formato antigo a migrar, mas o array de chaves precisa do mesmo tipo de extensão que `fieldGet/fieldSet` cobre para inspetores customizados.

### 4.5 Custo por quadro e GC

- Caminhos por quadro (`update(dt)`, `emitirN`, `atualizar`, preenchimento do `Float32Array` de saída): ≤ 4 parâmetros, `Float64Array`/`Float32Array` reaproveitados, sem `try/catch`, sem string nova (rótulos do Inspector refeitos só quando o valor muda, como `CampoCache`/`rotulos.ts` já fazem para outros componentes).
- **Meta**: 10 000 partículas vivas em ≤ 1 ms de CPU por quadro (simulação + preenchimento do buffer; não inclui o tempo de GPU do draw, que é responsabilidade do nativo). Bench comparável ao de áudio (`bench/claude-bench-audio.ts`): `bench/claude-bench-particulas.ts`.
- **GC**: 0 coletas em 200 000 iterações do laço `update`+preenchimento, com `RTS_GC_DEBUG=1` (padrão de `tests/claude-test-audio-gc.ts` → `tests/claude-test-particulas-gc.ts`).

## 5. Editor: pacote `assets/pacotes/particulas/`

Tudo com `@editorOnly`, só `@editor/api`, no molde de `assets/pacotes/audio/audio_editor.ts`.

- **Gizmo (`registerGizmo("ParticleSystem", …)`)**: ícone do emissor (novo em `assets/editor/icons/source.json`); quando selecionado, desenha a FORMA do emissor com `Gizmos.wireSphere`/`wireCone` (já existem em `src/engine/core/gizmos.ts`) e um `wireBox` novo (a caixa ainda não tem desenhador — mesma assinatura de 4 parâmetros que `coneArame`/`circulo`: centro, tamanho por eixo, cor corrente).
- **Menu `Criar/Efeitos/Partículas`**: cria um objeto com `ParticleSystem` via `scene.createGameObject`, na posição de `Editor.spawnPoint` — igual ao `Criar/Áudio/Fonte`.
- **Presets `Fogo`, `Fumaça`, `Faíscas`, `Chuva`**: em `src/editor/object_presets.ts` (regra do CLAUDE.md: "Mantenha os presets do menu Criar em `src/editor/object_presets.ts`. O menu global, o menu de contexto e a criação devem ler os mesmos registros"). Isso pede uma pequena extensão da tabela hoje só de malha (`meshKind`/cor): um preset ganha um campo opcional que descreve o componente a anexar e os valores iniciais a aplicar, e a função de criação (`createMenuObject`/o menu global) passa a checar esse campo antes de cair no caminho de malha — sem duplicar rótulos entre o menu global, o de contexto e a criação, que é exatamente a regra que o CLAUDE.md pede.
- **Inspector (`onInspectorGUI`) do `ParticleSystem`**: os campos automáticos, os arrays de gradiente/curva com um editor simples de linhas (tempo, valor — sem arrastar tangente), e os botões **Reiniciar** e **Pausar/Continuar**: eles chamam `play()`/`pause()` na instância da CENA (não numa cópia), então funcionam como PRÉVIA no modo de edição, do mesmo espírito que os botões Tocar/Parar do áudio, mas aqui a diferença é de PERSISTÊNCIA e não de rota alternativa — precisa de uma marca explícita "isto é prévia de edição" para nunca gravar o estado do pool simulado no arquivo da cena (o `componentToData` de fora do Play grava só os campos de configuração, nunca `time`/`particleCount`/o pool).
- **Prévia fora do Play**: como `ParticleSystem.update(dt)` já roda todo quadro para qualquer objeto habilitado (§4.4), a prévia "de graça" já aconteceria mesmo sem seleção — o que a Unity NÃO faz (só simula em edição quando selecionado, para não gastar CPU com uma cena inteira de efeitos fora de foco). Este desenho reproduz o comportamento da Unity com uma bandeira: fora do Play, `update(dt)` só avança a simulação se o objeto está selecionado (o pacote de editor marca isso via `Editor.selecionado(id)`, o mesmo tipo de consulta que os gizmos já fazem); dentro do Play/jogo, sempre avança. Ao desselecionar, a simulação para onde estava (não limpa, para o usuário reabrir a seleção e continuar vendo o efeito), e o botão Reiniciar chama `clear()+play()`.
- Medidas, cores e rótulos do pacote ficam em constantes nomeadas no topo do arquivo do pacote, como `audio_editor.ts` já faz (`COR_GIZMO_MIN`, `ICONE_FONTE`, …).

## 6. Agente (motor híbrido) — comando WebSocket `particulas`

Por `registerCommand`, no pacote, no molde do comando `audio` (spec de áudio §5):
- `particulas <obj> play`
- `particulas <obj> stop`
- `particulas <obj> emit <n>`
- `particulas <obj> clear`
- `particulas <obj> info` → responde `vivas=<n> max=<m> tocando=<0|1> t=<s> bbox=(minx,miny,minz)-(maxx,maxy,maxz)` — o bbox é o menor retângulo que envolve as partículas vivas NAQUELE quadro (calculado ao preencher o buffer de saída, sem passada extra), e é como a IA confere visualmente sem olhar a tela: um emissor de chuva deve ter `bbox` alto e estreito; uma explosão de faíscas, uma esfera crescendo com o tempo.

**Verificar sem olhar a janela**: como o `audio list`/`audio nivel` fazem por número para o som, `particulas <obj> info` faz por número para o efeito. Um teste headless roda N quadros com `update(dt)` fixo e confere `vivas` crescendo até `maxParticles` (ou até `rateOverTime × duration` num sistema sem loop), `t` avançando, e o `bbox` compatível com a forma do emissor (esfera: bbox ~ cúbico no raio; cone apontando para +Y: bbox alto).

## 7. Testes

**Sem janela, por número** (`tests/test_particulas_*.ts`, saída `[PASSOU]`, dispositivo/desenho nulo — `temDrawParticles()===false` não impede o teste porque a simulação não depende do nativo):
- **Emissão**: `rateOverTime` acumula corretamente entre quadros de dt irregular (sem perder nem duplicar fração); bursts disparam exatamente na janela de tempo certa; `maxParticles` nunca é excedido (emissão nova é descartada, sem sobrescrever partícula viva).
- **Forma**: esfera/cone/caixa/ponto — amostragem de 10 000 sementes cai dentro do volume esperado (raio, ângulo do cone, dimensões da caixa) com a MESMA semente reproduzindo a MESMA amostra.
- **Vida**: uma partícula morre exatamente quando `idade >= vidaTotal`; o slot é reciclado pela próxima emissão sem "buraco" no pool (compactação ou lista de livres).
- **Over lifetime**: cor e tamanho interpolam linearmente entre as chaves do gradiente/curva no tempo 0, 0.5 (entre chaves) e 1; velocidade constante + arrasto reduz a velocidade geometricamente.
- **Play/Stop/Pause/Emit/Clear**: `stop(false)` para de emitir mas deixa as vivas terminarem a vida; `stop(true)` zera na hora; `pause()` congela `time` e todas as partículas; `emit(n)` soma `n` partículas mesmo com `playOnAwake=false` e sem `play()`.
- **Ciclo do Play**: `playOnAwake` só emite dentro do Play/jogo; a prévia do editor (selecionado, fora do Play) simula mas não é salva (o snapshot de `componentToData` fora do Play não tem partículas vivas gravadas).
- **RNG determinístico**: duas simulações com a mesma semente fixada produzem a mesma sequência de posições.
- **Frustum**: um emissor totalmente fora do frustum não escreve no buffer de saída (mas continua envelhecendo as partículas).
- **Fallback**: sem `drawParticles` no nativo, a simulação roda igual e o aviso do Console aparece uma vez.

**GC**: `tests/claude-test-particulas-gc.ts`, 200 000 iterações de `update`+preenchimento do buffer com 10 000 partículas vivas, 0 coletas entre marcadores (`RTS_GC_DEBUG=1`).

**Bench**: `bench/claude-bench-particulas.ts`, com 1k/5k/10k partículas, medindo o tempo de `update`+preenchimento (não o desenho). Portão: 10 000 ≤ 1 ms.

**Frame do editor**: `node bench/claude-frame-bench.mjs` antes/depois de abrir uma cena com os 4 presets ativos, na mesma sessão (RTS_VSYNC=0).

**Regressão**: `npm run check:params`, `npm run components`/`test:components`/`components:check`, `tests/editor-static.test.mjs` (o comando `particulas` entra no manifesto de comandos embutidos, como `audio`/`snd` já estão).

**Com janela (manual)**: os 4 presets, prévia no Inspector, seleção/desseleção parando a prévia, e uma cena com 10 000 partículas girando a câmera.

## 8. Fora deste desenho

- Colisão de partículas com a física (raycast por partícula ou GPU compute).
- Sub-emissores (nascer/morte/colisão disparando outro `ParticleSystem`).
- Trilhas (`Trail Renderer`).
- Editor de curva completo (tangentes Bézier, arrastar pontos no gráfico) — as chaves ficam numa lista simples de (tempo, valor).
- Simulação em GPU compute (o pool inteiro roda em TS/CPU nesta fase; a GPU só recebe o buffer final para desenhar).
- Ordenação global entre vários `ParticleSystem` na mesma cena (cada sistema ordena as PRÓPRIAS partículas, se `sort=distancia`).

## 9. Ordem de entrega

1. **rts**: `drawParticles`/`setParticleTexture` no `crates/rts-egui` (pipeline, shader, registro em `rts-ui/src/scene.rs`), com testes Rust e de superfície.
2. **rts-game, núcleo**: `src/engine/particles/sim.ts` + `desc.ts` (pool, emissão, forma, curvas), com os testes do §7 que não dependem de componente nem de desenho.
3. **Componente**: `src/scripts/particlesystem.ts` (`ParticleSystem extends Behavior`, `KIND_RENDERER`/`drawsSelf`), Inspector customizado, ciclo do Play.
4. **Pacote `particulas/`**: gizmos de forma, ícone, menu + presets em `object_presets.ts`, prévia de edição (selecionado), comando WS `particulas`.
5. **Docs**: `docs/components.md` (seção "Partículas") e `CLAUDE.md` (seção "Partículas", no molde da seção "Áudio").
6. **Fora desta entrega**: colisão, sub-emissores, trilhas, editor de curva completo, simulação em GPU compute (§8).

## 10. Decisão do usuário (2026-09-27)

Aprovado como descrito acima, com os pontos que o usuário fixou na aprovação:
- Buffer de instância: posição xyz, tamanho, rotação (radianos, eixo da câmera), cor RGBA, um draw instanciado só.
- Modos alfa (0) e aditivo (1), os dois com depth TEST ligado e depth WRITE desligado.
- Textura opcional via `drawParticlesTex`/`setParticleTexture` (≤ 4 parâmetros); default = disco suave procedural no fragment shader.
- Desenhado depois das malhas opacas no `flush` da `Scene3D`; ordenação back-to-front é opcional e feita pelo TS.
- Registrado em `rts:egui` para os hosts JIT e AOT, no mesmo lugar que `drawMeshBatch`.
- Testes Rust (layout do buffer, criação de pipeline headless se o padrão existir) + teste de superfície; CI com warnings-as-errors em Linux/macOS/Windows; nunca `cargo fmt`; PR para `main`, merge pelo controlador do repo `rts`.
- Componente `ParticleSystem` no molde Unity completo descrito em §4, com pool em SoA, RNG determinístico do motor, sem alocação por quadro, integração de cena e ciclo do Play espelhando o de `AudioSource`.
- Editor: gizmo da forma, ícone, menu `Criar/Efeitos/Partículas` com presets Fogo/Fumaça/Faíscas/Chuva em `object_presets.ts`, prévia de edição estilo Unity (sem Play, com Reiniciar/Pausar, parando ao desselecionar, nunca gravando o estado simulado).
- Agente: comando WS `particulas <obj> play|stop|emit <n>|clear|info`, sonda de GC e teste headless de N quadros conferindo contagem e bbox.
- Portão de performance: 10 000 partículas vivas ≤ 1 ms de CPU por quadro; 0 coletas de GC em 200 000 iterações; medição de frame do editor antes/depois.
- Fora de escopo nesta v1: colisão física, sub-emissores, trilhas, editor de curva completo, simulação em GPU compute.
