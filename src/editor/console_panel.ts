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
  constructor(app: any) { super(); this.ui = new EditorUI(app, "Editor/Console"); this.ui.root.addBehavior(this); }
  kind(): number { return KIND_UI; }
  refresh(reset: boolean = true): void {
    const old = this.selected >= 0 && this.selected < this.rows.length ? this.rows[this.selected] : null;
    const oldCount = this.rows.length;
    const entries = logEntries(); this.rows = []; this.repeats = []; this.counts = [0, 0, 0]; this.selected = -1;
    const groups = new Map<string, number>(); const query = this.query.toLowerCase();
    let i = 0;
    while (i < entries.length) {
      const row = entries[i]; const level = row.level - LOG_INFO;
      if (level >= 0 && level < this.counts.length) {
        this.counts[level] = this.counts[level] + 1;
        if (this.show[level] && (row.message + " " + row.source).toLowerCase().indexOf(query) >= 0) {
          const key = entryKey(row); const existing = groups.get(key);
          if (this.collapse && existing !== undefined) this.repeats[existing] = this.repeats[existing] + 1;
          else { groups.set(key, this.rows.length); this.rows.push(row); this.repeats.push(1); }
        }
      }
      i = i + 1;
    }
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
  surface(name: string, x: number, y: number, w: number, h: number, color: number): void {
    const bg = this.ui.control(name, "surface", x, y, w, h, "", false); bg.fill = color; this.ui.draw(bg);
  }
  label(name: string, text: string, x: number, y: number, w: number, h: number, color: number): void {
    const label = this.ui.control(name, "label", x, y, w, h, text, false); label.color = color; this.ui.draw(label);
  }
  button(name: string, icon: string, label: string, x: number, y: number, w: number, active: boolean, blocked: boolean): EditorControl {
    const control = this.ui.control(name, "flat", x, y, w, L.buttonH, label, !blocked);
    control.icon = icon; control.fill = active ? UI_C.consoleActive : UI_C.consoleToolbar;
    control.color = UI_C.consoleText; this.ui.draw(control); return control;
  }
  render(x: number, y: number, w: number, h: number, blocked: boolean): void {
    this.ui.begin(0, 0, 0, 0);
    if (this.revision !== logRevision()) this.refresh(false);
    this.surface("Background", x, y, w, h, UI_C.consoleBackground);
    const narrow = w < L.narrowW; const toolbarH = narrow ? L.toolbarH * 2 : L.toolbarH;
    this.surface("Toolbar", x, y, w, toolbarH, UI_C.consoleToolbar);
    let left = x + L.gap; const top = y + (L.toolbarH - L.buttonH) / 2; let hint = "";
    const clear = this.button("Clear", "clear", L.clear, left, top, L.clearW, false, blocked);
    if (clear.clicked) { logClear(); this.refresh(); } if (clear.hot === 1) hint = L.clear;
    left = left + L.clearW + L.gap;
    const collapse = this.button("Collapse", "collapse", L.collapse, left, top, L.collapseW, this.collapse, blocked);
    if (collapse.clicked) { this.collapse = !this.collapse; this.refresh(); } if (collapse.hot === 1) hint = L.collapse;
    left = left + L.collapseW + L.gap;
    const follow = this.button("Follow", "follow", "", left, top, L.iconButtonW, this.follow, blocked);
    if (follow.clicked) { this.follow = !this.follow; if (this.follow) this.scroll = 0; } if (follow.hot === 1) hint = L.follow;
    left = left + L.iconButtonW + L.gap;
    const filterX = x + w - L.gap - L.counterW * this.show.length;
    const searchY = narrow ? top + L.toolbarH : top;
    let i = 0;
    while (i < this.show.length) {
      const filter = this.button("Level/" + i, L.icons[i], "" + this.counts[i], filterX + i * L.counterW, searchY, L.counterW - L.gap, this.show[i], blocked);
      if (filter.clicked) { this.show[i] = !this.show[i]; this.refresh(); }
      if (filter.hot === 1) hint = L.levels[i]; i = i + 1;
    }
    const searchX = narrow ? x + L.padding : left;
    const searchW = Math.max(L.iconButtonW, filterX - searchX - L.gap);
    const searchIcon = this.ui.control("SearchIcon", "icon", searchX + L.gap, searchY + (L.buttonH - L.iconSize) / 2, L.iconSize, L.iconSize, "", false);
    searchIcon.icon = "search"; this.ui.draw(searchIcon);
    const fieldX = searchX + L.iconSize + L.iconGap;
    const search = this.ui.control("Search", "text", fieldX, searchY, searchW - L.iconSize - L.iconGap, L.buttonH, "", !blocked);
    search.id = L.searchId; search.textValue = this.query; this.ui.draw(search);
    if (this.query !== search.textValue) { this.query = search.textValue; this.refresh(); }
    if (this.query.length === 0 && !this.ui.app.isFocused(L.searchId)) this.label("SearchHint", L.search, fieldX + L.gap, searchY, search.host.sx - L.gap, L.buttonH, UI_C.consoleMuted);
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
      const button = this.ui.control("Row/" + i, "row", x, rowsY + i * L.rowH, w - L.scrollbarW, L.rowH, row.message.split("\n")[0], !blocked);
      button.trailing = this.repeats[index] > 1 ? "×" + this.repeats[index] : "";
      button.icon = L.icons[row.level - LOG_INFO]; button.color = UI_C.consoleText;
      button.fill = this.selected === index ? UI_C.consoleSelected : index % 2 === 0 ? UI_C.consoleBackground : UI_C.consoleRowAlternate;
      this.ui.draw(button); if (button.clicked) { this.selected = index; this.detailScroll = 0; }
      i = i + 1;
    }
    if (this.rows.length === 0) this.label("Empty", this.query.length > 0 || !this.show[0] || !this.show[1] || !this.show[2] ? L.emptyFiltered : L.empty, x + L.padding, rowsY + L.padding, w - L.padding * 2, L.rowH, UI_C.consoleMuted);
    if (this.rows.length > visible && visible > 0) {
      const thumbH = Math.max(L.rowH, rowsH * visible / this.rows.length);
      const thumbY = rowsY + (rowsH - thumbH) * from / (this.rows.length - visible);
      this.surface("Scrollbar", x + w - L.scrollbarW, thumbY, L.scrollbarW, thumbH, UI_C.consoleScroll);
    }
    if (chosen !== null && detailH >= L.detailHeaderH) this.details(chosen, x, rowsY + rowsH, w, detailH, blocked, mx, my, wheel);
    const footerY = y + h - L.footerH;
    this.surface("Footer", x, footerY, w, L.footerH, UI_C.consoleToolbar);
    this.label("Status", hint.length > 0 ? hint : this.rows.length + L.count + "  ·  " + (this.follow ? L.hint : L.paused), x + L.padding, footerY, w - L.padding * 2, L.footerH, UI_C.consoleMuted);
    this.ui.end();
  }
  details(chosen: LogEntry, x: number, y: number, w: number, h: number, blocked: boolean, mx: number, my: number, wheel: number): void {
    this.surface("DetailBackground", x, y, w, h, UI_C.consoleDetail);
    this.surface("DetailDivider", x, y, w, L.border, UI_C.consoleBorder);
    this.label("DetailTitle", L.details, x + L.padding, y, w - L.collapseW, L.detailHeaderH, UI_C.consoleMuted);
    if (chosen.source.length > 0) {
      const open = this.button("Open", "", L.open, x + w - L.collapseW - L.padding, y, L.collapseW, false, blocked);
      if (open.clicked) this.editor.open(chosen.source, chosen.line);
    }
    const text = chosen.message + (chosen.source.length > 0 ? "\n" + chosen.source + ":" + chosen.line : "");
    const chars = Math.max(1, Math.floor((w - L.padding * 2) / L.charW)); const lines: string[] = [];
    const paragraphs = text.split("\n"); let i = 0;
    while (i < paragraphs.length) { let p = 0; do { lines.push(paragraphs[i].slice(p, p + chars)); p = p + chars; } while (p < paragraphs[i].length); i = i + 1; }
    const visible = Math.floor((h - L.detailHeaderH) / L.detailLineH);
    if (!blocked && mx >= x && mx < x + w && my >= y && my < y + h) this.detailScroll = this.detailScroll - Math.sign(wheel);
    this.detailScroll = Math.max(0, Math.min(Math.max(0, lines.length - visible), this.detailScroll));
    i = 0; while (i < visible && i + this.detailScroll < lines.length) {
      this.label("Detail/" + i, lines[i + this.detailScroll], x + L.padding, y + L.detailHeaderH + i * L.detailLineH, w - L.padding * 2, L.detailLineH, UI_C.consoleText);
      i = i + 1;
    }
  }
}
