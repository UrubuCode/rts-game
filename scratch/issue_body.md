## O que se vê

Ao executar benchmarks pesados ou pipelines sintéticos que instanciam e processam múltiplas cenas sucessivas (por exemplo, 7 cenários sucessivos com 2.000 `GameObject`s cada em `bench/claude-bench-consultas-grid.ts` no `rts-game`), a VM do RTS aborta com esgotamento completo de heap:

```text
rts: heap exhausted — the region grew to its whole reservation of 524288 cells and all of them are in use even after a collection.
     Nothing left to reclaim, and the program cannot continue.
     What would have happened instead is `undefined` from the allocation, which computes a wrong answer quietly.
```

O limite estático atual de **524.288 células** alocado na inicialização da VM restringe o envelope de memória a uma faixa muito estreita (~16 a 32 MB de objetos/células úteis). Em cenários de teste/benchmark contínuo no escopo de módulo, a pressão de retenção temporária combinada com o teto rígido impede que suítes extensas rodem até o final sem intervenções extremas de descarte manual ou sub-alocação agressiva.

## Como outros runtimes (ex.: Node.js / V8) tratam isso

- **Heap Dinâmica:** Runtimes como o Node.js/V8 iniciam com uma heap pequena e a expandem dinamicamente sob demanda conforme a carga (`--max-old-space-size` padrão de 1.4 GB a 4 GB em sistemas de 64-bit), em vez de uma reserva fixa que causa pânico irreversível ao atingir 512k células.
- **GC Geracional (Young Generation / Scavenger):** Objetos de vida curta criados durante a execução de cada cenário ou passo de aquecimento são limpos em ciclos rápidos menores (nursery/Eden) antes de serem promovidos para a geração antiga.
- **Descarte de Temporários em Nível de Script:** Expressões avaliadas em sequência no escopo do módulo têm seus registradores/temporários reciclados com análise de *liveness*, liberando a memória assim que a função consumidora retorna.

## Caso de Reprodução

Um script de módulo contendo múltiplas inicializações consecutivas de cenas com estruturas de dados paralelas (como grafos de GameObjects, buffers de consulta espacial ou nós DOM) atinge o teto de 524.288 células:

```ts
import { Scene } from "./src/engine/core/scene";
import { GameObject } from "./src/engine/core/gameobject";

// 7 cenários representativos de 2.000 corpos com seus respectivos índices
for (let s = 0; s < 7; s++) {
  const sc = new Scene("Cena_" + s);
  for (let i = 0; i < 2000; i++) {
    const go = new GameObject("obj_" + i);
    sc.add(go);
  }
  sc.computeWorld();
  // processa / executa consultas...
}
```

Ao atingir ~4 a 5 cenas acumuladas no fluxo do benchmark, mesmo com coleta disparada (`even after a collection`), o teto de 524.288 células é atingido e o processo é abortado.

## O que se propõe

1. Permitir que a reserva de células da heap seja **configurável via flag de linha de comando** (ex.: `--max-cells` ou `--heap-size-mb`) ou redimensionada dinamicamente quando a região enche e o sistema ainda possui memória física disponível.
2. Aperfeiçoar o sweep do GC e o reaproveitamento de slots temporários na pilha de execução do módulo raiz para permitir a liberação imediata de árvores de objetos descartadas entre passos de benchmark.
