// ═══════════════════════════════════════════════════════════════════════════
// INTERPOLAÇÃO DE RENDER — o que separa física correta de física que PARECE
// correta na tela.
//
// Com passo fixo (ver `fixedstep.ts`), o render quase nunca cai em cima de um
// passo de física: sobra uma fração no acumulador. Desenhar sempre o último
// estado simulado faz o movimento TREMER — o objeto anda 2 passos num frame, 1
// no seguinte, 2 no outro. A física está perfeita e a tela mente.
//
// É o `Rigidbody.interpolation` da Unity, e o motivo de ele existir lá é o mesmo
// que aqui: o passo fixo resolve o determinismo e CRIA este problema visual.
//
// ── O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO ───────────────────────────────
//
// Não toca `px/py/pz`. A posição da simulação é a verdade e continua sendo o
// que a colisão, o gizmo e o `state` do WebSocket leem. Interpolar o estado da
// simulação para o render ver é como se perde a distinção entre ESTADO e
// APRESENTAÇÃO — e o sintoma aparece longe: um raycast que acerta onde o objeto
// é desenhado mas não onde ele está.
//
// O que ele faz é guardar um instantâneo do frame anterior e responder a posição
// MISTURADA, para quem desenha pedir. Quem não pedir continua vendo o mundo
// exato de sempre.
//
// ── POR QUE UM SNAPSHOT SEPARADO E NÃO "a posição anterior no Transform" ───
//
// Porque um `Transform` tem pai, e a posição de mundo é derivada
// (`computeWorld`). Guardar `px` anterior obrigaria a re-derivar a hierarquia
// inteira do frame passado para interpolar um filho. O instantâneo é do
// resultado JÁ derivado — `wx/wy/wz` — que é exatamente o que o render usa.
// ═══════════════════════════════════════════════════════════════════════════

import { Scene } from "./scene";
import { Transform } from "./transform";

// Instantâneo do frame anterior, indexado igual a `scene.objects`. Arrays
// paralelos e reaproveitados entre frames: alocar três arrays por frame no laço
// mais quente é a pressão de GC que o resto deste módulo já evita.
let prevX: f64[] = [];
let prevY: f64[] = [];
let prevZ: f64[] = [];
let prevN = 0;
let temSnapshot = 0;

/// Guarda o estado ATUAL como "anterior". Chame DEPOIS de `computeWorld()` e
/// ANTES do próximo passo de física — é o instante em que `wx/wy/wz` descrevem
/// o mundo que acabou de ser simulado.
export function snapshotWorld(sc: Scene): void {
  const trs: Transform[] = sc.trs;
  const n = sc.objects.length;
  while (prevX.length < n) { prevX.push(0.0); prevY.push(0.0); prevZ.push(0.0); }
  let i = 0;
  while (i < n) {
    const t: Transform = trs[i];
    prevX[i] = t.wx; prevY[i] = t.wy; prevZ[i] = t.wz;
    i = i + 1;
  }
  prevN = n;
  temSnapshot = 1;
}

/// A posição X de render do objeto `i`, misturada por `alpha` (0..1).
///
/// `alpha` vem de `stepAlpha()`: 0 = o passo acabou de rodar, 0,5 = estamos na
/// metade do caminho para o próximo. Sem instantâneo (primeiro frame, ou cena
/// recém-carregada) responde a posição exata — o certo é não inventar um
/// "anterior" que nunca existiu.
export function renderX(sc: Scene, i: number, alpha: f64): f64 {
  const t: Transform = sc.trs[i];
  if (temSnapshot === 0 || i >= prevN) return t.wx;
  return prevX[i] + (t.wx - prevX[i]) * alpha;
}

export function renderY(sc: Scene, i: number, alpha: f64): f64 {
  const t: Transform = sc.trs[i];
  if (temSnapshot === 0 || i >= prevN) return t.wy;
  return prevY[i] + (t.wy - prevY[i]) * alpha;
}

export function renderZ(sc: Scene, i: number, alpha: f64): f64 {
  const t: Transform = sc.trs[i];
  if (temSnapshot === 0 || i >= prevN) return t.wz;
  return prevZ[i] + (t.wz - prevZ[i]) * alpha;
}

/// Descarta o instantâneo. Depois de carregar uma cena, teleportar um objeto ou
/// sair de uma pausa longa — sem isto o primeiro frame interpola entre dois
/// mundos sem relação, e o objeto ATRAVESSA a tela em vez de aparecer no lugar.
export function interpolateReset(): void {
  temSnapshot = 0;
  prevN = 0;
}

/// Há um instantâneo utilizável?
export function hasSnapshot(): number { return temSnapshot; }
