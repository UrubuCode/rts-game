# Partículas no modelo da Unity — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um `ParticleSystem` no modelo da Unity no rts-game: draw instanciado com billboard e blend aditivo opcional no runtime (`rts`), simulação de partículas (pool SoA, emissão por taxa/burst, forma esfera/cone/caixa/ponto, cor e tamanho sobre o tempo de vida, velocidade constante + arrasto) em TypeScript sem alocação por quadro, o componente `ParticleSystem` integrado à cena e ao ciclo do Play como qualquer `Behavior` (sem `KIND` novo), o pacote de editor `assets/pacotes/particulas/` (gizmos de forma, presets Fogo/Fumaça/Faíscas/Chuva, prévia de edição ao selecionar), o comando WebSocket `particulas` e os testes/bench/docs de acompanhamento.

**Architecture:** O runtime `rts` ganha só o que um script não faz: uma primitiva `drawParticles(win, buf, n, modo)` em `crates/rts-egui` que expande N instâncias num quad billboard na GPU, com depth test ligado e depth write desligado, blend alfa ou aditivo, textura opcional (default: disco procedural no fragment shader). Tudo que é política — o pool de partículas, a emissão, a forma do emissor, as curvas sobre o tempo de vida, o componente, o Inspector, os gizmos, os presets e o comando WS — fica no rts-game, em TypeScript, no mesmo corte que o desenho de áudio fez entre "dispositivo + kernel" (motor) e "vozes, grupos, espacialização" (TS). O componente não precisa de `KIND` nem de cache novo em `Scene`: ele se desenha como o `Skeleton` já faz (`KIND_RENDERER` + `drawsSelf()`), e simula em `update(dt)`, o hook por-frame que todo `Behavior` já tem.

**Tech Stack:** Rust (crate `rts-egui`, workspace `rts`: `wgpu` já presente, nenhuma dependência nova), TypeScript compilado pelo RTS (`rts.exe`), Node 22 (`tools/generate-components.mjs`, scripts do repo).

**Spec:** docs/superpowers/specs/2026-09-27-particulas-design.md

## Global Constraints

- Motor ganha só o que um script não faz; o resto vira pacote em `assets/pacotes/particulas/` (`@editorOnly`) — spec §1/§3. Se o pacote precisar de algo do motor, o motor ganha o ponto de extensão, não o recurso.
- RTS: funções/métodos com 5+ parâmetros escalares ALOCAM por chamada (mesmo com valor default): caminhos por frame (`update`, `emitirN`, `atualizar`, `drawSelf`, preenchimento do buffer de instância) ≤ 4 parâmetros; vetores em `Float64Array`/`Float32Array` do chamador; `try/catch` fora de funções por frame; sem string nova por frame (rótulos refeitos só quando o valor muda); `npm run check:params` limpo (sem exceção nova).
- Zero alocação por quadro no caminho de simulação e no caminho de desenho: pools, buffers de saída (`Float32Array` do `drawSelf`) e escalares de trabalho nascem em `play()`/na primeira validação e só crescem por dobra (nunca encolhem), no molde de `bufT`/`bufC` em `src/engine/render/scenedraw.ts`.
- Sondas de GC com 200 000 iterações (`RTS_GC_DEBUG=1`, contar `rts-gc` entre marcadores), bench antes/depois na mesma sessão.
- Aliases nos imports (`@engine/...`, `@editor/...`, `@compat/...`); sem ciclos de import (`import type` para tipos); construtores sem argumentos; catálogo gerado (`npm run components` + `npm run test:components` + `npm run components:check`, saída versionada); `componentToData`/`recreateBehavior` para salvar/duplicar/Rodar; CLAUDE.md "Custo por quadro" e "Criação de objetos".
- Objetos novos do editor (menu Criar, presets) usam `scene.createGameObject(...)`; nunca `scene.add(...)` para algo recém-criado pelo editor (`scene.add` é só para desserialização/clone). Presets do menu Criar ficam em `src/editor/object_presets.ts`, lidos pelo menu global, pelo menu de contexto e pela criação — nenhuma cópia de rótulo/cor/tipo por menu.
- Medidas de layout, limites e rótulos do editor centralizados: os do editor central em `src/editor/ui_config.ts`; os do pacote `particulas/` em constantes nomeadas no topo do próprio arquivo do pacote, como `assets/pacotes/audio/audio_editor.ts` já faz (`COR_GIZMO_MIN`, `ICONE_FONTE`).
- Toda funcionalidade nova é alcançável pelo WebSocket: o comando `particulas` é registrado pelo pacote (`registerCommand`); consultas (`info`) com `muta = false`.
- rts: **worktree PRÓPRIA e SEPARADA** da que outro agente já usa. NUNCA usar `C:\Users\nexga\Documents\GitHub\rts-uv-mundo` diretamente nesta entrega (há outro agente trabalhando lá, branch `feat/soltar-arquivos`). Criar `C:\Users\nexga\Documents\GitHub\rts-particulas`:
  ```
  git -C C:\Users\nexga\Documents\GitHub\rts-uv-mundo worktree add ..\rts-particulas -b feat/particulas-nativo origin/main
  ```
  Todo comando Rust deste plano roda em `C:\Users\nexga\Documents\GitHub\rts-particulas`, não na worktree do outro agente. NUNCA rodar `cargo fmt`. Antes de editar `crates/rts-egui`, ler o `README.md` do crate por inteiro (RULE 0 do `CLAUDE.md` do rts). Builds: `cargo build --release --bin rts`, `cargo build --release -p rts-host --example ui_fixture --features ui`.
- rts-game: worktree `C:\Users\nexga\Documents\GitHub\rts-game\build\particulas`, branch `feat/particulas` (a partir de `origin/master` `3b96b1b`). Testes TS sem janela, da raiz do worktree: `$RTS run tests/<arquivo>.ts`, onde `$RTS` é o binário do rts recompilado na Task 1 (ou o `rts.exe` existente enquanto as tasks nativas não terminam — só o que é matemática pura roda antes disso, como no plano de áudio). Editor real: `examples/ui_fixture.exe main.ts` (WS `ws://127.0.0.1:7777`).
- Mensagens de commit terminam com as linhas de atribuição da sessão (`Co-Authored-By` e `Claude-Session`).

## Review Focus

1. **Buffer de instância e billboard nas bordas**: `n=0`, `n` maior que `buf.length/9` (recusa, não lê fora do array), `modo` fora de {0,1} (trata como alfa), rotação de partícula em ±π sem "engasgar" o eixo do billboard, cor com alpha 0 (não desenha nada visível, mas não é erro). Testes na Task 1 (`part_buf_*`) e na Task 8 (paridade do layout entre o que o TS escreve e o que o Rust lê, via teste de superfície).
2. **Depth test/write e blend**: partícula atrás de uma malha opaca não aparece (depth TEST); duas partículas não se escondem uma da outra de forma binária (depth WRITE desligado); modo aditivo não escurece nunca (soma, não multiplica); modo alfa com textura transparente respeita o alpha da textura. Teste na Task 1 (pipeline) e verificação manual na Task 12.
3. **Emissão sem perder nem duplicar**: `rateOverTime` com dt irregular não acumula erro ao longo de 10 000 quadros; burst dispara exatamente uma vez por janela de tempo; `maxParticles` nunca é excedido; reciclagem de slot morto não deixa "buraco" que a próxima emissão ignore. Testes na Task 3 (`test_particulas_emissao.ts`).
4. **Ciclo do Play e prévia de edição**: `playOnAwake` só emite dentro do Play/jogo; a prévia (selecionado, fora do Play) simula mas nunca é salva pelo `componentToData` fora do Play; desselecionar para a simulação sem limpar o pool; entrar no Play com o objeto selecionado usa a cópia do Play, não a prévia. Testes na Task 4 (`test_particulas_source.ts`) e na Task 9 (pacote de editor).
5. **RNG determinístico e frustum**: duas simulações com a mesma semente fixada (`fixarSementeAleatorio`) produzem a MESMA sequência de posições/velocidades; um emissor fora do frustum não escreve no buffer de saída mas continua envelhecendo partículas (retomam a posição certa quando voltam ao campo de visão). Testes na Task 2 (`test_particulas_forma.ts`) e na Task 3.

## Decisões deste plano (o que o spec deixou aberto ou foi ajustado)

- **`drawParticlesTex` como função separada, não `setParticleTexture`.** A tabela de registro de `crates/rts-ui/src/scene.rs` já associa nome→função 1:1 (`("drawMesh", draw_mesh)`); um setter de estado mutável entre chamadas (`setParticleTexture`) exigiria um campo de módulo ou por-`win` extra e reabriria a discussão de "estado implícito entre duas chamadas" que o desenho de áudio evitou ao passar tudo por parâmetro. `drawParticlesTex(win, buf, n, modo, tex)` teria 5 parâmetros e alocaria no RTS — então a superfície fica em DUAS funções sem estado oculto: `drawParticles(win, buf, n, modo)` (sem textura, disco procedural) e `drawParticlesTex(win, spec, n, modo)` onde `spec` é um objeto host `{ buf: Float32Array, tex: number }` — o mesmo padrão de `drawMeshBatch(win, spec)` com `spec = { transforms, codes }`. Isso mantém os dois caminhos em ≤ 4 parâmetros sem estado entre quadros.
- **Layout do buffer: 9 f32 por partícula**, `[x, y, z, tamanho, rotacao, r, g, b, a]`. Nomeado em Rust e em TS com as mesmas constantes (`PART_X=0, PART_Y=1, PART_Z=2, PART_TAM=3, PART_ROT=4, PART_R=5, PART_G=6, PART_B=7, PART_A=8, PART_INSTANCIA_FLOATS=9`), no molde de `mix::D_POS`/`D_PASSO` do desenho de áudio.
- **Pipeline novo, não reaproveitar o de malha nem o de água órfão.** O de malha espera normal+UV e instância de 96 bytes (mat4+cor) — inadequado para billboard. O de água (`vs_water`, instância de 16 bytes, um `vec4` de um storage buffer de física) está mais perto em ESPÍRITO (muitas instâncias pequenas) mas lê de um buffer GPU-a-GPU que não existe para partículas simuladas em TS; adaptá-lo herdaria a dependência de `rts:gpu`/compute que este desenho não precisa. Um pipeline `particle_pipeline` novo, com vertex shader próprio (`vs_particle`) que expande 1 vértice de um quad UNIT (4 vértices, subido uma vez, sem buffer de vértice por instância) usando `cam_right`/`cam_up`/`rotation`/`tamanho` da instância — instância de 9×4=36 bytes.
- **Blend aditivo**: `wgpu::BlendState` com `color: BlendComponent { src_factor: One, dst_factor: One, operation: Add }` e o mesmo para alpha — não existe hoje em nenhum pipeline do crate, então a Task 1 acrescenta essa constante ao lado de `ALPHA_BLENDING`.
- **`temDrawParticles()` calculado uma vez, em `src/compat/particles.ts`**, no molde de como `compat/audio.ts` decide a presença dos membros de `rts:audio`: tenta chamar `drawParticles` com `n=0` num buffer vazio dentro de um `try/catch` de CARREGAMENTO (não de quadro) e memoriza o resultado. Todo `try/catch` fica fora do caminho por quadro (regra do RTS).
- **Sem `KIND_PARTICLE`.** Como o spec decide (§4.4): `ParticleSystem.kind() → KIND_RENDERER`, `drawsSelf() → 1`. Isso evita uma lista nova em `Scene` (como `audioObjs`) e reaproveita o dispatch que `Skeleton` já usa (`GameObject.rendIdx`, `scenedraw.ts:189-192`). A trilha, se um dia entrar (fora de escopo), teria a mesma decisão.
- **Prévia de edição via bandeira de seleção, não via sistema por-quadro novo.** Diferente do áudio (que precisou de `audioQuadro` chamado explicitamente pelo editor/jogo porque o ouvinte/fonte não tem hook por-frame próprio), `update(dt)` do `ParticleSystem` já roda todo quadro para qualquer `Behavior` habilitado. Para não simular uma cena inteira de efeitos fora de Play (o que a Unity evita), o pacote de editor marca via `Editor.selecionado(id)` uma bandeira que `update(dt)` consulta FORA do Play; dentro do Play/jogo, a bandeira não é consultada (sempre simula). A consulta de seleção é ≤ 4 parâmetros e não aloca.
- **Reciclagem de slot morto por lista de livres, não compactação.** Compactar o pool a cada morte custaria O(n) por morte; uma lista de índices livres (um `Int32Array` usado como pilha, topo em `nLivres`) dá O(1) para reciclar e O(1) para emitir, ao custo de o pool não ficar "compacto" (o laço de atualização varre `maxParticles` linhas e pula as mortas por uma flag de vida — mesmo custo que varrer um pool compacto, porque o Float64Array inteiro já está na cache de qualquer forma).
- **Bounding box do WS `info` calculado durante o preenchimento do buffer de saída**, não numa passada extra: `atualizar(dt)` já varre as partículas vivas para escrever posição no `Float32Array`; os mesmos 3 compares (min/max por eixo) entram no mesmo laço, com o acumulador em campos do módulo (não alocados por quadro).
- **Presets em `object_presets.ts` via um campo opcional `componentes`**, não um tipo de preset totalmente novo: cada entrada de `OBJECT_PRESETS` ganha `componentes?: () => Behavior[]` (uma fábrica, avaliada só na criação, nunca guardada como instância — evita um preset compartilhar estado entre dois usos). Presets de malha não preenchem o campo (o mesmo array serve aos dois casos, sem duplicar código de menu).
- **Ordem e tamanho das tarefas**: o runtime vira uma tarefa só (pipeline+shader+registro+testes, mais contido que o de áudio porque não há dispositivo nem decodificador), o núcleo do rts-game vira quatro (sim/emissão/forma, curvas sobre o tempo de vida, o componente com ciclo do Play, e o preenchimento do buffer + fallback), o pacote vira três (gizmos+presets, Inspector+prévia, comando WS), e depois GC, bench, docs e a verificação final. Task 1 no repo `rts` (worktree `rts-particulas`); Tasks 2-11 no rts-game; Task 12 é a verificação combinada.

