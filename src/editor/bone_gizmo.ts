// Editor RTS — matemática do gizmo e dos campos numéricos quando o alvo é um
// OSSO (S.selectedBone >= 0), sem janela, para os testes cobrirem.
//
// Convenções (as mesmas do `pose` do WebSocket):
//   - os eixos do gizmo são de MUNDO; o osso guarda rotação/posição LOCAIS
//     (relativas ao pai). Girar em torno de um eixo de mundo `a` compõe, à
//     esquerda da rotação manual atual, a rotação em torno de `conj(P)·a`, com
//     P = rotação de mundo do pai (ou o yaw do host, para ossos raiz): assim a
//     rotação de mundo do osso passa a ser R(a)·P·L.
//   - mover desloca a posição local por `conj(P)·d / escala de mundo do pai`,
//     o inverso de `worldT = pai + P·(poseT ⊙ escala do pai)` do compose.
//   - graus: q = yaw(Y) · pitch(X local, pitch > 0 levanta Z) · roll(Z local).
//
// Sem alocação por frame: buffers de módulo, criados uma vez (o arrasto do
// gizmo chama estas funções todo frame). MEDIDO (RTS_GC_DEBUG, fix round 1):
// neste runtime uma função com 5+ parâmetros escalares e muitos locais `f64`
// aloca a CADA chamada (família do rts#2760) — a 1ª versão
// `rotateBoneWorldAxis(sk, bone, ax, ay, az, angle)` fazia 7 coletas em 200k
// chamadas. Por isso: no máximo 4 parâmetros (eixo por índice, deslocamento
// num Float64Array) e um único `return` no fim.
import { Skeleton } from "@engine/core/skeleton";
import type { GameObject } from "@engine/core/gameobject";
import { quatMulInto, quatFromYawPitchInto } from "@engine/render/quat";
import { animationPlayerOf, previewIsTouched, previewStop, skeletonOfObject } from "./skeleton_preview";
import { scene, S } from "./control/session";
import { history } from "./undo";
import { snapv, SNAP_MOVE_STEP, SNAP_ROTATE_STEP } from "./gizmo";

export const DEG2RAD: f64 = Math.PI / 180.0;
const RAD2DEG: f64 = 180.0 / Math.PI;
/// |cos(pitch)| abaixo disto = trava de cardan: o roll passa a ser 0 e o yaw
/// absorve a rotação em torno do eixo vertical.
const GIMBAL_EPS: f64 = 1e-9;
/// Escala de mundo abaixo disto não divide o deslocamento (osso achatado).
const MIN_SCALE: f64 = 1e-9;

const PARENT_R: Float64Array = new Float64Array(4);
const PARENT_S: Float64Array = new Float64Array(3);
const DELTA_Q: Float64Array = new Float64Array(4);
const LOCAL_Q: Float64Array = new Float64Array(4);
const ROLL_Q: Float64Array = new Float64Array(4);

/// Skeleton do objeto quando `bone` é um osso editável dele (modelo carregado,
/// índice válido); null caso contrário — o gizmo volta ao objeto.
export function boneEditTarget(o: GameObject | null, bone: number): Skeleton | null {
  let target: Skeleton | null = null;
  if (o !== null && bone >= 0) {
    const sk = skeletonOfObject(o);
    if (sk !== null && sk.asset !== null && bone < sk.boneCount()) target = sk;
  }
  return target;
}

/// Escolhe o osso do gizmo/Inspector no objeto `o` (-1 = nenhum). O dono fica
/// guardado: trocar de objeto invalida o osso (ver `selectedBoneTarget`).
export function selectBone(o: GameObject | null, bone: number): void {
  S.selectedBone = o !== null && bone >= 0 ? bone : 0 - 1;
  S.selectedBoneOwner = S.selectedBone >= 0 ? o : null;
}

