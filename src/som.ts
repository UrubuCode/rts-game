// Som do cliente (spec 2026-09-27 §7). Só o cliente toca: `src/shared` e o
// servidor seguem sem áudio. Os gatilhos são o que o cliente já vê — o anel
// de efeitos do FpsWorld (tiro = traçador, impacto = marca, explosão) e o
// estado dos jogadores (passos) —, sem alocação por quadro e com funções de
// até 4 parâmetros.
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { tocarClipe } from "@engine/audio/audio";
import { AudioClip, toneClip, taxaDosClipes, FORMA_RUIDO } from "@engine/audio/clip";
import { Audio, audioQuadro } from "@engine/audio/audio_system";
import { pedidoPadrao, PEDIDO_VOLUME, PEDIDO_PITCH, PEDIDO_LACO, PEDIDO_GRUPO, PEDIDO_FLAGS, PEDIDO_X, PEDIDO_Y,
         PEDIDO_Z, PEDIDO_BLEND, PEDIDO_MIN, PEDIDO_MAX, PEDIDO_FLOATS, FLAG_3D, FLAG_ONESHOT } from "@engine/audio/vozes";
import { grupoIndex, Mixer } from "@engine/audio/mixer_grupos";
import { FpsWorld } from "./shared/world";
import { FPS_EFEITO_MARCA, FPS_EFEITO_TRACADOR, FPS_EFEITO_EXPLOSAO, FPS_POOL_EFEITOS, FPS_ALTURA_OLHO } from "./shared/config";

export const FPS_SOM_PASSO_DIST: f64 = 2.2;
export const FPS_SOM_BLEND_TIRO_PROPRIO: f64 = 0.3;
export const FPS_SOM_VARIACAO_TIRO: f64 = 0.03;
export const FPS_SOM_PITCH_PASSO_MIN: f64 = 0.95;
export const FPS_SOM_PITCH_PASSO_MAX: f64 = 1.05;
export const FPS_SOM_MAX_TIRO: f64 = 120.0;
export const FPS_SOM_MAX_IMPACTO: f64 = 60.0;
export const FPS_SOM_MAX_EXPLOSAO: f64 = 250.0;
export const FPS_SOM_MIN_EXPLOSAO: f64 = 5.0;
export const FPS_SOM_MAX_PASSO: f64 = 25.0;
/// Traçador que nasce a menos disto do olho do humano é o tiro dele.
export const FPS_SOM_DIST_PROPRIO: f64 = 1.5;
/// Deslocamento num quadro acima disto é teleporte (renascer), não passo.
export const FPS_SOM_SALTO_MAX: f64 = 5.0;
export const FPS_SOM_MUSICA_S: f64 = 8.0;
export const FPS_SOM_CONFIG: string = "config/audio.json";
const FPS_SOM_VOL_MUSICA_PADRAO: f64 = 0.4;
/// Acorde do laço de música (Hz): inteiros de ciclos em 8 s, para o laço fechar sem clique.
const FPS_SOM_ACORDE: f64[] = [220.0, 262.0, 330.0];
const FPS_SOM_DESAFINO_R: f64 = 0.125;
const FPS_SOM_TREMOLO_HZ: f64 = 0.25;
const FPS_SOM_AMP_NOTA: f64 = 0.12;

export class FpsSom {
  humano: number = 0;
  /// [x, y, z, yaw, pitch] do olho, preenchida pelo cliente a cada quadro.
  pose: Float64Array = new Float64Array(5);
  pedido: Float64Array = new Float64Array(PEDIDO_FLOATS);
  ponto: Float64Array = new Float64Array(3);
  vistoProximo: number = 0;
  acumPasso: f64[] = [];
  ultX: f64[] = [];
  ultZ: f64[] = [];
  alterna: number[] = [];
  semente: number = 12345;
  musicaId: number = 0;
  musicaMuda: boolean = false;
  grupoEfeitos: number = 0;
  grupoMusica: number = 0;
  tiro: AudioClip = new AudioClip();
  impacto: AudioClip = new AudioClip();
  explosao: AudioClip = new AudioClip();
  passo1: AudioClip = new AudioClip();
  passo2: AudioClip = new AudioClip();
  musica: AudioClip = new AudioClip();
  tocadosTiro: number = 0;
  tocadosImpacto: number = 0;
  tocadosExplosao: number = 0;
  tocadosPasso: number = 0;
  constructor() {}
}

/// O clipe do arquivo, ou um ruído gerado se ele não estiver lá (o jogo e os
/// testes funcionam sem os assets baixados).
function fpsSomClipe(caminho: string, freq: f64, dur: f64): AudioClip {
  if (fs.exists(caminho)) {
    const c = AudioClip.load(caminho);
    if (c !== null) return c;
  }
  return toneClip(freq, dur, FORMA_RUIDO);
}

