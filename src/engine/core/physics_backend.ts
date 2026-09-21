// ═══════════════════════════════════════════════════════════════════════════
// DECISOR CPU × GPU DOS RÍGIDOS — mede a MÁQUINA e escolhe onde a colisão roda.
//
// Mesma forma do `engine/fluid/decide.ts`, de propósito: calibrar uma vez na
// inicialização, expor `…CpuCostMs(n)` / `…GpuCostMs(n)` / `…Backend(n)` /
// `…Report()`, e decidir por comparação de custo em vez de por constante. O
// projeto já tem UMA resposta para "como escolher backend"; uma segunda,
// diferente, seria pior que o problema que ela resolveria.
//
// ── A DIFERENÇA EM RELAÇÃO AO FLUIDO, E POR QUE ELA MUDA A CONCLUSÃO ────────
//
// No fluido os dois backends são O(n²), então a GPU ganha a partir de um n e
// nunca mais perde. Aqui NÃO: o caminho CPU (`Scene.resolveCollisions`) tem
// grid espacial e custa ~n × vizinhos, enquanto o kernel de `gpurigid.ts` é
// GATHER — cada corpo varre todos os outros, O(n²) de verdade.
//
// A consequência é que a GPU vence numa FAIXA, não a partir de um ponto: abaixo
// dela o round-trip domina, acima dela o n² alcança e passa o grid. Um modelo
// que só procurasse "o ponto de cruzamento" responderia certo por acaso na
// faixa e errado fora dela — por isso `rigidBackend` compara os dois custos em
// cada n em vez de comparar n com um limiar.
//
// ── MEDIÇÃO DE REFERÊNCIA (500 corpos em movimento, release 2026-09-20) ─────
//
//   solver TS 0,24 ms esparso / 6,97 ms denso; backend Rust 16t 0,08 ms denso.
//   O número antigo desta linha (14,05 ms/frame) é de antes do backend nativo.
//
// ── O QUE ESTE ARQUIVO FAZ ─────────────────────────────────────────────────
//
// Escolhe o backend pelo perfil MEDIDO (`backend_profile.ts`). `rigidMode()`
// nasce em AUTO (3) e consulta a tabela de medições reais de 2026-09-20.
//
// ── O DÉBITO DA SONDA FOI RESOLVIDO EM 2026-09-20 ──────────────────────────
//
// O modelo de custo anterior media uma sonda n² e comparava com o kernel de
// grid. O coeficiente n² media zero por ruído e o joelho oscilava ±40%.
// A sonda foi removida e substituída pela tabela de medições reais
// (`backend_profile.ts`), que interpola na faixa medida e recusa fora dela.
// ═══════════════════════════════════════════════════════════════════════════
import gpu from "@compat/gpu.ts";
import io from "@compat/io.ts";

import { Scene } from "./scene";
import { GameObject } from "./gameobject";
import { Transform } from "./transform";
import { shapeOf, halfXOf, halfYOf, halfZOf, COL_HULL, centerLocalX, centerLocalY, centerLocalZ } from "./collider";
import { rbInit, rbSetBody, rbSetShape, rbSetVel, rbSetPos, rbPoke, rbSetDt, rbSetMaterial,
         rbUpload, rbSyncStatics, rbUploadPosVel, rbGridOverflow,
         rbService, rbKicked, rbCancel, rbReadState, rbX, rbY, rbZ, rbVelX, rbVelY, rbVelZ,
         rbCount } from "../rigid/gpurigid";
// O TERCEIRO backend: o solver paralelo em Rust (`rts:rigid`), mesma
// formulação gather do kernel WGSL. Ver `engine/rigid/cpurigid.ts`.
import { crAvailable, crInit, crSetBody, crSetShape, crSetVel, crSetPos, crSetDt, crSetMaterial,
         crSyncStatics, crStep, crGridOverflow, crX, crY, crZ, crVelX, crVelY, crVelZ,
         crCount, crThreads } from "../rigid/cpurigid";
import { FIXED_DT } from "./fixedstep";
import { Behavior } from "./behavior";
import { profBest, profGpuMs, profRustMs, profRange,
         PROF_GPU, PROF_RUST, PROF_DESCONHECIDO } from "./backend_profile";

/// Sub-passos que o backend GPU submete por frame.
export const PB_SUBSTEPS = 2;

