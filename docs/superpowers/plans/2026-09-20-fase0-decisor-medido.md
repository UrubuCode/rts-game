# Fase 0 — Decisor medido e padrão condicionado: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o modelo de custo ficcional que escolhe o backend de física por um perfil MEDIDO sobre (threads, n), e condicionar o padrão a ele — sem quebrar a porta de controle nem a queda para a CPU.

**Architecture:** Um módulo novo (`backend_profile.ts`) guarda a tabela medida em 2026-09-20 e responde qual backend vence para um dado (n, threads), recusando fora da faixa medida em vez de extrapolar. `physics_backend.ts` perde a calibração por sonda (~170 linhas), ganha uma detecção de GPU independente dela, e passa a consultar o perfil. `cpurigid.ts` ganha uma sondagem real de disponibilidade.

**Tech Stack:** TypeScript sobre o runtime RTS; solver nativo em Rust (`rts:rigid`) e kernel WGSL (`rts:gpu`). Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-20-paralelismo-e-fundacao-design.md` (revisão 2)

## Pré-requisito: o estado de 2026-09-20

Este plano assume presente o trabalho de física daquele dia, e **não compila sem
ele**. Concretamente:

- `src/engine/rigid/materials.ts` (arquivo novo) — a Task 2 usa `MAT_AT`,
  `matBytesFor` e `matFillDefaults` na sondagem do solver;
- o contrato de posse em `src/engine/core/physics_backend.ts` (`pbDono`,
  `pbSoltar`, `pbEmpurraTeleportes`) — os números de linha citados nas Tasks 3 e
  4 são os do arquivo **depois** dessa mudança;
- no repositório `../rts`: `crates/rts-physics/src/solver/material.rs` e
  `step.rs`, e a regra "dormir exige apoio" em `solver/mod.rs`.

**Se esse trabalho ainda estiver sem commit quando este plano for executado,
comite-o primeiro e anote aqui o hash.** Num checkout sem ele, a Task 2 falha
na compilação e os números de linha das Tasks 3 a 5 apontam para o lugar errado.

Commit de base: `__________` (preencher quando existir)

## Global Constraints

- **Dois repositórios acoplados.** O TS vive em `rts-game`; os crates em `../rts`. **Esta fase não toca `../rts`** — nenhum rebuild de crate é necessário. Se alguma tarefa precisar tocar, ela vira outra fase.
- **Comando de teste** (a partir de `rts-game`): `../rts/target/release/rts.exe run tests/<arquivo>.ts`. Verde = a última linha é `[PASSOU]`.
- **Suíte completa:** os 27 arquivos de `tests/*.ts`, todos `[PASSOU]`.
- **Nenhum número de desempenho entra em comentário sem a data e a máquina em que foi medido.** É a regra que esta fase existe para restaurar.
- **Estilo do projeto:** laços `while`, sem `for...of`; funções livres tipadas no caminho quente; `f64`/`number` anotados. Seguir o arquivo vizinho.
- **Faixa medida (2026-09-20, RTX 2080 Ti + 16 threads):** n de 250 a 8000. Fora dela o perfil **recusa**.

---

### Task 1: O perfil medido

**Files:**
- Create: `src/engine/core/backend_profile.ts`
- Test: `tests/claude-test-backend-profile.ts`

**Interfaces:**
- Consumes: nada (módulo folha, sem imports do motor).
- Produces:
  - `PROF_GPU = 1`, `PROF_RUST = 2`, `PROF_DESCONHECIDO = 0 - 1` (constantes exportadas)
  - `profBest(n: number, threads: number): number` — devolve `PROF_GPU`, `PROF_RUST` ou `PROF_DESCONHECIDO`
  - `profGpuMs(n: number): f64` — ms/passo interpolado; `-1.0` fora da faixa
  - `profRustMs(n: number, threads: number): f64` — idem
  - `profRange(): number[]` — `[nMin, nMax]` da faixa medida

- [ ] **Step 1: Write the failing test**

Create `tests/claude-test-backend-profile.ts`:

```ts
// O PERFIL MEDIDO que escolhe o backend de rígidos.
//
//   rts.exe run tests/claude-test-backend-profile.ts
//
// O que ele pina não é "qual backend é melhor" — é que a resposta VEM DE UMA
// MEDIÇÃO e RECUSA onde não há medição. O modelo anterior extrapolava de uma
// sonda que não correspondia ao kernel, e respondia diferente a cada execução
// do mesmo binário.
import io from "@compat/io.ts";
import { profBest, profGpuMs, profRustMs, profRange,
         PROF_GPU, PROF_RUST, PROF_DESCONHECIDO } from "@engine/core/backend_profile";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

// ── 1) os pontos medidos voltam como foram medidos ────────────────────────
check("gpu a 2000 = 0,97", profGpuMs(2000) > 0.96 && profGpuMs(2000) < 0.98 ? 1 : 0);
check("rust 16t a 2000 = 0,31", profRustMs(2000, 16) > 0.30 && profRustMs(2000, 16) < 0.32 ? 1 : 0);
check("rust 1t a 2000 = 1,87", profRustMs(2000, 1) > 1.86 && profRustMs(2000, 1) < 1.88 ? 1 : 0);

// ── 2) o JOELHO se move com as threads (o achado desta campanha) ──────────
check("1 thread, 2000 corpos: a GPU ganha", profBest(2000, 1) === PROF_GPU ? 1 : 0);
check("16 threads, 2000 corpos: o Rust ganha", profBest(2000, 16) === PROF_RUST ? 1 : 0);
check("1 thread, 250 corpos: o Rust ganha (cena pequena)", profBest(250, 1) === PROF_RUST ? 1 : 0);
check("4 threads, 8000 corpos: a GPU ganha", profBest(8000, 4) === PROF_GPU ? 1 : 0);

// ── 3) RECUSA fora da faixa, em vez de extrapolar ─────────────────────────
//
// Acima de 8000 o bench denso não é confiável: o corpo 0 termina com y
// POSITIVO na GPU, ou seja, ela não assentou. Um perfil que respondesse ali
// estaria citando uma medição que não mede física.
check("acima da faixa medida, o perfil RECUSA", profBest(32000, 16) === PROF_DESCONHECIDO ? 1 : 0);
check("acima da faixa, o ms tambem recusa", profGpuMs(32000) < 0.0 ? 1 : 0);

// ── 4) abaixo da faixa, GRAMPEIA (nao e extrapolacao) ─────────────────────
//
// O menor n medido e 250, e ali o Rust ganha com QUALQUER contagem de
// threads. Abaixo disso a resposta e a mesma por monotonicidade, entao
// grampear e honesto onde extrapolar nao seria.
check("abaixo da faixa, responde como o menor n medido", profBest(50, 1) === PROF_RUST ? 1 : 0);

// ── 5) interpola DENTRO da faixa ──────────────────────────────────────────
const meio: f64 = profGpuMs(1500);
check("interpola entre 1000 e 2000", meio > 0.73 && meio < 0.98 ? 1 : 0);

// ── 6) contagem de threads fora da tabela cai na medida mais proxima ──────
check("8 threads responde algo definido", profBest(2000, 8) !== PROF_DESCONHECIDO ? 1 : 0);

const faixa = profRange();
io.print("  faixa medida: n = " + faixa[0] + " .. " + faixa[1]);
check("a faixa e 250..8000", faixa[0] === 250 && faixa[1] === 8000 ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/nexga/Documents/GitHub/rts-game
../rts/target/release/rts.exe run tests/claude-test-backend-profile.ts
```

Esperado: `error: Parse(...)` ou `cannot resolve module "@engine/core/backend_profile"` — o módulo não existe.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/core/backend_profile.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════════════
// O PERFIL MEDIDO — qual backend de rígidos vence, por (n, threads).
//
// Substitui o modelo de custo que vivia em `physics_backend.ts`. Aquele media
// uma SONDA O(n²) escrita à mão e previa com ela um KERNEL que tem grid de 8192
// células — algoritmos diferentes. O coeficiente n² media ZERO porque o termo
// não existia no que estava sendo medido, e o joelho oscilava ±40% entre
// execuções do mesmo binário. Um decisor cuja resposta muda sem nada mudar não
// está medindo a máquina.
//
// Aqui não há coeficiente: há uma TABELA de medições reais, interpolada dentro
// da faixa e RECUSANDO fora dela.
//
// ── A MEDIÇÃO ──────────────────────────────────────────────────────────────
//
// 2026-09-20, release, RTX 2080 Ti, pool de rayon forçado por RAYON_NUM_THREADS.
// `bench/claude-bench-denso-gpu-rust.ts`, contato denso (espaçamento 0,6 sobre
// meia-extensão 0,5 — todo vizinho é contato), ms por PASSO SIMULADO.
//
// ── POR QUE A TABELA PARA EM 8000 ──────────────────────────────────────────
//
// Acima disso o bench mede um backend QUEBRADO: em 16000 e 32000 o corpo 0
// termina com `y` POSITIVO na GPU — ela não assentou, foi ejetada. O rodapé do
// próprio bench avisa que um backend que não simula é sempre o mais rápido.
// Suspeito nomeado: o grid da GPU tem 8192 buckets de 32 vagas
// (`gpurigid.ts`), e o que passa de 32 num bucket é contado e NÃO guardado —
// fica invisível para os vizinhos. Enquanto isso não for investigado, a faixa
// para onde a medição para.
// ═══════════════════════════════════════════════════════════════════════════

/// As respostas possíveis. `PROF_DESCONHECIDO` não é erro: é a recusa.
export const PROF_GPU = 1;
export const PROF_RUST = 2;
export const PROF_DESCONHECIDO = 0 - 1;

/// Os n medidos, em ordem crescente.
const PROF_NS: number[] = [250, 1000, 2000, 4000, 8000];
/// ms/passo da GPU em cada n de `PROF_NS`.
const PROF_GPU_MS: f64[] = [0.52, 0.73, 0.97, 1.63, 3.43];
/// As contagens de thread medidas, em ordem crescente.
const PROF_TS: number[] = [1, 2, 4, 16];
/// ms/passo do Rust: uma linha por contagem de thread, na ordem de `PROF_NS`.
const PROF_RUST_MS: f64[][] = [
  [0.142, 0.767, 1.867, 4.550, 10.383],   // 1 thread
  [0.100, 0.425, 0.975, 2.333, 5.300],    // 2 threads
  [0.067, 0.258, 0.550, 1.250, 2.750],    // 4 threads
  [0.042, 0.183, 0.308, 0.625, 1.417],    // 16 threads
];

/// A faixa de `n` em que há medição: `[nMin, nMax]`.
export function profRange(): number[] {
  return [PROF_NS[0], PROF_NS[PROF_NS.length - 1]];
}

/// O índice da linha de threads mais próxima (por baixo) de `threads`.
///
/// Por baixo e não a mais próxima: entre 4 e 16 medidos, uma máquina de 8
/// threads é tratada como 4. Subestimar o Rust erra para o lado seguro — no
/// máximo escolhe a GPU onde o Rust já serviria, e nunca o contrário.
function profLinha(threads: number): number {
  let k = 0;
  let i = 0;
  while (i < PROF_TS.length) {
    if (PROF_TS[i] <= threads) k = i;
    i = i + 1;
  }
  return k;
}

/// Interpola `vals` (alinhada a `PROF_NS`) no ponto `n`. `-1` acima da faixa;
/// abaixo dela, GRAMPEIA no primeiro ponto — ver o doc de `profBest`.
function profEm(vals: f64[], n: number): f64 {
  const ultimo = PROF_NS.length - 1;
  if (n > PROF_NS[ultimo]) return 0.0 - 1.0;
  if (n <= PROF_NS[0]) return vals[0];
  let i = 0;
  while (i < ultimo) {
    if (n <= PROF_NS[i + 1]) {
      const a: f64 = PROF_NS[i] * 1.0;
      const b: f64 = PROF_NS[i + 1] * 1.0;
      const t: f64 = (n * 1.0 - a) / (b - a);
      return vals[i] + (vals[i + 1] - vals[i]) * t;
    }
    i = i + 1;
  }
  return vals[ultimo];
}

/// ms por passo simulado da GPU a `n` corpos. `-1` = fora da faixa medida.
export function profGpuMs(n: number): f64 {
  return profEm(PROF_GPU_MS, n);
}

/// ms por passo simulado do Rust a `n` corpos com `threads` threads.
/// `-1` = fora da faixa medida.
export function profRustMs(n: number, threads: number): f64 {
  return profEm(PROF_RUST_MS[profLinha(threads)], n);
}

/// Quem vence em `(n, threads)`: `PROF_GPU`, `PROF_RUST` ou `PROF_DESCONHECIDO`.
///
/// ACIMA da faixa recusa, porque lá a medição mede um backend quebrado (ver o
/// cabeçalho). ABAIXO dela grampeia no menor n medido, e isso não é
/// extrapolação disfarçada: em 250 corpos o Rust vence com QUALQUER contagem de
/// thread, a curva é monótona, e cenas menores só aumentam essa vantagem.
///
/// No empate o RUST ganha — ele é determinístico bit a bit e não custa um frame
/// de latência, então empate de desempenho não é empate de propriedades.
export function profBest(n: number, threads: number): number {
  const g = profGpuMs(n);
  const r = profRustMs(n, threads);
  if (g < 0.0 || r < 0.0) return PROF_DESCONHECIDO;
  return r <= g ? PROF_RUST : PROF_GPU;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
../rts/target/release/rts.exe run tests/claude-test-backend-profile.ts
```

Esperado: `[resultado] 12 ok, 0 falhas` e `[PASSOU]`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/core/backend_profile.ts tests/claude-test-backend-profile.ts
git commit -m "feat(fisica): perfil MEDIDO de backend, com recusa fora da faixa

O modelo anterior media uma sonda O(n2) e previa com ela um kernel que tem
grid: o coeficiente n2 media zero por ruido e o joelho oscilava +-40% entre
execucoes do mesmo binario. Aqui nao ha coeficiente, ha medicao — e onde nao
ha medicao a resposta e a recusa.

Medido 2026-09-20, release, RTX 2080 Ti, pools de 1/2/4/16 threads via
RAYON_NUM_THREADS, bench/claude-bench-denso-gpu-rust.ts.

A tabela para em n=8000 de proposito: acima disso a GPU nao assenta (y do
corpo 0 fica positivo) e o bench mede um backend quebrado."
```

---

### Task 2: Disponibilidade real do backend Rust

**Files:**
- Modify: `src/engine/rigid/cpurigid.ts:66` (`crAvailable`)
- Test: `tests/claude-test-backend-profile.ts` (acrescentar bloco)

**Interfaces:**
- Consumes: `rigid.step` / `rigid.threads` de `@compat/rigid.ts`.
- Produces: `crAvailable(): number` — `1` só se o solver nativo **respondeu a um passo de verdade**.

- [ ] **Step 1: Write the failing test**

Acrescentar ao fim de `tests/claude-test-backend-profile.ts`, antes das duas linhas de `[resultado]`:

```ts
// ── 7) a disponibilidade do backend Rust e SONDADA, nao afirmada ──────────
//
// `crAvailable` devolvia `1` fixo. Isso e uma afirmacao, nao uma medida: o
// solver e uma feature opcional do motor (`physics` no rts-host) e rayon e
// thread de SO, que nao existe em wasm. Um `1` constante faz o padrao escolher
// um backend que pode nao estar la.
import { crAvailable, crThreads } from "@engine/rigid/cpurigid";
check("o backend Rust responde a sondagem", crAvailable() === 1 ? 1 : 0);
check("e a sondagem e idempotente", crAvailable() === 1 ? 1 : 0);
check("threads > 0 quando disponivel", crThreads() > 0 ? 1 : 0);
```

(O `import` sobe para o topo do arquivo junto com os demais; está aqui só para
mostrar de onde vêm os símbolos.)

- [ ] **Step 2: Run test to verify it fails**

```bash
../rts/target/release/rts.exe run tests/claude-test-backend-profile.ts
```

Esperado: PASSA — e é por isso que este teste sozinho não basta. Rode também a
verificação de que a sondagem realmente EXERCITA o solver: acrescente
temporariamente `io.print("sondas = " + crAvailable() + crAvailable());` e
confirme no Step 4 que o solver só é chamado uma vez (cache).

- [ ] **Step 3: Write minimal implementation**

Em `src/engine/rigid/cpurigid.ts`, substituir a linha 66:

```ts
export function crAvailable(): number { return 1; }
```

por:

```ts
/// 0 = ainda não sondado, 1 = respondeu, 2 = recusou.
let crSondado = 0;

/// O solver nativo está ali E RESPONDE?
///
/// Devolvia `1` fixo, e isso era uma afirmação e não uma medida. O solver é a
/// feature `physics` do `rts-host` e usa rayon, que é thread de SO — não existe
/// em wasm. Um `1` constante faz o decisor escolher um backend que pode não
/// estar presente.
///
/// A sondagem é um passo real sobre UM corpo: `rigid.step` devolve quantos
/// corpos moveu e `0` é a recusa documentada da superfície, então um `1` aqui
/// prova a travessia inteira — módulo carregado, buffers aceitos, solver rodou.
/// Cacheada: a resposta não muda durante o processo.
///
/// LIMITE DECLARADO: se o módulo `rts:rigid` não existir no build, o programa
/// falha no CARREGAMENTO (o import de `@compat/rigid.ts` é de topo), não aqui.
/// Isso é erro de configuração de build e aparece como tal.
export function crAvailable(): number {
  if (crSondado !== 0) return crSondado === 1 ? 1 : 0;
  const pos = new Float32Array(4);
  const vel = new Float32Array(4);
  const ext = new Float32Array(4);
  // um corpo em queda livre, sem estáticos, um sub-passo
  ext[3] = 1.0;                      // invMass
  const world = new Float32Array(MAT_AT + matBytesFor(1));
  world[0] = CR_DT;
  world[2] = 1.0;                    // tamanho de célula
  world[3] = 1.0;                    // sub-passos
  matFillDefaults(world, MAT_AT, 1);
  const moveu = rigid.step(pos, vel, ext, world);
  crSondado = moveu > 0 ? 1 : 2;
  return crSondado === 1 ? 1 : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
../rts/target/release/rts.exe run tests/claude-test-backend-profile.ts
../rts/target/release/rts.exe run tests/claude-test-cpurigid.ts
../rts/target/release/rts.exe run tests/claude-test-backend-rust.ts
```

Esperado: os três `[PASSOU]`. Remova o `io.print` temporário do Step 2.

- [ ] **Step 5: Commit**

```bash
git add src/engine/rigid/cpurigid.ts tests/claude-test-backend-profile.ts
git commit -m "fix(fisica): crAvailable sonda o solver em vez de afirmar 1

Devolvia 1 constante. O solver e feature opcional do motor e usa rayon, que
nao existe em wasm — o decisor podia escolher um backend ausente. A sondagem
e um passo real sobre um corpo: rigid.step devolve 0 na recusa, entao um 1
prova a travessia inteira."
```

---

### Task 3: A GPU detectada fora do calibrador

**Files:**
- Modify: `src/engine/core/physics_backend.ts:100` (`pbTemGpu`), `:144`, `:678-700` (`pbAlvo`)
- Test: `tests/claude-test-physics-backend.ts`

**Interfaces:**
- Consumes: `gpu.available()` de `@compat/gpu.ts`.
- Produces: `pbGpuPresente(): number` (privada ao módulo) — substitui as leituras de `pbTemGpu`.

- [ ] **Step 1: Write the failing test**

Em `tests/claude-test-physics-backend.ts`, substituir o bloco das linhas 60-71
(as três checagens do padrão) por:

```ts
// ── 1) a queda para a CPU nao depende do calibrador ────────────────────────
//
// `pbTemGpu = gpu.available()` era escrito SO dentro de `rigidCalibrate`, e
// `pbAlvo` o lia para decidir se havia placa. Remover o calibrador sem mover
// essa deteccao tiraria a queda para a CPU que o cabecalho deste modulo chama
// de "nao opcional".
rigidSetMode(1);
const assumiuGpu = rigidStep(sc, 0) !== 0 ? 1 : 0;
io.print("  modo gpu: assumiu=" + assumiuGpu + " nome=" + rigidBackendName());
check("pedir GPU nao lanca, com ou sem placa", 1);
check("sem placa, o nome EXPLICA a queda",
      assumiuGpu === 1 || rigidBackendName() !== "gpu" ? 1 : 0);
```

E remover das importações (linha 19) os símbolos que deixam de existir:
`rigidCalibrate`, `rigidBackendFor`, `rigidBand`. Remover as chamadas das
linhas 31 (`rigidCalibrate()`), 72 e 100 (`rigidBackendFor(24)` → trocar por
`rigidBackendName().indexOf("gpu") === 0 ? 1 : 0`), e 140-141 (o bloco de
`rigidBand`).

- [ ] **Step 2: Run test to verify it fails**

```bash
../rts/target/release/rts.exe run tests/claude-test-physics-backend.ts
```

Esperado: FALHA na resolução — `rigidCalibrate` ainda é importado em outros
pontos do arquivo, ou o teste referencia `rigidBand` removido. Corrija até o
erro ser só sobre símbolos que a Task 4 ainda não removeu.

- [ ] **Step 3: Write minimal implementation**

Em `src/engine/core/physics_backend.ts`, substituir a linha 100:

```ts
let pbTemGpu = 0;
```

por:

```ts
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
```

Em `pbAlvo` (linha 678), substituir o bloco:

```ts
  if (pbModo !== 1) return 0;
  rigidCalibrate();
  if (pbTemGpu === 0) {
```

por:

```ts
  if (pbModo !== 1) return 0;
  if (pbGpuPresente() === 0) {
```

- [ ] **Step 4: Run test to verify it passes**

```bash
../rts/target/release/rts.exe run tests/claude-test-physics-backend.ts
```

Esperado: `[PASSOU]`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/core/physics_backend.ts tests/claude-test-physics-backend.ts
git commit -m "refactor(fisica): deteccao de GPU sai de dentro do calibrador

pbTemGpu = gpu.available() era escrito so dentro de rigidCalibrate e lido por
pbAlvo. Apagar o calibrador sem mover isso tiraria a queda para a CPU que o
cabecalho chama de nao opcional."
```

---

### Task 4: Remover a calibração por sonda e ligar o perfil

**Files:**
- Modify: `src/engine/core/physics_backend.ts:94-295` (remoção), `:327` (padrão), `:678-700` (`pbAlvo`), `:763-799` (`rigidReport`)
- Modify: `src/editor/control/dispatch.ts:93-98`
- Test: `tests/claude-test-physics-backend.ts`

**Interfaces:**
- Consumes: `profBest`, `profGpuMs`, `profRustMs`, `profRange`, `PROF_GPU`, `PROF_RUST`, `PROF_DESCONHECIDO` (Task 1); `crAvailable`, `crThreads` (Task 2); `pbGpuPresente` (Task 3).
- Produces: `rigidSetMode(0|1|2|3)` — **`3` é novo e significa AUTO** (consulta o perfil); `rigidMode()` devolve o pedido; `rigidBackendName()` já existente.

- [ ] **Step 1: Write the failing test**

Acrescentar a `tests/claude-test-physics-backend.ts`, antes do `[resultado]`:

```ts
// ── 5) o modo AUTO consulta o perfil medido ───────────────────────────────
//
// O modo 3 e novo. O 2 continua sendo "Rust sempre" (escolha manual); o 3 diz
// "escolha por medicao", e e o que o editor usa por padrao.
rigidSetMode(3);
check("modo auto fica em 3", rigidMode() === 3 ? 1 : 0);
const nomeAuto = rigidBackendName();
io.print("  auto escolheu: " + nomeAuto + " (threads=" + crThreads() + ")");
check("auto escolhe rust ou gpu, nunca vazio", nomeAuto.length > 2 ? 1 : 0);
// Nesta maquina (>=16 threads) e nesta cena (24 corpos), o perfil diz Rust.
check("com muitas threads e cena pequena, auto = rust",
      crThreads() < 4 || nomeAuto.indexOf("rust") === 0 ? 1 : 0);
```

Trocar também a checagem do padrão (que hoje pina `rigidMode() === 1`) por:

```ts
check("o padrao e AUTO", rigidMode() === 3 ? 1 : 0);
```

**Nota:** esta checagem tem de rodar ANTES de qualquer `rigidSetMode` do
arquivo. Mova-a para logo depois da construção da cena.

- [ ] **Step 2: Run test to verify it fails**

```bash
../rts/target/release/rts.exe run tests/claude-test-physics-backend.ts
```

Esperado: FALHA — `[FALHOU] o padrao e AUTO` (o padrão ainda é 1) e
`[FALHOU] modo auto fica em 3` (`rigidSetMode` mapeia 3 para 0).

- [ ] **Step 3: Write minimal implementation**

**(a)** Em `physics_backend.ts`, **apagar** as linhas 94-295 inteiras — o bloco
`// ── calibração ──` até o fim de `rigidBand()`. Isso remove:
`pbCpuPerPair`, `pbGpuPerN2`, `pbGpuOverhead`, `pbCalibrado`, `PB_VIZINHOS`,
`PB_PASSES`, `pbSondaCpu`, `rigidCalibrate`, `rigidCpuCostMs`, `rigidGpuCostMs`,
`rigidBackendFor`, `rigidBand`. **Preservar `PB_SUBSTEPS`** (linha 112) movendo-o
para junto das demais constantes do runtime.

**(b)** Acrescentar o import no topo:

```ts
import { profBest, profGpuMs, profRustMs, profRange,
         PROF_RUST, PROF_DESCONHECIDO } from "./backend_profile";
```

**(c)** Substituir a linha 327 e seu bloco de doc por:

```ts
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
```

**(d)** Substituir `rigidSetMode` (linha 335):

```ts
export function rigidSetMode(modo: number): void {
  pbModo = modo === 1 ? 1 : (modo === 2 ? 2 : (modo === 3 ? 3 : 0));
  if (pbModo === 0) pbMotivo = "";
}
```

**(e)** Em `pbAlvo` (linha 678), inserir a resolução do AUTO logo antes do
`if (pbModo === 2)`:

```ts
  // AUTO: a medição escolhe. `pbBodies` é a contagem do último sync; no
  // primeiro frame ela é 0 e a escolha cai no Rust pelo desempate — que é o
  // certo, porque uma cena vazia não tem por que pagar um round-trip.
  let modo = pbModo;
  if (modo === 3) {
    if (crAvailable() === 0) modo = pbGpuPresente() !== 0 ? 1 : 0;
    else {
      const quem = profBest(pbBodies, crThreads());
      modo = quem === PROF_RUST || quem === PROF_DESCONHECIDO ? 2 : 1;
      if (modo === 1 && pbGpuPresente() === 0) modo = 2;
    }
  }
```

e trocar as três leituras seguintes de `pbModo` por `modo` (`if (modo === 2)`,
`if (modo !== 1) return 0;`).

**(f)** Substituir `rigidBackendName` para reconhecer o 3: acrescentar no topo
dela, antes de `if (pbModo === 0)`:

```ts
  if (pbModo === 3) {
    const quem = profBest(pbBodies, crThreads());
    if (quem === PROF_RUST || quem === PROF_DESCONHECIDO) {
      if (pbBodies === 0) return "rust (auto, aguardando corpos)";
      return "rust (auto, " + crThreads() + " threads)";
    }
    return "gpu (auto)";
  }
```

**(g)** Substituir `rigidReport` (linha 763) inteira por:

```ts
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
           " ativo=" + rigidBackendName());
}
```

**(h)** Em `src/editor/control/dispatch.ts`, substituir as linhas 93-98:

```ts
      if (alvo === "gpu") { rigidSetMode(1); return "[fisica] modo=gpu ativo=" + rigidBackendName(); }
      if (alvo === "cpu") { rigidSetMode(0); return "[fisica] modo=cpu ativo=" + rigidBackendName(); }
      if (alvo === "rust") { rigidSetMode(2); return "[fisica] modo=rust ativo=" + rigidBackendName(); }
      if (alvo === "auto") { rigidSetMode(3); return "[fisica] modo=auto ativo=" + rigidBackendName(); }
      if (alvo === "report") { rigidReport(); return "[fisica] relatorio impresso no stdout do editor"; }
```

e a linha de ajuda (98) para:

```ts
             " | use: fisica cpu | fisica gpu | fisica rust | fisica auto | fisica report";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
../rts/target/release/rts.exe run tests/claude-test-physics-backend.ts
for f in tests/*.ts; do echo "== $f"; ../rts/target/release/rts.exe run "$f" | tail -1; done
```

Esperado: os 28 arquivos (27 + o novo da Task 1) com `[PASSOU]`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/core/physics_backend.ts src/editor/control/dispatch.ts tests/claude-test-physics-backend.ts
git commit -m "feat(fisica): modo AUTO decide pelo perfil medido; padrao passa a ser AUTO

O modelo de custo por sonda sai (~200 linhas). O joelho depende de THREADS,
medido em 2026-09-20: 1 thread cruza em ~1000 corpos, 2 em ~2000, 4 em ~8000,
16 nao cruza na faixa. Fixar um backend seria certo nesta maquina e errado numa
de dois nucleos.

Fora da faixa medida o perfil recusa e o desempate vai para o Rust, que e
deterministico bit a bit e nao custa um frame de latencia.

dispatch: 'fisica auto' passa a significar auto de verdade; 'fisica rust'
e o novo nome do que antes se chamava auto."
```

---

### Task 5: Matar os números obsoletos

**Files:**
- Modify: `src/engine/core/scene.ts:1171,1174`
- Modify: `bench/claude-bench-computeworld.ts:8`
- Modify: `src/engine/core/physics_backend.ts:25-26` (cabeçalho)
- Test: nenhum (mudança de comentário); a verificação é a suíte continuar verde.

**Interfaces:** nenhuma — esta tarefa não muda comportamento.

- [ ] **Step 1: Medir antes de escrever**

```bash
cd /c/Users/nexga/Documents/GitHub/rts-game
../rts/target/release/rts.exe run bench/claude-bench-computeworld.ts
../rts/target/release/rts.exe run bench/claude-bench-lacoprep.ts
```

Anote os números. **Nenhum número entra em comentário sem vir desta rodada.**

- [ ] **Step 2: Corrigir `scene.ts`**

Em `src/engine/core/scene.ts`, no comentário do `cwSelo` (linhas 1171 e 1174),
substituir o trecho que diz "custa 14,20 ms a 8000 objetos" e
"14,20 para 12,98 ms, medido" por:

```
  // Medido 2026-09-20 (release): `computeWorld` custa 0,57 ms a 8000 objetos
  // numa cena onde NADA se move, e 0,81 ms com tudo movendo. O carimbo de frame
  // é parte de como chegou aqui.
  //
  // ESTE COMENTÁRIO DIZIA 14,20 ms, e era verdade quando foi escrito. As
  // otimizações que vieram depois — função livre tipada, espelho `trs`, o
  // carimbo, o fast path de raiz — o derrubaram ~17x e o texto não acompanhou.
  // Uma análise inteira de arquitetura foi construída em cima do número velho
  // antes de uma medição o desmentir. Se você mudar o custo aqui, mude o
  // número na mesma passada.
```

- [ ] **Step 3: Corrigir o cabeçalho do bench**

Em `bench/claude-bench-computeworld.ts`, linha 8, substituir
"estoura os 8 ms/frame sozinho entre 2000 e 4000 corpos, e a 8000 custa 14 ms"
por:

```
// `computeWorld` custava 14 ms a 8000 objetos quando esta bancada foi escrita.
// Medido 2026-09-20: 0,57 ms parados, 0,81 ms movendo. A bancada continua
// valendo — o que ela mede é ONDE o custo está, e isso não depende do total.
```

- [ ] **Step 4: Corrigir o cabeçalho do `physics_backend.ts`**

Nas linhas 25-26, substituir a medição de "500 objetos em movimento = 14,05
ms/frame de física" por:

```
//   500 corpos em movimento, medido 2026-09-20 (release):
//   solver TS 0,24 ms esparso / 6,97 ms denso; backend Rust 16t 0,08 ms denso.
//   O numero antigo desta linha (14,05 ms/frame) e de antes do backend nativo.
```

- [ ] **Step 5: Verificar e commitar**

```bash
for f in tests/*.ts; do ../rts/target/release/rts.exe run "$f" | tail -1; done
git add src/engine/core/scene.ts bench/claude-bench-computeworld.ts src/engine/core/physics_backend.ts
git commit -m "docs(fisica): matar os numeros de desempenho obsoletos

computeWorld nao custa 14,20 ms a 8000 objetos; custa 0,57. O numero era
verdadeiro quando escrito e as otimizacoes posteriores o derrubaram ~17x sem
o texto acompanhar — e uma analise de arquitetura inteira foi construida em
cima dele antes de uma medicao o desmentir.

Todos os numeros agora carregam a data e o regime da medicao."
```

---

### Task 6: A verificação de frame que vale

**Files:**
- Create: `scenes/bench-2000.json` (cena nomeada, reproduzível)
- Test: nenhum arquivo novo; o artefato é o número publicado.

**Interfaces:** nenhuma.

- [ ] **Step 1: Criar a cena de referência**

```bash
cd /c/Users/nexga/Documents/GitHub/rts-game
../rts/target/release/examples/ui_fixture.exe main.ts &
sleep 18
python tools/ws_client.py "clear" "spawn Chao 0 0 0 1 1" "scl 0 60 1 60"
python tools/ws_client.py "dupn 2000 0.6 0" "savescene scenes/bench-2000.json"
```

Se `dupn` não produzir 2000 corpos dinâmicos, use `spawn` + `addcomp Rigidbody`
num laço pelo `ws_client.py`. A cena precisa ter **2000 corpos acordados**.

- [ ] **Step 2: Medir com vsync DESLIGADO, antes da mudança**

```bash
git stash            # volta ao comportamento anterior
../rts/target/release/examples/ui_fixture.exe main.ts &
sleep 18
python tools/ws_client.py "loadscene scenes/bench-2000.json" "vsync 0" "play"
sleep 25            # prof.txt e reescrito a cada 300 frames
cat prof.txt
git stash pop
```

Com vsync ligado a diferença é invisível: `present` absorve 89,6% do frame por
construção. **Sem `vsync 0` este critério não vale.**

- [ ] **Step 3: Medir depois da mudança**

Repetir o Step 2 sem o `git stash`. Anotar a seção `fisica` do `prof.txt` nas
duas rodadas.

- [ ] **Step 4: Publicar**

```bash
git add scenes/bench-2000.json
git commit -m "bench: cena de 2000 corpos para medir o frame do editor

prof.txt, vsync 0, 1200 frames, secao 'fisica':
  antes  (padrao GPU):  X,XX ms
  depois (padrao AUTO): Y,YY ms

Com vsync ligado a diferenca e invisivel — present absorve 89,6% do frame."
```

Substitua X e Y pelos números medidos. **Um commit com os valores em branco é
uma falha desta tarefa.**

---

## Self-Review

**Cobertura do spec (§5 da revisão 2):**

| item do spec | tarefa |
|---|---|
| 1. Tabela medida substitui o modelo | Task 1 |
| 2. Detecção de GPU fora do calibrador | Task 3 |
| 3. Portão de disponibilidade do Rust | Task 2 |
| 4. Padrão condicionado ao perfil | Task 4 |
| 5. Corrigir teste e `dispatch.ts` | Tasks 3 e 4 |
| 6. Matar números obsoletos | Task 5 |
| Aceite com `vsync 0` e cena nomeada | Task 6 |
| Rollback (`rigidSetMode(1)`) | Task 4, preservado |

**Divergência deliberada do spec:** o spec dizia "padrão → Rust". Este plano
usa um **modo AUTO (3)** que consulta o perfil, porque a medição de threads
mostrou que "Rust sempre" é correto nesta máquina e errado numa de 1-2 núcleos.
`rigidSetMode(2)` continua existindo para fixar o Rust manualmente.

**Não coberto aqui, por ser outra fase:** os itens 7-11 (contratos: `Needs` com
raycast/overlap/contact_events, contrato de consulta, reserva de layout, replay
por `stepCount`, contrato de sistema com verificador). Eles tocam
`crates/rts-physics` e exigem rebuild do binário, e a §13 do spec os deixa
dependentes do alvo e da máquina-piso. **Ganham plano próprio depois que a
Fase 0 estiver verde.**
