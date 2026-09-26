// Engine RTS — AnimationPlayer: amostra clipes glTF (Task 3) e escreve a pose
// de TRABALHO do `Skeleton` do MESMO objeto (Task 4). Não é o Renderer nem
// dono do modelo — só toca `poseT/poseR/poseS`; a pose MANUAL/`overrideMask`
// (o que o autor posicionou à mão, salvo na cena) nunca é escrita por aqui,
// por isso tocar um clipe não corrompe a pose salva (ver skeleton.ts).
//
// Sem alocação por frame — e isto é MEDIDO, não suposto (`RTS_GC_DEBUG=1`,
// contando só as coletas DENTRO do laço de update, sem compose()): uma
// primeira versão fundia "amostrar a curva" + "misturar no osso" numa função
// só de 6 parâmetros (times,values,t,dest,bone,weight). Com 17 personagens x
// 1000 quadros isso já dava 1 coleta a mais que o esperado; em 10000 quadros,
// 16 — ESCALA com o número de CHAMADAS, então é alocação por chamada, não por
// carga do asset. `scratch/claude-repro-alloc-6params.ts` isola o gatilho:
// não são "muitos locais" por si só (uma função de 6 params com 1 linha de
// corpo aloca do mesmo jeito) — é ter 5 OU MAIS parâmetros `f64` ESCALARES na
// mesma função (nenhum default envolvido, então é uma variante mais ampla do
// defeito do rts#2760, não o mesmo caso). Um parâmetro `Float64Array` não
// conta como escalar: uma função com 5 escalares + 1 array (6 params no
// total) não alocou no repro. A correção aqui: nenhuma função tem mais de 4
// parâmetros `f64` escalares — as que precisavam de mais valores (a chave
// atual + a próxima, pra nlerp) leem os buffers de módulo `SCR_*`/os próprios
// arrays `times`/`values` por índice em vez de receber cada componente como
// parâmetro solto. Depois da correção, 1000 e 10000 quadros dão o MESMO
// número de coletas dentro do laço de update — 0 nos dois, medido (ver
// números no relatório da task).
//
// `sampleClipInto` também abre o canal de ROTAÇÃO (o mais comum: pernas,
// braços, cabeça) inline no caso `weight>=1` (sem crossfade), em vez de
// chamar `sampleQuatInto` — 0 chamadas de função extra por osso nesse
// caminho, e ainda 4 parâmetros no total (`sk,clip,t,weight`), então ainda
// seguro pelo mesmo motivo. Isso tirou a margem de "quase no limite" (17
// personagens x 1000 quadros por volta de 0,28-0,34 ms, flutuando pra cima
// do portão de 0,3 ms em ~1 a cada 3 execuções) para uma margem estável
// (~0,25-0,29 ms, 10 execuções seguidas todas abaixo do portão).
import { Behavior } from "./behavior";
import type { GameObject } from "./gameobject";
import { Skeleton } from "./skeleton";
import { AnimClip } from "../render/gltf_anim";
import { quatNlerpInto } from "../render/quat";

// mesma codificação de AnimClip.chPath (gltf_anim.ts): 0=translation(3)
// 1=rotation(4) 2=scale(3). Redeclarado aqui porque gltf_anim.ts não exporta
// os CH_* (são privados ao leitor); o comentário da classe documenta o
// contrato, então manter os dois em sincronia é o preço de não linkar mais um
// símbolo entre os dois módulos.
const PATH_TRANSLATION: number = 0;
const PATH_ROTATION: number = 1;
const PATH_SCALE: number = 2;

// Buffers de módulo, reescritos a cada canal amostrado — nunca alocados por
// frame (sampleClipInto é síncrona e sem recursão, então reusar os mesmos
// buffers é seguro). Passá-los por parâmetro em vez de abrir cada componente
// (x,y,z,w) como parâmetro solto é o que mantém cada função em <=4
// parâmetros `f64` escalares — ver o comentário do topo do arquivo sobre por
// que isto importa neste runtime.
const SCR_V3: Float64Array = new Float64Array(3);
const SCR_Q: Float64Array = new Float64Array(4);
const SCR_QA: Float64Array = new Float64Array(4);

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