/// Skeleton do osso escolhido, se o objeto selecionado AGORA é o dono dele;
/// senão zera a escolha (a seleção mudou por outro caminho) e devolve null.
export function selectedBoneTarget(): Skeleton | null {
  let target: Skeleton | null = null;
  if (S.selectedBone >= 0) {
    const o = S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null;
    if (o !== null && o === S.selectedBoneOwner) target = boneEditTarget(o, S.selectedBone);
    if (target === null) { S.selectedBone = 0 - 1; S.selectedBoneOwner = null; }
  }
  return target;
}

/// Antes de editar um osso: encerra a prévia de animação daquele objeto, para a
/// edição aparecer sobre a pose manual (e não ser sobrescrita pelo clipe).
export function beginBoneEdit(sk: Skeleton): void {
  const player = animationPlayerOf(sk);
  if (player !== null && previewIsTouched(player)) previewStop(player);
}

/// Posição de MUNDO do osso (origem do gizmo) em `out` [x, y, z]. 1 = ok.
export function boneWorldOriginInto(out: Float64Array, sk: Skeleton, bone: number): number {
  let ok = 0;
  if (sk.asset !== null && bone >= 0 && bone < sk.boneCount()) {
    sk.compose();
    out[0] = sk.worldT[bone * 3]; out[1] = sk.worldT[bone * 3 + 1]; out[2] = sk.worldT[bone * 3 + 2];
    ok = 1;
  }
  return ok;
}

// Rotação e escala de MUNDO do pai do osso em PARENT_R/PARENT_S (o compose já
// rodou). Osso raiz: yaw e escala do host, como no `composeAt`.
function parentFrame(sk: Skeleton, bone: number): void {
  const a = sk.asset;
  if (a !== null) {
    const p = a.boneParent[bone];
    if (p >= 0) {
      PARENT_R[0] = sk.worldR[p * 4]; PARENT_R[1] = sk.worldR[p * 4 + 1];
      PARENT_R[2] = sk.worldR[p * 4 + 2]; PARENT_R[3] = sk.worldR[p * 4 + 3];
      PARENT_S[0] = sk.worldS[p * 3]; PARENT_S[1] = sk.worldS[p * 3 + 1]; PARENT_S[2] = sk.worldS[p * 3 + 2];
    } else {
      quatFromYawPitchInto(PARENT_R, sk.host.wry, 0.0);
      PARENT_S[0] = sk.host.sx; PARENT_S[1] = sk.host.sy; PARENT_S[2] = sk.host.sz;
    }
  }
}

/// Gira o osso `angle` radianos em torno do eixo de MUNDO `axis` (0 = X,
/// 1 = Y, 2 = Z), compondo sobre a rotação manual atual.
export function rotateBoneWorldAxis(sk: Skeleton, bone: number, axis: number, angle: f64): void {
  if (sk.asset !== null && bone >= 0 && bone < sk.boneCount() && axis >= 0 && axis <= 2) {
    sk.compose();
    parentFrame(sk, bone);
    // eixo no espaço do pai: conj(P)·a, `a` unitário de mundo (rotação pelo
    // conjugado aberta; o resultado já sai unitário)
    const ax: f64 = axis === 0 ? 1.0 : 0.0; const ay: f64 = axis === 1 ? 1.0 : 0.0; const az: f64 = axis === 2 ? 1.0 : 0.0;
    const qx = 0.0 - PARENT_R[0]; const qy = 0.0 - PARENT_R[1]; const qz = 0.0 - PARENT_R[2]; const qw = PARENT_R[3];
    const tx = 2.0 * (qy * az - qz * ay); const ty = 2.0 * (qz * ax - qx * az); const tz = 2.0 * (qx * ay - qy * ax);
    const s = Math.sin(angle * 0.5);
    DELTA_Q[0] = (ax + qw * tx + (qy * tz - qz * ty)) * s;
    DELTA_Q[1] = (ay + qw * ty + (qz * tx - qx * tz)) * s;
    DELTA_Q[2] = (az + qw * tz + (qx * ty - qy * tx)) * s;
    DELTA_Q[3] = Math.cos(angle * 0.5);
    LOCAL_Q[0] = sk.manualR[bone * 4]; LOCAL_Q[1] = sk.manualR[bone * 4 + 1];
    LOCAL_Q[2] = sk.manualR[bone * 4 + 2]; LOCAL_Q[3] = sk.manualR[bone * 4 + 3];
    quatMulInto(LOCAL_Q, DELTA_Q, LOCAL_Q);
    // renormaliza: muitos frames de arrasto acumulam erro de arredondamento
    const n = Math.sqrt(LOCAL_Q[0] * LOCAL_Q[0] + LOCAL_Q[1] * LOCAL_Q[1] + LOCAL_Q[2] * LOCAL_Q[2] + LOCAL_Q[3] * LOCAL_Q[3]);
    if (n > MIN_SCALE) { LOCAL_Q[0] = LOCAL_Q[0] / n; LOCAL_Q[1] = LOCAL_Q[1] / n; LOCAL_Q[2] = LOCAL_Q[2] / n; LOCAL_Q[3] = LOCAL_Q[3] / n; }
    sk.setBoneRotation(bone, LOCAL_Q);
  }
}

