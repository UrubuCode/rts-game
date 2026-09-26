// MANIFESTO dos comandos EMBUTIDOS da porta de controle (os `case` do switch em
// dispatch.ts), em ordem alfabética. É a fonte única de:
//   - `BUILTIN_COMMANDS` (nomes; `registerCommand` recusa estes nomes);
//   - `help`, `doc [prefixo]` e `doc json` (commands/doc.ts);
//   - se o despacho tira snapshot de Desfazer antes do comando (`muta`);
//   - quais argumentos são OBJETOS (resolvidos por índice, nome ou caminho
//     Pai/Filho antes do comando rodar): as posições dos tokens do PRIMEIRO uso
//     cujo nome contém "obj" (`<obj>`, `[obj]`, `<paiObj|-1>`...).
// tests/editor-static.test.mjs confere que a lista acompanha o switch.
//
// Cada uso é "assinatura :: descrição :: exemplo" (o formato do `doc`).
// Só dados: api.ts importa este arquivo, e ele não pode importar a cena.

/// Grupos (ordem do `help`).
export const GRUPOS_COMANDO: string[] = ["consulta", "objetos", "transform", "componentes", "hierarquia",
  "cena", "play", "vista", "esqueleto", "arquivos", "arrastar", "sistema"];

/// Desfazer: o despacho não tira snapshot.
export const MUTA_NAO: number = 0;
/// Desfazer: o despacho tira UM snapshot antes (descartado se a resposta for [erro]).
export const MUTA_SIM: number = 1;
/// Desfazer: o próprio comando tira o snapshot só nos subcomandos que mudam a cena.
export const MUTA_PROPRIO: number = 2;

export class ComandoInfo {
  nome: string; grupo: string; muta: number; usos: string[];
  /// Posições dos argumentos que são objetos (calculadas do primeiro uso).
  objs: number[];
  constructor(nome: string, grupo: string, muta: number, usos: string[]) {
    this.nome = nome; this.grupo = grupo; this.muta = muta; this.usos = usos;
    this.objs = posicoesDeObjeto(usos.length > 0 ? usos[0] : "");
  }
}

const SEPARADOR_USO: string = " :: ";

/// Posições (>= 1) dos tokens `<...obj...>`/`[...obj...]` da assinatura.
function posicoesDeObjeto(uso: string): number[] {
  const out: number[] = [];
  const toks = uso.split(SEPARADOR_USO)[0].split(" ");
  let i = 1;
  while (i < toks.length) {
    const t = toks[i];
    const c0 = t.length > 0 ? t.charCodeAt(0) : 0;
    if ((c0 === 60 || c0 === 91) && t.toLowerCase().indexOf("obj") >= 0) out.push(i);   // '<' ou '['
    i = i + 1;
  }
  return out;
}

function c(nome: string, grupo: string, muta: number, usos: string[]): ComandoInfo {
  return new ComandoInfo(nome, grupo, muta, usos);
}

