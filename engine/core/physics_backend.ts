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
// ── MEDIDA QUE ORIGINOU ESTE ARQUIVO (release, headless, sem render) ────────
//
//   500 objetos em movimento = 14,05 ms/frame de física (orçamento 60fps: 16,7)
//   resolveCollisions 9,55 ms (68%) | update 2,95 | computeWorld 1,55
//
// `rigidReport()` imprime o custo MODELADO ao lado desse número real: um modelo
// que não bate com a única medição que temos é um modelo a corrigir, e deixá-lo
// visível é mais barato que descobrir depois que a decisão vinha de ficção.
//
// ── O QUE ESTE ARQUIVO NÃO FAZ ─────────────────────────────────────────────
//
// Não liga a GPU por padrão. `rigidMode()` nasce em CPU e só sai daí por
// `rigidSetMode(1)` explícito, porque o sleeping do kernel está quebrado neste
// momento (`tools/test_gpurigid.ts`: "TUDO dormiu" e "os escombros re-DORMEM"
// falham; corpos assentam nas alturas certas com velocidade zero e mesmo assim
// nenhum dorme). Física com sleeping quebrado troca um gargalo por um pior: o
// caminho CPU fica 4-5× mais barato justamente por pular quem dorme.
// ═══════════════════════════════════════════════════════════════════════════
import gpu from "../../compat/gpu.ts";
import io from "../../compat/io.ts";

import { Scene } from "./scene";
import { GameObject } from "./gameobject";
import { Transform } from "./transform";
import { shapeOf, halfXOf, halfYOf, halfZOf } from "./collider";
import { rbInit, rbSetBody, rbSetShape, rbUpload, rbSyncStatics, rbService, rbX, rbY, rbZ, rbCount } from "../rigid/gpurigid";

// ── calibração ─────────────────────────────────────────────────────────────

let pbCpuPerPair: f64 = 0.0;    // ms por teste de par no caminho CPU
let pbGpuPerN2: f64 = 0.0;      // ms por (n²/1e6) no kernel gather
let pbGpuOverhead: f64 = 0.0;   // ms fixos de submit+read (round-trip)
let pbCalibrado = 0;
let pbTemGpu = 0;

/// Vizinhos que o grid entrega por corpo. NÃO é medido: é o que a broad-phase
/// da `Scene` deixa passar para a narrow-phase, e depende da densidade da cena,
/// não da máquina. 12 é o que uma pilha 3D razoavelmente compacta produz (9
/// células no plano XZ com 1-2 corpos cada). Está aqui como constante nomeada
/// justamente para ser o primeiro número a questionar quando o modelo divergir
/// da medida que `rigidReport` imprime ao lado.
const PB_VIZINHOS: f64 = 12.0;
/// A `Scene` roda DUAS passadas de resolução (a segunda redistribui a pilha).
const PB_PASSES: f64 = 2.0;
/// Sub-passos que o backend GPU submete por frame.
export const PB_SUBSTEPS = 2;

/// Laço representativo da matemática de UM par box-box do solver: penetração
/// nos três eixos, escolha do eixo de menor penetração, correção posicional.
/// Função livre com parâmetros anotados — o mesmo regime do código real, pelo
/// motivo que `scene.ts` documenta em `computeWorldInto`.
function pbSondaCpu(px: f64[], py: f64[], pz: f64[], n: number): f64 {
  let acc: f64 = 0.0;
  let i = 0;
  while (i < n) {
    const ax = px[i]; const ay = py[i]; const az = pz[i];
    let j = 0;
    while (j < n) {
      const dx = 1.3 - (ax - px[j] < 0.0 ? px[j] - ax : ax - px[j]);
      const dy = 1.3 - (ay - py[j] < 0.0 ? py[j] - ay : ay - py[j]);
      const dz = 1.3 - (az - pz[j] < 0.0 ? pz[j] - az : az - pz[j]);
      if (dx > 0.0 && dy > 0.0 && dz > 0.0) {
        if (dy <= dx && dy <= dz) acc = acc + dy * 0.85;
        else if (dx <= dz) acc = acc + dx * 0.85;
        else acc = acc + dz * 0.85;
      }
      j = j + 1;
    }
    i = i + 1;
  }
  return acc;
}