/// 0 = não perguntado, 1 = há placa, 2 = não há.
let pbGpuVisto = 0;

/// Há GPU utilizável? Perguntado uma vez, e FORA de qualquer calibração.
///
/// Isto morava dentro de `rigidCalibrate` — era a única escrita de `pbTemGpu`
/// no arquivo inteiro. Apagar o calibrador sem mover isto tiraria a queda para
/// a CPU que o cabeçalho deste módulo chama de "não opcional".
function pbGpuPresente(): number {
  if (pbGpuVisto === 0) pbGpuVisto = gpu.available() !== 0 ? 1 : 2;
  return pbGpuVisto === 1 ? 1 : 0;
}

// ── o portão: modo escolhido, e o que de fato está rodando ─────────────────

/// 0 = CPU (o solver da `Scene`), 1 = GPU, 2 = RUST, 3 = AUTO (PADRÃO).
///
/// AUTO consulta o perfil MEDIDO (`backend_profile.ts`) com a contagem de
/// corpos e de threads desta máquina. Não é o "automático por custo" antigo,
/// que era ficção: aquele modelava n² contra um kernel com grid e oscilava
/// ±40% entre execuções. Este lê uma tabela de medições e RECUSA fora dela.
///
/// # Por que o padrão não é simplesmente "Rust"
///
/// Porque a vantagem do Rust depende das threads, e isso foi MEDIDO em
/// 2026-09-20: com 1 thread a GPU já ganha a partir de ~1000 corpos; com 2, a
/// partir de ~2000; com 4, a partir de ~8000; com 16 ela não ganha na faixa
/// medida. Fixar o Rust seria correto nesta máquina e errado numa de dois
/// núcleos — e a primeira versão deste plano cometeu exatamente esse erro,
/// porque as três análises que convergiram nele liam a mesma tabela de 16
/// threads.
///
/// # O desempate, quando a medição não responde
///
/// Fora da faixa o perfil devolve `PROF_DESCONHECIDO` e a escolha cai no RUST:
/// ele é determinístico bit a bit e não custa um frame de latência. Na ausência
/// de medição, a propriedade decide.
let pbModo = 3;
/// 1 = a GPU foi pedida e FALHOU em ligar; não se tenta de novo neste processo.
let pbGpuMorta = 0;
/// Último motivo de queda, para o `dbg` dizer POR QUE está na CPU.
let pbMotivo = "";

/// Histerese do modo AUTO:
/// Alterna entre Rust e GPU somente com margem >= 20% sustentada por 10 passos.
let pbAutoAtivo = 0;        // 1 = GPU, 2 = Rust, 0 = inicial
let pbAutoCandidate = 0;    // candidato proposto
let pbAutoStreak = 0;       // passos consecutivos sustentados

/// Pede o backend. `1` = GPU, `2` = RUST, `3` = AUTO, `0` = CPU.
export function rigidSetMode(modo: number): void {
  pbModo = modo === 1 ? 1 : (modo === 2 ? 2 : (modo === 3 ? 3 : 0));
  if (pbModo === 0) pbMotivo = "";
  pbAutoAtivo = 0;
  pbAutoCandidate = 0;
  pbAutoStreak = 0;
}

export function rigidMode(): number { return pbModo; }

/// Estado interno da histerese do modo AUTO (para testes e diagnóstico).
export function rigidAutoHysteresis(): { ativo: number, candidate: number, streak: number } {
  return { ativo: pbAutoAtivo, candidate: pbAutoCandidate, streak: pbAutoStreak };
}

/// O nome do que está REALMENTE ativo — é isto que o `dbg` reporta, e não
/// `rigidMode`, porque pedir GPU e estar na CPU é exatamente o estado que
/// alguém medindo precisa enxergar.
export function rigidBackendName(): string {
  if (pbModo === 3) {
    const threads = crThreads();
    const ativo = pbAutoAtivo !== 0 ? pbAutoAtivo : (profBest(pbBodies, threads) === PROF_GPU ? 1 : 2);
    if (ativo === 2) {
      if (pbBodies === 0) return "rust (auto, aguardando corpos)";
      return "rust (auto, " + threads + " threads)";
    }
    return "gpu (auto)";
  }
  if (pbModo === 0) return "cpu";
  // O backend Rust não tem um estado "caiu": ele não depende de placa, e é
  // justamente por isso que ele existe. Um nome que sugerisse queda seria uma
  // condição que não pode acontecer.
  if (pbModo === 2) {
    if (pbBodies === 0) return "rust (aguardando corpos)";
    return "rust (" + crThreads() + " threads)";
  }
  if (pbGpuMorta !== 0) return "cpu (gpu caiu: " + pbMotivo + ")";
  if (pbBodies === 0) return "gpu (aguardando corpos)";
  return "gpu";
}