/// Amostra um canal vetorial (translation/scale, stride 3) em `t`, com lerp
/// entre as duas chaves vizinhas. Fora do intervalo: mantém a chave da ponta
/// (sem extrapolar) — `update`/`seek` já grampeiam/envolvem `t` antes.
/// 4 parâmetros, poucos locais — ver comentário do topo do arquivo.
function sampleVec3Into(times: Float64Array, values: Float64Array, t: f64, out: Float64Array): void {
  const n = times.length;
  const k = findKeyIndex(times, t);
  if (k >= n - 1) {
    out[0] = values[k * 3]; out[1] = values[k * 3 + 1]; out[2] = values[k * 3 + 2];
    return;
  }
  const t0 = times[k]; const t1 = times[k + 1];
  let f: f64 = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
  if (f < 0.0) f = 0.0; if (f > 1.0) f = 1.0;
  const u = 1.0 - f;
  out[0] = values[k * 3] * u + values[(k + 1) * 3] * f;
  out[1] = values[k * 3 + 1] * u + values[(k + 1) * 3 + 1] * f;
  out[2] = values[k * 3 + 2] * u + values[(k + 1) * 3 + 2] * f;
}

/// Amostra um canal de rotação (stride 4) em `t`: nlerp (caminho curto,
/// normalizado) entre as duas chaves vizinhas, matemática igual a
/// `quatNlerpInto` (quat.ts) mas ABERTA em locais lendo direto de `values`
/// por índice — sem ela (e sem ir/voltar por `SCR_*`) dá 1 chamada de função
/// a menos por canal de rotação (a maioria dos canais de um clipe humano:
/// pernas/braços/cabeça). MEDIDO seguro (sem alocar, `RTS_GC_DEBUG=1`) apesar
/// de ~15 locais `f64` vivos: só 4 parâmetros — ver o comentário do topo do
/// arquivo, o gatilho do defeito é o número de PARÂMETROS escalares, não o
/// de locais.
function sampleQuatInto(times: Float64Array, values: Float64Array, t: f64, out: Float64Array): void {
  const n = times.length;
  const k = findKeyIndex(times, t);
  const ko = k * 4;
  if (k >= n - 1) {
    out[0] = values[ko]; out[1] = values[ko + 1]; out[2] = values[ko + 2]; out[3] = values[ko + 3];
    return;
  }
  const t0 = times[k]; const t1 = times[k + 1];
  let f: f64 = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
  if (f < 0.0) f = 0.0; if (f > 1.0) f = 1.0;
  const ko2 = ko + 4;
  const ax = values[ko]; const ay = values[ko + 1]; const az = values[ko + 2]; const aw = values[ko + 3];
  const bx = values[ko2]; const by = values[ko2 + 1]; const bz = values[ko2 + 2]; const bw = values[ko2 + 3];
  const dot = ax * bx + ay * by + az * bz + aw * bw;
  const s: f64 = dot < 0.0 ? 0.0 - 1.0 : 1.0;
  const u = 1.0 - f;
  let x = ax * u + bx * s * f; let y = ay * u + by * s * f; let z = az * u + bz * s * f; let w = aw * u + bw * s * f;
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (len > 1e-12) { x = x / len; y = y / len; z = z / len; w = w / len; } else { x = 0.0; y = 0.0; z = 0.0; w = 1.0; }
  out[0] = x; out[1] = y; out[2] = z; out[3] = w;
}

/// Mistura `src` (vetor de 3, já amostrado) no osso `bone` de `dest` por
/// `weight` (1 = substitui, <1 = lerp com o valor atual de `dest`).
function blendVec3Into(dest: Float64Array, bone: number, src: Float64Array, weight: f64): void {
  const o = bone * 3;
  if (weight >= 1.0) { dest[o] = src[0]; dest[o + 1] = src[1]; dest[o + 2] = src[2]; return; }
  const u = 1.0 - weight;
  dest[o] = dest[o] * u + src[0] * weight;
  dest[o + 1] = dest[o + 1] * u + src[1] * weight;
  dest[o + 2] = dest[o + 2] * u + src[2] * weight;
}

/// Mistura `src` (quaternion já amostrado) no osso `bone` de `dest` por
/// `weight`, com nlerp (caminho curto, normalizado) contra o valor atual.
/// Copia o valor atual de `dest` pro buffer de módulo `SCR_QA` em vez de 4
/// locais `ax,ay,az,aw` — mesmo motivo de `sampleQuatInto`.
function blendQuatInto(dest: Float64Array, bone: number, src: Float64Array, weight: f64): void {
  const o = bone * 4;
  if (weight >= 1.0) { dest[o] = src[0]; dest[o + 1] = src[1]; dest[o + 2] = src[2]; dest[o + 3] = src[3]; return; }
  SCR_QA[0] = dest[o]; SCR_QA[1] = dest[o + 1]; SCR_QA[2] = dest[o + 2]; SCR_QA[3] = dest[o + 3];
  quatNlerpInto(SCR_Q, SCR_QA, src, weight);
  dest[o] = SCR_Q[0]; dest[o + 1] = SCR_Q[1]; dest[o + 2] = SCR_Q[2]; dest[o + 3] = SCR_Q[3];
}