/// Desloca o osso `delta` [dx, dy, dz] em unidades de MUNDO.
export function moveBoneWorld(sk: Skeleton, bone: number, delta: Float64Array): void {
  if (sk.asset !== null && bone >= 0 && bone < sk.boneCount()) {
    sk.compose();
    parentFrame(sk, bone);
    const dx = delta[0]; const dy = delta[1]; const dz = delta[2];
    const qx = 0.0 - PARENT_R[0]; const qy = 0.0 - PARENT_R[1]; const qz = 0.0 - PARENT_R[2]; const qw = PARENT_R[3];
    const tx = 2.0 * (qy * dz - qz * dy); const ty = 2.0 * (qz * dx - qx * dz); const tz = 2.0 * (qx * dy - qy * dx);
    const lx = dx + qw * tx + (qy * tz - qz * ty);
    const ly = dy + qw * ty + (qz * tx - qx * tz);
    const lz = dz + qw * tz + (qx * ty - qy * tx);
    const sx = Math.abs(PARENT_S[0]) > MIN_SCALE ? PARENT_S[0] : 1.0;
    const sy = Math.abs(PARENT_S[1]) > MIN_SCALE ? PARENT_S[1] : 1.0;
    const sz = Math.abs(PARENT_S[2]) > MIN_SCALE ? PARENT_S[2] : 1.0;
    sk.setBonePosition(bone, sk.manualT[bone * 3] + lx / sx, sk.manualT[bone * 3 + 1] + ly / sy, sk.manualT[bone * 3 + 2] + lz / sz);
  }
}

