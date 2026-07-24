// Teste HEADLESS dos loaders de modelo (engine/render/model.ts) — roda sem abrir
// janela e sem tocar na GPU, usando o parse puro (parseObj). Cobre justamente as
// limitações que o loader antigo tinha e o torus.obj do repo não exercitava:
// quads, n-gons, índices negativos, normais ausentes, CRLF e .mtl.
//
//   ./rts.exe run tools/test_model.ts
import io from "rts:io";
import math from "rts:math";
import { parseObj, parseGltf } from "../engine/render/model";

const DIR = "assets/models/_fixtures";
let pass = 0;
let fail = 0;

function check(name: string, got: f64, want: f64): void {
  if (got === want) { pass = pass + 1; io.print("  ok   " + name + " = " + got); }
  else { fail = fail + 1; io.print("  FALHA " + name + ": esperado " + want + ", veio " + got); }
}
function checkNear(name: string, got: f64, want: f64, tol: f64): void {
  let d = got - want;
  if (d < 0.0) d = 0.0 - d;
  if (d <= tol) { pass = pass + 1; io.print("  ok   " + name + " = " + got); }
  else { fail = fail + 1; io.print("  FALHA " + name + ": esperado ~" + want + ", veio " + got); }
}
// nº total de triângulos somando todas as partes
function tris(path: string): number {
  const ps = parseObj(path);
  let n = 0;
  let i = 0;
  while (i < ps.length) { n = n + ps[i].triCount(); i = i + 1; }
  return n;
}

io.print("== TRIANGULACAO (o loader antigo so lia 3 corners por face) ==");
check("quad.obj -> 2 triangulos", tris(DIR + "/quad.obj"), 2);
check("ngon.obj (pentagono) -> 3 triangulos", tris(DIR + "/ngon.obj"), 3);

io.print("== INDICES NEGATIVOS (relativos ao fim; antes viravam NaN) ==");
{
  const ps = parseObj(DIR + "/negidx.obj");
  check("negidx.obj -> 1 triangulo", ps.length > 0 ? ps[0].triCount() : 0, 1);
  if (ps.length > 0 && ps[0].verts.length >= 24) {
    const v = ps[0].verts;
    // f -3 -2 -1 == f 1 2 3 -> primeiro vertice (0,0,0), segundo (1,0,0)
    check("  v0.x", v[0], 0.0);
    check("  v1.x", v[8], 1.0);
    check("  v2.y", v[17], 1.0);
  } else { fail = fail + 1; io.print("  FALHA negidx: sem vertices"); }
}

io.print("== NORMAL DA FACE quando o .obj nao traz vn ==");
{
  const ps = parseObj(DIR + "/nonormals.obj");
  if (ps.length > 0 && ps[0].verts.length >= 8) {
    const v = ps[0].verts;
    // triangulo (0,0,0)(1,0,0)(0,1,0) no plano XY -> normal +Z
    checkNear("  nx", v[3], 0.0, 0.0001);
    checkNear("  ny", v[4], 0.0, 0.0001);
    checkNear("  nz", v[5], 1.0, 0.0001);
  } else { fail = fail + 1; io.print("  FALHA nonormals: sem vertices"); }
}

io.print("== CRLF (arquivos salvos no Windows) ==");
check("crlf.obj -> 1 triangulo", tris(DIR + "/crlf.obj"), 1);

io.print("== .MTL: cor difusa vem do material (antes tudo cinza) ==");
{
  const ps = parseObj(DIR + "/withmtl.obj");
  if (ps.length > 0) {
    check("  partes", ps.length, 1);
    check("  triangulos (quad)", ps[0].triCount(), 2);
    check("  nome do grupo (o Chao)", ps[0].name === "Chao" ? 1 : 0, 1);
    // Kd 0.9 0.2 0.15 -> 229 51 38 (arredondado por truncamento)
    check("  cor R", ps[0].cr, 229);
    check("  cor G", ps[0].cg, 51);
    check("  cor B", ps[0].cb, 38);
  } else { fail = fail + 1; io.print("  FALHA withmtl: nenhuma parte"); }
}

io.print("== REGRESSAO: o torus real do repo continua carregando ==");
check("torus.obj -> 576 triangulos", tris("assets/models/torus.obj"), 576);

io.print("== .GLB (binario: header + chunk JSON + chunk BIN, indices u16) ==");
{
  const ps = parseGltf(DIR + "/quad.glb");
  check("  partes", ps.length, 1);
  if (ps.length > 0) {
    const p = ps[0];
    check("  triangulos", p.triCount(), 2);
    check("  vertices", p.verts.length / 8, 4);
    check("  nome do mesh", p.name === "QuadGLB" ? 1 : 0, 1);
    // POSITION[0] = (-1,0,-1), NORMAL[0] = (0,1,0)
    checkNear("  v0.x", p.verts[0], 0.0 - 1.0, 0.0001);
    checkNear("  v0.z", p.verts[2], 0.0 - 1.0, 0.0001);
    checkNear("  n0.y", p.verts[4], 1.0, 0.0001);
    // baseColorFactor 0.9/0.2/0.15 -> 229/51/38
    check("  cor R (baseColorFactor)", p.cr, 229);
    check("  cor G", p.cg, 51);
  }
}

io.print("== .GLTF externo + MULTI-MATERIAL (2 primitives = 2 submeshes) ==");
{
  const ps = parseGltf(DIR + "/two.gltf");
  check("  partes (1 por primitive)", ps.length, 2);
  if (ps.length === 2) {
    check("  tris da parte 0", ps[0].triCount(), 1);
    check("  tris da parte 1", ps[1].triCount(), 1);
    check("  cor da parte 0 (Verde G)", ps[0].cg, 204);
    check("  cor da parte 1 (Azul B)", ps[1].cb, 229);
    check("  nomes distintos", ps[0].name === ps[1].name ? 0 : 1, 1);
    // As duas primitives COMPARTILHAM o accessor POSITION (6 vértices); o que
    // difere são os ÍNDICES — a 2ª usa byteOffset e aponta pro 2º triângulo.
    // Então o teste certo é nos índices, não nas posições.
    check("  parte0 indices = 0,1,2", ps[0].inds[0] * 100 + ps[0].inds[1] * 10 + ps[0].inds[2], 12);
    check("  parte1 indices = 3,4,5", ps[1].inds[0] * 100 + ps[1].inds[1] * 10 + ps[1].inds[2], 345);
    // e o vértice 3 (início do 2º triângulo) é o da direita: x = 1.0
    checkNear("  vertice 3 = triangulo da direita", ps[1].verts[3 * 8], 1.0, 0.0001);
  }
}

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
if (fail > 0) io.print("[FALHOU]");
else io.print("[PASSOU]");
