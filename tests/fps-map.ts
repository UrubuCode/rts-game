// Testes do gerador de mapa do FPS (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { setSpatialScene, spatialRebuildIndex, createOverlapHit, createRaycastHit, OverlapHit } from "@engine/core/spatial_queries";
import { fpsGerarMapa, fpsMapaTipoDoBloco } from "../src/shared/map";
import { fpsEsfera, fpsRaio } from "../src/shared/consultas";
import { FPS_CAMADA_MAPA } from "../src/shared/layers";
import { fpsNovoJogador, fpsSimulatePlayer } from "../src/shared/player";
import { fpsInputVazio } from "../src/shared/input";
import {
  FPS_BLOCO, FPS_BLOCOS_POR_LADO, FPS_DEGRAUS, FPS_DEGRAU_ALTURA, FPS_TICK_DT,
  FPS_MAPA_TORRE, FPS_MAPA_GALPAO, FPS_TORRE_ESCADA_DX0, FPS_TORRE_ESCADA_DZ, FPS_TORRE_PLATAFORMA_DX,
  FPS_TORRE_MIRANTE_DX, FPS_TORRE_MIRANTE_DZ, FPS_GALPAO_ALTURA, FPS_GALPAO_MEIO_Z, FPS_GALPAO_PORTA,
  FPS_MAPA_PATIO, FPS_CONTEINER_LARG, FPS_CONTEINER_COMP, FPS_CONTEINER_YAW,
} from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function assinatura(sc: Scene): number {
  let h = 17;
  let i = 0;
  while (i < sc.objects.length) {
    const t = sc.objects[i].transform;
    h = ((h * 31) + Math.round(t.px * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.py * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.pz * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.sx * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.sy * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.sz * 1000.0)) | 0;
    i = i + 1;
  }
  return h;
}

io.print("=== fps-map ===");
const a = new Scene("mapa_a");
const ma = fpsGerarMapa(a, 123, 1.0);
const b = new Scene("mapa_b");
fpsGerarMapa(b, 123, 1.0);
const c = new Scene("mapa_c");
fpsGerarMapa(c, 124, 1.0);

check("mesma semente gera o mesmo mapa", a.objects.length === b.objects.length && assinatura(a) === assinatura(b));
check("semente diferente gera outro mapa", assinatura(a) !== assinatura(c));
check("contagem perto de 3.000 estáticos", ma.objetos >= 2900 && ma.objetos <= 3100 && ma.objetos === a.objects.length,
      "objetos=" + ma.objetos + " cena=" + a.objects.length);
check("64 pontos de renascimento", ma.spawnX.length === 64 && ma.spawnZ.length === 64);

let estaticos = 0;
let i = 0;
while (i < a.objects.length) { if (a.objects[i].stationary !== 0 && a.objects[i].layer === FPS_CAMADA_MAPA) estaticos = estaticos + 1; i = i + 1; }
check("todo objeto do mapa é estático na camada MAPA", estaticos === a.objects.length);

a.computeWorld();
setSpatialScene(a);
spatialRebuildIndex(a);
const hits: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];
let ocupados = 0;
i = 0;
while (i < ma.spawnX.length) {
  if (fpsEsfera(ma.spawnX[i], 1.0, ma.spawnZ[i], 0.5, hits, 4, FPS_CAMADA_MAPA, a) > 0) ocupados = ocupados + 1;
  i = i + 1;
}
check("pontos de renascimento livres de geometria", ocupados === 0, "ocupados=" + ocupados);

// ── quarteirões com identidade ────────────────────────────────────────────
let girados = 0;
i = 0;
while (i < a.objects.length) { if (a.objects[i].transform.ry !== 0.0) girados = girados + 1; i = i + 1; }
check("existem caixas giradas em Y (ry != 0)", girados >= 50, "girados=" + girados);

// renascimento com folga para o corpo inteiro (esfera de 1,0 a 1,0 de altura)
ocupados = 0;
i = 0;
while (i < ma.spawnX.length) {
  if (fpsEsfera(ma.spawnX[i], 1.0, ma.spawnZ[i], 1.0, hits, 4, FPS_CAMADA_MAPA, a) > 0) ocupados = ocupados + 1;
  i = i + 1;
}
check("renascimentos livres com folga de 1,0", ocupados === 0, "ocupados=" + ocupados);

function centroBloco(tipo: number, eixo: number): f64 {
  const metade = (FPS_BLOCOS_POR_LADO - 1) / 2;
  let bi = 0;
  while (bi < FPS_BLOCOS_POR_LADO) {
    let bj = 0;
    while (bj < FPS_BLOCOS_POR_LADO) {
      if (fpsMapaTipoDoBloco(bi, bj) === tipo) return ((eixo === 0 ? bi : bj) - metade) * FPS_BLOCO;
      bj = bj + 1;
    }
    bi = bi + 1;
  }
  return 0.0;
}

