# ProceduralWorld no GameObject

Crie um GameObject vazio, use **Adicionar componente → Mundo → ProceduralWorld**.
O componente é registrado pelo gerador normal e participa de salvar/carregar,
duplicação e Play/Stop. Requer o runtime PBR descrito em `render-pbr.md`.

Use rotação zero e escala um. A translação posiciona a origem do mundo.
A câmera da vista controla a região carregada; a prévia também funciona fora
do Play. Não coloque junto de outro renderer no mesmo objeto: cada GameObject
tem um renderer principal. `Terrain` continua sendo o heightfield finito;
este componente não converte automaticamente um Terrain em mundo por chunks.

## Personalização no Inspector

| Campo | Efeito |
| --- | --- |
| seed | Variação determinística do mundo |
| chunkRadius | Raio de 1 a 4 chunks; área ativa de 3×3 até 9×9 |
| memoryMiB | Orçamento de buffers de malha por mundo, de 16 a 512 MiB |
| treeDensity / grassDensity | Densidade de árvores / mato, de 0 a 1 |
| maxSlope | Inclinação máxima da vegetação, em graus |
| brushX / brushZ | Centro local do pincel |
| brushRadius / brushStrength | Raio em unidades e força de 0 a 1 |

**Abrir clareira** reduz a máscara; **Restaurar vegetação** aumenta até o padrão;
**Limpar máscara** remove toda a pintura. A esfera verde mostra a área selecionada.
É um pincel por coordenadas no Inspector, ainda sem arrastar o mouse na viewport.
As árvores e o mato usam a mesma máscara. São permitidas até 256 pinceladas;
a máscara é serializada como dados ocultos na cena, não como geometria.

A distribuição respeita também água, altura e inclinação. Uma máscara cheia
não obriga a nascer vegetação em locais proibidos. O mato atual usa triângulos
simples próximos da câmera, sem textura ou vento; as árvores são protótipos.
Modelos/prefabs por espécie e texturas próprias de solo ainda faltam.
Biomas, extensão voxel e parâmetros de relevo estão descritos em
[geração extensível](world-extensions.md).

## Streaming e ciclo de vida

O worker recebe seed, densidades e máscara; prepara terreno, edifícios,
vegetação e caixas estáticas. A thread principal recebe um pacote por tick.
Chunks completos são publicados juntos, e o cache reutiliza as malhas.
Pintar ou mudar configurações libera a região/cache atuais e inicia nova geração.
Invalidar somente chunks tocados pelo pincel ainda é uma otimização futura.

Remover componente/objeto, limpar a cena e alternar Play/Stop chama
`Behavior.releaseResources()`, que cancela o worker e libera os recursos.
O gancho é idempotente e permite recriar recursos ao voltar a desenhar objetos
restaurados. Desabilitar o componente libera na próxima chamada de desenho;
um objeto totalmente inativo pausa a prévia e pode reter o cache até remoção
ou reativação. Não há job gerando regiões continuamente enquanto ele está oculto.

As colisões geradas ainda pertencem ao controlador do mundo procedural;
não são colliders individuais integrados ao solver geral de Rigidbody.
Múltiplas vistas usam um único foco de streaming por componente.

## Execução e validação

`./run-pbr.ps1 -Scene world_component` abre uma cena que usa o componente pelo
renderizador padrão. WASD move, botão direito gira, Q/E muda altura e Esc fecha.
`-Frames 12` executa carga, pincelada, recarga e limpeza com encerramento automático.

`tests/procedural-world.ts` cobre catálogo, serialização, máscara, densidades,
mato e o gancho de liberação. `tests/procedural-world-frame-gc.ts` isola 200 mil
desenhos com chunks residentes substituídos por uma sonda, sem coletas entre
marcadores. Também foram validados os testes de PlayMode, reflexão, carregamento
de cena, worker, LOD e os 16 testes do gerador de componentes.

Comparação curta da cena padrão `jogo-vitrine` sem o novo componente, mesmo
runtime debug, 300 quadros após 60 de aquecimento: média 6,15 ms antes e
6,46 ms depois; CPU TS 5,42/5,70 ms; zero coletas em ambas. Carga média da
máquina 36,70%/34,38%. Uma execução por versão não é prova de ganho ou regressão.
