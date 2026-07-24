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

**Objects & hierarchy:** duplicate (single + **array** `dupn`, cloning all
components), rename, reset transform, hide/isolate, delete (single + selection),
**group / ungroup**, reparent.

**Scene:** save / load (and **persists across sessions**), **undo / redo**
(scene-snapshot), **scene-within-scene** instancing (Godot-style, via `SceneRef`),
**prefabs** (create + instantiate), a ground grid, camera view presets, light
control.

**Inspector (Unity dark theme):** component **foldouts** (collapse + enabled
checkbox), editable object name, per-field numeric config with click-to-type and
drag-scrub, **X/Y/Z colored** Vector3 fields, **Add Component** with search.

**Physics:** `Rigidbody` (gravity + ground collision + bounce) and
sphere-vs-sphere collision between objects (stacking).

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
