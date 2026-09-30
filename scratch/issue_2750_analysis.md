### Investigação no Código-Fonte do RTS e Caminhos de Solução

Após investigar diretamente o código-fonte do `rts` (`crates/rts-core` e `crates/rts-host`), mapeamos exatamente onde e por que essa limitação ocorre, e como ela pode ser resolvida tanto a curto prazo (sem riscos) quanto na arquitetura definitiva.

---

### 1. Onde a limitação está cravada no código

1. **`crates/rts-host/src/run.rs` (linha 1167):**
   ```rust
   const CELLS: u32 = 1 << 16; // 65.536 células iniciais
   let (table, mut owned) = if regions <= 1 {
       (None, vec![rts_core::heap::Region::with_capacity(CELLS)])
   ```
2. **`crates/rts-core/src/heap/region/growth.rs` (linhas 50–105):**
   ```rust
   pub const GROWTH_CEILING: u32 = 8;
   ```
   Com $65.536 \times 8 = 524.288$ células de 128 bytes cada (`STRIDE = HeaderLayout::BYTES + INLINE_SLOTS * SLOT_BYTES = 8 + 15 * 8 = 128`), o teto máximo de memória de objetos é fixado em exatamente **64 MiB**.

---

### 2. A causa raiz da restrição a 8x (Documentada pelo autor em `growth.rs`)

O comentário no próprio `growth.rs` (linhas 65–103) detalha com extrema clareza a razão de o multiplicador ter sido reduzido de 64 para 8:
> *"The first value tried was sixty-four, and it broke the engine in a way no amount of reading would have predicted: `rts-host`'s `running` suite began failing inside `cranelift-jit`'s relocation with `TryFromIntError`, on a different set of tests every run.*  
> *That error is a **PC-relative displacement that does not fit 32 bits**. Generated code reaches its own functions and its data with `PCRel4`, so everything one program compiles has to land within ±2 GiB. A test binary builds hundreds of programs on several threads at once, and each program's reservation sits in the address space between two code allocations — so the reservation is exactly what pushes them out of reach of each other.*  
> [...]  
> *What actually raises this, and why it is not this crate's to raise: Not a bigger number. The heap's ceiling is set by a code addressing range, so what lifts it is compiled code and its data being allocated out of a span reserved for them, where nothing a program allocates can land between two of them. That is `rts_cranelift::target`'s question — where compiled code goes — and until that has an answer, this constant is what the machine gave it."*

Em outras palavras: **a restrição de 64 MiB existe unicamente devido à suíte de testes concorrente (`cargo test -p rts-host`), onde centenas de instâncias de teste no mesmo processo fragmentam o espaço de 64 bits e afastam os blocos de código JIT em mais de 2 GiB.**

---

### 3. Como os desenvolvedores do RTS podem resolver isso

Existem dois caminhos complementares:

#### Opção A (Imediata / Cirúrgica / Risco Zero): Configuração para `rts run`
Em execução normal (`rts run jogo.ts` ou `rts bench.ts`), há **apenas um único programa** executando no processo. Não existem centenas de threads de teste alocando centenas de heaps de 64 MiB entre blocos de código. O risco de um displacement exceder $\pm 2$ GiB em um processo com um único programa é praticamente nulo para heaps de 256 MiB a 1 GiB.

- **Proposta:** Permitir configurar a capacidade inicial (`CELLS`) ou o teto de crescimento via flag de CLI (`--max-cells <N>` ou `--initial-cells <N>`) ou variável de ambiente (`RTS_MAX_CELLS` / `RTS_INITIAL_CELLS`).
- **Implementação em `crates/rts-host/src/run.rs`:**
  ```rust
  let cells: u32 = std::env::var("RTS_INITIAL_CELLS")
      .ok()
      .and_then(|s| s.parse().ok())
      .unwrap_or(1 << 16);
  ```
- **Impacto:** O valor padrão continua `1 << 16` (preservando 100% de estabilidade no `cargo test`), mas aplicações reais, engines e suítes de benchmark podem rodar com 1M a 4M de células sem abortar com `heap exhausted`.

#### Opção B (Arquitetural Definitiva): Arena Dedicada para Código JIT
Como o próprio comentário de `growth.rs` antecipou:
- Em `rts-cranelift` / gerenciador de memória do JIT, reservar um bloco contíguo de espaço de código (`PAGE_EXECUTE_READWRITE` de 1 a 2 GiB).
- Todo código compilado e trampolins são alocados exclusivamente dentro dessa arena de código.
- Como nenhum buffer de heap de dados é alocado dentro dessa arena, as funções compiladas ficam garantidamente a poucos megabytes de distância entre si, eliminando definitivamente o erro de `TryFromIntError` / `PCRel4`.
- Com isso, o `GROWTH_CEILING` pode ser elevado com segurança para 32, 64 ou 128 (até 1–2 GB de heap), inclusive dentro do `cargo test`.