---

### Task 1: `rts-egui` — `drawParticles`/`drawParticlesTex` (repo `rts`, worktree `rts-particulas`)

**Files:**
- Create: `C:\Users\nexga\Documents\GitHub\rts-particulas\crates\rts-egui\src\frame\scene3d\particles.rs`
- Modify: `...\crates\rts-egui\src\frame\scene3d\mod.rs` (registra `particle_pipeline`, o buffer de instância de partículas e a chamada de desenho no `flush`)
- Modify: `...\crates\rts-egui\src\frame\scene3d\pipeline.rs` (cria `particle_pipeline`; acrescenta a constante de blend aditivo)
- Modify: `...\crates\rts-egui\src\frame\scene3d\shader.rs` (acrescenta `vs_particle`/`fs_particle` ao módulo WGSL existente)
- Modify: `...\crates\rts-egui\src\scene_api.rs` (funções `draw_particles`, `draw_particles_tex`)
- Modify: `...\crates\rts-ui\src\scene.rs` (registra `("drawParticles", draw_particles), ("drawParticlesTex", draw_particles_tex)` na mesma tabela de `drawMesh`/`drawMeshBatch`)
- Modify: `...\crates\rts-host\tests\ui_surface.rs` (teste de superfície)
- Create: `...\crates\rts-egui\src\frame\scene3d\tests_particles.rs` (ou acrescentar a `tests.rs` existente, se for o padrão do crate)

**Interfaces:**
- Consumes: `Cam`/`Env` uniforms já existentes em `shader.rs` (`cam_right`, `cam_up`, `view_proj`), `with_scene`/`queue_draw`-style de `scene_api.rs`.
- Produces (Rust, `rts_egui`):
  - `scene_api::draw_particles(win: u64, floats: &[f32], n: i64, modo: i64) -> i64`
  - `scene_api::draw_particles_tex(win: u64, floats: &[f32], tex: u64, n: i64, modo: i64) -> i64`
  - `PART_FLOATS: usize = 9` (constante pública, mesmo nome do lado TS)
  - `pipeline::BLEND_ADDITIVE: wgpu::BlendState`

- [ ] **Step 1: Write the failing test**

Antes: `git -C C:\Users\nexga\Documents\GitHub\rts-uv-mundo worktree add ..\rts-particulas -b feat/particulas-nativo origin/main`. Depois, TODO comando roda em `C:\Users\nexga\Documents\GitHub\rts-particulas`. Ler `crates/rts-egui/src/frame/scene3d/pipeline.rs`, `shader.rs`, `mod.rs`, `scene_api.rs` e `crates/rts-ui/src/scene.rs` por inteiro (RULE 0), e o `README.md` de `rts-egui` se existir.

Acrescentar a `crates/rts-egui/src/frame/scene3d/particles.rs`:

```rust
//! Layout do buffer de instância de `drawParticles`/`drawParticlesTex`: 9 f32
//! por partícula. O TS escreve; este arquivo só nomeia os offsets e lê.
//!
//! POLÍTICA (pool, emissão, forma, curvas) fica no rts-game em TypeScript —
//! aqui só o suficiente para expandir cada linha num quad billboard na GPU.

pub const PART_X: usize = 0;
pub const PART_Y: usize = 1;
pub const PART_Z: usize = 2;
pub const PART_TAM: usize = 3;
pub const PART_ROT: usize = 4;
pub const PART_R: usize = 5;
pub const PART_G: usize = 6;
pub const PART_B: usize = 7;
pub const PART_A: usize = 8;
pub const PART_FLOATS: usize = 9;

/// Modos de `drawParticles` (o 3º/4º parâmetro `modo`); qualquer outro valor
/// cai em ALFA — nunca um pipeline inválido por um `modo` errado do chamador.
pub const MODO_ALFA: i64 = 0;
pub const MODO_ADITIVO: i64 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_tem_9_floats_e_offsets_sem_sobreposicao() {
        let offsets = [PART_X, PART_Y, PART_Z, PART_TAM, PART_ROT, PART_R, PART_G, PART_B, PART_A];
        let mut vistos = offsets.to_vec();
        vistos.sort();
        assert_eq!(vistos, (0..PART_FLOATS).collect::<Vec<_>>());
    }

    #[test]
    fn modo_desconhecido_nao_e_aditivo() {
        // Qualquer chamador com modo=2, -1 etc. deve cair no caminho alfa: o
        // teste de superfície (Task 1, ui_surface.rs) confere que scene_api
        // trata assim; aqui só documentamos os dois valores válidos.
        assert_ne!(MODO_ALFA, MODO_ADITIVO);
    }
}
```

Rodar (deve compilar e passar, já que só declara constantes e um teste trivial — o vermelho real vem no Step 2, com `scene_api::draw_particles` ainda não existindo):
```
cd C:\Users\nexga\Documents\GitHub\rts-particulas
cargo test -p rts-egui particles:: --lib
```

Acrescentar a `crates/rts-host/tests/ui_surface.rs` (perto do teste existente de `drawMeshBatch`, no mesmo estilo):

```rust
#[test]
fn draw_particles_recusa_sem_ler_fora_do_buffer() {
    let win = abrir_janela_teste(); // helper já usado pelos testes de drawMesh/drawMeshBatch
    let buf = vec![0.0f32; rts_egui::PART_FLOATS * 2]; // só 2 partículas
    // n maior que o buffer comporta: deve devolver 0 (recusa), não ler fora.
    assert_eq!(rts_egui::draw_particles(win, &buf, 5, 0), 0);
    // n=0: sempre 0, sem efeito.
    assert_eq!(rts_egui::draw_particles(win, &buf, 0, 0), 0);
    // modo desconhecido: trata como alfa e desenha as 2 partículas válidas.
    assert_eq!(rts_egui::draw_particles(win, &buf, 2, 99), 2);
}
```

Rodar: `cargo test -p rts-host draw_particles_recusa_sem_ler_fora_do_buffer` → falha (`draw_particles` não existe ainda).

- [ ] **Step 2: Implementação mínima**

Em `pipeline.rs`, ao lado de `ALPHA_BLENDING` (perto da criação do `pipeline` de malha), acrescentar a constante de blend aditivo e o pipeline de partículas:

```rust
/// Blend ADITIVO: soma a cor da partícula à do destino sem multiplicar pelo
/// alpha do destino (faíscas/fogo não escurecem o que está atrás). O modo
/// alfa continua em `wgpu::BlendState::ALPHA_BLENDING`, como o pipeline de malha.
pub(in crate::frame::scene3d) const BLEND_ADDITIVE: wgpu::BlendState = wgpu::BlendState {
    color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
    alpha: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
};

// PARTÍCULAS: quad billboard fixo (4 vértices, sem buffer por instância no
// slot 0 — vs_particle lê só @builtin(vertex_index)) + instância de 36 bytes
// (9 f32: pos, tamanho, rotação, cor). Depth TEST ligado, WRITE desligado:
// partículas ficam translúcidas entre si mas continuam atrás de paredes.
let particle_ibl = wgpu::VertexBufferLayout {
    array_stride: (PART_FLOATS * 4) as u64, // 36 bytes
    step_mode: wgpu::VertexStepMode::Instance,
    attributes: &[
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 0 },  // x,y,z,tamanho
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 16, shader_location: 1 }, // rotacao,r,g,b
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x1, offset: 32, shader_location: 2 }, // a
    ],
};
let particle_pipeline_alfa = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
    label: Some("scene3d particle pipeline (alfa)"),
    layout: Some(&mesh_layout),
    vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_particle"), buffers: &[particle_ibl.clone()], compilation_options: Default::default() },
    fragment: Some(wgpu::FragmentState {
        module: &shader, entry_point: Some("fs_particle"),
        targets: &[Some(wgpu::ColorTargetState { format: color_format, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
        compilation_options: Default::default(),
    }),
    primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, cull_mode: None, ..Default::default() },
    depth_stencil: Some(wgpu::DepthStencilState {
        format: DEPTH_FORMAT, depth_write_enabled: false, depth_compare: wgpu::CompareFunction::Less,
        stencil: wgpu::StencilState::default(), bias: wgpu::DepthBiasState::default(),
    }),
    multiview_mask: None, multisample: wgpu::MultisampleState::default(), cache: None,
});
let particle_pipeline_aditivo = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
    label: Some("scene3d particle pipeline (aditivo)"),
    layout: Some(&mesh_layout),
    vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_particle"), buffers: &[particle_ibl], compilation_options: Default::default() },
    fragment: Some(wgpu::FragmentState {
        module: &shader, entry_point: Some("fs_particle"),
        targets: &[Some(wgpu::ColorTargetState { format: color_format, blend: Some(BLEND_ADDITIVE), write_mask: wgpu::ColorWrites::ALL })],
        compilation_options: Default::default(),
    }),
    primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, cull_mode: None, ..Default::default() },
    depth_stencil: Some(wgpu::DepthStencilState {
        format: DEPTH_FORMAT, depth_write_enabled: false, depth_compare: wgpu::CompareFunction::Less,
        stencil: wgpu::StencilState::default(), bias: wgpu::DepthBiasState::default(),
    }),
    multiview_mask: None, multisample: wgpu::MultisampleState::default(), cache: None,
});
```

