// Comandos de CONTROLE de ossos/animação (via WebSocket) — a LLM adiciona um
// Skeleton, lista/posiciona ossos e toca clipes, igual ao que um humano faria
// no Inspector, mas em texto. Segue o mesmo padrão de commands/component.ts
// (objeto por índice, validação, mensagens `[ok]`/`[erro]`).
import { scene } from "../session";
import type { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { AnimationPlayer } from "@engine/core/animation_player";
import { quatMulInto } from "@engine/render/quat";

const DEG2RAD: f64 = Math.PI / 180.0;

// quaternion local pro comando `pose ... rot` (nunca alocado por frame: só é
// chamado por um comando de WS, não pelo laço de render).
const POSE_Q_YP: Float64Array = new Float64Array(4);
const POSE_Q_ROLL: Float64Array = new Float64Array(4);
const POSE_Q_OUT: Float64Array = new Float64Array(4);

function objOrError(oi: number): GameObject | null {
  if (oi < 0 || oi >= scene.objects.length) return null;
  return scene.objects[oi];
}

function findSkeleton(o: GameObject): Skeleton | null {
  let i = 0;
  while (i < o.behaviors.length) {
    const b = o.behaviors[i];
    if (b instanceof Skeleton) return b;
    i = i + 1;
  }
  return null;
}

function findAnimPlayer(o: GameObject): AnimationPlayer | null {
  let i = 0;
  while (i < o.behaviors.length) {
    const b = o.behaviors[i];
    if (b instanceof AnimationPlayer) return b;
    i = i + 1;
  }
  return null;
}

// Osso pedido pelo nome (prioridade) ou pelo índice; -1 = não achou nenhum
// dos dois. Ossos numéricos de propósito não existem nestes modelos, então
// tentar o nome primeiro é seguro.
function resolveBoneArg(sk: Skeleton, arg: string): number {
  const byName = sk.boneIndex(arg);
  if (byName >= 0) return byName;
  const idx = parseFloat(arg);
  if (idx === idx) return idx | 0;   // numérico (NaN !== NaN)
  return 0 - 1;
}

/// addskel <obj> <caminho.glb> — adiciona Skeleton + AnimationPlayer (ou troca
/// o modelo do Skeleton já existente). Carrega o modelo com win=0 pra validar
/// antes de devolver `[ok]`; se falhar, o objeto não fica com componente
/// quebrado (desfaz a troca / remove o que acabou de criar).
export function cmdAddSkel(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const o = objOrError(oi);
  if (o === null) return "[erro] objeto invalido";
  const path = parts[2];
  if (path === undefined || path === "") return "[erro] caminho do modelo obrigatorio";
  const existing = findSkeleton(o);
  const ap = findAnimPlayer(o);
  const isNewSkel = existing === null;
  let sk: Skeleton;
  let prevPath: string;
  if (existing === null) { sk = new Skeleton(); prevPath = ""; o.addBehavior(sk); sk.mount(); }
  else { sk = existing; prevPath = existing.modelPath; }
  sk.modelPath = path;
  sk.onValidate("modelPath");   // descarta o asset antigo, pose pendente inclusa
  sk.ensureAsset(0);
  if (sk.asset === null) {
    if (isNewSkel) {
      const idx = o.behaviors.indexOf(sk);
      if (idx >= 0) o.removeBehavior(idx);
    } else {
      sk.modelPath = prevPath;
      sk.onValidate("modelPath");
      sk.ensureAsset(0);
    }
    return "[erro] nao foi possivel carregar o modelo: " + path;
  }
  if (ap === null) {
    const player = new AnimationPlayer();
    o.addBehavior(player);
    player.mount();
  }
  scene.markCollidersDirty();
  return "[ok] addskel " + path + " -> #" + oi;
}

/// bones <obj> — lista os ossos do Skeleton, com pai.
export function cmdBones(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const o = objOrError(oi);
  if (o === null) return "[erro] objeto invalido";
  const sk = findSkeleton(o);
  if (sk === null) return "[erro] objeto sem Skeleton";
  sk.ensureAsset(0);
  if (sk.asset === null) return "[erro] modelo do Skeleton nao carregado";
  const a = sk.asset;
  const n = a.boneNames.length;
  let m = "[ossos] #" + oi + " " + n;
  let i = 0;
  while (i < n) {
    m = m + " | " + i + " " + a.boneNames[i] + " (pai " + a.boneParent[i] + ")";
    i = i + 1;
  }
  return m;
}

/// pose <obj> <osso|nome> rot <yawGraus> <pitchGraus> <rollGraus>
/// pose <obj> <osso|nome> pos <x> <y> <z>
/// Ordem de composição de `rot`: q = yaw(Y) * pitch(X local) * roll(Z local).
export function cmdPose(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const o = objOrError(oi);
  if (o === null) return "[erro] objeto invalido";
  const sk = findSkeleton(o);
  if (sk === null) return "[erro] objeto sem Skeleton";
  sk.ensureAsset(0);
  if (sk.asset === null) return "[erro] modelo do Skeleton nao carregado";
  const bone = resolveBoneArg(sk, parts[2]);
  if (bone < 0 || bone >= sk.boneCount()) return "[erro] osso invalido: " + parts[2];
  const mode = parts[3];
  if (mode === "rot") {
    const yaw = parseFloat(parts[4]); const pitch = parseFloat(parts[5]); const roll = parseFloat(parts[6]);
    if (yaw !== yaw || pitch !== pitch || roll !== roll) return "[erro] rot precisa de yaw, pitch e roll numericos";
    const yawR = yaw * DEG2RAD; const pitchR = pitch * DEG2RAD; const rollR = roll * DEG2RAD;
    const hy = yawR * 0.5; const hp = (0.0 - pitchR) * 0.5;
    const cy = Math.cos(hy); const sy = Math.sin(hy); const cp = Math.cos(hp); const sp = Math.sin(hp);
    POSE_Q_YP[0] = cy * sp; POSE_Q_YP[1] = sy * cp; POSE_Q_YP[2] = 0.0 - sy * sp; POSE_Q_YP[3] = cy * cp;
    const hr = rollR * 0.5;
    POSE_Q_ROLL[0] = 0.0; POSE_Q_ROLL[1] = 0.0; POSE_Q_ROLL[2] = Math.sin(hr); POSE_Q_ROLL[3] = Math.cos(hr);
    quatMulInto(POSE_Q_OUT, POSE_Q_YP, POSE_Q_ROLL);
    sk.setBoneRotation(bone, POSE_Q_OUT);
    return "[ok] pose #" + oi + " osso " + bone + " rot " + yaw + " " + pitch + " " + roll;
  }
  if (mode === "pos") {
    const x = parseFloat(parts[4]); const y = parseFloat(parts[5]); const z = parseFloat(parts[6]);
    if (x !== x || y !== y || z !== z) return "[erro] pos precisa de x, y e z numericos";
    sk.setBonePosition(bone, x, y, z);
    return "[ok] pose #" + oi + " osso " + bone + " pos " + x + " " + y + " " + z;
  }
  return "[erro] modo invalido (use rot ou pos): " + mode;
}

/// resetpose <obj> — volta o Skeleton ao repouso e esquece a pose manual.
export function cmdResetPose(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const o = objOrError(oi);
  if (o === null) return "[erro] objeto invalido";
  const sk = findSkeleton(o);
  if (sk === null) return "[erro] objeto sem Skeleton";
  sk.resetPose();
  return "[ok] resetpose #" + oi;
}

/// anims <obj> — lista os clipes do modelo (nome + duração).
export function cmdAnims(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const o = objOrError(oi);
  if (o === null) return "[erro] objeto invalido";
  const sk = findSkeleton(o);
  if (sk === null) return "[erro] objeto sem Skeleton";
  sk.ensureAsset(0);
  if (sk.asset === null) return "[erro] modelo do Skeleton nao carregado";
  const clips = sk.asset.clips;
  let m = "[anims] #" + oi + " " + clips.length;
  let i = 0;
  while (i < clips.length) {
    m = m + " | " + clips[i].name + " " + clips[i].duration.toFixed(2) + "s";
    i = i + 1;
  }
  return m;
}

/// anim <obj> play <nome> [loop|once] | pause | resume | seek <s> |
/// fade <nome> <s> | speed <x> | state
export function cmdAnim(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const o = objOrError(oi);
  if (o === null) return "[erro] objeto invalido";
  const ap = findAnimPlayer(o);
  if (ap === null) return "[erro] objeto sem AnimationPlayer";
  const sub = parts[2];
  if (sub === "play") {
    const nome = parts[3];
    if (nome === undefined || nome === "") return "[erro] play precisa do nome do clipe";
    const loopArg = parts[4] === "loop" ? true : (parts[4] === "once" ? false : undefined);
    if (!ap.play(nome, loopArg)) return "[erro] clipe inexistente: " + nome;
    return "[ok] anim play " + nome + " -> #" + oi;
  }
  if (sub === "pause") { ap.pause(); return "[ok] anim pause #" + oi; }
  if (sub === "resume") { ap.resume(); return "[ok] anim resume #" + oi; }
  if (sub === "seek") {
    const t = parseFloat(parts[3]);
    if (t !== t) return "[erro] seek precisa de um tempo numerico";
    ap.seek(t);
    return "[ok] anim seek " + t.toFixed(2) + " #" + oi;
  }
  if (sub === "fade") {
    const nome = parts[3]; const secs = parseFloat(parts[4]);
    if (nome === undefined || nome === "") return "[erro] fade precisa do nome do clipe";
    if (secs !== secs) return "[erro] fade precisa da duracao em segundos";
    if (!ap.crossFade(nome, secs)) return "[erro] clipe inexistente: " + nome;
    return "[ok] anim fade " + nome + " " + secs.toFixed(2) + " -> #" + oi;
  }
  if (sub === "speed") {
    const x = parseFloat(parts[3]);
    if (x !== x) return "[erro] speed precisa de um numero";
    ap.speed = x;
    return "[ok] anim speed " + x.toFixed(2) + " #" + oi;
  }
  if (sub === "state") {
    const estado = ap.playing ? "tocando" : "pausado";
    return "[anim] #" + oi + " clip=" + ap.clip + " time=" + ap.time.toFixed(2) +
      " " + estado + " loop=" + ap.loop + " speed=" + ap.speed.toFixed(2);
  }
  return "[erro] subcomando invalido: " + sub;
}