/// Um ARRASTO do gizmo sobre um osso: `begin` tira UM snapshot de Desfazer e
/// encerra a prévia; `rotate`/`move` aplicam o delta de cada frame sem
/// snapshot. Com o snap ligado (S.snap), acumula o arrasto e só aplica passos
/// inteiros (SNAP_ROTATE_STEP / SNAP_MOVE_STEP, os mesmos do objeto): o giro/
/// deslocamento TOTAL do arrasto fica múltiplo do passo (não a pose absoluta).
export class BoneDrag {
  skeleton: Skeleton | null;
  bone: number;
  accum: Float64Array;     // arrasto acumulado desde o begin (por eixo)
  applied: Float64Array;   // quanto já foi aplicado (por eixo)
  step: Float64Array;      // delta deste frame, passado a moveBoneWorld
  constructor() {
    this.skeleton = null;
    this.bone = 0 - 1;
    this.accum = new Float64Array(3);
    this.applied = new Float64Array(3);
    this.step = new Float64Array(3);
  }
  begin(sk: Skeleton, bone: number): void {
    history.snapshot();
    beginBoneEdit(sk);
    this.skeleton = sk; this.bone = bone;
    let i = 0;
    while (i < 3) { this.accum[i] = 0.0; this.applied[i] = 0.0; i = i + 1; }
  }
  end(): void { this.skeleton = null; this.bone = 0 - 1; }
  active(): boolean { return this.skeleton !== null; }
  /// Gira `angle` radianos no eixo de mundo `axis` (0/1/2).
  rotate(axis: number, angle: f64): void {
    const sk = this.skeleton;
    if (sk !== null && axis >= 0 && axis <= 2) {
      let d = angle;
      if (S.snap !== 0) {
        this.accum[axis] = this.accum[axis] + angle;
        const target = snapv(this.accum[axis], SNAP_ROTATE_STEP);
        d = target - this.applied[axis];
        this.applied[axis] = target;
      }
      if (d !== 0.0) rotateBoneWorldAxis(sk, this.bone, axis, d);
    }
  }
  /// Desloca (dx, dy, dz) em mundo.
  move(dx: f64, dy: f64, dz: f64): void {
    const sk = this.skeleton;
    if (sk !== null) {
      this.step[0] = dx; this.step[1] = dy; this.step[2] = dz;
      if (S.snap !== 0) {
        let i = 0;
        while (i < 3) {
          this.accum[i] = this.accum[i] + this.step[i];
          const target = snapv(this.accum[i], SNAP_MOVE_STEP);
          this.step[i] = target - this.applied[i];
          this.applied[i] = target;
          i = i + 1;
        }
      }
      if (this.step[0] !== 0.0 || this.step[1] !== 0.0 || this.step[2] !== 0.0) moveBoneWorld(sk, this.bone, this.step);
    }
  }
}
/// O arrasto do gizmo do editor (um só por vez).
export const boneDrag = new BoneDrag();

/// Quaternion local a partir de graus: q = yaw(Y) · pitch(X local) · roll(Z local).
export function boneRotationFromDegreesInto(out: Float64Array, yawDeg: f64, pitchDeg: f64, rollDeg: f64): void {
  quatFromYawPitchInto(LOCAL_Q, yawDeg * DEG2RAD, pitchDeg * DEG2RAD);
  const hr = rollDeg * DEG2RAD * 0.5;
  ROLL_Q[0] = 0.0; ROLL_Q[1] = 0.0; ROLL_Q[2] = Math.sin(hr); ROLL_Q[3] = Math.cos(hr);
  quatMulInto(out, LOCAL_Q, ROLL_Q);
}

/// Inverso de `boneRotationFromDegreesInto`: [yaw, pitch, roll] em graus do
/// quaternion em `q[o..o+3]`.
export function boneDegreesInto(out: Float64Array, q: Float64Array, o: number): void {
  let x = q[o]; let y = q[o + 1]; let z = q[o + 2]; let w = q[o + 3];
  const n = Math.sqrt(x * x + y * y + z * z + w * w);
  if (n > MIN_SCALE) { x = x / n; y = y / n; z = z / n; w = w / n; }
  // R = Ry(yaw) · Rx(b) · Rz(roll), com b = -pitch
  const r12 = 2.0 * (y * z - w * x);
  const sb = Math.max(0.0 - 1.0, Math.min(1.0, 0.0 - r12));
  const b = Math.asin(sb);
  let yaw: f64; let roll: f64;
  if (Math.cos(b) > GIMBAL_EPS) {
    yaw = Math.atan2(2.0 * (x * z + w * y), 1.0 - 2.0 * (x * x + y * y));
    roll = Math.atan2(2.0 * (x * y + w * z), 1.0 - 2.0 * (x * x + z * z));
  } else {
    yaw = Math.atan2(0.0 - 2.0 * (x * z - w * y), 1.0 - 2.0 * (y * y + z * z));
    roll = 0.0;
  }
  out[0] = yaw * RAD2DEG; out[1] = (0.0 - b) * RAD2DEG; out[2] = roll * RAD2DEG;
}
