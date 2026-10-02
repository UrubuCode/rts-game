# Água: superfície, reflexos e flutuação

Para desenhar rios e lagos com pontos editáveis, veja [Rios e lagos por curvas](water-splines.md).

`WaterSurface` é um componente da categoria Renderização, com parâmetros preservados ao salvar, duplicar e entrar/sair do Play.

## Demonstração

```powershell
.\run-pbr.ps1 -Scene water -RuntimePath ..\rts-pbr -TargetPath ..\pbr-target
```

WASD move, mouse direito gira, Q/E alteram altura, Shift acelera, R restaura e Esc ou X encerram. O runtime usa `patches/render-pbr-runtime.patch` sobre a base de [render-pbr.md](render-pbr.md).

## Superfície

Adicione WaterSurface a um objeto vazio no nível da água. A superfície é horizontal: mantenha rotação zero e escala 1 no objeto e ancestrais. Coloque leito e margens como geometria opaca.

| Campo | Efeito |
|---|---|
| `width`, `length` | Dimensões XZ |
| `waveAmplitude`, `wavelength`, `waveSpeed` | Ondas |
| `red`, `green`, `blue` | Cor linear profunda |
| `absorption`, `opacity` | Absorção e intensidade da cor |
| `refraction` | Deslocamento da amostra em pixels |
| `foamWidth` | Espuma nas interseções |
| `resolution` | Subdivisões por eixo: 8–128, padrão 64 |
| `reflectionStrength` | Intensidade SSR; zero desliga |
| `reflectionDistance`, `reflectionSteps` | Alcance e passos SSR |

`heightAt(x,z)` consulta as ondas; `contains(x,z)` testa os limites. Atualize os transforms mundiais antes de consultar.

A grade é gerada e animada na GPU. O passe copia cor HDR e depth opacos para absorção, refração, Fresnel, reflexo e espuma, respeitando o viewport. Sem água enfileirada, não há cópias e os alvos são liberados. Usam aproximadamente 12 bytes por pixel. Teto: 128 superfícies por quadro; superfícies sobrepostas não compõem refração entre si.

SSR reflete somente geometria opaca visível na tela. Refina interseções e rejeita o leito submerso; sem resultado usa o céu. Objetos ocultos, fora da tela e transparentes não aparecem. Sem acumulação temporal, silhuetas podem apresentar descontinuidades. Faltam cáusticas, câmera submersa, panorama HDR, ondas de impacto e correntes.

## Flutuação

Adicione `Buoyancy` e `Rigidbody` ao mesmo GameObject raiz. Ajuste a massa e coloque `Rigidbody.floorY` abaixo do leito: o piso implícito pode impedir o afundamento. O empuxo usa o volume da caixa definido pela escala, fração submersa e gravidade do corpo. Densidade 1 equivale a uma unidade de massa por unidade cúbica. `volumeScale` corrige o volume; `drag` controla o arrasto. `waterObject` restringe a busca pelo nome do objeto; vazio procura superfícies ativas.

Funciona nos caminhos CPU, GPU e Rust. É uma aproximação vertical, sem torque ou volume real da malha. A busca percorre componentes da cena por corpo; grandes frotas ainda precisam de índice espacial.

## Chunks

`ProceduralWorld.waterEnabled` habilita água animada no gerador `heightfield` integrado. Alterar essa opção no Inspector não regenera chunks. Geradores voxel e extensões próprias continuam responsáveis por sua água. Na API direta, chame `WorldStream.update(dt)` antes do desenho e configure `world.water` para personalizar o visual.

Chunks compartilham resolução e relógio. A origem das ondas acompanha o deslocamento das coordenadas de renderização; retornar ao cache preserva a fase. `waterHeightAt(x,z)` retorna NaN fora dos chunks residentes ou sobre terra seca. Buoyancy consulta essa água através de ProceduralWorld.

Geração em background, cache e descarte continuam no streaming existente. A água ainda não tem LOD próprio. A malha opaca antiga permanece no pacote/cache, mas seu desenho é substituído. O depth do terreno oculta a água abaixo da terra; não há recorte geométrico da costa.

## Partículas GPU

`drawWaterGPU(win, buffer, count, radius)` usa diretamente o buffer de compute como vertex buffer, sem readback. Contagem, raio e uso do buffer são validados. O visual continua esférico e não reconstrói líquido contínuo. O pipeline legado compartilha o raio do primeiro lote: use raio uniforme. O solver SPH existente não foi reescrito.

## Validação

- 36 testes nativos de scene3d passaram na RTX 2080 Ti/DX12, incluindo pixels de água, ondas, refração, SSR, remoção e partículas GPU.
- `water-surface.ts`: catálogo, serialização, limites, ondas e Play/Stop.
- `buoyancy.ts`: equilíbrio em 60/120 Hz, afundamento, limites, serialização e três caminhos de física.
- `water-world.ts`: carregamento, toggle, descarte, cache e origem móvel.
- Sondas WaterSurface, Buoyancy e streaming: 200 mil iterações por caminho, zero coletas entre marcadores; não medem alocações do driver.
- Testes do catálogo, geração, parâmetros e PlayMode passaram.
- Na etapa anterior, API GPU e 9 verificações do solver GPU passaram. O teste longo `test_fluid_facade.ts` foi interrompido na CPU e não conta como aprovação da troca CPU/GPU.

Benchmark `water-stage2`, mesma cena, 1280×800, debug, VSync desligado: 60 quadros de aquecimento e 300 medidos, uma execução por cenário. Média: **3,994 ms sem água; 4,008 ms com água e SSR**. CPU TS: 3,253 → 3,234 ms; zero GC. Carga média da máquina: 29,5% e 31,0%. A caixa com física está nos dois cenários. A diferença está sujeita ao ruído; não mede custo GPU isolado nem garante desempenho em mundos extensos.
