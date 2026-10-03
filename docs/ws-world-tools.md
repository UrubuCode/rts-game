# Mundo e relevo pela porta de controle

`doc json` e `contexto json` incluem os novos comandos. Objetos aceitam nome,
índice ou caminho da hierarquia. Use `doc spline`, `doc terrain`, `doc water`,
`doc world`, `doc boat` e `doc buoyancy` para as assinaturas completas.

Edição de spline, relevo, vegetação e escavação exige sair do Play. Usa o
histórico de Desfazer/Refazer e participa de `batch`. Consultas não criam
entradas no histórico. Controles do barco exigem Play e não participam de lote:
vela, leme, âncora e velocidade são estado de execução, restaurado por Stop.

## Exemplo: relevo por imagem

```text
addcomp Chao Terrain
addcomp Chao TerrainImageTool
setfield Chao TerrainImageTool imagePath assets/heightmaps/montanhas.png
setfield Chao TerrainImageTool minHeight -10
setfield Chao TerrainImageTool maxHeight 80
terrain Chao heightmap
```

No Inspector, `TerrainImageTool` tem seletor de imagem, alturas mínima/máxima
e botão de importação. Preto corresponde ao mínimo; branco ao máximo. A imagem
é reamostrada com interpolação bilinear para a resolução atual do Terrain.
O canto superior esquerdo corresponde a X/Z negativos; linhas crescem em +Z.
PNG 8-bit sem interlace, até 1024 pixels por eixo; escala de cinza, RGB, RGBA e
paleta. RGB vira luminância linear, sem correção sRGB; alpha multiplica a intensidade.
16-bit ainda não é suportado. O relevo aplicado fica salvo na cena.

O mesmo componente oferece carimbo por imagem: configure `centerX`, `centerZ`,
`radius` e `strength`, e use `terrain Chao stamp` ou **Carimbar pincel PNG**.
O carimbo ocupa um quadrado de lado `2 * radius`, em coordenadas locais.
Branco aplica toda a força, preto não altera, força negativa rebaixa. Não há
suavização adicional nas bordas: use um pincel que escureça nas bordas.
Para pintar arrastando, ative **Pintar na viewport** no Inspector do `TerrainImageTool`
ou use `terrain Chao paint on` (desative com `off`). O modo é temporário, não é
salvo na cena e não participa de lotes. Selecione o objeto
e arraste com o botão esquerdo sobre o relevo. A prévia acompanha a superfície;
cada gesto produz uma única entrada de Desfazer. O cursor parado não acumula
altura; os carimbos são espaçados pela distância percorrida, não pelo FPS.
A imagem fica em cache; **Recarregar pincel** relê o arquivo depois de alterá-lo.
O pintor interrompe o gesto na troca de seleção/Play e não pinta fora da viewport.
Use Terrain sem rotação, com escala 1. Importação, primeiro carregamento da imagem
e reconstrução da malha ainda são síncronos; não há leitura de PNG por quadro.
O trabalho de um quadro é limitado a 64 carimbos, com processamento do restante
enquanto o botão continuar pressionado. Movimentos muito longos seguidos de soltura
imediata podem encerrar o gesto antes de percorrer esse restante.

## Rios e lagos

Adicione `Spline` e `WaterBody` ao mesmo objeto. `spline Rio set` configura
posição local, largura, profundidade e velocidade de cada ponto; `insert`
insere depois do índice e `remove` exclui. `closed on` forma um lago.
Configure `WaterBody.terrainObject` e execute `water Rio carve` para escavar.
`water Rio sample X Z` consulta altura, profundidade e corrente em espaço de mundo.
## Converter uma máscara de rio

No objeto com `Spline`, adicione `RiverMaskTool`. Use PNG com **rio branco e
fundo preto**, um único caminho aberto. No Inspector, configure a imagem,
`sizeX/sizeZ` (área local representada pela máscara), alturas inicial/final,
largura, profundidade, velocidade e número de pontos (2–64).

