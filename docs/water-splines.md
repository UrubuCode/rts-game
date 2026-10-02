# Rios e lagos por curvas

No editor, use **Criar → Rio** ou **Criar → Lago**. Os presets adicionam
`Spline` e `WaterBody` ao mesmo GameObject. Ambos também estão no seletor
de componentes, na categoria Mundo.

Selecione o objeto e arraste as pequenas esferas da curva na vista de Cena.
O arrasto move o ponto no plano XZ, mantendo sua altura; um Desfazer restaura
o gesto inteiro. No Inspector de Spline, escolha `pointIndex` e ajuste X/Y/Z,
largura, profundidade e velocidade. Os botões inserem um ponto depois do
selecionado ou removem o selecionado. Desmarque `editPoints` para manipular
o objeto sem capturar seus pontos. A edição fica desativada durante o Play.

## Forma e corrente

`closed=false` define um rio: a curva passa pelos pontos e a largura forma
suas margens. A velocidade segue a tangente; valores negativos invertem a
corrente. A superfície interpola alturas e aceita declives suaves. Curvas
muito apertadas podem dobrar as margens; evite cruzar o rio sobre si mesmo.

`closed=true` define um lago. Seu nível e profundidade usam o primeiro ponto;
não há corrente no lago. Contornos côncavos simples são triangulados. Contornos
cruzados ou degenerados são recusados e mostram uma mensagem no Inspector.

`Spline.sample(t,out)` é independente de água: pode servir a estradas ou rotas.
O resultado contém `[x,y,z,largura,profundidade,velocidade]`. A posição usa
Catmull-Rom; os demais valores usam interpolação linear. São aceitos de 2 a 64
pontos, armazenados no campo `points` e preservados em cena, cópia e Play.
Os pontos são locais; nesta etapa, os componentes usam apenas translação:
mantenha rotação zero e escala 1 no objeto e ancestrais.

`WaterBody.sample(worldX,worldZ,out)` entrega nível, profundidade e velocidade
XZ dentro da água. `waterHeightAt` acrescenta as mesmas ondas do shader.
O componente Buoyancy usa essa consulta para empuxo e arrasto relativo à
corrente. Isso transporta corpos sem simular todo o volume do líquido.

## Terreno e prévia

Em WaterBody, `previewBed` mostra linhas de profundidade. Informe em
`terrainObject` o nome de um objeto com Terrain e clique em **Escavar Terrain**.
O botão reduz as alturas dentro da região da água, sem elevar terreno existente;
repetir a operação não aprofunda o leito novamente. Desfazer restaura o heightmap.

A prévia é um guia de profundidade, não uma cópia temporária do terreno.
A escavação usa a resolução atual do Terrain; resoluções baixas produzem
margens angulares. Mover a curva depois não restaura automaticamente o leito
antigo: desfaça a escavação anterior antes de aplicar a nova.

## Desenho, cache e limites

O pipeline de água aceita malhas persistentes além da grade retangular.
Refração, espuma, ondas e SSR são compartilhados com WaterSurface. O fluxo
por vértice desloca as pequenas ondulações do material.

A geometria é separada em trechos por células de 32 unidades. O frustum
descarta trechos fora da vista; no máximo um novo trecho por chamada de desenho
é enviado à GPU. As malhas ficam em cache ao girar a câmera e são liberadas
ao editar a curva, remover o componente ou limpar a cena. A CPU mantém os
dados da curva e dos trechos; não há reconstrução no quadro estável.

Essa divisão pertence ao WaterBody autorado. Ainda não usa workers nem o
orçamento/LRU do WorldStream: reconstruir a curva acontece na thread principal.
Não é, portanto, um gerador de rios infinitos. O limite global do passe continua
em 128 superfícies por quadro, incluindo os trechos e outras WaterSurfaces.
Rios e lagos podem se encontrar visualmente, mas não há união automática de
malhas, conservação de vazão, enchimento, barragens ou cascatas físicas.

A flutuação permanece vertical, sem torque de barcos. SSR ainda depende dos
objetos visíveis na câmera. Esses limites não foram alterados por esta ferramenta.

## Demonstração e validação

```powershell
.\run-pbr.ps1 -Scene water_spline -RuntimePath ..\rts-pbr -TargetPath ..\pbr-target
```

A demo mostra um rio curvo, lago, leito e caixa transportada pela corrente.
WASD, mouse direito e Q/E controlam a câmera; Esc ou X encerram.

Testes: `water-spline.ts` verifica forma, corrente, escavação idempotente,
serialização, translação e rejeição de contornos cruzados.
`water-spline-editor.ts` verifica seleção, arrasto, Desfazer/Refazer e restauração
do terreno. `water-spline-gc.ts` exercita 200 mil iterações estáveis, sem coletas
entre marcadores. Os testes nativos incluem pixels da malha personalizada e
recusa de identificadores inválidos. O editor foi executado com término automático.

`water-spline-gpu.ts` confirma upload, reutilização das malhas ao girar a câmera,
invalidação depois da edição e liberação idempotente. Os 36 testes nativos,
16 testes do gerador de componentes, PlayMode e regressão de Buoyancy passaram.

O benchmark mediu 300 quadros após 60 de aquecimento, em debug, 1280×800,
VSync desligado. A água ligada teve média de 3,462 ms e zero GC. A comparação
desligada registrou 6,936 ms, mas a carga da máquina foi 98,6%, contra 30,8%
na ligada; por isso esses números não permitem estimar o custo incremental.
