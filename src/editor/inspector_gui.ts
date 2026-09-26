// Implementação do InspectorUI no editor: cada chamada vira um controle da
// UIScene do Inspector, com chave "<componente>/GUI/<ordem>" (única na janela) e
// as medidas de UI_INSPECTOR. Mudanças de valor tiram o snapshot de Desfazer do
// Inspector antes de devolver o valor novo.
//
// Sem string nova por frame: a chave de cada controle e o texto que ele mostra
// ("Rótulo: valor", "#RRGGBB") ficam num "slot" por (componente, ordem) e só
// são refeitos quando o rótulo ou o valor mudam.
import { InspectorUI } from "@engine/core/inspector_ui";
import type { Behavior } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import type { Inspector } from "./inspector";
import { scene, S } from "./control/session";
import { definirPoseDeMundo } from "@engine/core/pose";
import { corHex, lerCorHex } from "@engine/core/cor";
import { UI_INSPECTOR as L, UI_INSPECTOR_GUI as G } from "./ui_config";

export function indiceDoCampo(c: Behavior, nome: string): number {
  let i = 0; let achado = 0 - 1;
  while (i < c.fieldCount() && achado < 0) { if (c.fieldName(i) === nome) achado = i; i = i + 1; }
  return achado;
}

export class InspectorGUIEditor extends InspectorUI {
  insp: Inspector; comp: Behavior | null; chave: string; y: number; seq: number; pose: Float64Array;
  /// Chave de componente ("Components/0") de cada lista de slots.
  prefixos: string[];
  /// Slots de cada prefixo, na ordem das chamadas.
  slots: number[][];
  lista: number;
  slot: number;
  /// Por slot: chave do controle, texto mostrado e de onde ele veio.
  slotChave: string[]; slotTexto: string[]; slotRotulo: string[]; slotSufixo: string[]; slotNum: number[];
  constructor(insp: Inspector) {
    super(); this.insp = insp; this.comp = null; this.chave = ""; this.y = 0; this.seq = 0; this.pose = new Float64Array(5);
    this.prefixos = []; this.slots = []; this.lista = 0; this.slot = 0;
    this.slotChave = []; this.slotTexto = []; this.slotRotulo = []; this.slotSufixo = []; this.slotNum = [];
  }
  begin(comp: Behavior, chave: string, y: number): void {
    this.comp = comp; this.chave = chave; this.y = y; this.seq = 0; this.usos = 0;
    let i = this.prefixos.indexOf(chave);
    if (i < 0) { this.prefixos.push(chave); this.slots.push([]); i = this.prefixos.length - 1; }
    this.lista = i;
  }
  proxima(): string {
    const lista = this.slots[this.lista];
    if (this.seq >= lista.length) {
      this.slotChave.push(this.chave + G.guiKey + this.seq);
      this.slotTexto.push(""); this.slotRotulo.push(""); this.slotSufixo.push(""); this.slotNum.push(0 - 1);
      lista.push(this.slotChave.length - 1);
    }
    this.slot = lista[this.seq];
    this.seq = this.seq + 1; this.usos = this.usos + 1;
    return this.slotChave[this.slot];
  }
  /// `rotulo + meio + sufixo`, refeito só quando o rótulo ou o sufixo mudam
  /// (`meio` é sempre uma constante de UI_INSPECTOR_GUI).
  texto(rotulo: string, meio: string, sufixo: string): string {
    const k = this.slot;
    if (this.slotRotulo[k] !== rotulo || this.slotSufixo[k] !== sufixo) {
      this.slotRotulo[k] = rotulo; this.slotSufixo[k] = sufixo; this.slotTexto[k] = rotulo + meio + sufixo;
    }
    return this.slotTexto[k];
  }
  /// "Rótulo: 12.3", refeito só quando o rótulo ou o valor mudam.
  textoValor(rotulo: string, valor: number): string {
    const k = this.slot;
    if (this.slotRotulo[k] !== rotulo || this.slotNum[k] !== valor) {
      this.slotRotulo[k] = rotulo; this.slotNum[k] = valor;
      this.slotTexto[k] = rotulo + G.valueSeparator + valor.toFixed(G.digits);
    }
    return this.slotTexto[k];
  }
  /// "#RRGGBB" de `rgb`, refeito só quando a cor muda.
  textoCor(rgb: number): string {
    const k = this.slot;
    if (this.slotNum[k] !== rgb || this.slotTexto[k].length === 0) { this.slotNum[k] = rgb; this.slotTexto[k] = corHex(rgb); }
    return this.slotTexto[k];
  }
  colunaX(): number { return this.insp.x + L.padding + L.gap; }
  colunaW(): number { return this.insp.width - L.padding * 2 - L.gap; }
  field(nome: string): void {
    const k = this.proxima();
    const c = this.comp as Behavior;
    const i = indiceDoCampo(c, nome);
    if (i < 0) this.insp.label(k, this.y, this.texto(G.unknownField, "", nome));
    else if (this.insp.visible(this.y, L.rowH)) this.insp.fieldRow(c, this.chave, i, this.y);
    this.y = this.y + L.rowH;
  }
  label(texto: string): void { const k = this.proxima(); this.insp.label(k, this.y, texto); this.y = this.y + L.rowH; }
  button(rotulo: string): boolean {
    const k = this.proxima(); let clicado = false;
    if (this.insp.visible(this.y, L.rowH)) {
      const b = this.insp.ui.control(k, "button", this.colunaX(), this.y, this.colunaW(), L.rowH, rotulo, this.insp.enabledInput);
      this.insp.ui.draw(b); clicado = b.clicked;
    }
    this.y = this.y + L.rowH;
    return clicado;
  }
  toggle(rotulo: string, valor: boolean): boolean {
    const k = this.proxima(); let novo = valor;
    if (this.insp.visible(this.y, L.rowH)) {
      const t = this.insp.ui.control(k, "toggle", this.colunaX(), this.y, this.colunaW(), L.rowH, rotulo, this.insp.enabledInput);
      t.value = valor ? 1 : 0; this.insp.ui.draw(t);
      if ((t.value !== 0) !== valor) { this.insp.snapshot(); novo = t.value !== 0; }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  slider(rotulo: string, valor: number, min: number, max: number): number {
    const k = this.proxima(); let novo = valor;
    if (this.insp.visible(this.y, L.rowH) && max > min) {
      const s = this.insp.ui.control(k, "timeline", this.colunaX(), this.y, this.colunaW(), L.rowH,
        this.textoValor(rotulo, valor), this.insp.enabledInput);
      s.value = (valor - min) / (max - min);
      this.insp.ui.draw(s);
      if (s.hot !== 0) {
        const v = min + s.value * (max - min);
        if (v !== valor) { this.insp.snapshot(); novo = v; }
      }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  color(rotulo: string, rgb: number): number {
    const k = this.proxima(); let novo = rgb;
    if (this.insp.visible(this.y, L.rowH)) {
      const f = this.insp.ui.control(k, "propertyText", this.colunaX(), this.y, this.colunaW(), L.rowH, rotulo, this.insp.enabledInput);
      const antes = this.textoCor(rgb);
      f.textValue = antes; this.insp.ui.draw(f);
      if (f.textValue !== antes) {
        const lida = lerCorHex(f.textValue);
        if (lida >= 0 && lida !== rgb) { this.insp.snapshot(); novo = lida; }
      }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  dropdown(rotulo: string, opcoes: string[], indice: number): number {
    const k = this.proxima(); let novo = indice;
    if (this.insp.visible(this.y, L.rowH) && opcoes.length > 0) {
      const b = this.insp.ui.control(k, "button", this.colunaX(), this.y, this.colunaW(), L.rowH,
        this.texto(rotulo, G.valueSeparator, opcoes[indice]), this.insp.enabledInput);
      this.insp.ui.draw(b);
      if (b.clicked) { this.insp.snapshot(); novo = (indice + 1) % opcoes.length; }
    }
    this.y = this.y + L.rowH;
    return novo;
  }
  alterar(): void { this.insp.snapshot(); }
  alinharComVista(o: GameObject | null): void {
    if (o === null) return;
    this.insp.snapshot();
    this.pose[0] = S.camX; this.pose[1] = S.camY; this.pose[2] = S.camZ; this.pose[3] = S.camYaw; this.pose[4] = S.camPitch;
    definirPoseDeMundo(scene, o, this.pose);
  }
}
