# RTS Engine — a Unity-style game engine, 100% TypeScript

A Unity-style 3D scene editor and game engine (**everything is a `GameObject`**,
components with a `mount → update(dt) → render` cycle), written entirely in
**TypeScript** and running on the **RTS** engine (`rts.exe`, a TS→native
compiler/runtime built on Cranelift). 3D is rendered on the **GPU** through the
RTS `egui` window backend (wgpu scene pass); the editor UI is immediate-mode on
top of the same window.

```
rts.exe run main.ts          # the visual editor (window): toolbar, hierarchy, inspector, 3D viewport
```

An **AI/LLM drives the SAME editor a human sees**, live, over an embedded
WebSocket (`ws://127.0.0.1:7777`) — no screenshots required. See
[Control (WebSocket)](#control-websocket) and [TESTING.md](TESTING.md).

## Unity-like model

- **GameObject** — the scene unit. Has a `Transform`, a mesh, color, a list of
  `Behavior`s (components) and a `parent` (hierarchy).
- **Transform** — local position/rotation/scale + **world** position/rotation
  (composed with the parent by `Scene.computeWorld`, order-independent multi-pass).
- **Behavior** (the "MonoBehaviour") — a component. Overrides `mount()` /
  `update(dt)`, identifies itself via `kind()`, and serializes via `toData()`.
  They run in a polymorphic array (virtual dispatch proven on the engine).
- **Scene** — a list of GameObjects + polymorphic `update(dt)` +
  `resolveCollisions()` + `computeWorld()`.

### "Everything is a GameObject" — the component model

Components are typed by `kind()` and looked up generically via
`GameObject.componentIdx(kind)`. Beyond gameplay scripts, the appearance and
structure are components too:

| Component | `kind` | Role |
|---|---|---|
| gameplay scripts | `SCRIPT` | Spinner / Bobber / Rigidbody / Mover / Pulse / Orbit |
| `Material` | `MATERIAL` | texture (real image + procedural checker), emissive, tint |
| `MeshRenderer` | `RENDERER` | which mesh to draw (primitive or `.obj`) |
| `UIPanel` | `UI` | a UI element drawn in 2D (anchored, RectTransform-like) |
| `SceneRef` | `SCENE_REF` | marks an object as an instance of another scene |

The render pass reads a `MeshRenderer` (geometry) + `Material` (appearance) when
present, with a fallback to the GameObject's own fields for older scenes.

## Layout

```
engine/core/     transform · behavior · gameobject · scene · camera
                 material · meshrenderer · sceneref   (data components)
engine/render/   gpu3d.ts (GPU scene pass via egui.* — meshes/camera/light/shadow/texture)
                 raster.ts · mesh.ts · draw.ts        (software renderer, harness-only)
engine/ui/       uipanel.ts · uiscene.ts              (UI as GameObjects — L3 foundation)
editor/          widgets · assets (Project browser) · gizmo (Move/Rotate/Scale math)
                 components (Add Component registry) · sceneio (save/load/clone) · undo (history)
editor/control/  server (WebSocket) · dispatch (command switch) · session (shared state)
editor/control/commands/   query · spawn · transform · scene · component · hierarchy · files · doc
scripts/         spinner · bobber · rigidbody · mover · pulse · orbit   (gameplay components)
```

## Features

**3D rendering (GPU, wgpu scene pass):** perspective camera (fly + presets),
solid faces with depth test, point light + ambient, **directional shadow map
(PCF)**, **real image textures** (PNG/JPG/BMP/WebP, sampled by per-vertex UV) +
procedural checker, procedural skybox, specular, per-object emissive. Frustum
culling. Fly camera; **frame selected** and **frame all**.

**Manipulation (gizmo):** Move / Rotate / Scale tools with colored X/Y/Z axes,
**tool-specific visuals** (arrows / projected rings / cube handles), **plane
handles** (drag two axes), **multi-selection** (the gizmo manipulates all selected
at once), **snap-to-grid** (position 0.5, rotation 15°). Keyboard shortcuts
`Q/E/R` (tools) and `F` (frame selected).

**Objects & hierarchy:** **right-click context menu** on the tree (create cube,
sphere, pyramid, octahedron, empty or camera — as a child of the clicked object,
or at the root from empty space; new objects spawn in front of the camera, not at
the origin where they would be off-screen), **scrolling** (mouse wheel + a
draggable bar; without it a 500-object scene left 477 of them unreachable),
duplicate (single + **array** `dupn`, cloning all components), rename, reset
transform, hide/isolate, delete (single + selection), **group / ungroup**,
reparent.

**Scene:** save / load (and **persists across sessions**), **undo / redo**
(scene-snapshot), **scene-within-scene** instancing (Godot-style, via `SceneRef`),
**prefabs** (create + instantiate), a ground grid, camera view presets, light
control.

**Inspector (Unity dark theme):** component **foldouts** (collapse + enabled
checkbox), editable object name, per-field numeric config with click-to-type and
drag-scrub, **X/Y/Z colored** Vector3 fields, **Add Component** with search.

**Physics:** **box and sphere colliders** (`colShape`, defaulted per mesh) with
box-box, box-sphere and sphere-sphere resolution — so flat ground, walls and
platforms are solid, which a sphere-only collider could never express (a
60x0.4x60 floor became a radius-0.2 sphere). **Dynamic response**: rigid-body
impulse over `mass` / `restitution` / `friction`, so bodies bounce, slide and
push each other instead of merely stopping. Mass 0 means infinite (immovable).
`Rigidbody` integrates all three axes, with `drag` and an optional safety floor.

**Audio:** a voice mixer over the runtime's raw `audio` namespace (which only
opens the device and takes interleaved f32 samples). Up to 24 voices — sine,
square, noise — each with an attack/decay envelope, mixed per frame into the
ring buffer. `AudioSource` is a component: fire on demand or on an interval. No
audio device means the game runs **silent**, not crashed.

