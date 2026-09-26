// Engine RTS — Animator: máquina de estados de animação estilo Mecanim.
//
// Lê um controlador (`.controller.json`, ver animator_controller.ts) com
// parâmetros (float/bool/trigger), camadas, estados (um clipe ou mistura 1D),
// transições (condições E, tempo de saída, fade) e escreve a pose de TRABALHO
// do Skeleton do mesmo objeto — nunca a pose manual (a salva na cena).
//
// Por frame, cada camada: avança o tempo NORMALIZADO do estado atual (e do
// estado de saída durante um fade — ele continua andando, como a Unity; com
// laço ENVOLVE, sem laço GRAMPEIA no fim, nunca congela), avalia as transições
// da camada em ordem (a primeira que passa vence; triggers usados são
// consumidos) e escreve a pose:
//   - camada 0 sem máscara e peso 1: direto na pose de trabalho, que começa
//     do repouso + pose manual (ossos sem canal ficam na pose do autor);
//   - demais: amostra em buffers próprios e mistura na pose com o `peso` da
//     camada, só nos ossos da máscara (override: lerp/nlerp).
// Mistura 1D: o parâmetro escolhe os dois vizinhos e o peso entre eles; os
// clipes rodam na MESMA fase normalizada (0..1) e a fase avança por
// dt / duração misturada — os passos não se desencontram.
//
// AnimationPlayer no mesmo objeto: o Animator VENCE (registra-se em
// `Skeleton.poseDriver` e o player fica inerte enquanto este estiver anexado e
// habilitado). Controlador com erro: o texto fica em `errorText()` (e no
// Inspector / `animator <obj> state`), o componente fica inerte e o update não
// lança nada.
//
// Custo: controlador lido/resolvido 1x por caminho (cache) e ligado 1x por
// modelo; por frame zero alocação e zero string. Setters por nome resolvem o
// índice (busca na lista de nomes); scripts quentes usam `paramIndex` 1x e os
// `*At`. Nenhum método tem mais de 4 parâmetros (defeito de alocação do
// runtime com 5+ escalares — ver animation_player.ts).
import { Behavior } from "./behavior";
import type { GameObject } from "./gameobject";
import { Skeleton } from "./skeleton";
import type { SkeletonAsset } from "../render/gltf_anim";
import { PoseBuffers, samplePoseInto, copyPoseInto, blendPoseInto } from "./animation_player";
import { AnimatorController, AnimatorBinding, loadAnimatorController, reloadAnimatorController, bindAnimatorController,
  PARAM_FLOAT, PARAM_BOOL, PARAM_TRIGGER, STATE_CLIP, FROM_ANY, NO_EXIT,
  COND_TRUE, COND_EQ, COND_NE, COND_GT, COND_LT, COND_GE } from "./animator_controller";

/**
 * @componentCategory Animação
 * @componentDescription Máquina de estados de animação (estilo Mecanim): parâmetros, transições, mistura 1D e camadas com máscara.
 * @componentKeywords animator animacao estados transicao mistura blend camada mascara mecanim controlador
 */
export class Animator extends Behavior {
  /// Caminho do `.controller.json` (salvo na cena).
  controller: string;

  /** @nonSerialized */
  private ctrl: AnimatorController | null;
  /** @nonSerialized */
  private bind: AnimatorBinding | null;
  /** @nonSerialized */
  private sk: Skeleton | null;
  /** @nonSerialized */
  private boundAsset: SkeletonAsset | null;
  // caminho do `ctrl` carregado ("" + ctrl null = nada carregado ainda)
  /** @nonSerialized */
  private loadedPath: string;
  /** @nonSerialized */
  private ready: boolean;
  /** @nonSerialized */
  private err: string;
  // tentativa que falhou: não repete a ligação a cada frame enquanto nada mudar
  /** @nonSerialized */
  private failedSk: Skeleton | null;
  /** @nonSerialized */
  private failedAsset: SkeletonAsset | null;
  /** @nonSerialized */
  private failedCtrl: AnimatorController | null;
  // parâmetros (bool/trigger = 0/1)
  /** @nonSerialized */
  private params: Float64Array;
  // por camada: estado atual/de saída (índice global; -1 = sem fade), tempo
  // normalizado de cada um, progresso e duração do fade
  /** @nonSerialized */
  private layerCur: number[];
  /** @nonSerialized */
  private layerPrev: number[];
  /** @nonSerialized */
  private curNorm: Float64Array;
  /** @nonSerialized */
  private prevNorm: Float64Array;
  /** @nonSerialized */
  private fadeT: Float64Array;
  /** @nonSerialized */
  private fadeDur: Float64Array;
  // destinos de pose: a do esqueleto (aponta para poseT/R/S) e dois buffers
  /** @nonSerialized */
  private skPose: PoseBuffers;
  /** @nonSerialized */
  private bufA: PoseBuffers;
  /** @nonSerialized */
  private bufB: PoseBuffers;
  /** @nonSerialized */
  private allMask: Uint8Array;
  // saída de pickBlend (evita devolver 3 valores)
  /** @nonSerialized */
  private pickA: number;
  /** @nonSerialized */
  private pickB: number;
  /** @nonSerialized */
  private pickW: f64;

