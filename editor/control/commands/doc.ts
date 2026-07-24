// Comando `doc` — documentação de CADA comando (assinatura :: descrição ::
// exemplo), pra uma IA descobrir como usar a porta de controle. `doc` lista tudo;
// `doc <prefixo>` filtra (ex.: `doc addcomp`).

// prefixo simples (só charCodeAt — robusto no motor)
function startsWith(s: string, p: string): boolean {
  if (p.length > s.length) return false;
  let i = 0;
  while (i < p.length) { if (s.charCodeAt(i) !== p.charCodeAt(i)) return false; i = i + 1; }
  return true;
}

export function cmdDoc(parts: string[]): string {
  let q = "";
  if (parts.length > 1) q = parts[1];
  const lines: string[] = [
    "state :: estado da cena+camera (objs, sel, playing, cam, drawn) :: state",
    "res :: resolucao logica atual da janela :: res",
    "help :: lista curta de comandos :: help",
    "doc [prefixo] :: esta documentacao (todos ou filtrado) :: doc addcomp",
    "dbg :: diagnostico de render (ativos/wouldDraw/drawnLast) :: dbg",
    "tree :: hierarquia: indice, nome, indice do pai (-1=raiz) :: tree",
    "spawn <nome> <x> <y> <z> [kind] [escala] :: cria objeto; kind 1=cubo 2=piramide 3=octaedro 4=esfera; nasce estatico :: spawn Cubo 0 2 0 1 1.5",
    "move <i> <x> <y> <z> :: define a POSICAO do objeto i :: move 0 1 2 3",
    "scl <i> <sx> <sy> <sz> :: escala NAO-uniforme :: scl 0 1 6 1",
    "mesh <i> <kind> :: troca a malha (1..4) :: mesh 0 4",
    "color <i> <r> <g> <b> :: cor 0..255 :: color 0 240 90 60",
    "spin <i> <spdY> [spdX] :: anexa um Spinner (atalho) :: spin 0 1.2",
    "select <i> :: seleciona o objeto (fica dourado) :: select 3",
    "delete <i> :: remove o objeto :: delete 3",
    "dup [i] :: duplica o objeto (default=selecionado), deslocado em +1 X; seleciona a copia. Clona transform+aparencia + os scripts de gameplay :: dup 3",
    "cam <x> <y> <z> <yaw> <pitch> :: posiciona a camera (radianos) :: cam 0 11 -15 0 -0.5",
    "focus <i> :: enquadra a camera no objeto (achar/frame selected) :: focus 0",
    "play :: liga a animacao (update dos componentes) :: play",
    "pause :: desliga a animacao :: pause",
    "clear :: esvazia a cena :: clear",
    "tool [move|rotate|scale|select] :: troca/consulta a ferramenta do gizmo da viewport (a IA dirige o mesmo gizmo do humano) :: tool rotate",
    "loadscene <path> :: carrega uma cena JSON (substitui a atual) :: loadscene scenes/shadowdemo.json",
    "savescene <path> :: SALVA a cena atual num JSON (fecha o loop com loadscene) :: savescene assets/minhacena.json",
    "instscene <path> [hostIdx] :: CENA DENTRO DE CENA: instancia uma cena inteira sob um objeto (default=selecionado); mover o host move a sub-cena toda :: instscene assets/subscene.json 0",
    "loadtex <obj> <path> :: carrega uma imagem (PNG/JPG/BMP) e aplica como textura no Material do objeto :: loadtex 0 images.jpg",
    "parent <filho> <pai> :: REPARENT: aninha filho sob pai (pai=-1 => raiz). Reordena o array; re-consulte tree depois :: parent 5 2",
    "movetree <drag> <before> <newparent> :: moveSubtree cru (reordenar+reparent por indice) :: movetree 5 3 2",
    "complist :: nomes dos componentes que da pra adicionar :: complist",
    "comps <obj> :: componentes do objeto + campos e valores :: comps 1",
    "addcomp <obj> <nome> :: anexa um componente ao objeto :: addcomp 1 Orbit",
    "rmcomp <obj> <compIdx> :: remove o componente :: rmcomp 1 0",
    "setfield <obj> <compIdx> <campoIdx> <valor> :: edita um campo de config do componente :: setfield 1 0 0 2.5",
    "ls [path] :: lista uma pasta (/ marca subpastas) :: ls assets/scenes",
    "mkdir <path> :: cria pasta (+ pais que faltarem) :: mkdir assets/scripts",
    "rmpath <path> :: deleta arquivo ou pasta (recursivo) :: rmpath assets/tmp",
    "readfile <path> :: le o conteudo do arquivo :: readfile scenes/shadowdemo.json",
    "writefile <path> <conteudo> :: escreve (conteudo = resto da linha, 1 linha) :: writefile assets/nota.txt oi mundo",
    "mv <de> <para> :: renomeia/move :: mv assets/a.txt assets/b.txt",
    "loadobj <path> [nome] [x] [y] [z] :: carrega um .obj REAL e cria um objeto com ele :: loadobj assets/models/torus.obj Torus 0 2 0",
  ];
  let m = "[doc]\n";
  let hit = 0;
  let i = 0;
  while (i < lines.length) {
    if (q.length === 0 || startsWith(lines[i], q)) { m = m + lines[i] + "\n"; hit = hit + 1; }
    i = i + 1;
  }
  if (hit === 0) return "[doc] nenhum comando com prefixo '" + q + "'";
  return m;
}
