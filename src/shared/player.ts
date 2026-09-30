// Movimento cinemático do jogador: só números entram e saem, e a colisão vem
// das consultas do índice espacial (máscara MAPA). Determinístico: o mesmo
// input produz o mesmo estado no cliente e no servidor.
import { Scene } from "@engine/core/scene";
import { createRaycastHit, createOverlapHit, OverlapHit } from "@engine/core/spatial_queries";
import {
  FPS_RAIO_CORPO, FPS_ALTURA_CORPO, FPS_VEL_ANDAR, FPS_ACEL_AR, FPS_VEL_PULO, FPS_GRAVIDADE,
  FPS_VEL_QUEDA_MAX, FPS_ITER_SEPARACAO, FPS_MAX_HITS_CORPO, FPS_ALTURA_DEGRAU, FPS_DIST_CHAO,
  FPS_PITCH_MAX, FPS_VIDA_MAX, FPS_PENTE,
} from "./config";
import { FPS_CAMADA_MAPA } from "./layers";
import { FpsPlayerInput } from "./input";
import { fpsRaio, fpsEsfera } from "./consultas";

export interface FpsPlayerState {
  id: number;
  x: f64; y: f64; z: f64;          // sola do pé
  vx: f64; vy: f64; vz: f64;
  yaw: f64; pitch: f64;
  noChao: boolean;
  vida: f64;
  vivo: boolean;
  tempoRenascer: f64;
  municao: number;
  tempoRecarga: f64;
  cadenciaRestante: f64;
  granadasVivas: number;
  tempoGranada: f64;
  abates: number;
  mortes: number;
  ultimoInputSeq: number;
  /// Tiros disparados (só conta; o cliente usa para animar o tiro).
  disparos: number;
}

export function fpsNovoJogador(id: number, x: f64, y: f64, z: f64): FpsPlayerState {
  return {
    id: id, x: x, y: y, z: z, vx: 0.0, vy: 0.0, vz: 0.0, yaw: 0.0, pitch: 0.0,
    noChao: false, vida: FPS_VIDA_MAX, vivo: true, tempoRenascer: 0.0,
    municao: FPS_PENTE, tempoRecarga: 0.0, cadenciaRestante: 0.0,
    granadasVivas: 0, tempoGranada: 0.0, abates: 0, mortes: 0, ultimoInputSeq: 0, disparos: 0,
  };
}

const fpsPlayerHits: OverlapHit[] = [];
let fpsPlayerK = 0;
while (fpsPlayerK < FPS_MAX_HITS_CORPO) { fpsPlayerHits.push(createOverlapHit()); fpsPlayerK = fpsPlayerK + 1; }
const fpsPlayerRaio = createRaycastHit();

const FPS_EMPURRAO_CHAO = 1;   // alguma separação empurrou para cima (apoio)
const FPS_EMPURRAO_TETO = 2;   // alguma separação empurrou para baixo (teto)
const FPS_SEPARACAO_INCOMPLETA = 4;   // esgotou as iterações e ainda há penetração
const FPS_PENETRACAO_TOLERADA: f64 = 0.01;