/// Corpos dinâmicos entregues à GPU no último sync (0 = nenhum ainda).
export function rigidBodyCount(): number { return pbBodies; }

/// Frames em que a GPU devolveu estado novo desde o último `rigidStatsReset`.
export function rigidFreshFrames(): number { return pbFresh; }
export function rigidStatsReset(): void { pbFresh = 0; pbFrames = 0; }
export function rigidFrames(): number { return pbFrames; }

// ── o runtime: a ponte cena ↔ backend ──────────────────────────────────────
//
// ── O CONTRATO DE POSSE, e o que ele consertou ─────────────────────────────
//
// Enquanto um backend externo (GPU ou Rust) está no comando, o estado dinâmico
// dos corpos — posição, velocidade, sono — MORA NELE, e os transforms da cena
// são um espelho de saída. `pbDono` diz quem tem a posse. Três regras saem daí,
// e cada uma era um defeito antes de estar escrita:
//
//   ENTRADA  (`pbSync*`)  o backend recebe posição E VELOCIDADE do transform.
//            Recebia só a posição, com velocidade zero: qualquer spawn no meio
//            do play parava o mundo inteiro no ar.
//   POSSE    o `Rigidbody` de cada corpo é avisado (`setExternalSim`) e para de
//            integrar. Ele integrava por cima: a gravidade da CPU acumulava sem
//            contato que a freasse, e nos frames sem resultado da GPU o corpo
//            descia sozinho e era puxado de volta — tremor.
//   SAÍDA    (`pbSoltar`)  antes de qualquer ressincronização ou queda para a
//            CPU, o estado volta INTEIRO para os transforms. É o que faz a
//            entrada seguinte (ou o solver da CPU) continuar de onde o backend
//            parou, em vez de recomeçar do repouso.
//
// E QUANDO ressincronizar deixou de depender de alguém lembrar: `rigidStep`
// compara `Scene.compVersion` com a última versão que viu. O editor sempre
// chamou `rigidStep(scene, 0)` e nunca `rigidInvalidate()`, então depois do
// primeiro frame o `pbMap` era um retrato congelado — um `removeAt` deslocava os
// índices e o backend passava a escrever a posição de um corpo no vizinho.

let pbBodies = 0;
let pbMap: number[] = [];       // corpo k no backend → índice do objeto na cena
/// corpo k → o OBJETO. O índice de `pbMap` morre no primeiro `removeAt`; a
/// referência não, e é por ela que o estado volta para quem é dono dele.
let pbObjs: GameObject[] = [];
/// A última posição que ESTE arquivo escreveu (ou leu) em cada corpo. Se o
/// transform não bate mais com ela, alguém de fora moveu o corpo — o gizmo do
/// editor, um script — e o backend precisa saber, senão ele devolve o corpo ao
/// lugar antigo no frame seguinte e o objeto "não deixa" ser arrastado.
let pbLX: f64[] = [];
let pbLY: f64[] = [];
let pbLZ: f64[] = [];
/// Resultados a IGNORAR para o corpo k. A leitura pipelined da GPU que já
/// estava em voo na hora de um teleporte descreve o lugar antigo.
let pbHold: number[] = [];
let pbDirty = 1;            // a composição mudou: re-sincronizar antes do passo
let pbVersao = 0 - 1;       // última `Scene.compVersion` vista
let pbDono = 0;             // 0 = ninguém (CPU), 1 = GPU, 2 = Rust
/// Passos fixos pedidos e ainda não submetidos à GPU. O `rbService` só submete
/// quando a leitura anterior chegou; sem esta conta, cada chamada sem resultado
/// era um passo de simulação PERDIDO e a velocidade do mundo dependia da
/// latência da placa. Com teto, pelo mesmo motivo do `MAX_STEPS` do passo fixo.
let pbDevidos = 0;
const PB_MAX_DEVIDOS = 5;
let pbFresh = 0;
let pbFrames = 0;

