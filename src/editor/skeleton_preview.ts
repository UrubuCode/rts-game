// Prévia de animação do Inspector, FORA do Play.
//
// O AnimationPlayer só escreve a pose de TRABALHO do Skeleton; a cena salva usa
// a pose MANUAL. Então tocar/pausar/arrastar o tempo aqui não muda o que se
// salva — e também não cria undo: é estado do editor, guardado em
// `S.previewPlayers`. O campo serializado `playing` (tocar ao iniciar o jogo)
// nunca fica ligado pela prévia: o tick liga-o só durante o `update` e devolve
// o valor original em seguida.
//
// Funções livres, não métodos de um singleton: no RTS atual, um MÉTODO de
// classe que lê um nome de nível de módulo (import como `S`, ou uma função
// exportada daqui) falha com "S is not defined" quando é chamado a partir de
// um módulo que não importa esse nome. Função livre resolve certo.
import { S } from "./control/session";
import { AnimationPlayer } from "@engine/core/animation_player";
import { Skeleton } from "@engine/core/skeleton";

/// Skeleton do mesmo objeto do player (null se não houver).
export function skeletonOf(player: AnimationPlayer): Skeleton | null {
  const owner = player.owner;
  if (owner === null) return null;
  let index = 0;
  while (index < owner.behaviors.length) {
    const behavior = owner.behaviors[index];
    if (behavior instanceof Skeleton) return behavior;
    index = index + 1;
  }
  return null;
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

export function previewIsPlaying(player: AnimationPlayer): boolean { return S.previewPlayers.indexOf(player) >= 0; }

export function previewStart(player: AnimationPlayer): void {
  if (previewIsPlaying(player)) return;
  // clipe sem laço já no fim: tocar de novo recomeça do início
  const dur = player.duration();
  if (!player.loop && dur > 0.0 && player.time >= dur) player.time = 0.0;
  S.previewPlayers.push(player);
}

/// Congela a pose no tempo atual (o autor ainda pode arrastar o tempo).
export function previewPause(player: AnimationPlayer): void {
  const index = S.previewPlayers.indexOf(player);
  if (index >= 0) S.previewPlayers.splice(index, 1);
}

/// Encerra a prévia: tempo 0 e pose de trabalho = pose manual (o que se salva).
export function previewStop(player: AnimationPlayer): void {
  previewPause(player);
  player.time = 0.0;
  const skeleton = skeletonOf(player);
  if (skeleton !== null) skeleton.applyManualPose();
}

export function previewStopAll(): void {
  while (S.previewPlayers.length > 0) previewStop(S.previewPlayers[S.previewPlayers.length - 1]);
}

export function previewCount(): number { return S.previewPlayers.length; }

/// Avança as prévias que estão tocando. Um clipe sem laço que chega ao fim
/// sai da lista e fica parado no último quadro.
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