Em `shader.rs`, acrescentar ao mesmo módulo WGSL (perto de `sky_vs`/`sky_fs`):

```wgsl
struct ParticleOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};
// Quad UNIT em [-0.5,0.5]^2, 4 vértices (TriangleStrip): sem buffer de vértice
// por instância — só @location(0..2) da instância (slot 0, ver particle_ibl).
@vertex
fn vs_particle(
  @builtin(vertex_index) vi: u32,
  @location(0) pos_tam: vec4<f32>,   // x, y, z, tamanho
  @location(1) rot_rgb: vec4<f32>,   // rotacao, r, g, b
  @location(2) a: f32,
) -> ParticleOut {
  var corners = array<vec2<f32>, 4>(vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(-0.5, 0.5), vec2<f32>(0.5, 0.5));
  let c = corners[vi];
  let cr = cos(rot_rgb.x); let sr = sin(rot_rgb.x);
  let rc = vec2<f32>(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * pos_tam.w;
  // billboard: desloca no plano da câmera (cam_right/cam_up já existem no uniform Cam).
  let world = pos_tam.xyz + cam.cam_right.xyz * rc.x + cam.cam_up.xyz * rc.y;
  var o: ParticleOut;
  o.clip = cam.view_proj * vec4<f32>(world, 1.0);
  o.uv = c + vec2<f32>(0.5, 0.5);
  o.color = vec4<f32>(rot_rgb.y, rot_rgb.z, rot_rgb.w, a);
  return o;
}
@fragment
fn fs_particle(in: ParticleOut) -> @location(0) vec4<f32> {
  // disco suave procedural (default sem textura): alpha cai a zero na borda.
  let d = length(in.uv - vec2<f32>(0.5, 0.5)) * 2.0;
  let borda = 1.0 - smoothstep(0.8, 1.0, d);
  return vec4<f32>(in.color.rgb, in.color.a * borda);
}
```

Em `scene_api.rs`, ao lado de `draw_mesh_batch`:

```rust
/// `drawParticles(win, buf, n, modo)` — um draw instanciado, billboard, sem
/// textura (disco procedural). `buf` tem `PART_FLOATS` (9) floats por
/// partícula; `n` partículas são desenhadas, das primeiras `n` linhas de `buf`.
/// `n` maior do que `buf` comporta é recusado com 0 — nunca lê fora do slice.
pub fn draw_particles(win: u64, floats: &[f32], n: i64, modo: i64) -> i64 {
    if n <= 0 {
        return 0;
    }
    let n = n as usize;
    if n * particles::PART_FLOATS > floats.len() {
        return 0;
    }
    let aditivo = modo == particles::MODO_ADITIVO;
    with_scene(win, |s, _d| { s.queue_particles(&floats[..n * particles::PART_FLOATS], aditivo, None); n as i64 }, 0)
}

/// Como `draw_particles`, com textura (`tex`, id de `textureUpload`).
pub fn draw_particles_tex(win: u64, floats: &[f32], tex: u64, n: i64, modo: i64) -> i64 {
    if n <= 0 {
        return 0;
    }
    let n = n as usize;
    if n * particles::PART_FLOATS > floats.len() {
        return 0;
    }
    let aditivo = modo == particles::MODO_ADITIVO;
    with_scene(win, |s, _d| { s.queue_particles(&floats[..n * particles::PART_FLOATS], aditivo, Some(tex)); n as i64 }, 0)
}
```

`Scene3D::queue_particles` (em `mod.rs`, ao lado de `queue_draw`/`queue_water`) copia o slice para um `Vec<f32>` de instância reaproveitado (padrão de `water_draws`) e escolhe `particle_pipeline_alfa`/`particle_pipeline_aditivo` no `flush`, DEPOIS do desenho de malhas opacas e ANTES/junto do céu (spec §3.1).

No `flush()`, adicionar, depois do laço que desenha `self.draws` (malhas) e antes do desenho do céu:

```rust
if !self.particle_draws.is_empty() {
    for batch in &self.particle_draws {
        let pipeline = if batch.aditivo { &self.particle_pipeline_aditivo } else { &self.particle_pipeline_alfa };
        pass.set_pipeline(pipeline);
        pass.set_bind_group(2, batch.tex_bg.as_ref().unwrap_or(&self.default_tex_bg), &[]);
        queue.write_buffer(&self.particle_inst_buf, 0, bytemuck::cast_slice(&batch.floats));
        pass.set_vertex_buffer(0, self.particle_inst_buf.slice(..));
        pass.draw(0..4, 0..(batch.floats.len() / particles::PART_FLOATS) as u32);
    }
    self.particle_draws.clear();
}
```

Em `crates/rts-ui/src/scene.rs`, ao lado de `("drawMesh", draw_mesh), ("drawMeshBatch", draw_mesh_batch),`:

```rust
("drawParticles", draw_particles),
("drawParticlesTex", draw_particles_tex),
```

com as `extern "C" fn` correspondentes no molde de `draw_mesh_batch` (linhas 246-255 hoje): leem `win`, um `bytes` (o `Float32Array` reinterpretado como floats, mesmo helper `floats(&transforms)` que `draw_mesh_batch` usa), `n` e `modo` como inteiros, e chamam `rts_egui::draw_particles`/`draw_particles_tex`.

- [ ] **Step 3: Rodar os testes e o build completo**

```
cd C:\Users\nexga\Documents\GitHub\rts-particulas
cargo test -p rts-egui particles:: --lib
cargo test -p rts-host draw_particles_recusa_sem_ler_fora_do_buffer
cargo build --release --bin rts
cargo build --release -p rts-host --example ui_fixture --features ui
```
Esperado: todos verdes, os dois binários compilam sem warning (CI roda com `-D warnings`).

- [ ] **Step 4: Commit e PR**

```
git -C C:\Users\nexga\Documents\GitHub\rts-particulas add crates/rts-egui crates/rts-ui crates/rts-host
git -C C:\Users\nexga\Documents\GitHub\rts-particulas commit -m "feat(scene3d): drawParticles/drawParticlesTex — billboard instanciado com blend aditivo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```
Abrir PR de `feat/particulas-nativo` para `main` no repo `rts`; CI compila em Linux/macOS/Windows com warnings-as-errors. O controlador do repo `rts` faz o merge — não fazer merge por conta própria.

---

### Task 2: núcleo de simulação — pool, emissão e forma (`src/engine/particles/sim.ts`, `desc.ts`)

**Files:**
- Create: `src/engine/particles/sim.ts`
- Create: `src/engine/particles/desc.ts`
- Create: `tests/test_particulas_emissao.ts`
- Create: `tests/test_particulas_forma.ts`

**Interfaces:**
- Consumes: `aleatorio`, `aleatorioEntre` de `@engine/core/aleatorio`.
- Produces:
  - `desc.ts`: `FORMA_PONTO=0, FORMA_ESFERA=1, FORMA_CONE=2, FORMA_CAIXA=3`; `P_X=0,P_Y=1,P_Z=2,P_VX=3,P_VY=4,P_VZ=5,P_IDADE=6,P_VIDA=7,P_TAM0=8,P_ROT=9,P_COR0=10..13,P_FLOATS=14`.
  - `sim.ts`: `criarPool(maxParticulas: number): PoolParticulas`, `emitirN(pool: PoolParticulas, desc: Float64Array, n: number): number`, `atualizarVidas(pool: PoolParticulas, dt: f64): number` (recicla mortas, devolve quantas vivas restam).

- [ ] **Step 1: Write the failing test**

Criar `tests/test_particulas_emissao.ts`:

```typescript
import { criarPool, emitirN, atualizarVidas } from "@engine/particles/sim";
import { FORMA_PONTO } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";

function assertEq(msg: string, a: f64, b: f64): void {
  if (Math.abs(a - b) > 1e-9) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); }
}

fixarSementeAleatorio(12345);
const pool = criarPool(100);
const desc = new Float64Array(16); // forma=ponto, vida fixa 1s, velocidade fixa
desc[0] = FORMA_PONTO; desc[10] = 1.0; desc[11] = 1.0; // vidaMin=vidaMax=1.0

// rateOverTime acumulado por vários quadros de dt irregular não perde nem duplica.
let acumulado = 0.0;
let dt = 0.016;
let i = 0;
while (i < 625) { // 625 * 0.016 = 10s
  acumulado = acumulado + dt * 10.0; // rate=10/s
  const inteiras = Math.floor(acumulado);
  if (inteiras > 0) { emitirN(pool, desc, inteiras); acumulado = acumulado - inteiras; }
  i = i + 1;
}
assertEq("emitiu ~100 partículas em 10s a 10/s", pool.vivas, 100);

// maxParticles nunca excedido: emitir mais 50 num pool de 100 já cheio.
const antes = pool.vivas;
emitirN(pool, desc, 50);
assertEq("emissão além do pool é descartada", pool.vivas, antes);

// morte e reciclagem: 1s depois, todas as 100 morrem; emitir 10 novas reaproveita slots.
atualizarVidas(pool, 1.001);
assertEq("todas morreram", pool.vivas, 0);
emitirN(pool, desc, 10);
assertEq("reciclagem sem buraco", pool.vivas, 10);

console.log("[PASSOU] test_particulas_emissao");
```

Rodar: `$RTS run tests/test_particulas_emissao.ts` → falha (`@engine/particles/sim` não existe).

- [ ] **Step 2: Implementação mínima**

`src/engine/particles/desc.ts`:

```typescript
// Layout do "desc" de emissão (Float64Array, ≤ 4 parâmetros no caminho de
// emitirN/atualizar — o desc entra como UM parâmetro, não N escalares).
export const FORMA_PONTO: number = 0;
export const FORMA_ESFERA: number = 1;
export const FORMA_CONE: number = 2;
export const FORMA_CAIXA: number = 3;

export const D_FORMA: number = 0;
export const D_RAIO: number = 1;
export const D_ANGULO: number = 2;   // cone, graus
export const D_CAIXA_X: number = 3; export const D_CAIXA_Y: number = 4; export const D_CAIXA_Z: number = 5;
export const D_VEL_MIN: number = 6; export const D_VEL_MAX: number = 7;
export const D_TAM_MIN: number = 8; export const D_TAM_MAX: number = 9;
export const D_VIDA_MIN: number = 10; export const D_VIDA_MAX: number = 11;
export const D_ROT0: number = 12;
export const D_COR_R: number = 13; export const D_COR_G: number = 14; export const D_COR_B: number = 15;
export const DESC_FLOATS: number = 16;

// Layout de uma linha do pool (SoA: cada campo é uma COLUNA, ver sim.ts).
export const P_X: number = 0; export const P_Y: number = 1; export const P_Z: number = 2;
export const P_VX: number = 3; export const P_VY: number = 4; export const P_VZ: number = 5;
export const P_IDADE: number = 6; export const P_VIDA: number = 7;
export const P_TAM0: number = 8; export const P_ROT: number = 9;
export const P_COR_R: number = 10; export const P_COR_G: number = 11; export const P_COR_B: number = 12; export const P_COR_A: number = 13;
export const P_FLOATS: number = 14;
```

`src/engine/particles/sim.ts`:

