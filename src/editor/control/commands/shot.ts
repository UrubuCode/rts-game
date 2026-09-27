// `shot` — o editor captura a PRÓPRIA janela num PNG, e `shot diff` compara
// duas capturas. É o "ver" do agente: descreve → muda → shot → diff.
//
// FASE A (esta): o runtime não tem leitura do framebuffer exposta ao TS, então
// a captura é o `tools/shot.ps1` (PrintWindow) disparado como processo filho,
// com o PID do editor — nunca outra janela nem a tela. A resposta é adiada
// (adiado.ts): o PrintWindow manda WM_PRINT para a janela do editor, e quem a
// atende é o laço de quadros, que tem de continuar rodando enquanto o
// PowerShell espera. Um `spawnSync` aqui travaria os dois.
//
// FASE B (pendente, no runtime `rts`): `captureWindow(win, x, y, w, h)` →
// RGBA do último quadro apresentado, mais um codificador PNG. Ver o relatório
// controle-ia-lote2-report.md.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import nodeProcess from "node:process";
import fs from "@compat/fs.ts";
import { S } from "@editor/control/session";
import { erroUso } from "@editor/control/builtin_commands";
import { argInt } from "@editor/control/args";
import { novoAdiado, RESPOSTA_ADIADA } from "@editor/control/adiado";
import { decodePNG } from "@engine/render/png";

/// Pasta padrão das capturas (fora do versionamento, como os builds).
export const SHOT_PASTA: string = "build/shots";
const SHOT_SCRIPT: string = "tools/shot.ps1";
/// O PowerShell sobe em ~1 s; a captura em si é instantânea.
const SHOT_PRAZO_MS: number = 20000;
/// Maior lado aceito por `shot diff` (proteção contra arquivo corrompido).
const DIFF_MAX_PIXELS: number = 16384;
export const SHOT_MODO_JANELA: string = "janela";
export const SHOT_MODO_JOGO: string = "jogo";

// O processo filho fica numa variável de MÓDULO enquanto os eventos chegam
// (CLAUDE.md: processos nativos referenciados durante eventos).
let filho: any = null;

function terminaCom(s: string, suf: string): boolean {
  return s.length >= suf.length && s.substring(s.length - suf.length).toLowerCase() === suf;
}

/// Caminho padrão: build/shots/shot-<ms>.png (único por captura).
export function caminhoPadraoShot(): string {
  return SHOT_PASTA + "/shot-" + Date.now() + ".png";
}

/// shot [caminho.png] [janela|jogo] | shot diff <a.png> <b.png> [tolerancia]
export function cmdShot(parts: string[], w: number, h: number): string {
  if (parts.length > 1 && parts[1] === "diff") return cmdShotDiff(parts);
  let caminho = "";
  let modo = SHOT_MODO_JANELA;
  let i = 1;
  while (i < parts.length) {
    const a = parts[i];
    if (a === SHOT_MODO_JANELA || a === SHOT_MODO_JOGO) modo = a;
    else if (a.length > 0 && caminho.length === 0 && terminaCom(a, ".png")) caminho = a;
    else if (a.length > 0) return erroUso("shot") + (terminaCom(a, ".png") ? " (mais de um caminho: '" + a + "')" : " ('" + a + "' nao e caminho .png nem janela|jogo)");
    i = i + 1;
  }
  if (caminho.length === 0) caminho = caminhoPadraoShot();
  if (filho !== null) return "[erro] shot: outra captura em andamento";
  const absoluto = resolve(caminho);
  const args: string[] = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", resolve(SHOT_SCRIPT), "-ProcessId", "" + nodeProcess.pid, "-Saida", absoluto];
  if (modo === SHOT_MODO_JOGO) {
    const r = S.areaVista;
    if (!(r[2] > 0.0 && r[3] > 0.0)) return "[erro] shot jogo: a vista ainda nao foi desenhada";
    args.push("-Recorte"); args.push(Math.round(r[0]) + "," + Math.round(r[1]) + "," + Math.round(r[2]) + "," + Math.round(r[3]));
    args.push("-LarguraLogica"); args.push("" + w);
  }
  return iniciarCaptura(caminho, args);
}