  constructor() {
    super();
    this.controller = "";
    this.ctrl = null; this.bind = null; this.sk = null; this.boundAsset = null;
    this.loadedPath = ""; this.ready = false; this.err = "";
    this.failedSk = null; this.failedAsset = null; this.failedCtrl = null;
    this.params = new Float64Array(0);
    this.layerCur = []; this.layerPrev = [];
    this.curNorm = new Float64Array(0); this.prevNorm = new Float64Array(0);
    this.fadeT = new Float64Array(0); this.fadeDur = new Float64Array(0);
    this.skPose = new PoseBuffers(0); this.bufA = new PoseBuffers(0); this.bufB = new PoseBuffers(0);
    this.allMask = new Uint8Array(0);
    this.pickA = 0; this.pickB = 0; this.pickW = 0.0;
  }

  typeName(): string { return "Animator"; }

  mount(): void { this.ensureReady(); }

  onValidate(field: string): void {
    if (field === "controller") { this.ctrl = null; this.loadedPath = ""; this.ready = false; this.ensureReady(); }
  }

  /// Troca o controlador RELENDO o arquivo do disco (o autor pode tê-lo
  /// editado). Devolve true se carregou e ligou sem erro; senão o motivo fica
  /// em `errorText()` e o componente fica inerte.
  load(path: string): boolean {
    this.controller = path;
    this.ctrl = reloadAnimatorController(path);
    this.loadedPath = path;
    this.resetRuntime();
    this.ready = false;
    return this.ensureReady();
  }

  /// "" = funcionando; senão o motivo legível de estar inerte.
  errorText(): string {
    if (!this.ready) this.ensureReady();
    return this.err;
  }

  /// Volta parâmetros aos padrões e cada camada ao estado inicial (tempo 0,
  /// sem fade). A prévia do editor usa ao encerrar.
  resetRuntime(): void {
    const c = this.ctrl;
    if (c === null || c.error !== "") {
      this.params = new Float64Array(0); this.layerCur = []; this.layerPrev = [];
      this.curNorm = new Float64Array(0); this.prevNorm = new Float64Array(0);
      this.fadeT = new Float64Array(0); this.fadeDur = new Float64Array(0);
      return;
    }
    const np = c.paramNames.length;
    if (this.params.length !== np) this.params = new Float64Array(np);
    let i = 0;
    while (i < np) { this.params[i] = c.paramDefaults[i]; i = i + 1; }
    const nl = c.layerNames.length;
    if (this.curNorm.length !== nl) {
      this.curNorm = new Float64Array(nl); this.prevNorm = new Float64Array(nl);
      this.fadeT = new Float64Array(nl); this.fadeDur = new Float64Array(nl);
    }
    const cur: number[] = []; const prev: number[] = [];
    i = 0;
    while (i < nl) {
      cur.push(c.layerInitial[i]); prev.push(0 - 1);
      this.curNorm[i] = 0.0; this.prevNorm[i] = 0.0; this.fadeT[i] = 0.0; this.fadeDur[i] = 0.0;
      i = i + 1;
    }
    this.layerCur = cur; this.layerPrev = prev;
  }

  // ── parâmetros ───────────────────────────────────────────────────────────
  /// Índice do parâmetro `name` (-1 se não existe). Para scripts quentes:
  /// resolva 1x e use os `*At`.
  paramIndex(name: string): number {
    this.ensureController();
    const c = this.ctrl;
    return c === null ? 0 - 1 : c.paramNames.indexOf(name);
  }
  paramCount(): number { this.ensureController(); return this.params.length; }
  paramName(i: number): string { const c = this.ctrl; return c !== null && i >= 0 && i < c.paramNames.length ? c.paramNames[i] : ""; }
  /// PARAM_FLOAT / PARAM_BOOL / PARAM_TRIGGER (-1 se fora da faixa).
  paramType(i: number): number { const c = this.ctrl; return c !== null && i >= 0 && i < c.paramTypes.length ? c.paramTypes[i] : 0 - 1; }
  /// Valor cru (bool/trigger = 0/1).
  paramValue(i: number): f64 { return i >= 0 && i < this.params.length ? this.params[i] : 0.0; }