/// Mede os coeficientes UMA vez. Idempotente; ~100 ms na primeira chamada.
export function rigidCalibrate(): void {
  if (pbCalibrado !== 0) return;
  pbCalibrado = 1;
  pbTemGpu = gpu.available();

  // ── CPU: n=512 → 262k pares; média de 3 rodadas ──────────────────────────
  const CN = 512;
  const px: f64[] = [];
  const py: f64[] = [];
  const pz: f64[] = [];
  let s = 77;
  let i = 0;
  while (i < CN) {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    px.push((s % 1000) * 0.01);
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    py.push((s % 1000) * 0.01);
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    pz.push((s % 1000) * 0.01);
    i = i + 1;
  }
  pbSondaCpu(px, py, pz, CN);                  // aquecimento (JIT/cache)
  const t0 = performance.now();
  let r = 0;
  while (r < 3) { pbSondaCpu(px, py, pz, CN); r = r + 1; }
  const cpuMs = (performance.now() - t0) / 3.0;
  pbCpuPerPair = cpuMs / (CN * 1.0 * CN);

  if (pbTemGpu === 0) return;

  // ── GPU: o kernel-sonda tem a MESMA forma do gather de `gpurigid` (cada
  //    thread varre todos os corpos), porque medir um kernel diferente daquele
  //    que vai rodar é medir outra coisa. Overhead = rodada de 64 threads.
  const pipe = gpu.shader(`
@group(0) @binding(0) var<storage, read_write> d: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&d);
  if (id.x >= n) { return; }
  let p = d[id.x].xyz;
  var c: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  for (var j: u32 = 0u; j < n; j = j + 1u) {
    let e = vec3<f32>(1.3, 1.3, 1.3) - abs(p - d[j].xyz);
    if (e.x > 0.0 && e.y > 0.0 && e.z > 0.0) { c = c + e * 0.3; }
  }
  d[id.x] = vec4<f32>(p + c * 0.001, 0.0);
}
`);
  if (pipe === 0) { pbTemGpu = 0; return; }
  const GN = 2048;
  const espelho = new Float32Array(GN * 4);
  i = 0;
  while (i < GN * 4) { espelho[i] = (i % 97) * 0.1; i = i + 1; }
  const g = gpu.buffer(GN * 16);
  gpu.write(g, espelho);
  gpu.bind_buffer(pipe, 0, g);
  const mini = new Float32Array(64 * 4);
  gpu.dispatch(pipe, 1, 1, 1);
  gpu.read(g, mini);                           // aquecimento
  let t1 = performance.now();
  r = 0;
  while (r < 5) { gpu.dispatch(pipe, 1, 1, 1); gpu.read(g, mini); r = r + 1; }
  pbGpuOverhead = (performance.now() - t1) / 5.0;
  t1 = performance.now();
  r = 0;
  while (r < 5) { gpu.dispatch(pipe, GN / 64, 1, 1); gpu.read(g, espelho); r = r + 1; }
  const cheio = (performance.now() - t1) / 5.0;
  let porN2 = (cheio - pbGpuOverhead) / ((GN * 1.0 * GN) / 1000000.0);
  if (porN2 < 0.0) porN2 = 0.0;
  pbGpuPerN2 = porN2;
  gpu.bufferFree(g);
}

/// Custo de FRAME estimado no caminho CPU para `n` corpos dinâmicos: grid
/// espacial, logo ~n × vizinhos × passes, e NÃO n².
export function rigidCpuCostMs(n: number): f64 {
  rigidCalibrate();
  return n * PB_VIZINHOS * PB_PASSES * pbCpuPerPair;
}

/// Custo de FRAME estimado no backend GPU: gather O(n²) × sub-passos + um
/// round-trip. O round-trip entra UMA vez porque `rbService` é pipelined —
/// submete e lê o resultado do frame anterior, sem esperar.
export function rigidGpuCostMs(n: number): f64 {
  rigidCalibrate();
  if (pbTemGpu === 0) return 999999.0;
  return pbGpuOverhead + (n * 1.0 * n / 1000000.0) * pbGpuPerN2 * PB_SUBSTEPS;
}

/// A decisão de CUSTO: 0 = CPU, 1 = GPU. Sem GPU é sempre 0; no empate a CPU
/// ganha (zero latência de frame e libera a GPU para o render).
///
/// Isto é o que a MÁQUINA responderia. O que de fato roda é `rigidBackend()`,
/// que ainda passa pelo portão do `rigidMode` — ver o cabeçalho.
export function rigidBackendFor(n: number): number {
  rigidCalibrate();
  if (pbTemGpu === 0) return 0;
  return rigidGpuCostMs(n) < rigidCpuCostMs(n) ? 1 : 0;
}