```text
addcomp Rio RiverMaskTool
setfield Rio RiverMaskTool imagePath assets/heightmaps/rio.png
spline Rio trace
spline Rio applytrace
```

**Prever rio da máscara** / `trace` afinam a máscara e extraem a linha central;
a prévia aparece em amarelo e não modifica a spline. **Aplicar spline do rio** /
`applytrace` substituem os pontos com Desfazer. Alterar a configuração invalida
a prévia anterior. `reverse` inverte o percurso e, portanto, a direção da corrente.
Depois de aplicar, edite os pontos normalmente e use `water Rio carve` para o leito.

A análise usa uma grade de até 128×128. Máscaras muito detalhadas devem ser
simplificadas; o traçado não preserva detalhes menores que essa grade. Bifurcações,
ciclos, ilhas e trechos desconectados são recusados: separe os afluentes em rios
distintos. Largura e profundidade vêm dos parâmetros, não da espessura da máscara.
As alturas interpolam do início ao fim; não há busca automática de declive sobre
o Terrain. A primeira extremidade é escolhida em ordem de leitura da imagem.

Os controles de ponto da Spline usam `@nonSerialized` com `@showInInspector`:
aparecem no Inspector e no WS, mas não duplicam o estado temporário no arquivo
da cena. O registro gerado persiste somente a curva (`points` e `closed`).

## Diagnóstico e limites

- `world Mundo info`: geração iniciada ou não, fila, um trabalho em voo, progresso
  aproximado da janela atual, cache, memória, visibilidade e erros. Não inicia
  workers ao consultar. Não é um registro global de todos os carregamentos da engine.
- `world Mundo paint`: máscara de vegetação; intensidade negativa remove e positiva
  restaura. Não é pintura de textura do Terrain e não se aplica ao gerador voxel.
- `world Mundo regenerate`: descarta recursos e recomeça no próximo desenho,
  sem entrada de Desfazer; recusado em lote.
- `buoyancy Caixa info`: água encontrada, fração submersa estimada, corrente e corpo
  anexado. A física de flutuação atual continua apenas vertical.
- `terrain Chao info`: explicita que não há collider automático nem pintura de textura.

Após Desfazer, os objetos são reconstruídos; clientes devem consultar novamente
os índices. Erros de parâmetros e de leitura de PNG não alteram o relevo nem o histórico.

## Validação desta entrega

`npm run test:world` verifica a conclusão explícita dos testes, além do código
de saída do runtime. Cobre edição/rollback, Play/Stop, limites de parâmetros,
heightmap em tons de cinza, interpolação, carimbo e serialização do Terrain.
Também foram verificados catálogo, manifesto, compilação AOT do editor e conexão
WS real. No Inspector, um clique no carimbo elevou a amostra central de
8,7647058824 para 9,2029411765; Desfazer retornou ao valor anterior, sem exceções.

Na extensão de pintura contínua, o arrasto real via WS elevou a amostra local
`(0,5)` para `3,3084178024`: um Desfazer retornou a zero e Refazer recuperou
o relevo. A máscara de teste também virou Spline/WaterBody e escavou o Terrain;
a consulta retornou profundidade 2 e corrente em +Z, sem exceções do editor.
As sondas de memória e os benchmarks ficam em `tests/terrain-brush-gc.ts`,
`tests/test_terrain_drag.ts` (`RTS_BRUSH_GC=1`) e `bench/claude-frame-bench.mjs`.
As duas sondas completaram 200 mil iterações cada com `RTS_GC_DEBUG=1`, sem
coletas entre os marcadores: consulta/carimbo/prévia e arrasto com raio oblíquo.
No cenário padrão do editor, 300 quadros deram 10,616 ms antes e 3,555 ms depois,
ambos sem GC. A CPU total da máquina mudou de 98,34% para 25,73%; portanto essa
comparação é inconclusiva para ganho/regressão e não mede o custo de pintar um
terreno pesado. Os relatórios locais estão em `bench/out/brush-before.json` e
`bench/out/brush-after.json`.
