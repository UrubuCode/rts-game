// Teste de ALOCAÇÃO do Animator (e do AnimationPlayer) por frame. Rodar com
// RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as
// coletas antes do primeiro marcador são do setup/carga). Portão: 1.000 e
// 10.000 quadros dão o MESMO número por fase (medido: 0 em todas).
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-animator-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-animator-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: 17 Animators com a mistura 1D variando por frame e trigger a cada 30
// quadros (fade na camada com máscara); todos em Morto (fade na base, depois
// clipe sem laço); 17 AnimationPlayers em crossfade longo (caminho com peso).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { Animator } from "@engine/core/animator";
import { AnimationPlayer } from "@engine/core/animation_player";
const MODELO = "assets/models/kenney/character-a.glb";
const CTRL = "assets/animators/personagem.controller.json";
const DT: f64 = 1.0 / 60.0;
const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));
const L: Animator[] = []; const S: Skeleton[] = []; const P: AnimationPlayer[] = []; const PS: Skeleton[] = [];
let k = 0;
while (k < 17) {
  const g = new GameObject("a" + k); const sk = new Skeleton(MODELO); sk.ensureAsset(0);
  const an = new Animator(); an.controller = CTRL; g.addBehavior(sk); g.addBehavior(an); an.mount();
  L.push(an); S.push(sk);
  const h = new GameObject("p" + k); const sk2 = new Skeleton(MODELO); sk2.ensureAsset(0);
  const ap = new AnimationPlayer(); h.addBehavior(sk2); h.addBehavior(ap); ap.mount(); ap.play("walk", true);
  P.push(ap); PS.push(sk2);
  k = k + 1;
}
const vi = L[0].paramIndex("velocidade"); const ti = L[0].paramIndex("tiro"); const mi = L[0].paramIndex("morto");
// aquece (liga, carrega) fora das fases
k = 0; while (k < 17) { L[k].update(DT); S[k].compose(); P[k].update(DT); PS[k].compose(); k = k + 1; }
io.print("FASE animator " + n);
let f = 0;
while (f < n) {
  k = 0;
  while (k < 17) {
    const an = L[k];
    an.setFloatAt(vi, 0.5 + ((f + k) % 20) * 0.25);
    if ((f + k) % 30 === 0) an.setTriggerAt(ti);          // fade na camada com mascara
    an.update(DT); S[k].compose();
    k = k + 1;
  }
  f = f + 1;
}
io.print("FASE morto " + n);
k = 0; while (k < 17) { L[k].setBoolAt(mi, true); k = k + 1; }
f = 0;
while (f < n) { k = 0; while (k < 17) { L[k].update(DT); S[k].compose(); k = k + 1; } f = f + 1; }
k = 0; while (k < 17) { P[k].crossFade("idle", 100000.0); k = k + 1; }   // fade longo: caminho com peso
io.print("FASE player " + n);
f = 0;
while (f < n) { k = 0; while (k < 17) { P[k].update(DT); PS[k].compose(); k = k + 1; } f = f + 1; }
io.print("FASE fim");
