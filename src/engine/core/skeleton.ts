// Engine RTS — Skeleton: um modelo glTF de OSSOS RÍGIDOS (cada peça de malha
// presa a um nó) desenhado pela pose atual. É o Renderer do objeto (kind
// RENDERER): o laço de render pergunta `drawSelf(win)` e o componente desenha as
// peças, uma por osso, com a rotação de mundo em quaternion.
//
// DUAS POSES, de propósito:
//   - a pose MANUAL (`manualT/R/S` + `overrideMask`) é o que o autor posicionou à
//     mão e o que vai para a cena salva;
//   - a pose de TRABALHO (`poseT/R/S`) é o que se desenha. Um clipe tocando (o
//     AnimationPlayer) escreve só nela, então tocar/pré-visualizar não corrompe
//     a pose salva. Sem clipe, pose de trabalho = repouso + manual
//     (`applyManualPose`).
//
// Sem alocação por frame: os buffers por osso nascem uma vez em `ensureAsset`
// (tamanho = número de ossos) e os temporários do `compose` no construtor.

import { Behavior, KIND_RENDERER } from "./behavior";
import { SkeletonAsset, loadSkeletonAsset, skeletonNeedsUpload } from "../render/gltf_anim";
import { logWarn } from "./logger";
import { drawGPUMeshQ, meshRadius } from "../render/gpu3d";
import { quatFromYawPitchInto } from "../render/quat";

/// Valores por osso num registro salvo: [osso, tx,ty,tz, rx,ry,rz,rw, sx,sy,sz].
/// `osso` é o NOME (formato atual) ou o índice (registros antigos).
const POSE_REC_LEN: number = 11;
/// Registros antigos/manuais podem vir sem escala (só osso + T + R).
const POSE_REC_MIN: number = 8;

/**
 * @componentCategory Renderização
 * @componentDescription Desenha um modelo glTF de ossos rígidos e guarda a pose posicionada à mão.
 * @componentKeywords ossos esqueleto personagem glb gltf pose animação
 */
export class Skeleton extends Behavior {
  /// Caminho do .glb (ossos + peças + clipes).
  modelPath: string;
  /** @nonSerialized */
  asset: SkeletonAsset | null;
  /** @nonSerialized */
  poseT: Float64Array;
  /** @nonSerialized */
  poseR: Float64Array;
  /** @nonSerialized */
  poseS: Float64Array;
  /** @nonSerialized */
  manualT: Float64Array;
  /** @nonSerialized */
  manualR: Float64Array;
  /** @nonSerialized */
  manualS: Float64Array;
  /** @nonSerialized */
  worldT: Float64Array;
  /** @nonSerialized */
  worldR: Float64Array;
  /** @nonSerialized */
  worldS: Float64Array;
  /** @nonSerialized */
  overrideMask: number[];
  /** @nonSerialized */
  boundRadius: f64;

  // Pose manual lida da cena antes de o modelo carregar (registros de
  // POSE_REC_LEN; a 1ª posição é o índice antigo) e o nome do osso de cada
  // registro ("" = usar o índice). Aplicada no próximo ensureAsset.
  private pendingPose: number[];
  private pendingNames: string[];
  // Caminho que falhou ao carregar: não tenta de novo a cada frame.
  private failedPath: string;
  // Janela cujo upload das peças falhou: não tenta de novo a cada frame.
  private failedUploadWin: number;
  // temporário do compose (nunca alocado por frame) — só o quaternion da raiz
  // (yaw do host); o resto da matemática do quaternion está aberta em locais
  // f64 dentro de `compose()` (ver o comentário do método).
  private rootR: Float64Array;
  private drawQ: Float64Array;

  constructor(pathArg?: string) {
    super();
    this.modelPath = pathArg !== undefined ? pathArg : "";
    this.asset = null;
    this.poseT = new Float64Array(0); this.poseR = new Float64Array(0); this.poseS = new Float64Array(0);
    this.manualT = new Float64Array(0); this.manualR = new Float64Array(0); this.manualS = new Float64Array(0);
    this.worldT = new Float64Array(0); this.worldR = new Float64Array(0); this.worldS = new Float64Array(0);
    this.overrideMask = [];
    this.boundRadius = 0.0;
    this.pendingPose = [];
    this.pendingNames = [];
    this.failedPath = "";
    this.failedUploadWin = 0;
    this.rootR = new Float64Array(4);
    this.drawQ = new Float64Array(4);
  }

  kind(): number { return KIND_RENDERER; }
  drawsSelf(): number { return 1; }
  rBoundRadius(): f64 { return this.boundRadius; }
  typeName(): string { return "Skeleton"; }

