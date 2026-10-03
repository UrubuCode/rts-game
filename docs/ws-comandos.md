# Porta de controle do editor: comandos

<!-- GERADO por `npm run docs:ws` a partir de `doc json` (src/editor/control/builtin_commands.ts + comandos de pacote). Não edite à mão. -->

Conexão: `ws://127.0.0.1:7777` (só loopback). Cliente: `python tools/ws_client.py` (ver `.claude/skills/rts-engine-control/SKILL.md`).

Protocolo: 1 comando por linha; resposta [ok] | [erro] <motivo> | [<etiqueta>] ...; <obj> = indice, #indice, nome exato (aspas se tiver espaco) ou caminho Pai/Filho; async = a resposta pode vir depois (a conexao espera por ela antes da linha seguinte).

Colunas: **Desfazer** = `dispatch` (o despacho tira um snapshot antes), `proprio` (o comando tira só nos subcomandos que mudam a cena) ou `nenhum`; **async** = a resposta vem depois (a conexão espera por ela antes da linha seguinte; não cabe num `batch`).

112 comandos.

## consulta

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `buoyancy <obj> info` | agua, fracao submersa e corrente; empuxo atual apenas vertical | `buoyancy Caixa info` | nenhum |  |
| `assets errors [clear]` | texturas, modelos, ceu e esqueletos que nao carregaram (tipo, caminho, vezes, motivo) | `assets errors` | nenhum |  |
| `contexto` | retrato compacto do editor pra uma IA, gerado AGORA do runtime: comandos, componentes (com campos), menus, pacotes, sistemas e cena | `contexto` | nenhum |  |
| `contexto json` | o mesmo em JSON completo | `contexto json` | nenhum |  |
| `contexto <secao>` | so uma secao (comandos\|componentes\|menus\|pacotes\|sistemas\|cena) | `contexto componentes` | nenhum |  |
| `contexto componentes <Nome>` | ficha detalhada de UM componente (campos, tipos, opcoes) | `contexto componentes Spinner` | nenhum |  |
| `describe <obj>` | TUDO de um objeto em texto: nome, indice, caminho, ativo, transform (pos, rot em graus, escala, mundo), aparencia, filhos e cada componente com todos os campos | `describe Cubo` | nenhum |  |
| `describe <obj> json` | o mesmo em JSON (depois de '[describe] ') | `describe Pai/Filho json` | nenhum |  |
| `doc [prefixo]` | esta documentacao (todos ou filtrado pelo inicio da linha) | `doc addcomp` | nenhum |  |
| `doc json` | manifesto de TODOS os comandos (embutidos + de pacote) em JSON: nome, sintaxe, ajuda, muta, grupo | `doc json` | nenhum |  |
| `errors [clear]` | ultima excecao capturada (origem, mensagem, pilha) e os componentes cujo gizmo/onInspectorGUI lancou e foi desligado; clear zera so as excecoes (assets: assets errors clear) | `errors` | nenhum |  |
| `find <nome\|trecho>` | objetos cujo nome contem o trecho (sem diferenciar maiusculas): indice e caminho | `find cubo` | nenhum |  |
| `getfield <obj> <comp\|Nome> <campo\|nome>` | le um campo com o tipo (number, boolean, string, color, enum com opcoes, vector no Transform) | `getfield Luz Light cor` | nenhum |  |
| `help` | lista curta de comandos por grupo | `help` | nenhum |  |
| `log [n\|erro\|warn\|debug\|texto\|clear]` | fim do log da engine com resumo de contagens | `log erro` | nenhum |  |
| `log tail [n]` | as n ultimas mensagens (padrao 20) | `log tail 50` | nenhum |  |
| `res` | resolucao logica atual da janela | `res` | nenhum |  |
| `scene json [obj]` | a cena inteira no JSON que o save grava (ou so um objeto), SEM salvar nem mudar o documento | `scene json` | nenhum |  |
| `state` | estado da cena e da camera; por objeto: kind, pos, rot (yaw,pitch,roll em graus), escala | `state` | nenhum |  |