```typescript
// Pool de partículas em SoA: um Float64Array só, P_FLOATS colunas por
// partícula, reaproveitado entre quadros (zero alocação — CLAUDE.md "Custo
// por quadro"). Reciclagem por lista de livres (pilha): O(1) para emitir e
// para reciclar, sem compactar o pool a cada morte.
import { aleatorio, aleatorioEntre } from "@engine/core/aleatorio";
import { FORMA_PONTO, FORMA_ESFERA, FORMA_CONE, FORMA_CAIXA,
         D_FORMA, D_RAIO, D_ANGULO, D_CAIXA_X, D_CAIXA_Y, D_CAIXA_Z,
         D_VEL_MIN, D_VEL_MAX, D_TAM_MIN, D_TAM_MAX, D_VIDA_MIN, D_VIDA_MAX, D_ROT0, D_COR_R, D_COR_G, D_COR_B,
         P_X, P_Y, P_Z, P_VX, P_VY, P_VZ, P_IDADE, P_VIDA, P_TAM0, P_ROT, P_COR_R, P_COR_G, P_COR_B, P_COR_A, P_FLOATS } from "./desc";

const DOIS_PI: f64 = 6.283185307179586;

export class PoolParticulas {
  dados: Float64Array;
  max: number;
  vivas: number;
  /// Pilha de índices livres (topo em `nLivres`); nasce cheia (todos livres).
  livres: Int32Array;
  nLivres: number;
  constructor(max: number) {
    this.dados = new Float64Array(max * P_FLOATS);
    this.max = max; this.vivas = 0;
    this.livres = new Int32Array(max);
    let i = 0; while (i < max) { this.livres[i] = max - 1 - i; i = i + 1; }
    this.nLivres = max;
  }
}
export function criarPool(maxParticulas: number): PoolParticulas { return new PoolParticulas(maxParticulas); }

/// Direção aleatória na esfera unitária (Marsaglia): 2 sorteios, sem trig.
const dirTmp = new Float64Array(3);
function direcaoAleatoria(): Float64Array {
  let x1 = 0.0; let x2 = 0.0; let s = 1.0;
  while (s >= 1.0) { x1 = aleatorioEntre(-1.0, 1.0); x2 = aleatorioEntre(-1.0, 1.0); s = x1 * x1 + x2 * x2; }
  const f = 2.0 * Math.sqrt(1.0 - s);
  dirTmp[0] = x1 * f; dirTmp[1] = x2 * f; dirTmp[2] = 1.0 - 2.0 * s;
  return dirTmp;
}
function amostrarPosVel(desc: Float64Array, pos: Float64Array, vel: Float64Array): void {
  const forma = desc[D_FORMA];
  const speed = aleatorioEntre(desc[D_VEL_MIN], desc[D_VEL_MAX]);
  if (forma === FORMA_ESFERA) {
    const r = desc[D_RAIO] * Math.pow(aleatorio(), 1.0 / 3.0);
    const d = direcaoAleatoria();
    pos[0] = d[0] * r; pos[1] = d[1] * r; pos[2] = d[2] * r;
    vel[0] = d[0] * speed; vel[1] = d[1] * speed; vel[2] = d[2] * speed;
  } else if (forma === FORMA_CONE) {
    const meiaAngulo = desc[D_ANGULO] * 0.5 * 0.017453292519943295;
    const ang = aleatorio() * DOIS_PI; const abre = aleatorio() * meiaAngulo;
    const sx = Math.sin(abre) * Math.cos(ang); const sz = Math.sin(abre) * Math.sin(ang); const sy = Math.cos(abre);
    pos[0] = 0.0; pos[1] = 0.0; pos[2] = 0.0;
    vel[0] = sx * speed; vel[1] = sy * speed; vel[2] = sz * speed;
  } else if (forma === FORMA_CAIXA) {
    pos[0] = aleatorioEntre(-0.5, 0.5) * desc[D_CAIXA_X];
    pos[1] = aleatorioEntre(-0.5, 0.5) * desc[D_CAIXA_Y];
    pos[2] = aleatorioEntre(-0.5, 0.5) * desc[D_CAIXA_Z];
    const d = direcaoAleatoria();
    vel[0] = d[0] * speed; vel[1] = d[1] * speed; vel[2] = d[2] * speed;
  } else { // FORMA_PONTO
    pos[0] = 0.0; pos[1] = 0.0; pos[2] = 0.0;
    const d = direcaoAleatoria();
    vel[0] = d[0] * speed; vel[1] = d[1] * speed; vel[2] = d[2] * speed;
  }
}

/// Emite até `n` partículas (menos se o pool não tiver slots livres o
/// suficiente — o resto é descartado, `maxParticles` nunca é excedido).
/// 3 parâmetros: pool e desc chegam por referência, dentro do limite do RTS.
export function emitirN(pool: PoolParticulas, desc: Float64Array, n: number): number {
  const pv = new Float64Array(3); const vv = new Float64Array(3);
  let emitidas = 0;
  while (emitidas < n && pool.nLivres > 0) {
    pool.nLivres = pool.nLivres - 1;
    const slot = pool.livres[pool.nLivres];
    amostrarPosVel(desc, pv, vv);
    const k = slot * P_FLOATS;
    pool.dados[k + P_X] = pv[0]; pool.dados[k + P_Y] = pv[1]; pool.dados[k + P_Z] = pv[2];
    pool.dados[k + P_VX] = vv[0]; pool.dados[k + P_VY] = vv[1]; pool.dados[k + P_VZ] = vv[2];
    pool.dados[k + P_IDADE] = 0.0;
    pool.dados[k + P_VIDA] = aleatorioEntre(desc[D_VIDA_MIN], desc[D_VIDA_MAX]);
    pool.dados[k + P_TAM0] = aleatorioEntre(desc[D_TAM_MIN], desc[D_TAM_MAX]);
    pool.dados[k + P_ROT] = desc[D_ROT0];
    pool.dados[k + P_COR_R] = desc[D_COR_R]; pool.dados[k + P_COR_G] = desc[D_COR_G]; pool.dados[k + P_COR_B] = desc[D_COR_B]; pool.dados[k + P_COR_A] = 1.0;
    pool.vivas = pool.vivas + 1;
    emitidas = emitidas + 1;
  }
  return emitidas;
}

/// Envelhece todas as partículas por `dt`; recicla as que morreram (idade >=
/// vida) devolvendo o slot à pilha de livres. 2 parâmetros. Devolve `vivas`.
export function atualizarVidas(pool: PoolParticulas, dt: f64): number {
  let slot = 0;
  while (slot < pool.max) {
    const k = slot * P_FLOATS;
    if (pool.dados[k + P_VIDA] > 0.0 && pool.dados[k + P_IDADE] < pool.dados[k + P_VIDA]) {
      pool.dados[k + P_IDADE] = pool.dados[k + P_IDADE] + dt;
      if (pool.dados[k + P_IDADE] >= pool.dados[k + P_VIDA]) {
        pool.dados[k + P_VIDA] = 0.0 - 1.0; // marca morta (vida<0: nunca mais entra aqui até reemitir)
        pool.livres[pool.nLivres] = slot; pool.nLivres = pool.nLivres + 1;
        pool.vivas = pool.vivas - 1;
      }
    }
    slot = slot + 1;
  }
  return pool.vivas;
}
```

- [ ] **Step 3: Rodar**

```
$RTS run tests/test_particulas_emissao.ts
```
Esperado: `[PASSOU] test_particulas_emissao`.

- [ ] **Step 4: Teste de forma** (`tests/test_particulas_forma.ts`)

Amostra 10 000 sementes de cada forma com `emitirN`, confere: esfera — todo ponto tem `|p| <= raio + 1e-9`; cone — todo vetor de velocidade tem ângulo com o eixo +Y `<= angulo/2 + 1e-6`; caixa — todo ponto tem `|x|<=largura/2` etc.; determinismo — `fixarSementeAleatorio(n)` duas vezes seguidas produz a MESMA sequência de posições (comparar byte a byte o pool depois de emitir com a mesma semente reaplicada).

```
$RTS run tests/test_particulas_forma.ts
```

- [ ] **Step 5: Commit**

```
git add src/engine/particles tests/test_particulas_emissao.ts tests/test_particulas_forma.ts
git commit -m "feat(particulas): pool SoA, emissão por taxa/burst e forma do emissor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 3: cor e tamanho sobre o tempo de vida, velocidade constante + arrasto (`src/engine/particles/curvas.ts`)

**Files:**
- Create: `src/engine/particles/curvas.ts`
- Create: `tests/test_particulas_curvas.ts`

**Interfaces:**
- Produces: `avaliarGradiente(chaves: Float64Array, nChaves: number, t: f64, out: Float64Array): void` (chaves: `[tempo0,r0,g0,b0,a0, tempo1,r1,g1,b1,a1, …]`, até 4 chaves — `out` recebe RGBA interpolado); `avaliarCurva(chaves: Float64Array, nChaves: number, t: f64): f64` (chaves: `[tempo0,valor0, tempo1,valor1, …]`); `aplicarVelocidade(pool: PoolParticulas, ventoXYZ: Float64Array, arrasto: f64, dt: f64): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/test_particulas_curvas.ts
import { avaliarGradiente, avaliarCurva } from "@engine/particles/curvas";

function assertClose(msg: string, a: f64, b: f64): void {
  if (Math.abs(a - b) > 1e-6) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); }
}

// gradiente com 2 chaves: branco opaco em t=0, vermelho transparente em t=1.
const grad = new Float64Array([0.0, 1.0, 1.0, 1.0, 1.0,  1.0, 1.0, 0.0, 0.0, 0.0]);
const out = new Float64Array(4);
avaliarGradiente(grad, 2, 0.0, out); assertClose("r em t=0", out[0], 1.0); assertClose("a em t=0", out[3], 1.0);
avaliarGradiente(grad, 2, 1.0, out); assertClose("g em t=1", out[1], 0.0); assertClose("a em t=1", out[3], 0.0);
avaliarGradiente(grad, 2, 0.5, out); assertClose("a no meio", out[3], 0.5);

// curva de tamanho com 3 chaves: cresce até o meio, encolhe até o fim.
const tam = new Float64Array([0.0, 0.0,  0.5, 1.0,  1.0, 0.0]);
assertClose("tamanho em t=0.25 (meio de 0→1)", avaliarCurva(tam, 3, 0.25), 0.5);
assertClose("tamanho no pico", avaliarCurva(tam, 3, 0.5), 1.0);
assertClose("tamanho no fim", avaliarCurva(tam, 3, 1.0), 0.0);

console.log("[PASSOU] test_particulas_curvas");
```

- [ ] **Step 2: Implementação mínima**

```typescript
// src/engine/particles/curvas.ts
// Gradiente de cor (2-4 chaves, RGBA) e curva de tamanho (2-4 chaves) sobre o
// tempo de vida normalizado [0,1] — interpolação LINEAR entre chaves
// vizinhas, sem tangente Bézier (fora de escopo, spec §8). Sem alocação: os
// buffers de chaves (Float64Array) são do chamador, o `out` do gradiente
// também.
export function avaliarGradiente(chaves: Float64Array, nChaves: number, t: f64, out: Float64Array): void {
  if (nChaves <= 1) { out[0] = chaves[1]; out[1] = chaves[2]; out[2] = chaves[3]; out[3] = chaves[4]; return; }
  let i = 0;
  while (i < nChaves - 1 && chaves[(i + 1) * 5] < t) i = i + 1;
  if (i >= nChaves - 1) i = nChaves - 2;
  const t0 = chaves[i * 5]; const t1 = chaves[(i + 1) * 5];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
  let c = 0;
  while (c < 4) { out[c] = chaves[i * 5 + 1 + c] + (chaves[(i + 1) * 5 + 1 + c] - chaves[i * 5 + 1 + c]) * f; c = c + 1; }
}
export function avaliarCurva(chaves: Float64Array, nChaves: number, t: f64): f64 {
  if (nChaves <= 1) return chaves[1];
  let i = 0;
  while (i < nChaves - 1 && chaves[(i + 1) * 2] < t) i = i + 1;
  if (i >= nChaves - 1) i = nChaves - 2;
  const t0 = chaves[i * 2]; const t1 = chaves[(i + 1) * 2];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
  return chaves[i * 2 + 1] + (chaves[(i + 1) * 2 + 1] - chaves[i * 2 + 1]) * f;
}

