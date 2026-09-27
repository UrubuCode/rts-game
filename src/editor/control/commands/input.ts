// `input ...` — ENTRADA SIMULADA pela porta de controle: mouse, teclado e
// texto injetados no mesmo ponto que lê a entrada real (@compat/input), então
// a UI do editor, o gizmo, os menus, os campos do Inspector e o jogo em Play
// reagem como a um humano. Coordenadas em pixels lógicos da janela (os mesmos
// de `pickat`, `res` e das medidas da UI).
//
// A resposta é ADIADA até o último evento ter sido visto por um quadro inteiro
// (adiado.ts): `input click` seguido de `shot`/`state` na mesma conexão já vê
// o efeito do clique.
import { novoAdiado, RESPOSTA_ADIADA } from "@editor/control/adiado";
import { erroUso } from "@editor/control/builtin_commands";
import { argNum, argInt } from "@editor/control/args";
import {
  simMover, simApertar, simSoltar, simTeclaDesce, simTeclaSobe, simTexto, simRoda, simQuebra, simDesligar,
  simAtiva, simConcluida, simQuadro, simFilaTamanho, simEspacoLivre, simMouseX, simMouseY, simMouseDown,
  SIM_TECLA_CTRL, SIM_TECLA_SHIFT, SIM_TECLA_ALT, SIM_TECLAS,
} from "@compat/input_sim";

/// Quadros padrão de um `input drag` (o movimento é dividido neles).
export const INPUT_DRAG_QUADROS: number = 10;
/// Maior número de quadros de um arrasto.
export const INPUT_DRAG_MAX: number = 600;
/// Prazo base da resposta; cada quadro enfileirado soma `INPUT_PRAZO_QUADRO_MS`
/// (com vsync a 60 Hz um quadro é ~17 ms; a folga cobre um editor lento).
const INPUT_PRAZO_MS: number = 10000;
const INPUT_PRAZO_QUADRO_MS: number = 200;

// Códigos neutros de tecla (rts-input: 1-15 edição, 100-125 A-Z, 130-139 0-9,
// 140-151 F1-F12) e os modificadores simulados.
const NOMES_TECLA: string[] = ["enter", "esc", "escape", "space", "espaco", "backspace", "up", "down", "left", "right",
  "tab", "delete", "del", "insert", "home", "end", "pageup", "pagedown", "ctrl", "shift", "alt",
  "cima", "baixo", "esquerda", "direita"];
const CODIGOS_TECLA: number[] = [1, 2, 2, 3, 3, 4, 5, 6, 7, 8,
  9, 10, 10, 11, 12, 13, 14, 15, SIM_TECLA_CTRL, SIM_TECLA_SHIFT, SIM_TECLA_ALT,
  5, 6, 7, 8];
const CODIGO_A: number = 100;
const CODIGO_0: number = 130;
const CODIGO_F1: number = 140;
const F_MAX: number = 12;

/// Código neutro da tecla pelo nome ("w", "7", "f5", "enter", "ctrl"...) ou
/// pelo número; -1 se não reconhece.
export function codigoTecla(nome: string): number {
  const n = nome.toLowerCase();
  const i = NOMES_TECLA.indexOf(n);
  if (i >= 0) return CODIGOS_TECLA[i];
  if (n.length === 1) {
    const c = n.charCodeAt(0);
    if (c >= 97 && c <= 122) return CODIGO_A + (c - 97);   // a..z
    if (c >= 48 && c <= 57) return CODIGO_0 + (c - 48);    // 0..9
  }
  if (n.length >= 2 && n.charCodeAt(0) === 102) {         // f1..f12
    const k = Number(n.substring(1));
    if (k === Math.floor(k) && k >= 1 && k <= F_MAX) return CODIGO_F1 + k - 1;
  }
  const num = Number(n);
  if (n.length > 0 && num === Math.floor(num) && num >= 0 && num < SIM_TECLAS) return num;
  return 0 - 1;
}

/// Botão pelo nome (padrão esquerdo); -1 se não reconhece.
function botao(nome: string | undefined): number {
  if (nome === undefined || nome === "left" || nome === "esquerdo") return 0;
  if (nome === "right" || nome === "direito") return 1;
  if (nome === "middle" || nome === "meio") return 2;
  return 0 - 1;
}

function dentro(x: f64, y: f64, w: number, h: number): boolean {
  return x === x && y === y && x >= 0.0 && y >= 0.0 && x < w && y < h;
}