/// Três buffers de pose por osso (T 3, R 4, S 3) — o destino de
/// `samplePoseInto`. Pode apontar para a pose de TRABALHO de um Skeleton
/// (`sampleClipInto` faz isso) ou para buffers próprios de quem mistura várias
/// poses antes de escrever no esqueleto (o Animator: estado de saída de um
/// fade, camada com máscara/peso). Criado uma vez; nunca por frame.
export class PoseBuffers {
  t: Float64Array;
  r: Float64Array;
  s: Float64Array;
  constructor(bones: number) {
    this.t = new Float64Array(bones * 3);
    this.r = new Float64Array(bones * 4);
    this.s = new Float64Array(bones * 3);
  }
}

// destino reusado por `sampleClipInto`: aponta para os arrays do Skeleton a
// cada chamada (3 escritas de campo, nenhuma alocação).
const SK_POSE: PoseBuffers = new PoseBuffers(0);

/// Amostra `clip` em `t` e escreve na pose de TRABALHO de `sk`
/// (`poseT/poseR/poseS`). `weight < 1` mistura com o valor JÁ presente na
/// pose (é assim que o crossfade funciona: chama-se 1x com o clipe anterior
/// em peso 1, depois com o novo clipe no peso do fade). Ossos sem canal no
/// clipe não são tocados — mantêm o valor de trabalho corrente.
export function sampleClipInto(sk: Skeleton, clip: AnimClip, t: f64, weight: f64): void {
  const dst = SK_POSE;
  dst.t = sk.poseT; dst.r = sk.poseR; dst.s = sk.poseS;
  samplePoseInto(dst, clip, t, weight);
}

/// O amostrador de verdade (o ÚNICO do motor): `sampleClipInto` com destino
/// arbitrário. Mesma semântica de peso e de ossos sem canal. O número de ossos
/// vem do tamanho de `dst.r`.
export function samplePoseInto(dst: PoseBuffers, clip: AnimClip, t: f64, weight: f64): void {
  const n = clip.chBone.length;
  const boneCount = dst.r.length >> 2;
  // caso comum (sem crossfade, weight=1): amostra e escreve DIRETO no osso,
  // sem os passos por `sampleQuatInto`/`blendQuatInto` (chamadas de função) —
  // tudo aberto aqui dentro, porque `sampleClipInto` continua com só 4
  // parâmetros (sk,clip,t,weight): é o número de parâmetros ESCALARES da
  // função que importa pro defeito de alocação deste runtime (ver comentário
  // do topo do arquivo), não a quantidade de locais dentro dela.
  const full = weight >= 1.0;
  const poseT = dst.t; const poseR = dst.r; const poseS = dst.s;
  const chTimes = clip.chTimes; const chValues = clip.chValues;
  const chBone = clip.chBone; const chPath = clip.chPath;
  let i = 0;
  while (i < n) {
    const bone = chBone[i];
    if (bone >= 0 && bone < boneCount) {
      const path = chPath[i];
      const times = chTimes[i]; const values = chValues[i];
      if (path === PATH_ROTATION) {
        if (full) {
          const tn = times.length;
          const k = findKeyIndex(times, t);
          const ko = k * 4;
          const o = bone * 4;
          if (k >= tn - 1) {
            poseR[o] = values[ko]; poseR[o + 1] = values[ko + 1]; poseR[o + 2] = values[ko + 2]; poseR[o + 3] = values[ko + 3];
          } else {
            const t0 = times[k]; const t1 = times[k + 1];
            let f: f64 = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
            if (f < 0.0) f = 0.0; if (f > 1.0) f = 1.0;
            const ko2 = ko + 4;
            const ax = values[ko]; const ay = values[ko + 1]; const az = values[ko + 2]; const aw = values[ko + 3];
            const bx = values[ko2]; const by = values[ko2 + 1]; const bz = values[ko2 + 2]; const bw = values[ko2 + 3];
            const dot = ax * bx + ay * by + az * bz + aw * bw;
            const s: f64 = dot < 0.0 ? 0.0 - 1.0 : 1.0;
            const u = 1.0 - f;
            let x = ax * u + bx * s * f; let y = ay * u + by * s * f; let z = az * u + bz * s * f; let w = aw * u + bw * s * f;
            const len = Math.sqrt(x * x + y * y + z * z + w * w);
            if (len > 1e-12) { x = x / len; y = y / len; z = z / len; w = w / len; } else { x = 0.0; y = 0.0; z = 0.0; w = 1.0; }
            poseR[o] = x; poseR[o + 1] = y; poseR[o + 2] = z; poseR[o + 3] = w;
          }
        } else {
          sampleQuatInto(times, values, t, SCR_Q);
          blendQuatInto(poseR, bone, SCR_Q, weight);
        }
      } else if (path === PATH_TRANSLATION) {
        sampleVec3Into(times, values, t, SCR_V3);
        if (full) { const o = bone * 3; poseT[o] = SCR_V3[0]; poseT[o + 1] = SCR_V3[1]; poseT[o + 2] = SCR_V3[2]; }
        else blendVec3Into(poseT, bone, SCR_V3, weight);
      } else if (path === PATH_SCALE) {
        sampleVec3Into(times, values, t, SCR_V3);
        if (full) { const o = bone * 3; poseS[o] = SCR_V3[0]; poseS[o + 1] = SCR_V3[1]; poseS[o + 2] = SCR_V3[2]; }
        else blendVec3Into(poseS, bone, SCR_V3, weight);
      }
    }
    i = i + 1;
  }
}

