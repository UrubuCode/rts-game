// Gerador determinístico do mapa: mesma semente, mesma lista de objetos na
// mesma ordem. Servidor e clientes (entrega 2) geram o mapa localmente.
//
// A cidade é uma grade de FPS_BLOCOS_POR_LADO × FPS_BLOCOS_POR_LADO
// quarteirões de quatro tipos (torre, galpão, pátio, praça; ver docs/mapa.md).
// Caixas giradas em Y (transform.ry) colidem como OBB no motor, mas a fase
// larga do índice usa a AABB não girada (docs/mapa.md), então só há yaw
// pequeno ou em caixas quase quadradas; passarelas são retas.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import {
  FPS_TAM_CHAO, FPS_BLOCO, FPS_MEIO_QUARTEIRAO, FPS_BLOCOS_POR_LADO, FPS_ALTURA_BORDA,
  FPS_CAIXOTES_POR_BLOCO, FPS_DEGRAU_ALTURA, FPS_DEGRAUS,
  FPS_MAPA_TORRE, FPS_MAPA_GALPAO, FPS_MAPA_PATIO, FPS_MAPA_PRACA, FPS_MAPA_TIPOS,
  FPS_TORRE_LADO, FPS_TORRE_ALTURA, FPS_TORRE_ESCADA_DX0, FPS_TORRE_ESCADA_DZ, FPS_TORRE_ESCADA_PROF,
  FPS_TORRE_PLATAFORMA_DX, FPS_TORRE_PLATAFORMA_LADO, FPS_TORRE_MIRANTE_DX, FPS_TORRE_MIRANTE_DZ,
  FPS_TORRE_PASSARELA_LARG, FPS_TORRE_PASSARELA_ESP,
  FPS_GALPAO_MEIO_X, FPS_GALPAO_MEIO_Z, FPS_GALPAO_ALTURA, FPS_GALPAO_PAREDE, FPS_GALPAO_TETO, FPS_GALPAO_PORTA,
  FPS_CONTEINER_LARG, FPS_CONTEINER_ALT, FPS_CONTEINER_COMP, FPS_CONTEINER_YAW, FPS_PATIO_PASSO_X, FPS_PATIO_FILEIRA_DZ,
  FPS_PATIO_DEGRAUS, FPS_PATIO_DEGRAU_PROF,
  FPS_PRACA_PEDESTAL_LADO, FPS_PRACA_PEDESTAL_ALT, FPS_PRACA_OBELISCO_LADO, FPS_PRACA_OBELISCO_ALT,
  FPS_PRACA_RAIO_ANEL, FPS_PRACA_COBERTURA_COMP, FPS_PRACA_COBERTURA_ALT, FPS_PRACA_COBERTURA_ESP,
  FPS_PRACA_CANTEIRO_LADO, FPS_PRACA_CANTEIRO_ALT, FPS_PRACA_RAIO_POSTES, FPS_PRACA_POSTE_ALT, FPS_PRACA_POSTE_LADO,
} from "./config";
import { FPS_CAMADA_MAPA } from "./layers";

export interface FpsMapa {
  objetos: number;
  spawnX: f64[];
  spawnZ: f64[];
}

let fpsMapaSemente = 1;
let fpsMapaContagem = 0;

function fpsMapaRnd(): f64 {
  fpsMapaSemente = ((fpsMapaSemente * 1664525 + 1013904223) | 0);
  return (fpsMapaSemente >>> 0) / 4294967296.0;
}

function fpsMapaFaixa(a: f64, b: f64): f64 {
  return a + (b - a) * fpsMapaRnd();
}

/// Tipo do quarteirão (bi, bj). O padrão (bi + 2·bj) mod 4 põe os quatro
/// tipos em toda vizinhança 2 × 2; o +3 deixa a praça no centro da cidade.
export function fpsMapaTipoDoBloco(bi: number, bj: number): number {
  return (bi + 2 * bj + 3) % FPS_MAPA_TIPOS;
}

/// Uma caixa estática do mapa girada `ry` rad em Y (x, y, z = centro).
export function fpsMapaCaixaGirada(sc: Scene, nome: string, x: f64, y: f64, z: f64,
                                   sx: f64, sy: f64, sz: f64, ry: f64, r: number, g: number, b: number): void {
  const o = new GameObject(nome);
  o.stationary = 1;
  o.setMesh(1, r, g, b);
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx;
  o.transform.sy = sy;
  o.transform.sz = sz;
  o.transform.ry = ry;
  o.layer = FPS_CAMADA_MAPA;
  sc.add(o);
  fpsMapaContagem = fpsMapaContagem + 1;
}