  setFloatAt(i: number, v: f64): void { if (this.isType(i, PARAM_FLOAT)) this.params[i] = v; }
  setBoolAt(i: number, v: boolean): void { if (this.isType(i, PARAM_BOOL)) this.params[i] = v ? 1.0 : 0.0; }
  setTriggerAt(i: number): void { if (this.isType(i, PARAM_TRIGGER)) this.params[i] = 1.0; }
  resetTriggerAt(i: number): void { if (this.isType(i, PARAM_TRIGGER)) this.params[i] = 0.0; }

  setFloat(name: string, v: f64): void { this.setFloatAt(this.paramIndex(name), v); }
  setBool(name: string, v: boolean): void { this.setBoolAt(this.paramIndex(name), v); }
  /// Arma o trigger: fica armado até uma transição consumi-lo ou `resetTrigger`.
  setTrigger(name: string): void { this.setTriggerAt(this.paramIndex(name)); }
  resetTrigger(name: string): void { this.resetTriggerAt(this.paramIndex(name)); }
  getFloat(name: string): f64 { return this.paramValue(this.paramIndex(name)); }
  /// Bool: o valor; trigger: armado ou não.
  getBool(name: string): boolean { return this.paramValue(this.paramIndex(name)) !== 0.0; }

  // ── estado (UI, WS, scripts) ─────────────────────────────────────────────
  layerCount(): number { return this.ready ? this.layerCur.length : 0; }
  layerName(layer: number): string { const c = this.ctrl; return this.ready && c !== null && layer >= 0 && layer < c.layerNames.length ? c.layerNames[layer] : ""; }
  /// Nome do estado atual da camada ("" se inerte/fora da faixa).
  stateName(layer: number): string {
    const c = this.ctrl;
    if (!this.ready || c === null || layer < 0 || layer >= this.layerCur.length) return "";
    return c.stateNames[this.layerCur[layer]];
  }
  /// Tempo NORMALIZADO do estado atual (1,0 = um ciclo do clipe/mistura;
  /// continua crescendo em estados com laço, como o normalizedTime da Unity).
  stateTime(layer: number): f64 { return this.ready && layer >= 0 && layer < this.curNorm.length ? this.curNorm[layer] : 0.0; }
  /// Estado de saída do fade em andamento ("" = sem fade).
  fadingFrom(layer: number): string {
    const c = this.ctrl;
    if (!this.ready || c === null || layer < 0 || layer >= this.layerPrev.length || this.layerPrev[layer] < 0) return "";
    return c.stateNames[this.layerPrev[layer]];
  }
  /// Progresso do fade em andamento (0..1; 1 = sem fade).
  fadeProgress(layer: number): f64 {
    if (!this.ready || layer < 0 || layer >= this.layerPrev.length || this.layerPrev[layer] < 0) return 1.0;
    const d = this.fadeDur[layer];
    return d > 0.0 ? Math.min(1.0, this.fadeT[layer] / d) : 1.0;
  }

  // ── frame ────────────────────────────────────────────────────────────────
  update(dt: f64): void {
    if (!this.ensureReady()) return;
    const sk = this.sk;
    const c = this.ctrl;
    if (sk === null || c === null) return;
    sk.applyManualPose();   // base: repouso + pose do autor
    const n = this.layerCur.length;
    let l = 0;
    while (l < n) {
      this.advanceLayer(l, dt);
      this.checkTransitions(l);
      this.writeLayer(l);
      l = l + 1;
    }
  }

  private isType(i: number, t: number): boolean {
    const c = this.ctrl;
    return c !== null && i >= 0 && i < this.params.length && c.paramTypes[i] === t;
  }

  // Carrega o controlador de `this.controller` se ainda não carregado (sem
  // modelo — os parâmetros já funcionam antes do Skeleton existir).
  private ensureController(): void {
    if (this.ctrl !== null && this.loadedPath === this.controller) return;
    this.ctrl = loadAnimatorController(this.controller);
    this.loadedPath = this.controller;
    this.ready = false;
    this.resetRuntime();
  }

