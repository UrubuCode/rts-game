// O laço de preparação do render custa 15 us POR OBJETO olhando para o céu —
// onde ele só faz ~10 operações e descarta. Este benchmark separa as causas.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { scene } from "../editor/control/session";
import { frustumBegin, inFrustumFast } from "../engine/render/gpu3d";
import { Transform } from "../engine/core/transform";

const N = 500;
const F = 200;

scene.clear();
for (let i = 0; i < N; i++) {
  const g = new GameObject("o" + i);
  g.setMesh(1, 200, 200, 200);
  g.transform.setPosition((i % 25) * 2 - 25, 0, ((i / 25) | 0) * 2 - 20);
  scene.add(g);
}
scene.computeWorld();
// Câmera olhando para longe da cena — tudo é descartado, como "olhar para o céu".
frustumBegin(0, 5, 0, 0, 1.5, 1.0, 1.6);

const objs: GameObject[] = scene.objects;
const trs: Transform[] = scene.trs;

function medir(nome: string, corpo: () => number): void {
  const t0 = Date.now();
  let acc = 0;
  for (let f = 0; f < F; f++) acc = acc + corpo();
  const ms = (Date.now() - t0) / F;
  io.print("  " + nome.padEnd(42) + ms.toFixed(3).padStart(7) + " ms/frame   (" + (ms * 1000000.0 / N).toFixed(0) + " ns/objeto)  acc=" + acc);
}

io.print("laco de preparacao, " + N + " objetos, " + F + " frames:");

medir("1. so percorrer o array", () => {
  let n = 0; let i = 0;
  while (i < N) { const o = objs[i]; if (o.active !== 0) n = n + 1; i = i + 1; }
  return n;
});

medir("2. + ler o Transform espelho", () => {
  let n = 0; let i = 0;
  while (i < N) {
    const o = objs[i];
    if (o.active !== 0) { const t: Transform = trs[i]; if (t.sx > 0.0) n = n + 1; }
    i = i + 1;
  }
  return n;
});

medir("3. + inFrustumFast (le globais de MODULO)", () => {
  let n = 0; let i = 0;
  while (i < N) {
    const o = objs[i];
    if (o.active !== 0) {
      const t: Transform = trs[i];
      let rmax: f64 = t.sx;
      if (t.sy > rmax) rmax = t.sy;
      if (t.sz > rmax) rmax = t.sz;
      if (inFrustumFast(t.wx, t.wy, t.wz, rmax * 0.87) !== 0) n = n + 1;
    }
    i = i + 1;
  }
  return n;
});

// A MESMA aritmética, com os parâmetros do frustum em LOCAIS. Se isto for muito
// mais rápido que o 3, o custo é ler variável de módulo — e a correção é passar
// o frustum por valor em vez de guardá-lo no módulo.
const cx = 0.0, cy = 5.0, cz = 0.0;
const cyw = Math.cos(0.0), syw = Math.sin(0.0);
const cpt = Math.cos(1.5), spt = Math.sin(1.5);
const tanH = 1.6, tanV = 1.0;
medir("4. mesma aritmetica com LOCAIS (inline)", () => {
  let n = 0; let i = 0;
  while (i < N) {
    const o = objs[i];
    if (o.active !== 0) {
      const t: Transform = trs[i];
      let rmax: f64 = t.sx;
      if (t.sy > rmax) rmax = t.sy;
      if (t.sz > rmax) rmax = t.sz;
      const r = rmax * 0.87;
      const dx = t.wx - cx, dy = t.wy - cy, dz = t.wz - cz;
      const x1 = dx * cyw - dz * syw;
      const z1 = dx * syw + dz * cyw;
      const y2 = dy * cpt - z1 * spt;
      const z2 = dy * spt + z1 * cpt;
      let ok = 1;
      if (z2 + r < 0.1) ok = 0;
      else if (z2 - r > 500.0) ok = 0;
      else if (x1 - r > z2 * tanH) ok = 0;
      else if (0.0 - x1 - r > z2 * tanH) ok = 0;
      else if (y2 - r > z2 * tanV) ok = 0;
      else if (0.0 - y2 - r > z2 * tanV) ok = 0;
      if (ok !== 0) n = n + 1;
    }
    i = i + 1;
  }
  return n;
});

// 5. O MESMO laço, numa FUNÇÃO LIVRE TIPADA.
//
// `engine/core/scene.ts` documenta esta diferença: "dentro do método os acessos
// a campo caem no caminho dinâmico", e por isso `computeWorldInto` e
// `resolveCollisions` extraíram funções livres com os arrays anotados. Se o
// laço do render pagar o mesmo imposto, esta é a mesma correção.
function varrerLivre(objs: GameObject[], trs: Transform[], n: number,
                     cx: f64, cy: f64, cz: f64, cyw: f64, syw: f64,
                     cpt: f64, spt: f64, tanH: f64, tanV: f64): number {
  let vis = 0;
  let i = 0;
  while (i < n) {
    const o: GameObject = objs[i];
    if (o.active !== 0) {
      const t: Transform = trs[i];
      let rmax: f64 = t.sx;
      if (t.sy > rmax) rmax = t.sy;
      if (t.sz > rmax) rmax = t.sz;
      const r: f64 = rmax * 0.87;
      const dx: f64 = t.wx - cx, dy: f64 = t.wy - cy, dz: f64 = t.wz - cz;
      const x1: f64 = dx * cyw - dz * syw;
      const z1: f64 = dx * syw + dz * cyw;
      const y2: f64 = dy * cpt - z1 * spt;
      const z2: f64 = dy * spt + z1 * cpt;
      let ok = 1;
      if (z2 + r < 0.1) ok = 0;
      else if (z2 - r > 500.0) ok = 0;
      else if (x1 - r > z2 * tanH) ok = 0;
      else if (0.0 - x1 - r > z2 * tanH) ok = 0;
      else if (y2 - r > z2 * tanV) ok = 0;
      else if (0.0 - y2 - r > z2 * tanV) ok = 0;
      if (ok !== 0) vis = vis + 1;
    }
    i = i + 1;
  }
  return vis;
}

medir("5. funcao LIVRE tipada (mesma aritmetica)", () => {
  return varrerLivre(objs, trs, N, cx, cy, cz, cyw, syw, cpt, spt, tanH, tanV);
});
