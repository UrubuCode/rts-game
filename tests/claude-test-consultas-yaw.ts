// Consultas espaciais contra caixas giradas em yaw: a caixa que a consulta vê
// tem de ser a MESMA que o renderer desenha e que a física (scene.ts) colide.
// Convenção única (rts-egui scene3d/math.rs `model_matrix`, collider offset,
// scene.ts obbBoxBox): eixo local X vai para (cos ry, -sin ry) em (x, z).
//
// Achados pelo mapa do rts-fps (2026-09-25): (1) o sinal do yaw estava
// espelhado em z nas consultas; (2) a fase larga usava a caixa SEM girar, então
// a parte do OBB fora dela era invisível para raio e esfera.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import {
  setSpatialScene, spatialRebuildIndex, createOverlapHit, createRaycastHit,
  overlapSphereNonAlloc, overlapBoxNonAlloc, raycastNonAlloc,
} from "@engine/core/spatial_queries";
import { FIXED_DT } from "@engine/core/fixedstep";
import { Rigidbody } from "@scripts/rigidbody";
import { hullCollider, sphereCollider } from "@engine/core/collider";
import { hullFromMesh } from "@engine/core/hull";
import { hullRegisterGeo } from "@engine/core/hullreg";
import { rigidSetMode, rigidStep } from "@engine/core/physics_backend";

let falhas = 0;
let total = 0;
function check(nome: string, cond: boolean, detalhe: string = ""): void {
  total = total + 1;
  if (cond) io.print("  [OK] " + nome);
  else { falhas = falhas + 1; io.print("  [FALHA] " + nome + (detalhe.length > 0 ? " -- " + detalhe : "")); }
}

const PI = 3.141592653589793;
const hits = [createOverlapHit()];
const raio = createRaycastHit();

function cena(nome: string, sx: f64, sy: f64, sz: f64, ry: f64, estatico: number): Scene {
  const sc = new Scene(nome);
  const b = new GameObject("caixa");
  b.stationary = estatico;
  b.setMesh(1, 200, 100, 100);
  b.transform.setPosition(0.0, 1.0, 0.0);
  b.transform.sx = sx; b.transform.sy = sy; b.transform.sz = sz;
  b.transform.ry = ry;
  sc.add(b);
  sc.markCollidersDirty();
  sc.computeWorld();
  setSpatialScene(sc);
  spatialRebuildIndex(sc);
  return sc;
}

io.print("=== Consultas contra caixa girada em yaw ===");

// ── 1) sinal: caixa 6x2x2 girada 0.3 — a ponta +x desenhada está em
//      (2.9 cos, -2.9 sin); a espelhada, (2.9 cos, +2.9 sin), é ar. ──────────
{
  const ry = 0.3;
  const c = Math.cos(ry); const s = Math.sin(ry);
  const px = 2.9 * c;
  const estaticos = [1, 0];
  let e = 0;
  while (e < 2) {
    const sc = cena("Sinal" + e, 6.0, 2.0, 2.0, ry, estaticos[e]);
    const tipo = estaticos[e] !== 0 ? "estatica" : "dinamica";
    const naPonta = overlapSphereNonAlloc(px, 1.0, 0.0 - 2.9 * s, 0.05, hits, 1, 0xFFFFFFFF, 1, false, sc);
    const noEspelho = overlapSphereNonAlloc(px, 1.0, 2.9 * s, 0.05, hits, 1, 0xFFFFFFFF, 1, false, sc);
    check("1. esfera na ponta desenhada acerta (" + tipo + ")", naPonta === 1, "hits=" + naPonta);
    check("1. esfera no espelho em z nao acerta (" + tipo + ")", noEspelho === 0, "hits=" + noEspelho);
    const cx = overlapBoxNonAlloc(px, 1.0, 0.0 - 2.9 * s, 0.05, 0.05, 0.05, hits, 1, 0xFFFFFFFF, 1, false, sc);
    const cxE = overlapBoxNonAlloc(px, 1.0, 2.9 * s, 0.05, 0.05, 0.05, hits, 1, 0xFFFFFFFF, 1, false, sc);
    check("1. caixa-consulta na ponta desenhada acerta, no espelho nao (" + tipo + ")", cx === 1 && cxE === 0, "ponta=" + cx + " espelho=" + cxE);
    // raio de cima para baixo nos dois pontos
    raycastNonAlloc(px, 5.0, 0.0 - 2.9 * s, 0.0, 0.0 - 1.0, 0.0, 10.0, raio, 0xFFFFFFFF, 1, false, sc);
    const rPonta = raio.hit;
    raycastNonAlloc(px, 5.0, 2.9 * s, 0.0, 0.0 - 1.0, 0.0, 10.0, raio, 0xFFFFFFFF, 1, false, sc);
    const rEspelho = raio.hit;
    check("1. raio na ponta desenhada acerta, no espelho nao (" + tipo + ")", rPonta && !rEspelho, "ponta=" + rPonta + " espelho=" + rEspelho);
    e = e + 1;
  }
}

