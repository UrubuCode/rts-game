# Referência de UI: Editor da Unity (dark theme) para replicação

Documento de referência prático para replicar o layout/UX do editor da Unity no
editor do rts-game (TypeScript sobre backend de desenho imediato: retângulos,
texto, cores via `render.*`). Valores em px/%/hex são aproximações do editor
moderno (~2021+). Gerado por pesquisa dedicada; serve de norte pra fundação de UI
(L3 "tudo é GameObject") e o polimento incremental.

---

## 1. Layout geral (docking)

```
┌───────────────────────────────────────────────────────────────┐
│ TOOLBAR (altura fixa ~30px, largura total)                     │
├──────────────┬────────────────────────────┬───────────────────┤
│  HIERARCHY   │      SCENE / GAME           │    INSPECTOR      │
│  (árvore)    │      (viewport 3D)          │    (componentes)  │
├──────────────┴────────────────────────────┤                   │
│  PROJECT (assets)   |  CONSOLE             │                   │
└───────────────────────────────────────────┴───────────────────┘
```

Docking = árvore de splits (H/V); cada folha é um dock com pilha de abas. Splitter
~4-5px arrastável (cursor de resize no hover). Arrastar aba mostra drop zones azuis.

### Proporções (tela 100% × 100%)

| Painel | Posição | Largura | Altura |
|---|---|---|---|
| Toolbar | topo, full | 100% | ~30px fixo |
| Hierarchy | esquerda | ~15–18% | ~65% |
| Scene/Game | centro | ~50–55% | ~65% |
| Inspector | direita | ~20–25% | 100% − toolbar |
| Project + Console | base (esq+centro) | ~68% | ~35% |
| Status bar | base, full | 100% | ~20px fixo |

---

## 2. Toolbar (~30px) — 3 grupos: esquerda / centro / direita

- **Esquerda — Tools** (botões-ícone ~28×28, toggle azul do ativo): Hand `Q`,
  Move `W`, Rotate `E`, Scale `R`, Rect `T`, Transform `Y`. + toggles Pivot/Center
  e Local/Global.
- **Centro — Play** (centralizado): Play ▶ (azul em play mode, UI toda ganha tint),
  Pause ❚❚, Step ▶❚.
- **Direita:** Layers dropdown, Layout dropdown, busca global.

## 3. Hierarchy

- Topo: **"+ Create"** + campo de busca (lupa, "Search...").
- Árvore: linha ~16–18px, indentação ~14–16px/nível, triângulo ▶/▼ (se tem filhos),
  ícone de tipo, nome (inativo = dim).
- Seleção: linha inteira **azul** (`#3A6C9F` c/ foco; cinza sem foco). Ctrl+click
  multi, Shift+click intervalo. Drag pra reparentar (linha de inserção / realce);
  segurar sobre fechado ~0.7s expande. Context menu (dir).

## 4. Inspector

- Cabeçalho (~40px): checkbox ativo + nome; linha 2: static + Tag + Layer.
- Cada **componente = foldout** header (~22px): ▼/▶ + checkbox enabled + ícone +
  nome negrito + ⋮ (menu) + ?. Fundo do header mais claro; separador fino.
- Campos (linha ~18–20px, label ~40% / controle ~60%):
  - float/int: campo + **label scrubbable** (arrasta ↔).
  - Vector3: **3 campos X/Y/Z** com label **X vermelho, Y verde, Z azul**.
  - bool: checkbox. enum: dropdown. Color: swatch → picker.
  - asset/Texture: **object slot** (miniatura + nome + ◎ picker).
- Rodapé: **"Add Component"** (largura quase total, ~24px) → popup com busca.

## 5. Project / Assets (duas colunas)

- Esquerda ~25%: árvore de pastas. Direita ~75%: grid de tiles (ícone tipado +
  nome truncado), tamanho ajustável por slider (mín = lista).
- Topo: "+ Create", breadcrumb (Assets > …), busca + filtro "t:".
- Drag: tile → cena (instancia/aplica), → object slot (atribui, borda azul), →
  Hierarchy (adiciona no parent).

## 6. Paleta — Dark Theme (CRUCIAL)

| Elemento | Hex | Uso |
|---|---|---|
| Fundo janela | `#1E1E1E` | viewport, gaps |
| Fundo painel | `#383838` | Inspector/Hierarchy/Project |
| Painel alt / toolbar | `#3C3C3C` | toolbar, headers |
| Barra de aba | `#2D2D2D` | faixa de abas |
| Header componente | `#414141` | foldout |
| Borda / separador | `#232323` | divisórias, splitters |
| Campo input (fundo) | `#2A2A2A` | text/number |
| Texto normal | `#C4C4C4` | labels/valores |
| Texto dim | `#7E7E7E` | inativos/placeholder |
| **Seleção (foco)** | `#3A6C9F` | linha selecionada |
| Seleção sem foco | `#4D4D4D` | — |
| Hover | `#454545` | realce |
| Accent / Play | `#4C7EFF` | play mode, foco |
| Eixo X | `#DB5343` | label X |
| Eixo Y | `#8CBF3F` | label Y |
| Eixo Z | `#3D7EDB` | label Z |
| Botão | `#4A4A4A` / hover `#565656` / ativo `#5A7EA8` | — |

Regra: **3 cinzas** (`#1E1E1E` janela, `#383838` painel, `#414141` header) + **azul
`#3A6C9F`** seleção + **borda `#232323`**.

## 7. UX "profissional"

- **Foldouts** everywhere (▼/▶, estado persistido).
- **Scrub numérico no label** (arrasta ↔, ~0.03–0.1/px; Shift acelera, Ctrl afina)
  — **o detalhe #1 que cheira a Unity**.
- Tooltips (hover ~0.5s, caixa escura). Seleção azul consistente. Cursor de resize
  nos splitters. Context menus (dir). Highlight de drop azul.
- Atalhos: `Q/W/E/R/T/Y` tools; `F` frame selected; `Ctrl+D` dup; `Delete`;
  `Ctrl+Z/Y`; `F2` rename; Alt+drag orbita, scroll zoom, dir look, WASD voa.

## 8. Prioridade de implementação (maior alavanca → menor)

1. **Paleta exata do dark theme** (§6) — barato, transforma a percepção. Maior alavanca.
2. **Scrub numérico no label** dos floats (↔).
3. **Vector3 X/Y/Z coloridos** lado a lado.
4. **Componentes como foldouts** (▼ + checkbox + ícone + nome + ⋮).
5. **Seleção azul + hover** consistentes (Hierarchy/Project, estado sem-foco).
6. **Splitters arrastáveis** com cursor de resize.
7. **"Add Component" com popup de busca**.
8. **Toolbar Play/Pause/Step central + tools à esquerda** (toggle azul).
9. Foldouts genéricos + indentação consistente.
10. **Object slot com picker** + drag Project→slot/cena (highlight).
11. **Context menus** (dir) nos itens principais.
12. Atalhos W/E/R/T + F + Ctrl+D + Delete + F2.

> **Itens 1–5 sozinhos ≈ 80% da sensação** com fração do esforço.
