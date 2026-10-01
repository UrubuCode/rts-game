# Geração extensível por chunks e biomas

O componente `ProceduralWorld` seleciona uma extensão pelo campo `generator`.
O streaming continua responsável por distância, prioridade, cache, orçamento,
cancelamento, publicação completa e liberação. A extensão produz dados e malhas
na CPU, dentro do worker, sem acessar GPU ou editor.

## Extensões iniciais

| Extensão | Dados e resultado | Dimensão do chunk |
| --- | --- | --- |
| `heightfield` | Relevo contínuo, bairros e vegetação existentes; LOD próximo/distante | 128×128 unidades |
| `voxel` | Blocos de grama, pedra, terra, areia e neve; cavernas e faces expostas | 16×32×16 blocos, cada bloco com 2 unidades |

Em `heightfield`, `biomes=false` preserva a geração anterior. Ativar biomas usa
campos globais de temperatura/umidade, modifica relevo e vegetação e permite
areia/neve no terreno. Em `voxel`, biomas escolhem o material superficial.
`biomeScale` controla a escala do clima, `heightScale` a amplitude do relevo e
`caves` habilita cavernas volumétricas somente no voxel.

Existem planície, floresta, deserto e tundra. As classificações consultam campos
contínuos por posição global; não são sorteadas por chunk. O relevo é contínuo
mesmo quando muda a classificação. As cores ainda mudam por célula, sem mistura
visual de materiais. São regras próprias desta engine, não uma reprodução do
algoritmo do Minecraft.

## Contratos

- `WorldGenerationProfile`: seleção do gerador, parâmetros e `options` específicas.
- `WorldGenerationRequest`: seed, coordenadas X/Z, perfil e máscara opcional.
- `WorldGenerationJob`: `step()`, `done`, grupos de malhas e caixas de colisão.
- `WorldMeshData`: vértices `[x,y,z,nx,ny,nz,u,v]`, índices, material e nível de detalhe.
- `WorldGeneratorRegistry`: registra fábrica e tamanho horizontal de chunk.
- `WorldChunkLoader`: executa o protocolo de worker e envia no máximo uma malha
  de 768 vértices por crédito. Um erro/cancelamento impede publicação parcial.
- `WorldStream`: administra recursos e desenha a saída comum. O perfil é copiado
  na criação; para alterá-lo, regenere o mundo. Cache é local a essa instância.

Os nomes antigos `FpsWorldStream` e `FpsWorldChunkLoader` continuam como wrappers
compatíveis. O stream tem uma paleta compartilhada de 12 materiais nesta versão;
uma extensão deve usar esses IDs. Catálogo arbitrário de materiais ainda falta.
Orçamento em MiB cobre buffers GPU estimados, não toda a memória do worker.

## Adicionar uma extensão

1. Implemente um job de CPU que cumpra `WorldGenerationJob`.
2. Registre a fábrica em `createWorldGeneratorRegistry()`, em `world_generators.ts`:

```ts
registry.register("meu-gerador", 64, (request) => new MyGenerationJob(request));
```

3. Adicione o arquivo à lista de fontes do bundler `tools/create-world-worker.mjs`,
   antes do registro que o utiliza, e importe-o no registro para uso em TS.
4. Execute `node tools/create-world-worker.mjs`; versione o bundle gerado.
5. Selecione o ID no componente. Parâmetros próprios ficam em `generatorSettings`
   (objeto JSON limitado a 64 KiB), enviados como `request.profile.options`.

É uma extensão de código compilada junto do projeto, não carregamento dinâmico
de plugin baixado. Um job deve ter passos curtos para observar cancelamento.
O empacotamento atual divide em 768 vértices: não crie índices que atravessem
esses blocos. Primitivas independentes de 3, 4 ou 24 vértices atendem ao contrato;
malhas com vértices compartilhados precisam ser reempacotadas pelo gerador.

## Voxel inicial e limites

O job guarda uma grade compacta `Uint8Array` e um halo de um bloco ao redor.
O halo é amostrado globalmente: elimina faces sólidas entre chunks mesmo se o
vizinho ainda não foi carregado. O mesher emite somente faces contra ar.
Caixas sólidas consecutivas em Y são agrupadas em segmentos de colisão.

A grade existe durante a geração no worker; o stream recebe malhas e caixas.
Ainda não existe armazenamento autoral de blocos, colocar/quebrar, salvamento
de alterações, minérios, estruturas, vegetação voxel, água, greedy meshing ou
LOD voxel. A altura é limitada a 32 blocos e o streaming é de colunas X/Z,
sem chunks verticais independentes. As caixas são consultas estáticas do mundo,
não corpos individuais no solver geral de física.

## Executar e validar

```powershell
.\run-pbr.ps1 -Scene world_component -Generator voxel -Seed 42
.\run-pbr.ps1 -Scene world_component -Generator heightfield -Seed 42
```

O teste `world-generators.ts` cobre quatro biomas, continuidade, halos em
coordenadas negativas, faces expostas, cavernas, repetibilidade, extensão extra,
pacotes do worker, tamanhos de chunk e rejeição de gerador desconhecido.
O teste GPU do componente carrega, regenera e limpa recursos pelo renderer normal.
Essas verificações demonstram a arquitetura funcionando com dois formatos;
não equivalem a um jogo voxel completo nem a um benchmark de produção.

Na cena padrão `jogo-vitrine`, uma amostra debug de 300 quadros após 60 de
aquecimento registrou média 6,15 ms antes / 6,22 ms depois, CPU TS 5,41/5,43 ms
e zero GC em ambas. Carga média da máquina 29,28%/26,88%. É uma comparação curta
de regressão da cena existente, não uma medição de FPS do mundo voxel.

As sondas de 200 mil iterações do jogador/LOD, componente e renderer genérico
terminaram sem coletas entre marcadores. O teste GPU legado também preservou
os handles ao voltar para três chunks em cache e gerou zero chunks ao girar.
