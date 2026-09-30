// Câmera, luz e desenho da cena, compartilhados pelos dois clientes.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";
import {
  setCamBuf, setLgtBuf, setShadowBuf, setSkyBuf, setFogBuf, frustumBeginBuf, drawGPUBuf, inFrustumFast,
  CAM_FLOATS, CAM_ORTO_PADRAO, FRUSTUM_NEAR_PADRAO, FRUSTUM_FAR_PADRAO,
  DRAW_FLOATS, D_X, D_Y, D_Z, D_RX, D_RY, D_SX, D_SY, D_SZ, D_COR, D_EMISSIVO, D_TEX, D_TILE,
} from "@engine/render/gpu3d";
import { procTexture } from "@engine/render/proc_textures";
import { fpsModelos, fpsDesenharModelo } from "./modelos";
import { Ambiente, empacotarCeu } from "@engine/core/ambiente";

export const FPS_FOV: f64 = 1.2;
const FPS_LUZ_X: f64 = 60.0;
const FPS_LUZ_Y: f64 = 120.0;
const FPS_LUZ_Z: f64 = -40.0;
const FPS_LUZ_AMBIENTE: f64 = 0.35;
const FPS_SOMBRA_ALCANCE: f64 = 80.0;
const FPS_FATOR_RAIO_FRUSTUM: f64 = 0.87;

// ── câmera do quadro (layout do `setCamBuf`) ───────────────────────────────
export const FPS_CAM_X = 0;
export const FPS_CAM_Y = 1;
export const FPS_CAM_Z = 2;
export const FPS_CAM_YAW = 3;
export const FPS_CAM_PITCH = 4;
const FPS_CAM_FOV = 5;
export const FPS_CAM_ASPECTO = 6;
const FPS_CAM_NEAR = 7;
const FPS_CAM_FAR = 8;
const FPS_CAM_ORTO_TAM = 10;
/// Câmera que o cliente preenche (posição, yaw, pitch, aspecto) antes de
/// `fpsPrepararCamera`: um parâmetro em vez de sete (5+ alocam por chamada).
export const fpsCamera = new Float64Array(CAM_FLOATS);
fpsCamera[FPS_CAM_FOV] = FPS_FOV;
fpsCamera[FPS_CAM_ASPECTO] = 1.0;
fpsCamera[FPS_CAM_NEAR] = FRUSTUM_NEAR_PADRAO;
fpsCamera[FPS_CAM_FAR] = FRUSTUM_FAR_PADRAO;
fpsCamera[FPS_CAM_ORTO_TAM] = CAM_ORTO_PADRAO;
const fpsLuz = new Float64Array(4);
fpsLuz[0] = FPS_LUZ_X; fpsLuz[1] = FPS_LUZ_Y; fpsLuz[2] = FPS_LUZ_Z; fpsLuz[3] = FPS_LUZ_AMBIENTE;
const fpsAmbienteVisual = new Ambiente();
fpsAmbienteVisual.ceu.modo = "procedural";
fpsAmbienteVisual.ceu.topo[0] = 0.22; fpsAmbienteVisual.ceu.topo[1] = 0.39; fpsAmbienteVisual.ceu.topo[2] = 0.53;
fpsAmbienteVisual.ceu.horizonte[0] = 0.72; fpsAmbienteVisual.ceu.horizonte[1] = 0.76; fpsAmbienteVisual.ceu.horizonte[2] = 0.73;
empacotarCeu(fpsAmbienteVisual, fpsLuz, 0, fpsAmbienteVisual.pacote);
const fpsNeblina = new Float64Array(4);
fpsNeblina[0] = 0.72; fpsNeblina[1] = 0.76; fpsNeblina[2] = 0.73; fpsNeblina[3] = 0.0025;
/// Sombra: direção da luz, centro da caixa coberta e alcance.
const fpsSombra = new Float64Array(7);
fpsSombra[0] = 0.0 - FPS_LUZ_X; fpsSombra[1] = 0.0 - FPS_LUZ_Y; fpsSombra[2] = 0.0 - FPS_LUZ_Z;
fpsSombra[4] = 1.0; fpsSombra[6] = FPS_SOMBRA_ALCANCE;
/// Transform/material de cada objeto da cena (DRAW_FLOATS), reaproveitado.
const fpsDrawCena = new Float64Array(DRAW_FLOATS);