/// Marca que a composição da cena mudou. Continua existindo para quem mexe em
/// algo que a `Scene` não vê (um teste que troca um `Collider` à mão); para
/// add/remove/reparent/escala o `compVersion` já avisa sozinho.
export function rigidInvalidate(): void { pbDirty = 1; }

/// Conta colisores de casca. Uma varredura O(n), feita só quando a composição
/// muda — a mesma condição que já governa `pbCollect`.
function pbContaCascas(sc: Scene): number {
  const objs: GameObject[] = sc.objects;
  const n = objs.length;
  let c = 0;
  let i = 0;
  while (i < n) {
    if (shapeOf(objs[i]) === COL_HULL) c = c + 1;
    i = i + 1;
  }
  return c;
}

/// Quem é corpo dinâmico, em `pbMap`/`pbObjs`. Responde quantos.
///
/// `collideFlag` é o mesmo critério da `collectColliders` do caminho CPU (mesh
/// presente e objeto RAIZ), e os dois backends passam por AQUI: duas cópias do
/// critério é como dois backends passam a simular cenas diferentes — que é o
/// modo de a troca de backend parecer um bug de física.
function pbCollect(sc: Scene): number {
  const objs: GameObject[] = sc.objects;
  const n = objs.length;
  pbMap.length = 0;
  pbObjs.length = 0;
  let i = 0;
  while (i < n) {
    const o: GameObject = objs[i];
    if (o.collideFlag !== 0 && o.active !== 0 && o.stationary === 0) {
      pbMap.push(i);
      pbObjs.push(o);
    }
    i = i + 1;
  }
  const m = pbMap.length;
  while (pbLX.length < m) { pbLX.push(0.0); pbLY.push(0.0); pbLZ.push(0.0); pbHold.push(0); }
  return m;
}

/// Avisa os scripts de cada corpo que a posse mudou (ver o contrato acima).
function pbAvisaPosse(on: number): void {
  const m = pbObjs.length;
  let k = 0;
  while (k < m) {
    const bs: Behavior[] = pbObjs[k].behaviors;
    let j = 0;
    while (j < bs.length) { bs[j].setExternalSim(on); j = j + 1; }
    k = k + 1;
  }
}

/// SAÍDA: devolve o estado do backend dono para os transforms e larga a posse.
///
/// A leitura da GPU aqui é SÍNCRONA (`rbReadState`), a única deste arquivo, e é
/// aceitável pelo mesmo motivo que torna o resto pipelined: isto roda quando a
/// composição muda, não por frame.
///
/// Um corpo que alguém moveu por fora desde a última escrita (`pbL*` não bate)
/// fica onde o usuário pôs — a intenção dele vale mais que a do solver.
function pbSoltar(): void {
  if (pbDono === 0) return;
  const m = pbObjs.length;
  if (pbDono === 1 && m === rbCount()) rbReadState();
  let k = 0;
  while (k < m) {
    const t: Transform = pbObjs[k].transform;
    const intocado = (t.px === pbLX[k] && t.py === pbLY[k] && t.pz === pbLZ[k]) ? 1 : 0;
    if (pbDono === 1 && m === rbCount()) {
      if (intocado !== 0 && pbHold[k] === 0) { t.px = rbX(k); t.py = rbY(k); t.pz = rbZ(k); }
      t.vx = rbVelX(k); t.vy = rbVelY(k); t.vz = rbVelZ(k);
    } else if (pbDono === 2 && m === crCount()) {
      if (intocado !== 0) { t.px = crX(k); t.py = crY(k); t.pz = crZ(k); }
      t.vx = crVelX(k); t.vy = crVelY(k); t.vz = crVelZ(k);
    }
    if (intocado === 0 && pbObjs[k].stationary === 0 && t.mass > 0.0) {
      t.vx = 0.0; t.vy = 0.0; t.vz = 0.0;
    }
    // Quem decide o sono daqui em diante é o próximo dono; acordado é o estado
    // que nunca está errado, só mais caro por dez passos.
    t.asleep = 0; t.quiet = 0;
    k = k + 1;
  }
  pbAvisaPosse(0);
  rbCancel();
  pbDono = 0;
  pbBodies = 0;
  pbDevidos = 0;
  pbDirty = 1;
}