/// Uma caixa estática do mapa, apoiada onde o chamador mandar (x, y, z = centro).
export function fpsMapaCaixa(sc: Scene, nome: string, x: f64, y: f64, z: f64,
                             sx: f64, sy: f64, sz: f64, r: number, g: number, b: number): void {
  fpsMapaCaixaGirada(sc, nome, x, y, z, sx, sy, sz, 0.0, r, g, b);
}

// ── torre: prédio alto, escada, plataforma, passarela em L, mirante ─────────
function fpsMapaTorre(sc: Scene, cx: f64, cz: f64): void {
  const alt = fpsMapaFaixa(FPS_TORRE_ALTURA * 0.8, FPS_TORRE_ALTURA * 1.2);
  fpsMapaCaixa(sc, "torre", cx, alt * 0.5, cz, FPS_TORRE_LADO, alt, FPS_TORRE_LADO, 150, 150, 160);
  // quatro muros baixos ao redor da base
  const m = FPS_TORRE_LADO * 0.5 + 3.0;
  fpsMapaCaixa(sc, "muro", cx + m, 0.6, cz, 0.4, 1.2, 5.0, 110, 120, 110);
  fpsMapaCaixa(sc, "muro", cx - m, 0.6, cz, 0.4, 1.2, 5.0, 110, 120, 110);
  fpsMapaCaixa(sc, "muro", cx, 0.6, cz + m, 5.0, 1.2, 0.4, 110, 120, 110);
  fpsMapaCaixa(sc, "muro", cx, 0.6, cz - m, 5.0, 1.2, 0.4, 110, 120, 110);
  // escada de degraus de 1 u em x até a plataforma
  let d = 0;
  while (d < FPS_DEGRAUS) {
    const h = (d + 1) * FPS_DEGRAU_ALTURA;
    fpsMapaCaixa(sc, "degrau", cx + FPS_TORRE_ESCADA_DX0 + d, h * 0.5, cz + FPS_TORRE_ESCADA_DZ,
                 1.0, h, FPS_TORRE_ESCADA_PROF, 170, 150, 110);
    d = d + 1;
  }
  const topo = FPS_DEGRAUS * FPS_DEGRAU_ALTURA;
  fpsMapaCaixa(sc, "plataforma", cx + FPS_TORRE_PLATAFORMA_DX, topo * 0.5, cz + FPS_TORRE_ESCADA_DZ,
               FPS_TORRE_PLATAFORMA_LADO, topo, FPS_TORRE_PLATAFORMA_LADO, 170, 150, 110);
  // passarela em L: perna em −z a partir do centro da plataforma, perna em +x
  // até o centro do mirante, ambas com o topo à altura da plataforma
  const yP = topo - FPS_TORRE_PASSARELA_ESP * 0.5;
  const compZ = FPS_TORRE_ESCADA_DZ - FPS_TORRE_MIRANTE_DZ;
  fpsMapaCaixa(sc, "passarela", cx + FPS_TORRE_PLATAFORMA_DX, yP, cz + FPS_TORRE_MIRANTE_DZ + compZ * 0.5,
               FPS_TORRE_PASSARELA_LARG, FPS_TORRE_PASSARELA_ESP, compZ, 190, 170, 120);
  const compX = FPS_TORRE_MIRANTE_DX - FPS_TORRE_PLATAFORMA_DX;
  fpsMapaCaixa(sc, "passarela", cx + FPS_TORRE_PLATAFORMA_DX + compX * 0.5, yP, cz + FPS_TORRE_MIRANTE_DZ,
               compX, FPS_TORRE_PASSARELA_ESP, FPS_TORRE_PASSARELA_LARG, 190, 170, 120);
  fpsMapaCaixa(sc, "mirante", cx + FPS_TORRE_MIRANTE_DX, topo * 0.5, cz + FPS_TORRE_MIRANTE_DZ,
               FPS_TORRE_PLATAFORMA_LADO, topo, FPS_TORRE_PLATAFORMA_LADO, 170, 150, 110);
}

