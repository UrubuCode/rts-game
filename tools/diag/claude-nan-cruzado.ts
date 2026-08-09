import io from "rts:io";
import { scene } from "./editor/control/session";
import { GameObject } from "./engine/core/gameobject";
import { rbInit, rbSetBody, rbSetVel, rbUpload, rbSyncStatics, rbStep, rbPoke,
         rbX, rbY, rbZ } from "./engine/rigid/gpurigid";
import { initMeshes, setCam, setLgt, setShadow, drawGPU } from "./engine/render/gpu3d";
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
let muro = 0;
while (muro < 2) {
  const mx: f64 = muro === 0 ? 11.0 : 29.0;
  let r = 0;
  while (r < 8) {
    let c = 0;
    while (c < 18) { corpo(mx, 1.15 + r * 1.32, c * 1.65 - 6.6, 1.25, 1.3, 1.6, 4.5); c = c + 1; }
    r = r + 1;
  }
  muro = muro + 1;
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

// ── O DISCRIMINADOR DA ESCALA ────────────────────────────────────────────────
// A sonda headless original (`_nan_probe.ts`) tem 96 corpos; o demo que
// contamina tem 355. O mapa do commit 1997171 registra "headless com a MESMA
// fortaleza: ZERO NaN -> kernel inocente", mas as duas fortalezas não têm o
// mesmo TAMANHO — e o kernel roda com `rbN` grupos, então o número de corpos é
// exatamente uma das coisas que mudam.
//
// Esta é a headless com a fortaleza na escala do demo. Sem janela, sem desenho.
//
//   NaN > 0  → a escala basta; a janela e o desenho são inocentes
//   NaN = 0  → a escala não basta; volta para o que a janela desenha

// ── O CRUZAMENTO QUE FALTAVA ────────────────────────────────────────────────
// Medido até aqui, cada eixo sozinho é inocente:
//   janela sem desenho, 96 corpos ....... 1500 frames, zero NaN
//   janela com desenho, 96 corpos ....... 1005 frames, zero NaN
//   headless, 348 corpos ................ 1500 frames, zero NaN
// O demo tem os DOIS ao mesmo tempo (346 corpos + janela + desenho + sombra) e
// contamina após o 5o tiro. Esta sonda cruza os eixos.
const app = createAppAt("sonda NaN — 348 corpos + janela + desenho + sombra", 900, 560, 60, 40);
initMeshes(app.win);
setCam(app.win, 0.0, 14.0, 0.0 - 34.0, 0.0, 0.0 - 0.25, 1.0, 900.0 / 560.0);
setLgt(app.win, 20.0, 40.0, 0.0 - 20.0, 0.35);
setShadow(app.win, 0.0 - 0.4, 0.0 - 1.0, 0.3, 14.0, 6.0, 2.0, 34.0);

let f = 0;
let nb = 0;
let primeiroNaN = -1;
let saiuPor = "completou";
while (f < 1500) {
  if (!app.running()) { saiuPor = "running()=false em f" + f; break; }
  if (!app.beginFrame()) { saiuPor = "beginFrame()=false em f" + f; break; }
  rbStep(1);
  if (f % 120 === 100) {
    const bi = BALA + (nb % 2);
    rbSetBody(bi, 0.0 - 10.0, 2.4, 9.0, 0.85, 0.85, 0.85, 32.0);
    rbSetVel(bi, 34.0, 5.0, 0.0);
    rbPoke(bi);
    nb = nb + 1;
  }
  let nan = 0;
  let k = 0;
  while (k < n) { const v = rbX(k); if (v !== v) nan = nan + 1; k = k + 1; }
  if (nan > 0 && primeiroNaN < 0) {
    primeiroNaN = f;
    io.print("PRIMEIRO NaN no frame " + f + " (" + nan + "/" + n + " corpos, apos " + nb + " tiros)");
  }
  if (f % 300 === 299) {
    io.print("f" + (f + 1) + " NaN=" + nan + "/" + n + " y0=" + rbY(0) + " tiros=" + nb);
  }
  let d = 0;
  while (d < n) {
    drawGPU(app.win, 1, rbX(d), rbY(d), rbZ(d), 0.0, 0.0,
            hx[d] * 2.0, hy[d] * 2.0, hz[d] * 2.0, 0xFFB0B0B0, 0, 0);
    d = d + 1;
  }
  app.endFrame();
  f = f + 1;
}
io.print("[frames] rodou " + f + "; saida: " + saiuPor);
io.print(primeiroNaN < 0
  ? "[RESULTADO] " + n + " corpos + janela + desenho + sombra: ZERO NaN em " + f + " frames"
  : "[RESULTADO] " + n + " corpos + janela + desenho contaminou no frame " + primeiroNaN
    + " -> o CRUZAMENTO (escala sob janela) reproduz");
app.close();