/// Tira as duas esferas do corpo de dentro do mapa. Devolve os bits acima.
function fpsSeparar(p: FpsPlayerState, sc: Scene): number {
  let flags = 0;
  let it = 0;
  while (it < FPS_ITER_SEPARACAO) {
    let mexeu = false;
    let e = 0;
    while (e < 2) {
      const cy = e === 0 ? p.y + FPS_RAIO_CORPO : p.y + FPS_ALTURA_CORPO - FPS_RAIO_CORPO;
      const n = fpsEsfera(p.x, cy, p.z, FPS_RAIO_CORPO, fpsPlayerHits, FPS_MAX_HITS_CORPO, FPS_CAMADA_MAPA, sc);
      const lim = n < FPS_MAX_HITS_CORPO ? n : FPS_MAX_HITS_CORPO;
      let i = 0;
      while (i < lim) {
        const h = fpsPlayerHits[i];
        // a normal aponta da esfera para dentro do objeto: sair é o sentido oposto
        p.x = p.x - h.normal[0] * h.depth;
        p.y = p.y - h.normal[1] * h.depth;
        p.z = p.z - h.normal[2] * h.depth;
        if (0.0 - h.normal[1] > 0.7) flags = flags | FPS_EMPURRAO_CHAO;
        if (h.normal[1] > 0.7) flags = flags | FPS_EMPURRAO_TETO;
        mexeu = true;
        i = i + 1;
      }
      e = e + 1;
    }
    if (mexeu) it = it + 1; else it = FPS_ITER_SEPARACAO + 1;
  }
  // esgotou as iterações ainda mexendo: pode ser uma fresta mais estreita que
  // o corpo, onde duas paredes empurram em sentidos opostos para sempre
  if (it === FPS_ITER_SEPARACAO && fpsPiorPenetracao(p, sc) > FPS_PENETRACAO_TOLERADA) {
    flags = flags | FPS_SEPARACAO_INCOMPLETA;
  }
  return flags;
}

function fpsPiorPenetracao(p: FpsPlayerState, sc: Scene): f64 {
  let pior = 0.0;
  let e = 0;
  while (e < 2) {
    const cy = e === 0 ? p.y + FPS_RAIO_CORPO : p.y + FPS_ALTURA_CORPO - FPS_RAIO_CORPO;
    const n = fpsEsfera(p.x, cy, p.z, FPS_RAIO_CORPO, fpsPlayerHits, FPS_MAX_HITS_CORPO, FPS_CAMADA_MAPA, sc);
    const lim = n < FPS_MAX_HITS_CORPO ? n : FPS_MAX_HITS_CORPO;
    let i = 0;
    while (i < lim) { if (fpsPlayerHits[i].depth > pior) pior = fpsPlayerHits[i].depth; i = i + 1; }
    e = e + 1;
  }
  return pior;
}

/// O deslocamento horizontal foi barrado: tenta subir um degrau de até
/// FPS_ALTURA_DEGRAU. Devolve true se subiu.
function fpsTentarDegrau(p: FpsPlayerState, x0: f64, y0: f64, z0: f64, dx: f64, dz: f64, sc: Scene): boolean {
  const len = Math.sqrt(dx * dx + dz * dz);
  const ux = dx / len;
  const uz = dz / len;
  const sx = x0 + ux * (FPS_RAIO_CORPO + 0.1);
  const sz = z0 + uz * (FPS_RAIO_CORPO + 0.1);
  const topo = y0 + FPS_ALTURA_DEGRAU + 0.05;
  if (!fpsRaio(sx, topo, sz, 0.0, -1.0, 0.0, FPS_ALTURA_DEGRAU + 0.05, fpsPlayerRaio, FPS_CAMADA_MAPA, sc)) return false;
  const pisoY = fpsPlayerRaio.point[1];
  const subida = pisoY - y0;
  if (subida < 0.01 || subida > FPS_ALTURA_DEGRAU) return false;
  const bx = p.x; const by = p.y; const bz = p.z;
  p.x = x0 + dx;
  p.z = z0 + dz;
  p.y = pisoY + 0.001;
  fpsSeparar(p, sc);
  const ax = p.x - x0; const az = p.z - z0;
  if (ax * ax + az * az < (dx * dx + dz * dz) * 0.25) {
    p.x = bx; p.y = by; p.z = bz;
    return false;
  }
  return true;
}

