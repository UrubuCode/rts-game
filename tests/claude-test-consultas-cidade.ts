// Custo das consultas numa cena que PARECE UM JOGO: ~3.000 estáticos de
// tamanhos variados espalhados por 400 u (quarteirões com prédio, pilares,
// muros e caixotes), como o mapa do rts-fps. As cenas dos outros testes são
// grades compactas de cubos iguais, e foi por isso que duas regressões de
// custo passaram despercebidas em 2026-09-25 (consultas a ~100 µs no FPS):
// a tabela de hash de 1.024 baldes, que só colide com objetos espalhados, e o
// valor padrão em funções de 5+ parâmetros (ver tools/check-params.mjs).
//
// Orçamentos = ~3x o medido depois da correção (medianas de 5 rodadas), para
// não oscilar com a máquina carregada. Antes da correção: esfera 97 µs, raio
// curto 157 µs, raio 60 u 1.331 µs — todos falhariam.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import {
  setSpatialScene, spatialRebuildIndex, raycastNonAlloc, overlapSphereNonAlloc,
  createRaycastHit, createOverlapHit,
} from "@engine/core/spatial_queries";

let falhas = 0;
function check(nome: string, cond: boolean, detalhe: string): void {
  if (cond) io.print("  [OK] " + nome + " -- " + detalhe);
  else { falhas = falhas + 1; io.print("  [FALHA] " + nome + " -- " + detalhe); }
}

let semente = 12345;
function rnd(): f64 {
  semente = ((semente * 1664525 + 1013904223) | 0);
  return (semente >>> 0) / 4294967296.0;
}

function caixa(sc: Scene, x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64, yaw: f64): void {
  const o = new GameObject("peca");
  o.stationary = 1;
  o.setMesh(1, 150, 150, 150);
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx; o.transform.sy = sy; o.transform.sz = sz;
  o.transform.ry = yaw;
  sc.add(o);
}

// ── a cidade ─────────────────────────────────────────────────────────────
const sc = new Scene("Cidade");
caixa(sc, 0.0, -0.5, 0.0, 400.0, 1.0, 400.0, 0.0);                      // chão
caixa(sc, 0.0, 3.0, 201.0, 404.0, 6.0, 2.0, 0.0);                       // bordas
caixa(sc, 0.0, 3.0, -201.0, 404.0, 6.0, 2.0, 0.0);
caixa(sc, 201.0, 3.0, 0.0, 2.0, 6.0, 404.0, 0.0);
caixa(sc, -201.0, 3.0, 0.0, 2.0, 6.0, 404.0, 0.0);
const spawnX: f64[] = [];
const spawnZ: f64[] = [];
let bi = 0;
while (bi < 8) {
  let bj = 0;
  while (bj < 8) {
    const cx = (bi - 3.5) * 48.0; const cz = (bj - 3.5) * 48.0;
    const alt = 6.0 + rnd() * 34.0;
    caixa(sc, cx, alt * 0.5, cz, 8.0 + rnd() * 10.0, alt, 8.0 + rnd() * 10.0, 0.0);   // prédio
    let k = 0;
    while (k < 8) {                                                        // pilares em anel
      const a = k * 0.785398;
      caixa(sc, cx + Math.cos(a) * 14.0, 3.0, cz + Math.sin(a) * 14.0, 0.6, 6.0, 0.6, 0.0);
      k = k + 1;
    }
    caixa(sc, cx + 15.0, 0.6, cz, 0.4, 1.2, 6.0, 0.0);                     // muros
    caixa(sc, cx - 15.0, 0.6, cz, 0.4, 1.2, 6.0, 0.0);
    k = 0;
    while (k < 34) {                                                       // caixotes
      const ang = rnd() * 6.2832; const r = 17.0 + rnd() * 5.0;
      const s = 0.8 + rnd() * 1.2;
      caixa(sc, cx + Math.cos(ang) * r, s * 0.5, cz + Math.sin(ang) * r, s, s, s, (k % 5 === 0) ? rnd() : 0.0);
      k = k + 1;
    }
    spawnX.push(cx + 24.0); spawnZ.push(cz + 24.0);
    bj = bj + 1;
  }
  bi = bi + 1;
}
sc.computeWorld();
setSpatialScene(sc);
spatialRebuildIndex(sc);
io.print("=== Consultas numa cidade (" + sc.objects.length + " estaticos) ===");

const hits = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit(),
              createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];
const raio = createRaycastHit();
const N = spawnX.length;

function mediana(a: f64[]): f64 {
  const s = a.slice().sort((x: f64, y: f64) => x - y);
  return s[(s.length / 2) | 0];
}

/// Mediana de 5 rodadas de 2.000 consultas, em µs por consulta.
function medir(tipo: number): f64 {
  const rodadas: f64[] = [];
  let r = 0;
  while (r < 6) {
    const t0 = performance.now();
    let k = 0;
    while (k < 2000) {
      const i = k % N;
      if (tipo === 0) overlapSphereNonAlloc(spawnX[i], 0.9, spawnZ[i], 0.4, hits, 8, 0xFFFFFFFF, 1, false, sc);
      else if (tipo === 1) raycastNonAlloc(spawnX[i], 0.35, spawnZ[i], 0.0, -1.0, 0.0, 0.35, raio, 0xFFFFFFFF, 1, false, sc);
      else raycastNonAlloc(spawnX[i], 1.6, spawnZ[i], 0.707, 0.0, 0.707, 60.0, raio, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    if (r > 0) rodadas.push((performance.now() - t0) / 2000.0 * 1000.0);   // a 1ª aquece
    r = r + 1;
  }
  return mediana(rodadas);
}

const esfera = medir(0);
const curto = medir(1);
const longo = medir(2);
check("esfera r=0,4 do controlador <= 50 us", esfera <= 50.0, esfera.toFixed(1) + " us");
check("raio curto 0,35 u (degrau/chao) <= 60 us", curto <= 60.0, curto.toFixed(1) + " us");
check("raio de 60 u (tiro) <= 200 us", longo <= 200.0, longo.toFixed(1) + " us");

io.print("");
if (falhas === 0) io.print("[PASSOU] Consultas numa cidade: dentro do orcamento");
else io.print("[FALHA] Consultas numa cidade: " + falhas + " fora do orcamento");
