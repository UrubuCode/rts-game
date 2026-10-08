# Desempenho do editor de rios

Medição local de 03/10/2026, runtime de desenvolvimento, janela 1200x720,
cena `scenes/river-lab.json`, Rio selecionado, fora do Play,
câmera `0 59 -68 0 -0.70`. Não representa desempenho do jogo distribuído.

O Inspector procurava os índices dos campos por reflexão em cada quadro,
inclusive para controles fora da rolagem. Agora retém o índice por componente,
nome e posição de controle, e pula a consulta dos campos invisíveis.
Trocar a instância (seleção, Undo) ou o nome do campo invalida o cache.

Cada ponto da Spline desenhava uma esfera com 72 segmentos. Agora usa um
losango de quatro segmentos e raio constante de quatro pixels, preservando
a distinção de cor do ponto selecionado e a seleção/edição existentes.

| Medição | Antes | Depois |
|---|---:|---:|
| Trabalho mediano, últimos 120 quadros | 82,70 ms | 17,24 ms |
| Intervalo mediano entre quadros | 82,79 ms | 17,31 ms |
| FPS da média do profiler | 12 | 55 |
| Inspector, média do profiler | 32,47 ms | 5,91 ms |
| Seção render 3D, incluindo coleta dos gizmos | 47,75 ms | 8,24 ms |

O teste `tests/river-editor-perf.ts` verifica cache, troca de componente/campo,
layout fora da rolagem e projeção/ocultação dos marcadores. A sonda de 200 mil
iterações terminou sem coleta entre `RIVER_EDITOR_GC_BEGIN` e
`RIVER_EDITOR_GC_END` com `RTS_GC_DEBUG=1`.

Também passaram compilação do editor, 17 testes de geração de componentes,
`components:check` e `check:params`. O benchmark padrão do editor (120 quadros,
30 de aquecimento, VSync desligado) mediu 3,85 → 3,31 ms e zero GC em ambos.
A carga total da máquina variou de 43% para 37%; esse benchmark curto serve
como verificação auxiliar, não como ganho garantido. A comparação relevante
para esta correção é a cena do rio selecionado acima.
