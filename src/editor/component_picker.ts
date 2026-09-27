import { ComponentBrowser, COMPONENT_CATALOG, COMPONENT_CATEGORIES } from "./component_catalog";
import { UI_C, UI_COMPONENT_PICKER as P, UI_PICKER_KEYS as K } from "./ui_config";
import { Behavior, KIND_UI } from "@engine/core/behavior";
import { UIScene } from "@engine/ui/uiscene";

import { caixa, estiloTexto, linha, pincel, texto, traco } from "@compat/draw2d.ts";
// Widget independente: apenas devolve a chave escolhida; o editor faz a mutacao/undo.
export class ComponentPicker extends Behavior {
  sceneIndex: number = 0;
  app: any;
  // Mouse do quadro (de `mouse`), lido pelo `draw`: sem array por quadro.
  inMx: number = 0; inMy: number = 0; inPressed: number = 0; inWheel: number = 0;
  result: string = "";
  kind(): number { return KIND_UI; }
  typeName(): string { return "ComponentPicker"; }
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
  browser: ComponentBrowser = new ComponentBrowser();
  closed: boolean = false;
  mouseX: number = 0 - 1;
  mouseY: number = 0 - 1;

  begin(app: any): void {
    this.closed = false;
    this.browser.reset();
    app.setFocus(P.searchId);
  }

  fit(text: string, width: number): string {
    const chars = Math.max(1, (width / P.charW) | 0);
    return text.length <= chars ? text : text.substring(0, chars - 1) + "…";
  }