/// ENTRADA no solver em Rust.
///
/// Os MESMOS argumentos que o `pbSync` passa ao kernel — `collider.ts` para a
/// forma e a meia-extensão, massa 1 para todo mundo — porque a paridade entre
/// os dois é o critério de aceite e ela começa aqui, não no solver.
function pbSyncRust(sc: Scene): number {
  const m = pbCollect(sc);
  if (m === 0) { pbBodies = 0; return 0; }
  if (m !== crCount()) crInit(m);
  // UMA chamada de `rigidStep` = UM passo fixo, dividido entre os sub-passos. O
  // solver integra o `dt` inteiro por sub-passo, então com o default cada
  // chamada avançava 2/60 s e o mundo rodava no dobro da velocidade.
  crSetDt(FIXED_DT / PB_SUBSTEPS);
  let k = 0;
  while (k < m) {
    const ob: GameObject = pbObjs[k];
    const t: Transform = ob.transform;
    // `px/py/pz` e não `wx/wy/wz`: todo corpo aqui é RAIZ (é o que `collideFlag`
    // garante), então local e mundo coincidem — e o mundo de um objeto criado
    // NESTE frame ainda é (0,0,0) até o próximo `computeWorld`.
    crSetBody(k, t.px, t.py, t.pz,
              halfXOf(ob, t), halfYOf(ob, t), halfZOf(ob, t), t.mass);
    crSetShape(k, shapeOf(ob));
    crSetVel(k, t.vx, t.vy, t.vz);
    crSetMaterial(k, ob, t);
    pbLX[k] = t.px; pbLY[k] = t.py; pbLZ[k] = t.pz; pbHold[k] = 0;
    k = k + 1;
  }
  crSyncStatics(sc);
  pbBodies = m;
  pbDono = 2;
  pbAvisaPosse(1);
  return m;
}

/// ENTRADA no kernel da GPU.
function pbSync(sc: Scene): number {
  const m = pbCollect(sc);
  if (m === 0) { pbBodies = 0; return 0; }

  // `rbInit` troca os buffers, então só é chamado quando a contagem muda de
  // verdade; os pipelines são compilados uma vez só (ver lá).
  if (m !== rbCount() || rbCount() === 0) {
    if (rbInit(m) === 0) { pbGpuMorta = 1; pbMotivo = "rbInit falhou"; return 0; }
  }
  // A leitura em voo descreve a composição ANTERIOR, mesmo com a contagem igual
  // (saiu um, entrou outro): aplicada ao mapa novo, é um corpo no lugar de outro.
  rbCancel();
  rbSetDt(FIXED_DT / PB_SUBSTEPS);   // ver `pbSyncRust`
  let k = 0;
  while (k < m) {
    const ob: GameObject = pbObjs[k];
    const t: Transform = ob.transform;
    // A MASSA do `Transform`, que é o que o `PhysicsMaterial` publica
    // (densidade × volume) e o que o inspector edita. Era 1 fixo, "por
    // paridade": o solver da CPU dividia a correção de cada par ao meio, o que
    // é massas iguais. Mas a CPU já usava a massa real na resposta de IMPULSO,
    // então a paridade era só da separação — e o preço era um campo do
    // inspector que não fazia nada nos dois backends rápidos. A separação da
    // CPU passou a ser proporcional ao inverso da massa (ver `solvePair`), que
    // é o que estes dois sempre fizeram, e os três voltam a concordar.
    // A meia-extensão e a FORMA vêm de `collider.ts`, a MESMA fonte que o solver
    // da CPU lê — duas cópias de uma regra é como dois backends divergem sem que
    // ninguém toque na física.
    rbSetBody(k, t.px, t.py, t.pz,
              halfXOf(ob, t), halfYOf(ob, t), halfZOf(ob, t), t.mass);
    rbSetShape(k, shapeOf(ob));
    rbSetVel(k, t.vx, t.vy, t.vz);
    rbSetMaterial(k, ob, t);
    pbLX[k] = t.px; pbLY[k] = t.py; pbLZ[k] = t.pz; pbHold[k] = 0;
    k = k + 1;
  }
  rbUpload();
  rbSyncStatics(sc);
  pbBodies = m;
  pbDono = 1;
  pbAvisaPosse(1);
  return m;
}