## objetos

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `spline <obj> info` | pontos locais e estado em JSON | `spline Rio info` | proprio |  |
| `spline <obj> set <indice> <x> <y> <z> <largura> <profundidade> <velocidade>` | altera ponto local com Desfazer, fora do Play | `spline Rio set 0 0 0 0 8 2 1` | proprio |  |
| `spline <obj> insert\|remove <indice>` | insere apos o indice ou remove, com Desfazer | `spline Rio insert 0` | proprio |  |
| `spline <obj> closed on\|off` | fecha lago ou abre rio, com Desfazer | `spline Rio closed on` | proprio |  |
| `terrain <obj> heightmap\|stamp` | aplica PNG configurado no TerrainImageTool; valida antes de Desfazer | `terrain Chao heightmap` | proprio |  |
| `terrain <obj> info` | dimensoes e capacidades do heightfield | `terrain Chao info` | proprio |  |
| `terrain <obj> height <x> <z>` | consulta altura local | `terrain Chao height 0 0` | proprio |  |
| `terrain <obj> brush <x> <z> <raio> <intensidade>` | pincel local de relevo, negativo rebaixa; Desfazer fora do Play | `terrain Chao brush 0 0 4 -1` | proprio |  |
| `terrain <obj> flatten` | aplaina com Desfazer fora do Play | `terrain Chao flatten` | proprio |  |
| `water <obj> info` | tipo de agua, Terrain alvo e erro | `water Rio info` | proprio |  |
| `water <obj> sample <x> <z>` | altura, profundidade e corrente em coordenadas de mundo | `water Rio sample 0 0` | proprio |  |
| `water <obj> carve` | escava o Terrain configurado com Desfazer fora do Play | `water Rio carve` | proprio |  |
| `clear` | esvazia a cena (para o Play) | `clear` | dispatch |  |
| `delete <obj>` | remove o objeto | `delete 3` | dispatch |  |
| `delsel` | remove TODOS os objetos da multi-selecao (ou o unico selecionado) | `delsel` | dispatch |  |
| `dup [obj]` | duplica o objeto (padrao: selecionado), deslocado em +1 X; clona transform, aparencia e componentes | `dup 3` | dispatch |  |
| `dupn <n> <espaco> [obj]` | duplica em ARRAY: n copias em linha no X, espacadas | `dupn 5 2 1` | dispatch |  |
| `grid` | TOGGLE de um chao-grade (plano xadrez) em y=0 | `grid` | dispatch |  |
| `iso [obj]` | ISOLA o objeto (esconde os outros); de novo mostra todos | `iso 3` | dispatch |  |
| `menu [caminho]` | sem argumento lista os itens @menuItem; com caminho executa (Criar/ entra no Desfazer) | `menu Criar/Luz/Pontual` | proprio |  |
| `rename <obj> <nome...>` | renomeia o objeto (nome = resto da linha) | `rename 1 Caixa Vermelha` | dispatch |  |
| `select <obj>` | seleciona o objeto (limpa a multi-selecao) | `select 3` | nenhum |  |
| `selectadd <obj>` | adiciona o objeto a MULTI-selecao | `selectadd 2` | nenhum |  |
| `selectclear` | volta pra selecao unica (esvazia a multi) | `selectclear` | nenhum |  |
| `spawn <nome> <x> <y> <z> [kind] [escala]` | cria objeto; kind 1=cubo 2=piramide 3=octaedro 4=esfera; nasce estatico | `spawn Cubo 0 2 0 1 1.5` | dispatch |  |
| `vis [obj]` | TOGGLE de visibilidade do objeto (active) | `vis 3` | dispatch |  |

## transform

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `align [obj] [passo]` | arredonda a POSICAO do objeto pro grid (padrao: selecionado, passo 0.5) | `align 3` | dispatch |  |
| `color <obj> <r> <g> <b>` | cor do objeto, 0..255 | `color 0 240 90 60` | dispatch |  |
| `mesh <obj> <kind>` | troca a malha primitiva (0=vazio 1=cubo 2=piramide 3=octaedro 4=esfera) | `mesh 0 4` | dispatch |  |
| `move <obj> <x> <y> <z>` | define a POSICAO local do objeto | `move 0 1 2 3` | dispatch |  |
| `reset [obj]` | zera a rotacao e poe escala 1 (mantem a posicao) | `reset 3` | dispatch |  |
| `rot <obj> <yaw> <pitch> [roll]` | define a ROTACAO local em graus (yaw = Y, pitch = X, roll = Z, padrao 0; a mesma convencao do pose rot; no Inspector X=pitch Y=yaw Z=roll) | `rot 0 90 0` | proprio |  |
| `rot <obj>` | le a rotacao local e de mundo em graus (consulta: sem Desfazer) | `rot Cubo` | proprio |  |
| `scl <obj> <sx> <sy> <sz>` | escala NAO-uniforme | `scl 0 1 6 1` | dispatch |  |
| `snap [0\|1]` | liga/desliga o snap-to-grid do gizmo (move 0.5, rotate 15) | `snap 1` | nenhum |  |
| `spin <obj> <spdY> [spdX]` | anexa um Spinner (atalho) | `spin 0 1.2` | dispatch |  |
| `tool [move\|rotate\|scale\|select]` | troca/consulta a ferramenta do gizmo da viewport | `tool rotate` | nenhum |  |

