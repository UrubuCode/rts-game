// Engine RTS — AnimationPlayer: amostra clipes glTF (Task 3) e escreve a pose
// de TRABALHO do `Skeleton` do MESMO objeto (Task 4). Não é o Renderer nem
// dono do modelo — só toca `poseT/poseR/poseS`; a pose MANUAL/`overrideMask`
// (o que o autor posicionou à mão, salvo na cena) nunca é escrita por aqui,
// por isso tocar um clipe não corrompe a pose salva (ver skeleton.ts).
//
// Sem alocação por frame: nenhuma função aqui cria array/Float64Array — tudo
// escreve direto em `dest` (o buffer do CHAMADOR, `sk.poseT/poseR/poseS`). O
// índice do clipe é resolvido (por nome, com indexOf) só em `play`/`crossFade`;
// o caminho quente (`update`) só lê `this.clipIdx`, nunca `this.clip` por
// string.
//
// `applyVec3Channel`/`applyQuatChannel` fundem "amostrar a curva" + "misturar
// no osso" numa função só (1 chamada por canal, sem buffer intermediário) —
// medido: com amostragem e mistura em funções separadas (2-3 chamadas por
// canal, ida por `SCR_*`), 17 personagens x 1000 frames custava ~0,52 ms/quadro
// (update+compose); fundido caiu pra ~0,33 ms/quadro. Custo de CHAMADA de
// função é caro neste runtime (ver rts#2760 sobre parâmetro com valor
// padrão) — o mesmo raciocínio vale para o número de chamadas por osso.
import { Behavior } from "./behavior";
import { Skeleton } from "./skeleton";
import { AnimClip } from "../render/gltf_anim";

// mesma codificação de AnimClip.chPath (gltf_anim.ts): 0=translation(3)
// 1=rotation(4) 2=scale(3). Redeclarado aqui porque gltf_anim.ts não exporta
// os CH_* (são privados ao leitor); o comentário da classe documenta o
// contrato, então manter os dois em sincronia é o preço de não linkar mais um
// símbolo entre os dois módulos.
const PATH_TRANSLATION: number = 0;
const PATH_ROTATION: number = 1;
const PATH_SCALE: number = 2;

