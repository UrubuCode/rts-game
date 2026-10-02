# Água: superfície e partículas

`WaterSurface` é um componente da engine, disponível na categoria
**Renderização** do seletor do editor. Salvar a cena, duplicar e entrar/sair
do Play preservam os parâmetros; o relógio da animação é transitório.

## Demonstração

```powershell
.\run-pbr.ps1 -Scene water
```

Na worktree de desenvolvimento, indique os diretórios compartilhados:

```powershell
.\run-pbr.ps1 -Scene water -RuntimePath ..\rts-pbr -TargetPath ..\pbr-target
```

WASD move a câmera; mouse direito gira; Q/E alteram altura; Shift acelera;
R restaura a câmera; Esc ou X encerram. `-Frames 12 -Capture build/water.ppm`
captura a cena e termina automaticamente. O runtime precisa do patch
`patches/render-pbr-runtime.patch`, atualizado nesta entrega, sobre a mesma
base descrita em [render-pbr.md](render-pbr.md).

## Configuração

Adicione `WaterSurface` a um GameObject vazio e ajuste sua posição para o
nível da água. A superfície é horizontal, no plano XZ; use `width` e `length`
para dimensões, com rotação zero e escala 1 no objeto e seus ancestrais.
Coloque o leito e as margens como geometria opaca na mesma cena.

| Campo | Efeito |
|---|---|
| `width`, `length` | Extensão horizontal |
| `waveAmplitude`, `wavelength`, `waveSpeed` | Altura, comprimento e velocidade das ondas |
| `red`, `green`, `blue` | Cor linear da água profunda |
| `absorption` | Rapidez com que a profundidade oculta o fundo |
| `opacity` | Intensidade da cor absorvida; o reflexo continua independente |
| `refraction` | Deslocamento máximo de amostragem, em pixels |
| `foamWidth` | Faixa de espuma próxima de interseções com o cenário |
| `resolution` | Subdivisões por eixo, entre 8 e 128; padrão 64 |

`heightAt(worldX, worldZ)` consulta as mesmas ondas usadas na GPU, após
atualizar os transforms mundiais da cena. Serve de base para interação;
não aplica forças nem verifica se a coordenada está dentro do retângulo.

## Renderização

O vertex shader gera a grade e desloca seus vértices; não há reconstrução
de malha nem upload de vértices a cada quadro. O passe copia cor HDR e depth
da cena opaca, calcula absorção pela profundidade, distorce a amostra do
fundo, mistura reflexão do céu procedural por Fresnel e desenha espuma nas
interseções. A amostragem é limitada ao viewport da câmera. Partículas são
desenhadas depois. Sem água enfileirada não há esse passe/cópias, e suas
texturas temporárias são liberadas.

Há um teto de 32 superfícies por quadro. Superfícies sobrepostas não compõem
refração entre si; projete regiões sem sobreposição. Os alvos temporários
usam aproximadamente 12 bytes por pixel (cor HDR + depth), além dos alvos
já existentes do renderer.

Ainda não inclui reflexos dos prédios/árvores, reflexão de panorama HDR,
cáusticas, câmera submersa, ondas de impacto, flutuação ou correntes fluviais.
Também não substitui automaticamente a água estática dos geradores por
chunks. Essa integração, com recorte, LOD e fase compartilhada entre chunks,
é uma etapa separada. Esta entrega é a primeira superfície visual reutilizável.

## Correção das partículas GPU

`drawWaterGPU(win, buffer, count, radius)` volta a acessar o pipeline nativo
existente. A API `rts:egui.drawWater` foi restaurada com opções reutilizadas;
o buffer de compute é usado diretamente como vertex buffer, sem readback por
partícula. Contagem acima da capacidade, raio inválido e buffer sem uso de
vértice são recusados. O wrapper antigo deixa de lançar incondicionalmente.

O visual desse caminho continua sendo partículas esféricas; não reconstrói
uma superfície contínua de líquido. O pipeline legado compartilha o raio do
primeiro lote entre os lotes do quadro: use raio uniforme. A simulação SPH
existente não foi reescrita nesta entrega.

## Validação

- 36 testes nativos de scene3d passaram na RTX 2080 Ti/DX12, incluindo
  comparação de pixels de água desligada/ligada, ondas em tempos diferentes,
  refração, ausência de resíduos após remoção e desenho de partículas GPU.
- `tests/water-surface.ts`: catálogo, serialização, limites, equações de
  altura, pausa da animação e Play/Stop.
- `tests/water-gpu-api.ts`: janela de três quadros, buffer real de compute,
  limites de contagem/raio e encerramento automático.
- `tests/test_gpufluid.ts`: 9 verificações passaram no solver GPU existente.
- `tests/water-frame-gc.ts`: 200 mil updates e chamadas do componente com
  janela nula, zero coletas entre marcadores. Não mede alocações do driver.
- Testes do gerador de componentes, catálogo e verificação de parâmetros passaram.
- O teste longo `test_fluid_facade.ts` foi interrompido durante a etapa CPU;
  não foi contabilizado como aprovação da troca CPU/GPU.

Benchmark `bench/claude-frame-bench.mjs --only water-off,water-on`: mesma cena,
1280×800, runtime debug, VSync desligado, 60 quadros de aquecimento + 300
medidos, uma execução de cada. Média de quadro: **3,045 ms sem água e
3,135 ms com água**; CPU TS: 2,379 → 2,397 ms; zero GC em ambas. A carga
média da máquina variou de 27,6% a 33,9%. É uma amostra curta de uma cena
pequena, não uma garantia de desempenho de mundos extensos.