  // "Resultados (n)" / "< Categoria", refeito só quando muda (Task 10.5).
  crumbTexto: string = ""; crumbModo: number = 0 - 1; crumbN: number = 0 - 1; crumbCategoria: string = "";
  rotuloCaminho(searching: boolean, root: boolean): string {
    if (!searching && root) return P.root;
    const modo = searching ? 1 : 2; const n = this.browser.rows.length; const cat = this.browser.category;
    if (modo !== this.crumbModo || (modo === 1 && n !== this.crumbN) || (modo === 2 && cat !== this.crumbCategoria)) {
      this.crumbModo = modo; this.crumbN = n; this.crumbCategoria = cat;
      this.crumbTexto = modo === 1 ? P.resultsOpen + n + P.resultsClose : P.backMark + cat;
    }
    return this.crumbTexto;
  }
  draw(app: any): string {
    const x = this.host.px; const top = this.host.py; const width = this.host.sx; const bottom = top + this.host.sy;
    const mx = this.inMx; const my = this.inMy; const pressed = this.inPressed; const wheel = this.inWheel;
    const chromeH = P.titleH + P.searchH + P.gap + P.breadcrumbH + P.detailH + P.padding;
    const visible = Math.max(1, Math.min(P.maxRows, ((bottom - top - chromeH) / P.rowH) | 0));
    const height = chromeH + visible * P.rowH;
    const y = bottom - height;
    const pointerMoved = mx !== this.mouseX || my !== this.mouseY;
    this.mouseX = mx;
    this.mouseY = my;
    const inside = mx >= x && mx < x + width && my >= y && my < bottom;
    if (app.keyPressed(K.escape) !== 0 || (pressed !== 0 && !inside)) {
      this.closed = true;
      return "";
    }
    pincel(UI_C.popupDark, P.border, UI_C.menuPopupBorder, P.radius); caixa(x, y, width, height);
    texto(x + P.padding, y + P.textY, P.title, estiloTexto(UI_C.popupText, P.font));
    app.at(x + width - P.titleH, y + P.gap, P.buttonH, P.searchH);
    if (app.button("x")) {
      this.closed = true;
      return "";
    }
    const searchY = y + P.titleH;
    const previous = this.browser.query;
    app.at(x + P.padding, searchY, width - P.padding * 2, 0);
    this.browser.query = app.textField(P.searchId, previous, true);
    if (previous !== this.browser.query) this.browser.refresh();
    if (this.browser.query.length === 0) {
      texto(x + P.padding + P.gap * 2, searchY + P.border, this.fit(P.searchHint, width - P.padding * 2 - P.gap * 2), estiloTexto(UI_C.hint, P.smallFont));
    }
    const crumbY = searchY + P.searchH + P.gap;
    const root = this.browser.isRoot();
    const searching = this.browser.query.trim().length > 0;
    const crumb = this.rotuloCaminho(searching, root);
    texto(x + P.padding, crumbY + P.textY, crumb, estiloTexto(UI_C.primaryText, P.smallFont));
    if ((!root && app.clickable(x, crumbY, width, P.breadcrumbH) === 3) ||
        (!root && !searching && app.keyPressed(K.left) !== 0)) {
      this.browser.reset();
      app.setFocus(P.searchId);
      return "";
    }
    if (app.keyPressed(K.down) !== 0) this.browser.move(1, visible);
    if (app.keyPressed(K.up) !== 0) this.browser.move(0 - 1, visible);
    if (app.keyPressed(K.enter) !== 0 || (root && app.keyPressed(K.right) !== 0)) {
      const choice = this.browser.activate();
      app.setFocus(P.searchId);
      return choice;
    }
    const listY = crumbY + P.breadcrumbH;
    const listH = visible * P.rowH;
    const maxScroll = Math.max(0, this.browser.rows.length - visible);
    if (inside && my >= listY && my < listY + listH) {
      if (wheel > 0) this.browser.scroll = this.browser.scroll - 1;
      if (wheel < 0) this.browser.scroll = this.browser.scroll + 1;
    }
    this.browser.scroll = Math.max(0, Math.min(maxScroll, this.browser.scroll));
    let row = this.browser.scroll;
    while (row < this.browser.rows.length && row < this.browser.scroll + visible) {
      const index = this.browser.rows[row];
      const rowY = listY + (row - this.browser.scroll) * P.rowH;
      const status = app.clickable(x + P.border, rowY, width - P.border * 2, P.rowH);
      if (status !== 0 && (pointerMoved || status === 3)) this.browser.selected = row;
      if (row === this.browser.selected) {
        pincel(UI_C.popupHover, 0, 0, 0); caixa(x + P.border, rowY, width - P.border * 2, P.rowH);
      }
      const label = root ? COMPONENT_CATEGORIES[index] : COMPONENT_CATALOG[index].name;
      texto(x + P.padding, rowY + P.textY, this.fit(label, width - P.padding * 2 - P.rowH), estiloTexto(UI_C.popupText, P.font));
      texto(x + width - P.padding - P.charW, rowY + P.textY, root ? ">" : "+", estiloTexto(UI_C.hint, P.font));
      if (status === 3) {
        const clicked = this.browser.activate();
        app.setFocus(P.searchId);
        return clicked;
      }
      row = row + 1;
    }
    if (this.browser.rows.length === 0) {
      texto(x + P.padding, listY + P.textY, this.fit(P.empty, width - P.padding * 2), estiloTexto(UI_C.emptyText, P.smallFont));
      texto(x + P.padding, listY + P.rowH, P.emptyHint, estiloTexto(UI_C.hint, P.smallFont));
    }
    if (maxScroll > 0) {
      const thumbH = listH * visible / this.browser.rows.length;
      const thumbY = listY + (listH - thumbH) * this.browser.scroll / maxScroll;
      pincel(UI_C.scrollbarThumb, 0, 0, 0); caixa(x + width - P.scrollbarW - P.border, thumbY, P.scrollbarW, thumbH);
    }
    const detailY = listY + listH;
    traco(P.border, UI_C.border); linha(x, detailY, x + width, detailY);
    let detail = P.categoryHint;
    if (!root && this.browser.rows.length > 0) detail = COMPONENT_CATALOG[this.browser.rows[this.browser.selected]].description;
    const detailChars = Math.max(1, ((width - P.padding * 2) / P.charW) | 0);
    texto(x + P.padding, detailY + P.textY, detail.substring(0, detailChars), estiloTexto(UI_C.primaryText, P.smallFont));
    texto(x + P.padding, detailY + P.textY + P.searchH, detail.substring(detailChars), estiloTexto(UI_C.primaryText, P.smallFont));
    texto(x + P.padding, bottom - P.searchH, P.help, estiloTexto(UI_C.hint, P.smallFont));
    return "";
  }
}