/// Copia a pose inteira de `src` para `dst` (mesmo número de ossos).
export function copyPoseInto(dst: PoseBuffers, src: PoseBuffers): void {
  const dt = dst.t; const dr = dst.r; const ds = dst.s;
  const st = src.t; const sr = src.r; const ss = src.s;
  const n3 = st.length; const n4 = sr.length;
  let i = 0;
  while (i < n3) { dt[i] = st[i]; ds[i] = ss[i]; i = i + 1; }
  i = 0;
  while (i < n4) { dr[i] = sr[i]; i = i + 1; }
}

/// Mistura a pose `src` em `dst` com peso `weight` (1 = substitui; lerp em T/S,
/// nlerp pelo caminho curto em R), só nos ossos com `mask[osso] !== 0`. É a
/// mistura de POSES já amostradas (fade entre estados, camada com peso e
/// máscara) — não amostra nada. 4 parâmetros, 1 escalar: ver o topo do arquivo.
export function blendPoseInto(dst: PoseBuffers, src: PoseBuffers, weight: f64, mask: Uint8Array): void {
  const dt = dst.t; const dr = dst.r; const ds = dst.s;
  const st = src.t; const sr = src.r; const ss = src.s;
  const n = mask.length;
  const full = weight >= 1.0;
  const u = 1.0 - weight;
  let b = 0;
  while (b < n) {
    if (mask[b] !== 0) {
      const o3 = b * 3; const o4 = b * 4;
      if (full) {
        dt[o3] = st[o3]; dt[o3 + 1] = st[o3 + 1]; dt[o3 + 2] = st[o3 + 2];
        ds[o3] = ss[o3]; ds[o3 + 1] = ss[o3 + 1]; ds[o3 + 2] = ss[o3 + 2];
        dr[o4] = sr[o4]; dr[o4 + 1] = sr[o4 + 1]; dr[o4 + 2] = sr[o4 + 2]; dr[o4 + 3] = sr[o4 + 3];
      } else if (weight > 0.0) {
        dt[o3] = dt[o3] * u + st[o3] * weight; dt[o3 + 1] = dt[o3 + 1] * u + st[o3 + 1] * weight; dt[o3 + 2] = dt[o3 + 2] * u + st[o3 + 2] * weight;
        ds[o3] = ds[o3] * u + ss[o3] * weight; ds[o3 + 1] = ds[o3 + 1] * u + ss[o3 + 1] * weight; ds[o3 + 2] = ds[o3 + 2] * u + ss[o3 + 2] * weight;
        // nlerp aberto (mesma matemática de quatNlerpInto), sem ida por array
        const ax = dr[o4]; const ay = dr[o4 + 1]; const az = dr[o4 + 2]; const aw = dr[o4 + 3];
        const bx = sr[o4]; const by = sr[o4 + 1]; const bz = sr[o4 + 2]; const bw = sr[o4 + 3];
        const sg: f64 = ax * bx + ay * by + az * bz + aw * bw < 0.0 ? 0.0 - 1.0 : 1.0;
        let x = ax * u + bx * sg * weight; let y = ay * u + by * sg * weight;
        let z = az * u + bz * sg * weight; let w = aw * u + bw * sg * weight;
        const len = Math.sqrt(x * x + y * y + z * z + w * w);
        if (len > 1e-12) { x = x / len; y = y / len; z = z / len; w = w / len; } else { x = 0.0; y = 0.0; z = 0.0; w = 1.0; }
        dr[o4] = x; dr[o4 + 1] = y; dr[o4 + 2] = z; dr[o4 + 3] = w;
      }
    }
    b = b + 1;
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

  // Skeleton do mesmo objeto, resolvido uma vez (mount ou 1º update/play/seek)
  // — nunca por busca na cena. `resolveSkeleton` ainda faz 1 comparação de
  // campo por chamada pra notar um Skeleton removido/trocado (ver lá), mas
  // isso não é busca: só varre `owner.behaviors` quando o cache está null.
  /** @nonSerialized */
  private skeleton: Skeleton | null;
  // Índice do clipe TOCANDO agora dentro de skeleton.asset.clips (-1 = nenhum
  // resolvido ainda). Resolvido por nome (indexOf) em `play`/`crossFade` (o
  // usuário pediu aquele nome, então tenta sempre) e, pra cena
  // restaurada/copiada/editada no Inspector sem chamar play(), também em
  // `mount`/`onValidate("clip")`/lazily (`ensureClipResolved`, chamada 1x por
  // update/seek/duration — custo O(1) depois de resolvido, sem lookup por
  // string no caminho quente).
  /** @nonSerialized */
  private clipIdx: number;
  // Nome de `clip` cuja resolução lazy JÁ falhou (asset carregado, nome não
  // existe) — evita repetir o indexOf todo frame por um nome sabidamente
  // inválido. Limpo quando `clip` muda (onValidate) ou quando play/crossFade
  // resolvem com sucesso.
  /** @nonSerialized */
  private clipFailed: string;
  // Crossfade: clipe anterior (índice + tempo, que também avança durante o
  // fade — como Unity/Godot: evita "slide" da pose de saída) e progresso do
  // fade. prevClipIdx < 0 = sem fade em andamento.
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
    this.clipFailed = "";
    this.prevClipIdx = 0 - 1;
    this.prevTime = 0.0;
    this.fadeTime = 0.0;
    this.fadeDur = 0.0;
  }

  typeName(): string { return "AnimationPlayer"; }

  /// Resolve o Skeleton irmão e o clipe (`this.clip`) já no mount — sem isto,
  /// um AnimationPlayer restaurado de cena/copiado (Play, duplicar) ou com
  /// `clip` só editado no Inspector nunca tocaria nada até alguém chamar
  /// `play()` de novo.
  mount(): void {
    this.resolveSkeleton();
    this.ensureClipResolved();
  }

  /// Campo editado no Inspector (ou por script direto): `clip` precisa
  /// re-resolver o índice — o valor antigo não vale mais nada.
  onValidate(field: string): void {
    if (field === "clip") {
      this.clipIdx = 0 - 1;
      this.clipFailed = "";
      this.prevClipIdx = 0 - 1; this.fadeTime = 0.0; this.fadeDur = 0.0;
      this.ensureClipResolved();
      this.applyPose();
    }
  }

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
    this.ensureClipResolved();
    const sk = this.skeleton;
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
    this.clipFailed = "";
    if (loopArg !== undefined) this.loop = loopArg;
    this.time = 0.0;
    this.playing = true;
    this.prevClipIdx = 0 - 1; this.fadeTime = 0.0; this.fadeDur = 0.0;
    this.applyPose();
    return true;
  }

  /// Começa a tocar `name`, misturando por `seconds` a partir da pose do
  /// clipe atual (que continua avançando durante o fade, como
  /// Unity/Godot — evita "slide" na pose de saída). Clipe inexistente:
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
    this.clipFailed = "";
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
    const dur = this.duration();   // resolve o skeleton/clipe (ensureClipResolved)
    this.time = this.wrapOrClamp(t, dur);
    this.applyPose();
  }

  /// Avança o tempo por `dt*speed` (e o do clipe anterior/fade, se houver) e
  /// escreve a pose.
  update(dt: f64): void {
    this.ensureClipResolved();
    if (!this.playing) return;
    const sk = this.skeleton;
    if (sk === null || sk.asset === null || this.clipIdx < 0) return;
    if (this.drivenByAnimator(sk)) return;
    const step = dt * this.speed;
    this.time = this.time + step;
    if (this.prevClipIdx >= 0) {
      // o clipe ANTERIOR também avança durante o fade (Unity/Godot): se
      // ficasse parado, a pose de saída "escorregaria" pra trás do que
      // deveria estar tocando.
      this.prevTime = this.prevTime + step;
      this.fadeTime = this.fadeTime + dt;
    }
    // duração lida 1x (é um par de acessos a campo/array, não uma busca) e
    // reusada no laço/grampo abaixo — evita recalcular na mesma chamada.
    const dur = this.duration();
    if (this.loop) {
      this.time = this.wrapOrClamp(this.time, dur);
    } else if (dur > 0.0 && this.time >= dur) {
      this.time = dur; this.playing = false;
      // clipe ALVO terminou (sem laço) com um fade em andamento: conclui o
      // fade na hora (peso 1) em vez de deixar a mistura pela metade.
      this.prevClipIdx = 0 - 1;
    } else if (this.time < 0.0 || dur <= 0.0) {
      this.time = 0.0;
    }
    this.applyPose();
  }

  /// Objeto com Animator E AnimationPlayer: o Animator VENCE e este player
  /// fica inerte (não avança nem escreve a pose) enquanto o Animator que se
  /// registrou em `sk.poseDriver` continuar anexado ao mesmo objeto e
  /// habilitado. Desligar/remover o Animator devolve a pose ao player. Custo:
  /// 3-4 leituras de campo, sem busca.
  drivenByAnimator(sk: Skeleton): boolean {
    const d = sk.poseDriver;
    if (d === null || d === this) return false;
    const o = d.owner;
    return o !== null && o === sk.owner && d.enabled !== 0;
  }

  // Acha o Skeleton do MESMO objeto (via owner.behaviors, setado por
  // GameObject.addBehavior) uma única vez; garante o asset carregado (win=0
  // não sobe malha — seguro chamar sem janela real, ver skeleton.ts).
  //
  // O cache é invalidado (SEM busca — 1 comparação de campo) se o Skeleton
  // cacheado não pertence mais a este `owner`: `GameObject.removeBehavior`
  // zera `owner` de quem remove, então um Skeleton removido (ou removido e
  // substituído por outro) já não bate em `cached.owner === this.owner` e
  // o `while` abaixo acha o atual (ou nenhum).
  private resolveSkeleton(): Skeleton | null {
    const cached = this.skeleton;
    if (cached !== null) {
      if (cached.owner === this.owner) return cached;
      this.skeleton = null;
    }
    const o: GameObject | null = this.owner;
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

  // Resolve `this.clipIdx` a partir de `this.clip` (por nome) sem depender de
  // play()/crossFade() terem sido chamados — cobre cena restaurada, cópia
  // (Play/duplicar) e edição do campo `clip` no Inspector. O(1) depois de
  // resolvido (só olha `clipIdx>=0`); nenhum lookup por string no caminho
  // quente já resolvido. Se o asset ainda não carregou, tenta de novo na
  // próxima chamada (não é falha); se o nome não existe NO asset carregado,
  // grava em `clipFailed` e não tenta de novo até `clip` mudar.
  private ensureClipResolved(): void {
    if (this.clipIdx >= 0) return;
    if (this.clip === "" || this.clip === this.clipFailed) return;
    const sk = this.resolveSkeleton();
    if (sk === null || sk.asset === null) return;
    const idx = sk.asset.clipIndex(this.clip);
    if (idx >= 0) { this.clipIdx = idx; this.clipFailed = ""; }
    else this.clipFailed = this.clip;
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
  // andamento: amostra o clipe ANTERIOR em peso 1 (no tempo dele, que
  // `update` também avança) e depois o clipe novo em peso =
  // min(1, fadeTime/fadeDur) — a mistura vem do 2º sampleClipInto ler o valor
  // que o 1º acabou de escrever.
  private applyPose(): void {
    const sk = this.skeleton;
    if (sk === null || sk.asset === null || this.clipIdx < 0 || this.clipIdx >= sk.asset.clips.length) return;
    if (this.drivenByAnimator(sk)) return;
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