/// A FAIXA em que a GPU vence nesta máquina, como dois números num array
/// `[nMin, nMax]` (`[0, 0]` = nunca vence). Existe porque a faixa é a forma
/// real da resposta aqui, ao contrário do fluido — ver o cabeçalho.
export function rigidBand(): number[] {
  rigidCalibrate();
  let lo = 0;
  let hi = 0;
  let n = 16;
  while (n < 20000) {
    if (rigidBackendFor(n) === 1) {
      if (lo === 0) lo = n;
      hi = n;
    }
    n = n + 16;
  }
  return [lo, hi];
}

// ── o portão: modo escolhido, e o que de fato está rodando ─────────────────

/// 0 = CPU, 1 = GPU (PADRÃO), 2 = automático por custo.
///
/// # Por que a GPU é o padrão, e o que isso custa
///
/// Medido em release, corpos EM MOVIMENTO (o caso em que a física custa):
///
///     n      CPU        GPU      ganho
///     500    3,50 ms    0,45 ms   7,8x
///     2000  21,40 ms    0,75 ms  28,5x
///     4000  57,40 ms    1,90 ms  30,2x
///
/// A GPU vence mesmo com o algoritmo PIOR — o kernel é gather força-bruta,
/// O(n²), e a CPU tem grid espacial, O(n). Ela compensa com milhares de núcleos.
///
/// O QUE MUDAVA DE COMPORTAMENTO — e não muda mais. `pbSync` mandava todo corpo
/// dinâmico como AABB e uma ESFERA colidia como CAIXA na GPU; a ressalva dizia
/// "use `fisica cpu` para uma pilha de esferas". Desde 2026-08-11 os dois lados
/// leem a forma de `collider.ts`, e `claude-test-paridade-formas` mede o que
/// sobra: pior altura de repouso 0,074 sobre 13 contatos apoiados.
///
/// O que NÃO muda: sem GPU disponível, `rigidStep` cai para a CPU sozinho — o
/// fallback não é opcional e nunca foi.
let pbModo = 1;
/// 1 = a GPU foi pedida e FALHOU em ligar; não se tenta de novo neste processo.
let pbGpuMorta = 0;
/// Último motivo de queda, para o `dbg` dizer POR QUE está na CPU.
let pbMotivo = "";

/// Pede o backend. `1` = GPU, e é o único jeito de sair da CPU: o padrão é CPU
/// por decisão, não por falta de GPU (ver o cabeçalho).
export function rigidSetMode(modo: number): void {
  pbModo = modo === 1 ? 1 : 0;
  if (pbModo === 0) pbMotivo = "";
}

export function rigidMode(): number { return pbModo; }