/// Soma o vento constante e aplica o arrasto exponencial a TODAS as
/// partículas vivas do pool. 4 parâmetros (pool, vento, arrasto, dt).
import { PoolParticulas } from "./sim";
import { P_VX, P_VY, P_VZ, P_VIDA, P_FLOATS } from "./desc";
export function aplicarVelocidade(pool: PoolParticulas, ventoXYZ: Float64Array, arrasto: f64, dt: f64): void {
  const fArrasto = 1.0 - arrasto * dt;
  let slot = 0;
  while (slot < pool.max) {
    const k = slot * P_FLOATS;
    if (pool.dados[k + P_VIDA] > 0.0) {
      pool.dados[k + P_VX] = (pool.dados[k + P_VX] + ventoXYZ[0] * dt) * fArrasto;
      pool.dados[k + P_VY] = (pool.dados[k + P_VY] + ventoXYZ[1] * dt) * fArrasto;
      pool.dados[k + P_VZ] = (pool.dados[k + P_VZ] + ventoXYZ[2] * dt) * fArrasto;
    }
    slot = slot + 1;
  }
}
```

- [ ] **Step 3: Rodar e commitar**

```
$RTS run tests/test_particulas_curvas.ts
git add src/engine/particles/curvas.ts tests/test_particulas_curvas.ts
git commit -m "feat(particulas): gradiente de cor e curva de tamanho sobre o tempo de vida

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 4: fallback do nativo (`src/compat/particles.ts`)

**Files:**
- Create: `src/compat/particles.ts`
- Create: `tests/test_particulas_fallback.ts`

**Interfaces:**
- Produces: `temDrawParticles(): boolean`, `drawParticlesSeguro(win: number, buf: Float32Array, n: number, modo: number): number` (chama o nativo se presente; senão devolve 0 e loga uma vez).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/test_particulas_fallback.ts — roda sem janela real (win inválido):
// confere que a chamada não lança e que o aviso sai só uma vez mesmo
// chamando 5 vezes.
import { drawParticlesSeguro, temDrawParticles } from "@compat/particles";

let avisos = 0;
// substitui o logger por um contador local seria ideal; aqui, o teste confia
// no comportamento observável: nenhuma exceção em 5 chamadas seguidas.
const buf = new Float32Array(9);
let i = 0;
while (i < 5) { drawParticlesSeguro(0, buf, 1, 0); i = i + 1; }
console.log("[PASSOU] test_particulas_fallback (temDrawParticles=" + temDrawParticles() + ")");
```

- [ ] **Step 2: Implementação mínima**

```typescript
// src/compat/particles.ts
// Presença de `drawParticles` no binário do rts em uso, calculada UMA vez
// (não por quadro — regra "sem try/catch no caminho por frame"). Sem a
// primitiva, a simulação continua (ela não depende do desenho); só o desenho
// é pulado, com um aviso único no Console (espelha `compat/audio.ts` antes do
// `cpal`).
import { logWarn } from "@engine/core/logger";

// @ts-ignore — nativo opcional, pode não existir em binários antigos.
import { drawParticles as drawParticlesNativo } from "rts:egui";

const AVISO_SEM_NATIVO: string = "Partículas: drawParticles ausente neste binário do rts; simulação continua, sem desenho.";
let avisou: number = 0;
let disponivel: number = -1; // -1 = ainda não testado

function calcularDisponivel(): number {
  try {
    const vazio = new Float32Array(0);
    drawParticlesNativo(0, vazio, 0, 0);
    return 1;
  } catch (e) {
    return 0;
  }
}
export function temDrawParticles(): boolean {
  if (disponivel < 0) disponivel = calcularDisponivel();
  return disponivel !== 0;
}
/// Caminho por quadro: SEM try/catch aqui (a regra do RTS é "try/catch fora de
/// funções por frame" — o try fica só em `calcularDisponivel`, chamada uma vez).
export function drawParticlesSeguro(win: number, buf: Float32Array, n: number, modo: number): number {
  if (!temDrawParticles()) {
    if (avisou === 0) { logWarn(AVISO_SEM_NATIVO); avisou = 1; }
    return 0;
  }
  return drawParticlesNativo(win, buf, n, modo);
}
```

- [ ] **Step 3: Rodar e commitar**

```
$RTS run tests/test_particulas_fallback.ts
git add src/compat/particles.ts tests/test_particulas_fallback.ts
git commit -m "feat(particulas): fallback sem drawParticles nativo, aviso único

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 5: o componente `ParticleSystem` (`src/scripts/particlesystem.ts`)

**Files:**
- Create: `src/scripts/particlesystem.ts`
- Create: `tests/test_particulas_source.ts`

**Interfaces:**
- Consumes: `criarPool/emitirN/atualizarVidas` (Task 2), `avaliarGradiente/avaliarCurva/aplicarVelocidade` (Task 3), `drawParticlesSeguro` (Task 4), `frustumBegin/inFrustumFast` de `@engine/render/gpu3d`, `KIND_RENDERER` de `@engine/core/behavior`.
- Produces: `class ParticleSystem extends Behavior` com `play()`, `stop(clear: boolean)`, `pause()`, `emit(n: number)`, `clear()`, `isPlaying(): boolean`, campos `particleCount`, `time`, e os campos públicos do Main/Emission/Shape/Renderer (spec §4.3). `kind(): number → KIND_RENDERER`; `drawsSelf(): number → 1`; `drawSelf(win: number, pos: Float64Array, tint: number): number`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/test_particulas_source.ts
import { ParticleSystem } from "@scripts/particlesystem";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";

function assertTrue(msg: string, v: boolean): void { if (!v) { console.log("[FALHOU] " + msg); process.exit(1); } }
function assertEq(msg: string, a: f64, b: f64): void { if (Math.abs(a - b) > 1e-6) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); } }

fixarSementeAleatorio(777);
const ps = new ParticleSystem();
ps.maxParticles = 50; ps.rateOverTime = 20.0; ps.startLifetimeMin = 1.0; ps.startLifetimeMax = 1.0;

assertTrue("não emite antes de play()", ps.particleCount === 0);
ps.play();
assertTrue("isPlaying após play()", ps.isPlaying());
let i = 0; while (i < 30) { ps.update(0.1); i = i + 1; } // 3s a 20/s => 50 (limitado por maxParticles)
assertEq("emitiu até o limite do pool", ps.particleCount, 50);

ps.stop(false);
assertTrue("stop(false): não emite mais", !ps.isPlaying());
const antes = ps.particleCount;
ps.update(0.1);
assertTrue("stop(false): vivas não sobem", ps.particleCount <= antes);

ps.clear();
assertEq("clear() zera na hora", ps.particleCount, 0);

ps.emit(5);
assertEq("emit(n) soma mesmo sem play()", ps.particleCount, 5);

const ps2 = new ParticleSystem();
ps2.maxParticles = 50; ps2.rateOverTime = 20.0; ps2.startLifetimeMin = 1.0; ps2.startLifetimeMax = 1.0;
ps2.pause();
ps2.play(); ps2.update(0.5);
const contagemAntesDoPause = ps2.particleCount;
const tAntesDoPause = ps2.time;
ps2.pause(); ps2.update(1.0);
assertEq("pause() congela particleCount", ps2.particleCount, contagemAntesDoPause);
assertEq("pause() congela time", ps2.time, tAntesDoPause);

console.log("[PASSOU] test_particulas_source");
```

Rodar: `$RTS run tests/test_particulas_source.ts` → falha (arquivo não existe).

- [ ] **Step 2: Implementação mínima**

```typescript
// src/scripts/particlesystem.ts
// ParticleSystem no modelo da Unity — spec 2026-09-27-particulas-design.md
// §4. Desenha-se como o Skeleton (KIND_RENDERER + drawsSelf): sem KIND novo,
// sem cache novo em Scene. Simula em update(dt), o hook por-frame comum a
// todo Behavior.
import { Behavior, KIND_RENDERER } from "@engine/core/behavior";
import { PoolParticulas, criarPool, emitirN, atualizarVidas } from "@engine/particles/sim";
import { avaliarGradiente, avaliarCurva, aplicarVelocidade } from "@engine/particles/curvas";
import { drawParticlesSeguro } from "@compat/particles";
import { frustumBeginBuf, inFrustumFast } from "@engine/render/gpu3d";
import { DESC_FLOATS, D_FORMA, D_RAIO, D_ANGULO, D_CAIXA_X, D_CAIXA_Y, D_CAIXA_Z,
         D_VEL_MIN, D_VEL_MAX, D_TAM_MIN, D_TAM_MAX, D_VIDA_MIN, D_VIDA_MAX, D_ROT0, D_COR_R, D_COR_G, D_COR_B,
         P_X, P_Y, P_Z, P_IDADE, P_VIDA, P_TAM0, P_ROT, P_COR_R, P_COR_G, P_COR_B, P_COR_A, P_FLOATS } from "@engine/particles/desc";

const PART_INSTANCIA_FLOATS: number = 9;

/**
 * @componentCategory Efeitos
 * @componentDescription Emissor de partículas no modelo da Unity (Shuriken): forma, taxa/burst, curvas sobre o tempo de vida.
 * @componentKeywords particula particle fogo fumaca faisca chuva efeito vfx
 */
export class ParticleSystem extends Behavior {
  duration: number = 5.0;
  loop: boolean = true;
  playOnAwake: boolean = true;
  prewarm: boolean = false;
  maxParticles: number = 1000;
  gravityModifier: number = 0.0;
  rateOverTime: number = 10.0;
  startLifetimeMin: number = 1.0; startLifetimeMax: number = 1.0;
  startSpeedMin: number = 1.0; startSpeedMax: number = 1.0;
  startSizeMin: number = 0.1; startSizeMax: number = 0.1;
  startRotation: number = 0.0;
  startColorR: number = 1.0; startColorG: number = 1.0; startColorB: number = 1.0;
  forma: number = 0; raio: number = 1.0; anguloCone: number = 25.0;
  caixaX: number = 1.0; caixaY: number = 1.0; caixaZ: number = 1.0;
  ventoX: number = 0.0; ventoY: number = 0.0; ventoZ: number = 0.0; arrasto: number = 0.0;
  modo: number = 0; sort: number = 0;
  /// Arrays de chaves (Inspector customizado, não campo automático — spec §4.3).
  private gradiente: Float64Array = new Float64Array([0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0]);
  private nChavesGradiente: number = 2;
  private curvaTamanho: Float64Array = new Float64Array([0.0, 1.0, 1.0, 1.0]);
  private nChavesTamanho: number = 2;

  private pool: PoolParticulas | null = null;
  private descBuf: Float64Array = new Float64Array(DESC_FLOATS);
  private saidaBuf: Float32Array = new Float32Array(0);
  private acumulado: number = 0.0;
  private tocando: number = 0;
  private pausado: number = 0;
  time: number = 0.0;
  get particleCount(): number { return this.pool === null ? 0 : this.pool.vivas; }

  typeName(): string { return "Partículas"; }
  kind(): number { return KIND_RENDERER; }
  drawsSelf(): number { return 1; }

