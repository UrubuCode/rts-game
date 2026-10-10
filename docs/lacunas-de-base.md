# O que falta de base, comparado com as engines de referência

Levantamento feito em 2026-10-09 contra o `master` (`c94ff90`), lendo
`src/engine/` módulo a módulo. Cada ausência abaixo foi confirmada no código,
não suposta: o `rts-game` tem muita coisa com nome em português, e procurar
pelo termo em inglês dá falso negativo (`blend tree` não aparece em lugar
nenhum, mas o `animator_controller.ts` tem mistura 1D com `blendClip` e
`pairPlans`).

## O que a engine já tem

Para não subestimar o que existe: cena e hierarquia com `computeWorld`,
componentes com catálogo e inspector gerados, índice espacial com raycast e
overlap sem alocação, física com backend CPU/GPU, cascas e eventos de contato,
esqueleto + `Animator` com máquina de estados e mistura, áudio com grupos de
mixagem, espacialização e calibração de latência, partículas, luzes com sombra,
PBR com mapas, céu e neblina, terreno com pincel e máscara de rio, mundo
procedural por chunks com streaming, LOD e biomas voxel, água com SSR, empuxo e
ondas, rede UDP com replicação e predição, corrotinas no estilo Unity, editor
com gizmos, undo, drag-and-drop, play mode e build, e controle por WebSocket
para um agente dirigir a mesma cena que o humano vê.

Isso é bastante acima do básico em renderização, física e mundo. As lacunas
estão quase todas em **gameplay** e **ferramental de produção**.

## Lacunas confirmadas

### 1. Navegação e pathfinding — não existe nada

`route_path.ts` e `route_agent.ts` são **waypoints com conexões manuais**: o
autor desenha os nós e liga um no outro. Não há NavMesh, não há grade de
navegação, não há busca em grafo — nem A\*, nem Dijkstra, nem evasão entre
agentes.

É a lacuna mais alta da lista, e por um motivo específico: o jogo-vitrine é um
RTS. "Clicar no chão e a unidade andar até lá desviando dos prédios" é o verbo
central do gênero, e hoje não existe. Qualquer jogo com IA que se mova fora de
trilho pré-desenhado esbarra nisso no primeiro dia.

### 2. Instanciar prefab em runtime

`Scene.add` / `removeAt` / `clear` existem, e o editor tem prefabs
(`PREFAB` em `assets.ts`, `prefabId` nos componentes gerados). Mas o único
registro de prefab programável é o `NetworkPrefabRegistry`, que é da rede.
Falta o básico: pegar uma referência de prefab e instanciá-la em runtime, com
`destroy` e com **pool** (não há nenhum pool de objetos na engine).

Sem isso não se faz tiro, inimigo, item, efeito — nada que nasça durante o jogo
sem passar pela rede ou por JSON.

### 3. Entrada: só códigos de tecla crus

`entrada.ts` expõe `teclaSegurada(codigo)` e constantes como `TECLA_W = 122`.
Não há eixos, não há ações nomeadas, não há remapeamento, e **não há gamepad**
em lugar nenhum do código. Todo jogo acaba reimplementando a mesma camada, e
nenhum deles fica configurável pelo jogador.

### 4. Física: sem juntas, sem ragdoll, sem character controller

Há `Rigidbody`, colisores, cascas e eventos de contato. Não há **nenhuma
junta ou restrição** — nem fixa, nem dobradiça, nem mola. Sem juntas não há
ragdoll, veículo articulado, porta, ponte levadiça, corda.

Também não há um `CharacterController` reutilizável: `world_player.ts` é o
personagem do exemplo de mundo procedural, não um componente que outro jogo
possa usar.

### 5. Animação: sem IK e sem root motion

`Skeleton` + `Animator` cobrem clipes, estados, transições e mistura. Falta
**cinemática inversa** (pé no degrau, olhar para o alvo, mão na arma) e **root
motion** (o deslocamento vir do clipe em vez de o código empurrar o personagem).
São os dois itens que separam "personagem animado" de "personagem que parece
pisar no chão".

### 6. UI: só o esqueleto

Existem `UIPanel`, `UIButton`, `UIText` e ancoragem. Não existe **campo de
texto**, **lista rolável**, nem sistema de layout (nada de empilhar, distribuir
ou dimensionar automaticamente). Qualquer menu de opções, chat ou inventário
hoje é posicionado à mão em pixels.

