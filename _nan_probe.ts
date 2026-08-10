import io from "./compat/io.ts";
import { scene } from "./editor/control/session";
import { GameObject } from "./engine/core/gameobject";
import { rbInit, rbSetBody, rbSetVel, rbUpload, rbSyncStatics, rbStep, rbPoke,
         rbX, rbY } from "./engine/rigid/gpurigid";
{
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.setPosition(0.0, 0.0, 0.0);
  g.transform.sx = 90.0; g.transform.sy = 1.0; g.transform.sz = 60.0;
  g.stationary = 1;
  scene.add(g);
  scene.computeWorld();
}
// fortaleza compacta: 2 muralhas de 9x4 + 2 torres 7-altas + TELHADOS
// nascendo interpenetrados 0.3 (como no demo) + 2 balas
let n = 0;
const bx: f64[] = []; const by: f64[] = []; const bz: f64[] = [];
const hx: f64[] = []; const hy: f64[] = []; const hz: f64[] = []; const bm: f64[] = [];
function corpo(x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64, m: f64): void {
  bx.push(x); by.push(y); bz.push(z);
  hx.push(sx * 0.5); hy.push(sy * 0.5); hz.push(sz * 0.5); bm.push(m);
  n = n + 1;
}
let r = 0;
while (r < 4) {
  let c = 0;
  while (c < 9) { corpo(11.0, 1.15 + r * 1.32, c * 1.65 - 6.6, 1.25, 1.3, 1.6, 4.5); c = c + 1; }
  r = r + 1;
}
let t = 0;
while (t < 2) {
  const tx: f64 = t === 0 ? 11.0 : 29.0;
  let l = 0;
  while (l < 7) {
    let q = 0;
    while (q < 4) {
      corpo(tx + (q % 2) * 1.35 - 0.67, 1.15 + l * 1.32, 9.0 + ((q / 2) | 0) * 1.35 - 0.67, 1.3, 1.3, 1.3, 4.5);
      q = q + 1;
    }
    l = l + 1;
  }
  corpo(tx, 1.15 + 7.0 * 1.32 + 0.9, 9.0, 3.4, 2.4, 3.4, 2.0);   // telhado interpenetrado
  t = t + 1;
}
const BALA = n;
corpo(0.0 - 20.0, 0.0 - 16.0, 0.0, 1.7, 1.7, 1.7, 32.0);
corpo(0.0 - 24.0, 0.0 - 16.0, 0.0, 1.7, 1.7, 1.7, 32.0);
io.print("corpos: " + n);
rbInit(n + 2);
rbSyncStatics(scene);
let i = 0;
while (i < n) { rbSetBody(i, bx[i], by[i], bz[i], hx[i], hy[i], hz[i], bm[i]); i = i + 1; }
rbSetBody(BALA, 0.0 - 20.0, 0.0 - 16.0, 0.0, 0.85, 0.85, 0.85, 32.0);
rbSetBody(BALA + 1, 0.0 - 24.0, 0.0 - 16.0, 0.0, 0.85, 0.85, 0.85, 32.0);
rbUpload();
let f = 0;
let nb = 0;
while (f < 1500) {
  rbStep(1);
  if (f % 120 === 100) {
    // dispara uma bala contra a torre
    const bi = BALA + (nb % 2);
    rbSetBody(bi, 0.0 - 10.0, 2.4, 9.0, 0.85, 0.85, 0.85, 32.0);
    rbSetVel(bi, 34.0, 5.0, 0.0);
    rbPoke(bi);
    nb = nb + 1;
  }
  if (f % 300 === 299) {
    let nan = 0;
    let k = 0;
    while (k < n) { const v = rbX(k); if (v !== v) nan = nan + 1; k = k + 1; }
    io.print("f" + (f + 1) + " NaN=" + nan + "/" + n + " y0=" + rbY(0));
  }
  const t0 = performance.now();
  while (performance.now() - t0 < 8.0) { }
  f = f + 1;
}
