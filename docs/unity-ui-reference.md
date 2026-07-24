# UI reference: Unity editor (dark theme) for replication

A practical reference for replicating the Unity editor's layout/UX in the rts-game
editor (TypeScript over an immediate-mode drawing backend: rectangles, text, colors
via `render.*`). px/%/hex values are approximations of the modern editor (~2021+).
Produced by dedicated research; it guides the UI foundation (the "everything is a
GameObject" work) and incremental polish.

## Implementation status in this editor

Already applied: the exact dark-theme palette (§6), the axis-colored Vector3
fields, component foldouts with an enabled checkbox (§4), gizmo tools with the
active-toggle-in-blue toolbar, and `Q/E/R/F` shortcuts. Remaining polish is tracked
by the priority list in §8.

---

## 1. Overall layout (docking)

```
┌───────────────────────────────────────────────────────────────┐
│ TOOLBAR (fixed height ~30px, full width)                       │
├──────────────┬────────────────────────────┬───────────────────┤
│  HIERARCHY   │      SCENE / GAME           │    INSPECTOR      │
│  (tree)      │      (3D viewport)          │    (components)   │
├──────────────┴────────────────────────────┤                   │
│  PROJECT (assets)   |  CONSOLE             │                   │
└───────────────────────────────────────────┴───────────────────┘
```

Docking = a tree of splits (H/V); each leaf is a dock with a stack of tabs. Splitter
~4-5px, draggable (resize cursor on hover). Dragging a tab shows blue drop zones.

### Proportions (screen 100% × 100%)

| Panel | Position | Width | Height |
|---|---|---|---|
| Toolbar | top, full | 100% | ~30px fixed |
| Hierarchy | left | ~15–18% | ~65% |
| Scene/Game | center | ~50–55% | ~65% |
| Inspector | right | ~20–25% | 100% − toolbar |
| Project + Console | bottom (left+center) | ~68% | ~35% |
| Status bar | bottom, full | 100% | ~20px fixed |

---

## 2. Toolbar (~30px) — 3 groups: left / center / right

- **Left — Tools** (icon buttons ~28×28, active toggled blue): Hand `Q`,
  Move `W`, Rotate `E`, Scale `R`, Rect `T`, Transform `Y`. + Pivot/Center and
  Local/Global toggles.
- **Center — Play** (centered): Play ▶ (blue in play mode, the whole UI gains a
  tint), Pause ❚❚, Step ▶❚.
- **Right:** Layers dropdown, Layout dropdown, global search.

## 3. Hierarchy

- Top: **"+ Create"** + a search field (magnifier, "Search...").
- Tree: row ~16–18px, indent ~14–16px/level, ▶/▼ triangle (if it has children),
  a type icon, name (inactive = dim).
- Selection: the whole row is **blue** (`#3A6C9F` when focused; gray when not).
  Ctrl+click multi, Shift+click range. Drag to reparent (insertion line / highlight);
  hovering a collapsed item ~0.7s expands it. Context menu (right-click).

## 4. Inspector

- Header (~40px): active checkbox + name; line 2: static + Tag + Layer.
- Each **component = foldout** header (~22px): ▼/▶ + enabled checkbox + icon +
  bold name + ⋮ (menu) + ?. Lighter header background; thin separator.
- Fields (row ~18–20px, label ~40% / control ~60%):
  - float/int: field + **scrubbable label** (drag ↔).
  - Vector3: **3 X/Y/Z fields** with label **X red, Y green, Z blue**.
  - bool: checkbox. enum: dropdown. Color: swatch → picker.
  - asset/Texture: **object slot** (thumbnail + name + ◎ picker).
- Footer: **"Add Component"** (nearly full width, ~24px) → popup with search.

## 5. Project / Assets (two columns)

- Left ~25%: folder tree. Right ~75%: tile grid (typed icon + truncated name),
  size adjustable via a slider (min = list).
- Top: "+ Create", breadcrumb (Assets > …), search + "t:" filter.
- Drag: tile → scene (instantiate/apply), → object slot (assign, blue border), →
  Hierarchy (add under a parent).

## 6. Palette — Dark Theme (CRUCIAL)

| Element | Hex | Use |
|---|---|---|
| Window background | `#1E1E1E` | viewport, gaps |
| Panel background | `#383838` | Inspector/Hierarchy/Project |
| Alt panel / toolbar | `#3C3C3C` | toolbar, headers |
| Tab bar | `#2D2D2D` | tab strip |
| Component header | `#414141` | foldout |
| Border / separator | `#232323` | dividers, splitters |
| Input field (bg) | `#2A2A2A` | text/number |
| Normal text | `#C4C4C4` | labels/values |
| Dim text | `#7E7E7E` | inactive/placeholder |
| **Selection (focused)** | `#3A6C9F` | selected row |
| Selection unfocused | `#4D4D4D` | — |
| Hover | `#454545` | highlight |
| Accent / Play | `#4C7EFF` | play mode, focus |
| Axis X | `#DB5343` | X label |
| Axis Y | `#8CBF3F` | Y label |
| Axis Z | `#3D7EDB` | Z label |
| Button | `#4A4A4A` / hover `#565656` / active `#5A7EA8` | — |

Rule of thumb: **3 grays** (`#1E1E1E` window, `#383838` panel, `#414141` header) +
**blue `#3A6C9F`** selection + **border `#232323`**.

## 7. "Professional" UX

- **Foldouts** everywhere (▼/▶, persisted state).
- **Numeric scrub on the label** (drag ↔, ~0.03–0.1/px; Shift faster, Ctrl finer)
  — **the #1 detail that feels like Unity**.
- Tooltips (hover ~0.5s, dark box). Consistent blue selection. Resize cursor on
  splitters. Context menus (right-click). Blue drop highlight.
- Shortcuts: `Q/W/E/R/T/Y` tools; `F` frame selected; `Ctrl+D` duplicate; `Delete`;
  `Ctrl+Z/Y`; `F2` rename; Alt+drag orbits, scroll zooms, right-drag looks, WASD flies.

## 8. Implementation priority (highest leverage → lowest)

1. **Exact dark-theme palette** (§6) — cheap, transforms perception. Highest leverage.
2. **Numeric scrub on the float labels** (↔).
3. **Axis-colored X/Y/Z Vector3** side by side.
4. **Components as foldouts** (▼ + checkbox + icon + name + ⋮).
5. **Consistent blue selection + hover** (Hierarchy/Project, unfocused state).
6. **Draggable splitters** with a resize cursor.
7. **"Add Component" with a search popup**.
8. **Center Play/Pause/Step + tools on the left** (blue toggle).
9. Generic foldouts + consistent indentation.
10. **Object slot with a picker** + drag Project→slot/scene (highlight).
11. **Context menus** (right-click) on the main items.
12. Shortcuts W/E/R/T + F + Ctrl+D + Delete + F2.

> **Items 1–5 alone ≈ 80% of the feel** for a fraction of the effort.