export const BUILTIN_MANIFEST: ComandoInfo[] = [
  c("addcomp", "componentes", MUTA_SIM, ["addcomp <obj> <Nome> :: anexa um componente ao objeto (nomes em complist) :: addcomp 1 Orbit"]),
  c("addskel", "esqueleto", MUTA_SIM, ["addskel <obj> <caminho.glb> :: adiciona Skeleton+AnimationPlayer ao objeto (ou troca o modelo do Skeleton existente) :: addskel 0 assets/models/kenney/character-a.glb"]),
  c("align", "transform", MUTA_SIM, ["align [obj] [passo] :: arredonda a POSICAO do objeto pro grid (padrao: selecionado, passo 0.5) :: align 3"]),
  c("anim", "esqueleto", MUTA_SIM, [
    "anim <obj> play <nome> [loop|once] :: toca um clipe do inicio (loop/once trocam this.loop; sem args mantem) :: anim 0 play walk loop",
    "anim <obj> pause :: pausa o clipe atual sem perder o tempo :: anim 0 pause",
    "anim <obj> resume :: retoma o clipe pausado :: anim 0 resume",
    "anim <obj> seek <s> :: pula o clipe atual pro tempo s (segundos) :: anim 0 seek 0.3",
    "anim <obj> fade <nome> <s> :: crossfade pro clipe nome em s segundos :: anim 0 fade run 0.2",
    "anim <obj> speed <x> :: multiplicador de velocidade do AnimationPlayer :: anim 0 speed 1.5",
    "anim <obj> state :: clipe atual, tempo, tocando/pausado, loop, speed (consulta: sem Desfazer) :: anim 0 state",
    "anim <obj> preview play|pause|stop|seek <s> :: previa do clipe fora do Play (estado do editor: sem Desfazer) :: anim 0 preview play"]),
  c("animator", "esqueleto", MUTA_PROPRIO, [
    "animator <obj> load <arquivo> :: troca o controlador do Animator (.controller.json, relido do disco; entra no Desfazer) :: animator 0 load assets/animators/personagem.controller.json",
    "animator <obj> set <param> <valor> :: parametro float (numero) ou bool (true/false); estado de execucao, sem Desfazer; fora do Play inicia a previa :: animator 0 set velocidade 2",
    "animator <obj> trigger <param> :: arma o trigger (fica armado ate uma transicao consumi-lo); fora do Play inicia a previa :: animator 0 trigger tiro",
    "animator <obj> state :: estado atual e tempo normalizado por camada, fade em andamento, erro do controlador :: animator 0 state",
    "animator <obj> params :: parametros do controlador (nome, tipo, valor) :: animator 0 params"]),
  c("anims", "esqueleto", MUTA_NAO, ["anims <obj> :: lista os clipes do modelo do Skeleton (nome + duracao) :: anims 0"]),
  c("bones", "esqueleto", MUTA_NAO, ["bones <obj> :: lista os ossos do Skeleton do objeto (indice, nome, pai) :: bones 0"]),
  c("cam", "vista", MUTA_NAO, ["cam <x> <y> <z> <yaw> <pitch> :: posiciona a camera do editor (angulos em radianos) :: cam 0 11 -15 0 -0.5"]),
  c("clear", "objetos", MUTA_SIM, ["clear :: esvazia a cena (para o Play) :: clear"]),
  c("color", "transform", MUTA_SIM, ["color <obj> <r> <g> <b> :: cor do objeto, 0..255 :: color 0 240 90 60"]),
  c("complist", "componentes", MUTA_NAO, ["complist :: nomes dos componentes que da pra adicionar :: complist"]),
  c("comps", "componentes", MUTA_NAO, ["comps <obj> :: componentes do objeto + campos e valores :: comps 1"]),
  c("dbg", "sistema", MUTA_NAO, ["dbg :: diagnostico: fisica, corpos, fps, ativos, wouldDraw, drawnLast :: dbg"]),
  c("delete", "objetos", MUTA_SIM, ["delete <obj> :: remove o objeto :: delete 3"]),
  c("delsel", "objetos", MUTA_SIM, ["delsel :: remove TODOS os objetos da multi-selecao (ou o unico selecionado) :: delsel"]),
  c("describe", "consulta", MUTA_NAO, [
    "describe <obj> :: TUDO de um objeto em texto: nome, indice, caminho, ativo, transform (pos, rot em graus, escala, mundo), aparencia, filhos e cada componente com todos os campos :: describe Cubo",
    "describe <obj> json :: o mesmo em JSON (depois de '[describe] ') :: describe Pai/Filho json"]),
  c("doc", "consulta", MUTA_NAO, [
    "doc [prefixo] :: esta documentacao (todos ou filtrado pelo inicio da linha) :: doc addcomp",
    "doc json :: manifesto de TODOS os comandos (embutidos + de pacote) em JSON: nome, sintaxe, ajuda, muta, grupo :: doc json"]),
  c("drop", "arrastar", MUTA_SIM, ["drop <path> [sx sy] :: ARRASTA o asset pra cena (como o mouse): com sx/sy cai no chao sob esse PIXEL; sem, posicao padrao. aceita prefab/.obj/imagem/cena :: drop assets/prefabs/RedCube.prefab.json 700 400"]),
  c("dropat", "arrastar", MUTA_SIM, ["dropat <path> <x> <y> <z> :: solta o asset direto numa posicao de MUNDO :: dropat assets/models/torus.obj 3 1 -2"]),
  c("dropon", "arrastar", MUTA_SIM, ["dropon <path> <obj> :: solta o asset SOBRE um objeto (imagem vira textura; .obj vira a mesh) :: dropon assets/textures/wood.png 3"]),
  c("dup", "objetos", MUTA_SIM, ["dup [obj] :: duplica o objeto (padrao: selecionado), deslocado em +1 X; clona transform, aparencia e componentes :: dup 3"]),
  c("dupn", "objetos", MUTA_SIM, ["dupn <n> <espaco> [obj] :: duplica em ARRAY: n copias em linha no X, espacadas :: dupn 5 2 1"]),
  c("find", "consulta", MUTA_NAO, ["find <nome|trecho> :: objetos cujo nome contem o trecho (sem diferenciar maiusculas): indice e caminho :: find cubo"]),
  c("fisica", "sistema", MUTA_NAO, ["fisica [cpu|gpu|rust|auto|report] :: consulta ou troca o backend de fisica em execucao :: fisica cpu"]),
  c("fluid", "sistema", MUTA_NAO, ["fluid [n] :: estado do simulador de liquido registrado (e as n primeiras particulas) :: fluid 5"]),
  c("focus", "vista", MUTA_NAO, ["focus <obj> :: enquadra a camera do editor no objeto :: focus 0"]),
  c("frameall", "vista", MUTA_NAO, ["frameall :: enquadra a camera pra ver toda a cena :: frameall"]),
  c("gameview", "vista", MUTA_NAO, [
    "gameview [jogo|cena|proporcao livre|16:9|4:3|previa on|off] :: aba Jogo: varias cameras, proporcao com faixas, previa na vista de Cena (estado do editor, sem Desfazer) :: gameview proporcao 16:9",
    "gameview camera todas|<obj> :: camera unica da aba Jogo (objeto com Camera) ou todas :: gameview camera Camera"]),
  c("getfield", "consulta", MUTA_NAO, ["getfield <obj> <comp|Nome> <campo|nome> :: le um campo com o tipo (number, boolean, string, color, enum com opcoes, vector no Transform) :: getfield Luz Light cor"]),
  c("gizmoat", "arrastar", MUTA_NAO, ["gizmoat <sx> <sy> :: seleciona o dono do icone de gizmo sob o pixel (a mesma area do clique) :: gizmoat 700 400"]),
  c("grid", "objetos", MUTA_SIM, ["grid :: TOGGLE de um chao-grade (plano xadrez) em y=0 :: grid"]),
  c("groundat", "arrastar", MUTA_NAO, ["groundat <sx> <sy> :: ponto do CHAO (Y=0) sob esse pixel (a conversao tela->mundo do drop) :: groundat 700 400"]),
  c("group", "hierarquia", MUTA_SIM, ["group :: cria um no vazio e aninha os selecionados sob ele (Ctrl+G) :: group"]),
  c("help", "consulta", MUTA_NAO, ["help :: lista curta de comandos por grupo :: help"]),
  c("hier", "sistema", MUTA_NAO, ["hier [linha] :: scroll da Hierarquia (le ou rola ate a linha) :: hier 10"]),
  c("instprefab", "arquivos", MUTA_SIM, ["instprefab <path> :: instancia um prefab na cena e o seleciona :: instprefab assets/box.json"]),
  c("instscene", "cena", MUTA_SIM, ["instscene <path> [hostObj] :: CENA DENTRO DE CENA: instancia uma cena inteira sob um objeto (padrao: selecionado) :: instscene assets/subscene.json 0"]),
  c("iso", "objetos", MUTA_SIM, ["iso [obj] :: ISOLA o objeto (esconde os outros); de novo mostra todos :: iso 3"]),
  c("light", "vista", MUTA_NAO, ["light [x y z amb] :: luz legada da sessao: posicao + ambiente (0..1); sem args consulta :: light 7 13 5 0.28"]),
  c("loadobj", "arquivos", MUTA_SIM, ["loadobj <path> [nome] [x] [y] [z] :: carrega um MODELO (.obj/.glb/.gltf) e cria o(s) objeto(s); multi-material vira raiz + 1 filha por submesh :: loadobj assets/models/torus.obj Torus 0 2 0"]),
  c("loadscene", "cena", MUTA_SIM, ["loadscene <path> :: carrega uma cena JSON (substitui a atual e para o Play) :: loadscene scenes/shadowdemo.json"]),
  c("loadtex", "arquivos", MUTA_SIM, ["loadtex <obj> <path> :: carrega uma imagem (PNG/JPG/BMP) e aplica como textura no Material do objeto :: loadtex 0 assets/textures/images.jpg"]),
  c("log", "consulta", MUTA_NAO, ["log [n|erro|warn|debug|texto|clear] :: fim do log da engine com resumo de contagens :: log erro"]),
  c("ls", "arquivos", MUTA_NAO, ["ls [path] :: lista uma pasta (/ marca subpastas) :: ls assets/scenes"]),
  c("makeprefab", "arquivos", MUTA_NAO, ["makeprefab <path> [obj] :: salva o objeto como PREFAB (JSON de 1 objeto) :: makeprefab assets/box.json 1"]),
  c("menu", "objetos", MUTA_PROPRIO, ["menu [caminho] :: sem argumento lista os itens @menuItem; com caminho executa (Criar/ entra no Desfazer) :: menu Criar/Luz/Pontual"]),
  c("mesh", "transform", MUTA_SIM, ["mesh <obj> <kind> :: troca a malha primitiva (0=vazio 1=cubo 2=piramide 3=octaedro 4=esfera) :: mesh 0 4"]),
  c("mkdir", "arquivos", MUTA_NAO, ["mkdir <path> :: cria pasta (+ pais que faltarem) :: mkdir assets/scripts"]),
  c("move", "transform", MUTA_SIM, ["move <obj> <x> <y> <z> :: define a POSICAO local do objeto :: move 0 1 2 3"]),
  c("movetree", "hierarquia", MUTA_SIM, ["movetree <dragObj> <antesObj> <paiObj|-1> :: moveSubtree cru (reordenar+reparentar por indice) :: movetree 5 3 2"]),
  c("mv", "arquivos", MUTA_NAO, ["mv <de> <para> :: renomeia/move arquivo ou pasta :: mv assets/a.txt assets/b.txt"]),
  c("parent", "hierarquia", MUTA_SIM, ["parent <obj> <paiObj|-1> :: REPARENT: aninha o objeto sob o pai (-1 = raiz). Reordena os indices; re-consulte tree :: parent 5 2"]),
  c("pause", "play", MUTA_NAO, ["pause :: pausa a simulacao sem descartar suas mudancas temporarias :: pause"]),
  c("pickat", "arrastar", MUTA_NAO, ["pickat <sx> <sy> :: qual objeto esta sob esse pixel (-1 = nenhum) :: pickat 700 400"]),
  c("play", "play", MUTA_NAO, ["play :: inicia uma copia temporaria da cena ou retoma a simulacao pausada :: play"]),
  c("pose", "esqueleto", MUTA_SIM, [
    "pose <obj> <osso|nome> rot <yaw> <pitch> <roll> :: rotacao LOCAL do osso em graus; q = yaw(Y) * pitch(X local) * roll(Z local) :: pose 0 torso rot 90 0 0",
    "pose <obj> <osso|nome> pos <x> <y> <z> :: posicao LOCAL do osso :: pose 0 arm-right pos 0.1 0 0",
    "pose <obj> <osso|nome> turn <x|y|z> <graus> :: gira o osso no eixo de MUNDO (como o gizmo) :: pose 0 arm-right turn y 30",
    "pose <obj> <osso|nome> shift <dx> <dy> <dz> :: desloca o osso em MUNDO (como o gizmo) :: pose 0 arm-right shift 0 0.1 0"]),
  c("prof", "sistema", MUTA_NAO, ["prof [on|off|reset] :: tabela do profiler por secao (media), passo fixo e fisica :: prof on"]),
  c("readfile", "arquivos", MUTA_NAO, ["readfile <path> :: le o conteudo do arquivo :: readfile scenes/shadowdemo.json"]),
  c("redo", "play", MUTA_NAO, ["redo :: refaz a ultima operacao desfeita :: redo"]),
  c("rename", "objetos", MUTA_SIM, ["rename <obj> <nome...> :: renomeia o objeto (nome = resto da linha) :: rename 1 Caixa Vermelha"]),
  c("res", "consulta", MUTA_NAO, ["res :: resolucao logica atual da janela :: res"]),
  c("reset", "transform", MUTA_SIM, ["reset [obj] :: zera a rotacao e poe escala 1 (mantem a posicao) :: reset 3"]),
  c("resetpose", "esqueleto", MUTA_SIM, ["resetpose <obj> :: volta o Skeleton ao repouso, esquecendo a pose manual :: resetpose 0"]),
  c("rmcomp", "componentes", MUTA_SIM, ["rmcomp <obj> <comp> :: remove o componente (indice em comps) :: rmcomp 1 0"]),
  c("rmpath", "arquivos", MUTA_NAO, ["rmpath <path> :: deleta arquivo ou pasta (recursivo) :: rmpath assets/tmp"]),
  c("rot", "transform", MUTA_PROPRIO, [
    "rot <obj> <yaw> <pitch> [roll] :: define a ROTACAO local em graus (yaw = Y, pitch = X, roll = Z, padrao 0; a mesma convencao do pose rot; no Inspector X=pitch Y=yaw Z=roll) :: rot 0 90 0",
    "rot <obj> :: le a rotacao local e de mundo em graus (consulta: sem Desfazer) :: rot Cubo"]),
  c("savescene", "cena", MUTA_NAO, ["savescene <path> :: SALVA a cena num JSON e passa a ser o documento aberto (dispara o gancho salvar) :: savescene assets/minhacena.json"]),
  c("scene", "consulta", MUTA_NAO, ["scene json [obj] :: a cena inteira no JSON que o save grava (ou so um objeto), SEM salvar nem mudar o documento :: scene json"]),
  c("scl", "transform", MUTA_SIM, ["scl <obj> <sx> <sy> <sz> :: escala NAO-uniforme :: scl 0 1 6 1"]),
  c("selbone", "esqueleto", MUTA_NAO, ["selbone <obj> <osso|nome|-1> :: escolhe o osso do gizmo/Inspector (objeto ja selecionado; -1 = volta ao objeto) :: selbone 0 arm-right"]),
  c("select", "objetos", MUTA_NAO, ["select <obj> :: seleciona o objeto (limpa a multi-selecao) :: select 3"]),
  c("selectadd", "objetos", MUTA_NAO, ["selectadd <obj> :: adiciona o objeto a MULTI-selecao :: selectadd 2"]),
  c("selectclear", "objetos", MUTA_NAO, ["selectclear :: volta pra selecao unica (esvazia a multi) :: selectclear"]),
  c("setcustom", "arquivos", MUTA_SIM, ["setcustom <obj> <meshId> :: DEBUG: forca o customMesh de um objeto (0=primitivo) :: setcustom 1 5"]),
  c("setfield", "componentes", MUTA_PROPRIO, ["setfield <obj> <comp|Nome> <campo|nome> <valor> :: edita um campo como o Inspector (roda onValidate). valor: numero, true/false, texto (entre aspas ou resto da linha), #RRGGBB (cor), opcao da lista (enum), x,y,z (Transform position/rotation/scale; rotation em graus X,Y,Z do Inspector) :: setfield Luz Light cor #FF8800"]),
  c("snap", "transform", MUTA_NAO, ["snap [0|1] :: liga/desliga o snap-to-grid do gizmo (move 0.5, rotate 15) :: snap 1"]),
  c("snd", "sistema", MUTA_NAO, ["snd [freq dur vol] :: toca um beep e mostra o estado do mixer :: snd 440 0.2 0.3"]),
  c("spawn", "objetos", MUTA_SIM, ["spawn <nome> <x> <y> <z> [kind] [escala] :: cria objeto; kind 1=cubo 2=piramide 3=octaedro 4=esfera; nasce estatico :: spawn Cubo 0 2 0 1 1.5"]),
  c("spin", "transform", MUTA_SIM, ["spin <obj> <spdY> [spdX] :: anexa um Spinner (atalho) :: spin 0 1.2"]),
  c("state", "consulta", MUTA_NAO, ["state :: estado da cena e da camera; por objeto: kind, pos, rot (yaw,pitch,roll em graus), escala :: state"]),
  c("stop", "play", MUTA_NAO, ["stop :: descarta a simulacao e restaura a cena de edicao e seu historico :: stop"]),
  c("thumb", "arrastar", MUTA_NAO, ["thumb <path> [cols] :: INSPECIONA o thumbnail que o Project mostra pro asset: estatisticas de pixel + preview ASCII (| = quebra de linha) :: thumb assets/models/torus.obj 16"]),
  c("tool", "transform", MUTA_NAO, ["tool [move|rotate|scale|select] :: troca/consulta a ferramenta do gizmo da viewport :: tool rotate"]),
  c("tree", "hierarquia", MUTA_NAO, ["tree :: hierarquia: indice, nome, indice do pai (-1=raiz) :: tree"]),
  c("undo", "play", MUTA_NAO, ["undo :: desfaz a ultima operacao mutante (snapshot da cena) :: undo"]),
  c("ungroup", "hierarquia", MUTA_SIM, ["ungroup [obj] :: dissolve o grupo (passa a pose de mundo aos filhos e remove o no) :: ungroup 8"]),
  c("view", "vista", MUTA_NAO, ["view <top|front|side|persp> :: posiciona a camera do editor num preset olhando a origem :: view top"]),
  c("vis", "objetos", MUTA_SIM, ["vis [obj] :: TOGGLE de visibilidade do objeto (active) :: vis 3"]),
  c("vsync", "sistema", MUTA_NAO, ["vsync <0|1> :: liga/desliga a espera do monitor (0 mede o custo real do quadro) :: vsync 0"]),
  c("writefile", "arquivos", MUTA_NAO, ["writefile <path> <conteudo> :: escreve (conteudo = resto da linha, 1 linha) :: writefile assets/nota.txt oi mundo"]),
];

