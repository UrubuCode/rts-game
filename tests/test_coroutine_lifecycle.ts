// Regressões nas fronteiras entre tick, cancelamento e retomada.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { coroutineResume, coroutineActiveCount } from "@engine/core/coroutine_scheduler";

let failures = 0;
function check(name: string, value: boolean): void {
  io.print((value ? "[ok] " : "[FALHOU] ") + name);
  if (!value) failures = failures + 1;
}

class Marker extends Behavior { resumed = 0; }
function attach(scene: Scene): Marker {
  const object = new GameObject("marker");
  const marker = new Marker();
  object.addBehavior(marker);
  scene.add(object);
  return marker;
}

async function cancelReady(mode: number): Promise<void> {
  const scene = new Scene("ready");
  const marker = attach(scene);
  const handle = marker.startCoroutine(async () => {
    await marker.nextFrame();
    marker.resumed = marker.resumed + 1;
  });
  scene.update(0.016); // A continuação já está na fila pronta.
  if (mode === 0) marker.stopCoroutine(handle);
  else if (mode === 1) scene.removeAt(0);
  else if (mode === 2) scene.clear();
  else marker.enabled = 0;
  await coroutineResume();
  check("cancelamento depois do tick, modo " + mode, marker.resumed === 0);
  check("sem corrotina retida, modo " + mode, coroutineActiveCount() === 0);
}

async function staleHandle(): Promise<void> {
  const scene = new Scene("handles");
  const marker = attach(scene);
  const oldHandle = marker.startCoroutine(async () => { await marker.nextFrame(); });
  scene.update(0.016);
  await coroutineResume();
  const newHandle = marker.startCoroutine(async () => {
    await marker.nextFrame();
    marker.resumed = marker.resumed + 1;
  });
  check("handle novo não reutiliza a identidade encerrada", oldHandle !== newHandle);
  marker.stopCoroutine(oldHandle);
  scene.update(0.016);
  await coroutineResume();
  check("handle encerrado não cancela a corrotina nova", marker.resumed === 1);
  check("nenhuma corrotina vazou", coroutineActiveCount() === 0);
}

async function cancelDuringResume(): Promise<void> {
  const scene = new Scene("resume");
  const first = attach(scene);
  const second = attach(scene);
  first.startCoroutine(async () => {
    await first.nextFrame();
    second.stopAllCoroutines();
  });
  second.startCoroutine(async () => {
    await second.nextFrame();
    second.resumed = second.resumed + 1;
  });
  scene.update(0.016);
  await coroutineResume();
  check("cancelamento por outra continuação pronta é respeitado", second.resumed === 0);
  check("fila foi drenada", coroutineActiveCount() === 0);
}

async function independentScenes(): Promise<void> {
  const firstScene = new Scene("first");
  const secondScene = new Scene("second");
  const first = attach(firstScene);
  const second = attach(secondScene);
  first.startCoroutine(async () => { await first.nextFrame(); first.resumed = 1; });
  second.startCoroutine(async () => { await second.nextFrame(); second.resumed = 1; });
  secondScene.update(0.016);
  await coroutineResume();
  check("atualizar B não avança a corrotina de A", first.resumed === 0);
  check("atualizar B avança sua própria corrotina", second.resumed === 1);
  second.resumed = 0;
  second.startCoroutine(async () => { await second.nextFrame(); second.resumed = 1; });
  secondScene.clear();
  firstScene.update(0.016);
  await coroutineResume();
  check("limpar B não cancela a corrotina de A", first.resumed === 1);
  check("limpar B cancela sua própria corrotina", second.resumed === 0);

  first.resumed = 0;
  first.startCoroutine(async () => { await first.nextFrame(); first.resumed = 1; });
  secondScene.clear();
  firstScene.update(0.016);
  await coroutineResume();
  check("limpar cena vazia não cancela outra cena", first.resumed === 1);
  firstScene.clear();
  check("cenas independentes não deixam corrotinas vivas", coroutineActiveCount() === 0);
}

async function realtimeAcrossScenes(): Promise<void> {
  const firstScene = new Scene("realtime-A");
  const secondScene = new Scene("realtime-B");
  const marker = attach(firstScene);
  marker.startCoroutine(async () => { await marker.waitForSecondsRealtime(0.02); marker.resumed = 1; });
  const until = performance.now() + 35;
  while (performance.now() < until) {} // Tempo real sem avançar o relógio de jogo.
  secondScene.update(0);
  await coroutineResume();
  check("cena B não retoma a espera real de A", marker.resumed === 0);
  firstScene.update(0);
  await coroutineResume();
  check("espera real não perde tempo para o tick de outra cena", marker.resumed === 1);
  firstScene.clear(); secondScene.clear();
  await coroutineResume();
}

await cancelReady(0);
await cancelReady(1);
await cancelReady(2);
await cancelReady(3);
await staleHandle();
await cancelDuringResume();
await independentScenes();
await realtimeAcrossScenes();
if (failures > 0) throw new Error("coroutine lifecycle: " + failures + " falhas");
io.print("[PASSOU] ciclo de vida das corrotinas");