  private garantirPool(): PoolParticulas {
    if (this.pool === null || this.pool.max !== this.maxParticles) this.pool = criarPool(this.maxParticles);
    return this.pool as PoolParticulas;
  }
  private montarDesc(): void {
    const d = this.descBuf;
    d[D_FORMA] = this.forma; d[D_RAIO] = this.raio; d[D_ANGULO] = this.anguloCone;
    d[D_CAIXA_X] = this.caixaX; d[D_CAIXA_Y] = this.caixaY; d[D_CAIXA_Z] = this.caixaZ;
    d[D_VEL_MIN] = this.startSpeedMin; d[D_VEL_MAX] = this.startSpeedMax;
    d[D_TAM_MIN] = this.startSizeMin; d[D_TAM_MAX] = this.startSizeMax;
    d[D_VIDA_MIN] = this.startLifetimeMin; d[D_VIDA_MAX] = this.startLifetimeMax;
    d[D_ROT0] = this.startRotation;
    d[D_COR_R] = this.startColorR; d[D_COR_G] = this.startColorG; d[D_COR_B] = this.startColorB;
  }

  play(): void { this.tocando = 1; this.pausado = 0; this.time = 0.0; this.acumulado = 0.0; }
  stop(clear: boolean): void { this.tocando = 0; if (clear) this.clear(); }
  pause(): void { this.pausado = 1; }
  unPause(): void { this.pausado = 0; }
  isPlaying(): boolean { return this.tocando !== 0 && this.pausado === 0; }
  emit(n: number): void { this.montarDesc(); emitirN(this.garantirPool(), this.descBuf, n); }
  clear(): void { const p = this.garantirPool(); p.vivas = 0; p.nLivres = p.max; let i = 0; while (i < p.max) { p.livres[i] = p.max - 1 - i; i = i + 1; } }

  mount(): void { if (this.playOnAwake) this.play(); }

  /// Simulação: emissão por taxa, envelhecimento, vento/arrasto. ≤ 4
  /// parâmetros (dt é o único; pool/desc ficam em campos, reaproveitados).
  update(dt: f64): void {
    if (this.pausado !== 0) return;
    const pool = this.garantirPool();
    if (this.tocando !== 0) {
      this.time = this.time + dt;
      this.montarDesc();
      this.acumulado = this.acumulado + dt * this.rateOverTime;
      const inteiras = Math.floor(this.acumulado);
      if (inteiras > 0) { emitirN(pool, this.descBuf, inteiras); this.acumulado = this.acumulado - inteiras; }
      if (!this.loop && this.time >= this.duration) this.tocando = 0;
    }
    atualizarVidas(pool, dt);
    const vento = new Float64Array(3); vento[0] = this.ventoX; vento[1] = this.ventoY - this.gravityModifier; vento[2] = this.ventoZ;
    aplicarVelocidade(pool, vento, this.arrasto, dt);
    let slot = 0;
    while (slot < pool.max) {
      const k = slot * P_FLOATS;
      if (pool.dados[k + P_VIDA] > 0.0) {
        pool.dados[k + P_X] = pool.dados[k + P_X] + pool.dados[k + 3] * dt;
        pool.dados[k + P_Y] = pool.dados[k + P_Y] + pool.dados[k + 4] * dt;
        pool.dados[k + P_Z] = pool.dados[k + P_Z] + pool.dados[k + 5] * dt;
      }
      slot = slot + 1;
    }
  }

  /// Preenche o buffer de instância e desenha. 3 parâmetros (win, pos do
  /// dono, tint — a assinatura fixa de drawsSelf; simulationSpace=world soma
  /// `pos`, local usa a posição relativa já simulada).
  drawSelf(win: number, pos: Float64Array, tint: number): number {
    const pool = this.pool;
    if (pool === null || pool.vivas === 0) return 0;
    if (this.saidaBuf.length < pool.max * PART_INSTANCIA_FLOATS) this.saidaBuf = new Float32Array(pool.max * PART_INSTANCIA_FLOATS);
    const out = this.saidaBuf; const cor = new Float64Array(4);
    let n = 0; let slot = 0;
    while (slot < pool.max) {
      const k = slot * P_FLOATS;
      if (pool.dados[k + P_VIDA] > 0.0) {
        const t = pool.dados[k + P_IDADE] / pool.dados[k + P_VIDA];
        avaliarGradiente(this.gradiente, this.nChavesGradiente, t, cor);
        const escala = avaliarCurva(this.curvaTamanho, this.nChavesTamanho, t);
        const o = n * PART_INSTANCIA_FLOATS;
        out[o] = pos[0] + pool.dados[k + P_X]; out[o + 1] = pos[1] + pool.dados[k + P_Y]; out[o + 2] = pos[2] + pool.dados[k + P_Z];
        out[o + 3] = pool.dados[k + P_TAM0] * escala; out[o + 4] = pool.dados[k + P_ROT];
        out[o + 5] = cor[0]; out[o + 6] = cor[1]; out[o + 7] = cor[2]; out[o + 8] = cor[3];
        n = n + 1;
      }
      slot = slot + 1;
    }
    return drawParticlesSeguro(win, out, n, this.modo);
  }
}
```

- [ ] **Step 3: Rodar**

```
npm run components
$RTS run tests/test_particulas_source.ts
```
Esperado: `[PASSOU] test_particulas_source`.

- [ ] **Step 4: Commit**

```
git add src/scripts/particlesystem.ts tests/test_particulas_source.ts
git commit -m "feat(particulas): componente ParticleSystem (play/stop/pause/emit/clear, drawsSelf)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 6: frustum culling do emissor e teste de retomada de posição

**Files:**
- Modify: `src/scripts/particlesystem.ts` (`drawSelf` corta por frustum ANTES de montar o buffer, usando um raio de limite do pool)
- Create: `tests/test_particulas_frustum.ts`

**Interfaces:**
- Produces: `ParticleSystem.limiteRaio(): f64` (privado, raio que envolve as partículas vivas — usado só para o corte, recomputado no próprio `drawSelf`).

- [ ] **Step 1: Write the failing test**

`tests/test_particulas_frustum.ts` cria um `ParticleSystem`, chama `frustumBeginBuf` com uma câmera olhando para +Z, posiciona o emissor bem atrás da câmera (fora do frustum) e confere que `drawSelf` devolve `0` (nada desenhado) mesmo com partículas vivas; depois recoloca o emissor na frente e confere que `drawSelf` volta a desenhar, com a MESMA posição das partículas de antes (a simulação não "perdeu" nada por ter sido cortada do desenho).

- [ ] **Step 2: Implementação mínima**

Em `drawSelf`, antes de montar `out`, calcular o raio que envolve `pos` mais o `raio`/`caixaX,Y,Z` do emissor (o maior entre eles, com uma margem para `startSpeed*startLifetime`, o alcance máximo que uma partícula pode ter percorrido) e chamar `inFrustumFast(pos[0], pos[1], pos[2], raioLimite)`; se `0`, devolver `0` sem tocar `saidaBuf` nem chamar `drawParticlesSeguro` — a simulação em `update(dt)` continua de qualquer forma, porque está em outro método.

- [ ] **Step 3: Rodar e commitar**

```
$RTS run tests/test_particulas_frustum.ts
git add src/scripts/particlesystem.ts tests/test_particulas_frustum.ts
git commit -m "feat(particulas): corta o desenho por frustum sem afetar a simulação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 7: pacote de editor — gizmo de forma, ícone, menu e presets (`assets/pacotes/particulas/particulas_editor.ts`, `src/editor/object_presets.ts`, `src/engine/core/gizmos.ts`)

**Files:**
- Create: `assets/pacotes/particulas/particulas_editor.ts`
- Modify: `src/engine/core/gizmos.ts` (acrescenta `Gizmos.wireBox`)
- Modify: `src/editor/object_presets.ts` (campo opcional `componentes` + os 4 presets)
- Modify: `assets/editor/icons/source.json` (ícone `particulas-emissor`)
- Modify: `src/editor/main.ts` ou onde `createMenuObject` decide entre malha e componente (checa `preset.componentes`)

**Interfaces:**
- Produces: `Gizmos.wireBox(centro: Float64Array, tamanho: Float64Array): void`; `OBJECT_PRESETS` com entradas `{ label, name, meshKind, r, g, b, componentes?: () => Behavior[] }`.

- [ ] **Step 1: Write the failing test**

`tests/test_editor_particulas_presets.ts` (sem janela): importa `OBJECT_PRESETS`, confere que existem as 4 entradas "Fogo", "Fumaça", "Faíscas", "Chuva", cada uma com `componentes` definido, e que chamar `componentes()` duas vezes devolve DUAS instâncias distintas de `ParticleSystem` (não a mesma, para não compartilhar pool entre dois objetos criados a partir do mesmo preset).

- [ ] **Step 2: Implementação mínima**

Em `gizmos.ts`, ao lado de `wireCone`:

```typescript
/// Caixa de arestas alinhada aos eixos, centro `c`, tamanho total por eixo em
/// `tamanho`. 3 parâmetros (dentro do limite): 8 vértices, 12 arestas.
wireBox(c: Float64Array, tamanho: Float64Array): void {
  const hx = tamanho[0] * 0.5; const hy = tamanho[1] * 0.5; const hz = tamanho[2] * 0.5;
  const v: Float64Array[] = [];
  let i = 0;
  while (i < 8) {
    const p = new Float64Array(3);
    p[0] = c[0] + (i & 1 ? hx : -hx); p[1] = c[1] + (i & 2 ? hy : -hy); p[2] = c[2] + (i & 4 ? hz : -hz);
    v.push(p); i = i + 1;
  }
  const arestas = [0,1, 0,2, 1,3, 2,3, 4,5, 4,6, 5,7, 6,7, 0,4, 1,5, 2,6, 3,7];
  let k = 0; while (k < arestas.length) { this.line(v[arestas[k]], v[arestas[k+1]]); k = k + 2; }
}
```

Em `src/editor/object_presets.ts`:

```typescript
import type { Behavior } from "@engine/core/behavior";
import { ParticleSystem } from "@scripts/particlesystem";
import { FORMA_ESFERA, FORMA_CONE, FORMA_CAIXA } from "@engine/particles/desc";

function presetFogo(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_CONE; p.anguloCone = 15.0; p.rateOverTime = 30.0; p.modo = 1; // aditivo
  p.startColorR = 1.0; p.startColorG = 0.5; p.startColorB = 0.1; p.startSpeedMin = 1.0; p.startSpeedMax = 2.0;
  p.startLifetimeMin = 0.6; p.startLifetimeMax = 1.0; p.startSizeMin = 0.3; p.startSizeMax = 0.6;
  return [p];
}
function presetFumaca(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_CONE; p.anguloCone = 25.0; p.rateOverTime = 8.0; p.modo = 0;
  p.startColorR = 0.5; p.startColorG = 0.5; p.startColorB = 0.5; p.startSpeedMin = 0.3; p.startSpeedMax = 0.6;
  p.startLifetimeMin = 2.0; p.startLifetimeMax = 3.0; p.startSizeMin = 0.5; p.startSizeMax = 1.2; p.arrasto = 0.3;
  return [p];
}
function presetFaiscas(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_ESFERA; p.raio = 0.05; p.rateOverTime = 0.0; p.modo = 1;
  p.startColorR = 1.0; p.startColorG = 0.9; p.startColorB = 0.4; p.startSpeedMin = 2.0; p.startSpeedMax = 5.0;
  p.startLifetimeMin = 0.3; p.startLifetimeMax = 0.6; p.startSizeMin = 0.05; p.startSizeMax = 0.1; p.loop = false;
  return [p];
}
function presetChuva(): Behavior[] {
  const p = new ParticleSystem();
  p.forma = FORMA_CAIXA; p.caixaX = 5.0; p.caixaY = 0.1; p.caixaZ = 5.0; p.rateOverTime = 200.0; p.modo = 0;
  p.startColorR = 0.7; p.startColorG = 0.8; p.startColorB = 1.0; p.startSpeedMin = 4.0; p.startSpeedMax = 5.0;
  p.startLifetimeMin = 1.0; p.startLifetimeMax = 1.5; p.startSizeMin = 0.02; p.startSizeMax = 0.03; p.gravityModifier = 9.8;
  return [p];
}