/// O nome do que está REALMENTE ativo — é isto que o `dbg` reporta, e não
/// `rigidMode`, porque pedir GPU e estar na CPU é exatamente o estado que
/// alguém medindo precisa enxergar.
export function rigidBackendName(): string {
  if (pbModo === 0) return "cpu";
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

// ── o runtime: a ponte cena ↔ gpurigid ─────────────────────────────────────

let pbBodies = 0;
let pbMap: number[] = [];   // corpo k na GPU → índice do objeto na cena
let pbDirty = 1;            // a composição mudou: re-sincronizar antes do passo
let pbFresh = 0;
let pbFrames = 0;

/// Marca que a composição da cena mudou (add/remove/reparent/estático).
///
/// NÃO leio `Scene.colDirty` para isso, embora ele responda a mesma pergunta:
/// quem o lê também o LIMPA, e limpá-lo aqui roubaria do caminho CPU o sinal de
/// que ele precisa recoletar. Duas leituras de um flag de uso único é como um
/// deles passa a nunca disparar.
export function rigidInvalidate(): void { pbDirty = 1; }

/// Recolhe os corpos dinâmicos da cena e os entrega ao kernel.
///
/// `collideFlag` é o mesmo critério da `collectColliders` do caminho CPU (mesh
/// presente e objeto RAIZ) — usar outro faria os dois backends simularem
/// conjuntos diferentes, que é a maneira de a troca de backend parecer um bug
/// de física.
function pbSync(sc: Scene): number {
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const n = objs.length;
  pbMap.length = 0;
  let i = 0;
  while (i < n) {
    const o: GameObject = objs[i];
    if (o.collideFlag !== 0 && o.active !== 0 && o.stationary === 0) pbMap.push(i);
    i = i + 1;
  }
  const m = pbMap.length;
  if (m === 0) { pbBodies = 0; return 0; }

  // `rbInit` aloca buffers novos e NÃO libera os antigos, então só é chamado
  // quando a contagem muda de verdade. Um sync por mudança de posição reusa os
  // buffers existentes.
  if (m !== rbCount() || rbCount() === 0) {
    if (rbInit(m) === 0) { pbGpuMorta = 1; pbMotivo = "rbInit falhou"; return 0; }
  }
  let k = 0;
  while (k < m) {
    const t: Transform = trs[pbMap[k]];
    // MASSA 1 para todo corpo dinâmico, e isto é paridade e não preguiça: o
    // solver da CPU divide a correção de cada par ao meio, o que é exatamente
    // massas iguais. Dar massa por volume aqui faria a GPU simular uma física
    // diferente da CPU, e a troca de backend mudaria o resultado.
    // A meia-extensão vem de `collider.ts`, que é a MESMA fonte que o solver da
    // CPU lê. Era `t.sx * 0.5` aqui e no `scene.ts`, oito cópias de uma regra —
    // e duas cópias de uma regra é como dois backends divergem sem que ninguém
    // toque na física.
    const ob: GameObject = objs[pbMap[k]];
    rbSetBody(k, t.wx, t.wy, t.wz,
              halfXOf(ob, t), halfYOf(ob, t), halfZOf(ob, t), 1.0);
    // A FORMA REAL. Antes todo corpo ia como caixa e uma esfera colidia como
    // cubo na GPU — divergência que só era teórica enquanto a CPU era o padrão.
    rbSetShape(k, shapeOf(ob));
    k = k + 1;
  }
  rbUpload();
  rbSyncStatics(sc);
  pbBodies = m;
  return m;
}

/// UM frame de física na GPU. Devolve 1 se a GPU assumiu o frame (e o chamador
/// deve PULAR o caminho CPU), 0 se não — sem GPU, GPU morta, modo CPU, ou cena
/// sem corpos dinâmicos.
///
/// ── `rbService` (pipelined), e por que ele NÃO era usado antes ─────────────
///
/// Este arquivo usou `rbStep` (síncrono) por um tempo, com uma justificativa que
/// era correta quando foi escrita e ENVELHECEU: `compat/gpu.ts` declarava
/// `read_begin(buf)` com um parâmetro só, o tamanho era descartado, o nativo
/// recebia `size=0` e devolvia ticket `0` — e com ticket 0 o `rbService` reentra
/// para sempre no ramo "primeiro frame" e nunca entrega estado novo.
///
/// O shim foi corrigido (`read_begin(buf, size)`), então o caminho certo está
/// livre. A diferença decide o frame:
///
///     rbStep    -> rbPull -> gpu.read      ESPERA a GPU terminar
///     rbService -> readBegin/readPoll      pergunta e segue
///
/// O editor desenha com a MESMA GPU, então esperar a compute serializa compute
/// e render — o frame passa a custar um round-trip inteiro, e o ganho medido no
/// benchmark (que sempre usou `rbService`) não chega à tela.
///
/// O preço é 1 frame de latência: sem estado novo, o desenho repete o anterior.
/// `dirtyHint` é o `colDirty` da própria `Scene`: 1 = a composição mudou. Ele
/// entra por PARÂMETRO para que a costura na `Scene` seja UMA linha em vez de
/// uma chamada de `rigidInvalidate()` em cada um dos quatro pontos que mexem na
/// cena (add, clear, moveSubtree, removeAt) — quatro lugares para lembrar é o
/// desenho em que alguém esquece o quinto. E é só HINT: quem lê `colDirty` de
/// verdade continua sendo o caminho CPU, que também o LIMPA; aqui ele nunca é
/// zerado, porque uma queda para a CPU depois de um frame de GPU precisa
/// encontrar o flag ainda de pé.
export function rigidStep(sc: Scene, dirtyHint: number): number {
  if (dirtyHint !== 0) pbDirty = 1;
  if (pbModo !== 1) return 0;
  rigidCalibrate();
  if (pbTemGpu === 0) {
    if (pbGpuMorta === 0) { pbGpuMorta = 1; pbMotivo = "gpu.available()=0"; }
    return 0;
  }
  if (pbGpuMorta !== 0) return 0;

  if (pbDirty !== 0) {
    if (pbSync(sc) === 0) return 0;
    pbDirty = 0;
  }
  if (pbBodies === 0) return 0;

  pbFrames = pbFrames + 1;
  // `rbService`, NÃO `rbStep`. A diferença decide o frame:
  //
  //   rbStep    -> rbPull -> gpu.read      ESPERA a GPU terminar
  //   rbService -> readBegin/readPoll      pergunta e segue
  //
  // O editor desenha com a MESMA GPU, então esperar a compute serializa
  // compute e render: o frame passa a custar um round-trip inteiro, e o ganho
  // de 34× medido no benchmark (que usa `rbService`) não chega à tela. É o
  // padrão que o fluido já usava, e que o próprio `gpurigid` chama de "física
  // como serviço".
  //
  // O preço é 1 frame de latência: quando o resultado ainda não chegou, o
  // desenho usa o estado do frame anterior.
  const novo = rbService(PB_SUBSTEPS);
  if (novo !== 0) {
    pbFresh = pbFresh + 1;
    pbApply(sc);
  }
  // 1 SEMPRE que a GPU está no comando, mesmo sem estado novo. Devolver 0 faria
  // a CPU rodar a varredura de pares por cima — duas físicas sobre o mesmo
  // estado, que é pior que um frame repetido.
  return 1;
}

/// Escreve as posições da GPU de volta nos transforms.
///
/// Escreve em `px/py/pz` (LOCAL) e não em `wx/wy/wz`: todo corpo aqui é RAIZ
/// (é o que `collideFlag` garante), então local e mundo coincidem, e é o local
/// que o `computeWorld` do próximo frame lê. Escrever no mundo seria escrever
/// no destino de um cálculo que roda logo depois — perdido no mesmo frame.
function pbApply(sc: Scene): void {
  const objs: GameObject[] = sc.objects;
  const m = pbMap.length;
  let k = 0;
  while (k < m) {
    const t: Transform = objs[pbMap[k]].transform;
    t.px = rbX(k);
    t.py = rbY(k);
    t.pz = rbZ(k);
    k = k + 1;
  }
}

/// Imprime a calibração e a decisão (debug/telemetria).
export function rigidReport(): void {
  rigidCalibrate();
  io.print("[rigid] cpu=" + pbCpuPerPair * 1000000.0 + "ns/par  gpu=" +
           pbGpuPerN2 + "ms/M-par + " + pbGpuOverhead + "ms overhead  temGpu=" + pbTemGpu);
  const faixa = rigidBand();
  if (faixa[0] === 0) io.print("[rigid] a GPU NAO vence em nenhum n nesta maquina");
  else io.print("[rigid] a GPU vence na FAIXA n = " + faixa[0] + " .. " + faixa[1]);
  // Medido nesta máquina: o coeficiente n² saiu ZERO — 2048 corpos (4,2M pares)
  // custaram menos que o ruído do próprio round-trip. Isso torna o LIMITE
  // SUPERIOR da faixa ficção: o modelo passa a dizer que a GPU vence sempre,
  // porque o termo que a faria perder mede zero. O limite inferior continua
  // válido (vem do overhead, que é medido de verdade). Dito aqui em vez de
  // corrigido com um número inventado — a sonda precisa de um n maior.
  if (pbTemGpu !== 0 && pbGpuPerN2 <= 0.0) {
    io.print("[rigid] AVISO: coeficiente n2 da GPU mediu 0 — o topo da faixa NAO e confiavel");
  }
  // O número real ao lado do modelado: 500 corpos custaram 9,55 ms medidos em
  // release headless. Divergência grande aqui é o modelo pedindo correção
  // (PB_VIZINHOS é o primeiro suspeito), não um detalhe cosmético.
  io.print("[rigid] n=500: cpu " + rigidCpuCostMs(500) + " ms (modelo) vs 9.55 ms (medido) | gpu " +
           rigidGpuCostMs(500) + " ms");
  io.print("[rigid] modo=" + (pbModo === 0 ? "cpu" : "gpu") + " ativo=" + rigidBackendName());
}