function fpsChecarChao(p: FpsPlayerState, estavaNoChao: boolean, apoiado: boolean, sc: Scene): void {
  if (p.vy > 0.0 && !apoiado) { p.noChao = false; return; }
  const gruda = estavaNoChao && p.vy <= 0.0;
  const alcance = gruda ? FPS_ALTURA_DEGRAU + 0.05 : FPS_DIST_CHAO + 0.05;
  if (fpsRaio(p.x, p.y + 0.05, p.z, 0.0, -1.0, 0.0, alcance, fpsPlayerRaio, FPS_CAMADA_MAPA, sc)) {
    const vao = p.y - fpsPlayerRaio.point[1];
    if (vao <= FPS_DIST_CHAO || (gruda && vao <= FPS_ALTURA_DEGRAU)) {
      p.y = fpsPlayerRaio.point[1];
      if (p.vy < 0.0) p.vy = 0.0;
      p.noChao = true;
      return;
    }
  }
  p.noChao = apoiado;
}

export function fpsSimulatePlayer(p: FpsPlayerState, inp: FpsPlayerInput, dt: f64, sc: Scene): void {
  p.ultimoInputSeq = inp.seq;
  p.yaw = inp.yaw;
  let pitch = inp.pitch;
  if (pitch > FPS_PITCH_MAX) pitch = FPS_PITCH_MAX;
  if (pitch < 0.0 - FPS_PITCH_MAX) pitch = 0.0 - FPS_PITCH_MAX;
  p.pitch = pitch;
  if (!p.vivo) return;

  // 1. intenção: frente = (sin yaw, cos yaw), direita = (cos yaw, -sin yaw)
  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  let wx = sy * inp.frente + cy * inp.lado;
  let wz = cy * inp.frente - sy * inp.lado;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 1.0) { wx = wx / wl; wz = wz / wl; }
  const alvoVx = wx * FPS_VEL_ANDAR;
  const alvoVz = wz * FPS_VEL_ANDAR;
  if (p.noChao) {
    p.vx = alvoVx;
    p.vz = alvoVz;
  } else {
    let k = FPS_ACEL_AR * dt;
    if (k > 1.0) k = 1.0;
    p.vx = p.vx + (alvoVx - p.vx) * k;
    p.vz = p.vz + (alvoVz - p.vz) * k;
  }

  // 2. pulo e gravidade
  const estavaNoChao = p.noChao;
  if (inp.pulo && p.noChao) { p.vy = FPS_VEL_PULO; p.noChao = false; }
  p.vy = p.vy - FPS_GRAVIDADE * dt;
  if (p.vy < 0.0 - FPS_VEL_QUEDA_MAX) p.vy = 0.0 - FPS_VEL_QUEDA_MAX;

  // 3. mover e deslizar
  const x0 = p.x; const y0 = p.y; const z0 = p.z;
  const dx = p.vx * dt;
  const dz = p.vz * dt;
  p.x = p.x + dx;
  p.y = p.y + p.vy * dt;
  p.z = p.z + dz;
  let flags = fpsSeparar(p, sc);
  if ((flags & FPS_SEPARACAO_INCOMPLETA) !== 0) {
    // não há posição válida na direção pedida: desfaz o passo horizontal
    p.x = x0;
    p.z = z0;
    p.vx = 0.0;
    p.vz = 0.0;
    flags = fpsSeparar(p, sc);
  }

  // 4. degrau
  const desejado2 = dx * dx + dz * dz;
  // progresso NA DIREÇÃO desejada: na quina de um degrau a separação empurra
  // para trás, e um recuo tem módulo grande mas progresso negativo
  const progresso = (p.x - x0) * dx + (p.z - z0) * dz;
  if (estavaNoChao && desejado2 > 0.00000001 && progresso < desejado2 * 0.25) {
    if (fpsTentarDegrau(p, x0, y0, z0, dx, dz, sc)) flags = flags | FPS_EMPURRAO_CHAO;
  }
  if ((flags & FPS_EMPURRAO_CHAO) !== 0 && p.vy < 0.0) p.vy = 0.0;
  if ((flags & FPS_EMPURRAO_TETO) !== 0 && p.vy > 0.0) p.vy = 0.0;

  // 5. chão
  fpsChecarChao(p, estavaNoChao, (flags & FPS_EMPURRAO_CHAO) !== 0, sc);
}