  /// Trocar o modelo no Inspector descarta o asset; o próximo desenho recarrega.
  onValidate(field: string): void {
    if (field === "modelPath") {
      this.asset = null; this.failedPath = ""; this.failedUploadWin = 0;
      this.pendingPose = []; this.pendingNames = [];
      // o raio era do modelo antigo; o próximo ensureAsset publica o novo
      this.boundRadius = 0.0;
      const owner = this.owner;
      if (owner !== null && owner.rendIdx >= 0 && owner.behaviors[owner.rendIdx] === this) owner.boundRadius = 0.0;
    }
  }

  /// Carrega o modelo (cache por caminho) e dimensiona os buffers por osso, uma
  /// vez. `win` = 0 não sobe nada para a GPU (testes sem janela); se o asset
  /// veio de uma carga sem janela, a primeira chamada com janela real sobe as
  /// peças (ver `loadSkeletonAsset`).
  ensureAsset(win: number): void {
    const cur = this.asset;
    if (cur !== null && cur.path === this.modelPath) {
      if (skeletonNeedsUpload(cur, win) && this.failedUploadWin !== win) {
        try { loadSkeletonAsset(win, this.modelPath); this.updateBound(); }
        catch (e) { this.failedUploadWin = win; logWarn("Skeleton: falha ao subir as pecas de " + this.modelPath); }
      }
      return;
    }
    if (this.modelPath === "" || this.modelPath === this.failedPath) return;
    const a = this.tryLoad(win);
    if (a === null) return;   // falhou (já avisado; não tenta de novo)
    const n = a.boneNames.length;
    this.asset = a;
    this.poseT = new Float64Array(n * 3); this.poseR = new Float64Array(n * 4); this.poseS = new Float64Array(n * 3);
    this.manualT = new Float64Array(n * 3); this.manualR = new Float64Array(n * 4); this.manualS = new Float64Array(n * 3);
    this.worldT = new Float64Array(n * 3); this.worldR = new Float64Array(n * 4); this.worldS = new Float64Array(n * 3);
    const mask: number[] = [];
    let i = 0;
    while (i < n) { mask.push(0); i = i + 1; }
    this.overrideMask = mask;
    this.copyRest(this.manualT, this.manualR, this.manualS);
    // pose manual vinda da cena
    const p = this.pendingPose;
    let k = 0;
    let r = 0;
    while (k + POSE_REC_LEN <= p.length) {
      const nome = this.pendingNames[r];
      const b = nome !== "" ? a.boneNames.indexOf(nome) : (p[k] | 0);
      if (b < 0 || b >= n) logWarn("Skeleton: osso '" + (nome !== "" ? nome : ("" + p[k])) + "' nao existe em " + this.modelPath + "; pose descartada");
      else {
        this.manualT[b * 3] = p[k + 1]; this.manualT[b * 3 + 1] = p[k + 2]; this.manualT[b * 3 + 2] = p[k + 3];
        this.manualR[b * 4] = p[k + 4]; this.manualR[b * 4 + 1] = p[k + 5];
        this.manualR[b * 4 + 2] = p[k + 6]; this.manualR[b * 4 + 3] = p[k + 7];
        this.manualS[b * 3] = p[k + 8]; this.manualS[b * 3 + 1] = p[k + 9]; this.manualS[b * 3 + 2] = p[k + 10];
        this.overrideMask[b] = 1;
      }
      k = k + POSE_REC_LEN;
      r = r + 1;
    }
    this.pendingPose = [];
    this.pendingNames = [];
    this.applyManualPose();
    this.updateBound();
  }

