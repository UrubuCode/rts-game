# Driving & testing the editor — the control port

The editor embeds a **WebSocket control server** so a human and an AI can drive the
**same live editor** at the same time. This is the primary way to test and script
the engine without screenshots: send text commands, read text responses.

## WebSocket (primary — live, in-editor)

Run the editor; it serves `ws://127.0.0.1:7777`, polled once per frame
(non-blocking, so the window stays responsive while commands arrive):

```bash
rts.exe run main.ts                 # opens the editor window + the WS server
```

From another process, send commands (one per message):

```bash
python tools/ws_client.py "spawn box 0 1.5 0 1.2" "spin 0 1.0" "tool rotate" "state"
```

`tools/ws_control.html` is a small browser console for the same port.

### Discovering commands

The port is self-documenting — an AI can learn the full surface at runtime:

- `help` — one-line list of every command.
- `doc [prefix]` — signature **and an example** for each command (e.g. `doc select`).
- `state` — scene + camera + tool snapshot. `tree` — the hierarchy. `dbg` — render diagnostics.

There are **60+ commands**, grouped roughly as:

| Group | Commands |
|---|---|
| query | `state` `res` `help` `doc` `dbg` `tree` |
| history | `undo` `redo` |
| create/spawn | `spawn` `dup` `dupn` `loadobj` `instprefab` `makeprefab` |
| transform | `move` `scl` `reset` `align` `tool` `snap` |
| appearance | `mesh` `color` `spin` `loadtex` |
| selection | `select` `selectadd` `selectclear` `rename` `delete` `delsel` `vis` `iso` |
| camera | `cam` `focus` `frameall` `view` `light` |
| play | `play` `pause` `clear` |
| scene files | `loadscene` `savescene` `instscene` (scene-within-scene) |
| hierarchy | `parent` `movetree` `group` `ungroup` |
| components | `complist` `comps` `addcomp` `rmcomp` `setfield` |
| filesystem | `ls` `mkdir` `rmpath` `readfile` `writefile` `mv` |

Example session (AI-style, no screenshots needed):

```
select 1                # select object #1
selectadd 2             # multi-select #1 + #2
tool rotate             # switch the viewport gizmo tool
snap 1                  # snap-to-grid on
loadtex 0 images.jpg    # decode a real image and apply it as a Material texture
instscene assets/subscene.json 0   # instance a whole scene under object #0
savescene assets/my.json           # persists across restarts
```

Mutating commands snapshot the scene first, so `undo` / `redo` cover the whole
session.

## Legacy harnesses (headless / TCP)

Two older headless control ports remain for scripted, deterministic tests of the
software rasterizer (`engine/render/raster.ts`), independent of the GUI:

```bash
# stdin harness — deterministic (fixed 16 ms dt), pipe commands in
printf 'spawn a 0 1 0\nstep 5\nlit\nquit\n' | ./rts.exe run harness.ts
# expects: [lit] <N> pixels drawn ...  with N > 0

# TCP harness (:7777) — a live window that re-presents on each command
./rts.exe run netharness.ts
echo -e 'spawn a 0 1 0\nspin 0 1\nstep 30\nframe\nquit' | python tools/control_client.py
```

The harness protocol adds preview commands the WebSocket editor does not need:
`step [n]` (advance N update ticks), `frame [cols] [rows]` (ASCII preview of the
rasterized frame), `lit` (pixel count sanity), `save <path>` (PPM dump).

## Why a control port

A text control port gives a **scriptable channel** any tool (Bash, an AI) can
drive without image capture. The WebSocket variant keeps the window fully
responsive (polled per frame) so the AI and the human share one live editor; the
stdin/TCP harnesses stay for deterministic, GUI-free rasterizer tests.