function nomesDoManifesto(): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < BUILTIN_MANIFEST.length) { out.push(BUILTIN_MANIFEST[i].nome); i = i + 1; }
  return out;
}
export const BUILTIN_COMMANDS: string[] = nomesDoManifesto();

/// Entrada do manifesto de um comando embutido (null = não é embutido).
export function comandoEmbutido(nome: string): ComandoInfo | null {
  const i = BUILTIN_COMMANDS.indexOf(nome);
  return i >= 0 ? BUILTIN_MANIFEST[i] : null;
}

/// Consultas puras (muta NAO no grupo "consulta"): o despacho não as registra
/// no log — encheriam o histórico com as próprias perguntas, inclusive a
/// consulta ao log. Comando desconhecido ou de pacote é registrado.
export function registraNoLog(nome: string): boolean {
  const info = comandoEmbutido(nome);
  return info === null || !(info.muta === MUTA_NAO && info.grupo === GRUPO_CONSULTA);
}
export const GRUPO_CONSULTA: string = "consulta";

/// "[erro] uso: <assinaturas>" do comando embutido (todas as formas).
export function erroUso(nome: string): string {
  const info = comandoEmbutido(nome);
  if (info === null) return "[erro] uso: " + nome;
  let s = "[erro] uso: ";
  let i = 0;
  while (i < info.usos.length) {
    s = s + (i > 0 ? " | " : "") + info.usos[i].split(SEPARADOR_USO)[0];
    i = i + 1;
  }
  return s;
}