## componentes

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `addcomp <obj> <Nome>` | anexa um componente ao objeto (nomes em complist) | `addcomp 1 Orbit` | dispatch |  |
| `complist` | nomes dos componentes que da pra adicionar | `complist` | nenhum |  |
| `comps <obj>` | componentes do objeto + campos e valores | `comps 1` | nenhum |  |
| `rmcomp <obj> <comp>` | remove o componente (indice em comps) | `rmcomp 1 0` | dispatch |  |
| `setfield <obj> <comp\|Nome> <campo\|nome> <valor>` | edita um campo como o Inspector (roda onValidate). valor: numero, true/false, texto (entre aspas ou resto da linha), #RRGGBB (cor), opcao da lista (enum), x,y,z (Transform position/rotation/scale; rotation em graus X,Y,Z do Inspector) | `setfield Luz Light cor #FF8800` | proprio |  |

## hierarquia

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `group` | cria um no vazio e aninha os selecionados sob ele (Ctrl+G) | `group` | dispatch |  |
| `movetree <dragObj> <antesObj> <paiObj\|-1>` | moveSubtree cru (reordenar+reparentar por indice) | `movetree 5 3 2` | dispatch |  |
| `parent <obj> <paiObj\|-1>` | REPARENT: aninha o objeto sob o pai (-1 = raiz). Reordena os indices; re-consulte tree | `parent 5 2` | dispatch |  |
| `tree` | hierarquia: indice, nome, indice do pai (-1=raiz) | `tree` | nenhum |  |
| `ungroup [obj]` | dissolve o grupo (passa a pose de mundo aos filhos e remove o no) | `ungroup 8` | dispatch |  |

## cena

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `instscene <path> [hostObj]` | CENA DENTRO DE CENA: instancia uma cena inteira sob um objeto (padrao: selecionado) | `instscene assets/subscene.json 0` | dispatch |  |
| `loadscene <path>` | carrega uma cena JSON (substitui a atual e para o Play) | `loadscene scenes/shadowdemo.json` | dispatch |  |
| `savescene <path>` | SALVA a cena num JSON e passa a ser o documento aberto (dispara o gancho salvar) | `savescene assets/minhacena.json` | nenhum |  |

## play

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `batch begin` | abre um LOTE: os comandos seguintes viram UMA entrada de Desfazer; no primeiro [erro] o lote inteiro e desfeito e a resposta diz a linha | `batch begin` | nenhum |  |
| `batch end` | fecha o lote (1 entrada de Desfazer se a cena mudou) | `batch end` | nenhum |  |
| `batch cancel` | desfaz o que o lote aplicou e fecha | `batch cancel` | nenhum |  |
| `pause` | pausa a simulacao sem descartar suas mudancas temporarias | `pause` | nenhum |  |
| `play` | inicia uma copia temporaria da cena ou retoma a simulacao pausada | `play` | nenhum |  |
| `redo` | refaz a ultima operacao desfeita | `redo` | nenhum |  |
| `resume` | retoma a simulacao pausada sem sair do Play | `resume` | nenhum |  |
| `seed [n]` | semente do gerador aleatorio central (aleatorio() de @engine/core/aleatorio), reaplicada a cada play; mesma semente + mesmos passos = mesmo resultado; sem n consulta | `seed 42` | nenhum |  |
| `step [N]` | com o Play pausado (pausa se estiver rodando), avanca exatamente N passos fixos (padrao 1, max 6000 por comando) e responde passos e tempo simulado | `step 10` | nenhum |  |
| `stop` | descarta a simulacao e restaura a cena de edicao e seu historico | `stop` | nenhum |  |
| `timescale [x]` | escala do tempo da simulacao (0 = parado, 0.5 = metade dos passos por segundo, 1 = real); vale ate mudar (a barra de status mostra quando != 1); sem x consulta | `timescale 0.5` | nenhum |  |
| `txn begin\|end\|cancel` | o mesmo que batch | `txn begin` | nenhum |  |
| `undo` | desfaz a ultima operacao mutante (snapshot da cena) | `undo` | nenhum |  |

