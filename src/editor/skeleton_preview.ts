// Prévia de animação do Inspector, FORA do Play.
//
// O AnimationPlayer só escreve a pose de TRABALHO do Skeleton; a cena salva usa
// a pose MANUAL. Então tocar/pausar/arrastar o tempo aqui não muda o que se
// salva — e também não cria undo: é estado do editor, guardado em
// `S.previewTouched` (todo player cuja pose de trabalho a prévia mexeu: tocar,
// pausar, arrastar o tempo, escolher o clipe fora do Play, clipe sem laço que
// terminou) e `S.previewPlayers` (os que estão TOCANDO, subconjunto do
// anterior). Encerrar a prévia (trocar de objeto, entrar no Play) devolve a pose
// manual a TODOS os tocados, não só aos que estão tocando. O campo serializado
// `playing` (tocar ao iniciar o jogo) nunca fica ligado pela prévia: o tick
// liga-o só durante o `update` e devolve o valor original em seguida.
//
// Funções livres, não métodos de um singleton: no RTS atual, o método de uma
// classe cujo construtor não atribui nenhum campo (sem construtor, vazio ou só
// com inicializadores `x = ...`), chamado numa instância criada no topo do
// próprio módulo (`export const p = new C()`), não enxerga os nomes de nível
// de módulo desse módulo (imports, funções locais/exportadas) e falha com
// "ReferenceError: <nome> is not defined" quando o módulo que chama não importa
// o nome. Com um construtor que atribui campo, ou instância criada em outro
// módulo (Inspector, History, Session), funciona. Repro mínima:
// scratch/claude-repro-metodo-import/ (issue do RTS: a definir).
import { S } from "./control/session";
import { AnimationPlayer } from "@engine/core/animation_player";
import { Skeleton } from "@engine/core/skeleton";
import type { GameObject } from "@engine/core/gameobject";

/// Skeleton de um objeto (null se não houver) — o único lugar que procura.
export function skeletonOfObject(owner: GameObject): Skeleton | null {
  let found: Skeleton | null = null;
  let index = 0;
  while (index < owner.behaviors.length && found === null) {
    const behavior = owner.behaviors[index];
    if (behavior instanceof Skeleton) found = behavior;
    index = index + 1;
  }
  return found;
}

/// Skeleton do mesmo objeto do player (null se não houver).
export function skeletonOf(player: AnimationPlayer): Skeleton | null {
  const owner = player.owner;
  return owner === null ? null : skeletonOfObject(owner);
}

/// AnimationPlayer do objeto do Skeleton (null se não houver).
export function animationPlayerOf(skeleton: Skeleton): AnimationPlayer | null {
  const owner = skeleton.owner;
  if (owner === null) return null;
  let index = 0;
  while (index < owner.behaviors.length) {
    const behavior = owner.behaviors[index];
    if (behavior instanceof AnimationPlayer) return behavior;
    index = index + 1;
  }
  return null;
}

/// Folga antes do fim ao arrastar o tempo de um clipe COM laço até 100 %: seek
/// em `duração` exata dá a volta para 0 e o quadro saltaria para o início.
const LOOP_END_EPSILON: f64 = 1e-4;

function touch(player: AnimationPlayer): void {
  if (S.previewTouched.indexOf(player) < 0) S.previewTouched.push(player);
}

export function previewIsPlaying(player: AnimationPlayer): boolean { return S.previewPlayers.indexOf(player) >= 0; }
/// 1 = a prévia mexeu na pose de trabalho deste player (tocando ou não).
export function previewIsTouched(player: AnimationPlayer): boolean { return S.previewTouched.indexOf(player) >= 0; }
/// Quantos players a prévia mexeu (tocando ou parados numa pose de clipe).
export function previewCount(): number { return S.previewTouched.length; }

export function previewStart(player: AnimationPlayer): void {
  touch(player);
  if (previewIsPlaying(player)) return;
  // clipe sem laço já no fim: tocar de novo recomeça do início
  const dur = player.duration();
  if (!player.loop && dur > 0.0 && player.time >= dur) player.time = 0.0;
  S.previewPlayers.push(player);
}

/// Congela a pose no tempo atual (o autor ainda pode arrastar o tempo); o
/// player continua "tocado" até a prévia ser encerrada.
export function previewPause(player: AnimationPlayer): void {
  const index = S.previewPlayers.indexOf(player);
  if (index >= 0) S.previewPlayers.splice(index, 1);
}

/// Arrasta o tempo (pose do clipe naquele instante, só na pose de trabalho).
export function previewSeek(player: AnimationPlayer, t: f64): void {
  touch(player);
  player.seek(t);
}

/// Escolhe o clipe fora do Play (o campo `clip` é salvo: o undo fica com quem
/// chama). Mostra o quadro 0 do clipe na pose de trabalho.
export function previewChooseClip(player: AnimationPlayer, name: string): void {
  touch(player);
  player.clip = name; player.time = 0.0; player.onValidate("clip");
}

/// Tempo alvo da barra de tempo na fração `fraction` (0..1) da `duration`: com
/// laço, nunca exatamente a duração (que daria a volta para 0).
export function timelineTarget(player: AnimationPlayer, fraction: f64, duration: f64): f64 {
  const target = fraction * duration;
  if (player.loop && target > duration - LOOP_END_EPSILON) return Math.max(0.0, duration - LOOP_END_EPSILON);
  return target;
}

/// Encerra a prévia: tempo 0 e pose de trabalho = pose manual (o que se salva).
export function previewStop(player: AnimationPlayer): void {
  previewPause(player);
  const index = S.previewTouched.indexOf(player);
  if (index >= 0) S.previewTouched.splice(index, 1);
  player.time = 0.0;
  const skeleton = skeletonOf(player);
  if (skeleton !== null) skeleton.applyManualPose();
}

/// Encerra a prévia de TODOS os players tocados (tocando, pausados, com o
/// tempo arrastado, com clipe escolhido ou já terminados).
export function previewStopAll(): void {
  while (S.previewPlayers.length > 0) previewStop(S.previewPlayers[S.previewPlayers.length - 1]);
  while (S.previewTouched.length > 0) previewStop(S.previewTouched[S.previewTouched.length - 1]);
}

/// Avança as prévias que estão tocando. Um clipe sem laço que chega ao fim
/// para no último quadro (continua tocado, fora da lista de tocando).
export function previewTick(dt: f64): void {
  let index = S.previewPlayers.length - 1;
  while (index >= 0) {
    const player = S.previewPlayers[index];
    if (player.owner === null) { S.previewPlayers.splice(index, 1); index = index - 1; continue; }
    const saved = player.playing;
    player.playing = true;
    player.update(dt);
    const ended = !player.playing;
    player.playing = saved;
    if (ended) S.previewPlayers.splice(index, 1);
    index = index - 1;
  }
}

/// Uma vez por frame, pelo main: fora do Play avança as prévias; no Play
/// (onde o `scene.update` roda o AnimationPlayer das cópias) encerra a prévia
/// dos originais, devolvendo a pose manual.
export function previewFrame(dt: f64): void {
  if (S.simulating === 0) previewTick(dt);
  else if (S.previewTouched.length > 0) previewStopAll();
}
