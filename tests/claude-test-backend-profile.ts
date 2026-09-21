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
check("2 threads, 8000 corpos: a GPU ganha", profBest(8000, 2) === PROF_GPU ? 1 : 0);
check("4 threads, 8000 corpos: o Rust ganha", profBest(8000, 4) === PROF_RUST ? 1 : 0);

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

// ── 7) a disponibilidade do backend Rust e SONDADA, nao afirmada ──────────
import { crAvailable, crThreads } from "@engine/rigid/cpurigid";
check("o backend Rust responde a sondagem", crAvailable() === 1 ? 1 : 0);
check("e a sondagem e idempotente", crAvailable() === 1 ? 1 : 0);
check("threads > 0 quando disponivel", crThreads() > 0 ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
if (fail === 0) {
  io.print("[PASSOU]");
} else {
  io.print("[FALHOU]");
}