### 7. Iluminação: só tempo real

Há luzes com sombra e SSR na água. Não há **lightmaps**, **sondas de
iluminação** nem **sondas de reflexo**. Cena grande e parada paga preço cheio
de luz dinâmica, e interiores não recebem luz indireta.

### 8. Culling: só frustum e LOD

Há frustum culling e LOD de chunk/terreno. Não há **occlusion culling**: uma
cidade desenha os prédios atrás dos prédios. Também não há instancing de
verdade — `drawBatch` agrupa draws, o que ajuda, mas não é o mesmo.

### 9. Sem 2D

Nada de sprite, atlas 2D, tilemap ou física 2D. A engine é 3D e só. É uma
decisão legítima, mas precisa ser uma decisão explícita, porque hoje ela está
implícita.

### 10. Produção: decalques, timeline, localização, save

- **Decalques**: nenhum. Marca de tiro, poça, rachadura — não dá.
- **Timeline / cutscene**: não há sequenciador.
- **Localização**: não há tabela de strings; todo texto é literal no código.
- **Save game**: há `config_usuario.ts` para preferências e serialização de
  cena, mas não há API de salvar/carregar **estado de jogo**.

---

## Lista de implementação proposta

Ordenada por "quantos jogos ficam impossíveis sem isto", não por dificuldade.

### Primeira leva — destrava gameplay

| # | Item | Por que primeiro | Tamanho |
|---|---|---|---|
| 1 | **Pathfinding em grade + A\*** sobre o terreno e os colisores existentes, com `Agent` que segue o caminho e replaneja | É o verbo do RTS e não existe nenhum substituto | Grande |
| 2 | **`instantiate(prefab)` / `destroy(go)` + pool** | Nada que nasça em runtime funciona sem isso | Médio |
| 3 | **Camada de Input**: eixos, ações nomeadas, remapeamento, gamepad | Todo jogo reescreve hoje; barato e de alto uso | Médio |
| 4 | **`CharacterController`** reutilizável, extraído do `world_player.ts` | O código já existe, falta virar componente | Pequeno |

### Segunda leva — qualidade visível

| # | Item | Por que | Tamanho |
|---|---|---|---|
| 5 | **Juntas** (fixa, dobradiça, mola) e **ragdoll** sobre o `Skeleton` | Abre veículo, porta, corpo que cai | Grande |
| 6 | **IK de dois ossos** (pé no chão, olhar/apontar) | Maior salto de credibilidade por linha escrita | Médio |
| 7 | **Root motion** no `Animator` | Tira o escorregar de pé que o `fps-animacao` já mede | Médio |
| 8 | **Occlusion culling** | A cidade procedural já existe e já sofre | Grande |

### Terceira leva — produção

| # | Item | Por que | Tamanho |
|---|---|---|---|
| 9 | **UI: campo de texto, lista rolável, layout** | Destrava menu de opções e qualquer tela de dados | Médio |
| 10 | **Decalques** | Barato depois do PBR, muito visível | Médio |
| 11 | **Save game** (estado, não cena) | Nenhum jogo longo existe sem | Médio |
| 12 | **Lightmaps ou sondas** | Caro; só vale quando houver cena interna | Grande |
| 13 | **Localização** | Barato, mas só dói quando houver jogo para traduzir | Pequeno |

### Fora da lista, de propósito

**2D, tilemap e física 2D.** Não é lacuna se for decisão. Vale registrar no
`README` que a engine é 3D, para parar de aparecer como ausência em toda
revisão.

**Timeline/cutscene.** Grande, e com as corrotinas já no lugar dá para fazer
cena cinemática em script enquanto não houver editor de sequência.

---

## Antes de qualquer item desta lista

Há **6 testes vermelhos no `master`** (`claude-test-collider`,
`claude-test-hullpack`, `test_model`, `test_audio3d`, `net-fps`,
`fps-resistencia`). O `hullpack` sozinho tem 8 falhas em normais e
profundidades de contato — é física de colisão, exatamente a base sobre a qual
os itens 1, 4 e 5 vão ser construídos.

Enquanto a suíte estiver vermelha, nenhuma dessas frentes consegue distinguir
"quebrei agora" de "já estava quebrado".
