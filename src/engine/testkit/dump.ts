// Engine RTS — TESTKIT: dump headless pra uma IA testar a engine SEM janela.
//
// O rasterizador (engine/render/raster.ts) escreve num framebuffer comum — não
// precisa de GUI. Estas funções transformam esse buffer + o estado da cena em
// TEXTO no stdout: um preview ASCII do frame (luminância) e linhas de estado.
// Assim `rts.exe run harness.ts` produz uma saída que a IA lê e verifica direto,
// sem screenshot nem leitor de imagem.
//
// Todas as funções são top-level sobre primitivos (dispatch de namespace provado).

import io from "../../compat/io.ts";
import math from "../../compat/math.ts";
import buffer from "../../compat/buffer.ts";
import fs from "../../compat/fs.ts";

// Rampa de luminância (escuro → claro), 10 níveis.
const RAMP: string[] = [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"];

/// Imprime o framebuffer como arte ASCII `cols`×`rows` (amostra por blocos).
/// Cada char = nível de luminância do pixel amostrado. Dá pra "ver" a geometria:
/// os cubos aparecem como blocos claros sobre o fundo escuro.
export function asciiFrame(fbuf: i64, RW: number, RH: number, cols: number, rows: number): void {
  io.print("+" + dashes(cols) + "+");
  let ry = 0;
  while (ry < rows) {
    let line = "|";
    let rx = 0;
    while (rx < cols) {
      const sxp = math.floor((rx / cols) * RW);
      const syp = math.floor((ry / rows) * RH);
      const px = buffer.read_i32(fbuf, (syp * RW + sxp) * 4);
      const r = px & 255;
      const g = (px >> 8) & 255;
      const b = (px >> 16) & 255;
      const lum: f64 = r * 0.30 + g * 0.59 + b * 0.11;
      let idx = math.floor(lum / 25.6);
      if (idx > 9) idx = 9;
      if (idx < 0) idx = 0;
      line = line + RAMP[idx];
      rx = rx + 1;
    }
    io.print(line + "|");
    ry = ry + 1;
  }
  io.print("+" + dashes(cols) + "+");
}

/// Como asciiFrame, mas DEVOLVE a string (pra mandar por socket em vez de stdout).
export function asciiFrameStr(fbuf: i64, RW: number, RH: number, cols: number, rows: number): string {
  let out = "+" + dashes(cols) + "+\n";
  let ry = 0;
  while (ry < rows) {
    let line = "|";
    let rx = 0;
    while (rx < cols) {
      const sxp = math.floor((rx / cols) * RW);
      const syp = math.floor((ry / rows) * RH);
      const px = buffer.read_i32(fbuf, (syp * RW + sxp) * 4);
      const r = px & 255;
      const g = (px >> 8) & 255;
      const b = (px >> 16) & 255;
      const lum: f64 = r * 0.30 + g * 0.59 + b * 0.11;
      let idx = math.floor(lum / 25.6);
      if (idx > 9) idx = 9;
      if (idx < 0) idx = 0;
      line = line + RAMP[idx];
      rx = rx + 1;
    }
    out = out + line + "|\n";
    ry = ry + 1;
  }
  return out + "+" + dashes(cols) + "+\n";
}

function dashes(n: number): string {
  let s = "";
  let i = 0;
  while (i < n) { s = s + "-"; i = i + 1; }
  return s;
}

/// Uma linha de estado de um GameObject (chame no loop top-level, extraindo os
/// campos no call site pra passar primitivos).
export function dumpObject(idx: number, name: string, px: f64, py: f64, pz: f64,
                          rx: f64, ry: f64, scale: f64, mesh: number): void {
  io.print("  [" + idx + "] " + name +
    "  pos(" + r2(px) + "," + r2(py) + "," + r2(pz) + ")" +
    "  rot(" + r2(rx) + "," + r2(ry) + ")" +
    "  scale " + r2(scale) +
    "  mesh " + mesh);
}

/// Linha da câmera.
export function dumpCamera(px: f64, py: f64, pz: f64, yaw: f64, pitch: f64): void {
  io.print("  CAM pos(" + r2(px) + "," + r2(py) + "," + r2(pz) + ")  yaw " + r2(yaw) + "  pitch " + r2(pitch));
}

/// Cabeçalho de um snapshot.
export function snapshotHeader(step: number, frame: number, t: f64): void {
  io.print("");
  io.print("========== SNAPSHOT " + step + "  (frame " + frame + ", t=" + r2(t) + "s) ==========");
}

/// Conta quantos pixels não-fundo há (heurística: sanity de "algo foi desenhado").
/// Devolve a contagem; o harness pode assertar > 0.
export function countLit(fbuf: i64, RW: number, RH: number, bgLum: f64): number {
  let n = 0;
  const total = RW * RH;
  let i = 0;
  while (i < total) {
    const px = buffer.read_i32(fbuf, i * 4);
    const r = px & 255;
    const g = (px >> 8) & 255;
    const b = (px >> 16) & 255;
    const lum: f64 = r * 0.30 + g * 0.59 + b * 0.11;
    if (lum > bgLum + 8) n = n + 1;
    i = i + 1;
  }
  return n;
}

/// Salva o framebuffer como PPM P3 (texto) reduzido a `ow`×`oh` — inspeção
/// full-color opcional (a IA pode ler com qualquer conversor). Mantém pequeno.
export function savePPM(path: string, fbuf: i64, RW: number, RH: number, ow: number, oh: number): void {
  let out = "P3\n" + ow + " " + oh + "\n255\n";
  let ry = 0;
  while (ry < oh) {
    let rx = 0;
    while (rx < ow) {
      const sxp = math.floor((rx / ow) * RW);
      const syp = math.floor((ry / oh) * RH);
      const px = buffer.read_i32(fbuf, (syp * RW + sxp) * 4);
      const r = px & 255;
      const g = (px >> 8) & 255;
      const b = (px >> 16) & 255;
      out = out + r + " " + g + " " + b + " ";
      rx = rx + 1;
    }
    out = out + "\n";
    ry = ry + 1;
  }
  fs.write(path, out);
}

// arredonda p/ 2 casas (evita floats gigantes no dump)
function r2(v: f64): f64 {
  return math.floor(v * 100.0 + 0.5) / 100.0;
}
