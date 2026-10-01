# Carregamento assíncrono de cenas

`SceneLoadOperation` lê e valida o JSON em um worker real, separado da thread que desenha a janela. Entrega blocos por demanda, cria objetos em uma cena temporária e só publica `result` quando a carga termina. A cena atual continua disponível durante a operação; o jogo escolhe quando trocar.

```ts
import { loadSceneAsync } from "@editor/sceneio";
const loading = loadSceneAsync("assets/minha-cena.json");

// Dentro do loop normal, depois de pump/beginFrame:
loading.tick(3); // orçamento cooperativo em milissegundos
// Desenhe sua própria UI usando loading.progress, state, completed e total.
if (loading.state === "ready") {
  // loading.result contém a Scene completa. Faça a troca aqui.
}
if (loading.state === "failed") {
  // Mostre loading.error; a cena anterior não foi substituída.
}
// Ao fechar/cancelar: loading.cancel().
```

O adaptador acima reutiliza a fábrica de objetos da serialização existente. Para jogos que não importam módulos do editor, use `SceneLoadOperation` de `@engine/core/scene_loading` com uma fábrica `(descriptor) => GameObject` própria. Não há UI embutida no carregador. O exemplo `examples/pbr_loading.ts` demonstra uma barra, texto e um indicador que continua se movendo durante a carga.

```powershell
.\run-pbr.ps1 -Scene loading
```

## Progresso e cancelamento

- `state`: reading, creating, activating, ready, failed ou cancelled.
- `progress`: fração monotônica de trabalho (0–1), com pesos por etapa; não é estimativa de tempo restante.
- `completed` / `total`: objetos criados / objetos esperados.
- `result`: null até terminar, depois a cena completa.
- `lastStepMs` / `maxStepMs`: custo observado de `tick`, útil para localizar callbacks pesados.
- `cancel()`: cancela a publicação, descarta a cena temporária e sinaliza o worker.

O worker lê o arquivo e faz o parse/validação inicial; os objetos chegam em blocos de até 16 descritores. Só existe um pedido de bloco em voo. Arquivos são limitados a 64 MiB, cenas a 100 mil objetos e cada descritor serializado a 1 MiB. Hierarquias cíclicas ou pais inválidos são rejeitados antes de criar objetos. Erros de leitura, parse, fábrica e montagem resultam em `failed`, sem publicar uma cena parcial.

Cancelamento é cooperativo: uma leitura de disco ou um JSON.parse já iniciado no worker não é interrompido no meio. O worker verifica a sinalização entre fases e no protocolo de blocos. O carregador usa a implementação real de workers do runtime; não usa `fs.readFile` com callback, que neste checkout ainda lê sincronamente.

## O que ainda pode causar pausas

O orçamento de `tick` é cooperativo: verifica o tempo entre objetos e chamadas de `mount`. Uma função de criação, um componente com `mount` pesado, a finalização de transforms ou um upload GPU individual não pode ser interrompido por esse orçamento. A fábrica antiga ainda pode carregar um modelo GLB/OBJ de forma síncrona. Portanto, esta entrega tira I/O e parse do JSON da thread principal, mas não promete que qualquer cena com assets arbitrários nunca trave. Preparação de modelos/texturas em workers e uploads divididos por recurso são a próxima etapa.

A cidade procedural (`-Scene city`) agora mostra progresso e processa eventos entre etapas de construção. Essa montagem é cooperativa na thread principal; não se confunde com o worker de leitura de cenas serializadas. A UI também permite cancelar com Esc durante essas etapas.

## Medição realizada

Runtime debug local, NVIDIA RTX 2080 Ti, VSync ligado, cena de 900 objetos:

- Compilação do grafo TypeScript antes da abertura: **2,915 s**.
- Carga + execução dos 10 quadros finais da demonstração: **2,21 s**, 133 quadros ao todo.
- Maior `tick`: **3,40 ms**, orçamento solicitado de 3 ms.

Esses números são de uma execução, não um benchmark de release. Log: `build/pbr-loading.log` e `build/pbr-loading.stderr.log`. Defina `RTS_LOAD_TIMING=1` para o runtime de demonstração imprimir o custo de `compile_graph`; uma barra do jogo não pode mostrar progresso antes de o código do jogo começar a executar.

`tests/scene-loading.ts` valida operação em vários ticks, progresso monotônico, resultado completo, cancelamento, arquivo ausente, falha da fábrica e hierarquia cíclica. `tools/create-loading-scene.mjs` regenera a cena de demonstração com 900 prédios.