// ── Aparência do mapa (só no cliente: o servidor não desenha) ──────────────
// Peça do mapa (nome dado por `fpsMapaCaixa`) → textura procedural do motor,
// tiling em MUNDO (repetições por unidade: o shader repete numa caixa grande
// em vez de esticar) e cor, que MULTIPLICA a textura — por isso clara.
class FpsAparencia {
  textura: string; tile: f64; cor: number;
  constructor(textura: string, tile: f64, cor: number) { this.textura = textura; this.tile = tile; this.cor = cor; }
}
const FPS_APARENCIAS = new Map<string, FpsAparencia>([
  ["chao", new FpsAparencia("asfalto", 0.2, 0xB4B4B4)],
  ["borda", new FpsAparencia("concreto", 0.15, 0x748C91)],
  ["muro", new FpsAparencia("tijolo", 0.5, 0xF0E8E0)],
  ["parede", new FpsAparencia("tijolo", 0.5, 0xFFFFFF)],
  ["divisoria", new FpsAparencia("concreto", 0.5, 0xE8E8E8)],
  ["torre", new FpsAparencia("concreto", 0.25, 0xD8D8E4)],
  ["teto", new FpsAparencia("metal", 0.25, 0xC8CCD0)],
  ["coluna", new FpsAparencia("concreto", 0.5, 0xE0DAD0)],
  ["poste", new FpsAparencia("metal", 1.0, 0xB0B4B8)],
  ["obelisco", new FpsAparencia("concreto", 0.5, 0xF0ECE0)],
  ["pedestal", new FpsAparencia("piso", 0.5, 0xF0ECE4)],
  ["degrau", new FpsAparencia("concreto", 0.5, 0xE8E4DC)],
  ["canteiro", new FpsAparencia("piso", 0.5, 0xC8DCC0)],
  ["cobertura", new FpsAparencia("madeira", 0.5, 0xFFFFFF)],
  ["caixote", new FpsAparencia("madeira", 1.0, 0xFFFFFF)],
  ["conteiner", new FpsAparencia("metal", 0.5, 0xFFFFFF)],
  ["plataforma", new FpsAparencia("metal", 0.5, 0xE0E4E8)],
  ["passarela", new FpsAparencia("metal", 0.5, 0xE0E4E8)],
  ["mirante", new FpsAparencia("metal", 0.5, 0xE0E4E8)],
]);

// Tabela por índice da cena, preenchida incrementalmente (o mapa é estático e
// jogadores/efeitos entram no fim): uma leitura de array por objeto por frame.
let fpsAparCena: Scene | null = null;
const fpsAparTex: number[] = [];
const fpsAparTile: f64[] = [];
const fpsAparCor: number[] = [];
/// 1 = corpo de jogador ("jogador<i>" local, "remoto<netId>" em rede), resolvido
/// uma vez por objeto: a cena não o desenha, o personagem animado vem de
/// `FpsAnimacao` (src/animacao.ts), que também desenha quem está morto.
const fpsAparJogador: number[] = [];
const fpsAparModelo: number[] = [];
const fpsDrawRuas = new Float64Array(DRAW_FLOATS);
fpsDrawRuas[D_SX] = 1.0; fpsDrawRuas[D_SY] = 1.0; fpsDrawRuas[D_SZ] = 1.0;

