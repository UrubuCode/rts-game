# Carregamento da cena pesada

A abertura de `scenes/waterfall-polyhaven.json` foi medida em um processo novo: **4,35 segundos até responder ao comando de diagnóstico**, contra aproximadamente 205 segundos até a primeira captura no teste anterior. Os pontos finais das medições diferem ligeiramente; os números são locais, não uma garantia para outras máquinas.

## Alterações

- O build prepara um cache binário dos modelos glTF externos referenciados nas cenas. Mantém vértices, índices, materiais e raio de culling, sem simplificar a geometria.
- O carregador valida os arquivos originais e o buffer derivado por SHA-256. Cache ausente, incompatível ou obsoleto usa o importador existente. O próximo build recria os arquivos derivados.
- `SceneAssetLoadOperation` prepara os recursos antes do primeiro desenho. Usa até quatro workers nativos de textura e consome no máximo uma textura concluída por chamada a `tick()`.
- Texturas de cor e mapas PBR lineares ficam em caches separados. Normais, rugosidade e oclusão não passam pela conversão sRGB.
- A abertura inicial do editor exibe a tela de progresso e aceita Escape para cancelar a preparação.

## Evidências

As aberturas medidas registraram 2,77–2,82 segundos dentro da preparação e montagem da cena, com 66–69 quadros de carregamento. O teste de tempo externo registrou 4,352 segundos do início do processo até a primeira resposta de diagnóstico.

Os 13 modelos vieram do cache. A cena mantém 66 objetos e 1.375.428 triângulos nos assets, além de terreno e água. Nenhum asset faltando ou exceção foi registrado. A captura da tela de progresso mostrou 49% durante a preparação dos modelos; a captura da cena confirmou os materiais e o recorte da vegetação.

Revalidação em 07/10/2026: 3,066 segundos de preparação e montagem, 58 quadros de carga e maior passo de 190,8 ms. Os 14 testes passaram novamente; a cena abriu e entrou em Play sem assets faltando ou exceções. Essa medição interna não inclui todo o tempo de inicialização do processo.

Validação: 14 testes de cache, contrato do runtime e verificações estáticas do editor passaram; build do editor, `check-runtime`, `components:check` e `check:params` passaram. Os testes do cache cobrem geometria e índices, invalidação por alteração do buffer, reconstrução de arquivos derivados corrompidos e rejeição de índices inválidos.

## Limites

Ainda há trabalho síncrono: a leitura inicial do JSON, validação/upload de cada modelo e montagem final da cena. O maior passo medido foi de aproximadamente 164–173 ms; a montagem final levou cerca de 1,2 segundo. Portanto, a abertura ficou muito mais rápida, mas ainda não é inteiramente livre de pausas.

O preparo automático de geometria cobre glTF com buffer externo e atributos suportados. OBJ, GLB, recursos não suportados e modelos sem cache válido continuam pelo importador anterior. A integração de progresso descrita aqui é da abertura inicial do editor; não substitui todos os caminhos de troca de cena e importação durante a edição.

## Reproduzir

```powershell
npm run build:editor
$env:RTS_SCENE = 'scenes/waterfall-polyhaven.json'
./build/RTSEditor.exe
```

Os arquivos derivados ficam em `assets/runtime-cache/models/`, ignorados pelo Git e regenerados no build. O executável precisa desses arquivos para obter o mesmo ganho na importação de geometria. Logs locais: `build/loading-wall-time.json`, `build/loading-final.log` e `build/loading-tests.log`.
