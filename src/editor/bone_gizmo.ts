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
// gizmo chama estas funções todo frame).
import { Skeleton } from "@engine/core/skeleton";
import type { GameObject } from "@engine/core/gameobject";
import { quatMulInto, quatFromYawPitchInto } from "@engine/render/quat";
import { animationPlayerOf, previewIsTouched, previewStop } from "./skeleton_preview";

const DEG2RAD: f64 = Math.PI / 180.0;
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

/// Skeleton do objeto (null se não houver).
export function skeletonOfObject(o: GameObject): Skeleton | null {
  let i = 0;
  while (i < o.behaviors.length) {
    const b = o.behaviors[i];
    if (b instanceof Skeleton) return b;
    i = i + 1;
  }
  return null;
}

/// Skeleton do objeto quando `bone` é um osso editável dele (modelo carregado,
/// índice válido); null caso contrário — o gizmo volta ao objeto.
export function boneEditTarget(o: GameObject | null, bone: number): Skeleton | null {
  if (o === null || bone < 0) return null;
  const sk = skeletonOfObject(o);
  if (sk === null || sk.asset === null || bone >= sk.boneCount()) return null;
  return sk;
}

/// Antes de editar um osso: encerra a prévia de animação daquele objeto, para a
/// edição aparecer sobre a pose manual (e não ser sobrescrita pelo clipe).
export function beginBoneEdit(sk: Skeleton): void {
  const player = animationPlayerOf(sk);
  if (player !== null && previewIsTouched(player)) previewStop(player);
}

/// Posição de MUNDO do osso (origem do gizmo) em `out` [x, y, z]. 1 = ok.
export function boneWorldOriginInto(out: Float64Array, sk: Skeleton, bone: number): number {
  if (sk.asset === null || bone < 0 || bone >= sk.boneCount()) return 0;
  sk.compose();
  out[0] = sk.worldT[bone * 3]; out[1] = sk.worldT[bone * 3 + 1]; out[2] = sk.worldT[bone * 3 + 2];
  return 1;
}

// Rotação e escala de MUNDO do pai do osso em PARENT_R/PARENT_S (o compose já
// rodou). Osso raiz: yaw e escala do host, como no `composeAt`.
function parentFrame(sk: Skeleton, bone: number): void {
  const a = sk.asset;
  if (a === null) return;
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

/// Gira o osso `angle` radianos em torno do eixo de MUNDO (ax, ay, az),
/// compondo sobre a rotação manual atual.
export function rotateBoneWorldAxis(sk: Skeleton, bone: number, ax: f64, ay: f64, az: f64, angle: f64): void {
  if (sk.asset === null || bone < 0 || bone >= sk.boneCount()) return;
  sk.compose();
  parentFrame(sk, bone);
  // eixo no espaço do pai: conj(P)·a (rotação pelo conjugado, aberta)
  const qx = 0.0 - PARENT_R[0]; const qy = 0.0 - PARENT_R[1]; const qz = 0.0 - PARENT_R[2]; const qw = PARENT_R[3];
  const tx = 2.0 * (qy * az - qz * ay); const ty = 2.0 * (qz * ax - qx * az); const tz = 2.0 * (qx * ay - qy * ax);
  let px = ax + qw * tx + (qy * tz - qz * ty);
  let py = ay + qw * ty + (qz * tx - qx * tz);
  let pz = az + qw * tz + (qx * ty - qy * tx);
  const len = Math.sqrt(px * px + py * py + pz * pz);
  if (len < MIN_SCALE) return;
  px = px / len; py = py / len; pz = pz / len;
  const s = Math.sin(angle * 0.5);
  DELTA_Q[0] = px * s; DELTA_Q[1] = py * s; DELTA_Q[2] = pz * s; DELTA_Q[3] = Math.cos(angle * 0.5);
  LOCAL_Q[0] = sk.manualR[bone * 4]; LOCAL_Q[1] = sk.manualR[bone * 4 + 1];
  LOCAL_Q[2] = sk.manualR[bone * 4 + 2]; LOCAL_Q[3] = sk.manualR[bone * 4 + 3];
  quatMulInto(LOCAL_Q, DELTA_Q, LOCAL_Q);
  // renormaliza: muitos frames de arrasto acumulam erro de arredondamento
  const n = Math.sqrt(LOCAL_Q[0] * LOCAL_Q[0] + LOCAL_Q[1] * LOCAL_Q[1] + LOCAL_Q[2] * LOCAL_Q[2] + LOCAL_Q[3] * LOCAL_Q[3]);
  if (n > MIN_SCALE) { LOCAL_Q[0] = LOCAL_Q[0] / n; LOCAL_Q[1] = LOCAL_Q[1] / n; LOCAL_Q[2] = LOCAL_Q[2] / n; LOCAL_Q[3] = LOCAL_Q[3] / n; }
  sk.setBoneRotation(bone, LOCAL_Q);
}

/// Desloca o osso (dx, dy, dz) em unidades de MUNDO.
export function moveBoneWorld(sk: Skeleton, bone: number, dx: f64, dy: f64, dz: f64): void {
  if (sk.asset === null || bone < 0 || bone >= sk.boneCount()) return;
  sk.compose();
  parentFrame(sk, bone);
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