/// Laço de 8 s: acorde de três senos com tremolo lento, estéreo levemente
/// desafinado na direita. Todas as frequências fecham ciclos inteiros em 8 s.
export function fpsSomMusica(taxa: number): AudioClip {
  const quadros = Math.round(FPS_SOM_MUSICA_S * taxa);
  const a = new Float32Array(quadros * 2);
  let q = 0;
  while (q < quadros) {
    const t: f64 = q / taxa;
    const trem: f64 = 0.75 + 0.25 * Math.sin(2.0 * Math.PI * FPS_SOM_TREMOLO_HZ * t);
    let l: f64 = 0.0; let r: f64 = 0.0; let k = 0;
    while (k < FPS_SOM_ACORDE.length) {
      l = l + Math.sin(2.0 * Math.PI * FPS_SOM_ACORDE[k] * t);
      r = r + Math.sin(2.0 * Math.PI * (FPS_SOM_ACORDE[k] + FPS_SOM_DESAFINO_R) * t);
      k = k + 1;
    }
    a[q * 2] = l * FPS_SOM_AMP_NOTA * trem; a[q * 2 + 1] = r * FPS_SOM_AMP_NOTA * trem;
    q = q + 1;
  }
  return AudioClip.fromSamples("musica fps", a, 2);
}

/// Carga (uma vez): clipes, volume da música de `config/audio.json` e a música.
export function fpsSomIniciar(som: FpsSom, humano: number): void {
  som.humano = humano;
  som.tiro = fpsSomClipe("assets/audio/tiro.ogg", 180.0, 0.12);
  som.impacto = fpsSomClipe("assets/audio/impacto.ogg", 90.0, 0.1);
  som.explosao = fpsSomClipe("assets/audio/explosao.ogg", 60.0, 0.6);
  som.passo1 = fpsSomClipe("assets/audio/passo1.ogg", 120.0, 0.05);
  som.passo2 = fpsSomClipe("assets/audio/passo2.ogg", 110.0, 0.05);
  const trilha = fs.exists("assets/audio/night-shift.wav") ? AudioClip.load("assets/audio/night-shift.wav") : null;
  som.musica = trilha !== null ? trilha : fpsSomMusica(taxaDosClipes());
  som.grupoEfeitos = Math.max(0, grupoIndex("Efeitos"));
  som.grupoMusica = Math.max(0, grupoIndex("Música"));
  let volMusica: f64 = FPS_SOM_VOL_MUSICA_PADRAO;
  let volEfeitos: f64 = 1.0;
  if (fs.exists(FPS_SOM_CONFIG)) {
    try {
      const cfg = JSON.parse(fs.read_text(FPS_SOM_CONFIG));
      if (typeof cfg.musica === "number") volMusica = cfg.musica;
      if (typeof cfg.efeitos === "number") volEfeitos = cfg.efeitos;
    } catch (e) { io.print("[som] " + FPS_SOM_CONFIG + " inválido; volumes padrão"); }
  }
  Mixer.setVolume("Música", volMusica);
  Mixer.setVolume("Efeitos", volEfeitos);
  pedidoPadrao(som.pedido);
  som.pedido[PEDIDO_LACO] = 1.0; som.pedido[PEDIDO_GRUPO] = som.grupoMusica;
  som.musicaId = tocarClipe(som.musica, som.pedido);
}

export function fpsSomAlternarMusica(som: FpsSom): void {
  som.musicaMuda = !som.musicaMuda;
  Mixer.mute("Música", som.musicaMuda);
}

function fpsSomAleatorio(som: FpsSom): f64 {
  som.semente = (som.semente * 1664525 + 1013904223) | 0;
  return ((som.semente >>> 8) & 0xFFFF) / 65535.0;
}

/// Um disparo no `som.ponto` com `blend` e alcance `max`, no grupo Efeitos.
function fpsSomTocar(som: FpsSom, clip: AudioClip, blend: f64, max: f64): void {
  const p = som.pedido;
  pedidoPadrao(p);
  p[PEDIDO_GRUPO] = som.grupoEfeitos; p[PEDIDO_FLAGS] = FLAG_3D + FLAG_ONESHOT; p[PEDIDO_BLEND] = blend; p[PEDIDO_MAX] = max;
  p[PEDIDO_X] = som.ponto[0]; p[PEDIDO_Y] = som.ponto[1]; p[PEDIDO_Z] = som.ponto[2];
  if (clip === som.explosao) p[PEDIDO_MIN] = FPS_SOM_MIN_EXPLOSAO;
  if (clip === som.tiro) p[PEDIDO_PITCH] = 1.0 - FPS_SOM_VARIACAO_TIRO + 2.0 * FPS_SOM_VARIACAO_TIRO * fpsSomAleatorio(som);
  tocarClipe(clip, p);
}