/// Adia a resposta até a fila simulada esvaziar e o último quadro terminar.
function esperar(resumo: string, quadros: number): string {
  const espera = novoAdiado("input", INPUT_PRAZO_MS + quadros * INPUT_PRAZO_QUADRO_MS);
  const q0 = simQuadro();
  espera.verificar = () => {
    if (simConcluida()) espera.concluir("[ok] input " + resumo + " | quadros=" + (simQuadro() - q0));
  };
  return RESPOSTA_ADIADA;
}

/// input [off] | mouse | click | drag | key | text | wheel
export function cmdInput(parts: string[], w: number, h: number, linha: string): string {
  if (parts.length === 1) {
    return "[input] simulada=" + (simAtiva() ? "sim" : "nao") + " fila=" + simFilaTamanho() + " mouse=(" +
      simMouseX() + "," + simMouseY() + ") esquerdo=" + (simMouseDown(0) ? "apertado" : "solto") + " quadro=" + simQuadro();
  }
  const sub = parts[1];
  if (sub === "off") { simDesligar(); return "[ok] input off (entrada real)"; }
  if (simEspacoLivre() < INPUT_DRAG_MAX * 2 + 16) return "[erro] input: fila de eventos cheia; espere as respostas anteriores";
  if (sub === "mouse" || sub === "click") {
    const x = argNum(parts, 2); const y = argNum(parts, 3);
    if (!dentro(x, y, w, h)) return erroUso("input") + " (x y dentro da janela " + w + "x" + h + ")";
    if (sub === "click") {
      if (parts.length > 5) return erroUso("input");
      const b = botao(parts[4]);
      if (b < 0) return erroUso("input") + " (botao left|right|middle)";
      simMover(x, y); simQuebra(); simApertar(b); simQuebra(); simSoltar(b); simQuebra();
      return esperar("click " + x + " " + y, 3);
    }
    if (parts.length === 4) { simMover(x, y); simQuebra(); return esperar("mouse " + x + " " + y, 1); }
    const acao = parts[4];
    const b = botao(parts[5]);
    if (parts.length > 6 || (acao !== "down" && acao !== "up") || b < 0) return erroUso("input");
    simMover(x, y); simQuebra();
    if (acao === "down") simApertar(b); else simSoltar(b);
    simQuebra();
    return esperar("mouse " + x + " " + y + " " + acao, 2);
  }
  if (sub === "drag") {
    const x0 = argNum(parts, 2); const y0 = argNum(parts, 3); const x1 = argNum(parts, 4); const y1 = argNum(parts, 5);
    if (!dentro(x0, y0, w, h) || !dentro(x1, y1, w, h)) return erroUso("input") + " (pontos dentro da janela " + w + "x" + h + ")";
    const n = parts.length > 6 ? argInt(parts, 6) : INPUT_DRAG_QUADROS;
    if (parts.length > 7 || !(n >= 1 && n <= INPUT_DRAG_MAX)) return erroUso("input") + " (quadros inteiro 1.." + INPUT_DRAG_MAX + ")";
    simMover(x0, y0); simQuebra(); simApertar(0); simQuebra();
    let k = 1;
    while (k <= n) {
      const f = k / n;
      simMover(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f); simQuebra();
      k = k + 1;
    }
    simSoltar(0); simQuebra();
    return esperar("drag " + x0 + " " + y0 + " -> " + x1 + " " + y1, n + 3);
  }
  if (sub === "key") {
    const c = parts.length > 2 ? codigoTecla(parts[2]) : 0 - 1;
    const acao = parts.length > 3 ? parts[3] : "press";
    if (c < 0 || parts.length > 4 || (acao !== "down" && acao !== "up" && acao !== "press")) {
      return erroUso("input") + " (tecla: a-z, 0-9, f1-f12, " + NOMES_TECLA.join(", ") + " ou codigo)";
    }
    if (acao === "down" || acao === "press") { simTeclaDesce(c); simQuebra(); }
    if (acao === "up" || acao === "press") { simTeclaSobe(c); simQuebra(); }
    return esperar("key " + parts[2] + " " + acao, 2);
  }
  if (sub === "text") {
    const prefixo = "input text ";
    const t = linha.length > prefixo.length ? linha.substring(prefixo.length) : "";
    if (t.length === 0) return erroUso("input") + " (texto)";
    simTexto(t); simQuebra();
    return esperar("text " + t.length + " caracteres", 1);
  }
  if (sub === "wheel") {
    const d = argNum(parts, 2);
    if (d !== d || parts.length > 3) return erroUso("input");
    simRoda(d); simQuebra();
    return esperar("wheel " + d, 1);
  }
  return erroUso("input");
}
