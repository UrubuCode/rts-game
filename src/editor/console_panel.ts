import { Behavior, KIND_UI } from "@engine/core/behavior";
import { logEntries, logClear, logRevision, LOG_INFO, LogEntry } from "@engine/core/logger";
import { EditorUI, EditorControl } from "./ui_controls";
import { ScriptEditor } from "./script_editor";
import { UI_CONSOLE as L, UI_C } from "./ui_config";
import input from "rts:input";

function entryKey(row: LogEntry): string { return JSON.stringify([row.level, row.message, row.source, row.line]); }
export class ConsolePanel extends Behavior {
  ui: EditorUI; editor: ScriptEditor = new ScriptEditor();
  query: string = ""; scroll: number = 0; detailScroll: number = 0;
  show: boolean[] = [true, true, true]; counts: number[] = [0, 0, 0];
  collapse: boolean = false; follow: boolean = true;
  rows: LogEntry[] = []; repeats: number[] = []; revision: number = -1; selected: number = -1;
  /// Entrada bloqueada neste quadro (menu/diálogo aberto) — escrito por quem chama `render`.
  blocked: boolean = false;
  // Rótulos e chaves refeitos só quando mudam (Task 10.5: sem string nova por quadro).
  rowTitles: string[] = []; rowTrailing: string[] = [];
  rowKeys: string[] = []; detailKeys: string[] = [];
  countLabels: string[] = ["0", "0", "0"]; countShown: number[] = [0, 0, 0];
  statusText: string = ""; statusRows: number = -1; statusFollow: boolean = false;
  detailId: number = -1; detailChars: number = -1; detailLines: string[] = [];
  constructor(app: any) { super(); this.ui = new EditorUI(app, "Editor/Console"); this.ui.root.addBehavior(this); }
  kind(): number { return KIND_UI; }
  refresh(reset: boolean = true): void {
    const old = this.selected >= 0 && this.selected < this.rows.length ? this.rows[this.selected] : null;
    const oldCount = this.rows.length;
    const entries = logEntries(); this.rows = []; this.repeats = []; this.rowTitles = []; this.rowTrailing = [];
    this.counts = [0, 0, 0]; this.selected = -1;
    const groups = new Map<string, number>(); const query = this.query.toLowerCase();
    let i = 0;
    while (i < entries.length) {
      const row = entries[i]; const level = row.level - LOG_INFO;
      if (level >= 0 && level < this.counts.length) {
        this.counts[level] = this.counts[level] + 1;
        if (this.show[level] && (row.message + " " + row.source).toLowerCase().indexOf(query) >= 0) {
          const key = entryKey(row); const existing = groups.get(key);
          if (this.collapse && existing !== undefined) this.repeats[existing] = this.repeats[existing] + 1;
          else { groups.set(key, this.rows.length); this.rows.push(row); this.repeats.push(1); this.rowTitles.push(row.message.split("\n")[0]); }
        }
      }
      i = i + 1;
    }
    i = 0;
    while (i < this.repeats.length) { this.rowTrailing.push(this.repeats[i] > 1 ? "×" + this.repeats[i] : ""); i = i + 1; }
    this.detailId = -1;
    if (old !== null) {
      i = 0; while (i < this.rows.length) {
        if (this.rows[i].id === old.id || (this.collapse && entryKey(this.rows[i]) === entryKey(old))) { this.selected = i; break; }
        i = i + 1;
      }
    }
    if (reset || this.follow) this.scroll = 0;
    else this.scroll = Math.max(0, this.scroll + this.rows.length - oldCount);
    if (reset || this.selected < 0) this.detailScroll = 0;
    this.revision = logRevision();
  }
  // ── controles com ≤ 4 parâmetros (Task 10.5: 5+ alocam por chamada no RTS) ──
  // O retângulo é o do `this.ui.at(x, y, w, h)` anterior.
  surface(name: string, color: number): void {
    const bg = this.ui.control(name, "surface", "", false); bg.fill = color; this.ui.draw(bg);
  }
  label(name: string, text: string, color: number): void {
    const label = this.ui.control(name, "label", text, false); label.color = color; this.ui.draw(label);
  }
  button(name: string, icon: string, label: string, active: boolean): EditorControl {
    const control = this.ui.control(name, "flat", label, !this.blocked);
    control.icon = icon; control.fill = active ? UI_C.consoleActive : UI_C.consoleToolbar;
    control.color = UI_C.consoleText; this.ui.draw(control); return control;
  }
  /// `lista[i]`, criando `prefixo + i` na primeira vez.
  chave(lista: string[], prefixo: string, i: number): string {
    while (lista.length <= i) lista.push(prefixo + lista.length);
    return lista[i];
  }
  /// Texto do rodapé (a dica do botão sob o mouse, ou a contagem), refeito só quando muda.
  status(hint: string): string {
    if (hint.length > 0) return hint;
    if (this.statusRows !== this.rows.length || this.statusFollow !== this.follow || this.statusText.length === 0) {
      this.statusRows = this.rows.length; this.statusFollow = this.follow;
      this.statusText = this.rows.length + L.count + "  ·  " + (this.follow ? L.hint : L.paused);
    }
    return this.statusText;
  }
  render(x: number, y: number, w: number, h: number): void {
    const blocked = this.blocked;
    this.ui.begin(0, 0, 0, 0);
    if (this.revision !== logRevision()) this.refresh(false);
    this.ui.at(x, y, w, h); this.surface("Background", UI_C.consoleBackground);
    const narrow = w < L.narrowW; const toolbarH = narrow ? L.toolbarH * 2 : L.toolbarH;
    this.ui.at(x, y, w, toolbarH); this.surface("Toolbar", UI_C.consoleToolbar);
    let left = x + L.gap; const top = y + (L.toolbarH - L.buttonH) / 2; let hint = "";
    this.ui.at(left, top, L.clearW, L.buttonH);
    const clear = this.button("Clear", "clear", L.clear, false);
    if (clear.clicked) { logClear(); this.refresh(); } if (clear.hot === 1) hint = L.clear;
    left = left + L.clearW + L.gap;
    this.ui.at(left, top, L.collapseW, L.buttonH);
    const collapse = this.button("Collapse", "collapse", L.collapse, this.collapse);
    if (collapse.clicked) { this.collapse = !this.collapse; this.refresh(); } if (collapse.hot === 1) hint = L.collapse;
    left = left + L.collapseW + L.gap;
    this.ui.at(left, top, L.iconButtonW, L.buttonH);
    const follow = this.button("Follow", "follow", "", this.follow);
    if (follow.clicked) { this.follow = !this.follow; if (this.follow) this.scroll = 0; } if (follow.hot === 1) hint = L.follow;
    left = left + L.iconButtonW + L.gap;
    const filterX = x + w - L.gap - L.counterW * this.show.length;
    const searchY = narrow ? top + L.toolbarH : top;
    let i = 0;
    while (i < this.show.length) {
      if (this.countShown[i] !== this.counts[i]) { this.countShown[i] = this.counts[i]; this.countLabels[i] = "" + this.counts[i]; }
      this.ui.at(filterX + i * L.counterW, searchY, L.counterW - L.gap, L.buttonH);
      const filter = this.button(L.levelKeys[i], L.icons[i], this.countLabels[i], this.show[i]);
      if (filter.clicked) { this.show[i] = !this.show[i]; this.refresh(); }
      if (filter.hot === 1) hint = L.levels[i]; i = i + 1;
    }
    const searchX = narrow ? x + L.padding : left;
    const searchW = Math.max(L.iconButtonW, filterX - searchX - L.gap);
    this.ui.at(searchX + L.gap, searchY + (L.buttonH - L.iconSize) / 2, L.iconSize, L.iconSize);
    const searchIcon = this.ui.control("SearchIcon", "icon", "", false);
    searchIcon.icon = "search"; this.ui.draw(searchIcon);
    const fieldX = searchX + L.iconSize + L.iconGap;
    this.ui.at(fieldX, searchY, searchW - L.iconSize - L.iconGap, L.buttonH);
    const search = this.ui.control("Search", "text", "", !blocked);
    search.id = L.searchId; search.textValue = this.query; this.ui.draw(search);
    if (this.query !== search.textValue) { this.query = search.textValue; this.refresh(); }
    if (this.query.length === 0 && !this.ui.app.isFocused(L.searchId)) {
      this.ui.at(fieldX + L.gap, searchY, search.host.sx - L.gap, L.buttonH);
      this.label("SearchHint", L.search, UI_C.consoleMuted);
    }
    const chosen = this.selected >= 0 && this.selected < this.rows.length ? this.rows[this.selected] : null;
    const detailH = chosen === null ? 0 : Math.min(L.detailH, Math.max(0, h - toolbarH - L.footerH - L.rowH));
    const rowsY = y + toolbarH; const rowsH = Math.max(0, h - toolbarH - L.footerH - detailH);
    const visible = Math.max(0, Math.floor(rowsH / L.rowH));
    const mx = input.mouseX(this.ui.app._win); const my = input.mouseY(this.ui.app._win); const wheel = input.wheel(this.ui.app._win);
    if (!blocked && mx >= x && mx < x + w && my >= rowsY && my < rowsY + rowsH && wheel !== 0) {
      this.scroll = this.scroll - Math.sign(wheel) * L.scrollStep; this.follow = false;
    }
    this.scroll = Math.max(0, Math.min(Math.max(0, this.rows.length - visible), this.scroll));
    const from = Math.max(0, this.rows.length - visible - this.scroll);
    i = 0;
    while (i < visible && from + i < this.rows.length) {
      const index = from + i; const row = this.rows[index];
      this.ui.at(x, rowsY + i * L.rowH, w - L.scrollbarW, L.rowH);
      const button = this.ui.control(this.chave(this.rowKeys, L.rowKey, i), "row", this.rowTitles[index], !blocked);
      button.trailing = this.rowTrailing[index];
      button.icon = L.icons[row.level - LOG_INFO]; button.color = UI_C.consoleText;
      button.fill = this.selected === index ? UI_C.consoleSelected : index % 2 === 0 ? UI_C.consoleBackground : UI_C.consoleRowAlternate;
      this.ui.draw(button); if (button.clicked) { this.selected = index; this.detailScroll = 0; }
      i = i + 1;
    }
    if (this.rows.length === 0) {
      this.ui.at(x + L.padding, rowsY + L.padding, w - L.padding * 2, L.rowH);
      this.label("Empty", this.query.length > 0 || !this.show[0] || !this.show[1] || !this.show[2] ? L.emptyFiltered : L.empty, UI_C.consoleMuted);
    }
    if (this.rows.length > visible && visible > 0) {
      const thumbH = Math.max(L.rowH, rowsH * visible / this.rows.length);
      const thumbY = rowsY + (rowsH - thumbH) * from / (this.rows.length - visible);
      this.ui.at(x + w - L.scrollbarW, thumbY, L.scrollbarW, thumbH); this.surface("Scrollbar", UI_C.consoleScroll);
    }
    if (chosen !== null && detailH >= L.detailHeaderH) { this.ui.at(x, rowsY + rowsH, w, detailH); this.details(chosen, mx, my, wheel); }
    const footerY = y + h - L.footerH;
    this.ui.at(x, footerY, w, L.footerH); this.surface("Footer", UI_C.consoleToolbar);
    this.ui.at(x + L.padding, footerY, w - L.padding * 2, L.footerH); this.label("Status", this.status(hint), UI_C.consoleMuted);
    this.ui.end();
  }
  /// Detalhes de `chosen` no retângulo do último `ui.at`.
  details(chosen: LogEntry, mx: number, my: number, wheel: number): void {
    const x = this.ui.atX; const y = this.ui.atY; const w = this.ui.atW; const h = this.ui.atH;
    this.surface("DetailBackground", UI_C.consoleDetail);
    this.ui.at(x, y, w, L.border); this.surface("DetailDivider", UI_C.consoleBorder);
    this.ui.at(x + L.padding, y, w - L.collapseW, L.detailHeaderH); this.label("DetailTitle", L.details, UI_C.consoleMuted);
    if (chosen.source.length > 0) {
      this.ui.at(x + w - L.collapseW - L.padding, y, L.collapseW, L.buttonH);
      const open = this.button("Open", "", L.open, false);
      if (open.clicked) this.editor.open(chosen.source, chosen.line);
    }
    const chars = Math.max(1, Math.floor((w - L.padding * 2) / L.charW));
    // As linhas só são refeitas quando a mensagem ou a largura mudam.
    if (this.detailId !== chosen.id || this.detailChars !== chars) {
      this.detailId = chosen.id; this.detailChars = chars;
      const text = chosen.message + (chosen.source.length > 0 ? "\n" + chosen.source + ":" + chosen.line : "");
      const novas: string[] = [];
      const paragraphs = text.split("\n"); let k = 0;
      while (k < paragraphs.length) { let p = 0; do { novas.push(paragraphs[k].slice(p, p + chars)); p = p + chars; } while (p < paragraphs[k].length); k = k + 1; }
      this.detailLines = novas;
    }
    const lines = this.detailLines;
    const visible = Math.floor((h - L.detailHeaderH) / L.detailLineH);
    if (!this.blocked && mx >= x && mx < x + w && my >= y && my < y + h) this.detailScroll = this.detailScroll - Math.sign(wheel);
    this.detailScroll = Math.max(0, Math.min(Math.max(0, lines.length - visible), this.detailScroll));
    let i = 0; while (i < visible && i + this.detailScroll < lines.length) {
      this.ui.at(x + L.padding, y + L.detailHeaderH + i * L.detailLineH, w - L.padding * 2, L.detailLineH);
      this.label(this.chave(this.detailKeys, L.detailKey, i), lines[i + this.detailScroll], UI_C.consoleText);
      i = i + 1;
    }
  }
}
