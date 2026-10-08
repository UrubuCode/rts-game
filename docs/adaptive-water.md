# Água adaptativa por volume

O componente AdaptiveWater complementa WaterBody (rios por spline). Uma fonte acrescenta volume sobre uma grade que amostra o Terrain. Diferenças entre os níveis livres transportam água para células vizinhas: ela acumula nas depressões e ultrapassa barreiras quando o nível sobe.

## Uso no editor

Abra scenes/adaptive-river-lab.json no executável build/RTSEditor-adaptive-water.exe. Selecione **Adaptive river**. O componente aparece na categoria Mundo do catálogo.

- terrainObject: nome do objeto que contém o Terrain.
- size: lado da região simulada em metros, centrada no GameObject da água.
- resolution: células por lado, padrão 8, intervalo 4–32. Terreno e água usam translação, rotação zero e escala 1.
- sourceX/sourceZ: posição local da fonte. O gizmo azul mostra a fonte sobre o leito; ainda não há lançamento a partir de uma altura Y.
- sourceRate: vazão em m³/s. Zero desliga a fonte e deixa o volume existente se redistribuir.
- **Simular 1 segundo**: avança vinte passos e guarda esse estado na cena. É uma operação explícita de autoria, com Desfazer; pode demorar em resoluções maiores.
- **Guardar snapshot e congelar**: salva o estado atual e desliga a simulação. As ondas do shader continuam animadas.
- dynamic: ligue depois do snapshot para retomar a partir do estado salvo.
- **Reiniciar e reler Terrain**: apaga o estado salvo, esvazia a água e amostra novamente o relevo.

Salve a cena após preparar o estado. O snapshot fica no campo oculto bakedState e não exige arquivo externo. Play usa uma cópia independente. Parar restaura a autoria. Alterações feitas só durante Play não substituem o snapshot original.

## Conteúdo do snapshot

Versão do formato, resolução, tamanho de célula, leito completo, profundidade, velocidade horizontal estimada e tempo simulado. A restauração valida todos os valores antes de modificar o estado. Mudanças no leito ou nas dimensões recusam o cache. A fonte e o modo dinâmico ficam nos campos do componente. O leito é local: mover conjuntamente terreno e água preserva a forma.

No modo congelado, o carregamento decodifica o snapshot e cria uma malha uma vez. Não repete a formação do rio. Recursos GPU são temporários da janela e não são gravados no snapshot.

## Modelo e limites

É um transporte conservativo de colunas por diferença de nível, com gravidade e limitadores de volume. Não é uma solução completa das equações de águas rasas: não integra momento/inércia e a velocidade é uma estimativa do volume transportado. Não representa partículas, cavernas, túneis, jatos verticais, cachoeiras volumétricas ou pressão 3D.

As bordas são fechadas. Uma fonte contínua continua enchendo até o limite de capacidade; não há saída automática para fora da grade. Obstáculos são alturas do Terrain, não colliders nem objetos móveis. Depois de esculpir ou mover o terreno em uma sessão inicializada, use Reiniciar: o leito não é reamostrado por quadro.

A malha tem um quadrilátero por célula molhada; margens e desníveis são discretos. A atualização visual ocorre no máximo a cada 0,2 s. O upload ainda recria o buffer GPU, liberando o anterior após o frame. Próximos passos de desempenho: atualizar buffers nativos e transportar o cálculo para kernel/worker. **Não há worker nesta implementação.**

Passo fixo de 0,05 s (até 20 Hz), no máximo um passo por frame. Quadros longos descartam atraso: abaixo de 20 FPS a simulação anda mais devagar, sem tentar recuperar vários passos. A fonte acrescenta volume conforme o tempo realmente simulado.

Buoyancy consulta nível e corrente estimada; SailboatController consulta a superfície. Isso não adiciona deslocamento físico do líquido pela embarcação.

## Validação em 08/10/2026

- Teste numérico: conservação, fonte contínua, expansão, barreira, transbordamento, declive, retomada determinística, snapshot incompatível e restauração atômica.
- Editor: snapshot na cena, congelamento, cópia de Play, Stop, Desfazer/Refazer, invalidação por mudança do leito, vazão consistente em 40/100 FPS e limite de catch-up.
- GPU: upload, reutilização da malha congelada, alteração de volume, descarte e restauração.
- Regressões: WaterSurface, rios por spline e SailboatController passaram. Sondas de água e Buoyancy: 200 mil iterações, zero GC.
- Sonda do componente: 200 mil atualizações/consultas, nenhuma coleta entre os marcadores; não inclui reconstrução/upload da malha.
- Executável, 100 passos após aquecimento: 8×8 = 1,97 ms/passo; 16×16 = 8,91 ms; 32×32 = 34,70 ms. Uma execução local, sem custo gráfico. Grades grandes ainda são caras.
- Quadro do editor sem AdaptiveWater na cena: antes 3,011 ms (CPU 2,110), depois 3,526 ms (CPU 2,372), ambos zero GC. Carga da máquina: 15,8% → 35,5%. Uma amostra não isola regressão ou ganho; a cena com água precisa de orçamento separado.

Testes via node tools/rts-run.mjs: tests/adaptive-water.ts, tests/adaptive-water-editor.ts, tests/adaptive-water-gpu.ts, tests/adaptive-water-gc.ts, tests/adaptive-water-component-gc.ts e tests/adaptive-water-bench.ts. Ative RTS_GC_DEBUG=1 nas sondas. Compile com node tools/rts-build.mjs main.ts build/RTSEditor-adaptive-water.exe.