function fpsMapaLivreTorre(dx: f64, dz: f64): boolean {
  const m = FPS_TORRE_LADO * 0.5 + 3.5;
  if (Math.abs(dx) < m && Math.abs(dz) < m) return false;                      // torre e muros
  if (dz > FPS_TORRE_ESCADA_DZ - FPS_TORRE_ESCADA_PROF - 0.5) return false;   // faixa da escada
  // faixa da passarela em L e do mirante (com folga de 2 u)
  const meioP = FPS_TORRE_PLATAFORMA_LADO * 0.5 + 2.0;
  if (dx > FPS_TORRE_PLATAFORMA_DX - meioP && dx < FPS_TORRE_MIRANTE_DX + meioP &&
      dz > FPS_TORRE_MIRANTE_DZ - meioP) return false;
  return true;
}

// ── galpão: paredes com teto, porta ao sul e a leste, paredes internas ──────
function fpsMapaGalpao(sc: Scene, cx: f64, cz: f64): void {
  const hx = FPS_GALPAO_MEIO_X; const hz = FPS_GALPAO_MEIO_Z;
  const alt = FPS_GALPAO_ALTURA; const e = FPS_GALPAO_PAREDE; const y = alt * 0.5;
  const meiaPorta = FPS_GALPAO_PORTA * 0.5;
  fpsMapaCaixa(sc, "parede", cx, y, cz + hz, hx * 2.0 + e, alt, e, 130, 120, 110);          // norte
  fpsMapaCaixa(sc, "parede", cx - hx, y, cz, e, alt, hz * 2.0 + e, 130, 120, 110);          // oeste
  const lenS = hx - meiaPorta;                                                              // sul, com porta
  fpsMapaCaixa(sc, "parede", cx - meiaPorta - lenS * 0.5, y, cz - hz, lenS, alt, e, 130, 120, 110);
  fpsMapaCaixa(sc, "parede", cx + meiaPorta + lenS * 0.5, y, cz - hz, lenS, alt, e, 130, 120, 110);
  const lenL = hz - meiaPorta;                                                              // leste, com porta
  fpsMapaCaixa(sc, "parede", cx + hx, y, cz - meiaPorta - lenL * 0.5, e, alt, lenL, 130, 120, 110);
  fpsMapaCaixa(sc, "parede", cx + hx, y, cz + meiaPorta + lenL * 0.5, e, alt, lenL, 130, 120, 110);
  fpsMapaCaixa(sc, "teto", cx, alt + FPS_GALPAO_TETO * 0.5, cz, hx * 2.0 + e, FPS_GALPAO_TETO, hz * 2.0 + e, 100, 95, 90);
  // paredes internas: A ao longo de z (x = −4, do sul até z = +2), B ao longo
  // de x (z = +3, da metade até o leste), C curta (x = +4, ao sul)
  fpsMapaCaixa(sc, "divisoria", cx - 4.0, y, cz - 3.0, e, alt, 10.0, 140, 130, 120);
  fpsMapaCaixa(sc, "divisoria", cx + 6.0, y, cz + 3.0, 12.0, alt, e, 140, 130, 120);
  fpsMapaCaixa(sc, "divisoria", cx + 4.0, y, cz - 5.5, e, alt, 5.0, 140, 130, 120);
  fpsMapaCaixa(sc, "coluna", cx - 8.0, y, cz + 4.0, 0.6, alt, 0.6, 120, 110, 100);
  fpsMapaCaixa(sc, "coluna", cx + 8.0, y, cz - 5.0, 0.6, alt, 0.6, 120, 110, 100);
}

function fpsMapaLivreGalpao(dx: f64, dz: f64): boolean {
  const hx = FPS_GALPAO_MEIO_X; const hz = FPS_GALPAO_MEIO_Z;
  const fora = Math.abs(dx) > hx + 1.0 || Math.abs(dz) > hz + 1.0;
  if (fora) {
    if (Math.abs(dx) < FPS_GALPAO_PORTA && dz < 0.0 - hz) return false;   // frente da porta sul
    if (Math.abs(dz) < FPS_GALPAO_PORTA && dx > hx) return false;         // frente da porta leste
    return true;
  }
  // dentro: só no salão grande (a leste da divisória A, ao sul da B), longe da C e das portas
  if (dx < -3.0 || dx > 11.0 || dz < -7.0 || dz > 2.0) return false;
  if (Math.abs(dx - 4.0) < 1.2 && dz < -2.5) return false;
  if (Math.abs(dx) < 2.0 && dz < -5.0) return false;
  if (Math.abs(dz) < 2.0 && dx > 9.0) return false;
  return true;
}

