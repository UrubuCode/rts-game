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
Importação e carimbo são operações pontuais síncronas, limitadas pelo tamanho
de imagem; ainda não são um pincel contínuo de arrastar o mouse no viewport.

## Rios e lagos

Adicione `Spline` e `WaterBody` ao mesmo objeto. `spline Rio set` configura
posição local, largura, profundidade e velocidade de cada ponto; `insert`
insere depois do índice e `remove` exclui. `closed on` forma um lago.
Configure `WaterBody.terrainObject` e execute `water Rio carve` para escavar.
`water Rio sample X Z` consulta altura, profundidade e corrente em espaço de mundo.
A conversão automática de uma máscara de rio em spline ainda não existe.

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