  // Caminho quente: 3 comparações de campo. Religa se o Skeleton foi
  // removido/trocado (owner) ou o modelo dele mudou (asset).
  private ensureReady(): boolean {
    const sk = this.sk;
    if (this.ready && sk !== null && sk.owner === this.owner && sk.asset === this.boundAsset) return true;
    return this.rebind();
  }

  private rebind(): boolean {
    this.ready = false;
    this.ensureController();
    const c = this.ctrl;
    const sk = this.findSkeleton();
    this.sk = sk;
    if (sk !== null) { sk.ensureAsset(0); sk.poseDriver = this; }
    const asset = sk !== null ? sk.asset : null;
    // mesma tentativa que já falhou: não refaz (nem monta texto) por frame
    if (this.err !== "" && sk === this.failedSk && asset === this.failedAsset && c === this.failedCtrl) return false;
    this.failedSk = sk; this.failedAsset = asset; this.failedCtrl = c;
    if (c === null) { this.err = "nenhum controlador"; return false; }
    if (c.error !== "") { this.err = c.error; return false; }
    if (sk === null) { this.err = "o objeto precisa de um Skeleton"; return false; }
    if (asset === null) { this.err = "o modelo do Skeleton nao carregou: " + sk.modelPath; return false; }
    const b = bindAnimatorController(c, asset);
    if (b.error !== "") { this.err = b.error; return false; }
    this.bind = b;
    this.boundAsset = asset;
    const nb = asset.boneNames.length;
    if (this.allMask.length !== nb) {
      this.bufA = new PoseBuffers(nb); this.bufB = new PoseBuffers(nb);
      const m = new Uint8Array(nb);
      let i = 0;
      while (i < nb) { m[i] = 1; i = i + 1; }
      this.allMask = m;
    }
    this.skPose.t = sk.poseT; this.skPose.r = sk.poseR; this.skPose.s = sk.poseS;
    if (this.layerCur.length !== c.layerNames.length) this.resetRuntime();
    this.err = "";
    this.failedSk = null; this.failedAsset = null; this.failedCtrl = null;
    this.ready = true;
    return true;
  }

  // Skeleton do mesmo objeto (o cache vale enquanto o owner bater).
  private findSkeleton(): Skeleton | null {
    const cached = this.sk;
    if (cached !== null && cached.owner === this.owner && this.owner !== null) return cached;
    const o: GameObject | null = this.owner;
    if (o === null) return null;
    let i = 0;
    while (i < o.behaviors.length) {
      const b = o.behaviors[i];
      if (b instanceof Skeleton) return b;
      i = i + 1;
    }
    return null;
  }

  // Duração (s) do estado `s` agora — mistura: lerp das durações dos vizinhos.
  private stateDuration(s: number): f64 {
    const c = this.ctrl!; const b = this.bind!;
    if (c.stateKind[s] === STATE_CLIP) return b.stateDur[s];
    this.pickBlend(s);
    const da = b.blendDur[this.pickA];
    return da + (b.blendDur[this.pickB] - da) * this.pickW;
  }

  // Vizinhos da mistura 1D para o valor atual do parâmetro: pickA/pickB
  // (índices de entrada de mistura) e pickW (peso de B). Fora da faixa grampeia.
  private pickBlend(s: number): void {
    const c = this.ctrl!;
    const start = c.stateBlendStart[s];
    const last = start + c.stateBlendCount[s] - 1;
    const thr = c.blendThreshold;
    const v = this.params[c.stateBlendParam[s]];
    if (v <= thr[start] || last === start) { this.pickA = start; this.pickB = start; this.pickW = 0.0; return; }
    if (v >= thr[last]) { this.pickA = last; this.pickB = last; this.pickW = 0.0; return; }
    let i = start;
    while (i < last - 1 && v >= thr[i + 1]) i = i + 1;
    this.pickA = i; this.pickB = i + 1;
    this.pickW = (v - thr[i]) / (thr[i + 1] - thr[i]);
  }

  private advanceLayer(l: number, dt: f64): void {
    const c = this.ctrl!;
    const cur = this.layerCur[l];
    const dc = this.stateDuration(cur);
    if (dc > 0.0) this.curNorm[l] = this.curNorm[l] + dt * c.stateSpeed[cur] / dc;
    const prev = this.layerPrev[l];
    if (prev >= 0) {
      const dp = this.stateDuration(prev);
      if (dp > 0.0) this.prevNorm[l] = this.prevNorm[l] + dt * c.stateSpeed[prev] / dp;
      const ft = this.fadeT[l] + dt;
      this.fadeT[l] = ft;
      if (ft >= this.fadeDur[l]) this.layerPrev[l] = 0 - 1;
    }
  }