## vista

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `cam <x> <y> <z> <yaw> <pitch>` | posiciona a camera do editor (angulos em radianos) | `cam 0 11 -15 0 -0.5` | nenhum |  |
| `focus <obj>` | enquadra a camera do editor no objeto | `focus 0` | nenhum |  |
| `frameall` | enquadra a camera pra ver toda a cena | `frameall` | nenhum |  |
| `gameview [jogo\|cena\|proporcao livre\|16:9\|4:3\|previa on\|off]` | aba Jogo: varias cameras, proporcao com faixas, previa na vista de Cena (estado do editor, sem Desfazer) | `gameview proporcao 16:9` | nenhum |  |
| `gameview camera todas\|<obj>` | camera unica da aba Jogo (objeto com Camera) ou todas | `gameview camera Camera` | nenhum |  |
| `light [x y z amb]` | luz legada da sessao: posicao + ambiente (0..1); sem args consulta | `light 7 13 5 0.28` | nenhum |  |
| `view <top\|front\|side\|persp>` | posiciona a camera do editor num preset olhando a origem | `view top` | nenhum |  |

## ver

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `shot [caminho.png] [janela\|jogo]` | CAPTURA a propria janela do editor num PNG (padrao build/shots/shot-<ms>.png; jogo = so a vista de Cena/Jogo); resposta adiada ate o arquivo existir | `shot build/shots/antes.png` | nenhum | sim |
| `shot diff <a.png> <b.png> [tolerancia]` | percentual de pixels diferentes (canal com diferenca > tolerancia 0..255) e a caixa que os contem | `shot diff build/shots/antes.png build/shots/depois.png` | nenhum | sim |

## entrada

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `input` | estado da entrada simulada (ligada?, fila, mouse, quadro) | `input` | nenhum | sim |
| `input mouse <x> <y> [down\|up] [left\|right\|middle]` | move o mouse ate o pixel (x,y da janela) e, se pedido, aperta/solta o botao (fica apertado ate o up) | `input mouse 700 400 down` | nenhum | sim |
| `input click <x> <y> [left\|right\|middle]` | clique completo: move, aperta, solta (3 quadros) | `input click 700 400` | nenhum | sim |
| `input drag <x0> <y0> <x1> <y1> [quadros]` | arrasta com o botao esquerdo de (x0,y0) a (x1,y1) em N quadros (padrao 10) | `input drag 600 400 700 400 20` | nenhum | sim |
| `input key <tecla> [down\|up\|press]` | tecla (a-z, 0-9, f1-f12, enter, esc, space, backspace, tab, delete, setas up/down/left/right, ctrl, shift, alt); press = desce e sobe; down fica segurada ate o up | `input key w down` | nenhum | sim |
| `input text <texto...>` | digita o texto (resto da linha) no campo com foco | `input text #FF0000` | nenhum | sim |
| `input wheel <d>` | gira a roda do mouse (positivo = para cima) | `input wheel -3` | nenhum | sim |
| `input off` | solta tudo e volta a entrada real (a simulada ignora mouse/teclado fisicos enquanto ligada; desliga sozinha apos 30 s ociosa) | `input off` | nenhum | sim |