// ── pátio: duas fileiras de contêineres, três soltos com yaw leve, pilha com escada
function fpsMapaConteiner(sc: Scene, x: f64, y: f64, z: f64, ry: f64, cor: number): void {
  if (cor === 0) fpsMapaCaixaGirada(sc, "conteiner", x, y, z, FPS_CONTEINER_LARG, FPS_CONTEINER_ALT, FPS_CONTEINER_COMP, ry, 180, 80, 60);
  else if (cor === 1) fpsMapaCaixaGirada(sc, "conteiner", x, y, z, FPS_CONTEINER_LARG, FPS_CONTEINER_ALT, FPS_CONTEINER_COMP, ry, 60, 110, 170);
  else if (cor === 2) fpsMapaCaixaGirada(sc, "conteiner", x, y, z, FPS_CONTEINER_LARG, FPS_CONTEINER_ALT, FPS_CONTEINER_COMP, ry, 90, 150, 80);
  else fpsMapaCaixaGirada(sc, "conteiner", x, y, z, FPS_CONTEINER_LARG, FPS_CONTEINER_ALT, FPS_CONTEINER_COMP, ry, 200, 160, 60);
}

function fpsMapaPatio(sc: Scene, cx: f64, cz: f64): void {
  const y = FPS_CONTEINER_ALT * 0.5;
  const p = FPS_PATIO_PASSO_X;
  let k = 0;
  while (k < 4) {
    fpsMapaConteiner(sc, cx + (k - 1.5) * p, y, cz - FPS_PATIO_FILEIRA_DZ, 0.0, k);           // fileira sul
    fpsMapaConteiner(sc, cx + (k - 1.0) * p, y, cz + FPS_PATIO_FILEIRA_DZ, 0.0, (k + 2) % 4); // fileira norte, deslocada
    k = k + 1;
  }
  // três soltos girados no meio, ângulos diferentes
  fpsMapaConteiner(sc, cx - 9.0, y, cz, FPS_CONTEINER_YAW, 1);
  fpsMapaConteiner(sc, cx, y, cz, 0.0 - FPS_CONTEINER_YAW, 3);
  fpsMapaConteiner(sc, cx + 9.0, y, cz, FPS_CONTEINER_YAW * 0.5, 0);
  // pilha: segundo contêiner sobre o último da fileira sul, com escada de caixas ao lado
  const xPilha = cx + 1.5 * p;
  fpsMapaConteiner(sc, xPilha, FPS_CONTEINER_ALT * 1.5, cz - FPS_PATIO_FILEIRA_DZ, FPS_CONTEINER_YAW, 2);
  const x0 = xPilha + FPS_CONTEINER_LARG * 0.5 + FPS_PATIO_DEGRAU_PROF * 0.5;
  const sobe = FPS_CONTEINER_ALT / FPS_PATIO_DEGRAUS;
  let s = 0;
  while (s < FPS_PATIO_DEGRAUS) {
    const h = (FPS_PATIO_DEGRAUS - s) * sobe;
    fpsMapaCaixa(sc, "degrau", x0 + s * FPS_PATIO_DEGRAU_PROF, h * 0.5, cz - FPS_PATIO_FILEIRA_DZ,
                 FPS_PATIO_DEGRAU_PROF, h, FPS_CONTEINER_COMP * 0.5, 170, 150, 110);
    s = s + 1;
  }
}

function fpsMapaLivrePatio(dx: f64, dz: f64): boolean {
  const meioComp = FPS_CONTEINER_COMP * 0.5;
  if (Math.abs(Math.abs(dz) - FPS_PATIO_FILEIRA_DZ) < meioComp + 1.0) return false;   // fileiras e escada
  if (Math.abs(dz) < meioComp + 1.5 && (Math.abs(dx + 9.0) < 3.5 || Math.abs(dx) < 3.5 || Math.abs(dx - 9.0) < 3.5)) return false;
  return true;
}

