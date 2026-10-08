# Teste pesado da cachoeira com assets Poly Haven

> Registro do teste anterior à otimização. O carregamento foi corrigido depois desta medição; veja [resultados e limites atuais](scene-loading-performance.md). As pendências de carregamento abaixo descrevem o estado anterior.

Teste local em 04/10/2026, `scenes/waterfall-polyhaven.json`, editor 1200 x 720. Runtime nativo debug, contrato validado pelo lock; execut?vel do editor recompilado. Resultado do editor completo, incluindo UI e apresenta??o, n?o um benchmark isolado da GPU.

## Conte?do e corre??es

66 objetos e 1.375.428 tri?ngulos de assets, al?m de terreno, ?gua e part?culas. Geometria integral dos modelos e pacote de texturas 1k. Rochas, pinheiros, samambaias e solo reais CC0: fontes e checksums em `assets/vendor/polyhaven/sources.json`. Importa??o reproduz?vel pelos dois scripts `tools/*polyhaven-waterfall.py`.

O shader opaco agora recorta alpha abaixo de 0,5, depois das amostragens que dependem de derivadas. A amostra de sombra ? reaproveitada. PNGs de folhagem combinam a cor original com a m?scara fornecida pelo asset. Captura de perto confirmou folhas recortadas, sem placas retangulares. Rochas usam escala uniforme; pinheiros foram ampliados na composi??o.

## Medi??es

- Primeira vista parada: mediana do intervalo 16,67 ms (~60 FPS); p99 17,15 ms, 120 quadros.
- Play, c?mera pr?xima (12,8,-24): m?dia 25,42 ms (~39 FPS), mediana 23,82 ms (~42 FPS), p99 34,72 ms, 120 quadros.
- Play, vista geral final (20,13,-36): m?dia 32,74 ms (~31 FPS), mediana 31,91 ms, p99 42,33 ms, 120 quadros. Profiler: render 3D 14,39 ms; UI 7,12 ms; se??o de f?sica/simula??o 7,04 ms, zero corpos f?sicos. Essa se??o n?o representa apenas colis?es.
- Gotas: 127/150 vivas; n?voa: 39/55 vivas na consulta.
- Zero assets com falha e zero exce??es ap?s entrar no Play.
- Abertura a frio at? a primeira captura: aproximadamente 205 segundos. A janela ficou sem responder durante grande parte da carga. A primeira tentativa encerrou normalmente ap?s dois quadros e n?o forneceu benchmark.
- Reabrir a cena na mesma sess?o aproveitou os caches e respondeu dentro do prazo de 10 segundos.

Essas amostras usam c?meras/estados diferentes; n?o s?o uma compara??o antes/depois nem uma promessa de FPS em outras m?quinas. A vista final ficou aberta em Play, com entrada f?sica liberada.

## Verifica??es

11 testes de contrato/static do editor passaram. `check-runtime` passou para ?gua, malhas, captura e HDR; `components:check` passou. Os 23 arquivos originais tiveram SHA-256 conferido; todos os 27 caminhos distintos usados na cena existem. Capturas em `build/polyhaven-first.png`, `polyhaven-foliage.png` e `polyhaven-overview.png`.

## Pend?ncias observadas

1. Integrar o carregador nativo de texturas em background e prepara??o de modelos ? abertura do editor. Existem opera??es ass?ncronas, mas este caminho ainda usa carga s?ncrona. N?o basta exibir uma barra.
2. Corrigir as faixas do shader da queda e melhorar espuma/n?voa. A ?gua ainda n?o tem apar?ncia final nem simula??o de preenchimento volum?trico.
3. Aplicar recorte alpha ?s sombras. O teste s? adiciona recorte ao passe opaco; transpar?ncia gradual e cutoff por material continuam pendentes.
4. Vegeta??o com instancing, LOD e distribui??o densa: esta cena usa GameObjects por primitiva, sem esses recursos.

Os assets reais melhoraram o detalhe, mas n?o tornam o conjunto fotorrealista por si s?. Ilumina??o, materiais, relevo e ?gua ainda precisam de acabamento.