**Animation:** `Animator` interpolates `(time, value)` keyframes over a transform
channel, with linear / smoothstep / step curves and once / loop / ping-pong. Two
Animators on one object animate different channels — that is how a door that
opens while rising is built.

**Serialization:** scenes are JSON (`JSON.stringify`/`parse`, native to the
engine); components serialize themselves and are rebuilt on load.

## Control (WebSocket)

The editor embeds a **non-blocking WebSocket server** on `ws://127.0.0.1:7777`
(polled once per frame), so an AI drives the exact scene the human is looking at,
live. Every editor operation has a command. Send one command per message:

```
select 1
selectadd 2
tool rotate           # switch the viewport gizmo tool
snap 1                # snap-to-grid on
loadtex 0 images.jpg  # decode + apply a real texture as a Material
instscene assets/subscene.json 0   # scene-within-scene under object #0
savescene assets/my.json
```

There are **60+ commands**. The port is **self-documenting**: send `help` for the
list and `doc [prefix]` for the signature + example of each command (so an AI can
discover the full surface). Client: `tools/ws_client.py`. See
[TESTING.md](TESTING.md).

## Build a native executable

The editor AOT-compiles to a standalone native binary with `rts compile`:

```
rts.exe compile main.ts release/rts-game   # -> release/rts-game.exe (runtime linked in)
```

CI (`.github/workflows/build-executable.yml`) **downloads the `rts.exe` from the
engine's latest release** (no engine rebuild — that binary is AOT-capable), runs
`rts compile`, and **publishes a GitHub Release** of the executable + assets on
every push to `master`.

## Performance

Measured on this machine, 300-frame runs, 10% of objects moving (a realistic RTS
mix — most units idle at any instant). Budget for 60 fps is 16.7 ms/frame:

| Objects | ms/frame | Verdict |
|---|---|---|
| 500 | 6.1 | comfortable |
| 1000 | 11.7 | fits |
| 2000 | 23.2 | ~43 fps |

A realistic scene — 1000 objects, of which 200 are units with a movement script
and 800 are static scenery — costs **13.7 ms/frame**. The SPH fluid demo
(`fluid_demo.ts`) runs 168 particles at ~53 fps.

**The single biggest lever, by far:** hot loops belong in **free functions with
annotated parameters**, not methods. Inside a method the locals lose their type
proofs and every `this.objects[i].transform.px` falls into the dynamic property
path. Same logic, moved out and typed:

- `computeWorld` → 3.3x (500 objects: 3.8 s → 1.1 s)
- collision resolve pass → up to 3.1x (500 moving: 12.3 s → 3.9 s)
- script dispatch, one level of indirection removed → up to 2.9x

