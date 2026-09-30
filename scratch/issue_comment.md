### Complemento Arquitetural: Reserva Virtual Contígua com Commit Sob Demanda

Analisando a arquitetura interna do `crates/rts-core/src/heap/region/mod.rs`, compreende-se por que a base é fixa: o backend do Cranelift emite o endereço `base` como uma constante imediata nas instruções de máquina para que todo acesso a slots seja resolvido em apenas duas instruções:

$$\text{endereço} = \text{base} + (\text{índice} \times \text{stride})$$

Um `realloc` tradicional moveria a base, invalidando o código de máquina já emitido. No entanto, é plenamente viável aumentar ou dinamizar esse limite sem abrir mão da base imediata nem gastar RAM física desnecessária, utilizando o modelo adotado por runtimes modernos de WebAssembly (Wasmtime/V8):

1. **Reserva Virtual Ampla (Over-reserving no Espaço de Endereçamento de 64-bit):**
   - No Windows (`VirtualAlloc` com `MEM_RESERVE`) e no Linux (`mmap` com `PROT_NONE`), uma faixa contígua de espaço de endereçamento virtual de 512 MB a 2 GB (ex.: 8M a 32M de células) pode ser reservada pagando **zero bytes de RAM física**.
   - O endereço `base` permanece estritamente fixo e contíguo.
   - O `growth.rs` da região continua fazendo o *commit* físico (`MEM_COMMIT` / `mprotect`) apenas das páginas que a aplicação de fato atingir à medida que aloca.
   - O teto deixa de causar aborto prematuro com míseros ~16 MB de células úteis quando o sistema operacional possui gigabytes de memória livre.

2. **Parâmetro Configurável de Inicialização:**
   - Como alternativa ou complemento, permitir configurar o teto da reserva virtual na inicialização da VM via argumento de CLI (ex.: `rts run --max-cells 4194304` ou `--heap-size-mb 256`) ou variável de ambiente (`RTS_MAX_CELLS`), permitindo que suítes de benchmark com dezenas de milhares de entidades rodem sem atrito.