## esqueleto

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `addskel <obj> <caminho.glb>` | adiciona Skeleton+AnimationPlayer ao objeto (ou troca o modelo do Skeleton existente) | `addskel 0 assets/models/kenney/character-a.glb` | dispatch |  |
| `anim <obj> play <nome> [loop\|once]` | toca um clipe do inicio (loop/once trocam this.loop; sem args mantem) | `anim 0 play walk loop` | dispatch |  |
| `anim <obj> pause` | pausa o clipe atual sem perder o tempo | `anim 0 pause` | dispatch |  |
| `anim <obj> resume` | retoma o clipe pausado | `anim 0 resume` | dispatch |  |
| `anim <obj> seek <s>` | pula o clipe atual pro tempo s (segundos) | `anim 0 seek 0.3` | dispatch |  |
| `anim <obj> fade <nome> <s>` | crossfade pro clipe nome em s segundos | `anim 0 fade run 0.2` | dispatch |  |
| `anim <obj> speed <x>` | multiplicador de velocidade do AnimationPlayer | `anim 0 speed 1.5` | dispatch |  |
| `anim <obj> state` | clipe atual, tempo, tocando/pausado, loop, speed (consulta: sem Desfazer) | `anim 0 state` | dispatch |  |
| `anim <obj> preview play\|pause\|stop\|seek <s>` | previa do clipe fora do Play (estado do editor: sem Desfazer) | `anim 0 preview play` | dispatch |  |
| `animator <obj> load <arquivo>` | troca o controlador do Animator (.controller.json, relido do disco; entra no Desfazer) | `animator 0 load assets/animators/personagem.controller.json` | proprio |  |
| `animator <obj> set <param> <valor>` | parametro float (numero) ou bool (true/false); estado de execucao, sem Desfazer; fora do Play inicia a previa | `animator 0 set velocidade 2` | proprio |  |
| `animator <obj> trigger <param>` | arma o trigger (fica armado ate uma transicao consumi-lo); fora do Play inicia a previa | `animator 0 trigger tiro` | proprio |  |
| `animator <obj> state` | estado atual e tempo normalizado por camada, fade em andamento, erro do controlador | `animator 0 state` | proprio |  |
| `animator <obj> params` | parametros do controlador (nome, tipo, valor) | `animator 0 params` | proprio |  |
| `anims <obj>` | lista os clipes do modelo do Skeleton (nome + duracao) | `anims 0` | nenhum |  |
| `bones <obj>` | lista os ossos do Skeleton do objeto (indice, nome, pai) | `bones 0` | nenhum |  |
| `pose <obj> <osso\|nome> rot <yaw> <pitch> <roll>` | rotacao LOCAL do osso em graus; q = yaw(Y) * pitch(X local) * roll(Z local) | `pose 0 torso rot 90 0 0` | dispatch |  |
| `pose <obj> <osso\|nome> pos <x> <y> <z>` | posicao LOCAL do osso | `pose 0 arm-right pos 0.1 0 0` | dispatch |  |
| `pose <obj> <osso\|nome> turn <x\|y\|z> <graus>` | gira o osso no eixo de MUNDO (como o gizmo) | `pose 0 arm-right turn y 30` | dispatch |  |
| `pose <obj> <osso\|nome> shift <dx> <dy> <dz>` | desloca o osso em MUNDO (como o gizmo) | `pose 0 arm-right shift 0 0.1 0` | dispatch |  |
| `resetpose <obj>` | volta o Skeleton ao repouso, esquecendo a pose manual | `resetpose 0` | dispatch |  |
| `selbone <obj> <osso\|nome\|-1>` | escolhe o osso do gizmo/Inspector (objeto ja selecionado; -1 = volta ao objeto) | `selbone 0 arm-right` | nenhum |  |

## arquivos

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `instprefab <path>` | instancia um prefab na cena e o seleciona | `instprefab assets/box.json` | dispatch |  |
| `importar <caminho> [pasta]` | copia um arquivo de fora de assets/ pra dentro (como a Unity); sem pasta, audio vai pra assets/audio e o resto pra pasta aberta do Project | `importar C:/sons/tiro.wav assets/audio` | nenhum |  |
| `loadobj <path> [nome] [x] [y] [z]` | carrega um MODELO (.obj/.glb/.gltf) e cria o(s) objeto(s); multi-material vira raiz + 1 filha por submesh | `loadobj assets/models/torus.obj Torus 0 2 0` | dispatch |  |
| `loadtex <obj> <path>` | carrega uma imagem (PNG/JPG/BMP) e aplica como textura no Material do objeto | `loadtex 0 assets/textures/images.jpg` | dispatch |  |
| `ls [path]` | lista uma pasta (/ marca subpastas) | `ls assets/scenes` | nenhum |  |
| `makeprefab <path> [obj]` | salva o objeto como PREFAB (JSON de 1 objeto) | `makeprefab assets/box.json 1` | nenhum |  |
| `mkdir <path>` | cria pasta (+ pais que faltarem) | `mkdir assets/scripts` | nenhum |  |
| `mv <de> <para>` | renomeia/move arquivo ou pasta | `mv assets/a.txt assets/b.txt` | nenhum |  |
| `readfile <path>` | le o conteudo do arquivo | `readfile scenes/shadowdemo.json` | nenhum |  |
| `rmpath <path>` | deleta arquivo ou pasta (recursivo) | `rmpath assets/tmp` | nenhum |  |
| `setcustom <obj> <meshId>` | DEBUG: forca o customMesh de um objeto (0=primitivo) | `setcustom 1 5` | dispatch |  |
| `writefile <path> <conteudo>` | escreve (conteudo = resto da linha, 1 linha) | `writefile assets/nota.txt oi mundo` | nenhum |  |