/// Busca binária: último índice `k` com `times[k] <= t` (0 se `t` for menor
/// que o primeiro tempo, `n-1` no máximo). `times` tem pelo menos 1 elemento
/// (glTF exige >=1 amostra por canal — ver gltf_anim.ts:readChannel).
function findKeyIndex(times: Float64Array, t: f64): number {
  const n = times.length;
  if (n <= 1) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/// Amostra um canal vetorial (translation/scale, stride 3) em `t` (lerp entre
/// as duas chaves vizinhas; fora do intervalo mantém a chave da ponta — quem
/// chama já grampeou/envolveu `t`) e escreve JÁ misturado (peso `weight`
/// contra o valor atual) no osso `bone` de `dest`. 1 chamada por canal, sem
/// buffer intermediário.
function applyVec3Channel(times: Float64Array, values: Float64Array, t: f64, dest: Float64Array, bone: number, weight: f64): void {
  const n = times.length;
  const k = findKeyIndex(times, t);
  let sx: f64; let sy: f64; let sz: f64;
  if (k >= n - 1) {
    sx = values[k * 3]; sy = values[k * 3 + 1]; sz = values[k * 3 + 2];
  } else {
    const t0 = times[k]; const t1 = times[k + 1];
    let f: f64 = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
    if (f < 0.0) f = 0.0; if (f > 1.0) f = 1.0;
    const u = 1.0 - f;
    sx = values[k * 3] * u + values[(k + 1) * 3] * f;
    sy = values[k * 3 + 1] * u + values[(k + 1) * 3 + 1] * f;
    sz = values[k * 3 + 2] * u + values[(k + 1) * 3 + 2] * f;
  }
  const o = bone * 3;
  if (weight >= 1.0) { dest[o] = sx; dest[o + 1] = sy; dest[o + 2] = sz; return; }
  const uw = 1.0 - weight;
  dest[o] = dest[o] * uw + sx * weight;
  dest[o + 1] = dest[o + 1] * uw + sy * weight;
  dest[o + 2] = dest[o + 2] * uw + sz * weight;
}

/// Igual a `applyVec3Channel`, para um canal de rotação (stride 4): nlerp
/// (caminho curto, normalizado) entre as chaves vizinhas e, se `weight < 1`,
/// nlerp de novo contra o valor atual do osso. Matemática igual a
/// `quatNlerpInto` (quat.ts), reescrita aqui para não ir e voltar por um
/// Float64Array temporário a cada chamada.
function applyQuatChannel(times: Float64Array, values: Float64Array, t: f64, dest: Float64Array, bone: number, weight: f64): void {
  const n = times.length;
  const k = findKeyIndex(times, t);
  let qx: f64; let qy: f64; let qz: f64; let qw: f64;
  if (k >= n - 1) {
    qx = values[k * 4]; qy = values[k * 4 + 1]; qz = values[k * 4 + 2]; qw = values[k * 4 + 3];
  } else {
    const t0 = times[k]; const t1 = times[k + 1];
    let f: f64 = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
    if (f < 0.0) f = 0.0; if (f > 1.0) f = 1.0;
    const ax = values[k * 4]; const ay = values[k * 4 + 1]; const az = values[k * 4 + 2]; const aw = values[k * 4 + 3];
    const bx = values[(k + 1) * 4]; const by = values[(k + 1) * 4 + 1]; const bz = values[(k + 1) * 4 + 2]; const bw = values[(k + 1) * 4 + 3];
    const dot = ax * bx + ay * by + az * bz + aw * bw;
    const s: f64 = dot < 0.0 ? 0.0 - 1.0 : 1.0;
    const u = 1.0 - f;
    let x = ax * u + bx * s * f; let y = ay * u + by * s * f; let z = az * u + bz * s * f; let w = aw * u + bw * s * f;
    const len = Math.sqrt(x * x + y * y + z * z + w * w);
    if (len > 1e-12) { x = x / len; y = y / len; z = z / len; w = w / len; } else { x = 0.0; y = 0.0; z = 0.0; w = 1.0; }
    qx = x; qy = y; qz = z; qw = w;
  }
  const o = bone * 4;
  if (weight >= 1.0) { dest[o] = qx; dest[o + 1] = qy; dest[o + 2] = qz; dest[o + 3] = qw; return; }
  const ax = dest[o]; const ay = dest[o + 1]; const az = dest[o + 2]; const aw = dest[o + 3];
  const dot = ax * qx + ay * qy + az * qz + aw * qw;
  const s: f64 = dot < 0.0 ? 0.0 - 1.0 : 1.0;
  const u = 1.0 - weight;
  let x = ax * u + qx * s * weight; let y = ay * u + qy * s * weight; let z = az * u + qz * s * weight; let w = aw * u + qw * s * weight;
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (len > 1e-12) { x = x / len; y = y / len; z = z / len; w = w / len; } else { x = 0.0; y = 0.0; z = 0.0; w = 1.0; }
  dest[o] = x; dest[o + 1] = y; dest[o + 2] = z; dest[o + 3] = w;
}

/// Amostra `clip` em `t` e escreve na pose de TRABALHO de `sk`
/// (`poseT/poseR/poseS`). `weight < 1` mistura com o valor JÁ presente na
/// pose (é assim que o crossfade funciona: chama-se 1x com o clipe anterior
/// em peso 1, depois com o novo clipe no peso do fade). Ossos sem canal no
/// clipe não são tocados — mantêm o valor de trabalho corrente.
export function sampleClipInto(sk: Skeleton, clip: AnimClip, t: f64, weight: f64): void {
  const n = clip.chBone.length;
  const boneCount = sk.boneCount();
  let i = 0;
  while (i < n) {
    const bone = clip.chBone[i];
    if (bone >= 0 && bone < boneCount) {
      const path = clip.chPath[i];
      if (path === PATH_TRANSLATION) applyVec3Channel(clip.chTimes[i], clip.chValues[i], t, sk.poseT, bone, weight);
      else if (path === PATH_ROTATION) applyQuatChannel(clip.chTimes[i], clip.chValues[i], t, sk.poseR, bone, weight);
      else if (path === PATH_SCALE) applyVec3Channel(clip.chTimes[i], clip.chValues[i], t, sk.poseS, bone, weight);
    }
    i = i + 1;
  }
}

/**
 * @componentCategory Animação
 * @componentDescription Toca um clipe glTF do Skeleton do mesmo objeto: laço, seek, crossfade.
 * @componentKeywords animacao clipe gltf esqueleto pose laco crossfade
 */
export class AnimationPlayer extends Behavior {
  clip: string;
  loop: boolean;
  speed: f64;
  playing: boolean;
  /** @nonSerialized */
  time: f64;

  // Skeleton do mesmo objeto, resolvido uma vez (mount ou 1º update/play) —
  // nunca por busca na cena. Fica null (e tenta de novo) enquanto o Skeleton
  // não existir/carregar; depois de achado, nunca mais procura.
  /** @nonSerialized */
  private skeleton: Skeleton | null;
  // Índice do clipe TOCANDO agora dentro de skeleton.asset.clips (-1 = nenhum).
  // Resolvido por nome só em play()/crossFade(); update() só lê isto.
  /** @nonSerialized */
  private clipIdx: number;
  // Crossfade: clipe anterior (índice + tempo CONGELADO em que ele estava) e
  // progresso do fade. prevClipIdx < 0 = sem fade em andamento.
  /** @nonSerialized */
  private prevClipIdx: number;
  /** @nonSerialized */
  private prevTime: f64;
  /** @nonSerialized */
  private fadeTime: f64;
  /** @nonSerialized */
  private fadeDur: f64;

  constructor() {
    super();
    this.clip = "";
    this.loop = true;
    this.speed = 1.0;
    this.playing = false;
    this.time = 0.0;
    this.skeleton = null;
    this.clipIdx = 0 - 1;
    this.prevClipIdx = 0 - 1;
    this.prevTime = 0.0;
    this.fadeTime = 0.0;
    this.fadeDur = 0.0;
  }

  typeName(): string { return "AnimationPlayer"; }

  mount(): void { this.resolveSkeleton(); }

  /// Nomes dos clipes do modelo (para UI/scripts); não é caminho quente.
  clipNames(): string[] {
    const sk = this.resolveSkeleton();
    const out: string[] = [];
    if (sk === null || sk.asset === null) return out;
    const clips = sk.asset.clips;
    let i = 0;
    while (i < clips.length) { out.push(clips[i].name); i = i + 1; }
    return out;
  }

  /// Duração do clipe TOCANDO agora (0 se nenhum).
  duration(): f64 {
    const sk = this.resolveSkeleton();
    if (sk === null || sk.asset === null || this.clipIdx < 0 || this.clipIdx >= sk.asset.clips.length) return 0.0;
    return sk.asset.clips[this.clipIdx].duration;
  }

  /// Toca `name` do início. `loopArg` (se dado) substitui `this.loop`.
  /// Clipe inexistente: devolve `false` e NADA muda (clipe, tempo, pose).
  play(name: string, loopArg?: boolean): boolean {
    const sk = this.resolveSkeleton();
    if (sk === null || sk.asset === null) return false;
    const idx = sk.asset.clipIndex(name);
    if (idx < 0) return false;
    this.clip = name;
    this.clipIdx = idx;
    if (loopArg !== undefined) this.loop = loopArg;
    this.time = 0.0;
    this.playing = true;
    this.prevClipIdx = 0 - 1; this.fadeTime = 0.0; this.fadeDur = 0.0;
    this.applyPose();
    return true;
  }

  /// Começa a tocar `name`, misturando por `seconds` a partir da pose do
  /// clipe atual (congelado no tempo em que estava). Clipe inexistente:
  /// devolve `false` e nada muda.
  crossFade(name: string, seconds: f64): boolean {
    const sk = this.resolveSkeleton();
    if (sk === null || sk.asset === null) return false;
    const idx = sk.asset.clipIndex(name);
    if (idx < 0) return false;
    this.prevClipIdx = this.clipIdx;
    this.prevTime = this.time;
    this.clip = name;
    this.clipIdx = idx;
    this.time = 0.0;
    this.playing = true;
    this.fadeDur = seconds > 0.0 ? seconds : 0.0;
    this.fadeTime = 0.0;
    this.applyPose();
    return true;
  }

  pause(): void { this.playing = false; }
  resume(): void { this.playing = true; }

  /// Move o tempo do clipe atual e aplica a pose JÁ (sem esperar o próximo
  /// update). Com laço: envolve em [0,duração) por módulo positivo (tempo
  /// negativo também envolve certo). Sem laço: grampeia em [0,duração].
  /// Duração 0: tempo 0 (nunca NaN).
  seek(t: f64): void {
    this.resolveSkeleton();
    this.time = this.wrapOrClamp(t, this.duration());
    this.applyPose();
  }

  /// Avança o tempo por `dt*speed` (e o do fade, se houver) e escreve a pose.
  update(dt: f64): void {
    if (!this.playing) return;
    const sk = this.resolveSkeleton();
    if (sk === null || sk.asset === null || this.clipIdx < 0) return;
    const step = dt * this.speed;
    this.time = this.time + step;
    // o clipe ANTERIOR fica CONGELADO no tempo em que estava quando o fade
    // começou (é o "tempo dele" que crossFade guarda) — só o fade avança.
    if (this.prevClipIdx >= 0) this.fadeTime = this.fadeTime + dt;
    // duração lida 1x (é um par de acessos a campo/array, não uma busca) e
    // reusada no laço/grampo abaixo — evita recalcular na mesma chamada.
    const dur = this.duration();
    if (this.loop) {
      this.time = this.wrapOrClamp(this.time, dur);
    } else if (dur > 0.0 && this.time >= dur) {
      this.time = dur; this.playing = false;
    } else if (this.time < 0.0 || dur <= 0.0) {
      this.time = 0.0;
    }
    this.applyPose();
  }

  // Acha o Skeleton do MESMO objeto (via owner.behaviors, setado por
  // GameObject.addBehavior) uma única vez; garante o asset carregado (win=0
  // não sobe malha — seguro chamar sem janela real, ver skeleton.ts).
  private resolveSkeleton(): Skeleton | null {
    if (this.skeleton !== null) return this.skeleton;
    const o = this.owner;
    if (o === null) return null;
    let i = 0;
    while (i < o.behaviors.length) {
      const b = o.behaviors[i];
      if (b instanceof Skeleton) {
        b.ensureAsset(0);
        this.skeleton = b;
        return b;
      }
      i = i + 1;
    }
    return null;
  }

  // laço: módulo positivo em [0,duração); sem laço: grampo em [0,duração];
  // duração <= 0: sempre 0 (nunca NaN, nunca negativo). `dur` é passado pelo
  // chamador (já resolvido) para não recalcular a mesma duração 2x por chamada.
  private wrapOrClamp(t: f64, dur: f64): f64 {
    if (dur <= 0.0) return 0.0;
    if (this.loop) {
      let nt = t % dur;
      if (nt < 0.0) nt = nt + dur;
      return nt;
    }
    if (t < 0.0) return 0.0;
    if (t > dur) return dur;
    return t;
  }

  // Escreve a pose de trabalho para o tempo/clipe atuais. Com fade em
  // andamento: amostra o clipe ANTERIOR em peso 1, CONGELADO no tempo em que
  // estava quando crossFade() foi chamado (prevTime não avança — só o novo
  // clipe e o progresso do fade avançam), e depois o clipe novo em peso =
  // min(1, fadeTime/fadeDur) — a mistura vem do 2º sampleClipInto ler o valor
  // que o 1º acabou de escrever.
  private applyPose(): void {
    const sk = this.skeleton;
    if (sk === null || sk.asset === null || this.clipIdx < 0 || this.clipIdx >= sk.asset.clips.length) return;
    const clip = sk.asset.clips[this.clipIdx];
    if (this.prevClipIdx >= 0 && this.prevClipIdx < sk.asset.clips.length) {
      const prevClip = sk.asset.clips[this.prevClipIdx];
      sampleClipInto(sk, prevClip, this.prevTime, 1.0);
      const w = this.fadeDur > 0.0 ? Math.min(1.0, this.fadeTime / this.fadeDur) : 1.0;
      sampleClipInto(sk, clip, this.time, w);
      if (w >= 1.0) this.prevClipIdx = 0 - 1;
    } else {
      sampleClipInto(sk, clip, this.time, 1.0);
    }
  }
}
