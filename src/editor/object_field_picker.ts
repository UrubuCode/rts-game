// Seletor "Selecionar <Tipo>" do ObjectField estilo Unity (item 2 do brief de
// áudio-arquivos): lista plana de arquivos sob `assets/` filtrados por
// extensão, com "Nenhum" no topo e busca por texto. Mesmo padrão do
// ComponentPicker (widget independente: só devolve a escolha; a mutação e o
// Desfazer ficam no Inspector).
import { UI_C, UI_OBJECT_PICKER as P, UI_PICKER_KEYS as K } from "./ui_config";
import { Behavior, KIND_UI } from "@engine/core/behavior";
import { UIScene } from "@engine/ui/uiscene";
import { scanAssets, assetIndexVersion } from "./asset_index";
import { clockNow, clockSince, DOUBLE_CLICK_MS } from "../engine/core/clock";

import { caixa, estiloTexto, pincel, texto } from "@compat/draw2d.ts";
/// Sentinela devolvida quando o usuário escolhe "Nenhum" (distinto de "" =
/// "nada aconteceu neste quadro", o protocolo de retorno do ComponentPicker).
export const OBJECT_FIELD_NONE = "\u0001";

function baseName(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charCodeAt(i) !== 47) i = i - 1;
  return path.substring(i + 1);
}

export class ObjectFieldPicker extends Behavior {
  sceneIndex: number = 0;
  app: any;
  inMx: number = 0; inMy: number = 0; inPressed: number = 0; inWheel: number = 0;
  result: string = "";
  kind(): number { return KIND_UI; }
  typeName(): string { return "ObjectFieldPicker"; }
  /// Área do seletor (x, base, largura, topo) — chamar antes de `render`.
  place(x: number, bottom: number, width: number, top: number): void {
    this.host.px = x; this.host.py = top; this.host.sx = width; this.host.sy = bottom - top;
  }
  /// Mouse e roda do quadro — chamar antes de `render`.
  mouse(mx: number, my: number, pressed: number, wheel: number): void {
    this.inMx = mx; this.inMy = my; this.inPressed = pressed; this.inWheel = wheel;
  }
  render(scene: UIScene, app: any): string {
    this.app = app;
    this.result = "";
    scene.panels[this.sceneIndex].active = 1;
    scene.drawObject(this.sceneIndex, app._win, this.host.sx, this.host.sy);
    return this.result;
  }
  drawUI(win: i64, width: f64, height: f64): void {
    this.result = this.draw(this.app);
  }

  closed: boolean = false;
  query: string = "";
  root: string = P.root;
  exts: string[] = [];
  tipo: string = "";
  title: string = "";
  /// Última versão do índice já varrida (-1 = nunca): evita reler o disco toda
  /// vez que o seletor abre — só quando `assetIndexVersion()` mudou (Project
  /// rescan/`importar`).
  lastVersion: number = 0 - 1;
  files: string[] = [];
  names: string[] = [];
  matches: number[] = [];
  selected: number = 0;
  scroll: number = 0;
  mouseX: number = 0 - 1;
  mouseY: number = 0 - 1;
  /// Duplo-clique numa linha confirma (clique simples só seleciona) — mesma
  /// janela de tempo de parede do duplo-clique do Project (assets.ts).
  lastClickRow: number = 0 - 1;
  lastClickMs: f64 = 0.0 - 999999.0;