// torre: sobe a escada até a plataforma e atravessa a passarela diagonal até o mirante
{
  const cx = centroBloco(FPS_MAPA_TORRE, 0);
  const cz = centroBloco(FPS_MAPA_TORRE, 1);
  const topo = FPS_DEGRAUS * FPS_DEGRAU_ALTURA;
  const p = fpsNovoJogador(0, cx + FPS_TORRE_ESCADA_DX0 - 2.5, 0.0, cz + FPS_TORRE_ESCADA_DZ);
  const inp = fpsInputVazio();
  inp.frente = 1;
  inp.yaw = Math.PI * 0.5;   // +x
  let t = 0;
  while (t < 900 && p.x < cx + FPS_TORRE_PLATAFORMA_DX) { fpsSimulatePlayer(p, inp, FPS_TICK_DT, a); t = t + 1; }
  check("torre: jogador sobe a escada até a plataforma", Math.abs(p.y - topo) < 0.05 && p.x >= cx + FPS_TORRE_PLATAFORMA_DX,
        "x=" + p.x.toFixed(2) + " y=" + p.y.toFixed(2) + " ticks=" + t);
  // passarela em L: perna em −z até a altura do mirante, depois +x até o mirante
  inp.yaw = Math.PI;   // −z
  let menorY = p.y;
  t = 0;
  while (t < 900 && p.z > cz + FPS_TORRE_MIRANTE_DZ) {
    fpsSimulatePlayer(p, inp, FPS_TICK_DT, a);
    if (p.y < menorY) menorY = p.y;
    t = t + 1;
  }
  inp.yaw = Math.PI * 0.5;   // +x
  while (t < 1800 && p.x < cx + FPS_TORRE_MIRANTE_DX) {
    fpsSimulatePlayer(p, inp, FPS_TICK_DT, a);
    if (p.y < menorY) menorY = p.y;
    t = t + 1;
  }
  check("torre: atravessa a passarela em L até o mirante sem cair", menorY > topo - 0.1 && p.x >= cx + FPS_TORRE_MIRANTE_DX &&
        Math.abs(p.z - (cz + FPS_TORRE_MIRANTE_DZ)) < 2.0,
        "x=" + p.x.toFixed(2) + " z=" + p.z.toFixed(2) + " menorY=" + menorY.toFixed(2) + " ticks=" + t);
}

// contêiner com yaw leve colide girado: esfera na quina que só existe girada
{
  const cx = centroBloco(FPS_MAPA_PATIO, 0);
  const cz = centroBloco(FPS_MAPA_PATIO, 1);
  // contêiner solto em (cx − 9, cz) com ry = +YAW. Dois pontos simétricos em
  // x, ambos dentro da caixa reta (|dx| < hx, |dz| < hz): com o giro, a
  // quina (+x, +z) recua e a (−x, +z) avança — o primeiro fica fora do OBB
  // e o segundo dentro. Mundo → local: lx = cos·dx − sin·dz, lz = sin·dx + cos·dz.
  const hx = FPS_CONTEINER_LARG * 0.5; const hz = FPS_CONTEINER_COMP * 0.5;
  const c = Math.cos(FPS_CONTEINER_YAW); const s = Math.sin(FPS_CONTEINER_YAW);
  const dx = 1.0; const dz = hz - 0.02;
  const lzFora = s * dx + c * dz; const lxFora = c * dx - s * dz;
  const lzDentro = c * dz - s * dx; const lxDentro = 0.0 - c * dx - s * dz;
  const geometriaOk = Math.abs(lxFora) < hx && Math.abs(lxDentro) < hx && lzFora > hz + 0.01 && lzDentro < hz - 0.01;
  const nFora = fpsEsfera(cx - 9.0 + dx, 1.0, cz + dz, 0.01, hits, 4, FPS_CAMADA_MAPA, a);
  const nDentro = fpsEsfera(cx - 9.0 - dx, 1.0, cz + dz, 0.01, hits, 4, FPS_CAMADA_MAPA, a);
  // O motor hoje espelha o sinal do yaw nas consultas (fase estreita usa
  // cos(−yaw); renderer e offset do colisor usam +yaw — ver docs/mapa.md), por
  // isso a asserção é "exatamente um dos dois toca", não qual deles.
  check("pátio: contêiner com yaw colide como OBB, não como a caixa reta", geometriaOk && nFora + nDentro === 1,
        "geometriaOk=" + geometriaOk + " lzFora=" + lzFora.toFixed(3) + " lzDentro=" + lzDentro.toFixed(3) + " hitsFora=" + nFora + " hitsDentro=" + nDentro);
}

// galpão: tem teto e uma porta por onde o corpo passa
{
  const cx = centroBloco(FPS_MAPA_GALPAO, 0);
  const cz = centroBloco(FPS_MAPA_GALPAO, 1);
  const raio = createRaycastHit();
  const teto = fpsRaio(cx, 1.0, cz, 0.0, 1.0, 0.0, FPS_GALPAO_ALTURA + 1.0, raio, FPS_CAMADA_MAPA, a);
  check("galpão: raio para cima acha o teto", teto && raio.point[1] > FPS_GALPAO_ALTURA - 0.5, "hit=" + teto);
  const z0 = cz - FPS_GALPAO_MEIO_Z - 4.0;
  const porta = fpsRaio(cx, 1.0, z0, 0.0, 0.0, 1.0, 6.0, raio, FPS_CAMADA_MAPA, a);
  const parede = fpsRaio(cx + FPS_GALPAO_PORTA * 0.5 + 1.0, 1.0, z0, 0.0, 0.0, 1.0, 6.0, raio, FPS_CAMADA_MAPA, a);
  check("galpão: a porta é vão e ao lado é parede", !porta && parede, "porta=" + porta + " parede=" + parede);
}

const meio = new Scene("mapa_meio");
check("escala 0,5 gera menos objetos", fpsGerarMapa(meio, 123, 0.5).objetos < ma.objetos);
const vazio = new Scene("mapa_vazio");
const mv = fpsGerarMapa(vazio, 123, 0.0);
check("escala 0 gera só chão e 4 bordas, com os mesmos 64 renascimentos", mv.objetos === 5 && mv.spawnX.length === 64,
      "objetos=" + mv.objetos);

if (falhas === 0) io.print("[PASSOU] fps-map"); else io.print("[FALHOU] fps-map: " + falhas + " falha(s)");