  /// Raio da esfera (centro na ORIGEM do objeto, nos pés) que contém o modelo
  /// em qualquer pose, em unidades do objeto: por osso, soma dos comprimentos
  /// dos ossos até a raiz (limite que nenhuma rotação ultrapassa) + raio da
  /// peça. O culling usava 0.87 (cubo unitário) e o personagem sumia na borda
  /// da tela. Roda ao carregar/subir o modelo, nunca por frame; publica o raio
  /// no `boundRadius` do objeto se este é o renderer dele.
  private updateBound(): void {
    const a = this.asset;
    if (a === null) return;
    const n = a.boneNames.length;
    const reach = new Float64Array(n);
    const scale = new Float64Array(n);
    let b = 0;
    while (b < n) {
      const p = a.boneParent[b];
      const parentReach: f64 = p >= 0 ? reach[p] : 0.0;
      const parentScale: f64 = p >= 0 ? scale[p] : 1.0;
      const tx = a.restT[b * 3]; const ty = a.restT[b * 3 + 1]; const tz = a.restT[b * 3 + 2];
      reach[b] = parentReach + Math.sqrt(tx * tx + ty * ty + tz * tz) * parentScale;
      let maxS: f64 = Math.abs(a.restS[b * 3]);
      if (Math.abs(a.restS[b * 3 + 1]) > maxS) maxS = Math.abs(a.restS[b * 3 + 1]);
      if (Math.abs(a.restS[b * 3 + 2]) > maxS) maxS = Math.abs(a.restS[b * 3 + 2]);
      scale[b] = parentScale * maxS;
      b = b + 1;
    }
    let r: f64 = 0.0;
    let i = 0;
    while (i < a.partBone.length) {
      const pb = a.partBone[i];
      if (pb >= 0 && pb < n) {
        const pr = reach[pb] + meshRadius(a.partMesh[i]) * scale[pb];
        if (pr > r) r = pr;
      }
      i = i + 1;
    }
    this.boundRadius = r;
    const owner = this.owner;
    if (owner !== null && owner.rendIdx >= 0 && owner.behaviors[owner.rendIdx] === this) owner.boundRadius = r;
  }

  boneCount(): number { return this.asset !== null ? this.asset.boneNames.length : 0; }
  boneIndex(name: string): number { return this.asset !== null ? this.asset.boneNames.indexOf(name) : 0 - 1; }

  /// Pose de trabalho = repouso + pose manual (o que se vê sem clipe tocando).
  applyManualPose(): void {
    const a = this.asset;
    if (a === null) return;
    this.copyRest(this.poseT, this.poseR, this.poseS);
    const n = a.boneNames.length;
    let b = 0;
    while (b < n) {
      if (this.overrideMask[b] !== 0) {
        let j = 0;
        while (j < 3) {
          this.poseT[b * 3 + j] = this.manualT[b * 3 + j];
          this.poseS[b * 3 + j] = this.manualS[b * 3 + j];
          j = j + 1;
        }
        j = 0;
        while (j < 4) { this.poseR[b * 4 + j] = this.manualR[b * 4 + j]; j = j + 1; }
      }
      b = b + 1;
    }
  }

  /// Volta tudo ao repouso e esquece a pose manual.
  resetPose(): void {
    const a = this.asset;
    if (a === null) { this.pendingPose = []; this.pendingNames = []; return; }
    this.copyRest(this.manualT, this.manualR, this.manualS);
    let b = 0;
    while (b < this.overrideMask.length) { this.overrideMask[b] = 0; b = b + 1; }
    this.copyRest(this.poseT, this.poseR, this.poseS);
  }

  /// Rotação LOCAL do osso (em relação ao pai), posicionada à mão.
  setBoneRotation(bone: number, q: Float64Array): void {
    if (bone < 0 || bone >= this.boneCount()) return;
    let j = 0;
    while (j < 4) { this.manualR[bone * 4 + j] = q[j]; this.poseR[bone * 4 + j] = q[j]; j = j + 1; }
    this.markOverride(bone);
  }

  /// Posição LOCAL do osso (em relação ao pai), posicionada à mão.
  setBonePosition(bone: number, x: f64, y: f64, z: f64): void {
    if (bone < 0 || bone >= this.boneCount()) return;
    this.manualT[bone * 3] = x; this.manualT[bone * 3 + 1] = y; this.manualT[bone * 3 + 2] = z;
    this.poseT[bone * 3] = x; this.poseT[bone * 3 + 1] = y; this.poseT[bone * 3 + 2] = z;
    this.markOverride(bone);
  }

  /// Pose de MUNDO de cada osso a partir do host (posição de mundo, yaw, escala)
  /// e da hierarquia (pais antes dos filhos, garantido pelo leitor).
  ///
  /// MEDIDO (fix round 1, RTS_GC_DEBUG): a versão anterior ia e voltava por
  /// `quatMulInto`/`quatRotateInto` através de `this.parR/locR/outR/vIn/vOut`
  /// (Float64Array de 4 elementos, escrito/lido a cada osso) — 17 personagens
  /// x 1000 quadros custavam ~0,33 ms só em `compose()`. `compose()` é um
  /// método de ZERO parâmetros (só o custo por PARÂMETRO+locais importa pro
  /// defeito de alocação do runtime — ver animation_player.ts), então dá pra
  /// abrir a matemática do quaternion em locais `f64` sem risco disso; o que
  /// sobra é ida-e-volta por array que não precisa existir. Ganho: os campos
  /// do `host`/pai são lidos 1x por osso em locais em vez de ida por
  /// `this.worldT[p*3]` repetida 3x, e `quatMulInto`/`quatRotateInto` (que
  /// escreviam em `this.outR`/`this.vOut` e eram copiados de volta pro
  /// `worldT`/`worldR`) virou a mesma matemática, inline, escrevendo direto
  /// nos arrays de saída.
  compose(): void {
    const t = this.host;
    this.composeAt(t.wx, t.wy, t.wz);
  }