export const OBJECT_PRESETS = [
  { label: "Cubo", name: "Cube", meshKind: 1, r: 150, g: 180, b: 220 },
  { label: "Esfera", name: "Sphere", meshKind: 4, r: 220, g: 170, b: 150 },
  { label: "Pirâmide", name: "Pyramid", meshKind: 2, r: 170, g: 210, b: 170 },
  { label: "Octaedro", name: "Octa", meshKind: 3, r: 200, g: 180, b: 230 },
  { label: "Objeto vazio", name: "Empty", meshKind: 0, r: 0, g: 0, b: 0 },
  { label: "Fogo", name: "Fogo", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetFogo },
  { label: "Fumaça", name: "Fumaça", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetFumaca },
  { label: "Faíscas", name: "Faíscas", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetFaiscas },
  { label: "Chuva", name: "Chuva", meshKind: 0, r: 0, g: 0, b: 0, componentes: presetChuva },
];

export const OBJECT_PRESET_LABELS: string[] = [];
let presetIndex = 0;
while (presetIndex < OBJECT_PRESETS.length) { OBJECT_PRESET_LABELS.push(OBJECT_PRESETS[presetIndex].label); presetIndex = presetIndex + 1; }
```

Em `createMenuObject` (`main.ts`), depois de `ctxCreate(preset.name, preset.meshKind, ...)`, checar `if (preset.componentes) { const bs = preset.componentes(); let i=0; while (i<bs.length) { criado.addBehavior(bs[i]); i=i+1; } }` — sem duplicar a lógica entre o menu global e o de contexto, porque os dois chamam `createMenuObject`.

Em `assets/pacotes/particulas/particulas_editor.ts`, no molde de `audio_editor.ts`:

```typescript
/** @editorOnly */
import { registerGizmo, Gizmos } from "@editor/api";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { ParticleSystem } from "@scripts/particlesystem";
import { FORMA_ESFERA, FORMA_CONE, FORMA_CAIXA } from "@engine/particles/desc";

const ICONE_EMISSOR: string = "particulas-emissor";
const COR_GIZMO_FORMA: number = 0x9FC5E8;
const gzPos = new Float64Array(3);
const gzTam = new Float64Array(3);
const gzDir = new Float64Array(3);

function desenharEmissor(g: Gizmos, dono: GameObject, comp: Behavior): void {
  const p = comp as ParticleSystem;
  gzPos[0] = dono.transform.wx; gzPos[1] = dono.transform.wy; gzPos[2] = dono.transform.wz;
  g.color(COR_GIZMO_FORMA);
  g.icon(ICONE_EMISSOR, gzPos);
  if (!g.selecionado) return;
  if (p.forma === FORMA_ESFERA) g.wireSphere(gzPos, p.raio);
  else if (p.forma === FORMA_CONE) { gzDir[0] = 0.0; gzDir[1] = 1.0; gzDir[2] = 0.0; g.wireCone(gzPos, gzDir, p.startSpeedMax, p.anguloCone); }
  else if (p.forma === FORMA_CAIXA) { gzTam[0] = p.caixaX; gzTam[1] = p.caixaY; gzTam[2] = p.caixaZ; g.wireBox(gzPos, gzTam); }
}
registerGizmo("Partículas", desenharEmissor);
```

- [ ] **Step 3: Rodar e commitar**

```
npm run components
npm run test:components
npm run components:check
$RTS run tests/test_editor_particulas_presets.ts
npm run icons
npm run icons:check
git add assets/pacotes/particulas src/engine/core/gizmos.ts src/editor/object_presets.ts assets/editor/icons/source.json tests/test_editor_particulas_presets.ts
git commit -m "feat(particulas): gizmo de forma (wireBox), presets Fogo/Fumaça/Faíscas/Chuva

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 8: menu `Criar/Efeitos/Partículas` e Inspector com editor de chaves

**Files:**
- Modify: `assets/pacotes/particulas/particulas_editor.ts` (`@menuItem Criar/Efeitos/Partículas`, `ParticleSystem.onInspectorGUI`)
- Modify: `src/scripts/particlesystem.ts` (`onInspectorGUI`, getters/setters para as chaves via `fieldGet/fieldSet` ou método próprio consumido pelo Inspector customizado)
- Create: `tests/test_particulas_inspector.ts`

**Interfaces:**
- Produces: `ParticleSystem.nChavesGradienteGet()/setChaveGradiente(i, tempo, r, g, b, a)` (≤ 4 parâmetros — `setChaveGradiente` precisa de 5; ver decisão abaixo).

- [ ] **Step 1: Write the failing test**

`tests/test_particulas_inspector.ts`: cria um `ParticleSystem`, chama o método de edição de chave (o nome exato depende do Step 2), confere que uma chave nova entra ordenada por tempo e que `nChavesGradiente`/`nChavesTamanho` nunca passam de 4 (a 5ª tentativa é ignorada com um retorno `false`).

- [ ] **Step 2: Implementação mínima**

Como alterar uma chave de gradiente pede tempo+4 componentes de cor (5 escalares), a função do Inspector recebe um `Float64Array` de 5 posições (não 5 parâmetros escalares — a mesma solução que o `desc` de `mix_add` usa no áudio):

```typescript
// em ParticleSystem
setChaveGradiente(i: number, valores: Float64Array): boolean {
  if (i < 0 || i >= 4) return false;
  const k = i * 5;
  this.gradiente[k] = valores[0]; this.gradiente[k+1] = valores[1]; this.gradiente[k+2] = valores[2]; this.gradiente[k+3] = valores[3]; this.gradiente[k+4] = valores[4];
  if (i >= this.nChavesGradiente) this.nChavesGradiente = i + 1;
  return true;
}
onInspectorGUI(ui: InspectorUI): void {
  ui.label("Gradiente de cor (" + this.nChavesGradiente + " chaves)");
  let i = 0;
  const tmp = new Float64Array(5);
  while (i < this.nChavesGradiente) {
    tmp[0] = this.gradiente[i*5]; tmp[1] = this.gradiente[i*5+1]; tmp[2] = this.gradiente[i*5+2]; tmp[3] = this.gradiente[i*5+3]; tmp[4] = this.gradiente[i*5+4];
    const t = ui.slider("Chave " + i + " — tempo", tmp[0], 0.0, 1.0);
    if (t !== tmp[0]) { tmp[0] = t; this.setChaveGradiente(i, tmp); }
    i = i + 1;
  }
  if (this.nChavesGradiente < 4 && ui.button("+ chave de cor")) { tmp[0] = 1.0; tmp[1] = 1.0; tmp[2] = 1.0; tmp[3] = 1.0; tmp[4] = 1.0; this.setChaveGradiente(this.nChavesGradiente, tmp); }
  // curva de tamanho: mesmo padrão, com Float64Array de 2 (tempo, valor).
}
```

Em `particulas_editor.ts`, o item de menu:

```typescript
export class ParticulasMenu {
  /** @menuItem Criar/Efeitos/Partículas */
  static criar(): void {
    const sc = Editor.scene(); if (sc === null) return;
    const o = sc.createGameObject("Partículas");
    const pt = new Float64Array(5); Editor.spawnPoint(pt);
    o.transform.setPosition(pt[0], pt[1], pt[2]);
    o.addBehavior(new ParticleSystem());
  }
}
```

- [ ] **Step 3: Rodar e commitar**

```
$RTS run tests/test_particulas_inspector.ts
npm run test:components
git add assets/pacotes/particulas src/scripts/particlesystem.ts tests/test_particulas_inspector.ts
git commit -m "feat(particulas): menu Criar/Efeitos/Partículas e editor de chaves no Inspector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 9: prévia de edição (simula só quando selecionado, nunca é salva)

**Files:**
- Modify: `src/scripts/particlesystem.ts` (bandeira `EditorSelecao` consultada fora do Play)
- Modify: `assets/pacotes/particulas/particulas_editor.ts` (botões Reiniciar/Pausar no Inspector, marcando a seleção)
- Create: `tests/test_particulas_previa.ts`

**Interfaces:**
- Produces: `definirConsultaSelecao(fn: (id: number) => boolean): void` (injeção do editor — o núcleo do componente não importa `@editor/api` diretamente, para não criar ciclo `scripts → editor`); `ParticleSystem.emPlay: boolean` (setado pelo `PlayMode`, como já é implícito para todo `Behavior` copiado).

- [ ] **Step 1: Write the failing test**

`tests/test_particulas_previa.ts`: registra uma função de seleção fake que devolve `true`/`false` por id; confere que, FORA do Play, `update(dt)` só avança `time`/emite quando a função devolve `true` para o id do objeto; DENTRO do Play (setando a bandeira que o `PlayMode` usaria), `update(dt)` avança independente da seleção; confere que `componentToData` fora do Play nunca inclui o pool simulado (só os campos de configuração).

- [ ] **Step 2: Implementação mínima**

Em `src/scripts/particlesystem.ts`:

```typescript
/// Injeção do editor: `assets/pacotes/particulas/particulas_editor.ts` chama
/// isto uma vez, na carga do pacote, para o núcleo não importar `@editor/api`
/// (evita o ciclo `scripts → editor` que o CLAUDE.md proíbe).
let consultaSelecao: ((id: number) => boolean) | null = null;
export function definirConsultaSelecao(fn: (id: number) => boolean): void { consultaSelecao = fn; }

// dentro de ParticleSystem:
/// Setado pelo PlayMode ao copiar o objeto para a sessão de Play (mesmo
/// padrão que qualquer Behavior já recebe implicitamente via a cópia).
emPlay: boolean = false;

update(dt: f64): void {
  if (!this.emPlay && consultaSelecao !== null) {
    const dono = this.host === null ? -1 : this.host.ownerId; // ownerId: id estável do GameObject dono, já existe no Transform
    if (!consultaSelecao(dono)) return; // fora do Play, sem seleção: não simula (economiza CPU, como a Unity)
  }
  // ... resto do update de antes (Task 5) ...
}
```

`componentToData` já não serializa campos privados sem `@serializeField` (regra do CLAUDE.md "Criação de objetos"): como `pool`/`descBuf`/`saidaBuf`/`acumulado` são `private` sem essa marcação, eles já ficam fora do arquivo salvo — este passo só confirma isso com um teste, sem precisar de código novo em `componentToData`.

Em `particulas_editor.ts`, registrar a consulta uma vez e desenhar os botões:

```typescript
import { definirConsultaSelecao } from "@scripts/particlesystem";
definirConsultaSelecao((id: number) => Editor.selecionado(id));
// no onInspectorGUI do ParticleSystem (ou num pequeno inspector auxiliar do pacote):
if (ui.button(ps.isPlaying() ? "Pausar" : "Continuar")) { if (ps.isPlaying()) ps.pause(); else ps.unPause(); }
if (ui.button("Reiniciar")) { ps.clear(); ps.play(); }
```

- [ ] **Step 3: Rodar e commitar**

```
$RTS run tests/test_particulas_previa.ts
git add src/scripts/particlesystem.ts assets/pacotes/particulas/particulas_editor.ts tests/test_particulas_previa.ts
git commit -m "feat(particulas): prévia de edição só quando selecionado, nunca salva

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 10: comando WebSocket `particulas`