/// Leva ao backend dono os corpos que alguém moveu POR FORA desde a última
/// escrita. O(corpos) de comparações por passo, sem alocar; o caso comum
/// (ninguém mexeu) não escreve nada.
function pbEmpurraTeleportes(): void {
  const m = pbObjs.length;
  let k = 0;
  let movedCount = 0;
  while (k < m) {
    const ob: GameObject = pbObjs[k];
    const t: Transform = ob.transform;
    if (t.px !== pbLX[k] || t.py !== pbLY[k] || t.pz !== pbLZ[k]) {
      movedCount = movedCount + 1;
      if (pbDono === 1) { rbSetPos(k, t.px, t.py, t.pz); pbHold[k] = 1; }
      else crSetPos(k, t.px, t.py, t.pz);
      // SÓ zera velocidade de corpos dinâmicos livres teleportados.
      // Corpos cinemáticos (mass <= 0) preservam sua velocidade calculada por script ou navegação.
      if (t.mass > 0.0) {
        t.vx = 0.0; t.vy = 0.0; t.vz = 0.0;
      } else {
        if (pbDono === 1) { rbSetVel(k, t.vx, t.vy, t.vz); rbPoke(k); }
        else crSetVel(k, t.vx, t.vy, t.vz);
      }
      pbLX[k] = t.px; pbLY[k] = t.py; pbLZ[k] = t.pz;
    }
    k = k + 1;
  }
}

/// Escreve as posições do solver Rust de volta nos transforms — e a velocidade
/// junto, que aqui é de graça (os espelhos SÃO o estado): quem lê `t.vx` num
/// script vê a verdade, e a saída para a CPU não precisa de leitura nenhuma.
///
/// Escreve em `px/py/pz` (LOCAL) e não em `wx/wy/wz`: todo corpo aqui é RAIZ,
/// então local e mundo coincidem, e é o local que o `computeWorld` do próximo
/// frame lê. Escrever no mundo seria escrever no destino de um cálculo que roda
/// logo depois — perdido no mesmo frame.
function pbApplyRust(): void {
  const m = pbObjs.length;
  let k = 0;
  while (k < m) {
    const t: Transform = pbObjs[k].transform;
    const x = crX(k); const y = crY(k); const z = crZ(k);
    t.px = x; t.py = y; t.pz = z;
    t.vx = crVelX(k); t.vy = crVelY(k); t.vz = crVelZ(k);
    pbLX[k] = x; pbLY[k] = y; pbLZ[k] = z;
    k = k + 1;
  }
}

/// Escreve as posições da GPU de volta nos transforms (ver `pbApplyRust` para o
/// porquê do LOCAL). A velocidade NÃO vem: o `rbService` só lê posições, e uma
/// segunda leitura por frame dobraria o tráfego para um número que só importa
/// na saída — onde `pbSoltar` o busca.
function pbApply(): void {
  const m = pbObjs.length;
  let k = 0;
  while (k < m) {
    if (pbHold[k] !== 0) {
      // resultado de ANTES do teleporte deste corpo: fora
      pbHold[k] = pbHold[k] - 1;
    } else {
      const t: Transform = pbObjs[k].transform;
      const x = rbX(k); const y = rbY(k); const z = rbZ(k);
      t.px = x; t.py = y; t.pz = z;
      pbLX[k] = x; pbLY[k] = y; pbLZ[k] = z;
    }
    k = k + 1;
  }
}

/// Quantos objetos da cena usam colisor de CASCA. Recontado quando a composição
/// muda, junto com o resto — é a mesma varredura.
let pbCascas = 0;
let pbOffsets = 0;

/// Conta corpos dinâmicos com colisor com offset (centerLocalX/Y/Z !== 0).
/// Apenas o solver da CPU (Scene) resolve corpos dinâmicos com centro deslocado
/// até o Lote C (OBB); os backends GPU e Rust assumem centro alinhado ao transform.
function pbContaOffsets(sc: Scene): number {
  const objs: GameObject[] = sc.objects;
  const n = objs.length;
  let c = 0;
  let i = 0;
  while (i < n) {
    const o: GameObject = objs[i];
    if (o.collideFlag !== 0 && o.active !== 0 && o.stationary === 0) {
      if (centerLocalX(o) !== 0.0 || centerLocalY(o) !== 0.0 || centerLocalZ(o) !== 0.0) {
        c = c + 1;
      }
    }
    i = i + 1;
  }
  return c;
}