Second lever: **arrays, not `Map`**, for anything rebuilt per frame. `Map` used
to be O(n) per lookup in the runtime (fixed upstream in UrubuCode/rts#1998), but
a linked list in flat arrays is still faster — it allocates nothing.

Third: **do not redo what has not changed.** Collision skips any object that has
not moved since last frame (`lastX`/`lastZ`), and the collider list is only
rebuilt when the scene composition changes (`colDirty`). Both are cheap flags
guarding expensive work.

Two things that sound right and **measurably are not** (both tried, both
reverted — see the comments in `engine/core/scene.ts`): guarding the spatial
grid rebuild behind a "did anything change?" check, and shrinking the neighbour
cap in the fluid. In both cases the check cost more than the work it saved.

## Road to a professional engine — what is guaranteed, and what is not

A professional engine is not a feature list. It is **a ceiling that does not
betray you**: every failure below is one that worked fine at small scale and
then broke suddenly, or silently, at a size nobody had tried. So each line here
carries a **measured number** and **how it is proven** — an item with no way to
check it is a wish, not a guarantee.

### Guaranteed (measured, with the test that pins it)

| Guarantee | Number | Proven by |
|---|---|---|
| Physics advances by the CLOCK, not by frame count | 90 steps / 300 frames @ 200 fps = 60 Hz exact | the `rigApl` counter in the demo log |
| One draw call per (mesh, texture) GROUP, not per object | 81 → 176 fps at 350 objects | `castelo_gpu_demo` with vsync and the frame limiter off |
| Audio costs the same whether it is silent or sounding | 11–18 ms → 0–1 ms per frame | phase timing in the demo |
| Positional audio is correct, not just plausible | 18 assertions, incl. constant energy over 16 angles | `tools/test_audio3d.ts` |
| A `rts:buffer` handle survives the collector | ~166 k calls used to kill it; now unbounded | `tools/diag/claude-repro-minimo.ts` + UrubuCode/rts#2104 |
| A module-level array is read as fast as a parameter | 260 ns → 20 ns per access | `tools/diag/claude-custo-param.ts` + UrubuCode/rts#2105 |

### Not guaranteed yet, in order of how much ceiling they buy

**1. Broadphase in the physics kernel.** `gpurigid`'s gather is **O(n²)**: every
body walks every other one. At 355 bodies that is 126 000 pairs per step, and it
is the hard ceiling on scene size — no amount of GPU hides a quadratic. Every
engine uses a spatial grid, a BVH or sweep-and-prune so a body only tests
neighbours.
*Guaranteed when:* 5 000 bodies step in under 4 ms, and a test asserts the pair
count grows linearly, not quadratically, between 500 and 5 000.

**2. Render interpolation between physics steps.** Physics runs at 60 Hz and the
renderer now hits 200 fps, so three consecutive frames draw the *same* state.
That is visible micro-stutter, and it is a problem we created by fixing the
timestep — the accumulator already holds what is needed
(`alpha = acumulado / RB_DT`).
*Guaranteed when:* the drawn position is `prev + (curr − prev) × alpha`, and a
test asserts that a body moving at constant speed produces evenly spaced drawn
positions at a render rate that is not a multiple of 60.

**3. Gain ramp in the mixer (zipper noise).** Channel gains are recomputed once
per block. A source crossing quickly changes gain by a step at the block edge,
and a step is broadband — at 60 blocks/s it reads as a 60 Hz buzz. The fix is
~2 ns/sample: ramp toward the target instead of jumping.
*Guaranteed when:* the mixer holds current and target gains, and a test asserts
no sample-to-sample jump above a threshold while a source crosses the listener.

**4. Front and back sound identical.** Pure L/R panning cannot tell them apart —
this is a limit of the model, documented in `engine/audio/spatial.ts`, not a bug.
ITD (interaural delay, ~31 samples at the extreme, costs nothing but an index
offset) plus a one-pole head-shadow filter buy most of the missing cue for ~5 %
of the per-sample cost.
*Guaranteed when:* a test asserts a source behind the listener differs
measurably from the same source in front.

**5. A native accumulate for audio.** Summing into the mix buffer costs 4 native
calls per sample per voice (~44 % of what remains after the loop inversion). One
`audio.mix_f32(buf, offset, L, R)` would take the voice ceiling from ~24 to
~32–40.
*Guaranteed when:* `tools/diag/claude-laco-invertido.ts` reports 24 voices under
1.2 ms.

**6. Occlusion culling and LOD.** Frustum culling exists; 350 objects are still
350 draws' worth of geometry even when most are behind a wall.
*Guaranteed when:* a scene with a wall in front of the castle draws measurably
fewer triangles, asserted through `dbg`.

**7. A render thread separate from game logic.** `endFrame` costs 5.8 ms and
blocks the logic while it runs. Engines record command buffers on one thread and
submit on another.
*Guaranteed when:* logic time and present time overlap — measurable as a frame
whose total is less than the sum of its phases.

**8. A test that compares PIXELS.** Nothing here would catch a visual
regression: wrong draw order, an object in the wrong instancing group, a shader
change. The instancing work above was verified **by looking at the window**,
which is honest but does not scale.
*Guaranteed when:* a headless run renders a fixed scene and compares against a
stored image within a tolerance.

**9. `MAX_PUMP` is a latent spike.** A recovery block costs 3× a normal one, and
it happens exactly on the frame the game is already late. With 32 voices that
would be ~4 ms in a single frame.
*Guaranteed when:* `MAX_PUMP` is 1200 and the worst-case pump is measured, not
assumed.

### The rule this list exists to enforce

Every item above became visible only when something else got faster. Fixing the
timestep exposed the interpolation gap; the instancing exposed the timestep bug;
the audio fix exposed how much the mixer was hiding. **Speed reveals bugs it did
not cause** — so a number here without a test beside it goes stale the first
time someone makes an unrelated thing faster.

## Engine notes

`rts.exe` is copied from the `rts` repo (gitignored). A few RTS-engine bugs were
found and **fixed in the engine itself** during development (prelude-shim name
clashes, module `const`/`let` read from functions, a codegen heisenbug worked
around by wrapping the frame loop in a `function`). Known engine gotchas the
codebase routes around:

- A string method on a **gcell** (a module-level `let`/array written by functions)
  returns `"undefined"` — string ops go through a param helper (`subStr`).
- A `number` field in `f64` repr passed to a `U64`/`I64` ABI param is **bitcast**,
  not converted — integer ids passed to the engine use `| 0`.
- A method on a **class-typed parameter** may not dispatch — the render pass
  extracts fields at the call site; pure math helpers avoid passing `app`/objects.