  /// `compose` com a raiz em (x, y, z) em vez da posição simulada do host — o
  /// desenho passa a posição de RENDER (interpolada), como os demais objetos.
  composeAt(hostX: f64, hostY: f64, hostZ: f64): void {
    const a = this.asset;
    if (a === null) return;
    const t = this.host;
    quatFromYawPitchInto(this.rootR, t.wry, 0.0);
    // raiz: yaw do host (calculado 1x acima) + posição/escala do host — lidos
    // 1x aqui, não a cada osso sem pai.
    const rootRX = this.rootR[0]; const rootRY = this.rootR[1]; const rootRZ = this.rootR[2]; const rootRW = this.rootR[3];
    const hostSX = t.sx; const hostSY = t.sy; const hostSZ = t.sz;
    const n = a.boneNames.length;
    const boneParent = a.boneParent;
    const poseT = this.poseT; const poseR = this.poseR; const poseS = this.poseS;
    const worldT = this.worldT; const worldR = this.worldR; const worldS = this.worldS;
    let b = 0;
    while (b < n) {
      const p = boneParent[b];
      let ptx: f64; let pty: f64; let ptz: f64;
      let psx: f64; let psy: f64; let psz: f64;
      let prx: f64; let pry: f64; let prz: f64; let prw: f64;
      if (p >= 0) {
        const po3 = p * 3; const po4 = p * 4;
        ptx = worldT[po3]; pty = worldT[po3 + 1]; ptz = worldT[po3 + 2];
        psx = worldS[po3]; psy = worldS[po3 + 1]; psz = worldS[po3 + 2];
        prx = worldR[po4]; pry = worldR[po4 + 1]; prz = worldR[po4 + 2]; prw = worldR[po4 + 3];
      } else {
        ptx = hostX; pty = hostY; ptz = hostZ;
        psx = hostSX; psy = hostSY; psz = hostSZ;
        prx = rootRX; pry = rootRY; prz = rootRZ; prw = rootRW;
      }
      const bo3 = b * 3; const bo4 = b * 4;
      // posição: pai + rot(pai) · (poseT ⊙ escala do pai) — quatRotateInto
      // aberto: out = v + w*(2(q x v)) + q x (2(q x v)), sem ida por array.
      const vx = poseT[bo3] * psx; const vy = poseT[bo3 + 1] * psy; const vz = poseT[bo3 + 2] * psz;
      const tx2 = 2.0 * (pry * vz - prz * vy); const ty2 = 2.0 * (prz * vx - prx * vz); const tz2 = 2.0 * (prx * vy - pry * vx);
      worldT[bo3] = ptx + vx + prw * tx2 + (pry * tz2 - prz * ty2);
      worldT[bo3 + 1] = pty + vy + prw * ty2 + (prz * tx2 - prx * tz2);
      worldT[bo3 + 2] = ptz + vz + prw * tz2 + (prx * ty2 - pry * tx2);
      // rotação: pai · local — quatMulInto aberto.
      const lrx = poseR[bo4]; const lry = poseR[bo4 + 1]; const lrz = poseR[bo4 + 2]; const lrw = poseR[bo4 + 3];
      worldR[bo4] = prw * lrx + prx * lrw + pry * lrz - prz * lry;
      worldR[bo4 + 1] = prw * lry - prx * lrz + pry * lrw + prz * lrx;
      worldR[bo4 + 2] = prw * lrz + prx * lry - pry * lrx + prz * lrw;
      worldR[bo4 + 3] = prw * lrw - prx * lrx - pry * lry - prz * lrz;
      // escala acumulada
      worldS[bo3] = psx * poseS[bo3];
      worldS[bo3 + 1] = psy * poseS[bo3 + 1];
      worldS[bo3 + 2] = psz * poseS[bo3 + 2];
      b = b + 1;
    }
  }