  /// Abre o seletor configurado para `exts`/`tipo` ("AudioClip"...). Refeito
  /// pelo Inspector a cada clique no botão ⊙ (idempotente: sem custo se o
  /// índice não mudou).
  begin(app: any, exts: string[], tipo: string): void {
    this.closed = false; this.query = ""; this.exts = exts; this.tipo = tipo;
    this.title = P.titlePrefix + tipo;
    this.rescanIfNeeded();
    this.refresh();
    this.selected = 0; this.scroll = 0;
    this.lastClickRow = 0 - 1; this.lastClickMs = 0.0 - 999999.0;
    app.setFocus(P.searchId);
  }
  rescanIfNeeded(): void {
    const v = assetIndexVersion();
    if (v === this.lastVersion) return;
    this.lastVersion = v;
    this.files = scanAssets(this.root, this.exts);
    const names: string[] = [];
    let i = 0;
    while (i < this.files.length) { names.push(baseName(this.files[i])); i = i + 1; }
    this.names = names;
  }
  refresh(): void {
    const q = this.query.toLowerCase();
    const rows: number[] = [];
    let i = 0;
    while (i < this.files.length) {
      if (q.length === 0 || this.names[i].toLowerCase().indexOf(q) >= 0) rows.push(i);
      i = i + 1;
    }
    this.matches = rows;
    const total = rows.length + 1;
    if (this.selected >= total) this.selected = total - 1;
  }
  move(dir: number, visible: number): void {
    const total = this.matches.length + 1;
    this.selected = Math.max(0, Math.min(total - 1, this.selected + dir));
    if (this.selected < this.scroll) this.scroll = this.selected;
    else if (this.selected >= this.scroll + visible) this.scroll = this.selected - visible + 1;
  }
  /// A escolha do índice `selected` (0 = "Nenhum").
  activate(): string {
    return this.selected === 0 ? OBJECT_FIELD_NONE : this.files[this.matches[this.selected - 1]];
  }
  fit(text: string, width: number): string {
    const chars = Math.max(1, (width / P.charW) | 0);
    return text.length <= chars ? text : text.substring(0, chars - 1) + "…";
  }
  draw(app: any): string {
    const x = this.host.px; const top = this.host.py; const width = this.host.sx; const bottom = top + this.host.sy;
    const mx = this.inMx; const my = this.inMy; const pressed = this.inPressed; const wheel = this.inWheel;
    // Layout do quadro (altura/linhas visíveis) a partir do total ATUAL — a
    // busca abaixo pode REDUZIR `matches` no mesmo quadro (refresh), e o laço
    // de linhas usa `total` de novo depois: sem reatualizar aqui, ele leria um
    // índice fora de `matches` (a lista encolheu, o laço não).
    let total = this.matches.length + 1;
    const chromeH = P.titleH + P.searchH + P.listGap + P.padding;
    const visible = Math.max(1, Math.min(P.maxRows, ((bottom - top - chromeH) / P.rowH) | 0));
    const height = chromeH + visible * P.rowH;
    const y = bottom - height;
    const pointerMoved = mx !== this.mouseX || my !== this.mouseY;
    this.mouseX = mx; this.mouseY = my;
    const inside = mx >= x && mx < x + width && my >= y && my < bottom;
    if (app.keyPressed(K.escape) !== 0 || (pressed !== 0 && !inside)) {
      this.closed = true;
      return "";
    }
    pincel(UI_C.popupDark, P.border, UI_C.menuPopupBorder, P.radius); caixa(x, y, width, height);
    texto(x + P.padding, y + P.textY, this.title, estiloTexto(UI_C.popupText, P.font));
    app.at(x + width - P.titleH, y + P.gap, P.buttonH, P.searchH);
    if (app.button("x")) {
      this.closed = true;
      return "";
    }
    const searchY = y + P.titleH;
    const previous = this.query;
    app.at(x + P.padding, searchY, width - P.padding * 2, 0);
    this.query = app.textField(P.searchId, previous, true);
    if (previous !== this.query) { this.refresh(); total = this.matches.length + 1; }
    if (this.query.length === 0) {
      texto(x + P.padding + P.gap * 2, searchY + P.border, this.fit(P.searchHint, width - P.padding * 2 - P.gap * 2), estiloTexto(UI_C.hint, P.smallFont));
    }
    if (app.keyPressed(K.down) !== 0) this.move(1, visible);
    if (app.keyPressed(K.up) !== 0) this.move(0 - 1, visible);
    if (app.keyPressed(K.enter) !== 0) {
      app.setFocus(P.searchId);
      return this.activate();
    }
    const listY = searchY + P.searchH + P.listGap;
    const listH = visible * P.rowH;
    const maxScroll = Math.max(0, total - visible);
    if (inside && my >= listY && my < listY + listH) {
      if (wheel > 0) this.scroll = this.scroll - 1;
      if (wheel < 0) this.scroll = this.scroll + 1;
    }
    this.scroll = Math.max(0, Math.min(maxScroll, this.scroll));
    let row = this.scroll;
    while (row < total && row < this.scroll + visible) {
      const rowY = listY + (row - this.scroll) * P.rowH;
      const status = app.clickable(x + P.border, rowY, width - P.border * 2, P.rowH);
      if (status !== 0 && (pointerMoved || status === 3)) this.selected = row;
      if (row === this.selected) {
        pincel(UI_C.popupHover, 0, 0, 0); caixa(x + P.border, rowY, width - P.border * 2, P.rowH);
      }
      const label = row === 0 ? P.none : this.names[this.matches[row - 1]];
      texto(x + P.padding, rowY + P.textY, this.fit(label, width - P.padding * 2), estiloTexto(UI_C.popupText, P.font));
      if (status === 3) {
        // clique simples SELECIONA; só o duplo-clique (ou Enter) CONFIRMA —
        // como a Unity, e como o duplo-clique do Project (mesma janela de tempo).
        const agora: f64 = clockNow();
        const dbl = row === this.lastClickRow && clockSince(this.lastClickMs) < DOUBLE_CLICK_MS;
        this.selected = row;
        this.lastClickRow = row; this.lastClickMs = agora;
        if (dbl) { app.setFocus(P.searchId); return this.activate(); }
      }
      row = row + 1;
    }
    if (total === 1 && this.query.length > 0) {
      texto(x + P.padding, listY + P.textY, this.fit(P.empty, width - P.padding * 2), estiloTexto(UI_C.emptyText, P.smallFont));
      texto(x + P.padding, listY + P.rowH, P.emptyHint, estiloTexto(UI_C.hint, P.smallFont));
    }
    if (maxScroll > 0) {
      const thumbH = listH * visible / total;
      const thumbY = listY + (listH - thumbH) * this.scroll / maxScroll;
      pincel(UI_C.scrollbarThumb, 0, 0, 0); caixa(x + width - P.scrollbarW - P.border, thumbY, P.scrollbarW, thumbH);
    }
    texto(x + P.padding, bottom - P.searchH, P.help, estiloTexto(UI_C.hint, P.smallFont));
    return "";
  }
}
