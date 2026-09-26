# Luzes, céu, câmera e extensão por script — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luzes na cena (até 8 por frame: direcional, pontual e spot), céu com parâmetros, neblina, câmera com near/far/ortográfica/viewport/fundo e várias câmeras por frame; e pontos de extensão por script (`@editor/api`, `registerCommand`, ganchos, `Gizmos`, `@menuItem`, `onInspectorGUI`, `@editorOnly`) usados pelos pacotes `luz/`, `camera/` e `ambiente/`.

**Architecture:** O runtime `rts` ganha só o que um script não faz: o uniform de luzes/céu/neblina, o shader, a fila de vistas (uma por câmera, com viewport e fundo) e a projeção com near/far/ortográfica. O rts-game ganha um núcleo mínimo (`Light`, `Camera` ampliada, `Ambiente` na cena, coleta sem alocação) e os pontos de extensão; gizmos, menus, controles de câmera, janela do Ambiente e comandos do WebSocket são scripts de pacote em `assets/pacotes/`, com a mesma API que um dev usaria.

**Tech Stack:** TypeScript compilado pelo RTS (`rts.exe`), Rust (crates `rts-egui` e `rts-ui` do repo `rts`, wgpu 29 + WGSL, naga 29 só nos testes), Node 20 (`tools/generate-components.mjs`, `node --test`).

**Spec:** docs/superpowers/specs/2026-09-26-luzes-ceu-camera-extensao-design.md

## Global Constraints

- Só muda o motor onde um script não consegue fazer; o resto vira script de pacote em `assets/pacotes/` (spec §1). Se um pacote precisar de algo, o motor ganha o ponto de extensão, não o recurso.
- RTS: função ou método com 5+ parâmetros escalares ALOCA por chamada mesmo sem valor padrão (medido). Caminho quente: ≤ 4 parâmetros, vetores em `Float64Array`, forma de retorno único. Nenhuma função com 5+ parâmetros tem valor padrão (`npm run check:params`).
- RTS: método de classe que lê um nome de módulo falha com "not defined" quando o construtor não atribui campo + a instância é criada no topo do próprio módulo + o módulo chamador não importa o nome. Evite essa forma: construtores sempre atribuem campos e nenhuma instância com métodos que leem nomes de módulo nasce no topo do próprio módulo (use função livre ou estado numa classe sem métodos).
- Sem alocação por frame nos caminhos de render/editor: buffers criados uma vez e reaproveitados; objetos de opções dos nativos são objetos de módulo mutados, não literais por chamada. Medir com `RTS_GC_DEBUG=1` contando linhas `rts-gc` só entre marcadores `FASE` (1.000 e 10.000 frames dão a mesma contagem).
- Imports por alias (`@engine/...`, `@editor/...`, `@compat/...`); sem ciclos de import (use `import type`). O RTS não linka ciclos. `@editor/api` só importa tipos, o logger e `control/builtin_commands.ts` (um componente de pacote pode importá-lo sem fechar ciclo pelo registro gerado).
- CLAUDE.md: medidas, rótulos, cores e textos de UI em `src/editor/ui_config.ts`; sem números mágicos; as mesmas constantes para desenho e detecção de mouse; controles como GameObjects da `UIScene` reutilizados, com IDs únicos na janela.
- CLAUDE.md: componentes com construtor sem argumentos; catálogo gerado por `npm run components` (+ `npm run test:components`, `npm run components:check`), com a saída gerada versionada; `componentToData` para salvar/duplicar/Rodar; `scene.createGameObject` para objetos novos; presets do menu Criar não copiados (o preset "Câmera" sai de `object_presets.ts` quando o pacote `camera/` passa a criá-la).
- Convenção do renderer: eixo local X → (cos ry, −sin ry); câmera `fwd = (sin yaw·cos p, sin p, cos yaw·cos p)` com yaw = `wry` e pitch = `wrx`, pitch > 0 olha para cima; quaternions `[x, y, z, w]`. A direção de uma `Light` é o +Z local nessa mesma convenção.
- Todo recurso novo é alcançável pelo WebSocket de controle: comandos embutidos em `src/editor/control/commands/*.ts` + `dispatch.ts`, ou `registerCommand` a partir dos pacotes.
- Runtime: worktree `C:\Users\nexga\Documents\GitHub\rts-uv-mundo`, branch NOVO `feat/scene3d-luzes-ceu` criado a partir de `feat/scene3d-quaternion`; testes em `crates/rts-egui/src/frame/scene3d/tests.rs`; builds `cargo build --release --bin rts`, `cargo build --release -p rts-host --example ui_fixture --features ui`, `cargo build --release -p rts-runtime`. NUNCA rodar `cargo fmt`.
- rts-game: worktree `C:\Users\nexga\Documents\GitHub\rts-game\build\main-integration`; criar o branch `feat/luzes-ceu-camera` a partir do HEAD atual (`c14bb4a`, em `feat/ossos-animacao`).
- Testes TS sem janela, a partir da raiz do worktree do rts-game: `/c/Users/nexga/Documents/GitHub/rts-uv-mundo/target/release/rts.exe run tests/<arquivo>.ts` (abaixo, `$RTS`). Editor real: `/c/Users/nexga/Documents/GitHub/rts-uv-mundo/target/release/examples/ui_fixture.exe main.ts` (WS `ws://127.0.0.1:7777`, `python tools/ws_client.py "cmd" ...`).
- Captura de janela só da janela, via PrintWindow: `powershell -File .superpowers/sdd/2026-09-25-ossos-e-animacao/captura.ps1 -Saida <png> -Titulo "Engine RTS"`.
- Mensagens de commit terminam com as linhas de atribuição da sessão (Co-Authored-By e Claude-Session).

## Review Focus

1. **Cenas antigas com duas ou mais câmeras de viewport cheia e mesma profundidade.** Hoje só a Main aparece; com várias câmeras por frame todas desenham. A ordem desempata com a Main por último, então a imagem continua a da Main. Teste na Task 4 (`coletarCameras` com duas câmeras de profundidade 0 → a Main é a última vista).
2. **`Light`/`Camera` como filhas de pai girado ou inativo.** Pose de mundo (`wx…`, `wry`, `wrx`), exclusão por ancestral inativo e "Alinhar com a vista" numa câmera filha convertendo mundo → local. Testes nas Tasks 3 (filha de inativo fica fora), 4 (câmera filha de pai com yaw 90° tem `fwd` girado) e 8 (Alinhar com a vista numa câmera filha).
3. **Bloco `"ambiente"` inválido no JSON da cena** (cor com 2 números, texto no lugar de número, densidade negativa, modo desconhecido). A cena é recusada ANTES de mexer na cena atual, e cena sem bloco dá o visual de hoje. Teste na Task 5.
4. **`registerCommand` com nome de comando embutido, nome duplicado, função que lança ou que responde sem `[`.** Registro recusado; `[erro] <nome>: <mensagem>`; prefixo `[ok]` automático; `muta = false` não empilha Desfazer. Teste na Task 6.
5. **Viewport degenerada** (w = 0, x + w > 1, NaN) e `tamanhoOrto`/`near` zero. O Rust prende o retângulo e pula a vista vazia, e o `onValidate` da Camera prende os campos. Testes nas Tasks 1 (`viewport_px`, `clamp_rect`) e 4 (`onValidate` + `screenPointToRay` finito).

## Decisões deste plano (o que o spec deixou aberto ou foi ajustado)

- **`setSky` carrega também a luz ambiente**: 22 floats, e não 17. O bloco `luzAmbiente` do Ambiente muda junto com o céu e pelo mesmo contador. O `setLight` antigo continua sendo o ambiente quando `n = 0`.
- **`setFog(win, { r, g, b, densidade })`**: o leitor de opções do runtime só lê números, então a cor chega como três chaves.
- **Vistas**: cada vista começa com `setViewport` (o primeiro do frame só define o retângulo da vista corrente); sem nenhuma chamada, há uma vista cheia, como hoje. `setViewport` ganha `limpar` (0 = fundo "nada": só limpa a profundidade). O fundo ("ceu"/"cor") continua em `setSkybox`/`setClearColor` e passa a valer por vista. Coordenadas em fração da janela com y a partir do TOPO (a convenção de tela do motor); o campo `viewportY` da Camera segue essa convenção.
- **Culling com várias vistas**: `drawSceneObjects` pula o teste de frustum quando `tanH < 0` (sentinela), porque a fila de desenho é única para todas as vistas; com uma câmera o culling continua igual.
- **Gizmos de Light e Camera**: `Light` e `Camera` são do núcleo, então o pacote registra um desenhador por tipo (`registerGizmo("Light", fn)`), que usa o mesmo `Gizmos` de `onDrawGizmos`.
- **`onInspectorGUI` é detectado pelo uso**: o Inspector chama o método de todo componente aberto e, se nenhum controle for desenhado, cai na lista automática. Não há flag no gerador. `InspectorUI` também tem `toggle`, `alterar()` (Desfazer) e `alinharComVista(obj)`. `dropdown` é um botão que alterna a opção. `color` é um campo "#RRGGBB". `slider` é a barra arrastável ("timeline").
- **Ambiente no editor**: vale a segunda opção do spec, o item `Janela/Ambiente` do pacote chama `Editor.inspect(...)`. O Inspector passa a mostrar um objeto oculto da sua UIScene com o `AmbienteInspector` (`@componentIgnore`), até a seleção mudar.
- **`@editorOnly` no build**: o gerador escreve `components.ts` (editor) e `components_game.ts` (sem as classes `@editorOnly`). O build do jogo compila `tools/game-build/entry.ts`, cujo `tsconfig.json` troca o alias exato `@engine/generated/components`. Os arquivos `@editorOnly` são importados só por `@engine/generated/editor_extensions`, que só o `main.ts` importa.
- **Comandos de pacote com consulta**: `luz`, `ambiente` e `camera` são registrados com `muta = false` quando têm subcomandos de consulta (`camera ray`, por exemplo); os subcomandos que mutam chamam `Editor.snapshot(...)` antes de mudar a cena.

---

### Task 1: Matemática do runtime — luzes, céu, neblina, vistas e projeção (repo `rts`)

**Files:**
- Create: `C:\Users\nexga\Documents\GitHub\rts-uv-mundo\crates\rts-egui\src\frame\scene3d\lights.rs`
- Create: `...\crates\rts-egui\src\frame\scene3d\views.rs`
- Modify: `...\crates\rts-egui\src\frame\scene3d\math.rs` (struct `Cam3D` linhas 247-255; `view_proj` 257-284; nova `CamSpec`/`view_proj_spec`/`ortho_lh`)
- Modify: `...\crates\rts-egui\src\frame\scene3d\mod.rs` (declarações `mod` nas linhas 35-40 e `pub use` na 43)
- Test: `...\crates\rts-egui\src\frame\scene3d\tests.rs`

**Interfaces:**
- Produces (Rust, `crate::frame::scene3d`):
  - `lights::{MAX_LIGHTS=8, LIGHT_IN=16, LIGHT_GPU=16, SKY_IN=22, ENV_FLOATS=160, ENV_BYTES=640}`
  - `lights::pack_lights(src: &[f64], n: usize) -> PackedLights` (`gpu: [f32; 128]`, `n: u32`, `shadow: i32`)
  - `lights::attenuation(d: f32, range: f32) -> f32`, `lights::spot_factor(cos_ang: f32, cos_in: f32, cos_out: f32) -> f32`, `lights::fog_factor(dist: f32, density: f32) -> f32`, `lights::fog_params(r: f64, g: f64, b: f64, d: f64) -> [f32; 4]`
  - `lights::SkyParams::{padrao(), from_f64(&[f64])}`, `lights::env_floats(&PackedLights, &SkyParams, has_pano: bool, fog: [f32; 4]) -> [f32; 160]`
  - `views::{MAX_VIEWS=8, CAM_STRIDE=256, CAM_FLOATS=64, FULL}`, `views::Fundo::{Ceu, Cor([f32;4])}`, `views::View`, `views::ViewQueue::{new, set_camera, set_fundo, skybox, set_viewport, len, get, end_frame}`, `views::clamp_rect`, `views::viewport_px(rect, w, h) -> Option<[u32; 4]>`, `views::cam_floats(&View, light: [f32;4], light_vp: &[f32;16], water: f32) -> [f32; 64]`
  - `math::CamSpec`, `math::view_proj_spec(&CamSpec) -> Cam3D`; `Cam3D` passa a ser `Copy` e ganha `ortho`, `half_h`, `half_w`.

- [ ] **Step 1: Write the failing test**

Antes: `cd /c/Users/nexga/Documents/GitHub/rts-uv-mundo && git switch feat/scene3d-quaternion && git switch -c feat/scene3d-luzes-ceu`.

Acrescentar ao fim de `tests.rs`:

```rust
    use super::lights::{attenuation, spot_factor, fog_factor, fog_params, pack_lights, SkyParams, env_floats,
        MAX_LIGHTS, LIGHT_IN, LIGHT_GPU, SKY_IN, ENV_FLOATS};
    use super::views::{ViewQueue, Fundo, FULL, MAX_VIEWS, clamp_rect, viewport_px, cam_floats};
    use super::math::{CamSpec, view_proj_spec};

    fn luz(tipo: f64, pos: [f64; 3], dir: [f64; 3], sombra: f64) -> [f64; LIGHT_IN] {
        [tipo, pos[0], pos[1], pos[2], dir[0], dir[1], dir[2], 1.0, 0.5, 0.25, 2.0, 7.0, 0.9, 0.8, sombra, 0.0]
    }
    fn spec(ortho: bool) -> CamSpec {
        CamSpec { pos: [0.0, 0.0, 0.0], yaw: 0.0, pitch: 0.0, fov_y: 1.0, aspect: 2.0, near: 0.1, far: 100.0, ortho, ortho_size: 5.0 }
    }

    #[test]
    fn atenuacao_nos_pontos_chave() {
        assert_eq!(attenuation(0.0, 10.0), 1.0);
        assert!((attenuation(5.0, 10.0) - 0.5625).abs() < 1e-6, "(1 - 0,25)² = 0,5625");
        assert_eq!(attenuation(10.0, 10.0), 0.0);
        assert_eq!(attenuation(12.0, 10.0), 0.0, "além do alcance é zero, não negativo");
        assert_eq!(attenuation(1.0, 0.0), 0.0, "alcance 0 apaga a luz");
    }

    #[test]
    fn spot_nos_cones() {
        assert_eq!(spot_factor(0.95, 0.9, 0.8), 1.0);
        assert_eq!(spot_factor(0.9, 0.9, 0.8), 1.0);
        assert_eq!(spot_factor(0.8, 0.9, 0.8), 0.0);
        assert_eq!(spot_factor(0.7, 0.9, 0.8), 0.0);
        assert!((spot_factor(0.85, 0.9, 0.8) - 0.5).abs() < 1e-6, "smoothstep no meio = 0,5");
        assert_eq!(spot_factor(0.81, 0.8, 0.8), 1.0, "cones iguais viram degrau");
        assert_eq!(spot_factor(0.79, 0.8, 0.8), 0.0);
    }

    #[test]
    fn neblina_exponencial() {
        assert_eq!(fog_factor(10.0, 0.0), 1.0, "densidade 0 desliga");
        assert!((fog_factor(10.0, 0.1) - (-1.0f32).exp()).abs() < 1e-6);
        assert_eq!(fog_params(0.5, f64::NAN, 2.0, -1.0), [0.5, 0.0, 2.0, 0.0], "NaN vira 0 e densidade negativa vira 0");
    }

    #[test]
    fn pack_lights_corta_em_8_e_acha_a_sombra() {
        let mut src = Vec::new();
        src.extend_from_slice(&luz(1.0, [1.0, 2.0, 3.0], [0.0, 0.0, 1.0], 1.0)); // pontual com sombra: ignorada
        src.extend_from_slice(&luz(0.0, [0.0; 3], [0.0, -1.0, 0.0], 0.0));      // direcional sem sombra
        src.extend_from_slice(&luz(0.0, [0.0; 3], [0.0, -2.0, 0.0], 1.0));      // direcional COM sombra
        for k in 0..7 { src.extend_from_slice(&luz(1.0, [k as f64, 0.0, 0.0], [0.0, 0.0, 1.0], 0.0)); }
        let p = pack_lights(&src, 10);
        assert_eq!(p.n, MAX_LIGHTS as u32);
        assert_eq!(p.shadow, 2, "a primeira DIRECIONAL com sombra");
        let g = &p.gpu[2 * LIGHT_GPU..3 * LIGHT_GPU];
        assert_eq!(g[3], 0.0, "tipo em a.w");
        assert_eq!([g[4], g[5], g[6]], [0.0, -1.0, 0.0], "direção normalizada em b.xyz");
        assert_eq!(g[7], 7.0, "alcance em b.w");
        assert_eq!([g[8], g[9], g[10], g[11]], [1.0, 0.5, 0.25, 2.0], "cor em c.rgb, intensidade em c.w");
        assert_eq!([g[12], g[13], g[14]], [0.9, 0.8, 1.0], "cones e sombra em d");
        let g0 = &p.gpu[0..LIGHT_GPU];
        assert_eq!([g0[0], g0[1], g0[2], g0[3]], [1.0, 2.0, 3.0, 1.0], "posição em a.xyz");
    }

    #[test]
    fn pack_lights_sem_sombra_buffer_curto_e_valores_ruins() {
        let mut src = Vec::new();
        let mut l = luz(2.0, [0.0; 3], [0.0, 0.0, 0.0], 0.0);
        l[10] = f64::NAN; l[12] = 0.7; l[13] = 0.95;
        src.extend_from_slice(&l);
        src.extend_from_slice(&[0.0; 4]); // sobra que não fecha uma luz
        let p = pack_lights(&src, 3);
        assert_eq!(p.n, 1, "n preso ao que o buffer carrega");
        assert_eq!(p.shadow, -1);
        let g = &p.gpu[0..LIGHT_GPU];
        assert_eq!([g[4], g[5], g[6]], [0.0, 0.0, 1.0], "direção nula vira +Z");
        assert_eq!(g[11], 1.0, "intensidade NaN vira 1");
        assert_eq!([g[12], g[13]], [0.95, 0.7], "cone interno sempre >= externo");
        assert_eq!(pack_lights(&[], 5).n, 0);
    }

    #[test]
    fn ceu_padrao_curto_e_fora_da_faixa() {
        assert_eq!(SkyParams::from_f64(&[]), SkyParams::padrao());
        let s = SkyParams::from_f64(&[1.0, 0.1, 0.2, 0.3]);
        assert_eq!(s.modo, 1.0);
        assert_eq!(s.topo, [0.1, 0.2, 0.3]);
        assert_eq!(s.horizonte, SkyParams::padrao().horizonte, "o que falta fica no padrão");
        assert_eq!(SkyParams::from_f64(&[7.0]).modo, 3.0, "modo preso em 0..3");
        assert_eq!(SkyParams::from_f64(&[f64::NAN]).modo, 0.0, "NaN vira o padrão");
        let mut todo = [0.0f64; SKY_IN];
        todo[0] = 3.0; todo[16] = 5.0; todo[17] = 2.0; todo[21] = 0.4;
        todo[10] = 0.0; todo[11] = 0.0; todo[12] = 0.0;
        let s2 = SkyParams::from_f64(&todo);
        assert_eq!(s2.textura, 5);
        assert_eq!(s2.amb_modo, 2.0);
        assert_eq!(s2.amb_intensidade, 0.4);
        assert!((s2.sol[1] + 0.9045).abs() < 1e-3, "sol nulo cai no sol padrão");
    }

    #[test]
    fn env_floats_layout() {
        let mut src = Vec::new();
        src.extend_from_slice(&luz(0.0, [0.0; 3], [0.0, -1.0, 0.0], 1.0));
        let p = pack_lights(&src, 1);
        let mut sky = SkyParams::padrao();
        sky.modo = 1.0; sky.topo = [0.1, 0.2, 0.3]; sky.amb_modo = 1.0; sky.amb_intensidade = 0.3;
        let e = env_floats(&p, &sky, true, [0.5, 0.6, 0.7, 0.02]);
        assert_eq!(e.len(), ENV_FLOATS);
        assert_eq!([e[0], e[1], e[2], e[3]], [1.0, 0.0, 1.0, 0.3], "info: n, sombra, modo e intensidade do ambiente");
        assert_eq!(e[8], 1.0, "sky0.x = modo");
        assert_eq!([e[12], e[13], e[14]], [0.1, 0.2, 0.3], "topo");
        assert_eq!(e[27], 1.0, "sun_dir.w = tem panorama");
        assert_eq!([e[28], e[29], e[30], e[31]], [0.5, 0.6, 0.7, 0.02], "neblina");
        assert_eq!(&e[32..48], &p.gpu[0..16], "luzes a partir do float 32");
    }

    #[test]
    fn perspectiva_respeita_near_e_far() {
        let mut s = spec(false);
        s.near = 0.5; s.far = 50.0;
        let cam = view_proj_spec(&s);
        let perto = apply(&cam.view_proj, [0.0, 0.0, 0.5]);
        let longe = apply(&cam.view_proj, [0.0, 0.0, 50.0]);
        assert!((perto[2] / perto[3]).abs() < 1e-5, "near → z = 0");
        assert!((longe[2] / longe[3] - 1.0).abs() < 1e-5, "far → z = 1");
        assert_eq!(cam.ortho, 0.0);
    }

    #[test]
    fn ortografica_mapeia_o_tamanho() {
        let cam = view_proj_spec(&spec(true));
        let c = apply(&cam.view_proj, [10.0, 5.0, 20.0]);
        assert!((c[3] - 1.0).abs() < 1e-6, "ortográfica: w = 1");
        assert!((c[0] - 1.0).abs() < 1e-5 && (c[1] - 1.0).abs() < 1e-5, "meia altura 5, meia largura 10 = borda");
        assert!((c[2] - (20.0 - 0.1) / (100.0 - 0.1)).abs() < 1e-5, "profundidade linear");
        assert_eq!([cam.ortho, cam.half_h, cam.half_w], [1.0, 5.0, 10.0]);
    }

    #[test]
    fn view_proj_antiga_e_igual_a_nova() {
        let a = view_proj(1.0, 2.0, 3.0, 0.3, -0.2, 1.0, 1.5);
        let b = view_proj_spec(&CamSpec { pos: [1.0, 2.0, 3.0], yaw: 0.3, pitch: -0.2, fov_y: 1.0, aspect: 1.5,
            near: 0.1, far: 500.0, ortho: false, ortho_size: 5.0 });
        assert_eq!(a.view_proj, b.view_proj);
        assert_eq!(a.fwd, b.fwd);
    }

    #[test]
    fn viewport_em_pixels() {
        assert_eq!(viewport_px([0.5, 0.0, 0.5, 1.0], 1280, 720), Some([640, 0, 640, 720]));
        assert_eq!(viewport_px([0.0, 0.0, 0.0, 1.0], 1280, 720), None, "largura 0 = sem vista");
        assert_eq!(clamp_rect([0.9, 0.0, 0.5, 1.0]), [0.9, 0.0, 0.1, 1.0], "x + w preso em 1");
        assert_eq!(clamp_rect([f32::NAN, -1.0, 2.0, 0.5]), [0.0, 0.0, 1.0, 0.5]);
        assert_eq!(viewport_px(clamp_rect([0.9, 0.0, 0.5, 1.0]), 1280, 720), Some([1152, 0, 128, 720]));
    }

    #[test]
    fn fila_de_vistas() {
        let a = view_proj(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0);
        let b = view_proj(2.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0);
        let mut q = ViewQueue::new(a);
        assert_eq!(q.len(), 1, "sem setViewport: uma vista cheia");
        assert_eq!(q.get(0).rect, FULL);
        q.set_viewport([0.0, 0.0, 0.5, 1.0], true); q.set_camera(a);
        q.set_viewport([0.5, 0.0, 0.5, 1.0], false); q.set_camera(b);
        assert_eq!(q.len(), 2);
        assert_eq!(q.get(0).rect, [0.0, 0.0, 0.5, 1.0]);
        assert_eq!(q.get(0).cam.cam_pos, [1.0, 0.0, 0.0]);
        assert!(!q.get(1).limpar, "limpar = 0 é fundo 'nada'");
        assert_eq!(q.get(1).cam.cam_pos, [2.0, 0.0, 0.0]);
        q.end_frame();
        assert_eq!(q.len(), 1);
        assert_eq!(q.get(0).rect, FULL, "o frame seguinte volta à vista cheia");
        assert!(q.get(0).limpar);
        assert_eq!(q.get(0).cam.cam_pos, [2.0, 0.0, 0.0], "a câmera persiste entre frames, como hoje");
        for _ in 0..(MAX_VIEWS + 3) { q.set_viewport([0.0, 0.0, 1.0, 1.0], true); }
        assert_eq!(q.len(), MAX_VIEWS, "teto de vistas");
    }

    #[test]
    fn fundo_compativel_com_clear_color_e_skybox() {
        let mut q = ViewQueue::new(view_proj(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0));
        assert_eq!(q.get(0).fundo, Fundo::Ceu, "padrão = céu (o de hoje)");
        q.set_fundo(Fundo::Cor([0.1, 0.2, 0.3, 1.0]));
        q.skybox(false);
        assert_eq!(q.get(0).fundo, Fundo::Cor([0.1, 0.2, 0.3, 1.0]), "setSkybox(0) não desfaz a cor, como hoje");
        q.set_viewport([0.0, 0.0, 0.5, 1.0], true);
        q.set_viewport([0.5, 0.0, 0.5, 1.0], true);
        assert_eq!(q.get(1).fundo, Fundo::Cor([0.1, 0.2, 0.3, 1.0]), "o fundo passa para a vista seguinte");
        q.skybox(true);
        assert_eq!(q.get(1).fundo, Fundo::Ceu);
    }

    #[test]
    fn cam_floats_layout() {
        let mut q = ViewQueue::new(view_proj_spec(&spec(true)));
        q.set_fundo(Fundo::Cor([0.1, 0.2, 0.3, 1.0]));
        let lvp = [2.0f32; 16];
        let f = cam_floats(q.get(0), [7.0, 8.0, 9.0, 0.25], &lvp, 0.4);
        assert_eq!([f[16], f[17], f[18], f[19]], [7.0, 8.0, 9.0, 0.25], "luz legada");
        assert_eq!(&f[36..52], &lvp[..], "light_vp");
        assert_eq!(f[52], 0.4, "água");
        assert_eq!([f[56], f[57], f[58], f[59]], [0.1, 0.2, 0.3, 1.0], "fundo chapado");
        assert_eq!([f[60], f[61], f[62]], [1.0, 5.0, 10.0], "ortográfica e meias extensões");
        q.skybox(true);
        assert_eq!(cam_floats(q.get(0), [0.0; 4], &lvp, 0.0)[59], 0.0, "céu: sem fundo chapado");
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Users/nexga/Documents/GitHub/rts-uv-mundo && cargo test --release -p rts-egui --lib scene3d`
Expected: FAIL de compilação — `unresolved import super::lights`, `super::views`, `CamSpec`, `view_proj_spec`.

- [ ] **Step 3: Implementation**

`mod.rs` (linhas 35-43): acrescentar `mod lights;` e `mod views;` junto dos outros `mod` e trocar a linha 43 por `pub use math::{Cam3D, CamSpec, model_matrix, model_matrix_quat, view_proj, view_proj_lookat, view_proj_spec};`.

`math.rs`: `Cam3D` ganha `#[derive(Clone, Copy, Debug)]` e três campos, e `view_proj` vira um invólucro da nova função:

```rust
#[derive(Clone, Copy, Debug)]
pub struct Cam3D {
    pub view_proj: [f32; 16],
    pub cam_pos: [f32; 3],
    pub right: [f32; 3],
    pub up: [f32; 3],
    pub fwd: [f32; 3],
    pub tan_h: f32,
    pub tan_v: f32,
    /// 1 = ortográfica (o céu usa um raio só, `fwd`).
    pub ortho: f32,
    /// Meia altura e meia largura da vista ortográfica (0 na perspectiva).
    pub half_h: f32,
    pub half_w: f32,
}

/// Tudo o que `setCamera` descreve: pose de voo, lente e recorte.
#[derive(Clone, Copy, Debug)]
pub struct CamSpec {
    pub pos: [f32; 3],
    pub yaw: f32,
    pub pitch: f32,
    pub fov_y: f32,
    pub aspect: f32,
    pub near: f32,
    pub far: f32,
    pub ortho: bool,
    /// Meia altura da vista ortográfica, em unidades de mundo.
    pub ortho_size: f32,
}

/// Near mínimo e folga mínima entre near e far (evitam divisão por zero).
const NEAR_MIN: f32 = 1e-4;
const FAR_FOLGA: f32 = 1e-3;

pub fn view_proj_spec(s: &CamSpec) -> Cam3D {
    let (cyw, syw) = (s.yaw.cos(), s.yaw.sin());
    let (cpt, spt) = (s.pitch.cos(), s.pitch.sin());
    let right = [cyw, 0.0, -syw];
    let up = [-syw * spt, cpt, -cyw * spt];
    let fwd = [syw * cpt, spt, cyw * cpt];
    let [camx, camy, camz] = s.pos;
    let tx = -(right[0] * camx + right[1] * camy + right[2] * camz);
    let ty = -(up[0] * camx + up[1] * camy + up[2] * camz);
    let tz = -(fwd[0] * camx + fwd[1] * camy + fwd[2] * camz);
    let v = [
        right[0], up[0], fwd[0], 0.0,
        right[1], up[1], fwd[1], 0.0,
        right[2], up[2], fwd[2], 0.0,
        tx, ty, tz, 1.0,
    ];
    let near = if s.near.is_finite() { s.near.max(NEAR_MIN) } else { 0.1 };
    let far = if s.far.is_finite() { s.far.max(near + FAR_FOLGA) } else { 500.0 };
    let aspect = if s.aspect.is_finite() && s.aspect > 1e-6 { s.aspect } else { 1.0 };
    let (persp, tan_v) = perspective_lh(s.fov_y, aspect, near, far);
    let (p, ortho, half_h, half_w) = if s.ortho {
        let hh = if s.ortho_size.is_finite() { s.ortho_size.max(NEAR_MIN) } else { 5.0 };
        (ortho_lh(hh * aspect, hh, near, far), 1.0, hh, hh * aspect)
    } else {
        (persp, 0.0, 0.0, 0.0)
    };
    Cam3D { view_proj: mul(&p, &v), cam_pos: s.pos, right, up, fwd, tan_h: tan_v * aspect, tan_v, ortho, half_h, half_w }
}

pub fn view_proj(camx: f32, camy: f32, camz: f32, yaw: f32, pitch: f32, fov_y: f32, aspect: f32) -> Cam3D {
    view_proj_spec(&CamSpec { pos: [camx, camy, camz], yaw, pitch, fov_y, aspect, near: 0.1, far: 500.0, ortho: false, ortho_size: 5.0 })
}

/// Projeção ortográfica left-handed, depth 0..1 (wgpu), column-major.
fn ortho_lh(half_w: f32, half_h: f32, near: f32, far: f32) -> [f32; 16] {
    let dz = 1.0 / (far - near);
    [
        1.0 / half_w, 0.0, 0.0, 0.0,
        0.0, 1.0 / half_h, 0.0, 0.0,
        0.0, 0.0, dz, 0.0,
        0.0, 0.0, -near * dz, 1.0,
    ]
}
```

Em `view_proj_lookat` (linha 330), completar o literal de `Cam3D` com `ortho: 0.0, half_h: 0.0, half_w: 0.0`.

`lights.rs`:

```rust
//! Luzes, céu e neblina do scene pass: o formato que o TS envia
//! (`setLights`/`setSky`/`setFog`) e o que o uniform `Env` do shader carrega.
//!
//! Aritmética pura, testável sem GPU. `attenuation`, `spot_factor` e
//! `fog_factor` são o CONTRATO do shader: `shader.rs` repete a mesma conta em
//! WGSL, e os testes fixam os números.
#![cfg_attr(not(test), allow(dead_code))] // ligado ao render na Task 2

pub const MAX_LIGHTS: usize = 8;
/// Floats por luz no buffer do TS: tipo, pos(3), dir(3), cor(3), intensidade,
/// alcance, cos interno, cos externo, sombra, reserva.
pub const LIGHT_IN: usize = 16;
/// Floats por luz no uniform: a (pos, tipo), b (dir, alcance), c (cor,
/// intensidade), d (cos interno, cos externo, sombra, 0).
pub const LIGHT_GPU: usize = 16;
/// Floats do `setSky`: modo, topo(3), horizonte(3), chão(3), sol(3), tamanho
/// do disco, estrelas, exposição, id da textura, modo do ambiente, cor do
/// ambiente(3), intensidade do ambiente.
pub const SKY_IN: usize = 22;
/// Floats do uniform `Env`: 8 vec4 de cabeçalho + 8 luzes de 16.
pub const ENV_FLOATS: usize = 160;
pub const ENV_BYTES: u64 = (ENV_FLOATS * 4) as u64;
const ENV_LIGHTS_AT: usize = 32;

/// Direção padrão em que a luz do sol viaja (normalizada).
const SOL_PADRAO: [f32; 3] = [-0.3015113, -0.9045340, -0.3015113];
/// Faixa aceita para o tamanho angular do disco do sol, em radianos.
const SOL_MIN: f32 = 0.001;
const SOL_MAX: f32 = 0.5;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PackedLights {
    pub gpu: [f32; MAX_LIGHTS * LIGHT_GPU],
    pub n: u32,
    /// Índice da primeira direcional com sombra (-1 = nenhuma).
    pub shadow: i32,
}

impl PackedLights {
    pub fn empty() -> PackedLights {
        PackedLights { gpu: [0.0; MAX_LIGHTS * LIGHT_GPU], n: 0, shadow: -1 }
    }
}

fn num(v: f64, padrao: f32) -> f32 {
    if v.is_finite() { v as f32 } else { padrao }
}

fn unit(x: f32, y: f32, z: f32, padrao: [f32; 3]) -> [f32; 3] {
    let l = (x * x + y * y + z * z).sqrt();
    if l.is_finite() && l > 1e-6 { [x / l, y / l, z / l] } else { padrao }
}

/// Converte o buffer do TS no uniform. `n` fica preso a MAX_LIGHTS e ao que o
/// buffer realmente carrega; NaN vira o padrão de cada campo.
pub fn pack_lights(src: &[f64], n: usize) -> PackedLights {
    let mut out = PackedLights::empty();
    let n = n.min(MAX_LIGHTS).min(src.len() / LIGHT_IN);
    for i in 0..n {
        let s = &src[i * LIGHT_IN..(i + 1) * LIGHT_IN];
        let tipo = num(s[0], 0.0).round().clamp(0.0, 2.0);
        let dir = unit(num(s[4], 0.0), num(s[5], 0.0), num(s[6], 1.0), [0.0, 0.0, 1.0]);
        let mut c_in = num(s[12], 1.0).clamp(-1.0, 1.0);
        let mut c_out = num(s[13], 1.0).clamp(-1.0, 1.0);
        if c_in < c_out { std::mem::swap(&mut c_in, &mut c_out); }
        let sombra = num(s[14], 0.0) > 0.5;
        let g = &mut out.gpu[i * LIGHT_GPU..(i + 1) * LIGHT_GPU];
        g[0] = num(s[1], 0.0); g[1] = num(s[2], 0.0); g[2] = num(s[3], 0.0); g[3] = tipo;
        g[4] = dir[0]; g[5] = dir[1]; g[6] = dir[2]; g[7] = num(s[11], 0.0).max(0.0);
        g[8] = num(s[7], 1.0).max(0.0); g[9] = num(s[8], 1.0).max(0.0); g[10] = num(s[9], 1.0).max(0.0);
        g[11] = num(s[10], 1.0).max(0.0);
        g[12] = c_in; g[13] = c_out; g[14] = if sombra { 1.0 } else { 0.0 }; g[15] = 0.0;
        if out.shadow < 0 && tipo == 0.0 && sombra { out.shadow = i as i32; }
    }
    out.n = n as u32;
    out
}

/// `(1 - (d/alcance)²)²`, cortado em zero. Alcance <= 0 apaga a luz.
pub fn attenuation(d: f32, range: f32) -> f32 {
    if range <= 0.0 { return 0.0; }
    let r = d / range;
    let x = (1.0 - r * r).clamp(0.0, 1.0);
    x * x
}

/// Smoothstep entre o cosseno externo (0) e o interno (1); cones iguais = degrau.
pub fn spot_factor(cos_ang: f32, cos_in: f32, cos_out: f32) -> f32 {
    if cos_in - cos_out <= 1e-4 { return if cos_ang >= cos_out { 1.0 } else { 0.0 }; }
    let t = ((cos_ang - cos_out) / (cos_in - cos_out)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Fração da cor do objeto que sobra a `dist` com neblina exponencial.
pub fn fog_factor(dist: f32, density: f32) -> f32 {
    if density <= 0.0 { 1.0 } else { (-density * dist).exp() }
}

pub fn fog_params(r: f64, g: f64, b: f64, d: f64) -> [f32; 4] {
    [num(r, 0.0).max(0.0), num(g, 0.0).max(0.0), num(b, 0.0).max(0.0), num(d, 0.0).max(0.0)]
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SkyParams {
    /// 0 estrelas (o de hoje), 1 procedural, 2 cor, 3 panorama.
    pub modo: f32,
    pub topo: [f32; 3],
    pub horizonte: [f32; 3],
    pub chao: [f32; 3],
    /// Direção em que a luz do sol viaja (normalizada); o disco fica em -sol.
    pub sol: [f32; 3],
    pub tamanho_sol: f32,
    pub estrelas: f32,
    pub exposicao: f32,
    /// Id de `textureUpload` (>= 2) do panorama equirretangular; 0 = nenhum.
    pub textura: u64,
    /// 0 = escalar do `setLight` (legado), 1 = cor, 2 = céu (hemisférico).
    pub amb_modo: f32,
    pub amb_cor: [f32; 3],
    pub amb_intensidade: f32,
}

impl SkyParams {
    pub fn padrao() -> SkyParams {
        SkyParams {
            modo: 0.0, topo: [0.25, 0.45, 0.80], horizonte: [0.70, 0.80, 0.90], chao: [0.25, 0.23, 0.20],
            sol: SOL_PADRAO, tamanho_sol: 0.04, estrelas: 0.0, exposicao: 1.0, textura: 0,
            amb_modo: 0.0, amb_cor: [1.0, 1.0, 1.0], amb_intensidade: 0.25,
        }
    }

    /// Lê o buffer do `setSky`; o que faltar ou for NaN fica no padrão.
    pub fn from_f64(s: &[f64]) -> SkyParams {
        let p = SkyParams::padrao();
        let at = |i: usize, d: f32| -> f32 { if i < s.len() { num(s[i], d) } else { d } };
        let rgb = |i: usize, d: [f32; 3]| [at(i, d[0]).max(0.0), at(i + 1, d[1]).max(0.0), at(i + 2, d[2]).max(0.0)];
        let tex = at(16, 0.0);
        SkyParams {
            modo: at(0, p.modo).round().clamp(0.0, 3.0),
            topo: rgb(1, p.topo),
            horizonte: rgb(4, p.horizonte),
            chao: rgb(7, p.chao),
            sol: unit(at(10, p.sol[0]), at(11, p.sol[1]), at(12, p.sol[2]), SOL_PADRAO),
            tamanho_sol: at(13, p.tamanho_sol).clamp(SOL_MIN, SOL_MAX),
            estrelas: at(14, p.estrelas).max(0.0),
            exposicao: at(15, p.exposicao).max(0.0),
            textura: if tex >= 2.0 { tex as u64 } else { 0 },
            amb_modo: at(17, p.amb_modo).round().clamp(0.0, 2.0),
            amb_cor: rgb(18, p.amb_cor),
            amb_intensidade: at(21, p.amb_intensidade).max(0.0),
        }
    }
}

/// O uniform `Env` inteiro, na ordem do struct WGSL (ver o teste de layout).
pub fn env_floats(l: &PackedLights, sky: &SkyParams, has_pano: bool, fog: [f32; 4]) -> [f32; ENV_FLOATS] {
    let mut e = [0f32; ENV_FLOATS];
    e[0] = l.n as f32; e[1] = l.shadow as f32; e[2] = sky.amb_modo; e[3] = sky.amb_intensidade;
    e[4..7].copy_from_slice(&sky.amb_cor);
    e[8] = sky.modo; e[9] = sky.exposicao; e[10] = sky.estrelas; e[11] = sky.tamanho_sol;
    e[12..15].copy_from_slice(&sky.topo);
    e[16..19].copy_from_slice(&sky.horizonte);
    e[20..23].copy_from_slice(&sky.chao);
    e[24..27].copy_from_slice(&sky.sol);
    e[27] = if has_pano { 1.0 } else { 0.0 };
    e[28..32].copy_from_slice(&fog);
    e[ENV_LIGHTS_AT..].copy_from_slice(&l.gpu);
    e
}
```

`views.rs`:

```rust
//! Várias câmeras por frame. Cada vista é (câmera, retângulo em fração da
//! janela com y a partir do topo, fundo, limpar). `setViewport` COMEÇA uma
//! vista: a primeira chamada do frame só define o retângulo da vista corrente;
//! as seguintes guardam a anterior. Sem chamada nenhuma há uma vista cheia —
//! o comportamento de antes. Câmera e fundo persistem entre frames, como antes.
#![cfg_attr(not(test), allow(dead_code))] // ligado ao render na Task 2

use super::math::Cam3D;

pub const MAX_VIEWS: usize = 8;
/// Bytes de um slot de câmera no uniform (alinhamento de offset dinâmico).
pub const CAM_STRIDE: u64 = 256;
pub const CAM_FLOATS: usize = 64;
pub const FULL: [f32; 4] = [0.0, 0.0, 1.0, 1.0];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fundo {
    Ceu,
    Cor([f32; 4]),
}

#[derive(Clone, Copy, Debug)]
pub struct View {
    pub cam: Cam3D,
    pub rect: [f32; 4],
    pub fundo: Fundo,
    /// false = fundo "nada": não pinta o fundo, só limpa a profundidade.
    pub limpar: bool,
}

pub struct ViewQueue {
    done: Vec<View>,
    cur: View,
    aberta: bool,
}

impl ViewQueue {
    pub fn new(cam: Cam3D) -> ViewQueue {
        ViewQueue { done: Vec::with_capacity(MAX_VIEWS), cur: View { cam, rect: FULL, fundo: Fundo::Ceu, limpar: true }, aberta: false }
    }
    pub fn set_camera(&mut self, cam: Cam3D) { self.cur.cam = cam; }
    pub fn set_fundo(&mut self, f: Fundo) { self.cur.fundo = f; }
    /// `setSkybox(on)`: liga o céu; desligar não desfaz uma cor (como antes).
    pub fn skybox(&mut self, on: bool) { if on { self.cur.fundo = Fundo::Ceu; } }
    pub fn set_viewport(&mut self, rect: [f32; 4], limpar: bool) {
        if self.aberta && self.done.len() < MAX_VIEWS - 1 { self.done.push(self.cur); }
        self.aberta = true;
        self.cur.rect = clamp_rect(rect);
        self.cur.limpar = limpar;
    }
    pub fn len(&self) -> usize { self.done.len() + 1 }
    pub fn get(&self, i: usize) -> &View { if i < self.done.len() { &self.done[i] } else { &self.cur } }
    pub fn end_frame(&mut self) {
        self.done.clear();
        self.aberta = false;
        self.cur.rect = FULL;
        self.cur.limpar = true;
    }
}

fn fin(v: f32) -> f32 { if v.is_finite() { v } else { 0.0 } }

/// Retângulo dentro da janela: x, y em [0, 1]; w, h cortados na borda.
pub fn clamp_rect(r: [f32; 4]) -> [f32; 4] {
    let x = fin(r[0]).clamp(0.0, 1.0);
    let y = fin(r[1]).clamp(0.0, 1.0);
    [x, y, fin(r[2]).clamp(0.0, 1.0 - x), fin(r[3]).clamp(0.0, 1.0 - y)]
}

/// Retângulo em pixels do alvo; `None` quando a vista não tem área.
pub fn viewport_px(rect: [f32; 4], w: u32, h: u32) -> Option<[u32; 4]> {
    let (wf, hf) = (w as f32, h as f32);
    let x0 = (rect[0] * wf).round() as u32;
    let y0 = (rect[1] * hf).round() as u32;
    let x1 = (((rect[0] + rect[2]) * wf).round() as u32).min(w);
    let y1 = (((rect[1] + rect[3]) * hf).round() as u32).min(h);
    if x1 <= x0 || y1 <= y0 { None } else { Some([x0, y0, x1 - x0, y1 - y0]) }
}

/// Um slot do uniform `Cam` (ver o teste de layout na Task 2).
pub fn cam_floats(v: &View, light: [f32; 4], light_vp: &[f32; 16], water: f32) -> [f32; CAM_FLOATS] {
    let c = &v.cam;
    let mut f = [0f32; CAM_FLOATS];
    f[0..16].copy_from_slice(&c.view_proj);
    f[16..20].copy_from_slice(&light);
    f[20..23].copy_from_slice(&c.cam_pos);
    f[24..27].copy_from_slice(&c.right); f[27] = c.tan_h;
    f[28..31].copy_from_slice(&c.up); f[31] = c.tan_v;
    f[32..35].copy_from_slice(&c.fwd);
    f[36..52].copy_from_slice(light_vp);
    f[52] = water;
    if let Fundo::Cor(cor) = v.fundo { f[56] = cor[0]; f[57] = cor[1]; f[58] = cor[2]; f[59] = 1.0; }
    f[60] = c.ortho; f[61] = c.half_h; f[62] = c.half_w;
    f
}
```

- [ ] **Step 4: Run tests**

Run: `cd /c/Users/nexga/Documents/GitHub/rts-uv-mundo && cargo test --release -p rts-egui --lib scene3d`
Expected: PASS (7 testes antigos + 13 novos), sem warning novo de `dead_code`.

- [ ] **Step 5: Commit**

`git add crates/rts-egui/src/frame/scene3d && git commit -m "feat(scene3d): matemática de luzes, céu, neblina, vistas e câmera near/far/ortográfica"`

---

### Task 2: Shader, pipeline, render por vistas e API `setLights`/`setSky`/`setFog`/`setViewport` (repo `rts`)

**Files:**
- Modify: `...\crates\rts-egui\src\frame\scene3d\shader.rs` (structs `Cam`/`Env` nas linhas 285-295; `sky_fs` 351-362; `fs` 433-469)
- Modify: `...\crates\rts-egui\src\frame\scene3d\pipeline.rs` (`cam_buf` 13-18; `cam_bgl` 19-31; `cam_bg` 32-39; `layout` 126-130; sky pipeline 203; literal `Scene3D` 318-351)
- Modify: `...\crates\rts-egui\src\frame\scene3d\render.rs` (fn `render`, linhas 7-195, reescrita)
- Modify: `...\crates\rts-egui\src\frame\scene3d\mod.rs` (campos 75-97; setters 115-179)
- Modify: `...\crates\rts-egui\src\frame\scene3d\lights.rs` e `views.rs` (remover o `#![cfg_attr(not(test), allow(dead_code))]`)
- Modify: `...\crates\rts-egui\src\scene_api.rs` (`set_camera` 64-80; novas `set_lights`, `set_sky`, `set_fog`, `set_viewport`)
- Modify: `...\crates\rts-ui\src\scene.rs` (`MEMBERS` 40-52; `set_camera` 92-105; novos membros)
- Modify: `...\crates\rts-egui\Cargo.toml` (`[dev-dependencies] naga = { version = "29.0", features = ["wgsl-in"] }`)
- Test: `...\crates\rts-egui\src\frame\scene3d\tests.rs`

**Interfaces:**
- Consumes: tudo o que a Task 1 produz.
- Produces (TS, `rts:egui`):
  - `setCamera(win, { x, y, z, yaw, pitch, fov, aspect, near=0.1, far=500, ortho=0, orthoSize=5 })`
  - `setLights(win, dados: Float64Array, n)`
  - `setSky(win, dados: Float64Array)` (22 floats, ver `SKY_IN`)
  - `setFog(win, { r, g, b, densidade })`
  - `setViewport(win, { x, y, w, h, limpar=1 })`
  - `setClearColor`/`setSkybox`/`setLight` mantêm a assinatura e passam a valer para a vista corrente. Sem `setLights`, n = 0 dá exatamente o shading de hoje.
- Produces (Rust, `rts_egui`): `set_camera(win, x, y, z, yaw, pitch, fov, aspect, near, far, ortho: bool, ortho_size)`, `set_lights(win, &[f64], usize)`, `set_sky(win, &[f64])`, `set_fog(win, r, g, b, densidade)`, `set_viewport(win, [f64; 4], limpar: bool)`.

- [ ] **Step 1: Write the failing test**

Em `Cargo.toml` do `rts-egui`, acrescentar a seção `[dev-dependencies]` com `naga = { version = "29.0", features = ["wgsl-in"] }`. É a mesma versão que o wgpu já traz no `Cargo.lock`. Depois, acrescentar a `tests.rs`:

```rust
    use super::shader::SHADER;
    use super::views::CAM_STRIDE;
    use super::lights::ENV_BYTES;

    fn struct_layout(m: &naga::Module, nome: &str) -> (u32, Vec<(String, u32)>) {
        for (_, t) in m.types.iter() {
            if t.name.as_deref() == Some(nome) {
                if let naga::TypeInner::Struct { members, span } = &t.inner {
                    return (*span, members.iter().map(|mm| (mm.name.clone().unwrap_or_default(), mm.offset)).collect());
                }
            }
        }
        panic!("struct {nome} ausente do shader");
    }
    fn offset(campos: &[(String, u32)], nome: &str) -> u32 {
        campos.iter().find(|c| c.0 == nome).map(|c| c.1).unwrap_or_else(|| panic!("campo {nome} ausente"))
    }

    /// O shader compila e valida no naga (o mesmo validador do wgpu): um erro de
    /// WGSL aparece aqui, sem abrir janela.
    #[test]
    fn shader_valida_no_naga() {
        let m = naga::front::wgsl::parse_str(SHADER).unwrap_or_else(|e| panic!("{}", e.emit_to_string(SHADER)));
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&m)
            .unwrap_or_else(|e| panic!("validação: {e:?}"));
    }

    /// O layout do WGSL bate com `cam_floats` e `env_floats`, float por float.
    #[test]
    fn layout_do_uniform_bate_com_o_empacotamento() {
        let m = naga::front::wgsl::parse_str(SHADER).unwrap();
        let (cam, c) = struct_layout(&m, "Cam");
        assert_eq!(cam as u64, CAM_STRIDE, "um slot de câmera = 256 bytes");
        assert_eq!(offset(&c, "light"), 16 * 4);
        assert_eq!(offset(&c, "cam_pos"), 20 * 4);
        assert_eq!(offset(&c, "cam_right"), 24 * 4);
        assert_eq!(offset(&c, "cam_fwd"), 32 * 4);
        assert_eq!(offset(&c, "light_vp"), 36 * 4);
        assert_eq!(offset(&c, "water"), 52 * 4);
        assert_eq!(offset(&c, "view_bg"), 56 * 4);
        assert_eq!(offset(&c, "proj"), 60 * 4);
        let (env, e) = struct_layout(&m, "Env");
        assert_eq!(env as u64, ENV_BYTES);
        assert_eq!(offset(&e, "sky0"), 8 * 4);
        assert_eq!(offset(&e, "sun_dir"), 24 * 4);
        assert_eq!(offset(&e, "fog"), 28 * 4);
        assert_eq!(offset(&e, "lights"), 32 * 4);
        let (luz, _) = struct_layout(&m, "LuzGpu");
        assert_eq!(luz, 64, "16 floats por luz");
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --release -p rts-egui --lib scene3d`
Expected: FAIL — `struct Env ausente do shader` e `um slot de câmera = 256 bytes` (o `Cam` de hoje tem 224).

- [ ] **Step 3: Implementation**

**shader.rs.** Trocar o struct `Cam` e o binding (linhas 285-295) por:

```wgsl
struct Cam {
  view_proj: mat4x4<f32>,
  light: vec4<f32>,      // luz LEGADA (setLight): xyz = posição, w = ambiente
  cam_pos: vec4<f32>,
  cam_right: vec4<f32>,  // w = tanH
  cam_up: vec4<f32>,     // w = tanV
  cam_fwd: vec4<f32>,
  light_vp: mat4x4<f32>, // view·proj da luz (shadow map)
  water: vec4<f32>,      // x = escala da partícula de água
  view_bg: vec4<f32>,    // rgb = cor do fundo; w = 1 → fundo chapado nesta vista
  proj: vec4<f32>,       // x = 1 ortográfica; y = meia altura; z = meia largura
};
struct LuzGpu { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32> };
struct Env {
  info: vec4<f32>,        // x = nº de luzes, y = índice da luz com sombra (-1), z = modo do ambiente, w = intensidade
  amb: vec4<f32>,         // rgb = cor do ambiente
  sky0: vec4<f32>,        // x = modo do céu, y = exposição, z = estrelas, w = tamanho do sol (rad)
  sky_top: vec4<f32>,
  sky_horizon: vec4<f32>,
  sky_ground: vec4<f32>,
  sun_dir: vec4<f32>,     // xyz = direção em que a luz do sol viaja; w = 1 se há panorama
  fog: vec4<f32>,         // rgb = cor, w = densidade
  lights: array<LuzGpu, 8>,
};
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<uniform> env: Env;
```

`shadow_vs`, `shadow_factor`, `SkyOut`, `sky_vs`, `hash13`, `VOut`, `vs` e `vs_water` ficam byte a byte iguais. Trocar `sky_fs` por:

```wgsl
fn estrelas(ray: vec3<f32>) -> f32 {
  let h = hash13(floor(ray * 260.0));
  return select(0.0, (h - 0.9915) * 110.0, h > 0.9915);
}
fn equiret(ray: vec3<f32>) -> vec2<f32> {
  return vec2<f32>(atan2(ray.x, ray.z) * 0.15915494 + 0.5, acos(clamp(ray.y, -1.0, 1.0)) * 0.31830989);
}
fn cor_do_ceu(ray: vec3<f32>, pano: vec3<f32>) -> vec3<f32> {
  let modo = env.sky0.x;
  if (modo < 0.5) {
    // 0: o céu estrelado de antes, idêntico (sem exposição)
    let t = clamp(ray.y * 0.5 + 0.5, 0.0, 1.0);
    return mix(vec3<f32>(0.02, 0.02, 0.035), vec3<f32>(0.01, 0.015, 0.05), t) + vec3<f32>(estrelas(ray));
  }
  var col = env.sky_top.rgb;                     // 2: cor
  if (modo < 1.5) {                              // 1: procedural com disco do sol
    let acima = mix(env.sky_horizon.rgb, env.sky_top.rgb, sqrt(clamp(ray.y, 0.0, 1.0)));
    let abaixo = mix(env.sky_horizon.rgb, env.sky_ground.rgb, sqrt(clamp(-ray.y, 0.0, 1.0)));
    col = select(abaixo, acima, ray.y >= 0.0);
    let tam = max(env.sky0.w, 0.001);
    let disco = smoothstep(cos(tam * 1.6), cos(tam), dot(ray, -normalize(env.sun_dir.xyz)));
    col = col + vec3<f32>(1.0, 0.95, 0.85) * (disco * 3.0);
  } else if (modo > 2.5) {                       // 3: panorama (sem textura: a cor do topo)
    col = select(env.sky_top.rgb, pano, env.sun_dir.w > 0.5);
  }
  return (col + vec3<f32>(estrelas(ray) * env.sky0.z)) * env.sky0.y;
}
@fragment
fn sky_fs(i: SkyOut) -> @location(0) vec4<f32> {
  var ray = normalize(cam.cam_fwd.xyz
    + cam.cam_right.xyz * (i.ndc.x * cam.cam_right.w)
    + cam.cam_up.xyz * (i.ndc.y * cam.cam_up.w));
  if (cam.proj.x > 0.5) { ray = normalize(cam.cam_fwd.xyz); }   // ortográfica: um raio só
  // amostra SEMPRE (fluxo uniforme); só vale no modo panorama
  let pano = textureSample(albedo_tex, albedo_samp, equiret(ray)).rgb;
  if (cam.view_bg.w > 0.5) { return vec4<f32>(cam.view_bg.rgb, 1.0); }
  return vec4<f32>(cor_do_ceu(ray, pano), 1.0);
}
```

Trocar, em `fs`, tudo o que vem depois de `if (i.emissive > 0.5) { ... }` (linhas 458-469) por:

```wgsl
  let n = normalize(i.normal);
  let sh = shadow_factor(i.world);          // uma amostra, em fluxo uniforme
  let vdir = normalize(cam.cam_pos.xyz - i.world);
  var rgb: vec3<f32>;
  let nluzes = min(u32(env.info.x), 8u);
  if (nluzes == 0u) {
    // LEGADO (setLight): exatamente o shading de antes
    let l = normalize(cam.light.xyz - i.world);
    let nd = max(dot(n, l), 0.0);
    let lit = cam.light.w + (1.0 - cam.light.w) * nd * sh;
    let h = normalize(l + vdir);
    let spec = pow(max(dot(n, h), 0.0), 32.0) * 0.3 * sh;
    rgb = albedo * lit + vec3<f32>(spec, spec, spec);
  } else {
    var dif = vec3<f32>(0.0, 0.0, 0.0);
    var spec = 0.0;
    let idx_sombra = i32(env.info.y);
    for (var k = 0u; k < nluzes; k = k + 1u) {
      let luz = env.lights[k];
      var l = -normalize(luz.b.xyz);            // direcional: contra a direção da luz
      var att = 1.0;
      if (luz.a.w > 0.5) {                      // pontual ou spot
        let para = luz.a.xyz - i.world;
        let dist = length(para);
        l = para / max(dist, 0.0001);
        att = atenuacao(dist, luz.b.w);
        if (luz.a.w > 1.5) { att = att * cone(dot(-l, normalize(luz.b.xyz)), luz.d.x, luz.d.y); }
      }
      let s = select(1.0, sh, i32(k) == idx_sombra);
      let nd = max(dot(n, l), 0.0);
      dif = dif + luz.c.rgb * (luz.c.w * nd * att * s);
      let h = normalize(l + vdir);
      spec = spec + pow(max(dot(n, h), 0.0), 32.0) * 0.3 * s * att * luz.c.w;
    }
    rgb = albedo * (ambiente(n) + dif) + vec3<f32>(spec, spec, spec);
  }
  return vec4<f32>(neblina(rgb, i.world), i.color.a);
}
```

e, antes de `@fragment fn fs`, as funções que espelham `lights.rs`:

```wgsl
fn atenuacao(d: f32, alcance: f32) -> f32 {
  if (alcance <= 0.0) { return 0.0; }
  let r = d / alcance;
  let x = clamp(1.0 - r * r, 0.0, 1.0);
  return x * x;
}
fn cone(c: f32, c_in: f32, c_out: f32) -> f32 {
  if (c_in - c_out <= 0.0001) { return select(0.0, 1.0, c >= c_out); }
  let t = clamp((c - c_out) / (c_in - c_out), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
fn ambiente(n: vec3<f32>) -> vec3<f32> {
  let modo = env.info.z;
  if (modo < 0.5) { return vec3<f32>(cam.light.w); }            // escalar do setLight
  if (modo < 1.5) { return env.amb.rgb * env.info.w; }          // cor
  return mix(env.sky_ground.rgb, env.sky_top.rgb, n.y * 0.5 + 0.5) * env.info.w;   // céu
}
fn neblina(rgb: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
  if (env.fog.w <= 0.0) { return rgb; }
  return mix(env.fog.rgb, rgb, exp(-env.fog.w * length(cam.cam_pos.xyz - world)));
}
```

**mod.rs.** Nos campos de `Scene3D` (75-97), remover `view_proj`, `cam_pos`, `cright`, `cup`, `cfwd`, `tan_h`, `tan_v` e `bg`, e acrescentar:

```rust
    /// Vistas do frame (câmera, retângulo, fundo). Ver `views.rs`.
    vq: views::ViewQueue,
    env_buf: wgpu::Buffer,
    lights: lights::PackedLights,
    sky: lights::SkyParams,
    fog: [f32; 4],
```

Os setters (linhas 115-179) passam a ser:

```rust
    pub fn set_camera(&mut self, cd: Cam3D) { self.vq.set_camera(cd); }
    pub fn set_lights(&mut self, src: &[f64], n: usize) { self.lights = lights::pack_lights(src, n); }
    pub fn set_sky(&mut self, src: &[f64]) { self.sky = lights::SkyParams::from_f64(src); }
    pub fn set_fog(&mut self, f: [f32; 4]) { self.fog = f; }
    pub fn set_viewport(&mut self, rect: [f32; 4], limpar: bool) { self.vq.set_viewport(rect, limpar); }
    pub fn set_clear_color(&mut self, rgba: [f32; 4]) { self.vq.set_fundo(views::Fundo::Cor(rgba)); }
    pub fn set_skybox(&mut self, on: bool) { self.vq.skybox(on); }
```

`set_light` e `set_shadow` ficam como estão.

**pipeline.rs.**
- `cam_buf`: `size: views::MAX_VIEWS as u64 * views::CAM_STRIDE`.
- Novo `env_buf`: `size: lights::ENV_BYTES`, `UNIFORM | COPY_DST`.
- `cam_bgl`: duas entradas.
  - `binding 0`: `ty: Buffer { ty: Uniform, has_dynamic_offset: true, min_binding_size: wgpu::BufferSize::new(views::CAM_STRIDE) }`.
  - `binding 1`: `ty: Buffer { ty: Uniform, has_dynamic_offset: false, min_binding_size: None }`, com `visibility: VERTEX_FRAGMENT`.
- `cam_bg`:
  - `binding 0` → `wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &cam_buf, offset: 0, size: wgpu::BufferSize::new(views::CAM_STRIDE) })`;
  - `binding 1` → `env_buf.as_entire_binding()`.
- Apagar o `layout` do céu (126-130); o `sky_pipeline` passa a usar `layout: Some(&mesh_layout)`, que tem o group 2 do panorama.
- No literal de `Scene3D`: `vq: views::ViewQueue::new(view_proj(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0))`, `env_buf`, `lights: lights::PackedLights::empty()`, `sky: lights::SkyParams::padrao()`, `fog: [0.0; 4]`, e remover os campos apagados.

**render.rs.** Reescrever `render`: o bloco de instâncias e agrupamento (linhas 33-83) continua igual; o resto vira:

```rust
use super::*;
use super::lights::{env_floats, ENV_FLOATS};
use super::views::{cam_floats, viewport_px, Fundo, CAM_STRIDE, FULL};

impl Scene3D {
    pub fn render(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder,
                  view: &wgpu::TextureView, w: u32, h: u32) -> bool {
        self.ensure_depth(device, w, h);
        let water = self.water_draws.first().map(|d| d.3).unwrap_or(0.0);
        let nviews = self.vq.len();
        for i in 0..nviews {
            let floats = cam_floats(self.vq.get(i), self.light, &self.light_vp, water);
            queue.write_buffer(&self.cam_buf, i as u64 * CAM_STRIDE, f32_bytes(&floats));
        }
        let has_pano = self.sky.modo > 2.5 && self.textures.contains_key(&self.sky.textura);
        let env: [f32; ENV_FLOATS] = env_floats(&self.lights, &self.sky, has_pano, self.fog);
        queue.write_buffer(&self.env_buf, 0, f32_bytes(&env));

        // … instâncias e `grupos` exatamente como antes (linhas 33-83) …

        // SHADOW PASS: igual, com o slot 0 (light_vp é o mesmo em todos os slots)
        //   sp.set_bind_group(0, &self.cam_bg, &[0]);

        // Clear da janela inteira: com UMA vista cheia é o de antes (a cor do
        // fundo chapado ou o escuro sob o céu); com várias, o escuro (faixas).
        let v0 = *self.vq.get(0);
        let base = match v0.fundo {
            Fundo::Cor(c) if nviews == 1 && v0.rect == FULL =>
                wgpu::Color { r: c[0] as f64, g: c[1] as f64, b: c[2] as f64, a: c[3] as f64 },
            _ => wgpu::Color { r: 0.02, g: 0.02, b: 0.03, a: 1.0 },
        };
        let sky_bg = if has_pano { &self.textures[&self.sky.textura] } else { &self.default_tex_bg };
        let mut limpou = false;
        for i in 0..nviews {
            let v = *self.vq.get(i);
            let Some(px) = viewport_px(v.rect, w, h) else { continue };
            let load = if limpou { wgpu::LoadOp::Load } else { wgpu::LoadOp::Clear(base) };
            limpou = true;
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view, resolve_target: None, depth_slice: None,
                    ops: wgpu::Operations { load, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }),
                    stencil_ops: None,
                }),
                timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_viewport(px[0] as f32, px[1] as f32, px[2] as f32, px[3] as f32, 0.0, 1.0);
            pass.set_scissor_rect(px[0], px[1], px[2], px[3]);
            pass.set_bind_group(0, &self.cam_bg, &[(i as u64 * CAM_STRIDE) as u32]);
            pass.set_bind_group(1, &self.shadow_bg, &[]);
            if v.limpar {
                // céu, ou fundo chapado (view_bg.w = 1) só dentro desta vista
                pass.set_pipeline(&self.sky_pipeline);
                pass.set_bind_group(2, sky_bg, &[]);
                pass.draw(0..3, 0..1);
            }
            // … malhas e água exatamente como antes (linhas 159-189), dentro deste pass …
        }
        if !limpou {
            // nenhuma vista com área: ainda assim o frame precisa ser limpo
            let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d clear"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view, resolve_target: None, depth_slice: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(base), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
        }
        self.draws.clear();
        self.water_draws.clear();
        self.vq.end_frame();
        true
    }
}
```

**scene_api.rs.** `set_camera` ganha os argumentos novos, e surgem as novas funções:

```rust
#[allow(clippy::too_many_arguments)]
pub fn set_camera(win: u64, camx: f64, camy: f64, camz: f64, yaw: f64, pitch: f64, fov_y: f64, aspect: f64,
                  near: f64, far: f64, ortho: bool, ortho_size: f64) {
    let cd = view_proj_spec(&CamSpec {
        pos: [camx as f32, camy as f32, camz as f32], yaw: yaw as f32, pitch: pitch as f32, fov_y: fov_y as f32,
        aspect: aspect as f32, near: near as f32, far: far as f32, ortho, ortho_size: ortho_size as f32,
    });
    with_scene(win, |s, _d| s.set_camera(cd), ());
}
/// Até 8 luzes, 16 f64 por luz (ver `lights::LIGHT_IN`). n = 0 = shading legado.
pub fn set_lights(win: u64, data: &[f64], n: usize) { with_scene(win, |s, _d| s.set_lights(data, n), ()); }
/// Céu, sol e luz ambiente: 22 f64 (ver `lights::SKY_IN`).
pub fn set_sky(win: u64, data: &[f64]) { with_scene(win, |s, _d| s.set_sky(data), ()); }
/// Neblina exponencial; densidade 0 desliga.
pub fn set_fog(win: u64, r: f64, g: f64, b: f64, densidade: f64) {
    let f = crate::frame::scene3d::fog_params(r, g, b, densidade);
    with_scene(win, |s, _d| s.set_fog(f), ());
}
/// Começa uma vista: retângulo em fração da janela (y do topo). `limpar = false` = fundo "nada".
pub fn set_viewport(win: u64, rect: [f64; 4], limpar: bool) {
    let r = [rect[0] as f32, rect[1] as f32, rect[2] as f32, rect[3] as f32];
    with_scene(win, |s, _d| s.set_viewport(r, limpar), ());
}
```

(Em `mod.rs`, `pub use lights::fog_params;`. Importar `CamSpec`/`view_proj_spec` no topo de `scene_api.rs`.)

**rts-ui/src/scene.rs.** Acrescentar `("setLights", set_lights), ("setSky", set_sky), ("setFog", set_fog), ("setViewport", set_viewport)` a `MEMBERS`, e:

```rust
/// Reinterpreta os bytes de uma view como `f64` (Float64Array), em ordem nativa.
fn doubles(raw: &[u8]) -> Vec<f64> {
    raw.chunks_exact(8).map(|w| f64::from_ne_bytes([w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7]])).collect()
}

/// `setCamera(win, { x, y, z, yaw, pitch, fov, aspect, near, far, ortho, orthoSize })`.
extern "C" fn set_camera(_e: u64, _t: u64, win: u64, spec: u64, _b: u64, _c: u64) -> u64 {
    let r = options(spec, &["x", "y", "z", "yaw", "pitch", "fov", "aspect", "near", "far", "ortho", "orthoSize"],
        &[0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.1, 500.0, 0.0, 5.0]);
    rts_egui::set_camera(handle(win), r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9] != 0.0, r[10]);
    value::nothing()
}
/// `setLights(win, dados: Float64Array, n)`.
extern "C" fn set_lights(_e: u64, _t: u64, win: u64, data: u64, n: u64, _c: u64) -> u64 {
    let vals = bytes(data).map(|raw| doubles(&raw)).unwrap_or_default();
    rts_egui::set_lights(handle(win), &vals, integer(n, 0).max(0) as usize);
    value::nothing()
}
/// `setSky(win, dados: Float64Array)`.
extern "C" fn set_sky(_e: u64, _t: u64, win: u64, data: u64, _b: u64, _c: u64) -> u64 {
    let vals = bytes(data).map(|raw| doubles(&raw)).unwrap_or_default();
    rts_egui::set_sky(handle(win), &vals);
    value::nothing()
}
/// `setFog(win, { r, g, b, densidade })`.
extern "C" fn set_fog(_e: u64, _t: u64, win: u64, spec: u64, _b: u64, _c: u64) -> u64 {
    let r = options(spec, &["r", "g", "b", "densidade"], &[0.0, 0.0, 0.0, 0.0]);
    rts_egui::set_fog(handle(win), r[0], r[1], r[2], r[3]);
    value::nothing()
}
/// `setViewport(win, { x, y, w, h, limpar })`, em fração da janela, y a partir do topo.
extern "C" fn set_viewport(_e: u64, _t: u64, win: u64, spec: u64, _b: u64, _c: u64) -> u64 {
    let r = options(spec, &["x", "y", "w", "h", "limpar"], &[0.0, 0.0, 1.0, 1.0, 1.0]);
    rts_egui::set_viewport(handle(win), [r[0], r[1], r[2], r[3]], r[4] != 0.0);
    value::nothing()
}
```

Atualizar os doc comments de `setClearColor`/`setSkybox`, que passam a valer para a vista corrente.

- [ ] **Step 4: Run tests**

Run:
```
cd /c/Users/nexga/Documents/GitHub/rts-uv-mundo
cargo test --release -p rts-egui --lib scene3d
cargo build --release --bin rts
cargo build --release -p rts-host --example ui_fixture --features ui
cargo build --release -p rts-runtime
```
Expected: PASS (22 testes), os três builds sem erro e sem warning novo. Fumaça com janela: `cd /c/Users/nexga/Documents/GitHub/rts-game/build/main-integration && /c/Users/nexga/Documents/GitHub/rts-uv-mundo/target/release/examples/ui_fixture.exe main.ts`, e a cena aparece como antes (céu estrelado, luz pontual, sombra). Nenhum código TS chama as APIs novas ainda.

- [ ] **Step 5: Commit**

`git commit -am "feat(scene3d): setLights/setSky/setFog/setViewport, setCamera com near/far/ortográfica e render por vistas"`. Abrir PR em UrubuCode/rts a partir de `feat/scene3d-luzes-ceu` quando a revisão da Task 2 aprovar.

---

### Task 3: Component `Light`, cache de luzes na cena, coleta e invólucros do `gpu3d` (rts-game)

**Files:**
- Create: `src/engine/core/light.ts`
- Create: `src/engine/render/scene_lighting.ts`
- Modify: `src/engine/core/behavior.ts` (consts KIND nas linhas 83-90; superfície de luz depois da de câmera, ~linha 227)
- Modify: `src/engine/core/gameobject.ts` (interface `UIOwner` 29-31; campos 114-146; `refreshComponentCache` 164-172; nova `activeInScene`)
- Modify: `src/engine/core/scene.ts` (campos ~120; construtor 122-150; `lightChanged`; `add` 184-210; `removeAt` 344-376; `clear` 235-241; novo `collectLights`)
- Modify: `src/engine/render/gpu3d.ts` (import das linhas 41-45; invólucros sem alocação depois de `setShadow`, ~linha 366)
- Modify: `src/editor/scene_document.ts` (ramo `"new"` de `complete`, linha 43)
- Modify: `main.ts` (linhas 863-867) e `game.ts` (linhas 154-156): trocar `setLgt`+`setShadow` por `aplicarLuzes`
- Regenerate: `src/engine/generated/*` (`npm run components`)
- Test: `tests/test_light.ts`

**Interfaces:**
- Consumes: `setLights`, `setLight`, `setShadow`, `setSky`, `setFog`, `setViewport`, `setCamera` (ampliado), `setClearColor`, `setSkybox` de `rts:egui` (Task 2).
- Produces:
  - `KIND_LIGHT = 7`; `Behavior.lightType(): number` (-1), `Behavior.lightPack(out: Float64Array, base: number): void`
  - `class Light extends Behavior { tipo: string; cor: number; intensidade: number; alcance: number; anguloSpot: number; sombra: boolean }`
  - `MAX_LUZES = 8`, `FLOATS_POR_LUZ = 16`, `LUZ_DIRECIONAL/PONTUAL/SPOT`, `TIPOS_LUZ`, `SPOT_FRACAO_INTERNA`, `LUZ_PADRAO_PITCH/YAW/ALTURA`
  - `coletarLuzes(sc: Scene, buf: Float64Array, cam: Float64Array, solNome: string): number`; `criarLuzDirecionalPadrao(sc: Scene): GameObject`
  - `GameObject.lightIdx`; `UIOwner.lightChanged(go)`; `activeInScene(objs: GameObject[], o: GameObject): boolean`
  - `Scene.lightObjs: GameObject[]`, `Scene.luzDist: Float64Array`, `Scene.collectLights(buf: Float64Array, cam: Float64Array): number`
  - `gpu3d`: `CAM_FLOATS = 11`; `setCamBuf(win, c)`, `setLgtBuf(win, l)`, `setShadowBuf(win, s)`, `setViewportBuf(win, r)`, `setFogBuf(win, f)`, `setLightsBuf(win, buf, n)`, `setSkyBuf(win, buf)`, `setFundoCor(win, rgb)`, `setFundoCeu(win)` (todos com `Float64Array`, sem literal por chamada)
  - `aplicarLuzes(win: number, sc: Scene, cam: Float64Array, legado: Float64Array): number`; `luzesColetadas(): Float64Array`; `sombraAtual(): Float64Array`; `SOMBRA_CENTRO_Y`, `SOMBRA_RAIO`

- [ ] **Step 1: Write the failing test**

Antes: `cd /c/Users/nexga/Documents/GitHub/rts-game/build/main-integration && git switch -c feat/luzes-ceu-camera`.

`tests/test_light.ts`:

```ts
// Teste SEM JANELA do component Light e da coleta de luzes da cena: cache,
// limite de 8, ordem (direcional principal primeiro), formato, serialização,
// sombra e a "Luz Direcional" de uma cena nova.
//
//   rts.exe run tests/test_light.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Light, MAX_LUZES, FLOATS_POR_LUZ } from "@engine/core/light";
import { recreateBehavior } from "@editor/sceneio";
import { componentToData } from "@engine/components";
import { aplicarLuzes, sombraAtual } from "@engine/render/scene_lighting";
import { sceneDocument } from "@editor/scene_document";
import { scene } from "@editor/control/session";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: number, b: number): boolean { return Math.abs(a - b) < 1e-6; }
function luz(sc: Scene, nome: string, tipo: string, x: number): Light {
  const o = sc.createGameObject(nome);
  o.transform.setPosition(x, 0.0, 0.0);
  const l = new Light(); l.tipo = tipo; o.addBehavior(l);
  return l;
}
function dono(l: Light): GameObject { return l.owner as GameObject; }

// 1) cache: entra ao anexar, sai ao remover o componente ou o objeto
const sc = new Scene("teste");
const a = luz(sc, "A", "pontual", 1.0);
check(sc.lightObjs.length === 1, "Light anexado entra no cache");
sc.objects[0].removeBehavior(0);
check(sc.lightObjs.length === 0, "remover o componente tira do cache");
sc.objects[0].addBehavior(a);
check(sc.lightObjs.length === 1, "anexar de novo volta ao cache");
sc.removeAt(0);
check(sc.lightObjs.length === 0, "remover o objeto tira do cache");

// 2) 10 pontuais em x = 10..1, uma direcional, uma desligada e uma filha de pai inativo
let k = 10;
while (k >= 1) { luz(sc, "P" + k, "pontual", k); k = k - 1; }
const sol = luz(sc, "Sol", "direcional", 50.0); sol.sombra = true;
const desligada = luz(sc, "Desligada", "pontual", 0.5); desligada.enabled = 0;
const pai = sc.createGameObject("Pai"); pai.active = 0;
const filha = luz(sc, "Filha", "pontual", 0.25);
dono(filha).parent = sc.objects.indexOf(pai);
sc.computeWorld();
const buf = new Float64Array(MAX_LUZES * FLOATS_POR_LUZ);
const cam = new Float64Array(3);
const n = sc.collectLights(buf, cam);
check(n === MAX_LUZES, "limite de 8: " + n);
check(buf[0] === 0.0 && perto(buf[1], 50.0), "a direcional vem primeiro");
let j = 1;
while (j < n) {
  check(perto(buf[j * FLOATS_POR_LUZ + 1], j), "pontual " + j + " em ordem de distância: " + buf[j * FLOATS_POR_LUZ + 1]);
  j = j + 1;
}

// 3) formato: +Z sem rotação; -Y com pitch -90°; cor e cones
const s2 = new Scene("formato");
const spot = luz(s2, "Spot", "spot", 0.0);
spot.cor = 0xFF8000; spot.intensidade = 2.0; spot.alcance = 7.0; spot.anguloSpot = 60.0;
s2.computeWorld();
const b2 = new Float64Array(FLOATS_POR_LUZ);
check(s2.collectLights(b2, cam) === 1, "uma luz");
check(b2[0] === 2.0, "spot = tipo 2");
check(perto(b2[4], 0.0) && perto(b2[5], 0.0) && perto(b2[6], 1.0), "sem rotação a luz aponta para +Z");
check(perto(b2[7], 1.0) && perto(b2[8], 128.0 / 255.0) && perto(b2[9], 0.0), "cor 0xFF8000");
check(b2[10] === 2.0 && b2[11] === 7.0, "intensidade e alcance");
check(perto(b2[13], Math.cos(30.0 * Math.PI / 180.0)) && perto(b2[12], Math.cos(24.0 * Math.PI / 180.0)), "cone externo 30°, interno 24°");
s2.objects[0].transform.rx = 0.0 - Math.PI / 2.0; s2.computeWorld(); s2.collectLights(b2, cam);
check(perto(b2[5], -1.0), "pitch -90° aponta para baixo");

// 4) ida e volta pelo formato de cena
const copia = recreateBehavior(componentToData(spot)) as Light;
check(copia.tipo === "spot" && copia.cor === 0xFF8000 && copia.anguloSpot === 60.0 && copia.alcance === 7.0, "Light sobrevive a salvar/carregar");

// 5) aplicarLuzes (nativos são no-op sem janela): sombra legada, da principal, ou desligada
const legado = new Float64Array(4); legado[0] = 7.0; legado[1] = 13.0; legado[2] = 5.0; legado[3] = 0.28;
check(aplicarLuzes(0, new Scene("vazia"), cam, legado) === 0, "sem Light: n = 0 (shading legado)");
check(sombraAtual()[0] === -7.0 && sombraAtual()[6] > 0.0, "sem Light, a sombra segue a luz legada");
check(aplicarLuzes(0, sc, cam, legado) === MAX_LUZES && perto(sombraAtual()[0], buf[4]) && sombraAtual()[6] > 0.0, "sombra da direcional principal");
sol.sombra = false; aplicarLuzes(0, sc, cam, legado);
check(sombraAtual()[6] === 0.0, "principal sem sombra: shadow map desligado");

// 6) cena nova ganha a Luz Direcional
sceneDocument.pending = "new"; sceneDocument.complete();
check(scene.objects.length === 1 && scene.objects[0].name === "Luz Direcional", "cena nova com Luz Direcional");
check(scene.lightObjs.length === 1 && (scene.objects[0].behaviors[0] as Light).sombra, "a luz padrão projeta sombra");
io.print("[PASSOU] light: cache, limite de 8, ordem, formato, serialização, sombra, cena nova");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_light.ts`
Expected: FAIL — `cannot resolve module "@engine/core/light"`.

- [ ] **Step 3: Implementation**

`behavior.ts`: `export const KIND_LIGHT: number = 7;` (e o comentário "reservados" passa a "novos kinds entram aqui"), e depois da superfície de câmera:

```ts
  // ── SURFACE DE LUZ (só o component Light sobrescreve) ────────────────────
  /// Tipo da luz: 0 direcional, 1 pontual, 2 spot; -1 = não é luz.
  lightType(): number { return 0 - 1; }
  /// Escreve os 16 números da luz em `out[base..]` (formato do `setLights`).
  lightPack(out: Float64Array, base: number): void {}
```

`gameobject.ts`:
- `UIOwner` ganha `lightChanged(go: GameObject): void;`.
- Campo `lightIdx: number` (-1 no construtor).
- Em `refreshComponentCache`, depois de `uiIdx`:

```ts
    const hadLight = this.lightIdx;
    this.lightIdx = this.componentIdx(KIND_LIGHT);
    if (this.uiOwner !== null && (hadLight >= 0) !== (this.lightIdx >= 0)) this.uiOwner.lightChanged(this);
```

e a função livre:

```ts
/// Profundidade máxima de hierarquia percorrida (a mesma guarda de `moveSubtree`).
export const MAX_PROFUNDIDADE_HIERARQUIA: number = 128;
/// `o` e todos os ancestrais ativos (`parent` indexa `objs`).
export function activeInScene(objs: GameObject[], o: GameObject): boolean {
  let atual: GameObject = o;
  let passo = 0;
  let ativo = true;
  while (passo < MAX_PROFUNDIDADE_HIERARQUIA) {
    if (atual.active === 0) { ativo = false; break; }
    const p = atual.parent;
    if (p < 0 || p >= objs.length) break;
    atual = objs[p];
    passo = passo + 1;
  }
  return ativo;
}
```

`scene.ts`:
- Campos `lightObjs: GameObject[]` e `luzDist: Float64Array`; o construtor atribui `[]` e `new Float64Array(16)`.
- `lightChanged(go)` segue o padrão de `uiChanged`/`uiForget`, com `lightForget`.
- `add`: `if (go.lightIdx >= 0) this.lightObjs.push(go);`.
- `removeAt`: `if (removedObj.lightIdx >= 0) this.lightForget(removedObj);`.
- `clear`: `this.lightObjs.length = 0;`.
- O método:

```ts
  /// Até MAX_LUZES luzes ativas em `buf` (16 números cada); devolve quantas.
  /// `cam` = [x, y, z] de quem vê. Sem alocação (ver `coletarLuzes`).
  collectLights(buf: Float64Array, cam: Float64Array): number {
    return coletarLuzes(this, buf, cam, "");
  }
```

(`import { coletarLuzes } from "./light";`. `light.ts` importa `Scene` só como tipo, então não há ciclo.)

`light.ts`:

```ts
// Engine RTS — LIGHT: luz como COMPONENT de um GameObject (modelo da Unity).
// Posição e direção vêm do Transform de MUNDO do dono: a direção é o eixo +Z
// local, na convenção da câmera — fwd = (sin yaw·cos p, sin p, cos yaw·cos p),
// yaw = wry, pitch = wrx, pitch > 0 olha para cima. O renderer recebe até
// MAX_LUZES por frame (`Scene.collectLights`), com a direcional principal primeiro.
import math from "@compat/math.ts";
import { Behavior, KIND_LIGHT } from "./behavior";
import { GameObject, activeInScene } from "./gameobject";
import type { Scene } from "./scene";

export const MAX_LUZES: number = 8;
export const FLOATS_POR_LUZ: number = 16;
export const LUZ_DIRECIONAL: number = 0;
export const LUZ_PONTUAL: number = 1;
export const LUZ_SPOT: number = 2;
export const TIPOS_LUZ: string[] = ["direcional", "pontual", "spot"];
/// O cone interno do spot é esta fração do externo; a borda suave fica entre os dois.
export const SPOT_FRACAO_INTERNA: number = 0.8;
/// Pose da "Luz Direcional" de uma cena nova: sol a 50° de altura, azimute de 30°.
export const LUZ_PADRAO_PITCH: number = 0.0 - 0.8726646259971648;
export const LUZ_PADRAO_YAW: number = 0.5235987755982988;
export const LUZ_PADRAO_ALTURA: number = 10.0;
const RAD_POR_GRAU: number = 0.017453292519943295;
/// Capacidade inicial do rascunho de distâncias (cresce por dobra).
const LUZ_DIST_INICIAL: number = 16;

/**
 * @componentCategory Renderização
 * @componentDescription Luz direcional, pontual ou spot usada pelo renderer.
 * @componentKeywords luz light sol lâmpada lampada spot iluminação
 */
export class Light extends Behavior {
  /** "direcional", "pontual" ou "spot". */
  tipo: string = "direcional";
  /** Cor 0xRRGGBB. */
  cor: number = 0xFFFFFF;
  /** @range 0 100 */
  intensidade: number = 1.0;
  /**
   * Distância em que a pontual e o spot chegam a zero.
   * @range 0 10000
   */
  alcance: number = 10.0;
  /**
   * Abertura total do cone do spot, em graus.
   * @label Ângulo do spot
   * @range 1 179
   */
  anguloSpot: number = 45.0;
  /** Só a primeira direcional com sombra usa o shadow map. */
  sombra: boolean = false;

  constructor() { super(); }
  kind(): number { return KIND_LIGHT; }
  lightType(): number {
    let t = LUZ_DIRECIONAL;
    if (this.tipo === "pontual") t = LUZ_PONTUAL;
    else if (this.tipo === "spot") t = LUZ_SPOT;
    return t;
  }
  onValidate(field: string): void {
    if (field === "tipo" && TIPOS_LUZ.indexOf(this.tipo) < 0) this.tipo = "direcional";
  }
  lightPack(out: Float64Array, base: number): void {
    const t = this.host;
    const cp = math.cos(t.wrx); const sp = math.sin(t.wrx);
    const cy = math.cos(t.wry); const sy = math.sin(t.wry);
    const meio = this.anguloSpot * 0.5 * RAD_POR_GRAU;
    out[base] = this.lightType();
    out[base + 1] = t.wx; out[base + 2] = t.wy; out[base + 3] = t.wz;
    out[base + 4] = sy * cp; out[base + 5] = sp; out[base + 6] = cy * cp;
    out[base + 7] = ((this.cor >> 16) & 255) / 255.0;
    out[base + 8] = ((this.cor >> 8) & 255) / 255.0;
    out[base + 9] = (this.cor & 255) / 255.0;
    out[base + 10] = this.intensidade;
    out[base + 11] = this.alcance;
    out[base + 12] = math.cos(meio * SPOT_FRACAO_INTERNA);
    out[base + 13] = math.cos(meio);
    out[base + 14] = this.sombra ? 1.0 : 0.0;
    out[base + 15] = 0.0;
  }
}

function capacidadePara(n: number): number {
  let c = LUZ_DIST_INICIAL;
  while (c < n) c = c * 2;
  return c;
}

/// Preenche `buf` com até MAX_LUZES luzes e devolve quantas. A direcional
/// principal vem primeiro (a de nome `solNome`, ou a primeira direcional ativa);
/// as demais seguem por distância a `cam` [x, y, z]. Sem alocação: as distâncias
/// ficam em `sc.luzDist`, que só cresce. Inativas (inclusive por ancestral) e
/// desligadas ficam fora.
export function coletarLuzes(sc: Scene, buf: Float64Array, cam: Float64Array, solNome: string): number {
  const lista: GameObject[] = sc.lightObjs;
  const total = lista.length;
  if (sc.luzDist.length < total) sc.luzDist = new Float64Array(capacidadePara(total));
  const dist: Float64Array = sc.luzDist;
  let principal = 0 - 1;
  let primeiraDir = 0 - 1;
  let i = 0;
  while (i < total) {
    const o = lista[i];
    const l = o.behaviors[o.lightIdx];
    dist[i] = 0.0 - 1.0;
    if (l.enabled !== 0 && activeInScene(sc.objects, o)) {
      if (l.lightType() === LUZ_DIRECIONAL) {
        dist[i] = 0.0;
        if (primeiraDir < 0) primeiraDir = i;
        if (principal < 0 && solNome.length > 0 && o.name === solNome) principal = i;
      } else {
        const t = o.transform;
        const dx = t.wx - cam[0]; const dy = t.wy - cam[1]; const dz = t.wz - cam[2];
        dist[i] = 1.0 + dx * dx + dy * dy + dz * dz;   // +1: depois de toda direcional
      }
    }
    i = i + 1;
  }
  if (principal < 0) principal = primeiraDir;
  let n = 0;
  if (principal >= 0) {
    const op = lista[principal];
    op.behaviors[op.lightIdx].lightPack(buf, 0);
    dist[principal] = 0.0 - 1.0;
    n = 1;
  }
  let procurar = true;
  while (procurar && n < MAX_LUZES) {
    let melhor = 0 - 1;
    let k = 0;
    while (k < total) {
      if (dist[k] >= 0.0 && (melhor < 0 || dist[k] < dist[melhor])) melhor = k;
      k = k + 1;
    }
    if (melhor < 0) procurar = false;
    else {
      const o = lista[melhor];
      o.behaviors[o.lightIdx].lightPack(buf, n * FLOATS_POR_LUZ);
      dist[melhor] = 0.0 - 1.0;
      n = n + 1;
    }
  }
  return n;
}

/// A "Luz Direcional" com sombra que toda cena nova ganha.
export function criarLuzDirecionalPadrao(sc: Scene): GameObject {
  const o = sc.createGameObject("Luz Direcional");
  o.transform.setPosition(0.0, LUZ_PADRAO_ALTURA, 0.0);
  o.transform.rx = LUZ_PADRAO_PITCH;
  o.transform.ry = LUZ_PADRAO_YAW;
  const l = new Light();
  l.sombra = true;
  o.addBehavior(l);
  return o;
}
```

`gpu3d.ts`: acrescentar ao import de `rts:egui` os membros `setLights as eguiSetLights, setSky as eguiSetSky, setFog as eguiSetFog, setViewport as eguiSetViewport, setClearColor as eguiSetClearColor, setSkybox as eguiSetSkybox`, e depois de `setShadow`:

```ts
// ── INVÓLUCROS SEM ALOCAÇÃO ────────────────────────────────────────────────
// Os nativos leem objetos de opções; um literal por chamada seria uma alocação
// por frame. Estes objetos são do módulo e só têm os campos mutados.
/// Números do `setCamBuf`: x, y, z, yaw, pitch, fov, aspecto, near, far, ortográfica (0/1), meia altura orto.
export const CAM_FLOATS: number = 11;
const optCam = { x: 0.0, y: 0.0, z: 0.0, yaw: 0.0, pitch: 0.0, fov: 1.05, aspect: 1.0, near: 0.1, far: 500.0, ortho: 0.0, orthoSize: 5.0 };
const optLuz = { x: 0.0, y: 10.0, z: 0.0, ambient: 0.2 };
const optSombra = { dx: 0.0, dy: -1.0, dz: 0.0, cx: 0.0, cy: 0.0, cz: 0.0, radius: 0.0 };
const optVista = { x: 0.0, y: 0.0, w: 1.0, h: 1.0, limpar: 1.0 };
const optNeblina = { r: 0.0, g: 0.0, b: 0.0, densidade: 0.0 };
export function setCamBuf(win: number, c: Float64Array): void {
  optCam.x = c[0]; optCam.y = c[1]; optCam.z = c[2]; optCam.yaw = c[3]; optCam.pitch = c[4];
  optCam.fov = c[5]; optCam.aspect = c[6]; optCam.near = c[7]; optCam.far = c[8]; optCam.ortho = c[9]; optCam.orthoSize = c[10];
  setCamera(win, optCam);
}
/// Luz legada: [x, y, z, ambiente].
export function setLgtBuf(win: number, l: Float64Array): void {
  optLuz.x = l[0]; optLuz.y = l[1]; optLuz.z = l[2]; optLuz.ambient = l[3];
  setLight(win, optLuz);
}
/// Sombra: [dx, dy, dz, cx, cy, cz, raio] (raio <= 0 desliga).
export function setShadowBuf(win: number, s: Float64Array): void {
  optSombra.dx = s[0]; optSombra.dy = s[1]; optSombra.dz = s[2];
  optSombra.cx = s[3]; optSombra.cy = s[4]; optSombra.cz = s[5]; optSombra.radius = s[6];
  eguiSetShadow(win, optSombra);
}
/// Começa uma vista: [x, y, w, h, limpar] em fração da janela, y a partir do topo.
export function setViewportBuf(win: number, r: Float64Array): void {
  optVista.x = r[0]; optVista.y = r[1]; optVista.w = r[2]; optVista.h = r[3]; optVista.limpar = r[4];
  eguiSetViewport(win, optVista);
}
/// Neblina: [r, g, b, densidade] (0..1; densidade 0 desliga).
export function setFogBuf(win: number, f: Float64Array): void {
  optNeblina.r = f[0]; optNeblina.g = f[1]; optNeblina.b = f[2]; optNeblina.densidade = f[3];
  eguiSetFog(win, optNeblina);
}
export function setLightsBuf(win: number, buf: Float64Array, n: number): void { eguiSetLights(win, buf, n); }
export function setSkyBuf(win: number, buf: Float64Array): void { eguiSetSky(win, buf); }
/// Fundo chapado 0xRRGGBB na vista corrente.
export function setFundoCor(win: number, rgb: number): void {
  eguiSetClearColor(win, ((rgb >> 16) & 255) / 255.0, ((rgb >> 8) & 255) / 255.0, (rgb & 255) / 255.0);
}
export function setFundoCeu(win: number): void { eguiSetSkybox(win, 1); }
```

`scene_lighting.ts`:

```ts
// Luz da cena por frame: coleta os Lights (até 8) e envia ao renderer; sem
// nenhum Light, a luz pontual legada (bloco "light" da cena / ws `light`) vale
// como antes. Sem alocação: buffers do módulo.
import type { Scene } from "../core/scene";
import { MAX_LUZES, FLOATS_POR_LUZ, LUZ_DIRECIONAL } from "../core/light";
import { setLightsBuf, setLgtBuf, setShadowBuf } from "./gpu3d";

/// Centro (y) e raio da caixa do shadow map — os valores que main.ts/game.ts usavam.
export const SOMBRA_CENTRO_Y: number = 1.0;
export const SOMBRA_RAIO: number = 24.0;
const luzBuf = new Float64Array(MAX_LUZES * FLOATS_POR_LUZ);
const sombraBuf = new Float64Array(7);

export function luzesColetadas(): Float64Array { return luzBuf; }
export function sombraAtual(): Float64Array { return sombraBuf; }

/// `cam` = [x, y, z] de quem vê; `legado` = [x, y, z, ambiente] da luz pontual antiga.
export function aplicarLuzes(win: number, sc: Scene, cam: Float64Array, legado: Float64Array): number {
  const n = sc.collectLights(luzBuf, cam);
  setLightsBuf(win, luzBuf, n);
  setLgtBuf(win, legado);
  sombraBuf[3] = 0.0; sombraBuf[4] = SOMBRA_CENTRO_Y; sombraBuf[5] = 0.0; sombraBuf[6] = SOMBRA_RAIO;
  if (n === 0) {
    sombraBuf[0] = 0.0 - legado[0]; sombraBuf[1] = 0.0 - legado[1]; sombraBuf[2] = 0.0 - legado[2];
  } else if (luzBuf[0] === LUZ_DIRECIONAL && luzBuf[14] !== 0.0) {
    sombraBuf[0] = luzBuf[4]; sombraBuf[1] = luzBuf[5]; sombraBuf[2] = luzBuf[6];
  } else {
    sombraBuf[6] = 0.0;
  }
  setShadowBuf(win, sombraBuf);
  return n;
}
```

`main.ts`:
- Depois de `boneGizmoOrigin` (linha 163): `const luzCam = new Float64Array(3); const luzLegada = new Float64Array(4);`.
- Linhas 863-867 viram:

```ts
  luzCam[0] = workspaceViews.x; luzCam[1] = workspaceViews.y; luzCam[2] = workspaceViews.z;
  luzLegada[0] = S.lightX; luzLegada[1] = S.lightY; luzLegada[2] = S.lightZ; luzLegada[3] = S.lightAmb;
  aplicarLuzes(WIN, scene, luzCam, luzLegada);
```

(Os imports não usados, `setLgt` e `setShadow`, saem.) `game.ts` (linhas 154-156): a mesma troca com `vx, vy, vz`.

`scene_document.ts`, ramo `"new"`: `scene.clear(); scene.name = UI_DOCUMENT.untitled; criarLuzDirecionalPadrao(scene); scene.computeWorld(); this.initialize("");`.

Rodar `npm run components` (o `Light` entra no catálogo).

- [ ] **Step 4: Run tests**

Run:
```
$RTS run tests/test_light.ts
npm run components && npm run test:components && npm run components:check && npm run check:params
$RTS run tests/test_scene.ts
$RTS run tests/claude-test-sceneio-roundtrip.ts
$RTS run tests/test_play_mode.ts
```
Expected: `[PASSOU] light: ...`, os scripts de componentes verdes e as suítes antigas passando.

- [ ] **Step 5: Commit**

`git add -A src tests main.ts game.ts && git commit -m "feat(core): component Light, cache de luzes na cena e coleta de até 8 por frame"`

---

### Task 4: `Camera` ampliada, API de raio/projeção e várias câmeras por frame

**Files:**
- Create: `src/engine/core/active_scene.ts`
- Create: `src/engine/render/camera_views.ts`
- Modify: `src/engine/core/camera.ts` (reescrita)
- Modify: `src/engine/core/gameobject.ts` (`UIOwner.cameraChanged`; campo `camIdx`; `refreshComponentCache`)
- Modify: `src/engine/core/scene.ts` (`camObjs`, `cameraChanged`/`cameraForget`, `add`/`removeAt`/`clear`)
- Modify: `src/engine/render/scenedraw.ts` (linhas 124-131: culling atrás da sentinela `tanH >= 0`)
- Modify: `src/editor/sceneio.ts` (ramo `"camera"`, linhas 118-122: construtor sem argumento)
- Modify: `src/editor/control/session.ts` (depois de `export const scene`: `setActiveScene(scene)`)
- Modify: `game.ts` (linhas 140-157 e o laço 159-206: câmeras em vistas, culling com sentinela)
- Regenerate: `src/engine/generated/*`
- Test: `tests/test_camera_api.ts`

**Interfaces:**
- Consumes: `setViewportBuf`, `setCamBuf`, `setFundoCor`, `setFundoCeu`, `CAM_FLOATS` (Task 3); `activeInScene` (Task 3).
- Produces:
  - `setActiveScene(sc: Scene | null): void`, `activeScene(): Scene | null`
  - `Camera` com os campos `fov, isMain, near, far, ortografica, tamanhoOrto, fundo, corFundo, viewportX, viewportY, viewportW, viewportH, profundidade`, construtor sem argumentos, e os métodos:
    - `definirRetangulo(x, y, w, h)` e `retanguloPx(): Float64Array`;
    - `aspecto(): number`;
    - `viewportPointToRay(u, v, out)`, `screenPointToRay(x, y, out)` e `worldToScreenPoint(x, y, z, out): number` (1 = à frente);
    - `parametrosDeRender(out)`, com 11 números;
    - `static main(): Camera | null` e `static all(): Camera[]`.
  - `FUNDOS_CAMERA`, `cameraVemAntes(a, b)`, `ordenarCameras(cams, n)`
  - `GameObject.camIdx`; `Scene.camObjs: GameObject[]`
  - `class VistasDeCamera { cams; n; area: Float64Array(4); tela: Float64Array(2); camBuf; vpBuf }`, `MAX_VISTAS = 8`
  - `coletarCameras(v: VistasDeCamera, sc: Scene, so: Camera | null): number`, `aplicarVistas(win: number, v: VistasDeCamera): void`, `frustumDasVistas(v: VistasDeCamera, out: f64[]): void`, `posicaoDaVista(v: VistasDeCamera, out: Float64Array): void`
  - `drawSceneObjects(...)`: `tanH < 0` desliga o teste de frustum.

- [ ] **Step 1: Write the failing test**

`tests/test_camera_api.ts`:

```ts
// Teste SEM JANELA da Camera: raio a partir da tela e do viewport, projeção de
// mundo para tela (perspectiva e ortográfica), ida e volta, viewport, câmera
// filha de pai girado, Camera.main()/all(), ordem das vistas, formato salvo.
//
//   rts.exe run tests/test_camera_api.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Camera } from "@engine/core/camera";
import { setActiveScene } from "@engine/core/active_scene";
import { VistasDeCamera, coletarCameras, frustumDasVistas } from "@engine/render/camera_views";
import { recreateBehavior } from "@editor/sceneio";
import { componentToData } from "@engine/components";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: number, b: number): boolean { return Math.abs(a - b) < 1e-6; }
function camera(sc: Scene, nome: string, x: number, y: number, z: number): Camera {
  const o = sc.createGameObject(nome);
  o.transform.setPosition(x, y, z);
  const c = new Camera(); o.addBehavior(c);
  return c;
}
const out = new Float64Array(6);
const tela = new Float64Array(3);
const sc = new Scene("cameras");
setActiveScene(sc);
const cam = camera(sc, "Cam", 1.0, 2.0, 3.0);
cam.fov = 2.0 * Math.atan(0.5);            // tanV = 0,5
cam.definirRetangulo(0.0, 0.0, 800.0, 600.0); // aspecto 4/3 → tanH = 2/3
sc.computeWorld();
const tanH = 0.5 * 800.0 / 600.0;

// centro da tela = fwd; origem no plano near
cam.screenPointToRay(400.0, 300.0, out);
check(perto(out[0], 1.0) && perto(out[1], 2.0) && perto(out[2], 3.1), "origem no near: " + out[0] + "," + out[1] + "," + out[2]);
check(perto(out[3], 0.0) && perto(out[4], 0.0) && perto(out[5], 1.0), "raio do centro = fwd");
// ponto à frente → centro, profundidade d
check(cam.worldToScreenPoint(1.0, 2.0, 13.0, tela) === 1, "à frente");
check(perto(tela[0], 400.0) && perto(tela[1], 300.0) && perto(tela[2], 10.0), "centro com profundidade 10");
cam.worldToScreenPoint(1.0 + 10.0 * tanH, 2.0, 13.0, tela);
check(perto(tela[0], 800.0), "borda direita: " + tela[0]);
cam.worldToScreenPoint(1.0, 7.0, 13.0, tela);
check(perto(tela[1], 0.0), "borda de cima (tanV·10 = 5): " + tela[1]);
check(cam.worldToScreenPoint(1.0, 2.0, -5.0, tela) === 0, "atrás da câmera = 0");
// ida e volta
cam.screenPointToRay(123.0, 456.0, out);
cam.worldToScreenPoint(out[0] + out[3] * 7.0, out[1] + out[4] * 7.0, out[2] + out[5] * 7.0, tela);
check(Math.abs(tela[0] - 123.0) < 1e-6 && Math.abs(tela[1] - 456.0) < 1e-6, "ida e volta tela → mundo → tela");
// viewport (u, v com v para cima)
cam.viewportPointToRay(1.0, 1.0, out);
const l = Math.sqrt(tanH * tanH + 0.25 + 1.0);
check(perto(out[3], tanH / l) && perto(out[4], 0.5 / l) && perto(out[5], 1.0 / l), "canto superior direito do viewport");
// yaw 90° e pitch 30° seguem a convenção do renderer
sc.objects[0].transform.ry = Math.PI / 2.0; sc.computeWorld();
cam.screenPointToRay(400.0, 300.0, out);
check(perto(out[3], 1.0) && perto(out[5], 0.0), "yaw 90° olha para +X");
sc.objects[0].transform.ry = 0.0; sc.objects[0].transform.rx = Math.PI / 6.0; sc.computeWorld();
cam.screenPointToRay(400.0, 300.0, out);
check(perto(out[4], 0.5) && perto(out[5], Math.cos(Math.PI / 6.0)), "pitch > 0 olha para cima");
sc.objects[0].transform.rx = 0.0; sc.computeWorld();
// câmera filha de pai com yaw 90°: fwd de mundo girado
const pai = sc.createGameObject("Pai"); pai.transform.ry = Math.PI / 2.0;
const filha = camera(sc, "Filha", 0.0, 0.0, 0.0);
(filha.owner as GameObject).parent = sc.objects.indexOf(pai);
filha.definirRetangulo(0.0, 0.0, 800.0, 600.0);
sc.computeWorld();
filha.screenPointToRay(400.0, 300.0, out);
check(perto(out[3], 1.0), "filha herda o yaw do pai");
// ortográfica
cam.ortografica = true; cam.tamanhoOrto = 5.0;
cam.screenPointToRay(800.0, 300.0, out);
check(perto(out[0], 1.0 + 5.0 * 800.0 / 600.0) && perto(out[5], 1.0), "orto: origem desloca, direção = fwd");
cam.worldToScreenPoint(1.0, 7.0, 50.0, tela);
check(perto(tela[0], 400.0) && perto(tela[1], 0.0) && perto(tela[2], 47.0), "orto: meia altura 5 = borda de cima");
cam.ortografica = false;
// viewport: retângulo direito de 1280x720
const vistas = new VistasDeCamera();
vistas.area[2] = 1280.0; vistas.area[3] = 720.0; vistas.tela[0] = 1280.0; vistas.tela[1] = 720.0;
cam.viewportX = 0.5; cam.viewportW = 0.5;
filha.enabled = 0;
check(coletarCameras(vistas, sc, cam) === 1, "só a câmera pedida");
check(perto(cam.retanguloPx()[0], 0.0) && perto(cam.retanguloPx()[2], 1280.0), "câmera escolhida ocupa a área inteira");
check(coletarCameras(vistas, sc, null) === 1, "desligada fica fora");
check(perto(cam.retanguloPx()[0], 640.0) && perto(cam.retanguloPx()[2], 640.0), "viewport (0,5, 0, 0,5, 1) → 640..1280");
cam.screenPointToRay(960.0, 360.0, out);
check(perto(out[5], 1.0), "centro da viewport = fwd");
// ordem: profundidade, e a Main por último no empate
cam.viewportX = 0.0; cam.viewportW = 1.0;
filha.enabled = 1; filha.isMain = 0; cam.isMain = 1;
const outra = camera(sc, "Outra", 0.0, 0.0, 0.0); outra.isMain = 0; outra.profundidade = 1.0;
sc.computeWorld();
check(coletarCameras(vistas, sc, null) === 3, "três câmeras");
check(vistas.cams[0] === filha && vistas.cams[1] === cam && vistas.cams[2] === outra, "ordem: profundidade 0 (Main por último), depois 1");
const fp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
frustumDasVistas(vistas, fp);
check(fp[7] < 0.0, "várias vistas: culling desligado (sentinela)");
pai.active = 0;
check(coletarCameras(vistas, sc, null) === 2, "filha de pai inativo fica fora");
// Camera.main() / all()
check(Camera.main() === cam, "main = a marcada isMain");
cam.enabled = 0;
check(Camera.main() === outra, "sem main ativa: a primeira ativa");
cam.enabled = 1;
check(Camera.all().length === 2 && Camera.all()[1] === outra, "all() ordenada por profundidade");
// validação e formato salvo
cam.tamanhoOrto = 0.0; cam.onValidate("tamanhoOrto");
check(cam.tamanhoOrto > 0.0, "tamanhoOrto preso acima de zero");
cam.near = 0.0; cam.onValidate("near"); check(cam.near > 0.0, "near preso acima de zero");
cam.far = 0.0; cam.onValidate("far"); check(cam.far > cam.near, "far > near");
cam.viewportX = 0.9; cam.viewportW = 0.5; cam.onValidate("viewportW");
check(perto(cam.viewportW, 0.1), "x + w preso em 1");
const legado = recreateBehavior({ type: "camera", fov: 0.9, isMain: 0 }) as Camera;
check(perto(legado.fov, 0.9) && legado.isMain === 0 && perto(legado.near, 0.1), "cena antiga carrega com padrões");
cam.ortografica = true; cam.fundo = "cor"; cam.corFundo = 0x102030;
const d = componentToData(cam);
check(d.type === "camera" && d.componentFields.ortografica === true, "formato antigo + campos novos");
const volta = recreateBehavior(d) as Camera;
check(volta.ortografica && volta.fundo === "cor" && volta.corFundo === 0x102030, "ida e volta dos campos novos");
io.print("[PASSOU] camera: raio, projeção, orto, viewport, filha, main/all, ordem, validação, formato");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_camera_api.ts`
Expected: FAIL — `cannot resolve module "@engine/core/active_scene"`.

- [ ] **Step 3: Implementation**

`active_scene.ts`:

```ts
// A cena que o jogo (ou o editor) está rodando, para APIs estáticas como
// Camera.main(). Quem cria a cena principal a registra uma vez.
import type { Scene } from "./scene";
let cenaAtiva: Scene | null = null;
export function setActiveScene(sc: Scene | null): void { cenaAtiva = sc; }
export function activeScene(): Scene | null { return cenaAtiva; }
```

`gameobject.ts`/`scene.ts`: `camIdx`, `cameraChanged`, `cameraForget` e `camObjs`, no mesmo padrão de `lightIdx`/`lightObjs` da Task 3, com `KIND_CAMERA`.

`camera.ts` (reescrita, mantendo o cabeçalho histórico e atualizando o parágrafo "O runtime do jogo renderiza pela primeira câmera" para "todas as câmeras ativas, por profundidade"):

```ts
import math from "@compat/math.ts";
import { Behavior, KIND_CAMERA } from "./behavior";
import { GameObject, activeInScene } from "./gameobject";
import { activeScene } from "./active_scene";

export const FUNDOS_CAMERA: string[] = ["ceu", "cor", "nada"];
/// Retângulo (pixels) de uma câmera que ainda não foi desenhada.
export const CAMERA_RETANGULO_PADRAO_L: number = 1280;
export const CAMERA_RETANGULO_PADRAO_A: number = 720;
/// Limites de validação da lente.
export const CAMERA_NEAR_MIN: number = 0.001;
export const CAMERA_FAR_FOLGA: number = 0.01;
export const CAMERA_ORTO_MIN: number = 0.001;
export const CAMERA_VIEWPORT_MIN: number = 0.01;

/**
 * @componentCategory Renderização
 * @componentDescription Câmera do jogo: perspectiva ou ortográfica, viewport, fundo e ordem de desenho.
 * @componentKeywords camera câmera visão perspectiva ortográfica viewport
 */
export class Camera extends Behavior {
  /** Campo de visão VERTICAL, em radianos. */
  fov: f64 = 1.05;
  /** 1 = câmera principal (Camera.main()). */
  isMain: number = 1;
  near: number = 0.1;
  far: number = 500.0;
  ortografica: boolean = false;
  /**
   * Meia altura da vista ortográfica, em unidades de mundo.
   * @label Tamanho orto
   */
  tamanhoOrto: number = 5.0;
  /** "ceu", "cor" ou "nada". */
  fundo: string = "ceu";
  /** @label Cor do fundo */
  corFundo: number = 0x1E2430;
  /** @range 0 1 */
  viewportX: number = 0.0;
  /**
   * A partir do TOPO da tela.
   * @range 0 1
   */
  viewportY: number = 0.0;
  /** @range 0.01 1 */
  viewportW: number = 1.0;
  /** @range 0.01 1 */
  viewportH: number = 1.0;
  /** Ordem de desenho: maior = por cima. */
  profundidade: number = 0.0;
  private retangulo: Float64Array = new Float64Array(4);
  /// right(3), up(3), fwd(3), pos(3) da pose de mundo, recalculados por chamada.
  private base: Float64Array = new Float64Array(12);

  constructor() {
    super();
    this.retangulo[2] = CAMERA_RETANGULO_PADRAO_L;
    this.retangulo[3] = CAMERA_RETANGULO_PADRAO_A;
  }
  kind(): number { return KIND_CAMERA; }
  typeName(): string { return "Camera"; }
  toData(): any { return { type: "camera", fov: this.fov, isMain: this.isMain }; }
  camFov(): f64 { return this.fov; }
  camIsMain(): number { return this.isMain; }
  onValidate(field: string): void {
    if (this.near < CAMERA_NEAR_MIN) this.near = CAMERA_NEAR_MIN;
    if (this.far < this.near + CAMERA_FAR_FOLGA) this.far = this.near + CAMERA_FAR_FOLGA;
    if (this.tamanhoOrto < CAMERA_ORTO_MIN) this.tamanhoOrto = CAMERA_ORTO_MIN;
    if (FUNDOS_CAMERA.indexOf(this.fundo) < 0) this.fundo = "ceu";
    this.viewportX = Math.max(0.0, Math.min(1.0 - CAMERA_VIEWPORT_MIN, this.viewportX));
    this.viewportY = Math.max(0.0, Math.min(1.0 - CAMERA_VIEWPORT_MIN, this.viewportY));
    this.viewportW = Math.max(CAMERA_VIEWPORT_MIN, Math.min(1.0 - this.viewportX, this.viewportW));
    this.viewportH = Math.max(CAMERA_VIEWPORT_MIN, Math.min(1.0 - this.viewportY, this.viewportH));
  }
  /// Retângulo em pixels onde esta câmera foi desenhada (a "tela" das APIs de raio).
  definirRetangulo(x: number, y: number, w: number, h: number): void {
    this.retangulo[0] = x; this.retangulo[1] = y; this.retangulo[2] = w; this.retangulo[3] = h;
  }
  retanguloPx(): Float64Array { return this.retangulo; }
  aspecto(): number { return this.retangulo[3] > 0.0 ? this.retangulo[2] / this.retangulo[3] : 1.0; }
  atualizarBase(): void {
    const t = this.host; const b = this.base;
    const cy = math.cos(t.wry); const sy = math.sin(t.wry);
    const cp = math.cos(t.wrx); const sp = math.sin(t.wrx);
    b[0] = cy; b[1] = 0.0; b[2] = 0.0 - sy;                               // right
    b[3] = (0.0 - sy) * sp; b[4] = cp; b[5] = (0.0 - cy) * sp;             // up
    b[6] = sy * cp; b[7] = sp; b[8] = cy * cp;                            // fwd
    b[9] = t.wx; b[10] = t.wy; b[11] = t.wz;                              // pos
  }
  /// Raio pelo ponto (u, v) do viewport, (0, 0) embaixo à esquerda: out = origem(3), direção(3).
  viewportPointToRay(u: number, v: number, out: Float64Array): void {
    this.atualizarBase();
    const b = this.base;
    const nx = u * 2.0 - 1.0; const ny = v * 2.0 - 1.0;
    const asp = this.aspecto();
    if (this.ortografica) {
      const ox = nx * this.tamanhoOrto * asp; const oy = ny * this.tamanhoOrto;
      out[0] = b[9] + b[0] * ox + b[3] * oy + b[6] * this.near;
      out[1] = b[10] + b[1] * ox + b[4] * oy + b[7] * this.near;
      out[2] = b[11] + b[2] * ox + b[5] * oy + b[8] * this.near;
      out[3] = b[6]; out[4] = b[7]; out[5] = b[8];
    } else {
      const tv = math.tan(this.fov * 0.5); const th = tv * asp;
      const dx = b[6] + b[0] * (nx * th) + b[3] * (ny * tv);
      const dy = b[7] + b[1] * (nx * th) + b[4] * (ny * tv);
      const dz = b[8] + b[2] * (nx * th) + b[5] * (ny * tv);
      out[0] = b[9] + dx * this.near; out[1] = b[10] + dy * this.near; out[2] = b[11] + dz * this.near;
      const l = math.sqrt(dx * dx + dy * dy + dz * dz);
      out[3] = dx / l; out[4] = dy / l; out[5] = dz / l;
    }
  }
  /// Raio pelo pixel (x, y) da tela (y para baixo), dentro do retângulo desta câmera.
  screenPointToRay(x: number, y: number, out: Float64Array): void {
    const r = this.retangulo;
    const u = r[2] > 0.0 ? (x - r[0]) / r[2] : 0.5;
    const v = r[3] > 0.0 ? 1.0 - (y - r[1]) / r[3] : 0.5;
    this.viewportPointToRay(u, v, out);
  }
  /// Ponto de mundo → out = [x px, y px, profundidade]; devolve 1 se está à frente do near.
  worldToScreenPoint(x: number, y: number, z: number, out: Float64Array): number {
    this.atualizarBase();
    const b = this.base; const r = this.retangulo;
    const dx = x - b[9]; const dy = y - b[10]; const dz = z - b[11];
    const xc = dx * b[0] + dy * b[1] + dz * b[2];
    const yc = dx * b[3] + dy * b[4] + dz * b[5];
    const zc = dx * b[6] + dy * b[7] + dz * b[8];
    const asp = this.aspecto();
    let ndx = 0.0; let ndy = 0.0; let frente = 0;
    if (this.ortografica) {
      ndx = xc / (this.tamanhoOrto * asp); ndy = yc / this.tamanhoOrto;
      frente = zc >= this.near ? 1 : 0;
    } else if (zc > 1e-9) {
      const tv = math.tan(this.fov * 0.5);
      ndx = xc / (zc * tv * asp); ndy = yc / (zc * tv);
      frente = zc >= this.near ? 1 : 0;
    }
    out[0] = r[0] + (ndx * 0.5 + 0.5) * r[2];
    out[1] = r[1] + (0.5 - ndy * 0.5) * r[3];
    out[2] = zc;
    return frente;
  }
  /// Os 11 números de `setCamBuf`, com o aspecto do retângulo desta câmera.
  parametrosDeRender(out: Float64Array): void {
    const t = this.host;
    out[0] = t.wx; out[1] = t.wy; out[2] = t.wz; out[3] = t.wry; out[4] = t.wrx;
    out[5] = this.fov; out[6] = this.aspecto(); out[7] = this.near; out[8] = this.far;
    out[9] = this.ortografica ? 1.0 : 0.0; out[10] = this.tamanhoOrto;
  }
  static main(): Camera | null { return cameraPrincipal(); }
  static all(): Camera[] { return todasAsCameras(); }
}

/// Ordem de desenho: menor profundidade antes; no empate, a Main por último (fica por cima).
export function cameraVemAntes(a: Camera, b: Camera): boolean {
  return a.profundidade < b.profundidade || (a.profundidade === b.profundidade && a.isMain === 0 && b.isMain !== 0);
}
/// Ordenação por inserção, estável, sem alocação.
export function ordenarCameras(cams: Camera[], n: number): void {
  let i = 1;
  while (i < n) {
    const c = cams[i];
    let j = i - 1;
    while (j >= 0 && cameraVemAntes(c, cams[j])) { cams[j + 1] = cams[j]; j = j - 1; }
    cams[j + 1] = c;
    i = i + 1;
  }
}
const todas: Camera[] = [];
function cameraPrincipal(): Camera | null {
  const sc = activeScene();
  let achada: Camera | null = null;
  let primeira: Camera | null = null;
  if (sc !== null) {
    const lista: GameObject[] = sc.camObjs;
    let i = 0;
    while (i < lista.length && achada === null) {
      const o = lista[i];
      const c = o.behaviors[o.camIdx] as Camera;
      if (c.enabled !== 0 && activeInScene(sc.objects, o)) {
        if (c.isMain !== 0) achada = c;
        else if (primeira === null) primeira = c;
      }
      i = i + 1;
    }
  }
  return achada !== null ? achada : primeira;
}
function todasAsCameras(): Camera[] {
  todas.length = 0;
  const sc = activeScene();
  if (sc !== null) {
    let i = 0;
    while (i < sc.camObjs.length) {
      const o = sc.camObjs[i];
      const c = o.behaviors[o.camIdx] as Camera;
      if (c.enabled !== 0 && activeInScene(sc.objects, o)) todas.push(c);
      i = i + 1;
    }
  }
  ordenarCameras(todas, todas.length);
  return todas;
}
```

`camera_views.ts`:

```ts
// Várias câmeras por frame: cada câmera ativa desenha a cena na sua viewport,
// em ordem de profundidade (a maior por cima, a Main por último no empate). O
// mesmo código serve ao jogo exportado (game.ts), à aba Jogo e à prévia do editor.
import { Camera, ordenarCameras } from "../core/camera";
import { activeInScene } from "../core/gameobject";
import type { Scene } from "../core/scene";
import math from "@compat/math.ts";
import { setViewportBuf, setCamBuf, setFundoCor, setFundoCeu, CAM_FLOATS } from "./gpu3d";

export const MAX_VISTAS: number = 8;

export class VistasDeCamera {
  cams: Camera[];
  n: number;
  /// Área de destino em pixels da janela: x, y, w, h.
  area: Float64Array;
  /// Tamanho da janela em pixels: largura, altura.
  tela: Float64Array;
  camBuf: Float64Array;
  vpBuf: Float64Array;
  constructor() {
    this.cams = []; this.n = 0;
    this.area = new Float64Array(4); this.tela = new Float64Array(2);
    this.camBuf = new Float64Array(CAM_FLOATS); this.vpBuf = new Float64Array(5);
  }
}

/// Coleta as câmeras ativas (ou só `so`, ocupando a área inteira), ordena e
/// calcula o retângulo de cada uma. Devolve quantas.
export function coletarCameras(v: VistasDeCamera, sc: Scene, so: Camera | null): number {
  v.n = 0;
  const lista = sc.camObjs;
  let i = 0;
  while (i < lista.length && v.n < MAX_VISTAS) {
    const o = lista[i];
    const c = o.behaviors[o.camIdx] as Camera;
    if (c.enabled !== 0 && activeInScene(sc.objects, o) && (so === null || so === c)) {
      if (v.cams.length <= v.n) v.cams.push(c); else v.cams[v.n] = c;
      v.n = v.n + 1;
    }
    i = i + 1;
  }
  ordenarCameras(v.cams, v.n);
  const a = v.area;
  let k = 0;
  while (k < v.n) {
    const c = v.cams[k];
    if (so !== null) c.definirRetangulo(a[0], a[1], a[2], a[3]);
    else c.definirRetangulo(a[0] + c.viewportX * a[2], a[1] + c.viewportY * a[3], c.viewportW * a[2], c.viewportH * a[3]);
    k = k + 1;
  }
  return v.n;
}

/// Uma vista por câmera: viewport, fundo e câmera. Chamar antes dos desenhos.
export function aplicarVistas(win: number, v: VistasDeCamera): void {
  let k = 0;
  while (k < v.n) {
    const c = v.cams[k];
    const r = c.retanguloPx();
    v.vpBuf[0] = r[0] / v.tela[0]; v.vpBuf[1] = r[1] / v.tela[1];
    v.vpBuf[2] = r[2] / v.tela[0]; v.vpBuf[3] = r[3] / v.tela[1];
    v.vpBuf[4] = c.fundo === "nada" ? 0.0 : 1.0;
    setViewportBuf(win, v.vpBuf);
    if (c.fundo === "cor") setFundoCor(win, c.corFundo);
    else if (c.fundo === "ceu") setFundoCeu(win);
    c.parametrosDeRender(v.camBuf);
    setCamBuf(win, v.camBuf);
    k = k + 1;
  }
}

/// Os 9 números de frustum de `drawSceneObjects`. Com mais de uma vista (ou
/// uma ortográfica), tanH = -1: o laço não descarta ninguém — a fila de
/// desenho é uma só para todas as vistas.
export function frustumDasVistas(v: VistasDeCamera, out: f64[]): void {
  if (v.n === 1 && !v.cams[0].ortografica) {
    const c = v.cams[0];
    c.parametrosDeRender(v.camBuf);
    const b = v.camBuf;
    out[0] = b[0]; out[1] = b[1]; out[2] = b[2];
    out[3] = math.cos(b[3]); out[4] = math.sin(b[3]); out[5] = math.cos(b[4]); out[6] = math.sin(b[4]);
    out[8] = math.tan(b[5] * 0.5); out[7] = out[8] * b[6];
  } else {
    out[7] = 0.0 - 1.0; out[8] = 0.0 - 1.0;
  }
}

/// Posição [x, y, z] da câmera de cima (a última desenhada): ordena as luzes.
export function posicaoDaVista(v: VistasDeCamera, out: Float64Array): void {
  if (v.n > 0) { const t = v.cams[v.n - 1].host; out[0] = t.wx; out[1] = t.wy; out[2] = t.wz; }
}
```

`scenedraw.ts` (linhas 124-131): envolver os seis testes de descarte num `if (tanH >= 0.0) { ... }`, com o comentário "tanH < 0 = várias vistas (ver camera_views.frustumDasVistas)". A ordem de "inativo primeiro" continua a mesma.

`sceneio.ts` (118-122): `const c = new Camera(); if (typeof sd.fov === "number") c.fov = sd.fov; if (sd.isMain !== undefined) c.isMain = sd.isMain; return c;`.

`game.ts`:
- No topo: `const vistas = new VistasDeCamera(); const luzCam = new Float64Array(3); const luzLegada = new Float64Array(4); const fParams: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];`.
- O bloco de render (linhas 140-157) passa a:

```ts
  vistas.area[0] = 0.0; vistas.area[1] = 0.0; vistas.area[2] = W; vistas.area[3] = H;
  vistas.tela[0] = W; vistas.tela[1] = H;
  const nVistas = coletarCameras(vistas, scene, null);
  if (nVistas > 0) {
    aplicarVistas(WIN, vistas);
    frustumDasVistas(vistas, fParams);
    posicaoDaVista(vistas, luzCam);
  } else {
    // cena sem câmera: a câmera livre da sessão, como antes
    setFundoCeu(WIN);
    setCam(WIN, cx, cy, cz, yaw, pitch, FOV, W / H);
    frustumBegin(cx, cy, cz, yaw, pitch, FOV, W / H);
    frustumParams(fParams);
    luzCam[0] = cx; luzCam[1] = cy; luzCam[2] = cz;
  }
  luzLegada[0] = S.lightX; luzLegada[1] = S.lightY; luzLegada[2] = S.lightZ; luzLegada[3] = S.lightAmb;
  aplicarLuzes(WIN, scene, luzCam, luzLegada);
```

- No laço, `const vis = inFrustumFast(...)` vira `const vis = fParams[7] < 0.0 ? 1 : inFrustumFast(...)`.
- Com uma vista, `frustumDasVistas` já preparou os números, mas `inFrustumFast` lê o frustum do módulo `gpu3d`. Por isso, antes do laço: `if (nVistas === 1 && fParams[7] >= 0.0) frustumBegin(fParams[0], fParams[1], fParams[2], vistas.cams[0].host.wry, vistas.cams[0].host.wrx, vistas.cams[0].fov, fParams[7] / fParams[8]);`.
- `session.ts`: `setActiveScene(scene);` logo depois de `export const scene = new Scene("Main");`.
- Rodar `npm run components`.

- [ ] **Step 4: Run tests**

Run:
```
$RTS run tests/test_camera_api.ts
$RTS run tests/test_light.ts
npm run components && npm run test:components && npm run components:check && npm run check:params
$RTS run tests/test_scene.ts
$RTS run tests/claude-test-frustum-inline.ts
$RTS run tests/test_play_mode.ts
```
Expected: `[PASSOU] camera: ...` e as suítes antigas passando. Fumaça: `$RTS run game.ts` abre na vitrine igual a antes.

- [ ] **Step 5: Commit**

`git commit -am "feat(core): Camera com near/far/ortográfica/viewport/fundo, raio e projeção, várias câmeras por frame"`

---

### Task 5: `Ambiente` na cena — céu, neblina e luz ambiente enviados só quando mudam

**Files:**
- Create: `src/engine/core/ambiente.ts`
- Modify: `src/engine/core/scene.ts` (campo `ambiente: Ambiente`; `collectLights` passa `this.ambiente.sol`)
- Modify: `src/editor/sceneio.ts` (`sceneToJSON` 189-203; `sceneFromJSON` 240-285: validar o bloco ANTES de `targetScene.clear()`)
- Modify: `src/editor/scene_document.ts` (`authoredSignature`, linha 11: incluir `ambiente`)
- Modify: `src/editor/play_mode.ts` (guardar o Ambiente em `play()` e devolvê-lo em `stop()`)
- Modify: `src/engine/render/scene_lighting.ts` (nova `aplicarAmbiente`; `aplicarLuzes` grava `ultimaN`)
- Modify: `main.ts` e `game.ts` (`aplicarAmbiente(WIN, scene)` logo depois de `aplicarLuzes`)
- Test: `tests/test_ambiente.ts`

**Interfaces:**
- Consumes: `setSkyBuf`, `setFogBuf`, `loadTexture` (`gpu3d`); `luzBuf` e `n` de `aplicarLuzes` (Task 3).
- Produces:
  - `class Ambiente { ceu: CeuConfig; neblina: NeblinaConfig; luzAmbiente: LuzAmbienteConfig; sol: string; versao: number; pacote; enviado; neblinaPacote; neblinaEnviada }`
  - `CeuConfig { modo: string; topo, horizonte, chao: Float64Array(3); estrelas; exposicao; textura: string; tamanhoSol }`, `NeblinaConfig { cor: Float64Array(3); densidade }`, `LuzAmbienteConfig { modo: string; cor: Float64Array(3); intensidade }`
  - `SKY_FLOATS = 22`, `MODOS_CEU = ["estrelas","procedural","cor","panorama"]`, `MODOS_LUZ_AMBIENTE = ["cor","ceu"]`
  - `ambienteToData(a): any`, `ambienteFromData(dst, d): void` (lança `Error("ambiente.<campo>: ...")` e não toca `dst` quando falha), `copiarAmbiente(dst, src)`, `ambientePadrao(dst)`
  - `empacotarCeu(a: Ambiente, sol: Float64Array, texturaId: number, out: Float64Array): void`
  - `ambienteSync(a: Ambiente, sol: Float64Array, texturaId: number): number` (bit 1 = céu, bit 2 = neblina; atualiza `enviado` e `versao`)
  - `aplicarAmbiente(win: number, sc: Scene): number`

- [ ] **Step 1: Write the failing test**

`tests/test_ambiente.ts`:

```ts
// Teste SEM JANELA do Ambiente: padrão = visual de hoje, envio só quando muda,
// ida e volta no JSON da cena, JSON inválido recusado antes de mexer na cena,
// e o Play devolvendo o Ambiente ao parar.
//
//   rts.exe run tests/test_ambiente.ts
import io from "@compat/io.ts";
import { Ambiente, SKY_FLOATS, ambienteToData, ambienteFromData, empacotarCeu, ambienteSync } from "@engine/core/ambiente";
import { sceneToJSON, sceneFromJSON } from "@editor/sceneio";
import { scene } from "@editor/control/session";
import { playMode } from "@editor/play_mode";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const sol = new Float64Array(3); sol[1] = -1.0;
const pac = new Float64Array(SKY_FLOATS);

// 1) padrão = céu estrelado de hoje, sem neblina, ambiente 0,25
const a = new Ambiente();
check(a.ceu.modo === "estrelas" && a.neblina.densidade === 0.0 && a.luzAmbiente.intensidade === 0.25, "padrão de hoje");
empacotarCeu(a, sol, 0, pac);
check(pac[0] === 0.0 && pac[15] === 1.0 && pac[17] === 1.0 && pac[21] === 0.25, "modo 0, exposição 1, ambiente cor 0,25");
check(pac[10] === 0.0 && pac[11] === -1.0, "direção do sol copiada");

// 2) envio só quando muda
check(ambienteSync(a, sol, 0) === 3, "primeira vez envia céu e neblina");
check(ambienteSync(a, sol, 0) === 0, "nada mudou: nada enviado");
const v0 = a.versao;
a.ceu.topo[0] = 0.9;
check(ambienteSync(a, sol, 0) === 1 && a.versao === v0 + 1, "escrever ceu.topo direto é detectado e sobe a versão");
a.neblina.densidade = 0.02;
check(ambienteSync(a, sol, 0) === 2, "só a neblina mudou");
sol[0] = 0.5;
check(ambienteSync(a, sol, 0) === 1, "o sol girou: céu reenviado");
check(ambienteSync(a, sol, 7) === 1, "a textura carregou: céu reenviado");

// 3) ida e volta pelo JSON da cena
scene.clear();
scene.ambiente.ceu.modo = "procedural"; scene.ambiente.ceu.horizonte[2] = 0.33;
scene.ambiente.neblina.densidade = 0.05; scene.ambiente.luzAmbiente.modo = "ceu"; scene.ambiente.sol = "Sol";
const json = sceneToJSON();
scene.ambiente.ceu.modo = "cor"; scene.ambiente.sol = "";
sceneFromJSON(json);
check(scene.ambiente.ceu.modo === "procedural" && scene.ambiente.ceu.horizonte[2] === 0.33, "céu volta do JSON");
check(scene.ambiente.neblina.densidade === 0.05 && scene.ambiente.luzAmbiente.modo === "ceu" && scene.ambiente.sol === "Sol", "neblina, ambiente e sol voltam");

// 4) cena sem bloco = padrão de hoje
sceneFromJSON("{\"objects\":[]}");
check(scene.ambiente.ceu.modo === "estrelas" && scene.ambiente.neblina.densidade === 0.0 && scene.ambiente.sol === "", "sem bloco: visual de hoje");

// 5) bloco inválido: erro legível e a cena atual intocada
scene.createGameObject("Fica");
const ruins: string[] = [
  "{\"objects\":[],\"ambiente\":{\"ceu\":{\"topo\":[1,2]}}}",
  "{\"objects\":[],\"ambiente\":{\"ceu\":{\"modo\":\"nublado\"}}}",
  "{\"objects\":[],\"ambiente\":{\"neblina\":{\"densidade\":-1}}}",
  "{\"objects\":[],\"ambiente\":{\"luzAmbiente\":{\"intensidade\":\"alta\"}}}",
  "{\"objects\":[],\"ambiente\":{\"sol\":3}}",
];
let r = 0;
while (r < ruins.length) {
  let erro = "";
  try { sceneFromJSON(ruins[r]); } catch (e) { erro = String(e); }
  check(erro.indexOf("ambiente.") >= 0, "erro legível no caso " + r + ": " + erro);
  check(scene.objects.length === 1 && scene.objects[0].name === "Fica", "cena intocada no caso " + r);
  r = r + 1;
}
const d = new Ambiente();
let erroDireto = "";
try { ambienteFromData(d, { ceu: { exposicao: "x" } }); } catch (e) { erroDireto = String(e); }
check(erroDireto.indexOf("ambiente.ceu.exposicao") >= 0 && d.ceu.exposicao === 1.0, "ambienteFromData não toca o destino quando falha");
check(ambienteToData(d).ceu.modo === "estrelas", "ambienteToData");

// 6) Play: o que a simulação muda no Ambiente volta ao parar
scene.ambiente.ceu.exposicao = 1.0;
check(playMode.play(), "play");
scene.ambiente.ceu.exposicao = 3.0;
playMode.stop();
check(scene.ambiente.ceu.exposicao === 1.0, "parar devolve o Ambiente de edição");
io.print("[PASSOU] ambiente: padrão, envio só quando muda, JSON ida e volta, sem bloco, inválido, Play");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_ambiente.ts`
Expected: FAIL — `cannot resolve module "@engine/core/ambiente"`.

- [ ] **Step 3: Implementation**

`ambiente.ts`:

```ts
// Engine RTS — AMBIENTE: configurações de render da cena (o RenderSettings da
// Unity): céu, neblina, luz ambiente e qual direcional é o sol. Vive em
// `scene.ambiente` e no JSON da cena como bloco "ambiente". Scripts leem e
// escrevem os campos direto; `ambienteSync` compara o empacotado com o último
// enviado, e só então o renderer recebe setSky/setFog.
export const SKY_FLOATS: number = 22;
export const MODOS_CEU: string[] = ["estrelas", "procedural", "cor", "panorama"];
export const MODOS_LUZ_AMBIENTE: string[] = ["cor", "ceu"];
/// Códigos do `setSky` para `luzAmbiente.modo` (0 = escalar legado do setLight).
const AMBIENTE_COR: number = 1;
const AMBIENTE_CEU: number = 2;

function rgb(r: number, g: number, b: number): Float64Array {
  const v = new Float64Array(3); v[0] = r; v[1] = g; v[2] = b; return v;
}
export class CeuConfig {
  modo: string; topo: Float64Array; horizonte: Float64Array; chao: Float64Array;
  estrelas: number; exposicao: number; textura: string; tamanhoSol: number;
  constructor() {
    this.modo = "estrelas"; this.topo = rgb(0.25, 0.45, 0.80); this.horizonte = rgb(0.70, 0.80, 0.90);
    this.chao = rgb(0.25, 0.23, 0.20); this.estrelas = 0.0; this.exposicao = 1.0; this.textura = ""; this.tamanhoSol = 0.04;
  }
}
export class NeblinaConfig {
  cor: Float64Array; densidade: number;
  constructor() { this.cor = rgb(0.60, 0.65, 0.70); this.densidade = 0.0; }
}
export class LuzAmbienteConfig {
  modo: string; cor: Float64Array; intensidade: number;
  constructor() { this.modo = "cor"; this.cor = rgb(1.0, 1.0, 1.0); this.intensidade = 0.25; }
}
export class Ambiente {
  ceu: CeuConfig; neblina: NeblinaConfig; luzAmbiente: LuzAmbienteConfig;
  /// Nome do GameObject da direcional que dá a direção do sol ("" = a primeira).
  sol: string;
  /// Sobe a cada envio ao renderer (a UI do Ambiente compara com a sua).
  versao: number;
  pacote: Float64Array; enviado: Float64Array; neblinaPacote: Float64Array; neblinaEnviada: Float64Array;
  constructor() {
    this.ceu = new CeuConfig(); this.neblina = new NeblinaConfig(); this.luzAmbiente = new LuzAmbienteConfig();
    this.sol = ""; this.versao = 0;
    this.pacote = new Float64Array(SKY_FLOATS); this.enviado = new Float64Array(SKY_FLOATS);
    this.neblinaPacote = new Float64Array(4); this.neblinaEnviada = new Float64Array(4);
    this.enviado[0] = 0.0 - 1.0; this.neblinaEnviada[3] = 0.0 - 1.0;   // força o 1º envio
  }
}

function copiar3(dst: Float64Array, src: Float64Array): void { dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2]; }
export function copiarAmbiente(dst: Ambiente, src: Ambiente): void {
  dst.ceu.modo = src.ceu.modo; copiar3(dst.ceu.topo, src.ceu.topo); copiar3(dst.ceu.horizonte, src.ceu.horizonte);
  copiar3(dst.ceu.chao, src.ceu.chao); dst.ceu.estrelas = src.ceu.estrelas; dst.ceu.exposicao = src.ceu.exposicao;
  dst.ceu.textura = src.ceu.textura; dst.ceu.tamanhoSol = src.ceu.tamanhoSol;
  copiar3(dst.neblina.cor, src.neblina.cor); dst.neblina.densidade = src.neblina.densidade;
  dst.luzAmbiente.modo = src.luzAmbiente.modo; copiar3(dst.luzAmbiente.cor, src.luzAmbiente.cor);
  dst.luzAmbiente.intensidade = src.luzAmbiente.intensidade; dst.sol = src.sol;
}
export function ambientePadrao(dst: Ambiente): void { copiarAmbiente(dst, new Ambiente()); }

function arr3(v: Float64Array): number[] { const a: number[] = [v[0], v[1], v[2]]; return a; }
export function ambienteToData(a: Ambiente): any {
  return {
    ceu: { modo: a.ceu.modo, topo: arr3(a.ceu.topo), horizonte: arr3(a.ceu.horizonte), chao: arr3(a.ceu.chao),
           estrelas: a.ceu.estrelas, exposicao: a.ceu.exposicao, textura: a.ceu.textura, tamanhoSol: a.ceu.tamanhoSol },
    neblina: { cor: arr3(a.neblina.cor), densidade: a.neblina.densidade },
    luzAmbiente: { modo: a.luzAmbiente.modo, cor: arr3(a.luzAmbiente.cor), intensidade: a.luzAmbiente.intensidade },
    sol: a.sol,
  };
}

function erro(campo: string, motivo: string): Error { return new Error("ambiente." + campo + ": " + motivo); }
function lerNumero(v: any, campo: string, padrao: number): number {
  if (v === undefined) return padrao;
  if (typeof v !== "number" || !Number.isFinite(v)) throw erro(campo, "deve ser um número");
  if (v < 0.0) throw erro(campo, "deve ser >= 0");
  return v;
}
function lerCor(v: any, campo: string, dst: Float64Array): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length !== 3) throw erro(campo, "deve ser [r, g, b]");
  let i = 0;
  while (i < 3) {
    if (typeof v[i] !== "number" || !Number.isFinite(v[i]) || v[i] < 0.0) throw erro(campo, "componentes >= 0");
    dst[i] = v[i]; i = i + 1;
  }
}
function lerModo(v: any, campo: string, validos: string[], padrao: string): string {
  if (v === undefined) return padrao;
  if (typeof v !== "string" || validos.indexOf(v) < 0) throw erro(campo, "use " + validos.join(", "));
  return v;
}
function lerTexto(v: any, campo: string, padrao: string): string {
  if (v === undefined) return padrao;
  if (typeof v !== "string") throw erro(campo, "deve ser texto");
  return v;
}
/// Lê o bloco num Ambiente temporário e só copia para `dst` se tudo for válido.
export function ambienteFromData(dst: Ambiente, d: any): void {
  if (d === null || typeof d !== "object") throw erro("", "deve ser um objeto");
  const t = new Ambiente();
  const c = d.ceu !== undefined ? d.ceu : {};
  const n = d.neblina !== undefined ? d.neblina : {};
  const l = d.luzAmbiente !== undefined ? d.luzAmbiente : {};
  t.ceu.modo = lerModo(c.modo, "ceu.modo", MODOS_CEU, t.ceu.modo);
  lerCor(c.topo, "ceu.topo", t.ceu.topo); lerCor(c.horizonte, "ceu.horizonte", t.ceu.horizonte); lerCor(c.chao, "ceu.chao", t.ceu.chao);
  t.ceu.estrelas = lerNumero(c.estrelas, "ceu.estrelas", t.ceu.estrelas);
  t.ceu.exposicao = lerNumero(c.exposicao, "ceu.exposicao", t.ceu.exposicao);
  t.ceu.textura = lerTexto(c.textura, "ceu.textura", t.ceu.textura);
  t.ceu.tamanhoSol = lerNumero(c.tamanhoSol, "ceu.tamanhoSol", t.ceu.tamanhoSol);
  lerCor(n.cor, "neblina.cor", t.neblina.cor);
  t.neblina.densidade = lerNumero(n.densidade, "neblina.densidade", t.neblina.densidade);
  t.luzAmbiente.modo = lerModo(l.modo, "luzAmbiente.modo", MODOS_LUZ_AMBIENTE, t.luzAmbiente.modo);
  lerCor(l.cor, "luzAmbiente.cor", t.luzAmbiente.cor);
  t.luzAmbiente.intensidade = lerNumero(l.intensidade, "luzAmbiente.intensidade", t.luzAmbiente.intensidade);
  t.sol = lerTexto(d.sol, "sol", t.sol);
  copiarAmbiente(dst, t);
}

/// Os 22 floats do `setSky` (mesma ordem de SKY_IN em rts-egui/.../lights.rs).
export function empacotarCeu(a: Ambiente, sol: Float64Array, texturaId: number, out: Float64Array): void {
  const m = MODOS_CEU.indexOf(a.ceu.modo);
  out[0] = m >= 0 ? m : 0;
  out[1] = a.ceu.topo[0]; out[2] = a.ceu.topo[1]; out[3] = a.ceu.topo[2];
  out[4] = a.ceu.horizonte[0]; out[5] = a.ceu.horizonte[1]; out[6] = a.ceu.horizonte[2];
  out[7] = a.ceu.chao[0]; out[8] = a.ceu.chao[1]; out[9] = a.ceu.chao[2];
  out[10] = sol[0]; out[11] = sol[1]; out[12] = sol[2];
  out[13] = a.ceu.tamanhoSol; out[14] = a.ceu.estrelas; out[15] = a.ceu.exposicao; out[16] = texturaId;
  out[17] = a.luzAmbiente.modo === "ceu" ? AMBIENTE_CEU : AMBIENTE_COR;
  out[18] = a.luzAmbiente.cor[0]; out[19] = a.luzAmbiente.cor[1]; out[20] = a.luzAmbiente.cor[2];
  out[21] = a.luzAmbiente.intensidade;
}
function iguais(a: Float64Array, b: Float64Array): boolean {
  let i = 0; let ok = true;
  while (ok && i < a.length) { if (a[i] !== b[i]) ok = false; i = i + 1; }
  return ok;
}
function copiarBuf(dst: Float64Array, src: Float64Array): void { let i = 0; while (i < src.length) { dst[i] = src[i]; i = i + 1; } }
/// 1 = céu mudou, 2 = neblina mudou (soma). Atualiza os "enviados" e a versão.
export function ambienteSync(a: Ambiente, sol: Float64Array, texturaId: number): number {
  let bits = 0;
  empacotarCeu(a, sol, texturaId, a.pacote);
  if (!iguais(a.pacote, a.enviado)) { copiarBuf(a.enviado, a.pacote); bits = bits + 1; }
  a.neblinaPacote[0] = a.neblina.cor[0]; a.neblinaPacote[1] = a.neblina.cor[1];
  a.neblinaPacote[2] = a.neblina.cor[2]; a.neblinaPacote[3] = a.neblina.densidade;
  if (!iguais(a.neblinaPacote, a.neblinaEnviada)) { copiarBuf(a.neblinaEnviada, a.neblinaPacote); bits = bits + 2; }
  if (bits !== 0) a.versao = a.versao + 1;
  return bits;
}
```

`scene.ts`:
- Campo `ambiente: Ambiente`, com `new Ambiente()` no construtor.
- `collectLights` passa `this.ambiente.sol` a `coletarLuzes`.
- `clear()` não reseta o Ambiente: quem carrega a cena decide.

`sceneio.ts`:
- `sceneToJSON` acrescenta `ambiente: ambienteToData(scene.ambiente)` ao objeto `data`.
- Em `sceneFromJSON`, logo depois das validações de `camera`/`light` (linha 246):

```ts
  const ambienteLido = new Ambiente();
  if (data.ambiente !== undefined) ambienteFromData(ambienteLido, data.ambiente);
```

  e, junto do `if (typeof data.name === "string")` (linha 276), `copiarAmbiente(targetScene.ambiente, ambienteLido);`. Uma cena sem bloco recebe o padrão, e um bloco inválido lança antes de `targetScene.clear()`.

`scene_document.ts`: `authoredSignature` devolve `JSON.stringify({ name: data.name, objects: data.objects, light: data.light, ambiente: data.ambiente })`.

`play_mode.ts`:
- Campo `ambiente: Ambiente = new Ambiente()`.
- `play()`: `copiarAmbiente(this.ambiente, scene.ambiente);` junto de `this.light = ...`.
- `stop()`: `copiarAmbiente(scene.ambiente, this.ambiente);` junto da restauração da luz.

`scene_lighting.ts` (acrescentar; `aplicarLuzes` passa a gravar `ultimaN = n` antes do `return`):

```ts
import { ambienteSync } from "../core/ambiente";
import { setSkyBuf, setFogBuf, loadTexture } from "./gpu3d";
import { logWarn } from "../core/logger";

/// Direção padrão do sol sem direcional (a mesma de SOL_PADRAO no runtime).
const SOL_PADRAO_X: number = 0.0 - 0.3015113;
const SOL_PADRAO_Y: number = 0.0 - 0.9045340;
const SOL_PADRAO_Z: number = 0.0 - 0.3015113;
const solDir = new Float64Array(3);
let ultimaN = 0;
let texturaCaminho = "";
let texturaId = 0;

/// Id da textura do panorama; carrega uma vez por caminho (0 = sem textura).
function texturaDoCeu(win: number, caminho: string): number {
  if (caminho !== texturaCaminho) {
    texturaCaminho = caminho; texturaId = 0;
    if (caminho.length > 0) {
      try { texturaId = loadTexture(win, caminho); }
      catch (e) { logWarn("Céu: textura '" + caminho + "' não carregou: " + String(e)); }
    }
  }
  return texturaId;
}
/// Envia setSky/setFog só quando o Ambiente (ou a direção do sol, ou a textura)
/// mudou. Trocar de cena copia os campos para o MESMO `scene.ambiente`, e a
/// comparação detecta a mudança.
export function aplicarAmbiente(win: number, sc: Scene): number {
  if (ultimaN > 0 && luzBuf[0] === LUZ_DIRECIONAL) { solDir[0] = luzBuf[4]; solDir[1] = luzBuf[5]; solDir[2] = luzBuf[6]; }
  else { solDir[0] = SOL_PADRAO_X; solDir[1] = SOL_PADRAO_Y; solDir[2] = SOL_PADRAO_Z; }
  const a = sc.ambiente;
  const bits = ambienteSync(a, solDir, texturaDoCeu(win, a.ceu.textura));
  if ((bits & 1) !== 0) setSkyBuf(win, a.pacote);
  if ((bits & 2) !== 0) setFogBuf(win, a.neblinaPacote);
  return bits;
}
```

`main.ts` (logo depois de `aplicarLuzes`, Task 3) e `game.ts` (idem): `aplicarAmbiente(WIN, scene);`.

- [ ] **Step 4: Run tests**

Run:
```
$RTS run tests/test_ambiente.ts
$RTS run tests/test_light.ts
$RTS run tests/claude-test-sceneio-roundtrip.ts
$RTS run tests/test_scene_document.ts
$RTS run tests/test_play_mode.ts
npm run check:params
```
Expected: `[PASSOU] ambiente: ...` e as suítes antigas verdes.

- [ ] **Step 5: Commit**

`git commit -am "feat(core): Ambiente da cena (céu, neblina, luz ambiente, sol) no JSON, enviado só quando muda"`

---

### Task 6: `@editor/api`, `registerCommand`, ganchos do editor e `@editorOnly` fora do jogo

**Files:**
- Create: `src/editor/api.ts`, `src/editor/editor_host.ts`, `src/editor/control/builtin_commands.ts`
- Create: `tools/game-build/tsconfig.json`, `tools/game-build/entry.ts`, `tools/game-build/claude-test-registro.ts`
- Create: `tests/editor-static.test.mjs`, `assets/pacotes/README.txt` (uma linha: pacotes de script; `@editorOnly` fica fora do jogo)
- Modify: `tools/generate-components.mjs` (`ROOTS` + `assets/pacotes`; `isEditorOnly`; `createProject`; `discoverEditorExtensions`; `renderComponents` com dois registros; `renderEditorExtensions`; `generateComponents`)
- Modify: `src/editor/sceneio.ts` (linha 33: import pelo alias `@engine/generated/components`)
- Modify: `src/editor/control/dispatch.ts` (snapshot de registrados depois da linha 71; `default`, linha 226)
- Modify: `src/editor/control/commands/query.ts` (`cmdHelp`, linha 55) e `commands/doc.ts` (antes do laço, linha 106)
- Modify: `src/editor/scene_document.ts` (`save`, `complete`) e `src/editor/play_mode.ts` (`play`, `stop`): emitir eventos
- Modify: `src/editor/ui_config.ts` (`UI_EDITOR_API`)
- Modify: `main.ts` (import `@engine/generated/editor_extensions`; `instalarEditorReal()` logo depois de `ctrlServe(7777)`, linha 398)
- Modify: `tools/editor-build.mjs` (linha 17), `package.json` (`build:game`), `tools/check-params.mjs` (`dirs`)
- Regenerate: `src/engine/generated/{components.ts,components_game.ts,component_catalog.ts,editor_extensions.ts}`
- Test: `tests/test_editor_api.ts`, `tests/component-generation.test.mjs`, `tests/editor-static.test.mjs`

**Interfaces:**
- Produces (`@editor/api`):
  - `type ComandoFn = (partes: string[]) => string`, `type GanchoFn = (arg: string) => void`, `EVENTOS_EDITOR`, `SPAWN_DISTANCE = 8.0`
  - `class EditorHost { ativo: boolean; scene(); selection(); select(o); snapshot(rotulo); log(msg); viewPose(out); inspect(b, titulo) }` (no-ops)
  - `instalarHost(h: EditorHost): void`, `editorAtivo(): boolean`
  - `registerCommand(nome: string, ajuda: string, muta: boolean, fn: ComandoFn): boolean`
  - `commandIndex(nome: string): number`, `commandMutates(i: number): boolean`, `runCommand(i: number, partes: string[]): string`, `commandHelpLine(): string`, `commandDocLines(out: string[]): void`
  - `emitEditorEvent(evento: string, arg: string): void`
  - `class Editor { static scene(): Scene | null; static selection(): GameObject | null; static select(o); static snapshot(rotulo); static log(msg); static on(evento, fn): boolean; static viewPose(out: Float64Array /*5*/); static spawnPoint(out: Float64Array /*5*/); static inspect(b: Behavior, titulo: string) }`
- Produces: `class EditorHostReal extends EditorHost` (campo `janela: ((b: Behavior, titulo: string) => void) | null`), `instalarEditorReal(): EditorHostReal`; `BUILTIN_COMMANDS: string[]`
- Produces (gerador): `ROOTS`, `MENU_ROOTS`, `isEditorOnly(source)`, `discoverEditorExtensions(root) → { editorFiles: string[], menuItems: [] }`, `renderEditorExtensions(ext)`; entradas com `editorOnly`; `components.ts`/`components_game.ts` exportam `REGISTRO = "editor" | "jogo"`.

- [ ] **Step 1: Write the failing test**

`tests/test_editor_api.ts`:

```ts
// Teste SEM JANELA da API de extensão do editor: no-ops fora do editor,
// registerCommand (help, doc, resposta, erro, snapshot só se muta, nomes
// recusados), ganchos (salvar, abrirCena, entrarPlay, sairPlay), seleção.
//
//   rts.exe run tests/test_editor_api.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { unlinkSync } from "node:fs";
import { registerCommand, Editor } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene, S } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
import { sceneDocument } from "@editor/scene_document";
import { REGISTRO } from "@engine/generated/components";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
check(REGISTRO === "editor", "o editor usa o registro completo");

// fora do editor: no-ops, sem erro
check(Editor.scene() === null && Editor.selection() === null, "sem host: nada");
Editor.log("x"); Editor.snapshot("x"); Editor.select(null);
instalarEditorReal();
check(Editor.scene() === scene, "com host: a cena do editor");

const chamadas: string[] = [];
check(registerCommand("teste_eco", "teste_eco <texto> :: ecoa o texto", false, (p: string[]) => { chamadas.push(p[1]); return "eco " + p[1]; }), "registra");
check(!registerCommand("move", "x", false, (p: string[]) => ""), "nome embutido recusado");
check(!registerCommand("teste_eco", "x", false, (p: string[]) => ""), "duplicado recusado");
check(!registerCommand("com espaco", "x", false, (p: string[]) => ""), "nome com espaço recusado");
check(registerCommand("teste_cria", "teste_cria :: cria um objeto", true, (p: string[]) => { scene.createGameObject("Criado"); return "[ok] criado"; }), "registra o que muta");
check(registerCommand("teste_falha", "teste_falha :: lança", false, (p: string[]) => { throw new Error("quebrou"); }), "registra o que lança");

scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "teste_eco oi") === "[ok] eco oi" && chamadas.length === 1, "resposta ganha [ok]");
check(history.undoDepth() === 0, "muta = false não empilha Desfazer");
check(execCommand(800, 600, "teste_cria").indexOf("[ok]") === 0 && history.undoDepth() === 1 && scene.objects.length === 1, "muta = true: 1 snapshot");
check(execCommand(800, 600, "undo").indexOf("[ok]") === 0 && scene.objects.length === 0, "Desfazer tira o criado");
check(execCommand(800, 600, "teste_falha").indexOf("[erro] teste_falha: ") === 0, "exceção vira [erro] com o nome do comando");
check(execCommand(800, 600, "help").indexOf("teste_eco <texto>") > 0, "aparece no help");
check(execCommand(800, 600, "doc teste_cria").indexOf("cria um objeto") > 0, "aparece no doc");
check(execCommand(800, 600, "nao_existe").indexOf("[erro] desconhecido") === 0, "desconhecido continua desconhecido");

// ganchos
const eventos: string[] = [];
check(Editor.on("salvar", (a: string) => { eventos.push("salvar:" + a); }), "gancho salvar");
check(Editor.on("abrirCena", (a: string) => { eventos.push("abrir:" + a); }), "gancho abrirCena");
check(Editor.on("entrarPlay", (a: string) => { eventos.push("play"); }), "gancho entrarPlay");
check(Editor.on("sairPlay", (a: string) => { eventos.push("stop"); }), "gancho sairPlay");
check(!Editor.on("inventado", (a: string) => {}), "evento desconhecido recusado");
Editor.on("salvar", (a: string) => { throw new Error("gancho ruim"); });
fs.create_dir_all("build");
const arquivo = "build/claude-teste-api.json";
scene.createGameObject("Salvo");
check(sceneDocument.save(arquivo), "salvar funciona mesmo com um gancho que lança");
check(eventos.indexOf("salvar:" + arquivo) >= 0, "salvar disparou");
sceneDocument.request("open", arquivo); sceneDocument.complete();
check(eventos.indexOf("abrir:" + arquivo) >= 0, "abrirCena disparou");
check(playMode.play() && eventos.indexOf("play") >= 0, "entrarPlay disparou");
playMode.stop();
check(eventos.indexOf("stop") >= 0, "sairPlay disparou");
unlinkSync(arquivo);

// seleção e pose da vista
Editor.select(scene.objects[0]);
check(S.selected === 0 && Editor.selection() === scene.objects[0], "select/selection");
const pose = new Float64Array(5);
S.camX = 1.0; S.camY = 2.0; S.camZ = 3.0; S.camYaw = 0.0; S.camPitch = 0.0;
Editor.viewPose(pose); check(pose[0] === 1.0 && pose[2] === 3.0, "viewPose");
Editor.spawnPoint(pose); check(Math.abs(pose[2] - 11.0) < 1e-9 && pose[0] === 1.0, "spawnPoint a 8 u à frente");
io.print("[PASSOU] editor api: no-ops, registerCommand, help/doc, snapshot só se muta, ganchos, select");
```

`tools/game-build/claude-test-registro.ts`:

```ts
// Roda com o tsconfig do build do jogo (o mais próximo da ENTRADA): o alias
// "@engine/generated/components" tem de cair no registro sem @editorOnly.
//   rts.exe run tools/game-build/claude-test-registro.ts
import io from "@compat/io.ts";
import { REGISTRO } from "@engine/generated/components";
import { createComponent } from "@editor/components";
if (REGISTRO !== "jogo") throw new Error("o build do jogo deveria usar components_game, veio " + REGISTRO);
if (createComponent("Light").kind() !== 7) throw new Error("componente comum sumiu do jogo");
io.print("[PASSOU] build do jogo usa o registro sem @editorOnly");
```

Em `tests/component-generation.test.mjs` (e `renderEditorExtensions, discoverEditorExtensions` no import do topo):

```js
test('@editorOnly keeps files out of the game registry and loads them only in the editor', t => {
  const { root, write } = fixture(t);
  write('assets/pacotes/luz/Game.ts', importBase + 'export class Jogo extends Behavior { v: number = 1; }');
  write('assets/pacotes/luz/Tool.ts', '/** @editorOnly */\n' + importBase + 'export class Ferramenta extends Behavior { v: number = 2; }');
  write('assets/pacotes/luz/cmds.ts', '/** @editorOnly */\nexport const x = 1;');
  const entries = discoverComponents(root);
  assert.deepEqual(entries.map(e => [e.name, e.editorOnly]), [['Ferramenta', true], ['Jogo', false]]);
  const out = renderComponents(entries);
  assert.match(out['src/engine/generated/components.ts'], /Ferramenta/);
  assert.match(out['src/engine/generated/components.ts'], /REGISTRO = "editor"/);
  assert.doesNotMatch(out['src/engine/generated/components_game.ts'], /Ferramenta/);
  assert.match(out['src/engine/generated/components_game.ts'], /REGISTRO = "jogo"/);
  const ext = renderEditorExtensions(discoverEditorExtensions(root))['src/engine/generated/editor_extensions.ts'];
  assert.match(ext, /import "\.\.\/\.\.\/\.\.\/assets\/pacotes\/luz\/Tool";/);
  assert.match(ext, /import "\.\.\/\.\.\/\.\.\/assets\/pacotes\/luz\/cmds";/);
  assert.doesNotMatch(ext, /luz\/Game/);
});
```

`tests/editor-static.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('BUILTIN_COMMANDS lists exactly the dispatch switch cases', () => {
  const cases = [...read('src/editor/control/dispatch.ts').matchAll(/case "([a-z]+)":/g)].map(m => m[1]).sort();
  const listed = [...read('src/editor/control/builtin_commands.ts').matchAll(/"([a-z]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(listed, cases);
});
test('the game build swaps the component registry by exact alias', () => {
  const cfg = JSON.parse(read('tools/game-build/tsconfig.json'));
  assert.equal(cfg.extends, '../../tsconfig.json');
  assert.deepEqual(cfg.compilerOptions.paths['@engine/generated/components'], ['../../src/engine/generated/components_game.ts']);
  assert.match(read('tools/editor-build.mjs'), /tools\/game-build\/entry\.ts/);
  assert.doesNotMatch(read('src/editor/sceneio.ts'), /\.\.\/engine\/generated\/components/);
  assert.doesNotMatch(read('game.ts'), /editor_extensions/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_editor_api.ts ; node --test tests/component-generation.test.mjs tests/editor-static.test.mjs`
Expected: FAIL — `cannot resolve module "@editor/api"`; `renderEditorExtensions is not a function`; `ENOENT ... builtin_commands.ts`.

- [ ] **Step 3: Implementation**

`builtin_commands.ts`: `export const BUILTIN_COMMANDS: string[] = [ ... ];`, com os nomes de todos os `case "…":` de `dispatch.ts`, em ordem alfabética, um por linha. O teste estático mantém a lista em dia.

`api.ts`:

```ts
// @editor/api — o que um script de pacote usa para estender o editor: comandos
// do WebSocket, ganchos, seleção, Desfazer e a cena editada. No jogo exportado
// não há host instalado: tudo vira no-op, sem erro.
//
// Importa só TIPOS, o logger e a lista de comandos embutidos: um componente de
// pacote pode importar isto sem fechar ciclo pelo registro gerado
// (sceneio → components → componente → api).
import type { Scene } from "@engine/core/scene";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { logWarn, logError } from "@engine/core/logger";
import { BUILTIN_COMMANDS } from "./control/builtin_commands";
import math from "@compat/math.ts";

export type ComandoFn = (partes: string[]) => string;
export type GanchoFn = (arg: string) => void;
export const EVENTOS_EDITOR: string[] = ["salvar", "abrirCena", "entrarPlay", "sairPlay"];
/// Distância à frente da câmera do editor onde objetos novos nascem.
export const SPAWN_DISTANCE: number = 8.0;
const COLCHETE: number = 91;   // '['
const SEPARADOR_AJUDA: string = " :: ";

/// O editor real sobrescreve (editor_host.ts). Aqui, os no-ops do jogo.
export class EditorHost {
  ativo: boolean;
  constructor() { this.ativo = false; }
  scene(): Scene | null { return null; }
  selection(): GameObject | null { return null; }
  select(o: GameObject | null): void {}
  snapshot(rotulo: string): void {}
  log(msg: string): void {}
  /// [x, y, z, yaw, pitch] da câmera da vista de Cena.
  viewPose(out: Float64Array): void {}
  inspect(b: Behavior, titulo: string): void {}
}
class EstadoEditor {
  host: EditorHost; nomes: string[]; ajudas: string[]; mutam: boolean[]; fns: ComandoFn[];
  ganchoEvento: string[]; ganchoFn: GanchoFn[];
  constructor() {
    this.host = new EditorHost(); this.nomes = []; this.ajudas = []; this.mutam = []; this.fns = [];
    this.ganchoEvento = []; this.ganchoFn = [];
  }
}
const estado = new EstadoEditor();

export function instalarHost(h: EditorHost): void { estado.host = h; }
export function editorAtivo(): boolean { return estado.host.ativo; }

export function registerCommand(nome: string, ajuda: string, muta: boolean, fn: ComandoFn): boolean {
  let ok = nome.length > 0 && nome.indexOf(" ") < 0;
  if (ok && (BUILTIN_COMMANDS.indexOf(nome) >= 0 || estado.nomes.indexOf(nome) >= 0)) ok = false;
  if (ok) { estado.nomes.push(nome); estado.ajudas.push(ajuda); estado.mutam.push(muta); estado.fns.push(fn); }
  else logWarn("registerCommand recusou '" + nome + "' (vazio, com espaço, embutido ou repetido)");
  return ok;
}
export function commandIndex(nome: string): number { return estado.nomes.indexOf(nome); }
export function commandMutates(i: number): boolean { return estado.mutam[i]; }
export function runCommand(i: number, partes: string[]): string {
  let out = "";
  try { out = estado.fns[i](partes); }
  catch (error) { out = "[erro] " + estado.nomes[i] + ": " + String(error); }
  if (out.length === 0 || out.charCodeAt(0) !== COLCHETE) out = "[ok] " + out;
  return out;
}
export function commandHelpLine(): string {
  let s = "";
  let i = 0;
  while (i < estado.nomes.length) {
    s = s + (i === 0 ? " || SCRIPTS: " : " | ") + estado.ajudas[i].split(SEPARADOR_AJUDA)[0];
    i = i + 1;
  }
  return s;
}
/// Linhas no formato do `doc`: "assinatura :: descrição :: exemplo".
export function commandDocLines(out: string[]): void {
  let i = 0;
  while (i < estado.nomes.length) {
    const a = estado.ajudas[i];
    out.push(a.indexOf(SEPARADOR_AJUDA) >= 0 ? a + SEPARADOR_AJUDA + estado.nomes[i] : estado.nomes[i] + SEPARADOR_AJUDA + a + SEPARADOR_AJUDA + estado.nomes[i]);
    i = i + 1;
  }
}
export function emitEditorEvent(evento: string, arg: string): void {
  if (!estado.host.ativo) return;
  let i = 0;
  while (i < estado.ganchoEvento.length) {
    if (estado.ganchoEvento[i] === evento) {
      try { estado.ganchoFn[i](arg); } catch (error) { logError("Gancho '" + evento + "': " + String(error)); }
    }
    i = i + 1;
  }
}

export class Editor {
  static scene(): Scene | null { return estado.host.scene(); }
  static selection(): GameObject | null { return estado.host.selection(); }
  static select(o: GameObject | null): void { estado.host.select(o); }
  static snapshot(rotulo: string): void { estado.host.snapshot(rotulo); }
  static log(msg: string): void { estado.host.log(msg); }
  static on(evento: string, fn: GanchoFn): boolean {
    const ok = EVENTOS_EDITOR.indexOf(evento) >= 0;
    if (ok) { estado.ganchoEvento.push(evento); estado.ganchoFn.push(fn); }
    return ok;
  }
  static viewPose(out: Float64Array): void { estado.host.viewPose(out); }
  /// Pose da vista com a posição levada SPAWN_DISTANCE à frente (onde o menu Criar põe objetos).
  static spawnPoint(out: Float64Array): void {
    estado.host.viewPose(out);
    const cy = math.cos(out[3]); const sy = math.sin(out[3]); const cp = math.cos(out[4]); const sp = math.sin(out[4]);
    out[0] = out[0] + sy * cp * SPAWN_DISTANCE; out[1] = out[1] + sp * SPAWN_DISTANCE; out[2] = out[2] + cy * cp * SPAWN_DISTANCE;
  }
  static inspect(b: Behavior, titulo: string): void { estado.host.inspect(b, titulo); }
}
```

`editor_host.ts`:

```ts
// O host real de @editor/api: lê a cena e a sessão do editor. Instalado pelo
// main.ts; o jogo exportado não instala nada e a API fica em no-op.
import type { Scene } from "@engine/core/scene";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { EditorHost, instalarHost } from "./api";
import { scene, S } from "./control/session";
import { history } from "./undo";
import { logInfo } from "@engine/core/logger";
import { UI_EDITOR_API } from "./ui_config";

export class EditorHostReal extends EditorHost {
  /// Abre um Behavior no Inspector (o main.ts liga ao Inspector; Task 10).
  janela: ((b: Behavior, titulo: string) => void) | null;
  constructor() { super(); this.ativo = true; this.janela = null; }
  scene(): Scene | null { return scene; }
  selection(): GameObject | null { return S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null; }
  select(o: GameObject | null): void {
    const i = o === null ? 0 - 1 : scene.objects.indexOf(o);
    S.selected = i; S.selection = i >= 0 ? [i] : [];
  }
  snapshot(rotulo: string): void { history.snapshot(); logInfo(UI_EDITOR_API.undoPrefix + rotulo); }
  log(msg: string): void { logInfo(msg); }
  viewPose(out: Float64Array): void { out[0] = S.camX; out[1] = S.camY; out[2] = S.camZ; out[3] = S.camYaw; out[4] = S.camPitch; }
  inspect(b: Behavior, titulo: string): void { if (this.janela !== null) this.janela(b, titulo); }
}
export function instalarEditorReal(): EditorHostReal { const h = new EditorHostReal(); instalarHost(h); return h; }
```

`ui_config.ts`: `export const UI_EDITOR_API = { undoPrefix: "Desfazer: " };`.

`dispatch.ts`:
- `import { commandIndex, commandMutates, runCommand } from "../api";`.
- Depois da linha 71: `const registrado = commandIndex(cmd); if (registrado >= 0 && commandMutates(registrado)) history.snapshot();`.
- `default: return registrado >= 0 ? runCommand(registrado, parts) : "[erro] desconhecido: " + cmd;`.

`query.ts`: o retorno de `cmdHelp` termina com `+ commandHelpLine()`. `doc.ts`: `commandDocLines(lines);` antes do laço de filtro.

`scene_document.ts`:
- `save`: `emitEditorEvent("salvar", path);` depois do `logInfo("Cena salva: ...")`.
- `complete`: `const caminho = this.pendingPath;` antes do `try`; depois de `this.cancel()`, `emitEditorEvent("abrirCena", caminho);`. A cena nova passa o `pendingPath` vazio.

`play_mode.ts`: `emitEditorEvent("entrarPlay", "")` depois de `S.simulating = 1; S.playing = 1;`, e `emitEditorEvent("sairPlay", "")` depois de `S.simulating = 0;`.

Gerador (`tools/generate-components.mjs`):

```js
export const ROOTS = ['src/engine/core', 'src/scripts', 'assets/scripts', 'assets/pacotes'];
export const MENU_ROOTS = ['Criar', 'Janela'];
export function isEditorOnly(source) {
  return (ts.getLeadingCommentRanges(source.text, 0) ?? []).some(r => /@editorOnly\b/.test(source.text.slice(r.pos, r.end)));
}
```

- `createProject(root)`: extrair o bloco atual das linhas 26-45 (`files`, `configPath`, `program`, `checker`, `diagnostics`, `fail`), trocando `roots` por `ROOTS`, e devolver `{ files, program, checker, fail }`.
- `discoverComponents` passa a usar `createProject`, e cada entrada ganha `editorOnly: isEditorOnly(source)`.
- `renderRegistry(entries, marker)` é o corpo atual de `renderComponents` (linhas 141-193), com duas diferenças: os aliases saem de `const alias = new Map(entries.map((e, i) => [e, 'Component' + i]))` em vez de `entry.alias`, e o texto termina em `'export const REGISTRO = ' + quote(marker) + ';\n'`.
- `renderComponents(entries)` devolve:
  - o catálogo, como hoje;
  - `'src/engine/generated/components.ts': renderRegistry(entries, 'editor')`;
  - `'src/engine/generated/components_game.ts': renderRegistry(entries.filter(e => !e.editorOnly), 'jogo')`.
- Funções novas:

```js
const fromGenerated = source => {
  const r = slash(path.posix.relative('src/engine/generated', source)).replace(/\.ts$/, '');
  return r.startsWith('.') ? r : './' + r;
};
export function discoverEditorExtensions(root = projectRoot) {
  const { files, program } = createProject(root);
  const editorFiles = files.filter(f => isEditorOnly(program.getSourceFile(f))).map(f => slash(path.relative(root, f))).sort(compare);
  return { editorFiles, menuItems: [] };
}
export function renderEditorExtensions(ext) {
  const header = '// GERADO por tools/generate-components.mjs. Só o editor (main.ts) importa este arquivo.\n';
  return { 'src/engine/generated/editor_extensions.ts': header + ext.editorFiles.map(f => 'import ' + quote(fromGenerated(f)) + ';').join('\n') + '\n' };
}
```

- `generateComponents`: `const outputs = { ...renderComponents(entries), ...renderEditorExtensions(discoverEditorExtensions(root)) };`, e o resto igual.

`tools/game-build/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "paths": { "@engine/generated/components": ["../../src/engine/generated/components_game.ts"] }
  }
}
```

`tools/game-build/entry.ts`:

```ts
// Entrada do BUILD do jogo. O `tsconfig.json` desta pasta (o mais próximo da
// entrada, que é o que o RTS lê) troca o alias exato
// "@engine/generated/components" pelo registro sem as classes @editorOnly.
// O jogo em si é o game.ts da raiz.
import "../../game.ts";
```

Outras mudanças:
- `tools/editor-build.mjs`, linha 17: `['tools/rts-build.mjs', 'tools/game-build/entry.ts', destination]`.
- `package.json`: `"build:game": "node tools/rts-build.mjs tools/game-build/entry.ts build/RTSGame.exe"`.
- `check-params.mjs`: `['src', 'assets/scripts', 'assets/pacotes']`.
- `sceneio.ts`, linha 33: `from "@engine/generated/components"`.
- `main.ts`: `import "@engine/generated/editor_extensions";` junto dos imports do editor, e `instalarEditorReal();` logo depois de `ctrlServe(7777);`.

- [ ] **Step 4: Run tests**

Run:
```
npm run components && npm run test:components && npm run components:check && npm run check:params
node --test tests/editor-static.test.mjs
$RTS run tests/test_editor_api.ts
$RTS run tools/game-build/claude-test-registro.ts
$RTS run tests/test_ws_skeleton.ts
$RTS run tests/test_play_mode.ts
node tools/rts-build.mjs tools/game-build/entry.ts build/claude-teste-jogo.exe
```
Expected: tudo verde; `[PASSOU] editor api: ...`; `[PASSOU] build do jogo usa o registro sem @editorOnly`; o `.exe` compila.

- [ ] **Step 5: Commit**

`git add -A && git commit -m "feat(editor): @editor/api com registerCommand e ganchos; @editorOnly fora do jogo exportado"`

---

### Task 7: `Gizmos` — desenhador imediato do editor, com ícones clicáveis

**Files:**
- Create: `src/engine/core/gizmos.ts`, `src/editor/gizmo_pass.ts`, `src/editor/control/commands/gizmo.ts`
- Modify: `src/editor/control/dispatch.ts` + `builtin_commands.ts` + `commands/query.ts` + `commands/doc.ts` (comando `gizmoat`)
- Modify: `src/engine/core/behavior.ts` (`onDrawGizmos`/`onDrawGizmosSelected`; `import type { Gizmos }`)
- Modify: `src/engine/core/gameobject.ts` (campo `gizmoFlag`; `refreshComponentCache`)
- Modify: `src/engine/core/component_metadata.ts` (`drawsGizmos(component: any): boolean { return false; }`)
- Modify: `tools/generate-components.mjs` (`entry.gizmos`; método gerado `drawsGizmos`)
- Modify: `src/editor/api.ts` (reexporta `Gizmos`, `registerGizmo`, `GizmoFn`)
- Modify: `src/editor/ui_config.ts` (`UI_GIZMO`; `UI_ICONS.names` + 4 nomes)
- Modify: `assets/editor/icons/source.json` (+ 4 ícones e 2 cores) → `npm run icons`
- Modify: `main.ts` (passe de gizmos depois de `drawSceneObjects`, linha 890; clique na viewport, linha 715)
- Test: `tests/test_gizmos.ts`, `tests/component-generation.test.mjs`

**Interfaces:**
- Produces:
  - `class Gizmos { cam; seg; nSeg; ic; icNomes; nIc; cor; dono; lado; selecionado; color(rgb); line(a, b); wireSphere(c, r); wireCone(apice, dir, comprimento, anguloGraus); icon(nome, pos) }`
  - `gizmosBegin(g: Gizmos, pose: Float64Array /* x, y, z, yaw, pitch, fov, largura, altura */): void`
  - `type GizmoFn = (g: Gizmos, dono: GameObject, comp: Behavior) => void`; `registerGizmoDrawer(tipo, fn): boolean`; `gizmoDrawerIndex(tipo): number`; `runGizmoDrawer(i, g, dono, comp): void`
  - `GIZMO_SEGMENTOS_CIRCULO = 24`, `GIZMO_ARESTAS_CONE = 8`, `GIZMO_Z_MIN = 0.2`
  - `Behavior.onDrawGizmos(g)`, `Behavior.onDrawGizmosSelected(g)`; `GameObject.gizmoFlag`
  - Editor: `gizmosDoEditor: Gizmos` (a instância da vista de Cena), `coletarGizmos(g, sc, selecionado): number`, `pintarGizmos(app, win, g): void`, `gizmoIconAt(g, mx, my): number`
  - WS: `gizmoat <sx> <sy>` → seleciona o dono do ícone sob o pixel (a mesma área do clique), `cmdGizmoAt(parts: string[]): string`
  - `@editor/api`: `registerGizmo(tipo, fn)`

- [ ] **Step 1: Write the failing test**

`tests/test_gizmos.ts`:

```ts
// Teste SEM JANELA dos Gizmos: projeção (mesma conta de projPt), corte atrás da
// câmera, esfera e cone, ícone com a MESMA área para desenho e clique, cor,
// buffers reaproveitados, ganchos chamados no editor e nunca no jogo.
//
//   rts.exe run tests/test_gizmos.ts
import io from "@compat/io.ts";
import { Behavior } from "@engine/core/behavior";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Gizmos, gizmosBegin, registerGizmoDrawer, GIZMO_SEGMENTOS_CIRCULO, GIZMO_ARESTAS_CONE } from "@engine/core/gizmos";
import { coletarGizmos, gizmoIconAt, gizmosDoEditor } from "@editor/gizmo_pass";
import { cmdGizmoAt } from "@editor/control/commands/gizmo";
import { S } from "@editor/control/session";
import { aplicarLuzes, aplicarAmbiente } from "@engine/render/scene_lighting";
import { VistasDeCamera, coletarCameras } from "@engine/render/camera_views";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function v3(x: number, y: number, z: number): Float64Array { const v = new Float64Array(3); v[0] = x; v[1] = y; v[2] = z; return v; }

const g = new Gizmos();
const pose = new Float64Array(8);
pose[5] = Math.PI / 2.0; pose[6] = 1280.0; pose[7] = 720.0;   // focal = 360
gizmosBegin(g, pose);
g.color(0xFF8000);
g.line(v3(0, 0, 10), v3(1, 0, 10));
check(g.nSeg === 1, "um segmento");
check(Math.abs(g.seg[0] - 640.0) < 1e-9 && Math.abs(g.seg[1] - 360.0) < 1e-9 && Math.abs(g.seg[2] - 676.0) < 1e-9, "(0,0,10)→(640,360); (1,0,10)→(676,360)");
check(g.seg[4] === 0xFF8000FF, "cor 0xRRGGBB vira 0xRRGGBBFF");
g.line(v3(0, 1, 10), v3(0, 0, -5));
check(g.nSeg === 1, "ponta atrás da câmera: segmento descartado");
g.wireSphere(v3(0, 0, 10), 1.0);
check(g.nSeg === 1 + 3 * GIZMO_SEGMENTOS_CIRCULO, "esfera = 3 círculos");
g.wireCone(v3(0, 0, 5), v3(0, 0, 1), 2.0, 90.0);
check(g.nSeg === 1 + 4 * GIZMO_SEGMENTOS_CIRCULO + GIZMO_ARESTAS_CONE, "cone = base + arestas");
const aresta = (1 + 3 * GIZMO_SEGMENTOS_CIRCULO) * 5;
check(Math.abs(g.seg[aresta] - 640.0) < 1e-9 && Math.abs(g.seg[aresta + 1] - 360.0) < 1e-9, "a primeira aresta sai do ápice");
g.lado = 24.0; g.dono = 3;
g.icon("luz-pontual", v3(0, 0, 10));
check(g.nIc === 1 && g.ic[0] === 628.0 && g.ic[1] === 348.0 && g.ic[2] === 24.0 && g.ic[3] === 3.0, "ícone centrado no ponto");
check(gizmoIconAt(g, 640.0, 360.0) === 3 && gizmoIconAt(g, 628.0, 348.0) === 3, "clique dentro seleciona o dono");
check(gizmoIconAt(g, 652.0, 360.0) === 0 - 1 && gizmoIconAt(g, 700.0, 360.0) === 0 - 1, "fora da mesma área: nada");
// buffers reaproveitados: frames iguais não crescem
const cap = g.seg.length; const capIc = g.ic.length;
let f = 0;
while (f < 100) { gizmosBegin(g, pose); g.wireSphere(v3(0, 0, 10), 1.0); g.wireCone(v3(0, 0, 5), v3(0, 1, 0), 2.0, 60.0); g.icon("camera", v3(0, 0, 10)); f = f + 1; }
check(g.seg.length === cap && g.ic.length === capIc, "buffers não crescem entre frames iguais");

// ganchos: o editor chama, o jogo nunca
class ContaGizmos extends Behavior {
  n: number = 0; sel: number = 0;
  typeName(): string { return "ContaGizmos"; }
  onDrawGizmos(gz: Gizmos): void { this.n = this.n + 1; }
  onDrawGizmosSelected(gz: Gizmos): void { this.sel = this.sel + 1; }
}
const desenhos: string[] = [];
check(registerGizmoDrawer("ContaGizmos", (gz: Gizmos, dono: GameObject, comp: Behavior) => { desenhos.push(dono.name + (gz.selecionado ? "*" : "")); }), "registra desenhador");
check(!registerGizmoDrawer("ContaGizmos", (gz: Gizmos, dono: GameObject, comp: Behavior) => {}), "tipo repetido recusado");
const sc = new Scene("gizmos");
const a = sc.createGameObject("A"); const ca = new ContaGizmos(); a.addBehavior(ca);
const b = sc.createGameObject("B"); const cb = new ContaGizmos(); b.addBehavior(cb);
const c = sc.createGameObject("C");
check(a.gizmoFlag === 1 && c.gizmoFlag === 0, "gizmoFlag só em quem desenha");
sc.update(1.0 / 60.0); sc.computeWorld();
const cam = new Float64Array(3); const legado = new Float64Array(4);
aplicarLuzes(0, sc, cam, legado); aplicarAmbiente(0, sc);
coletarCameras(new VistasDeCamera(), sc, null);
check(ca.n === 0 && ca.sel === 0 && desenhos.length === 0, "nada de gizmo no caminho do jogo");
gizmosBegin(g, pose);
check(coletarGizmos(g, sc, 1) === 2, "dois objetos desenharam");
check(ca.n === 1 && cb.n === 1 && ca.sel === 0 && cb.sel === 1, "onDrawGizmosSelected só no selecionado");
check(desenhos.join(",") === "A,B*", "desenhador por tipo recebe dono e seleção: " + desenhos.join(","));
b.active = 0; gizmosBegin(g, pose); coletarGizmos(g, sc, 1);
check(cb.n === 1, "objeto inativo não desenha gizmo");
// WS: gizmoat usa a instância do editor e a mesma área do clique
gizmosBegin(gizmosDoEditor, pose); gizmosDoEditor.lado = 24.0; gizmosDoEditor.dono = 0;
gizmosDoEditor.icon("camera", v3(0, 0, 10));
check(cmdGizmoAt(["gizmoat", "640", "360"]).indexOf("[ok] #0") === 0 && S.selected === 0, "gizmoat seleciona o dono");
check(cmdGizmoAt(["gizmoat", "10", "10"]).indexOf("[gizmoat] nenhum") === 0, "fora de ícone: nenhum");
check(cmdGizmoAt(["gizmoat", "x"]).indexOf("[erro]") === 0, "argumentos inválidos = erro");
io.print("[PASSOU] gizmos: projeção, corte, esfera/cone, ícone clicável, reuso, só no editor, gizmoat");
```

Em `tests/component-generation.test.mjs`:

```js
test('components with onDrawGizmos are flagged in the generated reflection', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/G.ts', importBase + 'export class ComGizmo extends Behavior { onDrawGizmosSelected(g: any): void {} }\nexport class SemGizmo extends Behavior {}');
  const entries = discoverComponents(root);
  assert.deepEqual(entries.map(e => [e.name, e.gizmos]), [['ComGizmo', true], ['SemGizmo', false]]);
  assert.match(renderComponents(entries)['src/engine/generated/components.ts'], /drawsGizmos\(component: any\): boolean/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_gizmos.ts ; npm run test:components`
Expected: FAIL — `cannot resolve module "@engine/core/gizmos"`; no gerador, `e.gizmos` é `undefined`.

- [ ] **Step 3: Implementation**

`gizmos.ts`:

```ts
// Engine RTS — GIZMOS: desenhador imediato do editor. Um Behavior desenha
// linhas, esferas, cones e ícones em onDrawGizmos(g); o editor projeta com a
// câmera da vista de Cena (a mesma conta de editor/gizmo.ts:projPt) e pinta por
// cima do 3D. Nada disto roda no jogo. Buffers crescem por dobra e são
// reaproveitados; os pontos de trabalho são campos, não alocações.
import math from "@compat/math.ts";
import type { Behavior } from "./behavior";
import type { GameObject } from "./gameobject";

export const GIZMO_SEGMENTOS_CIRCULO: number = 24;
export const GIZMO_ARESTAS_CONE: number = 8;
/// Profundidade mínima de um ponto desenhado (a mesma de projPt).
export const GIZMO_Z_MIN: number = 0.2;
const FLOATS_SEGMENTO: number = 5;   // x1, y1, x2, y2, cor
const FLOATS_ICONE: number = 4;      // x, y, lado, dono
const SEGMENTOS_INICIAIS: number = 256;
const ICONES_INICIAIS: number = 32;
const DOIS_PI: number = 6.283185307179586;
const RAD_POR_GRAU: number = 0.017453292519943295;
const COR_PADRAO: number = 0xFFFFFFFF;
/// |dir.y| acima disto: o eixo auxiliar do cone vira +X (evita produto vetorial nulo).
const QUASE_VERTICAL: number = 0.99;

export type GizmoFn = (g: Gizmos, dono: GameObject, comp: Behavior) => void;

export class Gizmos {
  /// x, y, z, cos yaw, sin yaw, cos pitch, sin pitch, focal, largura, altura.
  cam: Float64Array;
  seg: Float64Array; nSeg: number;
  ic: Float64Array; icNomes: string[]; nIc: number;
  /// Cor corrente 0xRRGGBBAA (formato de app.line).
  cor: number;
  /// Índice na cena do objeto sendo desenhado (o dono dos ícones).
  dono: number;
  /// Lado do ícone em pixels (o editor põe UI_GIZMO.iconSize).
  lado: number;
  /// O objeto sendo desenhado está selecionado.
  selecionado: boolean;
  pa: Float64Array; pb: Float64Array;              // pontos projetados
  wa: Float64Array; wb: Float64Array; cb: Float64Array;   // pontos de mundo; centro da base do cone
  u: Float64Array; w: Float64Array;                // eixos do plano do círculo
  constructor() {
    this.cam = new Float64Array(10);
    this.seg = new Float64Array(SEGMENTOS_INICIAIS * FLOATS_SEGMENTO); this.nSeg = 0;
    this.ic = new Float64Array(ICONES_INICIAIS * FLOATS_ICONE); this.icNomes = []; this.nIc = 0;
    this.cor = COR_PADRAO; this.dono = 0 - 1; this.lado = 0.0; this.selecionado = false;
    this.pa = new Float64Array(2); this.pb = new Float64Array(2);
    this.wa = new Float64Array(3); this.wb = new Float64Array(3); this.cb = new Float64Array(3);
    this.u = new Float64Array(3); this.w = new Float64Array(3);
  }
  color(rgb: number): void { this.cor = (rgb & 0xFFFFFF) * 256 + 255; }
  line(a: Float64Array, b: Float64Array): void { segmentoMundo(this, a, b); }
  wireSphere(c: Float64Array, r: number): void { circulo(this, c, r, 0); circulo(this, c, r, 1); circulo(this, c, r, 2); }
  /// Ápice `apice`, eixo `dir` (unitário), altura `comprimento`, abertura TOTAL `anguloGraus`.
  wireCone(apice: Float64Array, dir: Float64Array, comprimento: number, anguloGraus: number): void {
    coneArame(this, apice, dir, comprimento, anguloGraus);
  }
  icon(nome: string, pos: Float64Array): void { iconeMundo(this, nome, pos); }
}

export function gizmosBegin(g: Gizmos, pose: Float64Array): void {
  const c = g.cam;
  c[0] = pose[0]; c[1] = pose[1]; c[2] = pose[2];
  c[3] = math.cos(pose[3]); c[4] = math.sin(pose[3]); c[5] = math.cos(pose[4]); c[6] = math.sin(pose[4]);
  c[7] = (pose[7] * 0.5) / math.tan(pose[5] * 0.5); c[8] = pose[6]; c[9] = pose[7];
  g.nSeg = 0; g.nIc = 0; g.cor = COR_PADRAO; g.dono = 0 - 1; g.selecionado = false;
}
function projetar(g: Gizmos, p: Float64Array, out: Float64Array): number {
  const c = g.cam;
  const dx = p[0] - c[0]; const dy = p[1] - c[1]; const dz = p[2] - c[2];
  const x1 = dx * c[3] - dz * c[4]; const z1 = dx * c[4] + dz * c[3];
  const y2 = dy * c[5] - z1 * c[6]; const z2 = dy * c[6] + z1 * c[5];
  let ok = 0;
  if (z2 > GIZMO_Z_MIN) { out[0] = c[8] * 0.5 + (x1 / z2) * c[7]; out[1] = c[9] * 0.5 - (y2 / z2) * c[7]; ok = 1; }
  return ok;
}
function garantirSegmentos(g: Gizmos, n: number): void {
  if (g.seg.length >= n * FLOATS_SEGMENTO) return;
  let cap = g.seg.length / FLOATS_SEGMENTO;
  while (cap < n) cap = cap * 2;
  const novo = new Float64Array(cap * FLOATS_SEGMENTO);
  let i = 0; while (i < g.nSeg * FLOATS_SEGMENTO) { novo[i] = g.seg[i]; i = i + 1; }
  g.seg = novo;
}
function garantirIcones(g: Gizmos, n: number): void {
  if (g.ic.length >= n * FLOATS_ICONE) return;
  let cap = g.ic.length / FLOATS_ICONE;
  while (cap < n) cap = cap * 2;
  const novo = new Float64Array(cap * FLOATS_ICONE);
  let i = 0; while (i < g.nIc * FLOATS_ICONE) { novo[i] = g.ic[i]; i = i + 1; }
  g.ic = novo;
}
function segmentoMundo(g: Gizmos, a: Float64Array, b: Float64Array): void {
  if (projetar(g, a, g.pa) !== 0 && projetar(g, b, g.pb) !== 0) {
    garantirSegmentos(g, g.nSeg + 1);
    const k = g.nSeg * FLOATS_SEGMENTO;
    g.seg[k] = g.pa[0]; g.seg[k + 1] = g.pa[1]; g.seg[k + 2] = g.pb[0]; g.seg[k + 3] = g.pb[1]; g.seg[k + 4] = g.cor;
    g.nSeg = g.nSeg + 1;
  }
}
function iconeMundo(g: Gizmos, nome: string, pos: Float64Array): void {
  if (projetar(g, pos, g.pa) !== 0) {
    garantirIcones(g, g.nIc + 1);
    const k = g.nIc * FLOATS_ICONE;
    g.ic[k] = g.pa[0] - g.lado * 0.5; g.ic[k + 1] = g.pa[1] - g.lado * 0.5; g.ic[k + 2] = g.lado; g.ic[k + 3] = g.dono;
    if (g.icNomes.length <= g.nIc) g.icNomes.push(nome); else g.icNomes[g.nIc] = nome;
    g.nIc = g.nIc + 1;
  }
}
/// Ponto do círculo de centro `c`, raio `r`, ângulo `a`, no plano gerado por g.u/g.w → g.wa.
function pontoDoCirculo(g: Gizmos, c: Float64Array, r: number, a: number): void {
  const ca = math.cos(a) * r; const sa = math.sin(a) * r;
  g.wa[0] = c[0] + g.u[0] * ca + g.w[0] * sa;
  g.wa[1] = c[1] + g.u[1] * ca + g.w[1] * sa;
  g.wa[2] = c[2] + g.u[2] * ca + g.w[2] * sa;
}
/// Anel no plano de g.u/g.w (usa g.wa e g.wb).
function anel(g: Gizmos, c: Float64Array, r: number): void {
  let k = 0;
  while (k < GIZMO_SEGMENTOS_CIRCULO) {
    pontoDoCirculo(g, c, r, ((k + 1) / GIZMO_SEGMENTOS_CIRCULO) * DOIS_PI);
    g.wb[0] = g.wa[0]; g.wb[1] = g.wa[1]; g.wb[2] = g.wa[2];
    pontoDoCirculo(g, c, r, (k / GIZMO_SEGMENTOS_CIRCULO) * DOIS_PI);
    segmentoMundo(g, g.wa, g.wb);
    k = k + 1;
  }
}
/// Plano 0 = YZ, 1 = XZ, 2 = XY.
function circulo(g: Gizmos, c: Float64Array, r: number, plano: number): void {
  g.u[0] = plano === 0 ? 0.0 : 1.0; g.u[1] = plano === 0 ? 1.0 : 0.0; g.u[2] = 0.0;
  g.w[0] = 0.0; g.w[1] = plano === 2 ? 1.0 : 0.0; g.w[2] = plano === 2 ? 0.0 : 1.0;
  anel(g, c, r);
}
function coneArame(g: Gizmos, apice: Float64Array, dir: Float64Array, comprimento: number, anguloGraus: number): void {
  const raio = comprimento * math.tan(anguloGraus * 0.5 * RAD_POR_GRAU);
  // u = normalize(dir × aux), w = dir × u; aux = +Y, ou +X quando dir ~ ±Y
  const ax = Math.abs(dir[1]) > QUASE_VERTICAL ? 1.0 : 0.0; const ay = 1.0 - ax;
  g.u[0] = 0.0 - dir[2] * ay; g.u[1] = dir[2] * ax; g.u[2] = dir[0] * ay - dir[1] * ax;
  const lu = math.sqrt(g.u[0] * g.u[0] + g.u[1] * g.u[1] + g.u[2] * g.u[2]);
  g.u[0] = g.u[0] / lu; g.u[1] = g.u[1] / lu; g.u[2] = g.u[2] / lu;
  g.w[0] = dir[1] * g.u[2] - dir[2] * g.u[1]; g.w[1] = dir[2] * g.u[0] - dir[0] * g.u[2]; g.w[2] = dir[0] * g.u[1] - dir[1] * g.u[0];
  g.cb[0] = apice[0] + dir[0] * comprimento; g.cb[1] = apice[1] + dir[1] * comprimento; g.cb[2] = apice[2] + dir[2] * comprimento;
  let k = 0;
  while (k < GIZMO_ARESTAS_CONE) {
    pontoDoCirculo(g, g.cb, raio, (k / GIZMO_ARESTAS_CONE) * DOIS_PI);
    segmentoMundo(g, apice, g.wa);
    k = k + 1;
  }
  anel(g, g.cb, raio);
}

const tiposGizmo: string[] = [];
const fnsGizmo: GizmoFn[] = [];
/// Desenhador para um tipo de componente (typeName), para quem não pode
/// sobrescrever onDrawGizmos (ex.: Light e Camera, do núcleo, desenhados por
/// pacote). Registre ANTES de criar objetos: o gizmoFlag é calculado ao anexar.
export function registerGizmoDrawer(tipo: string, fn: GizmoFn): boolean {
  const ok = tipo.length > 0 && tiposGizmo.indexOf(tipo) < 0;
  if (ok) { tiposGizmo.push(tipo); fnsGizmo.push(fn); }
  return ok;
}
export function gizmoDrawerIndex(tipo: string): number { return tiposGizmo.indexOf(tipo); }
export function runGizmoDrawer(i: number, g: Gizmos, dono: GameObject, comp: Behavior): void { fnsGizmo[i](g, dono, comp); }
```

`behavior.ts`: `import type { Gizmos } from "./gizmos";` e:

```ts
  /// EDITOR: ajudas visuais deste componente (todo frame, objetos visíveis). Nunca roda no jogo.
  onDrawGizmos(g: Gizmos): void {}
  /// EDITOR: como onDrawGizmos, só quando o objeto está selecionado.
  onDrawGizmosSelected(g: Gizmos): void {}
```

`component_metadata.ts`: `drawsGizmos(component: any): boolean { return false; }`.

`gameobject.ts`: campo `gizmoFlag: number` (0); imports `componentMetadata` (`./component_metadata`) e `gizmoDrawerIndex` (`./gizmos`, que só importa tipos). No fim de `refreshComponentCache`:

```ts
    let gz = 0;
    let bi = 0;
    while (bi < this.behaviors.length) {
      const b = this.behaviors[bi];
      if (componentMetadata.provider.drawsGizmos(b) || gizmoDrawerIndex(b.typeName()) >= 0) gz = 1;
      bi = bi + 1;
    }
    this.gizmoFlag = gz;
```

Gerador:
- Em `discoverComponents`, a entrada ganha `gizmos: hasMethod(chain, 'onDrawGizmos') || hasMethod(chain, 'onDrawGizmosSelected')`.
- Em `renderRegistry`, `provider += method('drawsGizmos', '', 'boolean', 'false', entry => '      return ' + (entry.gizmos ? 'true' : 'false') + ';');`.

`gizmo_pass.ts`:

```ts
// Passe de gizmos da vista de Cena: chama onDrawGizmos(Selected) e os
// desenhadores por tipo dos objetos visíveis, pinta linhas e ícones por cima do
// 3D e responde o clique num ícone com a MESMA área do desenho.
import type { Scene } from "@engine/core/scene";
import { Gizmos, gizmoDrawerIndex, runGizmoDrawer } from "@engine/core/gizmos";
import { drawEditorIcon } from "./icon_images";
import { UI_GIZMO } from "./ui_config";

/// A instância da vista de Cena: o main.ts desenha nela e o `gizmoat` lê os
/// ícones do último frame (o construtor de Gizmos atribui campos, então a
/// instância no topo do módulo não cai no defeito de "not defined").
export const gizmosDoEditor = new Gizmos();

export function coletarGizmos(g: Gizmos, sc: Scene, selecionado: number): number {
  const objs = sc.objects;
  let desenharam = 0;
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    if (o.gizmoFlag !== 0 && o.active !== 0) {
      g.dono = i; g.selecionado = i === selecionado || o.selFlag !== 0;
      let k = 0;
      while (k < o.behaviors.length) {
        const b = o.behaviors[k];
        if (b.enabled !== 0) {
          b.onDrawGizmos(g);
          if (g.selecionado) b.onDrawGizmosSelected(g);
          const d = gizmoDrawerIndex(b.typeName());
          if (d >= 0) runGizmoDrawer(d, g, o, b);
        }
        k = k + 1;
      }
      desenharam = desenharam + 1;
    }
    i = i + 1;
  }
  return desenharam;
}
export function pintarGizmos(app: any, win: number, g: Gizmos): void {
  let k = 0;
  while (k < g.nSeg) {
    const s = k * 5;
    app.line(g.seg[s], g.seg[s + 1], g.seg[s + 2], g.seg[s + 3], UI_GIZMO.lineWidth, g.seg[s + 4]);
    k = k + 1;
  }
  k = 0;
  while (k < g.nIc) { const s = k * 4; drawEditorIcon(win, g.icNomes[k], g.ic[s], g.ic[s + 1], g.ic[s + 2]); k = k + 1; }
}
/// Dono do ícone sob (mx, my), do de cima para o de baixo; -1 = nenhum.
export function gizmoIconAt(g: Gizmos, mx: number, my: number): number {
  let achado = 0 - 1;
  let k = g.nIc - 1;
  while (k >= 0 && achado < 0) {
    const s = k * 4;
    if (mx >= g.ic[s] && mx < g.ic[s] + g.ic[s + 2] && my >= g.ic[s + 1] && my < g.ic[s + 1] + g.ic[s + 2]) achado = g.ic[s + 3];
    k = k - 1;
  }
  return achado;
}
```

`ui_config.ts`:
- `export const UI_GIZMO = { iconSize: 24, lineWidth: 1 };`.
- `UI_ICONS.names` ganha `"luz-direcional", "luz-pontual", "luz-spot", "camera"`.

`source.json`:
- Paleta: `"light": "#F2D16B"` e `"camera": "#9AC7F0"`.
- `luz-direcional`: `circle` (8,8) r 3.5 + oito `line` radiais de r 5 a r 7.5, largura 1.2.
- `luz-pontual`: `circle` (8,6.5) r 4.5 + `polygon` [[6,11],[10,11],[9.5,14],[6.5,14]].
- `luz-spot`: `polygon` [[6,2],[10,2],[14,14],[2,14]] + `circle` (8,3) r 1.5 na cor `ink`.
- `camera`: `polygon` [[2,5],[11,5],[11,12],[2,12]] + `polygon` [[11,7],[15,5],[15,12],[11,10]].

As três luzes usam a cor `light`, a câmera usa `camera`. Depois, `npm run icons`.

`api.ts`: `export { Gizmos, registerGizmoDrawer as registerGizmo } from "@engine/core/gizmos"; export type { GizmoFn } from "@engine/core/gizmos";`.

`commands/gizmo.ts`:

```ts
// gizmoat <sx> <sy> — o clique num ícone de gizmo, pela porta de controle:
// seleciona o dono do ícone sob o pixel (os ícones do último frame desenhado).
import { S } from "../session";
import { gizmosDoEditor, gizmoIconAt } from "../../gizmo_pass";
export function cmdGizmoAt(parts: string[]): string {
  const x = parseFloat(parts[1]); const y = parseFloat(parts[2]);
  if (parts.length < 3 || x !== x || y !== y) return "[erro] uso: gizmoat <sx> <sy>";
  const dono = gizmoIconAt(gizmosDoEditor, x, y);
  if (dono < 0) return "[gizmoat] nenhum ícone em (" + x + "," + y + ")";
  S.selected = dono; S.selection = [dono];
  return "[ok] #" + dono + " selecionado";
}
```

Em `dispatch.ts`, `case "gizmoat": return cmdGizmoAt(parts);` (fora de `isMutating`, porque seleção não é mutação da cena). Acrescentar `"gizmoat"` a `BUILTIN_COMMANDS`, ao `help` (`| gizmoat <sx> <sy>  (clica num ícone de gizmo)`) e ao `doc` (`"gizmoat <sx> <sy> :: seleciona o dono do ícone de gizmo sob o pixel (a mesma área do clique) :: gizmoat 700 400"`).

`main.ts`:
- Usa `gizmosDoEditor` (de `@editor/gizmo_pass`) e, no topo, `const gizmoPose = new Float64Array(8);`.
- Logo depois de `drawSceneObjects` (linha 890):

```ts
  if (!workspaceViews.game) {
    gizmoPose[0] = S.camX; gizmoPose[1] = S.camY; gizmoPose[2] = S.camZ; gizmoPose[3] = S.camYaw; gizmoPose[4] = S.camPitch;
    gizmoPose[5] = FOV; gizmoPose[6] = W; gizmoPose[7] = H;
    gizmosBegin(gizmosDoEditor, gizmoPose);
    gizmosDoEditor.lado = UI_GIZMO.iconSize;
    coletarGizmos(gizmosDoEditor, scene, S.selected);
    pintarGizmos(app, WIN, gizmosDoEditor);
  }
```

- No bloco `if (mPressed !== 0 && inViewport && dndOn === 0)` (linha 715), depois de decidir `ax` e antes do ramo que chama `pickObjectAt`: `const iconeDono = ax < 0 ? gizmoIconAt(gizmosDoEditor, mx, my) : 0 - 1; if (iconeDono >= 0) { S.selected = iconeDono; S.selection = [iconeDono]; }`, e o ramo de `pickObjectAt` passa a rodar só com `iconeDono < 0`. O retângulo testado é o do frame anterior, que é o que está na tela.

- [ ] **Step 4: Run tests**

Run:
```
npm run icons && npm run icons:check
npm run components && npm run test:components && npm run components:check && npm run check:params
$RTS run tests/test_gizmos.ts
$RTS run tests/test_icon_images.ts
$RTS run tests/test_editor_ui.ts
```
Expected: tudo verde; `[PASSOU] gizmos: ...`.

- [ ] **Step 5: Commit**

`git add -A && git commit -m "feat(editor): Gizmos imediatos (onDrawGizmos, desenhador por tipo, ícones clicáveis)"`

---

### Task 8: `@menuItem` no gerador e nos menus; `onInspectorGUI(ui: InspectorUI)`

**Files:**
- Create: `src/engine/core/inspector_ui.ts`, `src/engine/core/pose.ts`, `src/engine/core/cor.ts`
- Create: `src/editor/inspector_gui.ts`, `src/editor/menu_items.ts`, `src/editor/control/commands/menu.ts`
- Modify: `tools/generate-components.mjs` (`discoverEditorExtensions` acha `@menuItem`; `renderEditorExtensions` gera `MENU_ITEMS`/`runMenuItem`; método gerado `fieldName`)
- Modify: `src/engine/core/component_metadata.ts` (`fieldName(component, index): string { return ""; }`)
- Modify: `src/engine/core/behavior.ts` (`fieldName(i)`; `onInspectorGUI(ui: InspectorUI): void {}`; `import type { InspectorUI }`)
- Modify: `src/editor/inspector.ts` (extrair `fieldRow`, linhas 556-576; laço de campos 553-579 passa pelo `onInspectorGUI`; campo `gui`)
- Modify: `src/engine/core/light.ts` e `src/engine/core/camera.ts` (`onInspectorGUI`)
- Modify: `src/editor/ui_config.ts` (`UI_INSPECTOR_GUI`; `UI_SETTINGS`)
- Modify: `main.ts` (menu Criar e de contexto leem `menuCriar`: linhas 605, 1397-1450, 1461-1463, 1505-1506; Configurações sem array novo por frame)
- Modify: `src/editor/control/dispatch.ts`, `builtin_commands.ts`, `commands/query.ts`, `commands/doc.ts` (comando `menu`)
- Test: `tests/test_inspector_gui.ts`, `tests/test_menu_items.ts`, `tests/component-generation.test.mjs`

**Interfaces:**
- Produces (núcleo):
  - `class InspectorUI { usos: number; field(nome); label(texto); button(rotulo): boolean; toggle(rotulo, valor: boolean): boolean; slider(rotulo, valor, min, max): number; color(rotulo, rgb): number; dropdown(rotulo, opcoes: string[], indice): number; alterar(): void; alinharComVista(o: GameObject | null): void }`
  - `Behavior.onInspectorGUI(ui: InspectorUI): void`, `Behavior.fieldName(i: number): string`
  - `definirPoseDeMundo(sc: Scene, o: GameObject, pose: Float64Array /* x, y, z, yaw, pitch */): void`
  - `corHex(rgb: number): string` ("#RRGGBB"), `lerCorHex(texto: string): number` (-1 = inválido)
- Produces (editor):
  - `class InspectorGUIEditor extends InspectorUI { begin(comp, chave, y); y: number }`; `Inspector.fieldRow(component, key, fieldIndex, rowY): void`
  - `class MenuDinamico { rotulos: string[]; fixos: number; itens: number[] }`, `MENU_CRIAR = "Criar/"`, `MENU_JANELA = "Janela/"`
  - `montarMenu(prefixo: string, fixos: string[], caminhos: string[]): MenuDinamico`, `menuDoCatalogo(prefixo: string, fixos: string[]): MenuDinamico`
  - `indiceDoCaminho(caminho: string): number`, `executarItemDeMenu(indice: number, pai: number): string` ("" = ok)
  - WS: `menu` (lista) e `menu <caminho>` (executa), `cmdMenu(parts: string[]): string`
- Produces (gerado): `@engine/generated/editor_extensions` exporta `MENU_ITEMS: string[]` e `runMenuItem(index: number): void`.

- [ ] **Step 1: Write the failing test**

`tests/test_menu_items.ts`:

```ts
// Teste SEM JANELA: montagem dos menus a partir do catálogo, conversão de cor,
// pose de mundo → local (inverso de Scene.applyParentTo) e o comando `menu`.
//   rts.exe run tests/test_menu_items.ts
import io from "@compat/io.ts";
import { montarMenu } from "@editor/menu_items";
import { cmdMenu } from "@editor/control/commands/menu";
import { corHex, lerCorHex } from "@engine/core/cor";
import { definirPoseDeMundo } from "@engine/core/pose";
import { Scene } from "@engine/core/scene";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const caminhos: string[] = ["Criar/Luz/Pontual", "Janela/Ambiente", "Criar/Câmera"];
const m = montarMenu("Criar/", ["Cubo", "Esfera"], caminhos);
check(m.fixos === 2 && m.rotulos.join("|") === "Cubo|Esfera|Luz/Pontual|Câmera", "fixos antes, itens sem o prefixo: " + m.rotulos.join("|"));
check(m.itens.length === 2 && m.itens[0] === 0 && m.itens[1] === 2, "índices no catálogo");
check(montarMenu("Janela/", [], caminhos).rotulos.join("|") === "Ambiente", "menu Janela");
check(corHex(0xFF8000) === "#FF8000" && corHex(0x0A0B0C) === "#0A0B0C", "corHex");
check(lerCorHex("#ff8000") === 0xFF8000 && lerCorHex("0a0b0c") === 0x0A0B0C, "lerCorHex aceita com e sem #");
check(lerCorHex("#ff80") === 0 - 1 && lerCorHex("#gg8000") === 0 - 1 && lerCorHex("") === 0 - 1, "inválidos = -1");
// pose de mundo → local numa filha de pai girado
const sc = new Scene("pose");
const pai = sc.createGameObject("Pai"); pai.transform.setPosition(10.0, 1.0, 0.0); pai.transform.ry = Math.PI / 2.0; pai.transform.rx = 0.1;
const filho = sc.createGameObject("Filho"); filho.parent = 0;
sc.computeWorld();
const pose = new Float64Array(5); pose[0] = 3.0; pose[1] = 4.0; pose[2] = 5.0; pose[3] = 0.5; pose[4] = 0 - 0.2;
definirPoseDeMundo(sc, filho, pose); sc.computeWorld();
const t = filho.transform;
check(Math.abs(t.wx - 3.0) < 1e-9 && Math.abs(t.wy - 4.0) < 1e-9 && Math.abs(t.wz - 5.0) < 1e-9, "filha: posição de mundo pedida");
check(Math.abs(t.wry - 0.5) < 1e-9 && Math.abs(t.wrx + 0.2) < 1e-9, "filha: ângulos de mundo pedidos");
check(cmdMenu(["menu", "Criar/Inexistente"]).indexOf("[erro]") === 0, "caminho inexistente = erro");
check(cmdMenu(["menu"]).indexOf("[menu]") === 0, "lista");
io.print("[PASSOU] menu: montagem, cor, pose de mundo, comando menu");
```

`tests/test_inspector_gui.ts`:

```ts
// Teste SEM JANELA do onInspectorGUI: a GUI do Light substitui a lista
// automática, dropdown/cor/slider/toggle mudam o componente com Desfazer, um
// componente sem GUI continua com os campos automáticos, e "Alinhar com a
// vista" copia a pose da câmera do editor (raiz e filha).
//   rts.exe run tests/test_inspector_gui.ts
import io from "@compat/io.ts";
import { Inspector } from "@editor/inspector";
import { EditorControl } from "@editor/ui_controls";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import { Light } from "@engine/core/light";
import { Camera } from "@engine/core/camera";
import { Spinner } from "@scripts/spinner";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class TestApp {
  _win: number = 0; focus: number = -1; clickId: number = -1; textoId: number = -1; texto: string = "";
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  textField(id: number, x: number, y: number, width: number, value: string, enabled: boolean): string { return id === this.textoId ? this.texto : value; }
  clickable(id: number, x: number, y: number, width: number, height: number): number { return id === this.clickId ? 3 : 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}
const PANEL_H = 4000;
const app = new TestApp();
const inspector = new Inspector(app);
inspector.transformOpen = false;
function render(): void { inspector.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0); }
function control(name: string): EditorControl {
  const i = inspector.ui.names.indexOf(name); check(i >= 0, "controle ausente: " + name); return inspector.ui.controls[i];
}
function porRotulo(prefixo: string): EditorControl {
  let i = 0; let achado: EditorControl | null = null;
  while (i < inspector.ui.controls.length && achado === null) { if (inspector.ui.controls[i].label.indexOf(prefixo) === 0) achado = inspector.ui.controls[i]; i = i + 1; }
  check(achado !== null, "controle com rótulo " + prefixo); return achado as EditorControl;
}
function click(c: EditorControl): void { app.clickId = c.id; render(); app.clickId = -1; render(); }

scene.clear(); history.u = []; history.r = [];
const o = scene.createGameObject("Luz"); const luz = new Light(); o.addBehavior(luz);
S.selected = 0; S.selection = [0];
render();
check(inspector.ui.names.indexOf("Components/0/Field/0") < 0, "Light com GUI: sem a lista automática");
const tipo = control("Components/0/GUI/0");
check(tipo.label === "Tipo: direcional", "dropdown mostra o tipo: " + tipo.label);
click(tipo);
check(luz.tipo === "pontual" && history.undoDepth() === 1, "dropdown alterna o tipo com 1 Desfazer");
check(inspector.ui.names.indexOf("Components/0/Field/3") >= 0, "pontual mostra o campo automático 'alcance' (índice 3)");
const cor = control("Components/0/GUI/1");
app.textoId = cor.id; app.texto = "#FF8000"; render(); app.textoId = -1; render();
check(luz.cor === 0xFF8000, "campo de cor em #RRGGBB");
app.textoId = cor.id; app.texto = "#zz"; render(); app.textoId = -1; render();
check(luz.cor === 0xFF8000, "cor inválida é ignorada");
// componente sem GUI continua com os campos automáticos
const s = scene.createGameObject("Gira"); s.addBehavior(new Spinner());
S.selected = 1; S.selection = [1]; render();
check(inspector.ui.names.indexOf("Components/0/Field/0") >= 0, "sem onInspectorGUI: lista automática");
// Camera: slider do FOV em graus, toggle Principal, Alinhar com a vista (raiz)
const c = scene.createGameObject("Cam"); const cam = new Camera(); c.addBehavior(cam);
S.selected = 2; S.selection = [2]; render();
const fov = porRotulo("Campo de visão");
const r = fov.host;
// pressiona dentro da barra e arrasta para além da ponta direita (o arrasto segue até soltar)
inspector.render(app, 0, 0, 290, PANEL_H, r.px + 1, r.py + 1, 1, 1, false, 0, 0);
inspector.render(app, 0, 0, 290, PANEL_H, r.px + r.sx + 50, r.py + 1, 1, 0, false, 0, 0);
inspector.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0);
check(Math.abs(cam.fov * 180.0 / Math.PI - 150.0) < 1e-6, "arrastar o slider até o fim = 150°: " + cam.fov * 180.0 / Math.PI);
S.camX = 3.0; S.camY = 4.0; S.camZ = 5.0; S.camYaw = 0.5; S.camPitch = 0 - 0.2;
const antes = history.undoDepth();
click(porRotulo("Alinhar com a vista"));
check(c.transform.px === 3.0 && c.transform.pz === 5.0 && c.transform.ry === 0.5 && c.transform.rx === 0 - 0.2, "alinhou a câmera raiz");
check(history.undoDepth() === antes + 1, "Alinhar com a vista entra no Desfazer");
history.undo();
check(scene.objects[2].transform.px === 0.0, "Desfazer volta a pose");
// Alinhar numa câmera filha de pai girado
const pai = scene.createGameObject("Veículo"); pai.transform.setPosition(10.0, 0.0, 0.0); pai.transform.ry = Math.PI / 2.0;
const cf = scene.createGameObject("CamFilha"); cf.parent = scene.objects.indexOf(pai); cf.addBehavior(new Camera());
scene.computeWorld();
S.selected = scene.objects.indexOf(cf); S.selection = [S.selected]; render();
click(porRotulo("Alinhar com a vista"));
scene.computeWorld();
check(Math.abs(cf.transform.wx - 3.0) < 1e-9 && Math.abs(cf.transform.wz - 5.0) < 1e-9 && Math.abs(cf.transform.wry - 0.5) < 1e-9, "filha: pose de mundo = vista");
io.print("[PASSOU] inspector gui: substitui a lista, dropdown, cor, slider, sem GUI, alinhar raiz e filha");
```

Em `tests/component-generation.test.mjs`:

```js
test('@menuItem on static zero-arg methods becomes MENU_ITEMS and runMenuItem', t => {
  const { root, write } = fixture(t);
  write('assets/pacotes/luz/menu.ts', '/** @editorOnly */\nexport class LuzMenu {\n  /** @menuItem Criar/Luz/Pontual */\n  static pontual(): void {}\n  /** @menuItem Janela/Ambiente */\n  static janela(opcional?: number): void {}\n}');
  const ext = discoverEditorExtensions(root);
  assert.deepEqual(ext.menuItems.map(i => i.caminho), ['Criar/Luz/Pontual', 'Janela/Ambiente']);
  const text = renderEditorExtensions(ext)['src/engine/generated/editor_extensions.ts'];
  assert.match(text, /export const MENU_ITEMS: string\[\] = \["Criar\/Luz\/Pontual","Janela\/Ambiente"\];/);
  assert.match(text, /if \(index === 0\) \{ Menu0\.pontual\(\); return; \}/);
});
test('@menuItem errors: not static, required argument, unknown root, duplicate path', t => {
  const cases = [
    ['export class A { /** @menuItem Criar/X */ x(): void {} }', /static/],
    ['export class A { /** @menuItem Criar/X */ static x(n: number): void {} }', /static sem argumentos/],
    ['export class A { /** @menuItem Arquivo/X */ static x(): void {} }', /Criar ou Janela/],
    ['export class A { /** @menuItem Criar/X */ static x(): void {} /** @menuItem Criar/X */ static y(): void {} }', /repetido/],
  ];
  for (const [source, error] of cases) {
    const { root, write } = fixture(t);
    write('assets/pacotes/p/m.ts', source);
    assert.throws(() => discoverEditorExtensions(root), error);
  }
});
test('fieldName is generated for visible fields', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/F.ts', importBase + 'export class F extends Behavior { velocidade: number = 1; nome: string = ""; }');
  const out = renderComponents(discoverComponents(root))['src/engine/generated/components.ts'];
  assert.match(out, /fieldName\(component: any, index: number\): string \{\n    if \(component instanceof Component0\) \{\n      if \(index === 0\) return "velocidade";\n      if \(index === 1\) return "nome";/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_menu_items.ts ; $RTS run tests/test_inspector_gui.ts ; npm run test:components`
Expected: FAIL — `cannot resolve module "@editor/menu_items"` / `"@engine/core/cor"`; o Inspector ainda cria `Components/0/Field/0` para o Light; no gerador, `menuItems` fica vazio.

- [ ] **Step 3: Implementation**

Gerador:
- Em `discoverEditorExtensions`, o laço de arquivos também percorre as classes exportadas:

```js
  const menuItems = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    for (const node of source.statements) {
      if (!ts.isClassDeclaration(node) || !node.name || !hasModifier(node, ts.SyntaxKind.ExportKeyword)) continue;
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !tags(member).has('menuItem')) continue;
        const caminho = tags(member).get('menuItem');
        if (!hasModifier(member, ts.SyntaxKind.StaticKeyword)) fail(member, '@menuItem precisa de um metodo static.');
        if (!member.parameters.every(p => p.initializer || p.questionToken)) fail(member, '@menuItem precisa de um metodo static sem argumentos obrigatorios.');
        const partes = caminho.split('/');
        if (partes.length < 2 || partes.some(p => p.trim().length === 0) || !MENU_ROOTS.includes(partes[0])) fail(member, `@menuItem "${caminho}": comece com Criar ou Janela e nomeie o item (Criar/Luz/Pontual).`);
        if (menuItems.some(i => i.caminho === caminho)) fail(member, `@menuItem "${caminho}" repetido.`);
        menuItems.push({ caminho, source: slash(path.relative(root, file)), classe: node.name.text, metodo: member.name.getText() });
      }
    }
  }
  menuItems.sort((a, b) => compare(a.caminho, b.caminho));
```

- `renderEditorExtensions` acrescenta ao texto:

```js
  const chave = i => i.source + '#' + i.classe;
  const classes = [...new Map(ext.menuItems.map(i => [chave(i), i])).values()];
  const alias = new Map(classes.map((i, k) => [chave(i), 'Menu' + k]));
  text += classes.map(i => `import { ${i.classe} as ${alias.get(chave(i))} } from ${quote(fromGenerated(i.source))};`).join('\n') + '\n';
  text += 'export const MENU_ITEMS: string[] = ' + JSON.stringify(ext.menuItems.map(i => i.caminho)) + ';\n';
  text += 'export function runMenuItem(index: number): void {\n' +
    ext.menuItems.map((i, k) => `  if (index === ${k}) { ${alias.get(chave(i))}.${i.metodo}(); return; }`).join('\n') +
    '\n  throw new Error("Item de menu inexistente: " + index);\n}\n';
```

- Em `renderRegistry`: `provider += method('fieldName', ', index: number', 'string', '""', entry => lookup(visible(entry), field => quote(field.name), '""'));`.

`component_metadata.ts`: `fieldName(component: any, index: number): string { return ""; }`. `behavior.ts`: `fieldName(i: number): string { return componentMetadata.provider.fieldName(this, i); }` e:

```ts
  /// EDITOR: desenha o Inspector deste componente no lugar da lista automática
  /// de campos. Sem controles desenhados (o padrão), vale a lista automática.
  onInspectorGUI(ui: InspectorUI): void {}
```

`inspector_ui.ts`:

```ts
// Engine RTS — InspectorUI: o que um componente usa em onInspectorGUI(ui) para
// desenhar o próprio Inspector. O editor fornece a implementação real
// (src/editor/inspector_gui.ts). Esta base só conta os usos e devolve os valores
// recebidos: um componente que não desenha nada fica com a lista automática.
import type { GameObject } from "./gameobject";
export class InspectorUI {
  /// Controles pedidos nesta chamada; 0 = o componente não tem GUI própria.
  usos: number;
  constructor() { this.usos = 0; }
  field(nome: string): void { this.usos = this.usos + 1; }
  label(texto: string): void { this.usos = this.usos + 1; }
  button(rotulo: string): boolean { this.usos = this.usos + 1; return false; }
  toggle(rotulo: string, valor: boolean): boolean { this.usos = this.usos + 1; return valor; }
  slider(rotulo: string, valor: number, min: number, max: number): number { this.usos = this.usos + 1; return valor; }
  color(rotulo: string, rgb: number): number { this.usos = this.usos + 1; return rgb; }
  dropdown(rotulo: string, opcoes: string[], indice: number): number { this.usos = this.usos + 1; return indice; }
  /// Um passo de Desfazer antes de uma mudança feita pelo próprio componente.
  alterar(): void {}
  /// Copia a pose da câmera da vista de Cena para `o`, com Desfazer.
  alinharComVista(o: GameObject | null): void {}
}
```

`cor.ts`:

```ts
// Cor 0xRRGGBB ↔ texto "#RRGGBB" (Inspector, comandos do WebSocket).
const HEX: string = "0123456789ABCDEF";
export function corHex(rgb: number): string {
  let s = "#"; let d = 20;
  while (d >= 0) { const n = (rgb >> d) & 15; s = s + HEX.slice(n, n + 1); d = d - 4; }
  return s;
}
function digito(c: number): number {
  let v = 0 - 1;
  if (c >= 48 && c <= 57) v = c - 48;
  else if (c >= 65 && c <= 70) v = c - 55;
  else if (c >= 97 && c <= 102) v = c - 87;
  return v;
}
/// "#RRGGBB" ou "RRGGBB" → 0xRRGGBB; -1 se inválido.
export function lerCorHex(texto: string): number {
  let t = texto.trim();
  if (t.length > 0 && t.charCodeAt(0) === 35) t = t.slice(1);   // '#'
  let v = t.length === 6 ? 0 : 0 - 1;
  let i = 0;
  while (v >= 0 && i < 6) { const d = digito(t.charCodeAt(i)); v = d < 0 ? 0 - 1 : v * 16 + d; i = i + 1; }
  return v;
}
```

`pose.ts`:

```ts
// Pose de MUNDO → transform LOCAL, invertendo Scene.applyParentTo: o filho
// herda a posição do pai girada só pelo yaw e soma os ângulos.
import math from "@compat/math.ts";
import type { Scene } from "./scene";
import type { GameObject } from "./gameobject";
/// `pose` = [x, y, z, yaw, pitch] de mundo.
export function definirPoseDeMundo(sc: Scene, o: GameObject, pose: Float64Array): void {
  const t = o.transform;
  const p = o.parent;
  if (p < 0 || p >= sc.objects.length) {
    t.px = pose[0]; t.py = pose[1]; t.pz = pose[2]; t.ry = pose[3]; t.rx = pose[4];
  } else {
    const pt = sc.objects[p].transform;
    const c = math.cos(pt.wry); const s = math.sin(pt.wry);
    const dx = pose[0] - pt.wx; const dz = pose[2] - pt.wz;
    t.px = dx * c - dz * s; t.py = pose[1] - pt.wy; t.pz = dx * s + dz * c;
    t.ry = pose[3] - pt.wry; t.rx = pose[4] - pt.wrx;
  }
}
```

`ui_config.ts`:

```ts
export const UI_INSPECTOR_GUI = {
  guiKey: "/GUI/", valueSeparator: ": ", digits: 1, unknownField: "Campo desconhecido: ",
};
export const UI_SETTINGS = {
  gridOn: "Grade: ligada", gridOff: "Grade: desligada", vsyncOn: "VSync: ligado", vsyncOff: "VSync: desligado",
  resetLayout: "Restaurar layout",
};
```

`inspector_gui.ts`:

```ts
// Implementação do InspectorUI no editor: cada chamada vira um controle da
// UIScene do Inspector, com chave "<componente>/GUI/<ordem>" (única na janela) e
// as medidas de UI_INSPECTOR. Mudanças de valor tiram o snapshot de Desfazer do
// Inspector antes de devolver o valor novo.
import { InspectorUI } from "@engine/core/inspector_ui";
import type { Behavior } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import type { Inspector } from "./inspector";
import { scene, S } from "./control/session";
import { definirPoseDeMundo } from "@engine/core/pose";
import { corHex, lerCorHex } from "@engine/core/cor";
import { UI_INSPECTOR as L, UI_INSPECTOR_GUI as G } from "./ui_config";

export function indiceDoCampo(c: Behavior, nome: string): number {
  let i = 0; let achado = 0 - 1;
  while (i < c.fieldCount() && achado < 0) { if (c.fieldName(i) === nome) achado = i; i = i + 1; }
  return achado;
}

export class InspectorGUIEditor extends InspectorUI {
  insp: Inspector; comp: Behavior | null; chave: string; y: number; seq: number; pose: Float64Array;
  constructor(insp: Inspector) {
    super(); this.insp = insp; this.comp = null; this.chave = ""; this.y = 0; this.seq = 0; this.pose = new Float64Array(5);
  }
  begin(comp: Behavior, chave: string, y: number): void { this.comp = comp; this.chave = chave; this.y = y; this.seq = 0; this.usos = 0; }
  proxima(): string { const k = this.chave + G.guiKey + this.seq; this.seq = this.seq + 1; this.usos = this.usos + 1; return k; }
  colunaX(): number { return this.insp.x + L.padding + L.gap; }
  colunaW(): number { return this.insp.width - L.padding * 2 - L.gap; }
  field(nome: string): void {
    const k = this.proxima();
    const c = this.comp as Behavior;
    const i = indiceDoCampo(c, nome);
    if (i < 0) this.insp.label(k, this.y, G.unknownField + nome);
    else if (this.insp.visible(this.y, L.rowH)) this.insp.fieldRow(c, this.chave, i, this.y);
    this.y = this.y + L.rowH;
  }
  label(texto: string): void { const k = this.proxima(); this.insp.label(k, this.y, texto); this.y = this.y + L.rowH; }
  button(rotulo: string): boolean {
    const k = this.proxima(); let clicado = false;
    if (this.insp.visible(this.y, L.rowH)) {
      const b = this.insp.ui.control(k, "button", this.colunaX(), this.y, this.colunaW(), L.rowH, rotulo, this.insp.enabledInput);
      this.insp.ui.draw(b); clicado = b.clicked;
    }
    this.y = this.y + L.rowH;
    return clicado;
  }
  toggle(rotulo: string, valor: boolean): boolean {
    const k = this.proxima(); let novo = valor;
    if (this.insp.visible(this.y, L.rowH)) {
      const t = this.insp.ui.control(k, "toggle", this.colunaX(), this.y, this.colunaW(), L.rowH, rotulo, this.insp.enabledInput);
      t.value = valor ? 1 : 0; this.insp.ui.draw(t);
      if ((t.value !== 0) !== valor) { this.insp.snapshot(); novo = t.value !== 0; }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  slider(rotulo: string, valor: number, min: number, max: number): number {
    const k = this.proxima(); let novo = valor;
    if (this.insp.visible(this.y, L.rowH) && max > min) {
      const s = this.insp.ui.control(k, "timeline", this.colunaX(), this.y, this.colunaW(), L.rowH,
        rotulo + G.valueSeparator + valor.toFixed(G.digits), this.insp.enabledInput);
      s.value = (valor - min) / (max - min);
      this.insp.ui.draw(s);
      if (s.hot !== 0) {
        const v = min + s.value * (max - min);
        if (v !== valor) { this.insp.snapshot(); novo = v; }
      }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  color(rotulo: string, rgb: number): number {
    const k = this.proxima(); let novo = rgb;
    if (this.insp.visible(this.y, L.rowH)) {
      const f = this.insp.ui.control(k, "propertyText", this.colunaX(), this.y, this.colunaW(), L.rowH, rotulo, this.insp.enabledInput);
      const antes = corHex(rgb);
      f.textValue = antes; this.insp.ui.draw(f);
      if (f.textValue !== antes) {
        const lida = lerCorHex(f.textValue);
        if (lida >= 0 && lida !== rgb) { this.insp.snapshot(); novo = lida; }
      }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  dropdown(rotulo: string, opcoes: string[], indice: number): number {
    const k = this.proxima(); let novo = indice;
    if (this.insp.visible(this.y, L.rowH) && opcoes.length > 0) {
      const b = this.insp.ui.control(k, "button", this.colunaX(), this.y, this.colunaW(), L.rowH,
        rotulo + G.valueSeparator + opcoes[indice], this.insp.enabledInput);
      this.insp.ui.draw(b);
      if (b.clicked) { this.insp.snapshot(); novo = (indice + 1) % opcoes.length; }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  alterar(): void { this.insp.snapshot(); }
  alinharComVista(o: GameObject | null): void {
    if (o === null) return;
    this.insp.snapshot();
    this.pose[0] = S.camX; this.pose[1] = S.camY; this.pose[2] = S.camZ; this.pose[3] = S.camYaw; this.pose[4] = S.camPitch;
    definirPoseDeMundo(scene, o, this.pose);
  }
}
```

`inspector.ts`:
- Campo `gui: InspectorGUIEditor`, criado no construtor depois de `this.ui`.
- `fieldRow(component: Behavior, key: string, fieldIndex: number, rowY: number): void` recebe o corpo atual das linhas 557-575: o controle `key + "/Field/" + fieldIndex` e a lógica de string/número. O laço das linhas 553-579 vira:

```ts
        rowY = rowY + L.rowH;
        this.gui.begin(component, key, rowY);
        component.onInspectorGUI(this.gui);
        if (this.gui.usos > 0) rowY = this.gui.y;
        else {
          let fieldIndex = 0;
          while (fieldIndex < component.fieldCount()) {
            if (this.visible(rowY, L.rowH)) this.fieldRow(component, key, fieldIndex, rowY);
            rowY = rowY + L.rowH;
            fieldIndex = fieldIndex + 1;
          }
        }
        rowY = rowY + L.gap;
```

`light.ts`: `import type { InspectorUI } from "./inspector_ui";`, os rótulos `const ROTULO_TIPO = "Tipo"; const ROTULO_COR = "Cor";` (rótulos do componente ficam no arquivo da classe, como `@label`), e:

```ts
  onInspectorGUI(ui: InspectorUI): void {
    this.tipo = TIPOS_LUZ[ui.dropdown(ROTULO_TIPO, TIPOS_LUZ, Math.max(0, TIPOS_LUZ.indexOf(this.tipo)))];
    this.cor = ui.color(ROTULO_COR, this.cor);
    ui.field("intensidade");
    if (this.tipo !== "direcional") ui.field("alcance");
    if (this.tipo === "spot") ui.field("anguloSpot");
    if (this.tipo === "direcional") ui.field("sombra");
  }
```

`camera.ts`: os rótulos `ROTULO_FOV = "Campo de visão"`, `ROTULO_PRINCIPAL = "Principal"`, `ROTULO_FUNDO = "Fundo"`, `ROTULO_COR_FUNDO = "Cor do fundo"`, `ROTULO_ALINHAR = "Alinhar com a vista"`, as constantes `FOV_MIN_GRAUS = 10`, `FOV_MAX_GRAUS = 150` e `GRAUS_POR_RAD = 57.29577951308232`, e:

```ts
  onInspectorGUI(ui: InspectorUI): void {
    const graus = this.fov * GRAUS_POR_RAD;
    const novo = ui.slider(ROTULO_FOV, graus, FOV_MIN_GRAUS, FOV_MAX_GRAUS);
    if (novo !== graus) this.fov = novo / GRAUS_POR_RAD;
    this.isMain = ui.toggle(ROTULO_PRINCIPAL, this.isMain !== 0) ? 1 : 0;
    ui.field("ortografica");
    if (this.ortografica) ui.field("tamanhoOrto");
    ui.field("near"); ui.field("far");
    this.fundo = FUNDOS_CAMERA[ui.dropdown(ROTULO_FUNDO, FUNDOS_CAMERA, Math.max(0, FUNDOS_CAMERA.indexOf(this.fundo)))];
    if (this.fundo === "cor") this.corFundo = ui.color(ROTULO_COR_FUNDO, this.corFundo);
    ui.field("viewportX"); ui.field("viewportY"); ui.field("viewportW"); ui.field("viewportH");
    ui.field("profundidade");
    if (ui.button(ROTULO_ALINHAR)) ui.alinharComVista(this.owner);
  }
```

`menu_items.ts`:

```ts
// Menus que juntam os presets fixos do editor e os itens @menuItem dos scripts
// (catálogo gerado). Montados uma vez; o menu global, o de contexto e o
// comando `menu` leem os mesmos registros.
import { MENU_ITEMS, runMenuItem } from "@engine/generated/editor_extensions";
import { scene, S } from "./control/session";
import { history } from "./undo";
import { logError } from "@engine/core/logger";

export const MENU_CRIAR: string = "Criar/";
export const MENU_JANELA: string = "Janela/";
export class MenuDinamico {
  /// O que o menu desenha: os fixos e depois os itens de script (sem o prefixo).
  rotulos: string[];
  fixos: number;
  /// Índice em MENU_ITEMS de cada rótulo de script.
  itens: number[];
  constructor() { this.rotulos = []; this.fixos = 0; this.itens = []; }
}
export function montarMenu(prefixo: string, fixos: string[], caminhos: string[]): MenuDinamico {
  const m = new MenuDinamico();
  let i = 0;
  while (i < fixos.length) { m.rotulos.push(fixos[i]); i = i + 1; }
  m.fixos = fixos.length;
  i = 0;
  while (i < caminhos.length) {
    if (caminhos[i].indexOf(prefixo) === 0) { m.rotulos.push(caminhos[i].slice(prefixo.length)); m.itens.push(i); }
    i = i + 1;
  }
  return m;
}
export function menuDoCatalogo(prefixo: string, fixos: string[]): MenuDinamico { return montarMenu(prefixo, fixos, MENU_ITEMS); }
export function indiceDoCaminho(caminho: string): number { return MENU_ITEMS.indexOf(caminho); }
/// Roda o item; itens de "Criar/" entram no Desfazer, aninham o primeiro objeto
/// criado em `pai` (>= 0) e selecionam o último criado. Devolve "" ou o erro.
export function executarItemDeMenu(indice: number, pai: number): string {
  let erro = "";
  if (indice < 0 || indice >= MENU_ITEMS.length) erro = "item de menu inexistente";
  else {
    const cria = MENU_ITEMS[indice].indexOf(MENU_CRIAR) === 0;
    if (cria) history.snapshot();
    const antes = scene.objects.length;
    try { runMenuItem(indice); } catch (e) { erro = String(e); logError("Menu " + MENU_ITEMS[indice] + ": " + erro); }
    if (cria && scene.objects.length > antes) {
      if (pai >= 0 && pai < antes) scene.moveSubtree(antes, scene.objects.length, pai);
      S.selected = scene.objects.length - 1; S.selection = [S.selected];
    }
  }
  return erro;
}
```

`commands/menu.ts`:

```ts
// menu [caminho] — lista ou executa um item de menu de script (Criar/…, Janela/…).
import { MENU_ITEMS } from "@engine/generated/editor_extensions";
import { indiceDoCaminho, executarItemDeMenu } from "../../menu_items";
import { S } from "../session";
export function cmdMenu(parts: string[]): string {
  let out = "";
  if (parts.length < 2) out = "[menu] " + (MENU_ITEMS.length > 0 ? MENU_ITEMS.join(" | ") : "(nenhum item de script)");
  else {
    const caminho = parts.slice(1).join(" ");
    const i = indiceDoCaminho(caminho);
    if (i < 0) out = "[erro] item de menu inexistente: " + caminho;
    else {
      const erro = executarItemDeMenu(i, 0 - 1);
      out = erro.length > 0 ? "[erro] " + erro : "[ok] " + caminho + " (selecionado #" + S.selected + ")";
    }
  }
  return out;
}
```

- `dispatch.ts`: `case "menu": return cmdMenu(parts);`. Fica fora de `isMutating`, porque o executor tira o próprio snapshot só para "Criar/".
- `BUILTIN_COMMANDS`: acrescentar `"menu"`.
- `help`: `| menu [caminho]  (itens de script: Criar/…, Janela/…)`.
- `doc`: `"menu [caminho] :: sem argumento lista os itens @menuItem; com caminho executa (Criar/ entra no Desfazer) :: menu Criar/Luz/Pontual"`.

`main.ts`:
- Depois dos imports: `const menuCriar = menuDoCatalogo(MENU_CRIAR, OBJECT_PRESET_LABELS);` e `const menuConfig: string[] = ["", "", UI_SETTINGS.resetLayout, UI_CODE_EDITOR.title];`.
- Função `menuEntries(menu: number): string[]`, que devolve `UI_FILE_ACTIONS`, `UI_EDIT_ACTIONS`, `menuCriar.rotulos`, `menuConfig` (antes de devolver, `menuConfig[0]`/`[1]` recebem as constantes de `UI_SETTINGS` conforme `S.snap`/`vsyncOn`) ou `UI_HELP_ACTIONS`.
- Linha 605: `OBJECT_PRESETS.length * UI_MENU_ROW_H` → `menuEntries(menuOpen).length * UI_MENU_ROW_H`. A área clicável acompanha o menu desenhado.
- Linhas 1461-1464: `entries = menuEntries(menuOpen);`.
- Linha 1506: `if (chosen < menuCriar.fixos) createMenuObject(chosen, 0 - 1); else executarItemDeMenu(menuCriar.itens[chosen - menuCriar.fixos], 0 - 1);`.
- Menu de contexto (1397-1450): `const nCriar = menuCriar.rotulos.length;` troca `OBJECT_PRESETS.length` em `items`, no rótulo (`menuCriar.rotulos[labelIdx]`) e no despacho: `clicked < menuCriar.fixos` → `createMenuObject`; `< nCriar` → `executarItemDeMenu(menuCriar.itens[clicked - menuCriar.fixos], ctxTarget)`; `=== nCriar` → duplicar; `=== nCriar + 1` → excluir.

- [ ] **Step 4: Run tests**

Run:
```
npm run components && npm run test:components && npm run components:check && npm run check:params
node --test tests/editor-static.test.mjs
$RTS run tests/test_menu_items.ts
$RTS run tests/test_inspector_gui.ts
$RTS run tests/test_inspector_skeleton.ts
$RTS run tests/test_inspector_animator.ts
$RTS run tests/test_inspector_text.ts
$RTS run tests/test_editor_ui.ts
```
Expected: tudo verde; `[PASSOU] menu: ...` e `[PASSOU] inspector gui: ...`.

- [ ] **Step 5: Commit**

`git add -A && git commit -m "feat(editor): @menuItem no catálogo e nos menus; onInspectorGUI com InspectorUI; GUI de Light e Camera"`

---

### Task 9: Pacotes `luz/` e `camera/` — gizmos, menus, controles de câmera e comandos WS

**Files:**
- Create: `src/engine/core/entrada.ts`
- Create: `assets/pacotes/luz/luz_editor.ts` (`@editorOnly`)
- Create: `assets/pacotes/camera/camera_matematica.ts`, `assets/pacotes/camera/alvo.ts`
- Create: `assets/pacotes/camera/camera_primeira_pessoa.ts`, `camera_orbita.ts`, `camera_seguir.ts`, `camera_rts.ts`
- Create: `assets/pacotes/camera/camera_editor.ts` (`@editorOnly`)
- Modify: `src/editor/object_presets.ts` (sai a linha 8, "Câmera", e o campo `camera` de todos os registros)
- Modify: `main.ts` (`createMenuObject`, linhas 213-223: sai o ramo `preset.camera`; `definirJanelaEntrada(WIN)` junto de `S.win = WIN`, linha 404) e `game.ts` (`definirJanelaEntrada(WIN)` junto de `S.win = WIN`)
- Regenerate: `src/engine/generated/*`
- Test: `tests/test_pacote_luz.ts`, `tests/test_pacote_camera.ts`

**Interfaces:**
- Consumes: `registerCommand`, `registerGizmo`, `Editor.*` (Task 6/7); `Light`, `LUZ_*`, `TIPOS_LUZ`, `LUZ_PADRAO_PITCH/YAW` (Task 3); `Camera` API (Task 4); `lerCorHex`, `corHex`, `definirPoseDeMundo` (Task 8); `activeScene` (Task 4).
- Produces:
  - `entrada.ts`: `TECLA_W=122, TECLA_S=118, TECLA_A=100, TECLA_D=103, TECLA_ESPACO=3, BOTAO_DIREITO=1`, `definirJanelaEntrada(win)`, `teclaSegurada(codigo): boolean`, `eixoTeclas(positiva, negativa): number`, `mouseSegurado(botao): boolean`, `mouseDX(): number`, `mouseDY(): number`, `rodaMouse(): number`
  - `camera_matematica.ts`: `PITCH_LIMITE_FPS`, `olharFps(ang: Float64Array, dx, dy, sens): void`, `orbitaPose(alvo, ang, out): void`, `amortecerCritico(est: Float64Array, i: number, alvo: number, cfg: Float64Array): void`, `limitarZoom(atual, delta, min, max): number`
  - `alvo.ts`: `acharAlvo(nome: string, cache: GameObject | null): GameObject | null`
  - Componentes (categoria "Câmera"): `CameraPrimeiraPessoa`, `CameraOrbita`, `CameraSeguir`, `CameraRTS`
  - Itens: `Criar/Luz/Direcional`, `Criar/Luz/Pontual`, `Criar/Luz/Spot`, `Criar/Câmera`
  - WS:
    - `luz add <tipo> <x> <y> <z>` e `luz <obj> set <tipo|cor|intensidade|alcance|angulo|sombra> <valor>` (muta);
    - `luzes` (consulta);
    - `camera add`, `camera main <obj>`, `camera ray <x> <y>`, `camera <obj> set <campo> <valores>` e `camera <obj> alinhar` (os subcomandos que mutam tiram snapshot);
    - `cameras` (consulta).

- [ ] **Step 1: Write the failing test**

`tests/test_pacote_camera.ts`:

```ts
// Teste SEM JANELA do pacote camera/: matemática dos controles (FPS, órbita,
// amortecimento crítico, zoom), os componentes rodando sem entrada, o item
// Criar/Câmera, os comandos `camera`/`cameras` e o gizmo da câmera.
//   rts.exe run tests/test_pacote_camera.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { olharFps, orbitaPose, amortecerCritico, limitarZoom, PITCH_LIMITE_FPS } from "../assets/pacotes/camera/camera_matematica";
import { CameraOrbita } from "../assets/pacotes/camera/camera_orbita";
import { CameraSeguir } from "../assets/pacotes/camera/camera_seguir";
import { CameraRTS } from "../assets/pacotes/camera/camera_rts";
import { Camera } from "@engine/core/camera";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { OBJECT_PRESET_LABELS } from "@editor/object_presets";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { gizmosBegin } from "@engine/core/gizmos";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
instalarEditorReal();

// FPS: pitch preso em ±89°
const ang = new Float64Array(3);
olharFps(ang, 100.0, 0 - 1000000.0, 0.005);
check(ang[1] === PITCH_LIMITE_FPS && Math.abs(ang[0] - 0.5) < 1e-12, "olhar para cima preso em 89°");
olharFps(ang, 0.0, 2000000.0, 0.005);
check(ang[1] === 0.0 - PITCH_LIMITE_FPS, "olhar para baixo preso em -89°");
// órbita: distância e mira constantes
const alvo = new Float64Array(3); alvo[0] = 1.0; alvo[1] = 2.0; alvo[2] = 3.0;
const pose = new Float64Array(5);
const yaws: number[] = [0.0, 1.0, 2.5]; const pitches: number[] = [0 - 0.6, 0.0, 0.7];
let a = 0;
while (a < 3) {
  let b = 0;
  while (b < 3) {
    ang[0] = yaws[a]; ang[1] = pitches[b]; ang[2] = 6.0;
    orbitaPose(alvo, ang, pose);
    const dx = alvo[0] - pose[0]; const dy = alvo[1] - pose[1]; const dz = alvo[2] - pose[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fx = Math.sin(pose[3]) * Math.cos(pose[4]); const fy = Math.sin(pose[4]); const fz = Math.cos(pose[3]) * Math.cos(pose[4]);
    check(Math.abs(d - 6.0) < 1e-9 && Math.abs((dx * fx + dy * fy + dz * fz) / d - 1.0) < 1e-9, "órbita mantém distância e mira");
    b = b + 1;
  }
  a = a + 1;
}
// amortecimento crítico: converge sem ultrapassar, subindo e descendo, com dt pequeno e grande
const est = new Float64Array(6); const cfg = new Float64Array(2); cfg[0] = 0.3; cfg[1] = 1.0 / 60.0;
let k = 0; let anterior = 0.0;
while (k < 600) { amortecerCritico(est, 0, 10.0, cfg); check(est[0] <= 10.0 && est[0] >= anterior, "sobe sem ultrapassar"); anterior = est[0]; k = k + 1; }
check(Math.abs(est[0] - 10.0) < 1e-3, "converge: " + est[0]);
cfg[1] = 0.5; est[2] = 10.0; est[3] = 0.0; k = 0;
while (k < 50) { amortecerCritico(est, 1, 0.0, cfg); check(est[2] >= 0.0, "desce sem ultrapassar com dt grande"); k = k + 1; }
// zoom
let z = 20.0; k = 0; while (k < 1000) { z = limitarZoom(z, 5.0, 5.0, 60.0); k = k + 1; }
check(z === 60.0, "zoom máximo");
k = 0; while (k < 1000) { z = limitarZoom(z, 0 - 5.0, 5.0, 60.0); k = k + 1; }
check(z === 5.0 && limitarZoom(0.0, 0.0, 60.0, 5.0) === 5.0, "zoom mínimo e limites trocados");

// componentes (sem janela: sem entrada)
scene.clear();
const alvoObj = scene.createGameObject("Alvo"); alvoObj.transform.setPosition(1.0, 2.0, 3.0);
const co = scene.createGameObject("Orbita"); co.transform.ry = 0.4; co.transform.rx = 0 - 0.3;
const orb = new CameraOrbita(); orb.alvo = "Alvo"; orb.distancia = 6.0; co.addBehavior(orb);
scene.computeWorld(); orb.update(1.0 / 60.0);
const odx = 1.0 - co.transform.px; const ody = 2.0 - co.transform.py; const odz = 3.0 - co.transform.pz;
check(Math.abs(Math.sqrt(odx * odx + ody * ody + odz * odz) - 6.0) < 1e-9, "CameraOrbita mantém a distância do alvo");
const cs = scene.createGameObject("Segue"); cs.transform.setPosition(0.0, 0.0, 0 - 30.0);
const seg = new CameraSeguir(); seg.alvo = "Alvo"; cs.addBehavior(seg);
k = 0; let zAntes = 0 - 30.0;
while (k < 600) { seg.update(1.0 / 60.0); check(cs.transform.pz >= zAntes && cs.transform.pz <= 3.0 + seg.deslocZ + 1e-9, "CameraSeguir sem ultrapassar"); zAntes = cs.transform.pz; k = k + 1; }
check(Math.abs(cs.transform.pz - (3.0 + seg.deslocZ)) < 1e-3 && Math.abs(cs.transform.py - (2.0 + seg.deslocY)) < 1e-3, "CameraSeguir converge ao deslocamento");
const cr = scene.createGameObject("RTS"); const rts = new CameraRTS(); cr.addBehavior(rts);
rts.zoomMin = 80.0; rts.zoomMax = 10.0; rts.onValidate("zoomMin");
check(rts.zoomMin === 10.0 && rts.zoomMax === 80.0, "limites trocados são corrigidos");
rts.zoom = 500.0; rts.update(1.0 / 60.0);
check(cr.transform.py === 80.0 && Math.abs(cr.transform.rx + rts.inclinacao * Math.PI / 180.0) < 1e-9, "CameraRTS respeita o zoom máximo e a inclinação");

// Criar/Câmera substitui o preset antigo
check(OBJECT_PRESET_LABELS.indexOf("Câmera") < 0, "o preset Câmera saiu de object_presets.ts");
history.u = []; history.r = [];
S.camX = 2.0; S.camY = 3.0; S.camZ = 4.0; S.camYaw = 0.25; S.camPitch = 0 - 0.1;
check(executarItemDeMenu(indiceDoCaminho("Criar/Câmera"), 0 - 1) === "", "item Criar/Câmera");
const nova = scene.objects[S.selected];
check(nova.name === "Câmera" && nova.camIdx >= 0 && nova.transform.px === 2.0 && nova.transform.ry === 0.25, "câmera na pose da vista");
check(history.undoDepth() === 1, "Criar entra no Desfazer");

// comandos
const ci = S.selected;
check(execCommand(800, 600, "camera " + ci + " set fov 70").indexOf("[ok]") === 0, "camera set fov");
const cam = nova.behaviors[nova.camIdx] as Camera;
check(Math.abs(cam.fov * 180.0 / Math.PI - 70.0) < 1e-9 && history.undoDepth() === 2, "fov em graus, com Desfazer");
check(execCommand(800, 600, "camera " + ci + " set viewport 0.5 0 0.5 1").indexOf("[ok]") === 0 && cam.viewportX === 0.5, "viewport");
check(execCommand(800, 600, "camera " + ci + " set fundo marrom").indexOf("[erro]") === 0, "fundo inválido = erro");
check(execCommand(800, 600, "camera main " + ci).indexOf("[ok]") === 0 && cam.isMain === 1, "camera main");
cam.definirRetangulo(0.0, 0.0, 800.0, 600.0); nova.transform.ry = 0.0; nova.transform.rx = 0.0; scene.computeWorld();
const antes = history.undoDepth();
const ray = execCommand(800, 600, "camera ray 400 300");
check(ray.indexOf("direcao (0.000, 0.000, 1.000)") > 0 && history.undoDepth() === antes, "camera ray é consulta: " + ray);
check(execCommand(800, 600, "cameras").indexOf("Câmera") > 0 && history.undoDepth() === antes, "cameras lista sem Desfazer");
check(execCommand(800, 600, "camera 999 set fov 60").indexOf("[erro]") === 0, "objeto sem câmera = erro");
// gizmo da câmera: ícone sempre; frustum (4 raios + 4 bordas) só selecionada
const gp = new Float64Array(8); gp[2] = 0 - 20.0; gp[5] = 1.0; gp[6] = 1280.0; gp[7] = 720.0;
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0 - 1);
check(gizmosDoEditor.nIc >= 1 && gizmosDoEditor.nSeg === 0, "não selecionada: só o ícone");
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, ci);
check(gizmosDoEditor.nSeg === 8, "selecionada: frustum com 8 linhas: " + gizmosDoEditor.nSeg);
io.print("[PASSOU] pacote camera: FPS, órbita, amortecimento, zoom, componentes, Criar/Câmera, comandos, gizmo");
```

`tests/test_pacote_luz.ts`:

```ts
// Teste SEM JANELA do pacote luz/: comandos `luz`/`luzes`, itens Criar/Luz/*
// e o gizmo da luz (ícone por tipo; seta, esfera ou cone quando selecionada).
//   rts.exe run tests/test_pacote_luz.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { Light } from "@engine/core/light";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { gizmosBegin, GIZMO_SEGMENTOS_CIRCULO, GIZMO_ARESTAS_CONE } from "@engine/core/gizmos";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "luz add pontual 1 2 3").indexOf("[ok] #0") === 0, "luz add");
const l = scene.objects[0].behaviors[0] as Light;
check(l.tipo === "pontual" && scene.objects[0].transform.px === 1.0 && history.undoDepth() === 1, "pontual em (1,2,3) com Desfazer");
check(execCommand(800, 600, "luz 0 set cor #ff8000").indexOf("[ok]") === 0 && l.cor === 0xFF8000, "cor");
check(execCommand(800, 600, "luz 0 set intensidade 2.5").indexOf("[ok]") === 0 && l.intensidade === 2.5, "intensidade");
check(execCommand(800, 600, "luz 0 set tipo spot").indexOf("[ok]") === 0 && l.tipo === "spot", "tipo");
check(execCommand(800, 600, "luz 0 set tipo lanterna").indexOf("[erro]") === 0, "tipo inválido");
check(execCommand(800, 600, "luz 0 set cor laranja").indexOf("[erro]") === 0, "cor inválida");
check(execCommand(800, 600, "luz 7 set cor #ffffff").indexOf("[erro]") === 0, "objeto sem luz");
check(execCommand(800, 600, "luz add lanterna 0 0 0").indexOf("[erro]") === 0, "add com tipo inválido");
const d = history.undoDepth();
check(execCommand(800, 600, "luzes").indexOf("#0 Luz Pontual tipo=spot cor=#FF8000") > 0 && history.undoDepth() === d, "luzes é consulta");
check(execCommand(800, 600, "help").indexOf("luz add") > 0, "comando no help");
// itens de menu
S.camX = 0.0; S.camY = 0.0; S.camZ = 0.0; S.camYaw = 0.0; S.camPitch = 0.0;
check(executarItemDeMenu(indiceDoCaminho("Criar/Luz/Spot"), 0 - 1) === "", "Criar/Luz/Spot");
const spot = scene.objects[S.selected];
check(spot.name === "Luz Spot" && spot.transform.pz === 8.0 && Math.abs(spot.transform.rx + Math.PI / 2.0) < 1e-12, "spot nasce à frente apontando para baixo");
check(indiceDoCaminho("Criar/Luz/Direcional") >= 0 && indiceDoCaminho("Criar/Luz/Pontual") >= 0, "os três itens");
// gizmo
scene.computeWorld();
const gp = new Float64Array(8); gp[2] = 0 - 20.0; gp[5] = 1.0; gp[6] = 1280.0; gp[7] = 720.0;
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0 - 1);
check(gizmosDoEditor.nIc === 2 && gizmosDoEditor.icNomes[0] === "luz-spot" && gizmosDoEditor.nSeg === 0, "só ícones sem seleção");
l.tipo = "pontual";
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0);
check(gizmosDoEditor.nSeg === 3 * GIZMO_SEGMENTOS_CIRCULO && gizmosDoEditor.icNomes[0] === "luz-pontual", "pontual selecionada: esfera de alcance");
l.tipo = "spot";
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0);
check(gizmosDoEditor.nSeg === GIZMO_SEGMENTOS_CIRCULO + GIZMO_ARESTAS_CONE, "spot selecionada: cone");
l.tipo = "direcional";
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0);
check(gizmosDoEditor.nSeg === 1, "direcional selecionada: uma seta");
io.print("[PASSOU] pacote luz: comandos, consulta, menus, gizmo por tipo");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_pacote_luz.ts ; $RTS run tests/test_pacote_camera.ts`
Expected: FAIL — `[erro] desconhecido: luz` no primeiro `check`; `cannot resolve module "../assets/pacotes/camera/camera_matematica"`.

- [ ] **Step 3: Implementation**

`entrada.ts`:

```ts
// Entrada para scripts de jogo (controles de câmera etc.): teclado e mouse da
// janela do jogo. Sem janela (testes, sem definirJanelaEntrada) tudo responde 0.
import input from "rts:input";
export const TECLA_W: number = 122; export const TECLA_S: number = 118;
export const TECLA_A: number = 100; export const TECLA_D: number = 103;
export const TECLA_ESPACO: number = 3;
export const BOTAO_DIREITO: number = 1;
/// Fase "segurada" de rts:input.key (a mesma de compat/app.ts:PHASE_DOWN).
const FASE_SEGURADA: number = 0;
let janela = 0;
export function definirJanelaEntrada(win: number): void { janela = win; }
export function teclaSegurada(codigo: number): boolean { return janela !== 0 && input.key(janela, codigo, FASE_SEGURADA); }
export function eixoTeclas(positiva: number, negativa: number): number { return (teclaSegurada(positiva) ? 1 : 0) - (teclaSegurada(negativa) ? 1 : 0); }
export function mouseSegurado(botao: number): boolean { return janela !== 0 && input.mouseDown(janela, botao); }
export function mouseDX(): number { return janela !== 0 ? input.mouseDeltaX(janela) : 0.0; }
export function mouseDY(): number { return janela !== 0 ? input.mouseDeltaY(janela) : 0.0; }
export function rodaMouse(): number { return janela !== 0 ? input.wheel(janela) : 0.0; }
```

`camera_matematica.ts`:

```ts
// Matemática pura dos controles de câmera (testável sem janela). Convenção do
// renderer: fwd = (sin yaw·cos p, sin p, cos yaw·cos p), pitch > 0 olha para cima.
import math from "@compat/math.ts";
export const PITCH_LIMITE_FPS: number = 1.5533430342749532;   // 89°
/// Tempo de suavização mínimo aceito (evita divisão por zero).
const TEMPO_MIN: number = 0.0001;
/// ang = [yaw, pitch]; dx/dy em pixels; sens em radianos por pixel. Pitch preso em ±89°.
export function olharFps(ang: Float64Array, dx: number, dy: number, sens: number): void {
  ang[0] = ang[0] + dx * sens;
  const p = ang[1] - dy * sens;
  ang[1] = p > PITCH_LIMITE_FPS ? PITCH_LIMITE_FPS : (p < 0.0 - PITCH_LIMITE_FPS ? 0.0 - PITCH_LIMITE_FPS : p);
}
/// alvo = [x, y, z]; ang = [yaw, pitch, distância] → out = [x, y, z, yaw, pitch] da câmera mirando o alvo.
export function orbitaPose(alvo: Float64Array, ang: Float64Array, out: Float64Array): void {
  const cy = math.cos(ang[0]); const sy = math.sin(ang[0]); const cp = math.cos(ang[1]); const sp = math.sin(ang[1]);
  out[0] = alvo[0] - sy * cp * ang[2]; out[1] = alvo[1] - sp * ang[2]; out[2] = alvo[2] - cy * cp * ang[2];
  out[3] = ang[0]; out[4] = ang[1];
}
/// Amortecimento crítico (SmoothDamp) do eixo i: est = [pos0, vel0, pos1, vel1, pos2, vel2],
/// cfg = [tempo de suavização, dt]. Nunca ultrapassa o alvo.
export function amortecerCritico(est: Float64Array, i: number, alvo: number, cfg: Float64Array): void {
  const tempo = cfg[0] > TEMPO_MIN ? cfg[0] : TEMPO_MIN;
  const dt = cfg[1];
  const omega = 2.0 / tempo; const x = omega * dt;
  const fator = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x);
  const atual = est[i * 2]; const vel = est[i * 2 + 1];
  const mudanca = atual - alvo;
  const temp = (vel + omega * mudanca) * dt;
  let novaVel = (vel - omega * temp) * fator;
  let saida = alvo + (mudanca + temp) * fator;
  if ((alvo - atual > 0.0) === (saida > alvo)) { saida = alvo; novaVel = 0.0; }
  est[i * 2] = saida; est[i * 2 + 1] = novaVel;
}
/// Soma `delta` e prende em [min, max]; limites trocados são aceitos.
export function limitarZoom(atual: number, delta: number, min: number, max: number): number {
  const lo = min < max ? min : max; const hi = min < max ? max : min;
  const z = atual + delta;
  return z < lo ? lo : (z > hi ? hi : z);
}
```

`alvo.ts`:

```ts
import type { GameObject } from "@engine/core/gameobject";
import { activeScene } from "@engine/core/active_scene";
/// O GameObject de nome `nome` na cena ativa; reaproveita `cache` enquanto ele
/// ainda estiver numa cena (uiOwner não nulo) e com o mesmo nome.
export function acharAlvo(nome: string, cache: GameObject | null): GameObject | null {
  let achado: GameObject | null = null;
  if (cache !== null && cache.name === nome && cache.uiOwner !== null) achado = cache;
  const sc = activeScene();
  if (achado === null && sc !== null && nome.length > 0) {
    let i = 0;
    while (i < sc.objects.length && achado === null) { if (sc.objects[i].name === nome) achado = sc.objects[i]; i = i + 1; }
  }
  return achado;
}
```

Os componentes ficam cada um no seu arquivo, com `@componentCategory Câmera` e `@componentDescription`/`@componentKeywords`. Todos supõem uma câmera raiz (escrevem o transform local) e usam `private` para rascunhos (fora do Inspector e do JSON):
- **`CameraPrimeiraPessoa`**:
  - campos `velocidade = 6`, `sensibilidade = 0.005`, `exigirBotaoDireito = true`;
  - `update`: olha com `olharFps` quando o botão direito está segurado (ou sempre, sem `exigirBotaoDireito`) e move pelo `fwd` e pelo `right` com `eixoTeclas(TECLA_W, TECLA_S)`/`eixoTeclas(TECLA_D, TECLA_A)` × `velocidade × dt`; espaço sobe.
- **`CameraOrbita`**:
  - campos `alvo = ""`, `distancia = 6` (`@range 0.5 1000`), `sensibilidade = 0.005`, `passoZoom = 0.5`, e as constantes `DIST_MIN = 0.5`, `DIST_MAX = 1000`;
  - `update`: `acharAlvo`; `ang` ← `ry`/`rx`; `olharFps` com o botão direito; `distancia = limitarZoom(distancia, -rodaMouse()·passoZoom, DIST_MIN, DIST_MAX)`; `orbitaPose` → `px, py, pz, ry, rx`.
- **`CameraSeguir`**:
  - campos `alvo = ""`, `deslocX = 0`, `deslocY = 3`, `deslocZ = -6`, `suavizacao = 0.3` (`@range 0.01 10`), `olharAlvo = true`;
  - `private est` = `Float64Array(6)`, `private cfg` = `Float64Array(2)`, `private iniciado = false`;
  - `update`: `amortecerCritico` nos 3 eixos até `alvo + desloc`; com `olharAlvo`, `ry = atan2(dx, dz)` e `rx = atan2(dy, sqrt(dx² + dz²))`.
- **`CameraRTS`**:
  - campos `velocidade = 12`, `zoomMin = 5`, `zoomMax = 60`, `zoom = 20`, `passoZoom = 2`, `inclinacao = 55` (`@range 10 89`);
  - `onValidate` troca os limites invertidos e prende o `zoom`;
  - `update`: pan em XZ relativo ao `ry` (`fwd` horizontal = (sin ry, 0, cos ry), `right` = (cos ry, 0, −sin ry)), `zoom = limitarZoom(zoom, -rodaMouse()·passoZoom, zoomMin, zoomMax)`, `py = zoom`, `rx = −inclinacao·π/180`.

`luz_editor.ts`:

```ts
/** @editorOnly */
// Pacote luz: gizmo da Light (ícone por tipo; seta, esfera de alcance ou cone
// quando selecionada), itens Criar/Luz/* e os comandos `luz` e `luzes`.
import { Editor, registerCommand, registerGizmo, Gizmos } from "@editor/api";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { Light, TIPOS_LUZ, FLOATS_POR_LUZ, LUZ_DIRECIONAL, LUZ_PONTUAL, LUZ_PADRAO_PITCH, LUZ_PADRAO_YAW } from "@engine/core/light";
import { corHex, lerCorHex } from "@engine/core/cor";

const ICONES_LUZ: string[] = ["luz-direcional", "luz-pontual", "luz-spot"];
const NOMES_LUZ: string[] = ["Luz Direcional", "Luz Pontual", "Luz Spot"];
/// Comprimento da seta da direcional no gizmo, em unidades de mundo.
const SETA_DIRECIONAL: number = 2.0;
/// O spot nasce apontando para baixo.
const PITCH_SPOT: number = 0.0 - 1.5707963267948966;
const pacote = new Float64Array(FLOATS_POR_LUZ);
const p0 = new Float64Array(3); const p1 = new Float64Array(3); const dir = new Float64Array(3);
const ponto = new Float64Array(5);

function desenharLuz(g: Gizmos, dono: GameObject, comp: Behavior): void {
  const luz = comp as Light;
  luz.lightPack(pacote, 0);
  const tipo = pacote[0];
  p0[0] = pacote[1]; p0[1] = pacote[2]; p0[2] = pacote[3];
  dir[0] = pacote[4]; dir[1] = pacote[5]; dir[2] = pacote[6];
  g.color(luz.cor);
  g.icon(ICONES_LUZ[tipo], p0);
  if (g.selecionado) {
    if (tipo === LUZ_DIRECIONAL) {
      p1[0] = p0[0] + dir[0] * SETA_DIRECIONAL; p1[1] = p0[1] + dir[1] * SETA_DIRECIONAL; p1[2] = p0[2] + dir[2] * SETA_DIRECIONAL;
      g.line(p0, p1);
    } else if (tipo === LUZ_PONTUAL) g.wireSphere(p0, luz.alcance);
    else g.wireCone(p0, dir, luz.alcance, luz.anguloSpot);
  }
}
registerGizmo("Light", desenharLuz);

/// Cria a luz na cena do editor, à frente da vista (ou em `pos`, se dado).
function criarLuz(tipo: string, pos: Float64Array | null): GameObject | null {
  const sc = Editor.scene();
  let o: GameObject | null = null;
  const t = TIPOS_LUZ.indexOf(tipo);
  if (sc !== null && t >= 0) {
    o = sc.createGameObject(NOMES_LUZ[t]);
    if (pos === null) { Editor.spawnPoint(ponto); o.transform.setPosition(ponto[0], ponto[1], ponto[2]); }
    else o.transform.setPosition(pos[0], pos[1], pos[2]);
    if (t === 0) { o.transform.rx = LUZ_PADRAO_PITCH; o.transform.ry = LUZ_PADRAO_YAW; }
    if (t === 2) o.transform.rx = PITCH_SPOT;
    const l = new Light(); l.tipo = tipo; o.addBehavior(l);
  }
  return o;
}
export class LuzMenu {
  /** @menuItem Criar/Luz/Direcional */
  static direcional(): void { criarLuz("direcional", null); }
  /** @menuItem Criar/Luz/Pontual */
  static pontual(): void { criarLuz("pontual", null); }
  /** @menuItem Criar/Luz/Spot */
  static spot(): void { criarLuz("spot", null); }
}

function luzDe(indice: string): Light | null {
  const sc = Editor.scene(); const i = parseFloat(indice);
  let l: Light | null = null;
  if (sc !== null && i === Math.floor(i) && i >= 0 && i < sc.objects.length && sc.objects[i].lightIdx >= 0) l = sc.objects[i].behaviors[sc.objects[i].lightIdx] as Light;
  return l;
}
function cmdLuz(p: string[]): string {
  let out = "[erro] uso: luz add <tipo> <x> <y> <z> | luz <obj> set <tipo|cor|intensidade|alcance|angulo|sombra> <valor>";
  if (p.length >= 6 && p[1] === "add") {
    const xyz = new Float64Array(3); xyz[0] = parseFloat(p[3]); xyz[1] = parseFloat(p[4]); xyz[2] = parseFloat(p[5]);
    if (TIPOS_LUZ.indexOf(p[2]) < 0) out = "[erro] tipo de luz: use " + TIPOS_LUZ.join(", ");
    else if (xyz[0] !== xyz[0] || xyz[1] !== xyz[1] || xyz[2] !== xyz[2]) out = "[erro] posição inválida";
    else {
      const o = criarLuz(p[2], xyz);
      const sc = Editor.scene();
      if (o !== null && sc !== null) { const i = sc.objects.length - 1; Editor.select(o); out = "[ok] #" + i + " " + o.name; }
    }
  } else if (p.length >= 5 && p[2] === "set") {
    const l = luzDe(p[1]);
    const v = parseFloat(p[4]);
    if (l === null) out = "[erro] objeto sem Light: " + p[1];
    else if (p[3] === "tipo") { if (TIPOS_LUZ.indexOf(p[4]) < 0) out = "[erro] tipo de luz: use " + TIPOS_LUZ.join(", "); else { l.tipo = p[4]; out = "[ok] tipo=" + l.tipo; } }
    else if (p[3] === "cor") { const c = lerCorHex(p[4]); if (c < 0) out = "[erro] cor: use #RRGGBB"; else { l.cor = c; out = "[ok] cor=" + corHex(c); } }
    else if (v !== v || v < 0.0) out = "[erro] valor numérico >= 0";
    else if (p[3] === "intensidade") { l.intensidade = v; out = "[ok] intensidade=" + v; }
    else if (p[3] === "alcance") { l.alcance = v; out = "[ok] alcance=" + v; }
    else if (p[3] === "angulo") { l.anguloSpot = v; l.onValidate("anguloSpot"); out = "[ok] angulo=" + l.anguloSpot; }
    else if (p[3] === "sombra") { l.sombra = v !== 0.0; out = "[ok] sombra=" + (l.sombra ? 1 : 0); }
    else out = "[erro] campo: tipo, cor, intensidade, alcance, angulo, sombra";
  }
  return out;
}
function cmdLuzes(p: string[]): string {
  const sc = Editor.scene();
  let out = "[luzes]";
  if (sc !== null) {
    let i = 0;
    while (i < sc.objects.length) {
      const o = sc.objects[i];
      if (o.lightIdx >= 0) {
        const l = o.behaviors[o.lightIdx] as Light;
        out = out + " | #" + i + " " + o.name + " tipo=" + l.tipo + " cor=" + corHex(l.cor) + " int=" + l.intensidade +
          " alc=" + l.alcance + " ang=" + l.anguloSpot + " sombra=" + (l.sombra ? 1 : 0) + (o.active !== 0 ? "" : " (inativa)");
      }
      i = i + 1;
    }
  }
  return out;
}
registerCommand("luz", "luz add <tipo> <x> <y> <z> | luz <obj> set <campo> <valor> :: cria uma luz ou muda um campo (cor em #RRGGBB, ângulo do spot em graus) :: luz add pontual 0 3 0", true, cmdLuz);
registerCommand("luzes", "luzes :: lista as luzes da cena (tipo, cor, intensidade, alcance, ângulo, sombra) :: luzes", false, cmdLuzes);
```

`Light.onValidate` também prende `anguloSpot` em 1..179 (acrescentar ao `onValidate` da Task 3).

`camera_editor.ts`:
- `/** @editorOnly */`.
- **Gizmo `"Camera"`**:
  - `g.color(COR_CAMERA = 0x9AC7F0)` e `g.icon("camera", pos)`;
  - selecionada: `viewportPointToRay` nos cantos (0,0), (1,0), (1,1) e (0,1). Cada canto = origem + dir × `min(far, FRUSTUM_GIZMO = 3)`. Linhas: da posição da câmera (ortográfica: da origem do raio) até cada canto, e entre cantos consecutivos. Total de 8 segmentos.
  - Rascunhos são `Float64Array` do módulo.
- **`CameraMenu`**: `/** @menuItem Criar/Câmera */ static camera()` chama `criarCameraNaVista()`. Ela cria "Câmera" via `Editor.scene().createGameObject`, com a pose de `Editor.viewPose` (posição, `ry`, `rx`) e `new Camera()`.
- **Comando `camera`** (`registerCommand("camera", …, false, cmdCamera)`), em que cada subcomando que muta chama `Editor.snapshot("camera …")` antes:
  - `add` → `criarCameraNaVista()`, com `[ok] #i Câmera`;
  - `main <obj>` → `isMain = 1` nessa e 0 nas outras câmeras;
  - `ray <x> <y>` → `Camera.main().screenPointToRay`, resposta `[ok] origem (x, y, z) direcao (x, y, z)` com `toFixed(3)`; sem câmera, `[erro] sem câmera principal`;
  - `<obj> alinhar` → `Editor.viewPose` + `definirPoseDeMundo`;
  - `<obj> set <campo> <valores>`: `fov` (graus, 10..150), `near`, `far`, `orto 0|1`, `tamanho`, `fundo ceu|cor|nada`, `cor #RRGGBB`, `viewport x y w h`, `profundidade`, `principal 0|1`; depois, `cam.onValidate(campo)`.
  - Erros: `[erro] objeto sem Camera: N`, `[erro] fundo: use ceu, cor, nada`, `[erro] valor numérico`.
- **Comando `cameras`** (`muta = false`): lista `#i nome fov=… (graus) orto=… viewport=(x,y,w,h) prof=… main=… rect=(px…)`.
- **`object_presets.ts`**: sai a linha 8 e o campo `camera` dos outros registros.
- **`main.ts`**: `createMenuObject` fica só com `ctxCreate(...)`; sai o import de `createComponent`, se ficar sem uso. `definirJanelaEntrada(WIN)` vai junto de `S.win = WIN` em `main.ts` e `game.ts`.
- **Gerar**: `npm run components` (os 4 controles entram no catálogo; `editor_extensions.ts` importa `luz_editor.ts` e `camera_editor.ts` e lista os 4 itens de menu).

- [ ] **Step 4: Run tests**

Run:
```
npm run components && npm run test:components && npm run components:check && npm run check:params
$RTS run tests/test_pacote_luz.ts
$RTS run tests/test_pacote_camera.ts
$RTS run tools/game-build/claude-test-registro.ts
$RTS run tests/test_editor_api.ts
$RTS run tests/test_scene_create.ts
```
Expected: tudo verde; `[PASSOU] pacote luz: ...` e `[PASSOU] pacote camera: ...`. O registro do jogo tem os 4 controles de câmera e nada de `luz_editor`/`camera_editor`.

- [ ] **Step 5: Commit**

`git add -A && git commit -m "feat(pacotes): luz/ e camera/ (gizmos, Criar/Luz e Criar/Câmera, controles FPS/órbita/seguir/RTS, comandos WS)"`

---

### Task 10: Pacote `ambiente/`, menu Janela, aba Jogo com várias câmeras e prévia da câmera

**Files:**
- Create: `assets/pacotes/ambiente/ambiente_editor.ts` (`@editorOnly`), `assets/pacotes/ambiente/ciclo_do_dia.ts`
- Create: `src/editor/game_view.ts`, `src/editor/control/commands/gameview.ts`
- Modify: `src/editor/control/session.ts` (campos `gameView`, `gameAspect`, `gameCamera`, `cameraPreview`)
- Modify: `src/editor/workspace_views.ts` (seletores de proporção e câmera; aba grava `S.gameView`; `cameraEscolhida()`; `camera()` só do editor)
- Modify: `src/editor/inspector.ts` (`abrirJanela`; extrair `componentsSection(object, rowY, editavel)` das linhas 530-583; modo janela no `render`)
- Modify: `src/editor/ui_config.ts` (`UI_MENU_NAMES`/`UI_MENU_BUTTON_W` com "Janela"; `UI_WINDOW`; `UI_GAME_VIEW`; `UI_CAMERA_PREVIEW`; `UI_C.previewBorder`; `UI_INSPECTOR.windowPrefix`)
- Modify: `main.ts` (render 861-892; `menuEntries` com Janela e os índices 4 → 5 e 5 → 6 do ramo `activeMenu`; `host.janela`; `workspaceViews.game = S.gameView !== 0` no começo do frame; moldura da prévia)
- Modify: `dispatch.ts`, `builtin_commands.ts`, `query.ts`, `doc.ts` (comando `gameview`)
- Test: `tests/test_game_view.ts`, `tests/test_pacote_ambiente.ts`

**Interfaces:**
- Consumes: `VistasDeCamera`, `coletarCameras`, `aplicarVistas`, `frustumDasVistas`, `posicaoDaVista` (Task 4); `setViewportBuf`, `setFundoCeu` (Task 3); `InspectorUI`, `menuDoCatalogo`, `MENU_JANELA` (Task 8); `Editor.inspect` (Task 6); `Ambiente`, `MODOS_CEU`, `MODOS_LUZ_AMBIENTE` (Task 5).
- Produces:
  - `areaComFaixas(area: Float64Array, razao: number, out: Float64Array): void` (letterbox; razão 0 = livre)
  - `WorkspaceViews.cameraEscolhida(): Camera | null`, `WorkspaceViews.proximaCamera(): void`
  - `Inspector.abrirJanela(b: Behavior, titulo: string): void`, `Inspector.janela: GameObject | null`, `Inspector.componentsSection(object: GameObject, rowY: number, editavel: boolean): number`
  - `cmdGameView(parts: string[]): string` — `gameview`, `gameview jogo|cena`, `gameview proporcao livre|16:9|4:3`, `gameview camera todas|<obj>`, `gameview previa on|off`
  - `CicloDoDia` (componente), `cicloSol(hora: number, out: Float64Array /* pitch, yaw, fator de dia */): void`, `avancarHora(hora, dt, duracao): number`, `corDoCeu(a: Ambiente, fator: number): void`, `ELEVACAO_MAX`
  - `AmbienteInspector` (`@componentIgnore`), `Janela/Ambiente`; WS `ambiente set <campo> <valores>`, `ambiente ceu <modo> [textura]` (muta) e `ambienteinfo` (consulta)

- [ ] **Step 1: Write the failing test**

`tests/test_game_view.ts`:

```ts
// Teste SEM JANELA da aba Jogo: faixas (letterbox) por proporção, comando
// gameview e a escolha de câmera.
//   rts.exe run tests/test_game_view.ts
import io from "@compat/io.ts";
import { areaComFaixas } from "@editor/game_view";
import { cmdGameView } from "@editor/control/commands/gameview";
import { WorkspaceViews } from "@editor/workspace_views";
import { scene, S } from "@editor/control/session";
import { Camera } from "@engine/core/camera";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: number, b: number): boolean { return Math.abs(a - b) < 1e-9; }
const area = new Float64Array(4); const out = new Float64Array(4);
area[0] = 250.0; area[1] = 97.0; area[2] = 660.0; area[3] = 400.0;
areaComFaixas(area, 16.0 / 9.0, out);
check(perto(out[0], 250.0) && perto(out[1], 111.375) && perto(out[2], 660.0) && perto(out[3], 371.25), "16:9 numa área larga de menos: faixas em cima e embaixo");
area[0] = 0.0; area[1] = 0.0; area[2] = 1000.0; area[3] = 500.0;
areaComFaixas(area, 4.0 / 3.0, out);
check(perto(out[0], 166.66666666666666) && perto(out[2], 666.6666666666666) && perto(out[3], 500.0), "4:3 numa área larga: faixas dos lados");
areaComFaixas(area, 0.0, out);
check(perto(out[2], 1000.0) && perto(out[3], 500.0), "Livre = a área toda");

scene.clear();
const a = scene.createGameObject("A"); a.addBehavior(new Camera());
const b = scene.createGameObject("B"); const cb = new Camera(); cb.isMain = 0; cb.profundidade = 1.0; b.addBehavior(cb);
check(cmdGameView(["gameview", "jogo"]).indexOf("[ok]") === 0 && S.gameView === 1, "gameview jogo");
check(cmdGameView(["gameview", "proporcao", "16:9"]).indexOf("[ok]") === 0 && S.gameAspect === 1, "proporção");
check(cmdGameView(["gameview", "proporcao", "21:9"]).indexOf("[erro]") === 0, "proporção inválida");
check(cmdGameView(["gameview", "camera", "1"]).indexOf("[ok]") === 0 && S.gameCamera === 1, "câmera escolhida");
check(cmdGameView(["gameview", "camera", "5"]).indexOf("[erro]") === 0, "objeto sem câmera");
check(cmdGameView(["gameview", "previa", "on"]).indexOf("[ok]") === 0 && S.cameraPreview === 1, "prévia");
check(cmdGameView(["gameview"]).indexOf("aba=jogo proporcao=16:9 camera=#1 previa=on") > 0, "consulta: " + cmdGameView(["gameview"]));
const views = new WorkspaceViews({ _win: 0 });
check(views.cameraEscolhida() === cb, "cameraEscolhida resolve o índice");
views.proximaCamera();
check(S.gameCamera === 0 - 1 && views.cameraEscolhida() === null, "depois da última: Todas");
views.proximaCamera();
check(S.gameCamera === 0, "Todas → a primeira por profundidade");
cmdGameView(["gameview", "camera", "todas"]); cmdGameView(["gameview", "cena"]); cmdGameView(["gameview", "previa", "off"]);
check(S.gameCamera === 0 - 1 && S.gameView === 0 && S.cameraPreview === 0, "volta ao padrão");
io.print("[PASSOU] game view: faixas, gameview, escolha de câmera");
```

`tests/test_pacote_ambiente.ts`:

```ts
// Teste SEM JANELA do pacote ambiente/: CicloDoDia (sol e cores), comandos
// `ambiente`/`ambienteinfo` e Janela/Ambiente no Inspector (dropdown do céu
// com Desfazer; trocar a seleção fecha a janela).
//   rts.exe run tests/test_pacote_ambiente.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { cicloSol, avancarHora, CicloDoDia, ELEVACAO_MAX, DIA_TOPO, NOITE_TOPO } from "../assets/pacotes/ambiente/ciclo_do_dia";
import { Light, criarLuzDirecionalPadrao } from "@engine/core/light";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { Inspector } from "@editor/inspector";
import { EditorControl } from "@editor/ui_controls";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import type { Behavior } from "@engine/core/behavior";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const sol = new Float64Array(3);
cicloSol(12.0, sol); check(Math.abs(sol[0] + ELEVACAO_MAX) < 1e-12 && sol[2] === 1.0, "meio-dia: sol no alto, dia pleno");
cicloSol(6.0, sol); check(Math.abs(sol[0]) < 1e-12, "6h: sol no horizonte");
cicloSol(0.0, sol); check(Math.abs(sol[0] - ELEVACAO_MAX) < 1e-12 && sol[2] === 0.0, "meia-noite: sol abaixo, noite");
check(Math.abs(avancarHora(23.5, 1.0, 24.0) - 0.5) < 1e-12, "a hora dá a volta em 24");
// CicloDoDia gira a luz do sol e pinta o céu
scene.clear(); scene.ambiente.ceu.modo = "procedural";
const luz = criarLuzDirecionalPadrao(scene);
const relogio = scene.createGameObject("Relógio"); const ciclo = new CicloDoDia(); ciclo.duracao = 24.0; ciclo.hora = 11.0; relogio.addBehavior(ciclo);
const ry0 = luz.transform.ry;
ciclo.update(1.0);
check(ciclo.hora === 12.0 && Math.abs(luz.transform.rx + ELEVACAO_MAX) < 1e-12, "1 s = 1 h; ao meio-dia o sol está no alto");
check(Math.abs(luz.transform.ry - 12.0 / 24.0 * 2.0 * Math.PI) < 1e-12 && luz.transform.ry !== ry0, "o sol gira no azimute");
check(Math.abs(scene.ambiente.ceu.topo[0] - DIA_TOPO[0]) < 1e-12 && Math.abs(scene.ambiente.ceu.topo[2] - DIA_TOPO[2]) < 1e-12, "topo do céu de dia");
ciclo.hora = 23.0; ciclo.update(1.0);
check(scene.ambiente.ceu.topo[0] === NOITE_TOPO[0], "topo do céu à meia-noite");

// comandos
instalarEditorReal(); history.u = []; history.r = [];
check(execCommand(800, 600, "ambiente set ceu.topo 0.1 0.2 0.3").indexOf("[ok]") === 0 && scene.ambiente.ceu.topo[1] === 0.2 && history.undoDepth() === 1, "set ceu.topo com Desfazer");
check(execCommand(800, 600, "ambiente set neblina.densidade 0.04").indexOf("[ok]") === 0 && scene.ambiente.neblina.densidade === 0.04, "neblina");
check(execCommand(800, 600, "ambiente set neblina.densidade -1").indexOf("[erro]") === 0, "densidade negativa");
check(execCommand(800, 600, "ambiente set sol Luz Direcional").indexOf("[ok]") === 0 && scene.ambiente.sol === "Luz Direcional", "sol com espaço no nome");
check(execCommand(800, 600, "ambiente ceu nublado").indexOf("[erro]") === 0, "modo inválido");
check(execCommand(800, 600, "ambiente ceu panorama assets/nao/existe.png").indexOf("[erro]") === 0, "textura inexistente");
check(execCommand(800, 600, "ambiente ceu panorama assets/editor/icons/info.png").indexOf("[ok]") === 0 && scene.ambiente.ceu.modo === "panorama" && scene.ambiente.ceu.textura === "assets/editor/icons/info.png", "panorama com textura");
const d = history.undoDepth();
check(execCommand(800, 600, "ambienteinfo").indexOf("\"panorama\"") > 0 && history.undoDepth() === d, "ambienteinfo é consulta");

// Janela/Ambiente no Inspector
class TestApp {
  _win: number = 0; focus: number = -1; clickId: number = -1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  textField(id: number, x: number, y: number, width: number, value: string, enabled: boolean): string { return value; }
  clickable(id: number, x: number, y: number, width: number, height: number): number { return id === this.clickId ? 3 : 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}
const app = new TestApp();
const inspector = new Inspector(app);
const host = instalarEditorReal();
host.janela = (b: Behavior, titulo: string) => { inspector.abrirJanela(b, titulo); };
function render(): void { inspector.render(app, 0, 0, 290, 4000, -1, -1, 0, 0, false, 0, 0); }
S.selected = 0; S.selection = [0];
check(executarItemDeMenu(indiceDoCaminho("Janela/Ambiente"), 0 - 1) === "", "Janela/Ambiente");
check(history.undoDepth() === d, "abrir a janela não entra no Desfazer");
render();
check(inspector.janela !== null, "o Inspector mostra a janela do Ambiente");
let ceu: EditorControl | null = null;
let i = 0;
while (i < inspector.ui.controls.length) { if (inspector.ui.controls[i].label.indexOf("Céu: ") === 0) ceu = inspector.ui.controls[i]; i = i + 1; }
check(ceu !== null && (ceu as EditorControl).label === "Céu: panorama", "dropdown do céu");
app.clickId = (ceu as EditorControl).id; render(); app.clickId = -1; render();
check(scene.ambiente.ceu.modo === "estrelas" && history.undoDepth() === d + 1, "o dropdown alterna o modo, com Desfazer");
S.selected = 1; S.selection = [1]; render();
check(inspector.janela === null, "trocar a seleção fecha a janela");
io.print("[PASSOU] pacote ambiente: ciclo do dia, comandos, consulta, janela no Inspector");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$RTS run tests/test_game_view.ts ; $RTS run tests/test_pacote_ambiente.ts`
Expected: FAIL — `cannot resolve module "@editor/game_view"`; `cannot resolve module "../assets/pacotes/ambiente/ciclo_do_dia"`.

- [ ] **Step 3: Implementation**

`game_view.ts`:

```ts
// A aba Jogo desenha as câmeras dentro da área da vista, com faixas quando a
// proporção pedida não bate com a da área (letterbox/pillarbox).
/// area/out = [x, y, w, h] em pixels; razao = largura/altura (0 = livre).
export function areaComFaixas(area: Float64Array, razao: number, out: Float64Array): void {
  out[0] = area[0]; out[1] = area[1]; out[2] = area[2]; out[3] = area[3];
  if (razao > 0.0 && area[2] > 0.0 && area[3] > 0.0) {
    if (area[2] / area[3] > razao) { out[2] = area[3] * razao; out[0] = area[0] + (area[2] - out[2]) * 0.5; }
    else { out[3] = area[2] / razao; out[1] = area[1] + (area[3] - out[3]) * 0.5; }
  }
}
```

`ui_config.ts`:
- `UI_MENU_NAMES = ["Arquivo", "Editar", "Criar", "Janela", "Configurações", "Ajuda"]`; `UI_MENU_BUTTON_W = [66, 56, 54, 62, 120, 52]`.
- Os objetos:

```ts
export const UI_WINDOW = { previewOn: "Pré-visualização da câmera: ligada", previewOff: "Pré-visualização da câmera: desligada" };
export const UI_GAME_VIEW = {
  aspectLabels: ["Livre", "16:9", "4:3"], aspectTokens: ["livre", "16:9", "4:3"], aspectRatios: [0.0, 16.0 / 9.0, 4.0 / 3.0],
  aspectPrefix: "Proporção: ", cameraPrefix: "Câmera: ", cameraAll: "Todas", aspectW: 130, cameraW: 170,
};
export const UI_CAMERA_PREVIEW = { w: 256, h: 144, margin: 10, border: 1, titlePrefix: "Câmera: ", titleY: 4 };
```

- `UI_C.previewBorder: 0x6A9DD2FF`; `UI_INSPECTOR.windowPrefix: "Janela: "`.

`session.ts`: campos `gameView: number` (0), `gameAspect: number` (0), `gameCamera: number` (-1), `cameraPreview: number` (0), atribuídos no construtor.

`workspace_views.ts`:
- `camera(defaultFov)` fica só com a câmera do editor (sai o ramo `this.game`). `hasCamera` passa a ser escrito pelo `main.ts`.
- `tabs(...)`:
  - o clique na aba grava `S.gameView = i === 1 ? 1 : 0` e `this.game`;
  - com `this.game`, desenha à direita das abas dois botões, `"View/Aspect"` e `"View/Camera"` (x = `x + L.padding + L.tabs.length * (L.tabW + L.gap) + L.gap`, larguras `UI_GAME_VIEW.aspectW`/`cameraW`, altura `L.tabH`);
  - os rótulos são `aspectPrefix + aspectLabels[S.gameAspect]` e `cameraPrefix + (nome do objeto | cameraAll)`;
  - o clique no primeiro faz `S.gameAspect = (S.gameAspect + 1) % aspectLabels.length`; o clique no segundo chama `proximaCamera()`.
- Os métodos novos:

```ts
  cameraEscolhida(): Camera | null {
    let c: Camera | null = null;
    const i = S.gameCamera;
    if (i >= 0 && i < scene.objects.length && scene.objects[i].camIdx >= 0) c = scene.objects[i].behaviors[scene.objects[i].camIdx] as Camera;
    else S.gameCamera = 0 - 1;
    return c;
  }
  /// Todas → 1ª câmera (por profundidade) → … → última → Todas.
  proximaCamera(): void {
    const lista = Camera.all();
    const atual = this.cameraEscolhida();
    let k = atual === null ? 0 - 1 : lista.indexOf(atual);
    k = k + 1;
    S.gameCamera = k < lista.length ? scene.objects.indexOf(lista[k].owner as GameObject) : 0 - 1;
  }
```

`commands/gameview.ts`:

```ts
// gameview — a aba Jogo pela porta de controle (estado do editor, sem Desfazer).
import { scene, S } from "../session";
import { UI_GAME_VIEW as G } from "../../ui_config";
export function cmdGameView(parts: string[]): string {
  const acao = parts.length > 1 ? parts[1] : "";
  let out = "";
  if (acao === "") {
    out = "[gameview] aba=" + (S.gameView !== 0 ? "jogo" : "cena") + " proporcao=" + G.aspectTokens[S.gameAspect] +
      " camera=" + (S.gameCamera >= 0 ? "#" + S.gameCamera : "todas") + " previa=" + (S.cameraPreview !== 0 ? "on" : "off");
  } else if (acao === "jogo" || acao === "cena") { S.gameView = acao === "jogo" ? 1 : 0; out = "[ok] aba " + acao; }
  else if (acao === "proporcao") {
    const k = G.aspectTokens.indexOf(parts.length > 2 ? parts[2] : "");
    if (k < 0) out = "[erro] proporcao: use " + G.aspectTokens.join(", ");
    else { S.gameAspect = k; out = "[ok] proporcao " + G.aspectTokens[k]; }
  } else if (acao === "camera") {
    const alvo = parts.length > 2 ? parts[2] : "";
    const i = parseFloat(alvo);
    if (alvo === "todas") { S.gameCamera = 0 - 1; out = "[ok] camera todas"; }
    else if (i === i && i >= 0 && i < scene.objects.length && scene.objects[i].camIdx >= 0) { S.gameCamera = i; out = "[ok] camera #" + i; }
    else out = "[erro] camera: use todas ou o índice de um objeto com Camera";
  } else if (acao === "previa") {
    if (parts[2] === "on" || parts[2] === "off") { S.cameraPreview = parts[2] === "on" ? 1 : 0; out = "[ok] previa " + parts[2]; }
    else out = "[erro] previa: use on ou off";
  } else out = "[erro] uso: gameview [jogo|cena|proporcao <p>|camera <todas|obj>|previa <on|off>]";
  return out;
}
```

Em `dispatch.ts`, `case "gameview": return cmdGameView(parts);` (não muta a cena). Acrescentar `"gameview"` a `BUILTIN_COMMANDS`, ao `help` e ao `doc` (`"gameview [jogo|cena|proporcao livre|16:9|4:3|camera todas|<obj>|previa on|off] :: aba Jogo: várias câmeras, proporção com faixas, câmera única e prévia na vista de Cena :: gameview proporcao 16:9"`).

`inspector.ts`:
- Campos `janela: GameObject | null = null; janelaSel: number = 0 - 1; janelaTitulo: string = "";`.
- `componentsSection(object, rowY, editavel)` recebe o laço atual das linhas 530-583 (cabeçalho, remover, ligado, GUI/campos e a remoção pendente). Com `editavel = false`, não desenha o botão "x" nem o toggle "Ativo".
- O método novo:

```ts
  abrirJanela(b: Behavior, titulo: string): void {
    const nome = this.ui.root.name + "/Janela/" + titulo;
    let go: GameObject | null = null;
    let i = 0;
    while (i < this.ui.scene.objects.length && go === null) { if (this.ui.scene.objects[i].name === nome) go = this.ui.scene.objects[i]; i = i + 1; }
    if (go === null) go = this.ui.scene.createGameObject(nome, 0);
    if (b.owner !== go) go.addBehavior(b);
    this.janela = go; this.janelaTitulo = titulo; this.janelaSel = S.selected; this.scroll = 0;
  }
```

- Em `render`, logo depois do bloco de troca de seleção: `if (this.janela !== null && S.selected !== this.janelaSel) this.janela = null;`.
- Depois do título e ANTES do `if (selected === null) { … return; }` (a janela abre também sem objeto selecionado): se `this.janela !== null`, desenhar o nome `L.windowPrefix + this.janelaTitulo` no lugar do campo de nome, calcular `rowY = this.componentsSection(this.janela, this.top - this.scroll, false)` com a mesma rolagem, pular o rodapé "Adicionar componente", `this.ui.end()` e `return`.
- O objeto da janela vive na UIScene do Inspector (oculto, nunca vai para a cena editada).

`main.ts`:
- `const host = instalarEditorReal();` (a linha da Task 6) + `host.janela = (b: Behavior, titulo: string) => { inspector.abrirJanela(b, titulo); };`.
- No começo de `frame()`: `workspaceViews.game = S.gameView !== 0;`.
- `const menuJanela = menuDoCatalogo(MENU_JANELA, [UI_WINDOW.previewOff]);`. Em `menuEntries`, antes de devolver `menuJanela.rotulos`, faz `menuJanela.rotulos[0] = S.cameraPreview !== 0 ? UI_WINDOW.previewOn : UI_WINDOW.previewOff;` (constantes: sem alocação).
- Os números de menu passam a ser 1 Arquivo, 2 Editar, 3 Criar, 4 Janela, 5 Configurações, 6 Ajuda; atualizar `menuEntries` e o despacho (`activeMenu === 4` → Janela: `chosen === 0` alterna `S.cameraPreview`, e o resto chama `executarItemDeMenu(menuJanela.itens[chosen - menuJanela.fixos], 0 - 1)`; Configurações `=== 5`; Ajuda `=== 6`).
- No topo: `const vistasJogo = new VistasDeCamera(); const vistasPrevia = new VistasDeCamera(); const areaCena = new Float64Array(4); const VISTA_CHEIA = new Float64Array(5);` e, logo depois, `VISTA_CHEIA[2] = 1.0; VISTA_CHEIA[3] = 1.0; VISTA_CHEIA[4] = 1.0;`.
- O bloco de render (linhas 861-892, que já recebeu as Tasks 3-5) passa a:

```ts
  const cenaX = HIER_W; const cenaY = BAR_H + UI_SCENE_HEADER_H;
  const cenaW = W - HIER_W - INSP_W; const cenaH = H - UI_STATUS_H - ASSET_H - cenaY;
  let nJogo = 0; let nPrevia = 0;
  if (workspaceViews.game) {
    areaCena[0] = cenaX; areaCena[1] = cenaY; areaCena[2] = cenaW; areaCena[3] = cenaH;
    areaComFaixas(areaCena, UI_GAME_VIEW.aspectRatios[S.gameAspect], vistasJogo.area);
    vistasJogo.tela[0] = W; vistasJogo.tela[1] = H;
    nJogo = coletarCameras(vistasJogo, scene, workspaceViews.cameraEscolhida());
    if (nJogo > 0) { aplicarVistas(WIN, vistasJogo); posicaoDaVista(vistasJogo, luzCam); frustumDasVistas(vistasJogo, fParams); }
  }
  workspaceViews.hasCamera = nJogo > 0;
  if (nJogo === 0) {
    workspaceViews.camera(FOV);
    setViewportBuf(WIN, VISTA_CHEIA); setFundoCeu(WIN);
    setCam(WIN, workspaceViews.x, workspaceViews.y, workspaceViews.z, workspaceViews.yaw, workspaceViews.pitch, workspaceViews.fov, W / H);
    luzCam[0] = workspaceViews.x; luzCam[1] = workspaceViews.y; luzCam[2] = workspaceViews.z;
    const sel = S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null;
    if (!workspaceViews.game && S.cameraPreview !== 0 && sel !== null && sel.camIdx >= 0) {
      vistasPrevia.area[0] = cenaX + cenaW - UI_CAMERA_PREVIEW.w - UI_CAMERA_PREVIEW.margin;
      vistasPrevia.area[1] = cenaY + cenaH - UI_CAMERA_PREVIEW.h - UI_CAMERA_PREVIEW.margin;
      vistasPrevia.area[2] = UI_CAMERA_PREVIEW.w; vistasPrevia.area[3] = UI_CAMERA_PREVIEW.h;
      vistasPrevia.tela[0] = W; vistasPrevia.tela[1] = H;
      nPrevia = coletarCameras(vistasPrevia, scene, sel.behaviors[sel.camIdx] as Camera);
      aplicarVistas(WIN, vistasPrevia);
    }
    frustumBegin(workspaceViews.x, workspaceViews.y, workspaceViews.z, workspaceViews.yaw, workspaceViews.pitch, workspaceViews.fov, W / H);
    frustumParams(fParams);
    if (nPrevia > 0) { fParams[7] = 0.0 - 1.0; fParams[8] = 0.0 - 1.0; }
  }
```

  seguido de `aplicarLuzes`/`aplicarAmbiente` (Tasks 3/5) e do `drawSceneObjects` de sempre (a contagem continua `workspaceViews.game && !workspaceViews.hasCamera ? 0 : objs.length`).
- Com `nPrevia > 0`, depois do passe de gizmos: `app.box(area − border, …, 0, UI_CAMERA_PREVIEW.border, UI_C.previewBorder, 0)`, a moldura só de contorno, e `app.text(area.x + L.padding, area.y + UI_CAMERA_PREVIEW.titleY, UI_CAMERA_PREVIEW.titlePrefix + sel.name, UI_C.primaryText, 12)`.
- A linha 1262 continua a mesma (o `hasCamera` agora vem do `nJogo`).

`ciclo_do_dia.ts`:

```ts
// Pacote ambiente: CicloDoDia gira a luz do sol (elevação e azimute) e
// interpola as cores do céu entre noite e dia. Roda no jogo.
import math from "@compat/math.ts";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { LUZ_DIRECIONAL } from "@engine/core/light";
import { Ambiente } from "@engine/core/ambiente";
import { activeScene } from "@engine/core/active_scene";

export const ELEVACAO_MAX: number = 1.3962634015954636;   // 80°
export const HORAS_DIA: number = 24.0;
const HORA_NASCENTE: number = 6.0;
const MEIO_DIA_EM_HORAS: number = 12.0;
const DOIS_PI: number = 6.283185307179586;
export const DIA_TOPO: number[] = [0.25, 0.45, 0.80];
export const DIA_HORIZONTE: number[] = [0.70, 0.80, 0.90];
export const NOITE_TOPO: number[] = [0.01, 0.015, 0.05];
export const NOITE_HORIZONTE: number[] = [0.05, 0.05, 0.10];

export function avancarHora(hora: number, dt: number, duracao: number): number {
  const h = hora + dt * HORAS_DIA / (duracao > 0.001 ? duracao : 0.001);
  return h - Math.floor(h / HORAS_DIA) * HORAS_DIA;
}
/// out = [pitch da luz (negativo = aponta para baixo), azimute, fator de dia 0..1].
export function cicloSol(hora: number, out: Float64Array): void {
  const s = math.sin((hora - HORA_NASCENTE) / MEIO_DIA_EM_HORAS * Math.PI);
  out[0] = 0.0 - s * ELEVACAO_MAX;
  out[1] = hora / HORAS_DIA * DOIS_PI;
  out[2] = Math.max(0.0, Math.min(1.0, s));
}
export function corDoCeu(a: Ambiente, fator: number): void {
  let k = 0;
  while (k < 3) {
    a.ceu.topo[k] = NOITE_TOPO[k] + (DIA_TOPO[k] - NOITE_TOPO[k]) * fator;
    a.ceu.horizonte[k] = NOITE_HORIZONTE[k] + (DIA_HORIZONTE[k] - NOITE_HORIZONTE[k]) * fator;
    k = k + 1;
  }
}
/**
 * @componentCategory Renderização
 * @componentDescription Gira o sol e interpola as cores do céu ao longo do dia.
 * @componentKeywords dia noite sol ciclo ambiente céu
 */
export class CicloDoDia extends Behavior {
  /**
   * Segundos de jogo por dia.
   * @range 1 86400
   */
  duracao: number = 120.0;
  /** @range 0 24 */
  hora: number = 8.0;
  /** Nome do objeto com a Light direcional; vazio = o "sol" do Ambiente ou a primeira direcional. */
  sol: string = "";
  private pose: Float64Array = new Float64Array(3);
  update(dt: f64): void {
    this.hora = avancarHora(this.hora, dt, this.duracao);
    cicloSol(this.hora, this.pose);
    const sc = activeScene();
    if (sc === null) return;
    const nome = this.sol.length > 0 ? this.sol : sc.ambiente.sol;
    let alvo: GameObject | null = null;
    let i = 0;
    while (i < sc.lightObjs.length && alvo === null) {
      const o = sc.lightObjs[i];
      if (o.behaviors[o.lightIdx].lightType() === LUZ_DIRECIONAL && (nome.length === 0 || o.name === nome)) alvo = o;
      i = i + 1;
    }
    if (alvo !== null) { alvo.transform.rx = this.pose[0]; alvo.transform.ry = this.pose[1]; }
    corDoCeu(sc.ambiente, this.pose[2]);
  }
}
```

(O teste chama `setActiveScene(scene)` implicitamente pela `session.ts`, Task 4.)

`ambiente_editor.ts` (`/** @editorOnly */`):
- **`AmbienteInspector`** (`@componentIgnore`): o construtor atribui `this.aberto = true` e o `onInspectorGUI` edita `Editor.scene().ambiente`:
  - `label("Céu")`; `dropdown("Céu", MODOS_CEU, …)`;
  - `color` para topo, horizonte e chão, convertendo `Float64Array` rgb 0..1 ↔ 0xRRGGBB com a função `corCampo(ui, rotulo, v)`;
  - `slider("Exposição", …, 0, 4)` e `slider("Estrelas", …, 0, 2)`;
  - no modo panorama, `label("Textura: " + (textura || "(nenhuma)"))`;
  - `label("Neblina")`, `color("Cor da neblina")`, `slider("Densidade", …, 0, 0.2)`;
  - `label("Luz ambiente")`, `dropdown("Modo", MODOS_LUZ_AMBIENTE, …)`, `color("Cor ambiente")`, `slider("Intensidade", …, 0, 2)`.
  - Rótulos e limites são constantes do arquivo do pacote.
- **`JanelaAmbiente`**: `/** @menuItem Janela/Ambiente */ static abrir(): void { Editor.inspect(janelaAmbiente(), "Ambiente"); }`, com a instância criada sob demanda por `function janelaAmbiente(): AmbienteInspector` (nunca no topo do módulo).
- **Comando `ambiente`** (`muta = true`):
  - `set <campo> <valores>` com os campos `ceu.modo`, `ceu.topo|horizonte|chao r g b`, `ceu.estrelas`, `ceu.exposicao`, `ceu.tamanhoSol`, `neblina.cor r g b`, `neblina.densidade`, `luz.modo`, `luz.cor r g b`, `luz.intensidade` e `sol <nome com espaços>` (resto da linha). Valida com as MESMAS regras do JSON da cena:
    1. `const dados = ambienteToData(sc.ambiente)`, com o estado atual inteiro;
    2. troca só o campo pedido nesse objeto simples (ex.: `dados.ceu.topo = [r, g, b]`, `dados.sol = partes.slice(3).join(" ")`; `luz.*` vai em `dados.luzAmbiente`);
    3. chama `ambienteFromData(sc.ambiente, dados)`, que só copia se tudo for válido; os outros campos são preservados porque vêm no próprio `dados`;
    4. a mensagem de erro dela vira `[erro] …`.
  - `ceu <modo> [textura]`: o modo em `MODOS_CEU`; a textura precisa existir (`fs.exists`).
- **Comando `ambienteinfo`** (`muta = false`): `"[ambiente] " + JSON.stringify(ambienteToData(scene.ambiente))`.

`npm run components`: `CicloDoDia` entra no catálogo (`src/engine/generated/components*.ts`). O `AmbienteInspector` fica fora (`@componentIgnore`), e `editor_extensions.ts` importa `ambiente_editor.ts` e lista `Janela/Ambiente`.

- [ ] **Step 4: Run tests**

Run:
```
npm run components && npm run test:components && npm run components:check && npm run check:params
node --test tests/editor-static.test.mjs
$RTS run tests/test_game_view.ts
$RTS run tests/test_pacote_ambiente.ts
$RTS run tests/test_editor_ui.ts
$RTS run tests/test_workspace_console.ts
$RTS run tests/test_inspector_gui.ts
```
Expected: tudo verde; `[PASSOU] game view: ...` e `[PASSOU] pacote ambiente: ...`.

- [ ] **Step 5: Commit**

`git add -A && git commit -m "feat(editor): aba Jogo com várias câmeras, proporção e câmera única; prévia da câmera; pacote ambiente (janela, ciclo do dia, comandos)"`

---

### Task 11: Verificação com janela, medição de custo e documentação

**Files:**
- Create: `tests/claude-test-luzes-gc.ts`
- Create: `tools/claude-verificar-luzes.sh` (sequência de comandos WS + capturas desta task)
- Modify: `docs/components.md` (seção "Estender o editor por script": `@editor/api`, `registerCommand`, ganchos, `onDrawGizmos`, `registerGizmo`, `@menuItem`, `onInspectorGUI`, `@editorOnly`, `assets/pacotes/`)
- Modify: `docs/editor-workspace.md` (aba Jogo: várias câmeras, proporção, câmera única; pré-visualização; menu Janela; Janela/Ambiente; comando `gameview`)

**Interfaces:**
- Consumes: tudo o que as Tasks 1-10 produzem.
- Produces: fases de GC `luzes`, `ambiente`, `camera`, `gizmos` e `controles`, com a mesma contagem de coletas em 1.000 e 10.000 frames; seis capturas de janela; a medição de custo registrada no commit.

- [ ] **Step 1: Write the failing test**

`tests/claude-test-luzes-gc.ts`:

```ts
// Teste de ALOCAÇÃO por frame de luzes, ambiente, câmeras, gizmos e controles.
// Rodar com RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores
// "FASE" (as de antes do primeiro marcador são do setup). Portão: 1.000 e
// 10.000 frames dão a MESMA contagem por fase.
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-luzes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-luzes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import "@engine/generated/editor_extensions";
import { scene, S } from "@editor/control/session";
import { Light } from "@engine/core/light";
import { Camera } from "@engine/core/camera";
import { aplicarLuzes, aplicarAmbiente } from "@engine/render/scene_lighting";
import { VistasDeCamera, coletarCameras, aplicarVistas, frustumDasVistas } from "@engine/render/camera_views";
import { gizmosBegin } from "@engine/core/gizmos";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { CameraOrbita } from "../assets/pacotes/camera/camera_orbita";
import { CameraSeguir } from "../assets/pacotes/camera/camera_seguir";
import { CameraRTS } from "../assets/pacotes/camera/camera_rts";
import { CicloDoDia } from "../assets/pacotes/ambiente/ciclo_do_dia";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));
const DT: f64 = 1.0 / 60.0;
scene.clear();
const tipos: string[] = ["pontual", "pontual", "pontual", "pontual", "pontual", "pontual", "pontual", "pontual", "spot", "spot", "direcional", "direcional"];
let k = 0;
while (k < tipos.length) {
  const o = scene.createGameObject("L" + k); o.transform.setPosition(k * 2.0, 3.0, 0.0);
  const l = new Light(); l.tipo = tipos[k]; l.sombra = k === 10; o.addBehavior(l); k = k + 1;
}
const alvo = scene.createGameObject("Alvo");
const c1 = scene.createGameObject("C1"); c1.addBehavior(new Camera()); const orb = new CameraOrbita(); orb.alvo = "Alvo"; c1.addBehavior(orb);
const c2 = scene.createGameObject("C2"); const cam2 = new Camera(); cam2.viewportX = 0.5; cam2.viewportW = 0.5; cam2.isMain = 0; c2.addBehavior(cam2);
const seg = new CameraSeguir(); seg.alvo = "Alvo"; c2.addBehavior(seg);
const c3 = scene.createGameObject("C3"); const cam3 = new Camera(); cam3.isMain = 0; cam3.profundidade = 1.0; cam3.ortografica = true; c3.addBehavior(cam3); c3.addBehavior(new CameraRTS());
const rel = scene.createGameObject("Relogio"); const ciclo = new CicloDoDia(); ciclo.duracao = 10.0; rel.addBehavior(ciclo);
scene.ambiente.ceu.modo = "procedural";
scene.computeWorld();
const cam = new Float64Array(3); const legado = new Float64Array(4); legado[1] = 10.0; legado[3] = 0.25;
const vistas = new VistasDeCamera(); vistas.area[2] = 1280.0; vistas.area[3] = 720.0; vistas.tela[0] = 1280.0; vistas.tela[1] = 720.0;
const fp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const raio = new Float64Array(6); const tela = new Float64Array(3);
const pose = new Float64Array(8); pose[2] = 0 - 20.0; pose[5] = 1.0; pose[6] = 1280.0; pose[7] = 720.0;
// aquece tudo fora das fases
aplicarLuzes(0, scene, cam, legado); aplicarAmbiente(0, scene); coletarCameras(vistas, scene, null);
gizmosBegin(gizmosDoEditor, pose); coletarGizmos(gizmosDoEditor, scene, 0);

io.print("FASE luzes " + n);
let f = 0;
while (f < n) { cam[0] = (f % 40) * 0.5; aplicarLuzes(0, scene, cam, legado); f = f + 1; }
io.print("FASE ambiente " + n);
f = 0;
while (f < n) { scene.ambiente.ceu.topo[0] = (f % 100) * 0.01; aplicarAmbiente(0, scene); f = f + 1; }
io.print("FASE camera " + n);
f = 0;
while (f < n) {
  coletarCameras(vistas, scene, null); aplicarVistas(0, vistas); frustumDasVistas(vistas, fp);
  cam2.screenPointToRay((f % 640) + 640.0, 360.0, raio); cam2.worldToScreenPoint(1.0, 2.0, 10.0, tela); cam3.viewportPointToRay(0.25, 0.75, raio);
  f = f + 1;
}
io.print("FASE gizmos " + n);
f = 0;
while (f < n) { gizmosBegin(gizmosDoEditor, pose); coletarGizmos(gizmosDoEditor, scene, f % tipos.length); f = f + 1; }
io.print("FASE controles " + n);
f = 0;
while (f < n) { scene.update(DT); scene.computeWorld(); f = f + 1; }
io.print("FASE fim");
```

`tools/claude-verificar-luzes.sh`:
- Script bash com o editor já aberto (`ui_fixture.exe main.ts`).
- Cada cenário é um `python tools/ws_client.py ...` seguido de `powershell -File .superpowers/sdd/2026-09-25-ossos-e-animacao/captura.ps1 -Saida build/claude-luzes/<n>.png -Titulo "Engine RTS"`, com `sleep 1` entre comandos e captura.
- Os seis cenários:
  1. **Céu procedural com sol**: `loadscene scenes/shadowdemo.json`, `menu Criar/Luz/Direcional`, `ambiente ceu procedural`, `gameview cena`.
  2. **3 luzes pontuais coloridas**: `luz add pontual -3 2 0` / `luz add pontual 0 2 0` / `luz add pontual 3 2 0`, `luz <i> set cor #ff4040|#40ff40|#4040ff`, `luz <i> set alcance 6`, `ambiente set luz.intensidade 0.08`.
  3. **Spot**: `luz add spot 0 6 0`, `luz <i> set angulo 40`, `luz <i> set alcance 12`.
  4. **Neblina**: `ambiente set neblina.densidade 0.06`.
  5. **Frustum e ícones selecionáveis**: `camera add`, `select <i>`, captura; `gizmoat <sx> <sy>` no pixel do ícone de uma luz (tirado do `ic` via `luzes` + `groundat`, ou pelo centro calculado pela câmera); `state` confirma `sel=<luz>`; captura.
  6. **Tela dividida com 2 câmeras**: `camera add` ×2, `camera <a> set viewport 0 0 0.5 1`, `camera <b> set viewport 0.5 0 0.5 1`, `gameview jogo`, captura; `gameview proporcao 4:3`, captura (faixas); `gameview cena`, `select <a>`, `gameview previa on`, captura (prévia no canto).

- [ ] **Step 2: Run it to verify it fails**

Run:
```
RTS_GC_DEBUG=1 GC_N=1000  $RTS run tests/claude-test-luzes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
RTS_GC_DEBUG=1 GC_N=10000 $RTS run tests/claude-test-luzes-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
```
Expected: as contagens por fase são IGUAIS nas duas execuções. Uma fase que escala (ex.: `camera 3` → `camera 30`) é regressão: achar a alocação (objeto literal por chamada, função com 5+ parâmetros, `new` no laço) e corrigir na task dona antes de seguir. Registrar os números.

- [ ] **Step 3: Implementation**

**Verificação com janela:**
- Compilar (`cargo build --release -p rts-host --example ui_fixture --features ui` no rts), abrir `ui_fixture.exe main.ts` a partir da raiz do worktree do rts-game, esperar o WS (~15 s) e rodar `bash tools/claude-verificar-luzes.sh`.
- Olhar cada PNG em `build/claude-luzes/`:
  1. céu em gradiente com disco do sol na direção da luz;
  2. três manchas coloridas que somem no alcance;
  3. cone de luz com borda suave;
  4. objetos distantes indo à cor da neblina;
  5. ícones de luz/câmera, frustum da câmera selecionada; o `gizmoat` seleciona o dono;
  6. metade esquerda e direita com câmeras diferentes; faixas laterais em 4:3; prévia no canto da vista de Cena com moldura.
- Qualquer diferença volta como correção na task dona.

**Medição de custo (cena sem Light, sem Camera e sem bloco "ambiente"):**
- Base: `git worktree add ../claude-base c14bb4a` (o HEAD antes deste plano). Ramo: o worktree atual.
- Nos dois, com o MESMO `ui_fixture.exe` (o runtime novo, cujo caminho `n = 0` é o legado), rodar `RTS_SCENE=scenes/solar.json ui_fixture.exe main.ts`. Depois, pelo WS: `vsync 0`, `prof on`, esperar 10 s e `prof`.
- Anotar "render 3D", "UI 2D" e o total por frame. Portão: o ramo fica dentro de ±5% da base em "render 3D" e no total. O passe de gizmos custa um laço `gizmoFlag` por objeto; se passar do portão, medir com `prof` e reduzir antes de fechar.
- Remover o worktree de base depois (`git worktree remove ../claude-base`).

**Documentação:**
- `docs/components.md`, nova seção "Estender o editor por script", com um exemplo mínimo de cada ponto:
  - `registerCommand("oi", "oi :: responde", false, p => "olá")`;
  - `Editor.on("salvar", …)`;
  - `onDrawGizmos(g)` com `g.wireSphere`;
  - `registerGizmo("Tipo", fn)`;
  - `/** @menuItem Criar/Meu/Objeto */ static criar()`;
  - `onInspectorGUI(ui)` com `ui.field` e `ui.button`;
  - `/** @editorOnly */` no topo do arquivo, e o build do jogo por `tools/game-build/entry.ts`;
  - a pasta `assets/pacotes/`.
- `docs/editor-workspace.md`: aba Jogo (várias câmeras por profundidade, proporção Livre/16:9/4:3 com faixas, seletor de câmera), pré-visualização (menu Janela, `gameview previa on`), Janela/Ambiente, comando `gameview`.

- [ ] **Step 4: Run tests**

Run (a suíte inteira que este plano toca):
```
npm run components:check && npm run test:components && npm run check:params && npm run icons:check
node --test tests/editor-static.test.mjs
for t in test_light test_camera_api test_ambiente test_editor_api test_gizmos test_menu_items test_inspector_gui test_pacote_luz test_pacote_camera test_game_view test_pacote_ambiente test_scene test_play_mode test_ws_skeleton test_inspector_skeleton test_editor_ui claude-test-sceneio-roundtrip; do $RTS run tests/$t.ts || echo "FALHOU $t"; done
$RTS run tools/game-build/claude-test-registro.ts
cd /c/Users/nexga/Documents/GitHub/rts-uv-mundo && cargo test --release -p rts-egui --lib scene3d
```
Expected: nenhuma linha `FALHOU`; todos os `[PASSOU]`; os 22 testes Rust verdes; GC igual em 1k/10k; custo dentro de ±5%.

- [ ] **Step 5: Commit**

`git add -A && git commit -m "test+docs: GC por frame de luzes/câmeras/gizmos, verificação com janela e documentação da extensão por script"`. Na mensagem, registrar a tabela GC (fase: 1k / 10k) e a medição de custo (base vs ramo).