/// Os efeitos que entraram no anel desde o último quadro.
export function fpsSomEfeitos(som: FpsSom, m: FpsWorld): void {
  const fim = m.efProximo;
  const eu = m.jogadores[som.humano];
  let e = som.vistoProximo;
  while (e !== fim) {
    const tipo = m.efTipo[e];
    som.ponto[0] = m.efX0[e]; som.ponto[1] = m.efY0[e]; som.ponto[2] = m.efZ0[e];
    if (tipo === FPS_EFEITO_TRACADOR) {
      const dx = som.ponto[0] - eu.x; const dy = som.ponto[1] - (eu.y + FPS_ALTURA_OLHO); const dz = som.ponto[2] - eu.z;
      const proprio = dx * dx + dy * dy + dz * dz < FPS_SOM_DIST_PROPRIO * FPS_SOM_DIST_PROPRIO;
      fpsSomTocar(som, som.tiro, proprio ? FPS_SOM_BLEND_TIRO_PROPRIO : 1.0, FPS_SOM_MAX_TIRO);
      som.tocadosTiro = som.tocadosTiro + 1;
    } else if (tipo === FPS_EFEITO_MARCA) {
      fpsSomTocar(som, som.impacto, 1.0, FPS_SOM_MAX_IMPACTO);
      som.tocadosImpacto = som.tocadosImpacto + 1;
    } else if (tipo === FPS_EFEITO_EXPLOSAO) {
      fpsSomTocar(som, som.explosao, 1.0, FPS_SOM_MAX_EXPLOSAO);
      som.tocadosExplosao = som.tocadosExplosao + 1;
    }
    e = (e + 1) % FPS_POOL_EFEITOS;
  }
  som.vistoProximo = fim;
}

/// Um passo a cada 2,2 u percorridos no chão, alternando os dois clipes com
/// pitch de 0,95 a 1,05. O humano ouve os próprios em 2D; os outros, em 3D perto.
export function fpsSomPassos(som: FpsSom, m: FpsWorld): void {
  const js = m.jogadores;
  while (som.acumPasso.length < js.length) {
    const p0 = js[som.acumPasso.length];
    som.acumPasso.push(0.0); som.ultX.push(p0.x); som.ultZ.push(p0.z); som.alterna.push(0);
  }
  let j = 0;
  while (j < js.length) {
    const p = js[j];
    const dx = p.x - som.ultX[j]; const dz = p.z - som.ultZ[j];
    som.ultX[j] = p.x; som.ultZ[j] = p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (p.vivo && p.noChao && d < FPS_SOM_SALTO_MAX) {
      som.acumPasso[j] = som.acumPasso[j] + d;
      if (som.acumPasso[j] >= FPS_SOM_PASSO_DIST) {
        som.acumPasso[j] = som.acumPasso[j] - FPS_SOM_PASSO_DIST;
        som.ponto[0] = p.x; som.ponto[1] = p.y; som.ponto[2] = p.z;
        const clip = som.alterna[j] === 0 ? som.passo1 : som.passo2;
        som.alterna[j] = 1 - som.alterna[j];
        const pedido = som.pedido;
        pedidoPadrao(pedido);
        pedido[PEDIDO_GRUPO] = som.grupoEfeitos; pedido[PEDIDO_FLAGS] = FLAG_ONESHOT + (j === som.humano ? 0 : FLAG_3D);
        pedido[PEDIDO_BLEND] = j === som.humano ? 0.0 : 1.0; pedido[PEDIDO_MAX] = FPS_SOM_MAX_PASSO;
        pedido[PEDIDO_X] = p.x; pedido[PEDIDO_Y] = p.y; pedido[PEDIDO_Z] = p.z;
        pedido[PEDIDO_PITCH] = FPS_SOM_PITCH_PASSO_MIN + (FPS_SOM_PITCH_PASSO_MAX - FPS_SOM_PITCH_PASSO_MIN) * fpsSomAleatorio(som);
        tocarClipe(clip, pedido);
        som.tocadosPasso = som.tocadosPasso + 1;
      }
    }
    j = j + 1;
  }
}

/// Por quadro, depois de preencher a câmera: ouvinte = o olho do jogador
/// (o rts-fps desenha pela própria pose, sem componente Camera), eventos e pump.
export function fpsSomQuadro(som: FpsSom, m: FpsWorld, pose: Float64Array, dt: f64): void {
  Audio.setListenerPose(pose);
  fpsSomEfeitos(som, m);
  fpsSomPassos(som, m);
  audioQuadro(m.scene, dt);
}