## arrastar

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `drop <path> [sx sy]` | ARRASTA o asset pra cena (como o mouse): com sx/sy cai no chao sob esse PIXEL; sem, posicao padrao. aceita prefab/.obj/imagem/cena | `drop assets/prefabs/RedCube.prefab.json 700 400` | dispatch |  |
| `dropat <path> <x> <y> <z>` | solta o asset direto numa posicao de MUNDO | `dropat assets/models/torus.obj 3 1 -2` | dispatch |  |
| `dropon <path> <obj>` | solta o asset SOBRE um objeto (imagem vira textura; .obj vira a mesh) | `dropon assets/textures/wood.png 3` | dispatch |  |
| `gizmoat <sx> <sy>` | seleciona o dono do icone de gizmo sob o pixel (a mesma area do clique) | `gizmoat 700 400` | nenhum |  |
| `groundat <sx> <sy>` | ponto do CHAO (Y=0) sob esse pixel (a conversao tela->mundo do drop) | `groundat 700 400` | nenhum |  |
| `pickat <sx> <sy>` | qual objeto esta sob esse pixel (-1 = nenhum) | `pickat 700 400` | nenhum |  |
| `thumb <path> [cols]` | INSPECIONA o thumbnail que o Project mostra pro asset: estatisticas de pixel + preview ASCII (\| = quebra de linha) | `thumb assets/models/torus.obj 16` | nenhum |  |

## sistema

| Sintaxe | O que faz | Exemplo | Desfazer | async |
|---|---|---|---|---|
| `boat <obj> info` | estado JSON do veleiro | `boat Barco info` | nenhum |  |
| `boat <obj> sail\|rudder <valor>` | controle no Play; vela 0..1, leme -1..1, sem batch/Desfazer | `boat Barco sail 1` | nenhum |  |
| `boat <obj> anchor on\|off` | ancora idempotente no Play | `boat Barco anchor on` | nenhum |  |
| `boat <obj> reset` | zera movimento no Play | `boat Barco reset` | nenhum |  |
| `world <obj> info` | JSON: fila, progresso aproximado da janela atual, cache e memoria; nao inicia geracao | `world Mundo info` | proprio |  |
| `world <obj> paint <x> <z> <raio> <intensidade>` | vegetacao local: -1 remove, 1 restaura; Desfazer fora do Play | `world Mundo paint 0 0 20 -1` | proprio |  |
| `world <obj> regenerate` | descarta recursos e reinicia no proximo desenho; fora do Play e batch | `world Mundo regenerate` | proprio |  |
| `build` | dispara o build do jogo (o mesmo do botao Build; snapshot em build/editor-build-<ms>, nao muda a cena) e responde quando termina: estado, pasta, exe e log | `build` | nenhum | sim |
| `build status` | estado do build em andamento ou do ultimo | `build status` | nenhum | sim |
| `dbg` | diagnostico: fisica, corpos, fps, ativos, wouldDraw, drawnLast | `dbg` | nenhum |  |
| `fisica [cpu\|gpu\|rust\|auto\|report]` | consulta ou troca o backend de fisica em execucao | `fisica cpu` | nenhum |  |
| `fluid [n]` | estado do simulador de liquido registrado (e as n primeiras particulas) | `fluid 5` | nenhum |  |
| `gc` | coletas de lixo (o runtime so relata com RTS_GC_DEBUG=1 no stderr) e memoria do processo | `gc` | nenhum |  |
| `hier [linha]` | scroll da Hierarquia (le ou rola ate a linha) | `hier 10` | nenhum |  |
| `prof [on\|off\|reset]` | tabela do profiler por secao (media), passo fixo e fisica | `prof on` | nenhum |  |
| `prof frames [n]` | distribuicao dos n ultimos quadros (ate 1024): min, mediana, p99, max e quadros > 10 ms, do trabalho e do intervalo | `prof frames 300` | nenhum |  |
| `run tests [padrao]` | roda tests/*.ts no runtime (um processo por arquivo, prazo de 180 s cada) e responde passou/falhou por arquivo; padrao = trecho do nome ou curinga com * (padrao test_*) | `run tests test_ws_*` | nenhum | sim |
| `snd [freq dur vol]` | toca um beep e mostra o estado do mixer | `snd 440 0.2 0.3` | nenhum |  |
| `testes [padrao]` | o mesmo que run tests | `testes test_quat` | nenhum | sim |
| `vsync <0\|1>` | liga/desliga a espera do monitor (0 mede o custo real do quadro) | `vsync 0` | nenhum |  |