// ── 2) fase larga: passarela 17x0.4x1.8 a 45 graus; raios para baixo ao longo
//      do eixo desenhado — todos têm de acertar o topo (y = 1.2). ───────────
{
  const ry = PI / 4.0;
  const sc = cena("Passarela", 17.0, 0.4, 1.8, ry, 1);
  const ax = Math.cos(ry); const az = 0.0 - Math.sin(ry);
  let acertos = 0;
  let pior = 0.0;
  let i = 0;
  while (i < 13) {
    const t = (i - 6) * 1.3;   // -7.8 .. 7.8 ao longo do eixo
    raycastNonAlloc(t * ax, 5.0, t * az, 0.0, 0.0 - 1.0, 0.0, 10.0, raio, 0xFFFFFFFF, 1, false, sc);
    if (raio.hit) {
      acertos = acertos + 1;
      const y = 5.0 - raio.distance;
      const d = y > 1.2 ? y - 1.2 : 1.2 - y;
      if (d > pior) pior = d;
    }
    i = i + 1;
  }
  check("2. os 13 raios ao longo da passarela girada acertam", acertos === 13, "acertos=" + acertos);
  check("2. e acertam o topo (y = 1.2)", pior < 0.01, "pior=" + pior);
  // e fora dela, na diagonal oposta, nada
  raycastNonAlloc(6.0 * ax, 5.0, 0.0 - 6.0 * az, 0.0, 0.0 - 1.0, 0.0, 10.0, raio, 0xFFFFFFFF, 1, false, sc);
  check("2. na diagonal oposta, ar", !raio.hit);
  // esfera na extremidade (fora da caixa sem girar: |x| = 5.6 > ... cobre?)
  const n = overlapSphereNonAlloc(7.5 * ax, 1.0, 7.5 * az, 0.1, hits, 1, 0xFFFFFFFF, 1, false, sc);
  check("2. esfera na extremidade girada acerta", n === 1, "hits=" + n);
}

// ── 3) física com CASCA girada (scene.ts hullContact): a esfera que cai na
//      ponta desenhada para em cima; a do espelho cai no chão. ──────────────
{
  rigidSetMode(0);
  const caixa: f64[] = [
    -3.0, -1.0, -1.0,   3.0, -1.0, -1.0,   3.0, 1.0, -1.0,   -3.0, 1.0, -1.0,
    -3.0, -1.0,  1.0,   3.0, -1.0,  1.0,   3.0, 1.0,  1.0,   -3.0, 1.0,  1.0,
  ];
  const idCaixa = hullRegisterGeo(hullFromMesh(caixa, 3));
  const ry = 0.3;
  const c = Math.cos(ry); const s = Math.sin(ry);
  const pontos = [0.0 - 2.6 * s, 2.6 * s];
  let finais: f64[] = [];
  let p = 0;
  while (p < 2) {
    const sc = new Scene("CascaGirada" + p);
    const chao = new GameObject("Chao");
    chao.setMesh(1, 90, 90, 90);
    chao.transform.setPosition(0.0, 0.0 - 0.5, 0.0);
    chao.transform.sx = 40.0; chao.transform.sy = 1.0; chao.transform.sz = 40.0;
    chao.stationary = 1;
    sc.add(chao);
    const barra = new GameObject("Barra");
    barra.setMesh(1, 180, 140, 90);
    barra.transform.setPosition(0.0, 1.0, 0.0);
    barra.transform.ry = ry;
    barra.stationary = 1;
    barra.addBehavior(hullCollider(idCaixa, 3.0, 1.0, 1.0));
    sc.add(barra);
    const bola = new GameObject("Bola");
    bola.setMesh(4, 240, 240, 240);
    bola.transform.setPosition(2.6 * c, 5.0, pontos[p]);
    bola.transform.setScale(0.4);
    bola.addBehavior(sphereCollider(0.5));
    const rb = new Rigidbody(0.0 - 9.8, 0.0);
    rb.floorY = 0.0 - 1.0e9;
    bola.addBehavior(rb);
    sc.add(bola);
    sc.markCollidersDirty();
    sc.computeWorld();
    let i = 0;
    while (i < 240) { sc.update(FIXED_DT); if (rigidStep(sc, 0) === 0) sc.resolveCollisions(); i = i + 1; }
    finais.push(bola.transform.py);
    p = p + 1;
  }
  io.print("  bola na ponta desenhada: y=" + finais[0].toFixed(3) + " | no espelho: y=" + finais[1].toFixed(3));
  check("3. casca girada: a bola na ponta desenhada para em cima (y ~ 2.2)", finais[0] > 2.0 && finais[0] < 2.5, "y=" + finais[0]);
  check("3. casca girada: a bola no espelho cai ate o chao (y < 0.5)", finais[1] < 0.5, "y=" + finais[1]);
}

io.print("");
if (falhas === 0) io.print("[PASSOU] Consultas com yaw: " + total + " verificacoes");
else io.print("[FALHA] Consultas com yaw: " + falhas + " de " + total);
