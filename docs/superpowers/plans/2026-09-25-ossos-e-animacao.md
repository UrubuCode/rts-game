# Ossos e animação por clipe — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personagens de glTF com hierarquia de nós rígidos animados por clipe (componentes `Skeleton` + `AnimationPlayer`), visíveis e posicionáveis no editor, controláveis pelo WebSocket de IA, e usados no rts-fps.

**Architecture:** O runtime `rts` ganha rotação por quaternion no `drawMesh`. O rts-game lê nós e clipes do `.glb` (`gltf_anim.ts`), guarda a pose por osso em arrays paralelos no componente `Skeleton`, amostra clipes no `AnimationPlayer` e desenha cada peça com o quaternion composto. Editor e WebSocket operam sobre esses dois componentes.

**Tech Stack:** TypeScript compilado pelo RTS (`rts.exe`), Rust (crates `rts-egui`, `rts-ui` do repo `rts`), glTF 2.0 binário.

**Spec:** `docs/superpowers/specs/2026-09-25-ossos-e-animacao-design.md`

## Global Constraints

- Nenhuma função com 5+ parâmetros pode ter valor padrão (`npm run check:params`; rts#2760: ~0,5 µs + alocação por chamada). Use `xArg?: T` resolvido na 1ª linha.
- Sem alocação por frame nos caminhos de animação/desenho: buffers criados uma vez; saídas por `Float64Array` do chamador.
- Imports por alias (`@engine/...`, `@editor/...`, `@compat/...`); sem ciclos de import (use `import type` para tipos).
- Medidas, rótulos e cores de UI nova em `src/editor/ui_config.ts`; controles como GameObjects da `UIScene` (CLAUDE.md).
- Convenção de rotação do renderer: eixo local X → (cos ry, −sin ry); câmera `fwd = (sin yaw·cos p, sin p, cos yaw·cos p)`; quaternion glTF é `[x, y, z, w]`.
- Todo recurso novo tem comando no WebSocket de controle (`src/editor/control/commands/*.ts` + `dispatch.ts`).
- Meta de custo: 17 personagens animados ≤ 0,3 ms/frame de CPU; coletas não escalam com o número de frames.
- Runtime para testes com janela: `../rts-uv-mundo/target/release/rts.exe` e `examples/ui_fixture.exe` (tem `tile`; ganha quaternion na Task 1).

## Review Focus

- Clipe cujo nome não existe (`play("corrida")`): nada quebra, erro legível no WebSocket, pose segue a atual.
- Modelo `.glb` sem animações ou sem hierarquia (só malhas): `Skeleton` desenha a pose de repouso; `AnimationPlayer` lista 0 clipes.
- Tempo negativo ou maior que a duração no `seek`: grampeado (sem laço) ou envolto (com laço), nunca NaN.
- Objeto com `Skeleton` duplicado ou copiado para o Play: a cópia tem pose e player próprios (não compartilha arrays).
- Osso posicionado à mão e depois um clipe tocando: o clipe sobrepõe; "resetar pose" volta ao repouso; salvar/carregar preserva a pose manual.

---

### Task 1: Quaternion no `drawMesh` (repo `rts`)

**Files:**
- Modify: `C:\Users\nexga\Documents\GitHub\rts-uv-mundo\crates\rts-ui\src\scene.rs` (fn `draw_mesh`)
- Modify: `...\crates\rts-egui\src\scene_api.rs` (fn `draw_mesh`, fn `draw_record`)
- Modify: `...\crates\rts-egui\src\frame\scene3d\math.rs` (nova fn `model_matrix_quat`)
- Test: `...\crates\rts-egui\src\frame\scene3d\tests.rs`

**Interfaces:**
- Produces (TS via runtime): `drawMesh(win, { mesh, x, y, z, rx, ry, sx, sy, sz, color, emissive, tex, tile, qx, qy, qz, qw })` — se `qw` for passado (≠ ausente; default lido = 0 e `qx=qy=qz=0` ⇒ sem quaternion), a rotação vem do quaternion normalizado e `rx/ry` são ignorados.

- [ ] **Step 1: Teste que falha** em `tests.rs`:

```rust
#[test]
fn model_matrix_quat_yaw_bate_com_model_matrix() {
    // quaternion de yaw 0.7 em torno de Y: (0, sin(0.35), 0, cos(0.35))
    let (s, c) = (0.35f32.sin(), 0.35f32.cos());
    let a = model_matrix(1.0, 2.0, 3.0, 0.0, 0.7, 1.5, 1.5, 1.5);
    let b = model_matrix_quat(1.0, 2.0, 3.0, [0.0, s, 0.0, c], 1.5, 1.5, 1.5);
    for i in 0..16 { assert!((a[i] - b[i]).abs() < 1e-5, "i={i} a={} b={}", a[i], b[i]); }
}

#[test]
fn model_matrix_quat_gira_x_local_depois_de_yaw() {
    // q = yaw(pi/2) * pitch(0.5): o eixo local Z vai para (sin(pi/2)*cos .5, -sin .5?, ...)
    // conferido contra a composição manual Ry * Rx
    let qy = [0.0, (std::f32::consts::FRAC_PI_4).sin(), 0.0, (std::f32::consts::FRAC_PI_4).cos()];
    let qx = [(0.25f32).sin(), 0.0, 0.0, (0.25f32).cos()];
    let q = quat_mul(qy, qx);
    let m = model_matrix_quat(0.0, 0.0, 0.0, q, 1.0, 1.0, 1.0);
    // coluna 2 = imagem do eixo local Z
    let z = [m[8], m[9], m[10]];
    // Rx(0.5) leva Z a (0, -sin .5, cos .5); Ry(pi/2) leva (x,y,z) a (z, y, -x)
    let esperado = [0.5f32.cos(), -(0.5f32.sin()), 0.0];
    for i in 0..3 { assert!((z[i] - esperado[i]).abs() < 1e-5, "i={i} {:?}", z); }
}
```

- [ ] **Step 2:** `cargo test --release -p rts-egui --lib scene3d` → FAIL (`model_matrix_quat` e `quat_mul` inexistentes).

- [ ] **Step 3: Implementação** em `math.rs`:

```rust
/// Produto de quaternions [x, y, z, w]: aplica `b` e depois `a`.
pub fn quat_mul(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

/// model = T · R(q) · S, column-major; q normalizado aqui.
pub fn model_matrix_quat(px: f32, py: f32, pz: f32, q: [f32; 4], sx: f32, sy: f32, sz: f32) -> [f32; 16] {
    let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    let (x, y, z, w) = if n > 1e-12 { (q[0] / n, q[1] / n, q[2] / n, q[3] / n) } else { (0.0, 0.0, 0.0, 1.0) };
    let r00 = 1.0 - 2.0 * (y * y + z * z); let r01 = 2.0 * (x * y - z * w); let r02 = 2.0 * (x * z + y * w);
    let r10 = 2.0 * (x * y + z * w); let r11 = 1.0 - 2.0 * (x * x + z * z); let r12 = 2.0 * (y * z - x * w);
    let r20 = 2.0 * (x * z - y * w); let r21 = 2.0 * (y * z + x * w); let r22 = 1.0 - 2.0 * (x * x + y * y);
    [
        r00 * sx, r10 * sx, r20 * sx, 0.0,
        r01 * sy, r11 * sy, r21 * sy, 0.0,
        r02 * sz, r12 * sz, r22 * sz, 0.0,
        px, py, pz, 1.0,
    ]
}
```

Se o primeiro teste mostrar que a convenção de `model_matrix` difere (ex.: sinal do yaw), ajuste o teste para a identidade `model_matrix(ry) == model_matrix_quat(yaw(ry))` com o sinal que o renderer usa — ela é o contrato, não a fórmula.

Em `scene_api.rs::draw_mesh`: novo parâmetro `quat: Option<[f64; 4]>`; se `Some`, montar a matriz com `model_matrix_quat` em vez de `draw_record`. Em `rts-ui/src/scene.rs::draw_mesh`: ler `"qx","qy","qz","qw"` (default `0.0`) e passar `Some([qx,qy,qz,qw])` quando algum for ≠ 0. Atualizar o doc comment.

- [ ] **Step 4:** `cargo test --release -p rts-egui --lib scene3d` → PASS (7). `cargo build --release --bin rts` e `cargo build --release -p rts-host --example ui_fixture --features ui`.

- [ ] **Step 5: Commit** no branch `feat/scene3d-quaternion` (a partir de `feat/scene3d-uv-mundo`) e PR em UrubuCode/rts.

---

### Task 2: `quat.ts` (rts-game)

**Files:**
- Create: `src/engine/render/quat.ts`
- Test: `tests/test_quat.ts`

**Interfaces:**
- Produces (todas com ≤ 4 parâmetros, saída no primeiro):
  - `quatMulInto(out: Float64Array, a: Float64Array, b: Float64Array): void` (quaternions de 4 elementos, `[x,y,z,w]`)
  - `quatRotateInto(out: Float64Array, q: Float64Array, v: Float64Array): void` (v e out: 3 elementos)
  - `quatNlerpInto(out: Float64Array, a: Float64Array, b: Float64Array, t: f64): void` (curto caminho: inverte `b` se `dot < 0`, depois normaliza)
  - `quatFromYawPitchInto(out: Float64Array, yaw: f64, pitch: f64): void` (yaw em Y, depois pitch em X local, na convenção da câmera)
  - `quatIdentity(out: Float64Array): void`

- [ ] **Step 1: Teste que falha** (`tests/test_quat.ts`):

```ts
import io from "@compat/io.ts";
import { quatMulInto, quatRotateInto, quatNlerpInto, quatFromYawPitchInto, quatIdentity } from "@engine/render/quat";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64): boolean { return Math.abs(a - b) < 1e-9; }
const q = new Float64Array(4); const r = new Float64Array(4); const o = new Float64Array(4);
const v = new Float64Array(3); const w = new Float64Array(3);
quatIdentity(q); v[0] = 1; v[1] = 2; v[2] = 3; quatRotateInto(w, q, v);
check(perto(w[0], 1) && perto(w[1], 2) && perto(w[2], 3), "identidade nao gira");
// yaw 90: eixo local Z (0,0,1) vai para (1,0,0) na convencao do renderer (fwd = (sin yaw, 0, cos yaw))
quatFromYawPitchInto(q, Math.PI / 2, 0.0); v[0] = 0; v[1] = 0; v[2] = 1; quatRotateInto(w, q, v);
check(perto(w[0], 1) && perto(w[1], 0) && perto(w[2], 0), "yaw 90 leva Z a X: " + w[0] + "," + w[1] + "," + w[2]);
// pitch positivo olha para cima: Z vai para (0, sin p, cos p)
quatFromYawPitchInto(q, 0.0, 0.3); quatRotateInto(w, q, v);
check(perto(w[1], Math.sin(0.3)) && perto(w[2], Math.cos(0.3)), "pitch 0.3 levanta Z");
// composicao: yaw(a) * yaw(b) = yaw(a+b)
quatFromYawPitchInto(q, 0.4, 0.0); quatFromYawPitchInto(r, 0.5, 0.0); quatMulInto(o, q, r);
quatFromYawPitchInto(q, 0.9, 0.0);
check(perto(o[0], q[0]) && perto(o[1], q[1]) && perto(o[2], q[2]) && perto(o[3], q[3]), "composicao de yaws");
// nlerp: extremos e meio
quatFromYawPitchInto(q, 0.0, 0.0); quatFromYawPitchInto(r, 1.0, 0.0);
quatNlerpInto(o, q, r, 0.0); check(perto(o[1], q[1]) && perto(o[3], q[3]), "nlerp t=0");
quatNlerpInto(o, q, r, 1.0); check(perto(o[1], r[1]) && perto(o[3], r[3]), "nlerp t=1");
quatNlerpInto(o, q, r, 0.5); quatFromYawPitchInto(q, 0.5, 0.0);
check(perto(o[1], q[1]) && perto(o[3], q[3]), "nlerp t=0.5 = yaw 0.5 (mesmo eixo)");
// caminho curto: -r e r dao o mesmo resultado
r[0] = -r[0]; r[1] = -r[1]; r[2] = -r[2]; r[3] = -r[3]; quatFromYawPitchInto(q, 0.0, 0.0);
quatNlerpInto(o, q, r, 0.5); quatFromYawPitchInto(q, 0.5, 0.0);
check(perto(Math.abs(o[1]), Math.abs(q[1])) && o[3] > 0, "nlerp pelo caminho curto");
io.print("[PASSOU] quat: identidade, yaw/pitch, composicao, nlerp");
```

- [ ] **Step 2:** `../rts-uv-mundo/target/release/rts.exe run tests/test_quat.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementação** (`src/engine/render/quat.ts`):

```ts
// Quaternions [x, y, z, w] em Float64Array, sem alocação: toda saída vai num
// buffer do chamador. Convenção do renderer: yaw em Y leva o eixo Z local a
// (sin yaw, 0, cos yaw); pitch > 0 olha para cima.
export function quatIdentity(out: Float64Array): void { out[0] = 0.0; out[1] = 0.0; out[2] = 0.0; out[3] = 1.0; }

/// out = a * b (aplica b, depois a). `out` pode ser `a` ou `b`.
export function quatMulInto(out: Float64Array, a: Float64Array, b: Float64Array): void {
  const ax = a[0]; const ay = a[1]; const az = a[2]; const aw = a[3];
  const bx = b[0]; const by = b[1]; const bz = b[2]; const bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/// out = q · v · q⁻¹ (q unitário). `out` pode ser `v`.
export function quatRotateInto(out: Float64Array, q: Float64Array, v: Float64Array): void {
  const x = q[0]; const y = q[1]; const z = q[2]; const w = q[3];
  const vx = v[0]; const vy = v[1]; const vz = v[2];
  const tx = 2.0 * (y * vz - z * vy); const ty = 2.0 * (z * vx - x * vz); const tz = 2.0 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
}

/// Interpolação normalizada pelo caminho curto.
export function quatNlerpInto(out: Float64Array, a: Float64Array, b: Float64Array, t: f64): void {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s: f64 = dot < 0.0 ? 0.0 - 1.0 : 1.0;
  const u = 1.0 - t;
  let x = a[0] * u + b[0] * s * t; let y = a[1] * u + b[1] * s * t;
  let z = a[2] * u + b[2] * s * t; let w = a[3] * u + b[3] * s * t;
  const n = Math.sqrt(x * x + y * y + z * z + w * w);
  if (n > 1e-12) { x = x / n; y = y / n; z = z / n; w = w / n; } else { x = 0.0; y = 0.0; z = 0.0; w = 1.0; }
  out[0] = x; out[1] = y; out[2] = z; out[3] = w;
}

/// yaw em Y e depois pitch em X LOCAL (a câmera do renderer).
export function quatFromYawPitchInto(out: Float64Array, yaw: f64, pitch: f64): void {
  const hy = yaw * 0.5; const hp = (0.0 - pitch) * 0.5;   // pitch>0 levanta Z: gira -pitch em X
  const cy = Math.cos(hy); const sy = Math.sin(hy); const cp = Math.cos(hp); const sp = Math.sin(hp);
  // q = qYaw * qPitch
  out[0] = cy * sp; out[1] = sy * cp; out[2] = 0.0 - sy * sp; out[3] = cy * cp;
}
```

- [ ] **Step 4:** rodar o teste → PASS. `npm run check:params` → ok.
- [ ] **Step 5:** commit `feat(render): quaternions sem alocacao (quat.ts)`.

---

### Task 3: Leitor de nós e clipes do glTF (`gltf_anim.ts`)

**Files:**
- Create: `src/engine/render/gltf_anim.ts`
- Create: `assets/models/kenney/character-a.glb` + `assets/models/kenney/Textures/texture-a.png` + `assets/models/kenney/LICENCA-Kenney-CC0.txt` (cópia do pacote Blocky Characters, CC0)
- Modify: `src/engine/render/model.ts` — exportar `readAccessor`, `buildPrimitive` e a leitura do `.glb` (`glbChunks(path): { json: any, bin: Buf }`) para reuso (sem mudar o comportamento de `loadGltfParts`)
- Test: `tests/test_gltf_anim.ts`

**Interfaces:**
- Produces:

```ts
export class AnimClip {
  name: string; duration: f64;
  // um canal por (osso, propriedade): 0 = translation (3), 1 = rotation (4), 2 = scale (3)
  chBone: number[]; chPath: number[];
  chTimes: Float64Array[]; chValues: Float64Array[];
}
export class SkeletonAsset {
  path: string;
  boneNames: string[]; boneParent: number[];      // -1 = raiz
  restT: Float64Array; restR: Float64Array; restS: Float64Array;   // 3/4/3 por osso
  partBone: number[]; partMesh: number[]; partTex: number[]; partColor: number[];   // peças (primitives) por osso
  clips: AnimClip[];
  clipIndex(name: string): number;                 // -1 se não existe
}
export function loadSkeletonAsset(win: number, path: string): SkeletonAsset;   // cacheado por caminho; win = 0 ⇒ não sobe malhas (teste sem janela)
```

Ossos em ordem de pai antes de filho (percorrer a cena a partir de `scenes[scene].nodes` em pré-ordem), para que a composição seja um laço único.

- [ ] **Step 1: Teste que falha** (`tests/test_gltf_anim.ts`):

```ts
import io from "@compat/io.ts";
import { loadSkeletonAsset } from "@engine/render/gltf_anim";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const a = loadSkeletonAsset(0, "assets/models/kenney/character-a.glb");
check(a.boneNames.length === 8, "8 nos: " + a.boneNames.join(","));
const torso = a.boneNames.indexOf("torso");
check(a.boneParent[a.boneNames.indexOf("head")] === torso, "head e filho do torso");
check(a.boneParent[a.boneNames.indexOf("arm-right")] === torso, "arm-right e filho do torso");
check(a.boneParent[0] === -1, "primeiro osso e a raiz");
let i = 0; while (i < a.boneNames.length) { check(a.boneParent[i] < i, "pai antes do filho: " + a.boneNames[i]); i = i + 1; }
check(Math.abs(a.restT[torso * 3 + 1] - 0.7) < 1e-6, "torso em y=0.7 no repouso");
check(Math.abs(a.restS[a.boneNames.indexOf("head") * 3] - 0.1) < 1e-6, "head com escala 0.1");
check(a.clips.length === 27, "27 clipes");
const walk = a.clips[a.clipIndex("walk")];
check(Math.abs(walk.duration - 0.6666667) < 1e-4, "walk 0,667 s: " + walk.duration);
check(walk.chBone.length === 6, "walk tem 6 canais");
check(a.clipIndex("corrida") === -1, "clipe inexistente = -1");
check(a.partBone.length === 6, "6 pecas (pernas, torso, bracos, cabeca)");
io.print("[PASSOU] gltf_anim: hierarquia, repouso, 27 clipes, walk");
```

- [ ] **Step 2:** rodar → FAIL (módulo não existe).
- [ ] **Step 3: Implementação.** Ler o `.glb` com o mesmo código de `model.ts` (exportar o que for preciso). Nós: `translation` default `[0,0,0]`, `rotation` default `[0,0,0,1]`, `scale` default `[1,1,1]`; `matrix` (se houver) decomposto só se T/R/S ausentes — os Kenney usam TRS. Animações: `channels[].target.node/path` e `samplers[].input/output` via `readAccessor`; `duration` = maior `max` dos `input`. Peças: para cada nó com `mesh`, cada primitive vira uma peça (`buildPrimitive`, subindo a malha só se `win !== 0`; textura via `loadTexture` do `texPath`, capturando erro). Cache por caminho num `Map<string, SkeletonAsset>`.
- [ ] **Step 4:** rodar → PASS; `test_model` continua PASS.
- [ ] **Step 5:** commit `feat(render): glTF com nos e clipes (gltf_anim.ts) e personagem Kenney de fixture`.

---

### Task 4: Componente `Skeleton` (pose, composição, desenho)

**Files:**
- Create: `src/engine/core/skeleton.ts`
- Modify: `src/engine/render/gpu3d.ts` — `drawGPUMeshQ(win, meshId, px, py, pz, q: Float64Array, sx, sy, sz, color, emissive, tex)` (sem padrão) passando `qx..qw` ao `drawMesh`
- Modify: `src/engine/core/behavior.ts` — hook `drawSelf(win: number): number { return 0; }` (1 = o componente se desenhou)
- Modify: `src/engine/render/scenedraw.ts` e `game.ts` — antes do desenho por `meshKind`, `if (o.rendIdx >= 0 && o.behaviors[o.rendIdx].drawSelf(win) !== 0) { drawnN++; continue; }`
- Modify: `src/editor/sceneio.ts` — restaurar `{ t: "skeleton", path, pose }`
- Test: `tests/test_skeleton.ts`

**Interfaces:**
- Consumes: `SkeletonAsset`, `loadSkeletonAsset` (Task 3); `quatMulInto`, `quatRotateInto` (Task 2).
- Produces:

```ts
export class Skeleton extends Behavior {   // kind() = KIND_RENDERER
  modelPath: string;
  asset: SkeletonAsset | null;             // carregado sob demanda por ensureAsset(win)
  poseT: Float64Array; poseR: Float64Array; poseS: Float64Array;   // pose LOCAL atual (3/4/3 por osso)
  worldT: Float64Array; worldR: Float64Array;                     // pose de mundo do último compose
  overrideMask: number[];                   // 1 = osso posicionado à mão (salvo na cena)
  boneCount(): number;
  boneIndex(name: string): number;
  resetPose(): void;                        // pose = repouso; overrideMask = 0
  setBoneRotation(bone: number, q: Float64Array): void;   // marca override
  setBonePosition(bone: number, x: f64, y: f64, z: f64): void;
  compose(): void;                          // pose de mundo a partir do host (posição, yaw) e da hierarquia
  drawSelf(win: number): number;
}
```

- [ ] **Step 1: Teste que falha** (`tests/test_skeleton.ts`):

```ts
import io from "@compat/io.ts";
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { quatFromYawPitchInto } from "@engine/render/quat";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64): boolean { return Math.abs(a - b) < 1e-6; }
const g = new GameObject("heroi");
const sk = new Skeleton("assets/models/kenney/character-a.glb");
g.addBehavior(sk);
sk.ensureAsset(0);
check(sk.boneCount() === 8, "8 ossos");
const head = sk.boneIndex("head"); const torso = sk.boneIndex("torso");
sk.compose();
// repouso: head em torso(0,0.7,0) + (0,1.2,0) = y 1.9, objeto na origem
check(perto(sk.worldT[head * 3 + 1], 1.9), "cabeca em y=1.9 no repouso: " + sk.worldT[head * 3 + 1]);
// objeto andou e virou 90 graus: o braco direito (x=-0.4 local) vai para z=+0.4
g.transform.setPosition(10.0, 0.0, 5.0); g.transform.ry = Math.PI / 2;
sk.compose();
const arm = sk.boneIndex("arm-right");
check(perto(sk.worldT[arm * 3], 10.0) && perto(sk.worldT[arm * 3 + 2], 5.4), "braco segue o yaw do objeto: " + sk.worldT[arm * 3] + "," + sk.worldT[arm * 3 + 2]);
// girar o torso 90 em Y leva a cabeca junto (filha) e marca override
const q = new Float64Array(4); quatFromYawPitchInto(q, Math.PI / 2, 0.0);
g.transform.setPosition(0.0, 0.0, 0.0); g.transform.ry = 0.0;
sk.setBoneRotation(torso, q); sk.compose();
check(sk.overrideMask[torso] === 1, "torso marcado como posicionado a mao");
check(perto(sk.worldR[head * 4 + 1], q[1]) && perto(sk.worldR[head * 4 + 3], q[3]), "cabeca herda a rotacao do torso");
sk.resetPose(); sk.compose();
check(sk.overrideMask[torso] === 0 && perto(sk.worldR[head * 4 + 3], 1.0), "resetPose volta ao repouso");
// dados por instancia: um segundo Skeleton do mesmo modelo nao compartilha a pose
const sk2 = new Skeleton("assets/models/kenney/character-a.glb"); sk2.ensureAsset(0);
sk.setBoneRotation(torso, q);
check(sk2.poseR[torso * 4 + 3] === 1.0, "pose e por instancia");
io.print("[PASSOU] skeleton: repouso, yaw do objeto, hierarquia, override, reset, instancias");
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementação.** `compose()`: raiz do objeto = `(t.wx, t.wy, t.wz)` com rotação `quatFromYawPitch(t.wry, 0)` e escala `t.sx`; para cada osso em ordem (pai antes), `worldR = worldR[pai] * poseR`, `worldT = worldT[pai] + rotate(worldR[pai], poseT * escalaAcumulada[pai])`, `escala = escala[pai] * poseS`. Buffers temporários como campos (Float64Array de 4/3) criados no construtor. `drawSelf`: `ensureAsset(win)`, `compose()`, para cada peça `drawGPUMeshQ(win, partMesh, worldT[b], worldR[b], escala[b], cor, 0, tex)`; devolve 1. Serialização: `toData()` → `{ t: "skeleton", path, pose: [[osso, tx,ty,tz, rx,ry,rz,rw], …] só dos com override }`.
- [ ] **Step 4:** rodar → PASS; `npm run check:params`; suíte de render (`test_scene`, `test_editor_ui`, `claude-test-sceneio-roundtrip`) → PASS.
- [ ] **Step 5:** commit `feat(core): componente Skeleton (ossos rigidos, pose, composicao, desenho por quaternion)`.

---

### Task 5: Componente `AnimationPlayer`

**Files:**
- Create: `src/engine/core/animation_player.ts`
- Modify: `src/editor/sceneio.ts` — restaurar `{ t: "animPlayer", clip, loop, speed, playing }`
- Test: `tests/test_animation_player.ts`

**Interfaces:**
- Consumes: `Skeleton` (Task 4), `AnimClip` (Task 3), `quatNlerpInto` (Task 2).
- Produces:

```ts
export class AnimationPlayer extends Behavior {
  clip: string; loop: boolean; speed: f64; playing: boolean; time: f64;
  play(name: string, loopArg?: boolean): boolean;      // false se o clipe não existe (pose não muda)
  crossFade(name: string, seconds: f64): boolean;
  pause(): void; resume(): void;
  seek(t: f64): void;                                  // grampeia (sem laço) ou envolve (com laço); aplica a pose já
  clipNames(): string[];
  update(dt: f64): void;                               // avança e escreve a pose no Skeleton do mesmo objeto
}
export function sampleClipInto(sk: Skeleton, clip: AnimClip, t: f64, weight: f64): void;   // weight<1 mistura com a pose atual
```

- [ ] **Step 1: Teste que falha** (`tests/test_animation_player.ts`):

```ts
import io from "@compat/io.ts";
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { AnimationPlayer } from "@engine/core/animation_player";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const g = new GameObject("p"); const sk = new Skeleton("assets/models/kenney/character-a.glb"); sk.ensureAsset(0);
const ap = new AnimationPlayer(); g.addBehavior(sk); g.addBehavior(ap);
check(ap.clipNames().length === 27, "27 clipes");
check(!ap.play("corrida"), "clipe inexistente devolve false");
check(ap.play("walk", true), "walk existe");
const leg = sk.boneIndex("leg-left");
ap.seek(0.0); const r0 = sk.poseR[leg * 4];
ap.seek(0.3333); const rMeio = sk.poseR[leg * 4];
check(Math.abs(r0 - rMeio) > 0.01, "a perna muda entre t=0 e t=0.33");
ap.seek(0.6666 + 0.3333); check(Math.abs(ap.time - 0.3333) < 1e-3, "com laco, seek envolve: " + ap.time);
ap.seek(-1.0); check(ap.time >= 0.0 && ap.time === ap.time, "seek negativo nao da NaN nem negativo");
ap.play("die", false); ap.seek(99.0); check(Math.abs(ap.time - ap.duration()) < 1e-6, "sem laco, seek grampeia no fim");
// crossfade: metade do caminho = media das poses (nlerp)
ap.play("idle", true); ap.seek(0.0); const idleR = sk.poseR[leg * 4 + 3];
ap.crossFade("walk", 1.0); ap.update(0.5);
const misto = sk.poseR[leg * 4 + 3];
check(misto === misto && Math.abs(misto) <= 1.0, "pose mista valida");
// custo e alocacao: 17 players x 1000 frames
const gs: GameObject[] = []; let k = 0;
while (k < 17) { const o = new GameObject("b" + k); const s = new Skeleton("assets/models/kenney/character-a.glb"); s.ensureAsset(0); const p = new AnimationPlayer(); o.addBehavior(s); o.addBehavior(p); p.play("walk", true); gs.push(o); k = k + 1; }
const t0 = performance.now(); let f = 0;
while (f < 1000) { k = 0; while (k < 17) { gs[k].behaviors[1].update(1.0 / 60.0); (gs[k].behaviors[0] as Skeleton).compose(); k = k + 1; } f = f + 1; }
const ms = (performance.now() - t0) / 1000.0;
io.print("  17 personagens: " + ms.toFixed(3) + " ms/frame");
check(ms <= 0.3, "17 animados <= 0,3 ms/frame: " + ms);
io.print("[PASSOU] animation_player: play, seek, laco, grampo, crossfade, custo");
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementação.** Amostragem: busca binária em `chTimes` (último key ≤ t); `f = (t - t0)/(t1 - t0)`; translation/scale lerp; rotation `quatNlerpInto`. `update(dt)`: `time += dt*speed`; laço envolve com `%`; sem laço grampeia e `playing` fica `false` no fim. Crossfade: guarda clipe anterior e tempo dele; peso `w = min(1, fadeTime/fadeDur)`; amostra o anterior (peso 1) e o novo com peso `w` (mistura: lerp/nlerp entre a pose atual e a do clipe). Sem alocação: buffers de 4 elementos como campos.
- [ ] **Step 4:** rodar → PASS; rodar com `RTS_GC_DEBUG=1` 1.000 e 10.000 frames e confirmar que as coletas não escalam; `npm run check:params`.
- [ ] **Step 5:** commit `feat(core): AnimationPlayer (clipes glTF, laco, seek, crossfade)`.

---

### Task 6: Comandos do WebSocket (IA)

**Files:**
- Create: `src/editor/control/commands/skeleton.ts`
- Modify: `src/editor/control/dispatch.ts` — registrar os comandos; os que mudam a cena entram na lista de mutação (snapshot/undo)
- Test: `tests/test_ws_skeleton.ts`

**Interfaces:**
- Produces (texto → texto, mesmo formato dos comandos existentes; erros começam com `[erro]`):
  - `addskel <obj> <caminho.glb>` — adiciona `Skeleton` + `AnimationPlayer`
  - `bones <obj>` — `[ossos] #obj n | 0 root (pai -1) | 1 leg-left (pai 0) …`
  - `pose <obj> <osso|nome> rot <yawGraus> <pitchGraus> <rollGraus>` / `pose <obj> <osso> pos <x> <y> <z>`
  - `resetpose <obj>`
  - `anims <obj>` — lista de clipes com duração
  - `anim <obj> play <nome> [loop|once]` · `anim <obj> pause` · `anim <obj> resume` · `anim <obj> seek <s>` · `anim <obj> fade <nome> <s>` · `anim <obj> speed <x>` · `anim <obj> state` (clipe, tempo, tocando)

- [ ] **Step 1: Teste que falha** (`tests/test_ws_skeleton.ts`), chamando as funções `cmd*` diretamente:

```ts
import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { cmdAddSkel, cmdBones, cmdPose, cmdResetPose, cmdAnims, cmdAnim } from "@editor/control/commands/skeleton";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
scene.clear(); scene.add(new GameObject("heroi"));
check(cmdAddSkel(["addskel", "0", "assets/models/kenney/character-a.glb"]).indexOf("[ok]") === 0, "addskel");
const b = cmdBones(["bones", "0"]); check(b.indexOf("arm-right") > 0 && b.indexOf("(pai") > 0, "bones lista com pais: " + b);
check(cmdPose(["pose", "0", "torso", "rot", "90", "0", "0"]).indexOf("[ok]") === 0, "pose por nome");
check(cmdPose(["pose", "0", "99", "rot", "0", "0", "0"]).indexOf("[erro]") === 0, "osso invalido = erro");
check(cmdResetPose(["resetpose", "0"]).indexOf("[ok]") === 0, "resetpose");
check(cmdAnims(["anims", "0"]).indexOf("walk") > 0, "anims lista walk");
check(cmdAnim(["anim", "0", "play", "walk", "loop"]).indexOf("[ok]") === 0, "anim play");
check(cmdAnim(["anim", "0", "play", "corrida"]).indexOf("[erro]") === 0, "clipe inexistente = erro legivel");
check(cmdAnim(["anim", "0", "seek", "0.3"]).indexOf("[ok]") === 0, "seek");
const st = cmdAnim(["anim", "0", "state"]); check(st.indexOf("walk") > 0 && st.indexOf("0.3") > 0, "state: " + st);
check(cmdAnim(["anim", "5", "state"]).indexOf("[erro]") === 0, "objeto invalido = erro");
io.print("[PASSOU] ws skeleton: addskel, bones, pose, resetpose, anims, anim");
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementação** seguindo `commands/component.ts` (objeto por índice, validação, mensagens `[ok]`/`[erro]`), e registro em `dispatch.ts` (incluir `addskel`, `pose`, `resetpose`, `anim` na lista de mutação que já inclui `addcomp`).
- [ ] **Step 4:** rodar → PASS; editor real: `python tools/ws_client.py "addskel 0 assets/models/kenney/character-a.glb" "anim 0 play walk loop" "anim 0 state"`.
- [ ] **Step 5:** commit `feat(ws): comandos de ossos e animacao para a IA (bones, pose, anim)`.

---

### Task 7: Editor nível 1 — ver e testar

**Files:**
- Modify: `src/editor/inspector.ts` — seção "Esqueleto" quando o objeto tem `Skeleton`: árvore de ossos (rótulos indentados pelo nível, clique seleciona `S.selectedBone`), lista de clipes (botões), tocar/pausar, campo numérico de tempo (arrastar = seek) e "Resetar pose"
- Modify: `src/editor/ui_config.ts` — medidas/rótulos/cores da seção (`UI_SKELETON`)
- Modify: `src/editor/control/session.ts` — `selectedBone: number = -1`
- Modify: `main.ts` — fora do Play, `AnimationPlayer.update` só roda se o preview estiver tocando (sem alterar a cena salva); dentro do Play, normal
- Test: `tests/test_inspector_skeleton.ts` (sem janela: montar a seção com a `UIScene` e simular clique no botão de um clipe → `AnimationPlayer.clip` muda; clique num osso → `S.selectedBone`)

- [ ] **Step 1:** escrever o teste acima usando o mesmo padrão de `tests/test_inspector_text.ts` (controles da `UIScene`, clique simulado) → FAIL.
- [ ] **Step 2:** implementar a seção seguindo `Inspector.header/label/control` existentes; IDs únicos na janela; valores de `UI_SKELETON`.
- [ ] **Step 3:** teste → PASS; `test_editor_ui`, `test_inspector_text`, `test_play_mode` → PASS.
- [ ] **Step 4: Verificação com janela:** editor real, `addskel` pelo WS, selecionar o objeto, tocar `walk` e arrastar o tempo; captura da janela com `PrintWindow`.
- [ ] **Step 5:** commit `feat(editor): inspector do esqueleto (ossos, clipes, tocar/pausar, tempo)`.

---

### Task 8: Editor nível 2 — posicionar ossos

**Files:**
- Modify: `main.ts` (gizmo) — com `S.selectedBone >= 0`, o gizmo de rotação/movimento opera no osso: origem = `worldT` do osso; arrasto gira/move em espaço do pai e chama `setBoneRotation/setBonePosition`
- Modify: `src/editor/inspector.ts` — campos numéricos de rotação (graus) e posição do osso selecionado
- Modify: `src/editor/sceneio.ts` — pose manual (`overrideMask`) vai e volta na cena (Task 4 já serializa; aqui o round-trip pelo editor)
- Test: `tests/test_skeleton_pose_undo.ts` — pose via inspector → snapshot → desfazer volta; salvar → carregar preserva a pose; Play copia a pose sem compartilhar arrays

- [ ] **Step 1:** teste → FAIL.
- [ ] **Step 2:** implementar (o snapshot de Desfazer já é o JSON da cena: basta a pose estar em `toData`).
- [ ] **Step 3:** teste → PASS; `test_play_mode`, `claude-test-sceneio-roundtrip` → PASS.
- [ ] **Step 4: Verificação com janela:** selecionar `arm-right`, girar pelo gizmo, desfazer, salvar e recarregar.
- [ ] **Step 5:** commit `feat(editor): posicionar ossos com o gizmo, pose salva e desfazer`.

---

### Task 9: rts-fps — personagens animados

**Files (repo rts-fps):**
- Modify: `engine` (submódulo no commit com as Tasks 2–8)
- Modify: `assets/kenney/personagens/` — trocar `.obj` pelos `.glb` (a–d) com texturas
- Modify: `src/modelos.ts` — personagens como `SkeletonAsset` + estado de animação por jogador (clipe, tempo) em arrays; sem `GameObject` extra
- Modify: `src/render.ts` — desenhar pela pose; escolher clipe: vivo e parado → `idle`, andando → `walk`, rápido → `sprint`, morto → `die` (uma vez); braço direito sobreposto por `holding-right` (e `holding-right-shoot` por 0,2 s ao atirar); arma no osso `arm-right`
- Modify: `src/client.ts` e `src/client_rede.ts` — preencher velocidade/tiro por jogador para a escolha do clipe
- Test: `tests/fps-animacao.ts` — velocidade 0 → idle; 4 u/s → walk; morto → die e não repete

- [ ] **Step 1:** teste → FAIL.
- [ ] **Step 2:** implementar.
- [ ] **Step 3:** suíte do rts-fps (14) → mesmas 13 PASS; fps com janela ≥ 58 (vsync) com 12 bots; captura mostrando bots andando.
- [ ] **Step 4:** recompilar o `.exe`, testar em pasta limpa, atualizar o zip.
- [ ] **Step 5:** commit `feat(fps): personagens animados (idle/walk/sprint/die, arma no osso)`.