  private checkTransitions(l: number): void {
    const c = this.ctrl!;
    const cur = this.layerCur[l];
    const start = c.layerTransStart[l];
    const end = start + c.layerTransCount[l];
    const from = c.transFrom; const to = c.transTo; const exit = c.transExit;
    let t = start;
    while (t < end) {
      const f = from[t]; const dest = to[t];
      const fromOk = f === FROM_ANY ? dest !== cur : f === cur;
      if (fromOk && (exit[t] === NO_EXIT || this.curNorm[l] >= exit[t]) && this.conditionsPass(t)) {
        this.consumeTriggers(t);
        const fade = c.transFade[t];
        if (fade > 0.0) { this.layerPrev[l] = cur; this.prevNorm[l] = this.curNorm[l]; }
        else this.layerPrev[l] = 0 - 1;
        this.layerCur[l] = dest;
        this.curNorm[l] = 0.0;
        this.fadeT[l] = 0.0;
        this.fadeDur[l] = fade;
        return;
      }
      t = t + 1;
    }
  }

  private conditionsPass(t: number): boolean {
    const c = this.ctrl!;
    const start = c.transCondStart[t];
    const end = start + c.transCondCount[t];
    const cp = c.condParam; const co = c.condOp; const cv = c.condValue;
    const params = this.params;
    let k = start;
    while (k < end) {
      const v = params[cp[k]]; const op = co[k]; const x = cv[k];
      let ok: boolean;
      if (op === COND_TRUE) ok = v !== 0.0;
      else if (op === COND_EQ) ok = v === x;
      else if (op === COND_NE) ok = v !== x;
      else if (op === COND_GT) ok = v > x;
      else if (op === COND_LT) ok = v < x;
      else if (op === COND_GE) ok = v >= x;
      else ok = v <= x;
      if (!ok) return false;
      k = k + 1;
    }
    return true;
  }

  private consumeTriggers(t: number): void {
    const c = this.ctrl!;
    const start = c.transCondStart[t];
    const end = start + c.transCondCount[t];
    let k = start;
    while (k < end) {
      const p = c.condParam[k];
      if (c.paramTypes[p] === PARAM_TRIGGER) this.params[p] = 0.0;
      k = k + 1;
    }
  }

  private writeLayer(l: number): void {
    const c = this.ctrl!;
    const w = c.layerWeight[l];
    if (w <= 0.0) return;
    const direct = w >= 1.0 && c.layerMaskNames[l].length === 0;
    const sk = this.skPose;
    const dst = direct ? sk : this.bufA;
    if (!direct) copyPoseInto(dst, sk);
    const prev = this.layerPrev[l];
    if (prev >= 0) {
      // o estado de saída vai em `dst`, o de entrada num buffer que parte da
      // MESMA base; depois mistura pelo progresso do fade
      const b = this.bufB;
      copyPoseInto(b, dst);
      this.evalState(prev, this.prevNorm[l], dst);
      this.evalState(this.layerCur[l], this.curNorm[l], b);
      const d = this.fadeDur[l];
      blendPoseInto(dst, b, d > 0.0 ? Math.min(1.0, this.fadeT[l] / d) : 1.0, this.allMask);
    } else {
      this.evalState(this.layerCur[l], this.curNorm[l], dst);
    }
    if (!direct) blendPoseInto(sk, dst, w, this.bind!.layerMask[l]);
  }

  // Amostra o estado `s` no tempo normalizado `norm` em `dst` (laço envolve,
  // sem laço grampeia no fim).
  private evalState(s: number, norm: f64, dst: PoseBuffers): void {
    const c = this.ctrl!; const b = this.bind!;
    const clips = b.asset.clips;
    let phase = norm;
    if (c.stateLoop[s] !== 0) phase = norm - Math.floor(norm);
    else if (phase > 1.0) phase = 1.0;
    else if (phase < 0.0) phase = 0.0;
    if (c.stateKind[s] === STATE_CLIP) {
      samplePoseInto(dst, clips[b.stateClip[s]], phase * b.stateDur[s], 1.0);
      return;
    }
    this.pickBlend(s);
    const a = this.pickA; const bb = this.pickB; const w = this.pickW;
    if (w < 1.0) samplePoseInto(dst, clips[b.blendClip[a]], phase * b.blendDur[a], 1.0);
    if (w > 0.0) samplePoseInto(dst, clips[b.blendClip[bb]], phase * b.blendDur[bb], w);
  }
}