// ── praça: pedestal em degraus, obelisco, coberturas, canteiros a 45°, postes ─
function fpsMapaPraca(sc: Scene, cx: f64, cz: f64): void {
  const a = FPS_PRACA_PEDESTAL_ALT;
  fpsMapaCaixa(sc, "pedestal", cx, a * 0.5, cz, FPS_PRACA_PEDESTAL_LADO, a, FPS_PRACA_PEDESTAL_LADO, 160, 160, 150);
  fpsMapaCaixa(sc, "pedestal", cx, a * 1.5, cz, FPS_PRACA_PEDESTAL_LADO * 0.6, a, FPS_PRACA_PEDESTAL_LADO * 0.6, 165, 165, 155);
  fpsMapaCaixa(sc, "obelisco", cx, a * 2.0 + FPS_PRACA_OBELISCO_ALT * 0.5, cz,
               FPS_PRACA_OBELISCO_LADO, FPS_PRACA_OBELISCO_ALT, FPS_PRACA_OBELISCO_LADO, 120, 120, 130);
  // coberturas retas nos pontos cardeais (tangentes ao anel sem girar) e
  // canteiros quadrados a 45° nas diagonais
  let k = 0;
  while (k < 4) {
    const alt = fpsMapaFaixa(FPS_PRACA_COBERTURA_ALT * 0.8, FPS_PRACA_COBERTURA_ALT * 1.2);
    const aoLongoDeZ = (k % 2) === 0;
    const px = aoLongoDeZ ? (k === 0 ? FPS_PRACA_RAIO_ANEL : 0.0 - FPS_PRACA_RAIO_ANEL) : 0.0;
    const pz = aoLongoDeZ ? 0.0 : (k === 1 ? FPS_PRACA_RAIO_ANEL : 0.0 - FPS_PRACA_RAIO_ANEL);
    fpsMapaCaixa(sc, "cobertura", cx + px, alt * 0.5, cz + pz,
                 aoLongoDeZ ? FPS_PRACA_COBERTURA_ESP : FPS_PRACA_COBERTURA_COMP, alt,
                 aoLongoDeZ ? FPS_PRACA_COBERTURA_COMP : FPS_PRACA_COBERTURA_ESP, 100, 140, 100);
    const ang = (k + 0.5) * Math.PI * 0.5;
    fpsMapaCaixaGirada(sc, "canteiro", cx + Math.cos(ang) * FPS_PRACA_RAIO_ANEL, FPS_PRACA_CANTEIRO_ALT * 0.5,
                       cz + Math.sin(ang) * FPS_PRACA_RAIO_ANEL, FPS_PRACA_CANTEIRO_LADO, FPS_PRACA_CANTEIRO_ALT,
                       FPS_PRACA_CANTEIRO_LADO, Math.PI * 0.25, 90, 130, 80);
    k = k + 1;
  }
  k = 0;
  while (k < 4) {
    const ang = (k + 0.5) * Math.PI * 0.5;
    fpsMapaCaixa(sc, "poste", cx + Math.cos(ang) * FPS_PRACA_RAIO_POSTES, FPS_PRACA_POSTE_ALT * 0.5,
                 cz + Math.sin(ang) * FPS_PRACA_RAIO_POSTES, FPS_PRACA_POSTE_LADO, FPS_PRACA_POSTE_ALT, FPS_PRACA_POSTE_LADO, 80, 80, 90);
    k = k + 1;
  }
}

function fpsMapaLivrePraca(dx: f64, dz: f64): boolean {
  const r = Math.sqrt(dx * dx + dz * dz);
  if (r < FPS_PRACA_PEDESTAL_LADO * 0.5 + 1.5) return false;
  if (Math.abs(r - FPS_PRACA_RAIO_ANEL) < FPS_PRACA_COBERTURA_COMP * 0.5 + 1.0) return false;
  return true;
}

function fpsMapaLivre(tipo: number, dx: f64, dz: f64): boolean {
  if (tipo === FPS_MAPA_TORRE) return fpsMapaLivreTorre(dx, dz);
  if (tipo === FPS_MAPA_GALPAO) return fpsMapaLivreGalpao(dx, dz);
  if (tipo === FPS_MAPA_PATIO) return fpsMapaLivrePatio(dx, dz);
  return fpsMapaLivrePraca(dx, dz);
}