  /// Desenha cada peça no osso dela, com a raiz na posição de render (x,y,z)
  /// e, se `tint` >= 0, todas as peças nessa cor (seleção). 1 = desenhou (o laço de render pula o
  /// desenho por meshKind); 0 = sem modelo, o laço segue o caminho normal.
  drawSelf(win: number, x: f64, y: f64, z: f64, tint: number): number {
    this.ensureAsset(win);
    const a = this.asset;
    if (a === null) return 0;
    this.composeAt(x, y, z);
    const q = this.drawQ;
    let i = 0;
    while (i < a.partBone.length) {
      const mesh = a.partMesh[i];
      const b = a.partBone[i];
      if (mesh > 0 && b >= 0) {
        q[0] = this.worldR[b * 4]; q[1] = this.worldR[b * 4 + 1]; q[2] = this.worldR[b * 4 + 2]; q[3] = this.worldR[b * 4 + 3];
        drawGPUMeshQ(win, mesh, this.worldT[b * 3], this.worldT[b * 3 + 1], this.worldT[b * 3 + 2], q,
          this.worldS[b * 3], this.worldS[b * 3 + 1], this.worldS[b * 3 + 2], tint >= 0 ? tint : a.partColor[i], 0, a.partTex[i]);
      }
      i = i + 1;
    }
    return 1;
  }

  /// Cena: caminho do modelo + pose MANUAL só dos ossos com override (a pose de
  /// trabalho, que um clipe pode estar mexendo, não é salva).
  toData(): any {
    const pose: any[] = [];
    const a = this.asset;
    if (a === null) {
      // modelo ainda não carregado: devolve a pose lida da cena, intacta
      let k = 0;
      let r = 0;
      while (k + POSE_REC_LEN <= this.pendingPose.length) {
        const rec: any[] = [];
        if (this.pendingNames[r] !== "") rec.push(this.pendingNames[r]); else rec.push(this.pendingPose[k]);
        let j = 1;
        while (j < POSE_REC_LEN) { rec.push(this.pendingPose[k + j]); j = j + 1; }
        pose.push(rec);
        k = k + POSE_REC_LEN;
        r = r + 1;
      }
    } else {
      let b = 0;
      while (b < this.overrideMask.length) {
        if (this.overrideMask[b] !== 0) {
          pose.push([a.boneNames[b],
            this.manualT[b * 3], this.manualT[b * 3 + 1], this.manualT[b * 3 + 2],
            this.manualR[b * 4], this.manualR[b * 4 + 1], this.manualR[b * 4 + 2], this.manualR[b * 4 + 3],
            this.manualS[b * 3], this.manualS[b * 3 + 1], this.manualS[b * 3 + 2]]);
        }
        b = b + 1;
      }
    }
    return { type: "skeleton", modelPath: this.modelPath, pose: pose };
  }

  /// Recria a partir de `toData()` (load, duplicar e Rodar). Não carrega o
  /// modelo: a pose fica pendente até o primeiro `ensureAsset`.
  static fromData(sd: any): Skeleton {
    const path: string = typeof sd.modelPath === "string" ? sd.modelPath : (typeof sd.path === "string" ? sd.path : "");
    const s = new Skeleton(path);
    const pose = sd.pose;
    if (pose !== undefined && pose !== null) {
      let i = 0;
      while (i < pose.length) {
        const r = pose[i];
        if (r !== undefined && r !== null && r.length >= POSE_REC_MIN) {
          // 1ª posição: nome do osso (atual) ou índice (registros antigos)
          if (typeof r[0] === "string") { s.pendingNames.push(r[0]); s.pendingPose.push(0 - 1); }
          else { s.pendingNames.push(""); s.pendingPose.push(r[0]); }
          let j = 1;
          while (j < POSE_REC_MIN) { s.pendingPose.push(r[j]); j = j + 1; }
          // escala opcional (registros sem escala = 1)
          let sj = POSE_REC_MIN;
          while (sj < POSE_REC_LEN) { s.pendingPose.push(r.length > sj ? r[sj] : 1.0); sj = sj + 1; }
        }
        i = i + 1;
      }
    }
    return s;
  }

  // Carrega o modelo; null = falhou (registra o caminho e avisa uma vez).
  private tryLoad(win: number): SkeletonAsset | null {
    try {
      return loadSkeletonAsset(win, this.modelPath);
    } catch (e) {
      this.failedPath = this.modelPath;
      logWarn("Skeleton: nao carregou " + this.modelPath);
      return null;
    }
  }

  private markOverride(bone: number): void {
    this.overrideMask[bone] = 1;
  }

  // Copia o repouso do asset para três buffers de pose (T/R/S).
  private copyRest(dT: Float64Array, dR: Float64Array, dS: Float64Array): void {
    const a = this.asset;
    if (a === null) return;
    let i = 0;
    while (i < a.restT.length) { dT[i] = a.restT[i]; dS[i] = a.restS[i]; i = i + 1; }
    i = 0;
    while (i < a.restR.length) { dR[i] = a.restR[i]; i = i + 1; }
  }
}
