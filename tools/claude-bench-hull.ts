// Quanto custa GERAR uma casca convexa — o número que decide se o editor trava
// ao abrir uma cena.
//
// A geração é uma vez POR MALHA, no carregamento, então ela pode ser mais cara
// que qualquer coisa por frame. O que ela não pode é ser sentida: um `.obj` que
// leve segundos vira uma janela congelada sem explicação.
//
// As três malhas são as do projeto: o cubo como `buildFlat` o emite (cada canto
// repetido por face), a esfera de `gpu3d` (LAT 16 × LON 24) e o `torus.obj` de
// verdade, lido do disco.

import io from "../compat/io.ts";
import fs from "../compat/fs.ts";
import { hullFromMesh } from "../engine/core/hull";

const REPS = 20;

function medir(nome: string, verts: f64[], stride: number): void {
  // uma volta fora do cronômetro: a primeira execução paga o que for de
  // aquecimento e não é o que se quer medir
  const h0 = hullFromMesh(verts, stride);
  const t0 = Date.now();
  let r = 0;
  while (r < REPS) { hullFromMesh(verts, stride); r = r + 1; }
  const ms = (Date.now() - t0) / REPS;
  const nv = (verts.length / stride) | 0;
  io.print("  " + nome.padEnd(26) + nv.toString().padStart(5) + " verts entram  ->  " +
           h0.vertexCount().toString().padStart(4) + " verts / " +
           h0.planeCount().toString().padStart(3) + " planos" +
           (h0.simplified !== 0 ? " (simplificado)" : "               ") +
           "   " + ms.toFixed(3).padStart(8) + " ms");
}

function inter(pontos: f64[]): f64[] {
  const v: f64[] = [];
  let i = 0;
  while (i < pontos.length) {
    v.push(pontos[i]); v.push(pontos[i + 1]); v.push(pontos[i + 2]);
    v.push(0.0); v.push(1.0); v.push(0.0); v.push(0.0); v.push(0.0);
    i = i + 3;
  }
  return v;
}

// ── cubo como buildFlat emite: 36 vértices para 8 cantos ───────────────────
const cubo: f64[] = [];
let c = 0;
while (c < 36) {
  const k = c % 8;
  cubo.push((k & 1) !== 0 ? 0.5 : 0.0 - 0.5);
  cubo.push((k & 2) !== 0 ? 0.5 : 0.0 - 0.5);
  cubo.push((k & 4) !== 0 ? 0.5 : 0.0 - 0.5);
  c = c + 1;
}

// ── esfera de gpu3d ────────────────────────────────────────────────────────
const esf: f64[] = [];
const LAT = 16; const LON = 24; const PI = 3.14159265358979;
let ii = 0;
while (ii <= LAT) {
  const th: f64 = PI * (ii / LAT);
  const st: f64 = Math.sin(th); const ct: f64 = Math.cos(th);
  let jj = 0;
  while (jj < LON) {
    const ph: f64 = 2.0 * PI * (jj / LON);
    esf.push(0.5 * st * Math.cos(ph)); esf.push(0.5 * ct); esf.push(0.5 * st * Math.sin(ph));
    jj = jj + 1;
  }
  ii = ii + 1;
}

// ── torus.obj REAL, lido do disco ──────────────────────────────────────────
// Só as linhas `v` — o casco não usa normais nem uv, e ler a malha inteira aqui
// mediria o parser junto.
const tor: f64[] = [];
const caminho = "assets/models/torus.obj";
if (fs.exists(caminho)) {
  const linhas = fs.read_text(caminho).split("\n");
  let li = 0;
  while (li < linhas.length) {
    const p = linhas[li].split(" ");
    if (p[0] === "v") {
      tor.push(parseFloat(p[1])); tor.push(parseFloat(p[2])); tor.push(parseFloat(p[3]));
    }
    li = li + 1;
  }
}

io.print("custo de GERAR uma casca (media de " + REPS + "), stride 8:");
medir("cubo (buildFlat)", inter(cubo), 8);
medir("esfera LAT16 x LON24", inter(esf), 8);
if (tor.length > 0) medir("torus.obj (do disco)", inter(tor), 8);
else io.print("  torus.obj nao encontrado em " + caminho);

// Uma cena de 500 objetos NÃO gera 500 cascas: a casca é da MALHA, e o projeto
// tem um punhado delas. O número que importa é a soma acima, uma vez.