function fpsMapaQuarteirao(sc: Scene, cx: f64, cz: f64, tipo: number, nCaixotes: number): void {
  if (tipo === FPS_MAPA_TORRE) fpsMapaTorre(sc, cx, cz);
  else if (tipo === FPS_MAPA_GALPAO) fpsMapaGalpao(sc, cx, cz);
  else if (tipo === FPS_MAPA_PATIO) fpsMapaPatio(sc, cx, cz);
  else fpsMapaPraca(sc, cx, cz);

  // caixotes espalhados onde o quarteirão deixa (o pátio já é cheio: metade)
  const n = tipo === FPS_MAPA_PATIO ? ((nCaixotes / 2) | 0) : nCaixotes;
  let c = 0;
  while (c < n) {
    let dx = 0.0;
    let dz = 0.0;
    let tentativa = 0;
    while (tentativa < 10) {
      dx = fpsMapaFaixa(-FPS_MEIO_QUARTEIRAO, FPS_MEIO_QUARTEIRAO);
      dz = fpsMapaFaixa(-FPS_MEIO_QUARTEIRAO, FPS_MEIO_QUARTEIRAO);
      if (fpsMapaLivre(tipo, dx, dz)) tentativa = 10;
      else tentativa = tentativa + 1;
    }
    const s = fpsMapaFaixa(0.8, 2.0);
    fpsMapaCaixa(sc, "caixote", cx + dx, s * 0.5, cz + dz, s, s, s, 140, 100, 60);
    c = c + 1;
  }
}

/// Gera o mapa em `sc`. `escala` multiplica os caixotes; `escala <= 0` gera só
/// chão, bordas e renascimentos (o mapa vazio dos testes).
export function fpsGerarMapa(sc: Scene, semente: number, escala: f64): FpsMapa {
  fpsMapaSemente = semente | 0;
  fpsMapaContagem = 0;
  const meia = FPS_TAM_CHAO * 0.5;
  const hb = FPS_ALTURA_BORDA * 0.5;

  fpsMapaCaixa(sc, "chao", 0.0, -0.5, 0.0, FPS_TAM_CHAO, 1.0, FPS_TAM_CHAO, 70, 80, 70);
  fpsMapaCaixa(sc, "borda", 0.0, hb, meia + 1.0, FPS_TAM_CHAO + 4.0, FPS_ALTURA_BORDA, 2.0, 90, 90, 100);
  fpsMapaCaixa(sc, "borda", 0.0, hb, -meia - 1.0, FPS_TAM_CHAO + 4.0, FPS_ALTURA_BORDA, 2.0, 90, 90, 100);
  fpsMapaCaixa(sc, "borda", meia + 1.0, hb, 0.0, 2.0, FPS_ALTURA_BORDA, FPS_TAM_CHAO + 4.0, 90, 90, 100);
  fpsMapaCaixa(sc, "borda", -meia - 1.0, hb, 0.0, 2.0, FPS_ALTURA_BORDA, FPS_TAM_CHAO + 4.0, 90, 90, 100);

  const metade = (FPS_BLOCOS_POR_LADO - 1) / 2;
  if (escala > 0.0) {
    const nCaixotes = Math.round(FPS_CAIXOTES_POR_BLOCO * escala) | 0;
    let bi = 0;
    while (bi < FPS_BLOCOS_POR_LADO) {
      let bj = 0;
      while (bj < FPS_BLOCOS_POR_LADO) {
        fpsMapaQuarteirao(sc, (bi - metade) * FPS_BLOCO, (bj - metade) * FPS_BLOCO, fpsMapaTipoDoBloco(bi, bj), nCaixotes);
        bj = bj + 1;
      }
      bi = bi + 1;
    }
  }

  // renascimentos nos cruzamentos das ruas (8 × 8 = 64)
  const spawnX: f64[] = [];
  const spawnZ: f64[] = [];
  let i = 0;
  while (i < FPS_BLOCOS_POR_LADO - 1) {
    let j = 0;
    while (j < FPS_BLOCOS_POR_LADO - 1) {
      spawnX.push((i - metade) * FPS_BLOCO + FPS_BLOCO * 0.5);
      spawnZ.push((j - metade) * FPS_BLOCO + FPS_BLOCO * 0.5);
      j = j + 1;
    }
    i = i + 1;
  }
  return { objetos: fpsMapaContagem, spawnX: spawnX, spawnZ: spawnZ };
}