/// Dispara o PowerShell (numa função própria por causa do `try`).
function iniciarCaptura(caminho: string, args: string[]): string {
  const espera = novoAdiado("shot", SHOT_PRAZO_MS);
  let saida = "";
  try {
    const c = spawn("powershell.exe", args, { windowsHide: true });
    filho = c;
    c.on("error", (e: any) => { filho = null; espera.concluir("[erro] shot: powershell nao iniciou: " + String(e)); });
    if (c.stdout !== null && c.stdout !== undefined) c.stdout.on("data", (d: any) => { saida = saida + d.toString(); });
    c.on("exit", (codigo: any) => {
      filho = null;
      const linha = saida.trim();
      if (codigo === 0 && linha.indexOf("ok ") === 0) espera.concluir("[ok] " + caminho + " " + linha.substring(3));
      else espera.concluir("[erro] shot: " + (linha.length > 0 ? linha : "captura falhou (codigo " + codigo + ")"));
    });
  } catch (e) {
    filho = null;
    return "[erro] shot: " + String(e);
  }
  return RESPOSTA_ADIADA;
}

/// Resultado de `compararPNG`: pixels diferentes e o retângulo que os contém.
export class DiffImagem {
  largura: number = 0; altura: number = 0;
  diferentes: number = 0;
  x0: number = 0; y0: number = 0; x1: number = 0 - 1; y1: number = 0 - 1;
  erro: string = "";
  percentual(): f64 { const n = this.largura * this.altura; return n > 0 ? this.diferentes * 100.0 / n : 0.0; }
}

/// Compara dois PNG pixel a pixel: um pixel conta como diferente quando algum
/// canal (RGBA) difere mais que `tolerancia` (0..255).
export function compararPNG(a: string, b: string, tolerancia: number): DiffImagem {
  const out = new DiffImagem();
  if (!fs.exists(a)) { out.erro = "nao existe: " + a; return out; }
  if (!fs.exists(b)) { out.erro = "nao existe: " + b; return out; }
  const ia = decodificar(a, out); if (ia === null) return out;
  const ib = decodificar(b, out); if (ib === null) return out;
  if (ia.width !== ib.width || ia.height !== ib.height) {
    out.erro = "tamanhos diferentes: " + ia.width + "x" + ia.height + " e " + ib.width + "x" + ib.height;
    return out;
  }
  out.largura = ia.width; out.altura = ia.height;
  const pa = ia.pixels; const pb = ib.pixels;
  let y = 0;
  while (y < ia.height) {
    let x = 0;
    while (x < ia.width) {
      const k = (y * ia.width + x) * 4;
      if (Math.abs(pa[k] - pb[k]) > tolerancia || Math.abs(pa[k + 1] - pb[k + 1]) > tolerancia ||
          Math.abs(pa[k + 2] - pb[k + 2]) > tolerancia || Math.abs(pa[k + 3] - pb[k + 3]) > tolerancia) {
        if (out.diferentes === 0) { out.x0 = x; out.y0 = y; out.x1 = x; out.y1 = y; }
        else {
          if (x < out.x0) out.x0 = x; if (x > out.x1) out.x1 = x;
          if (y < out.y0) out.y0 = y; if (y > out.y1) out.y1 = y;
        }
        out.diferentes = out.diferentes + 1;
      }
      x = x + 1;
    }
    y = y + 1;
  }
  return out;
}

function decodificar(caminho: string, out: DiffImagem): any {
  try { return decodePNG(fs.read_all(caminho), DIFF_MAX_PIXELS); }
  catch (e) { out.erro = caminho + ": " + (e instanceof Error ? e.message : String(e)); return null; }
}

/// shot diff <a.png> <b.png> [tolerancia]
function cmdShotDiff(parts: string[]): string {
  if (parts.length < 4 || parts.length > 5) return erroUso("shot");
  let tol = 0;
  if (parts.length === 5) {
    tol = argInt(parts, 4);
    if (!(tol >= 0 && tol <= 255)) return erroUso("shot") + " (tolerancia inteira 0..255)";
  }
  const d = compararPNG(parts[2], parts[3], tol);
  if (d.erro.length > 0) return "[erro] shot diff: " + d.erro;
  const caixa = d.diferentes > 0 ? " caixa=" + d.x0 + "," + d.y0 + "," + (d.x1 - d.x0 + 1) + "," + (d.y1 - d.y0 + 1) : "";
  return "[shot] diff " + d.percentual().toFixed(3) + "% (" + d.diferentes + " de " + (d.largura * d.altura) +
    " pixels, " + d.largura + "x" + d.altura + ", tolerancia " + tol + ")" + caixa;
}