/// A cena precisa de casca ou colisor com offset em corpo dinâmico?
/// Se sim, cai para a CPU (Scene).
export function rigidNeedsFallback(): number { return (pbCascas > 0 || pbOffsets > 0) ? 1 : 0; }

/// Quantas cascas a última varredura viu. Diagnóstico.
export function rigidHullCount(): number { return pbCascas; }
export function rigidOffsetCount(): number { return pbOffsets; }

/// Qual backend DEVE rodar este passo: 0 = CPU, 1 = GPU, 2 = Rust. Separado do
/// passo porque a posse (`pbDono`) tem de ser devolvida ANTES de qualquer
/// retorno para a CPU, e a decisão espalhada em cinco `return 0` era cinco
/// lugares para esquecer disso.
function pbAlvo(): number {
  if (pbCascas > 0) {
    if (pbMotivo !== "cascas na cena") {
      pbMotivo = "cascas na cena";
      io.print("[rigid] " + pbCascas + " colisor(es) de CASCA na cena — nem a GPU " +
               "nem o solver em Rust resolvem casca, entao a fisica cai para a CPU. " +
               "Sem isto a forma seria ignorada em silencio.");
    }
    return 0;
  }
  if (pbOffsets > 0) {
    if (pbMotivo !== "corpos dinamicos com colisor com offset") {
      pbMotivo = "corpos dinamicos com colisor com offset";
      io.print("[rigid] " + pbOffsets + " corpo(s) dinamico(s) com offset no colisor na cena — " +
               "apenas a Scene CPU resolve corpos dinamicos com centro deslocado ate o Lote C (OBB), " +
               "entao a fisica cai para a CPU.");
    }
    return 0;
  }
  // AUTO: a medição escolhe, com histerese (margem >= 20% por 10 passos).
  let modo = pbModo;
  if (modo === 3) {
    if (crAvailable() === 0) {
      modo = pbGpuPresente() !== 0 ? 1 : 0;
    } else if (pbGpuPresente() === 0) {
      modo = 2;
    } else {
      const threads = crThreads();
      const quem = profBest(pbBodies, threads);
      const candidato = quem === PROF_GPU ? 1 : 2;
      if (pbAutoAtivo === 0) {
        pbAutoAtivo = candidato;
        pbAutoCandidate = candidato;
        pbAutoStreak = 0;
      } else if (candidato !== pbAutoAtivo) {
        const curMs = pbAutoAtivo === 1 ? profGpuMs(pbBodies) : profRustMs(pbBodies, threads);
        const candMs = candidato === 1 ? profGpuMs(pbBodies) : profRustMs(pbBodies, threads);
        // Margem de 20%: candidato deve ser pelo menos 20% mais rápido que o atual
        if (curMs > 0.0 && candMs >= 0.0 && (curMs - candMs) / curMs >= 0.20) {
          if (candidato === pbAutoCandidate) {
            pbAutoStreak = pbAutoStreak + 1;
            if (pbAutoStreak >= 10) {
              pbAutoAtivo = candidato;
              pbAutoStreak = 0;
            }
          } else {
            pbAutoCandidate = candidato;
            pbAutoStreak = 1;
          }
        } else {
          pbAutoCandidate = pbAutoAtivo;
          pbAutoStreak = 0;
        }
      } else {
        pbAutoCandidate = pbAutoAtivo;
        pbAutoStreak = 0;
      }
      modo = pbAutoAtivo;
    }
  }
  // RUST: sem calibração e sem portão — não há placa que possa faltar.
  if (modo === 2) return 2;
  if (modo !== 1) return 0;
  if (pbGpuPresente() === 0) {
    if (pbGpuMorta === 0) { pbGpuMorta = 1; pbMotivo = "gpu.available()=0"; }
    return 0;
  }
  if (pbGpuMorta !== 0) return 0;
  return 1;
}