function fpsAtualizarAparencias(win: number, scene: Scene): void {
  const objs: GameObject[] = scene.objects;
  if (fpsAparCena !== scene || fpsAparTex.length > objs.length) {
    fpsAparCena = scene;
    fpsAparTex.length = 0; fpsAparTile.length = 0; fpsAparCor.length = 0; fpsAparJogador.length = 0;
    fpsAparModelo.length = 0;
  }
  let i = fpsAparTex.length;
  while (i < objs.length) {
    const nome = objs[i].name;
    fpsAparModelo.push(nome === "caixote" ? 0 : nome === "conteiner" ? 1 : nome === "torre" ? 2 : -1);
    fpsAparJogador.push(nome.indexOf("jogador") === 0 || nome.indexOf("remoto") === 0 ? 1 : 0);
    const ap = FPS_APARENCIAS.get(nome);
    if (ap !== undefined) {
      fpsAparTex.push(procTexture(win, ap.textura));
      fpsAparTile.push(ap.tile);
      fpsAparCor.push(ap.cor);
    } else {
      fpsAparTex.push(0); fpsAparTile.push(0.0); fpsAparCor.push(0 - 1);
    }
    i = i + 1;
  }
}

/// Câmera, luz, sombra e frustum do quadro a partir de `cam` (ver `fpsCamera`).
export function fpsPrepararCamera(win: number, cam: Float64Array): void {
  setCamBuf(win, cam);
  setLgtBuf(win, fpsLuz);
  setSkyBuf(win, fpsAmbienteVisual.pacote);
  setFogBuf(win, fpsNeblina);
  fpsSombra[3] = cam[FPS_CAM_X]; fpsSombra[5] = cam[FPS_CAM_Z];
  setShadowBuf(win, fpsSombra);
  frustumBeginBuf(cam);
}

/// Desenha os objetos ativos visíveis da cena, menos `ignorar` e os corpos de
/// jogador (personagens são da `FpsAnimacao`). Devolve quantos.
export function fpsDesenharCena(win: number, scene: Scene, ignorar: GameObject | null): number {
  fpsAtualizarAparencias(win, scene);
  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;
  let desenhados = 0;
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    if (o.active !== 0 && o !== ignorar && fpsAparJogador[i] === 0) {
      const t: Transform = trs[i];
      let rmax: f64 = t.sx;
      if (t.sy > rmax) rmax = t.sy;
      if (t.sz > rmax) rmax = t.sz;
      if (inFrustumFast(t.wx, t.wy, t.wz, rmax * FPS_FATOR_RAIO_FRUSTUM) !== 0) {
        const tex = fpsAparTex[i];
        const d = fpsDrawCena;
        d[D_X] = t.wx; d[D_Y] = t.wy; d[D_Z] = t.wz; d[D_RX] = t.wrx; d[D_RY] = t.wry;
        d[D_SX] = t.sx; d[D_SY] = t.sy; d[D_SZ] = t.sz; d[D_EMISSIVO] = o.emissive;
        if (tex > 0) {
          d[D_COR] = fpsAparCor[i]; d[D_TEX] = tex; d[D_TILE] = fpsAparTile[i];
        } else {
          d[D_COR] = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0); d[D_TEX] = o.tex; d[D_TILE] = 0.0;
        }
        const modelo = fpsAparModelo[i];
        if (modelo >= 0 && fpsModelos.ambiente.length > modelo && fpsModelos.ambiente[modelo].malhas.length > 0) {
          fpsDesenharModelo(win, fpsModelos.ambiente[modelo], d);
        } else {
          drawGPUBuf(win, o.meshKind, d);
        }
        desenhados = desenhados + 1;
      }
    }
    i = i + 1;
  }
  // Only the populated city has street surfacing; scale-zero test maps stay empty.
  if (fpsModelos.ambiente.length > 3 && objs.length > 100) {
    fpsDesenharModelo(win, fpsModelos.ambiente[3], fpsDrawRuas);
  }
  return desenhados;
}
