import { ComponentBrowser, COMPONENT_CATALOG, COMPONENT_CATEGORIES } from "./component_catalog";
import { UI_C, UI_COMPONENT_PICKER as P, UI_PICKER_KEYS as K } from "./ui_config";

// Widget independente: apenas devolve a chave escolhida; o editor faz a mutacao/undo.
export class ComponentPicker {
  browser: ComponentBrowser = new ComponentBrowser();
  closed: boolean = false;

  begin(app: any): void {
    this.closed = false;
    this.browser.reset();
    app.setFocus(P.searchId);
  }

  fit(text: string, width: number): string {
    const chars = Math.max(1, (width / P.charW) | 0);
    return text.length <= chars ? text : text.substring(0, chars - 1) + "…";
  }

  draw(app: any, x: number, bottom: number, width: number, top: number,
       mx: number, my: number, pressed: number, wheel: number): string {
    const chromeH = P.titleH + P.searchH + P.gap + P.breadcrumbH + P.detailH + P.padding;
    const visible = Math.max(1, Math.min(P.maxRows, ((bottom - top - chromeH) / P.rowH) | 0));
    const height = chromeH + visible * P.rowH;
    const y = bottom - height;
    const inside = mx >= x && mx < x + width && my >= y && my < bottom;
    if (app.keyPressed(K.escape) !== 0 || (pressed !== 0 && !inside)) {
      this.closed = true;
      return "";
    }
    app.box(x, y, width, height, UI_C.popupDark, P.border, UI_C.menuPopupBorder, P.radius);
    app.text(x + P.padding, y + P.textY, P.title, UI_C.popupText, P.font);
    if (app.button(x + width - P.titleH, y + P.gap, P.buttonH, P.searchH, "x")) {
      this.closed = true;
      return "";
    }
    const searchY = y + P.titleH;
    const previous = this.browser.query;
    this.browser.query = app.textField(P.searchId, x + P.padding, searchY, width - P.padding * 2, previous, true);
    if (previous !== this.browser.query) this.browser.refresh();
    if (this.browser.query.length === 0 && !app.isFocused(P.searchId)) {
      app.text(x + P.padding + P.gap, searchY + P.border, P.searchHint, UI_C.hint, P.smallFont);
    }
    const crumbY = searchY + P.searchH + P.gap;
    const root = this.browser.isRoot();
    const searching = this.browser.query.trim().length > 0;
    const crumb = searching ? "Resultados (" + this.browser.rows.length + ")" : root ? P.root : "< " + this.browser.category;
    app.text(x + P.padding, crumbY + P.textY, crumb, UI_C.primaryText, P.smallFont);
    if ((!root && app.clickable(P.closeId, x, crumbY, width, P.breadcrumbH) === 3) ||
        (!root && !app.isFocused(P.searchId) && app.keyPressed(K.left) !== 0)) {
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
      const status = app.clickable(P.rowId + row, x + P.border, rowY, width - P.border * 2, P.rowH);
      if (status !== 0 || row === this.browser.selected) {
        app.box(x + P.border, rowY, width - P.border * 2, P.rowH, UI_C.popupHover, 0, 0, 0);
      }
      const label = root ? COMPONENT_CATEGORIES[index] : COMPONENT_CATALOG[index].name;
      app.text(x + P.padding, rowY + P.textY, this.fit(label, width - P.padding * 2 - P.rowH), UI_C.popupText, P.font);
      app.text(x + width - P.padding - P.charW, rowY + P.textY, root ? ">" : "+", UI_C.hint, P.font);
      if (status !== 0) this.browser.selected = row;
      if (status === 3) {
        const clicked = this.browser.activate();
        app.setFocus(P.searchId);
        return clicked;
      }
      row = row + 1;
    }
    if (this.browser.rows.length === 0) {
      app.text(x + P.padding, listY + P.textY, this.fit(P.empty, width - P.padding * 2), UI_C.emptyText, P.smallFont);
      app.text(x + P.padding, listY + P.rowH, P.emptyHint, UI_C.hint, P.smallFont);
    }
    if (maxScroll > 0) {
      const thumbH = listH * visible / this.browser.rows.length;
      const thumbY = listY + (listH - thumbH) * this.browser.scroll / maxScroll;
      app.box(x + width - P.scrollbarW - P.border, thumbY, P.scrollbarW, thumbH, UI_C.scrollbarThumb, 0, 0, 0);
    }
    const detailY = listY + listH;
    app.line(x, detailY, x + width, detailY, P.border, UI_C.border);
    let detail = P.categoryHint;
    if (!root && this.browser.rows.length > 0) detail = COMPONENT_CATALOG[this.browser.rows[this.browser.selected]].description;
    const detailChars = Math.max(1, ((width - P.padding * 2) / P.charW) | 0);
    app.text(x + P.padding, detailY + P.textY, detail.substring(0, detailChars), UI_C.primaryText, P.smallFont);
    app.text(x + P.padding, detailY + P.textY + P.searchH, detail.substring(detailChars), UI_C.primaryText, P.smallFont);
    app.text(x + P.padding, bottom - P.searchH, P.help, UI_C.hint, P.smallFont);
    return "";
  }
}