/// UM PASSO FIXO de física num backend externo. Devolve 1 se o backend assumiu
/// o passo (e o chamador deve PULAR o caminho CPU), 0 se não — sem GPU, GPU
/// morta, modo CPU, cena com casca, ou cena sem corpos dinâmicos.
///
/// `dirtyHint` força a ressincronização; 0 é o normal, porque a mudança de
/// composição chega sozinha por `Scene.compVersion` (ver o contrato de posse).
///
/// ── `rbService` (pipelined), e o que ele custa ─────────────────────────────
///
///     rbStep    -> rbPull -> gpu.read      ESPERA a GPU terminar
///     rbService -> readBegin/readPoll      pergunta e segue
///
/// O editor desenha com a MESMA GPU, então esperar a compute serializa compute
/// e render — o frame passa a custar um round-trip inteiro, e o ganho medido no
/// benchmark (que sempre usou `rbService`) não chega à tela. O preço é 1 frame
/// de latência: sem estado novo, o desenho repete o anterior. Os passos pedidos
/// nesse meio-tempo NÃO se perdem — ver `pbDevidos`.
export function rigidStep(sc: Scene, dirtyHint: number): number {
  if (dirtyHint !== 0) pbDirty = 1;
  if (sc.compVersion !== pbVersao) { pbVersao = sc.compVersion; pbDirty = 1; }

  // A CAPACIDADE É PERGUNTADA ANTES, e é o que faz a casca aparecer na tela em
  // vez de ser engolida: com casca na cena o alvo é a CPU. Mais lento e
  // CORRETO, contra rápido e errado.
  if (pbDirty !== 0) {
    pbCascas = pbContaCascas(sc);
    pbOffsets = pbContaOffsets(sc);
  }
  const alvo = pbAlvo();

  // SAÍDA antes de tudo: trocar de dono, cair para a CPU ou ressincronizar
  // começa por devolver o estado a quem ele pertence.
  if (pbDono !== 0 && (pbDono !== alvo || pbDirty !== 0)) pbSoltar();
  if (alvo === 0) return 0;

  if (pbDirty !== 0) {
    const m = alvo === 2 ? pbSyncRust(sc) : pbSync(sc);
    if (m === 0) return 0;
    pbDirty = 0;
  }
  if (pbBodies === 0) return 0;
  pbEmpurraTeleportes();
  pbFrames = pbFrames + 1;

  if (alvo === 2) {
    // Síncrono: a chamada volta com os espelhos já escritos.
    if (crStep(PB_SUBSTEPS) === 0) { pbSoltar(); return 0; }
    pbFresh = pbFresh + 1;
    pbApplyRust();
    return 1;
  }

  if (pbDevidos < PB_MAX_DEVIDOS) pbDevidos = pbDevidos + 1;
  const novo = rbService(PB_SUBSTEPS * pbDevidos);
  if (rbKicked() !== 0) pbDevidos = 0;
  if (novo !== 0) {
    pbFresh = pbFresh + 1;
    pbApply();
  }
  // 1 SEMPRE que a GPU está no comando, mesmo sem estado novo. Devolver 0 faria
  // a CPU rodar a varredura de pares por cima — duas físicas sobre o mesmo
  // estado, que é pior que um frame repetido.
  return 1;
}

/// Imprime o PERFIL e a decisão (debug/telemetria).
///
/// Era um relatório de calibração com números que a medição de 2026-09-20
/// desmentiu — a tabela "por que a GPU é o padrão" dizia CPU 21,40 ms e GPU
/// 0,75 ms a 2000 corpos; os valores medidos são 36,92 e 1,95. Agora ele
/// imprime a tabela medida e o que ela responde para ESTA máquina.
export function rigidReport(): void {
  const t = crThreads();
  const faixa = profRange();
  io.print("[rigid] perfil medido 2026-09-20 | faixa n = " + faixa[0] + ".." + faixa[1] +
           " | threads desta maquina = " + t);
  const ns: number[] = [250, 1000, 2000, 4000, 8000];
  let i = 0;
  while (i < ns.length) {
    const n = ns[i];
    const g = profGpuMs(n);
    const r = profRustMs(n, t);
    io.print("[rigid]   n=" + n + "  gpu=" + g.toFixed(3) + "  rust=" + r.toFixed(3) +
             "  -> " + (profBest(n, t) === PROF_RUST ? "rust" : "gpu"));
    i = i + 1;
  }
  io.print("[rigid] corpos agora=" + pbBodies + " modo=" + pbModo +
           " ativo=" + rigidBackendName() + " overflow=" + rigidGridOverflow());
}

/// Retorna o número de overflows de células no grid espacial (GPU ou Rust).
export function rigidGridOverflow(): number {
  if (pbDono === 1) return rbGridOverflow();
  if (pbDono === 2) return crGridOverflow();
  return 0;
}