**Files:**
- Modify: `assets/pacotes/particulas/particulas_editor.ts` (ou um `particulas_ws.ts` ao lado, se o pacote de áudio separar o comando do resto — ver `commands/scene.ts` para o padrão de `registerCommand`)
- Create: `tests/test_particulas_ws.ts`
- Modify: `tests/editor-static.test.mjs` (manifesto dos comandos embutidos, se `particulas` precisar entrar lá como `audio`/`snd`)

**Interfaces:**
- Produces: `registerCommand("particulas", handlerParticulas)`, respondendo a `<obj> play|stop|emit <n>|clear|info`.

- [ ] **Step 1: Write the failing test**

`tests/test_particulas_ws.ts` chama o handler do comando diretamente (sem WS real, no molde de como os testes de `audio`/`snd` chamam o handler): `particulas Fogo play` → sucesso; `particulas Fogo info` → string batendo o formato `vivas=<n> max=<m> tocando=<0|1> t=<s> bbox=(...)-(...)`; `particulas Faltante play` → erro "objeto não encontrado" (ou o padrão de erro que os outros comandos usam); roda 60 quadros de `update(1/60)` e confere `vivas` crescendo e o `bbox` compatível com a forma (esfera: bbox aproximadamente cúbico de lado `2×raio`).

- [ ] **Step 2: Implementação mínima**

```typescript
// em particulas_editor.ts, ao lado do menu
import { registerCommand } from "@editor/api"; // ou de onde audio_editor importaria, se for outro módulo

const ROTULO_OBJ_NAO_ACHADO: string = "Partículas: objeto não encontrado.";
const ROTULO_SEM_PARTICLESYSTEM: string = "Partículas: objeto sem ParticleSystem.";

function acharParticleSystem(nome: string): ParticleSystem | null {
  const sc = Editor.scene(); if (sc === null) return null;
  const o = sc.findByName(nome); if (o === null) return null;
  let i = 0;
  while (i < o.behaviors.length) { if (o.behaviors[i] instanceof ParticleSystem) return o.behaviors[i] as ParticleSystem; i = i + 1; }
  return null;
}
function formatarBBox(p: ParticleSystem): string {
  // varre o pool (exposto por um getter de leitura, sem cópia) calculando min/max — mesmo laço que drawSelf, sem escrever saidaBuf.
  const b = p.bboxAtual(); // [minx,miny,minz,maxx,maxy,maxz], Float64Array de módulo reaproveitado
  return "bbox=(" + b[0] + "," + b[1] + "," + b[2] + ")-(" + b[3] + "," + b[4] + "," + b[5] + ")";
}
export function handlerParticulas(args: string[]): string {
  if (args.length < 2) return "uso: particulas <obj> play|stop|emit <n>|clear|info";
  const p = acharParticleSystem(args[0]);
  if (p === null) return ROTULO_OBJ_NAO_ACHADO;
  const cmd = args[1];
  if (cmd === "play") { p.play(); return "ok"; }
  if (cmd === "stop") { p.stop(false); return "ok"; }
  if (cmd === "clear") { p.clear(); return "ok"; }
  if (cmd === "emit") { p.emit(args.length > 2 ? Number(args[2]) : 1); return "ok"; }
  if (cmd === "info") {
    return "vivas=" + p.particleCount + " max=" + p.maxParticles + " tocando=" + (p.isPlaying() ? 1 : 0) + " t=" + p.time.toFixed(3) + " " + formatarBBox(p);
  }
  return "comando desconhecido: " + cmd;
}
registerCommand("particulas", handlerParticulas, false); // muta=false só para "info"; os demais mutam a cena de teste, não o arquivo
```

`ParticleSystem.bboxAtual()`: acrescentado na Task 5/6 como acumulador de módulo dentro do próprio `drawSelf`/`update` (decisão do plano: calculado durante o preenchimento do buffer, sem passada extra) — se `drawSelf` não rodou naquele quadro (fora do frustum ou sem `drawParticles` nativo), `bboxAtual()` faz sua própria passada leve sobre o pool só quando chamada pelo comando WS (não é caminho por quadro).

- [ ] **Step 3: Rodar e commitar**

```
$RTS run tests/test_particulas_ws.ts
node --test tests/editor-static.test.mjs
git add assets/pacotes/particulas tests/test_particulas_ws.ts tests/editor-static.test.mjs
git commit -m "feat(particulas): comando WebSocket 'particulas' (play/stop/emit/clear/info)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 11: sonda de GC e bench de performance

**Files:**
- Create: `tests/claude-test-particulas-gc.ts`
- Create: `bench/claude-bench-particulas.ts`

**Interfaces:**
- Nenhuma nova; consome `ParticleSystem`/`sim.ts` das tasks anteriores.

- [ ] **Step 1: Write the failing test**

`tests/claude-test-particulas-gc.ts` (molde de `tests/claude-test-audio-gc.ts`): cria um `ParticleSystem` com `maxParticles=10000`, `play()`, roda um "aquecimento" de 200 quadros para o pool ficar cheio, marca `RTS_GC_DEBUG=1`, roda 200 000 iterações de `update(1/60)` (loop=true, para nunca esvaziar o pool) chamando também `drawSelf` a cada iteração (o caminho completo de simulação+preenchimento), e confere 0 coletas entre os marcadores.

```
RTS_GC_DEBUG=1 $RTS run tests/claude-test-particulas-gc.ts
```
Esperado (antes de qualquer ajuste): pode falhar se algum `new Float64Array`/`new Array` escapou do caminho por quadro — nesse caso, o teste aponta exatamente qual iteração alocou.

- [ ] **Step 2: Ajuste, se necessário**

Se a sonda apontar alocação, o candidato mais provável é `const vento = new Float64Array(3)` dentro de `update` (Task 5) — mover para um campo de módulo/instância reaproveitado, como `descBuf`/`saidaBuf` já são.

- [ ] **Step 3: Bench**

`bench/claude-bench-particulas.ts` (molde de `bench/claude-bench-audio.ts`): mede `update`+`drawSelf` (sem o tempo de GPU) para 1 000, 5 000 e 10 000 partículas vivas, imprime µs por quadro, e falha (saída não-zero) se 10 000 partículas passarem de 1 ms.

```
node --expose-gc bench/claude-bench-particulas.ts
```

- [ ] **Step 4: Frame do editor antes/depois**

```
node bench/claude-frame-bench.mjs
```
Rodar ANTES de qualquer cena com partículas carregada e DEPOIS de abrir uma cena com os 4 presets ativos e a câmera olhando para eles, na MESMA sessão, e registrar os dois números no commit.

- [ ] **Step 5: Commit**

```
git add tests/claude-test-particulas-gc.ts bench/claude-bench-particulas.ts
git commit -m "test(particulas): sonda de GC (200k, 10k partículas) e bench de performance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 12: docs (`docs/components.md`, `CLAUDE.md`)

**Files:**
- Modify: `docs/components.md` (seção "Partículas": campos, presets, comando WS)
- Modify: `CLAUDE.md` (seção "Partículas", no molde da seção "Áudio" — verificação por número via `particulas info`, custo por quadro)

**Interfaces:** nenhuma; documentação.

- [ ] **Step 1: Escrever a seção em `docs/components.md`**

Cobrir: os campos do Main/Emission/Shape/Renderer, os métodos (`play/stop/pause/emit/clear`), os 4 presets e onde ficam (`object_presets.ts`), o comando WS, e o portão de performance (10k partículas ≤ 1ms, 0 GC em 200k iterações).

- [ ] **Step 2: Escrever a seção em `CLAUDE.md`**

No molde exato da seção "Áudio" existente:

```markdown
## Partículas

- A IA verifica o efeito sem olhar a janela: `particulas <obj> info` (vivas, max, tocando, t, bbox). Testes sem janela rodam a simulação pura, sem depender de `drawParticles` nativo (fallback registrado em `logWarn` uma vez).
- Caminhos por quadro (`ParticleSystem.update`, `drawSelf`, `emitirN`, `atualizarVidas`, `aplicarVelocidade`) seguem "Custo por quadro": pool em `Float64Array` (SoA), buffer de saída para o nativo reaproveitado, reciclagem de partícula morta por lista de livres (sem compactar), nada de `AudioClip.load`-like sem cache (aqui, a textura via `resolveMaterialTexture`, já cacheada).
- Presets do menu Criar (`Fogo`, `Fumaça`, `Faíscas`, `Chuva`) ficam em `src/editor/object_presets.ts`, com uma fábrica `componentes()` que devolve instâncias NOVAS a cada criação (nunca a mesma instância reaproveitada entre dois objetos).
```

- [ ] **Step 3: Commit**

```
git add docs/components.md CLAUDE.md
git commit -m "docs(particulas): seção de componentes e regra do CLAUDE.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016XrJPQnZVwHFFbp8GxY6vi"
```

---

### Task 13: verificação final (janela real, WS, bench, docs)

**Files:** nenhum arquivo novo — só execução e checagem.

- [ ] **Step 1: Regressão completa**

```
npm run check:params
npm run components && npm run test:components && npm run components:check
npm run icons:check
node --test tests/editor-static.test.mjs
$RTS run tests/test_particulas_emissao.ts
$RTS run tests/test_particulas_forma.ts
$RTS run tests/test_particulas_curvas.ts
$RTS run tests/test_particulas_fallback.ts
$RTS run tests/test_particulas_source.ts
$RTS run tests/test_particulas_frustum.ts
$RTS run tests/test_editor_particulas_presets.ts
$RTS run tests/test_particulas_inspector.ts
$RTS run tests/test_particulas_previa.ts
$RTS run tests/test_particulas_ws.ts
RTS_GC_DEBUG=1 $RTS run tests/claude-test-particulas-gc.ts
node --expose-gc bench/claude-bench-particulas.ts
```
Todos verdes/dentro do portão (10 000 partículas ≤ 1 ms).

- [ ] **Step 2: Janela real, sem depender do humano**

Abrir `examples/ui_fixture.exe main.ts` (WS `ws://127.0.0.1:7777`). Pela IA (sem pedir ao humano, no espírito de "audio escuta ... sonda" para o áudio — aqui a verificação é por número, não por escuta):
```
particulas Fogo play
particulas Fogo info
particulas Fogo emit 500
particulas Fogo info
particulas Fogo clear
particulas Fogo info
```
Conferir que `vivas` sobe depois de `play`/`emit`, cai para 0 depois de `clear`, e o `bbox` do preset Fogo (cone estreito) tem menor largura em X/Z que altura em Y.

- [ ] **Step 3: Captura da janela do editor**

Selecionar cada um dos 4 presets no editor real e capturar a janela (a mesma rotina de captura que os outros pacotes de editor usam para prova visual — se não houver uma automatizada, uma captura manual anexada ao PR). Confirmar visualmente: Fogo laranja subindo (aditivo, sem escurecer), Fumaça cinza dispersando, Faíscas explodindo uma vez (`loop=false`), Chuva caindo com gravidade.

- [ ] **Step 4: Medir o frame do editor com a cena de partículas**

```
node bench/claude-frame-bench.mjs
```
Antes de abrir a cena de teste e depois, na mesma sessão (RTS_VSYNC=0), registrando os dois números.

- [ ] **Step 5: Relatório final**

Resumir: portão de performance atingido (número exato de µs para 10k partículas), 0 coletas de GC, os 4 presets funcionando na janela real, o comando WS `particulas` respondendo por número, e o PR do repo `rts` (Task 1) mesclado ou ainda em CI — se ainda em CI, registrar isso e não bloquear o restante da entrega nele (o fallback da Task 4 já cobre o binário antigo).
