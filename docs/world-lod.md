# LOD do terreno e bairros

O worker gera duas representações por chunk e ambas ficam no cache. A troca
usa os mesmos handles; girar a câmera não reconstrói a geometria.

O terreno próximo tem 512 triângulos. O distante tem 112 (78,125% menos),
com células de 32 unidades trianguladas em leque. No contorno do chunk,
preserva cada amostra de 8 unidades: bordas coincidem entre vizinhos mesmo
quando usam níveis diferentes. Normais continuam amostradas no campo global.

Os prédios distantes compartilham um grupo de material por chunk, preservando
os volumes principais e removendo janelas, calçadas e detalhes dos telhados.
É um primeiro HLOD por bairro: não há agregação hierárquica entre chunks nem
captura de imagens impostoras. As árvores têm copa simplificada e tronco com
base prolongada para reduzir separação visual do terreno aproximado.

A distância ao centro do chunk ativa o nível distante acima de 190 unidades
e retorna ao próximo abaixo de 155. Isso evita oscilação, mas a troca ainda é
direta, sem morphing ou fade. A janela de streaming continua em 5 por 5 chunks;
esta etapa reduz geometria, ainda não amplia automaticamente o horizonte.
Colisões usam o campo original e as caixas originais, independentemente do LOD.

Os dois níveis consomem memória enquanto residentes. Não se deve interpretar
a redução de triângulos como redução igual de memória ou garantia de FPS.
O terreno ainda pode interceptar objetos em encostas devido à aproximação;
seleção por erro de tela e transições geométricas ficam para a próxima etapa.

## Validação

`tests/world-geometry-lod.ts` verifica contagem, orientação dos triângulos,
as quatro bordas nos dois níveis, vizinhos em coordenadas negativas/positivas
e preservação dos prédios no proxy. `tests/world-worker.ts` verifica pacotes
limitados, índices e cancelamento no worker real. O teste GPU de cache verifica
rotação, retorno, identidade dos handles e liberação completa ao fechar.

O primeiro ensaio GPU debug desta etapa registrou p95 de 26,56 ms, com captura
e geração em andamento. É validação funcional, não demonstra ganho de FPS.
Após a correção dos troncos, o teste passou novamente: p95 23,53 ms, pico
de buffers 3,86 MiB, três chunks reutilizados e nenhum gerado pela rotação.
