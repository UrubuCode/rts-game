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
    "cam <x> <y> <z> <yaw> <pitch> :: posiciona a camera (radianos) :: cam 0 11 -15 0 -0.5",
    "play :: liga a animacao (update dos componentes) :: play",
    "pause :: desliga a animacao :: pause",
    "clear :: esvazia a cena :: clear",
    "loadscene <path> :: carrega uma cena JSON (substitui a atual) :: loadscene scenes/shadowdemo.json",
    "parent <filho> <pai> :: REPARENT: aninha filho sob pai (pai=-1 => raiz). Reordena o array; re-consulte tree depois :: parent 5 2",
    "movetree <drag> <before> <newparent> :: moveSubtree cru (reordenar+reparent por indice) :: movetree 5 3 2",
    "complist :: nomes dos componentes que da pra adicionar :: complist",
    "comps <obj> :: componentes do objeto + campos e valores :: comps 1",
    "addcomp <obj> <nome> :: anexa um componente ao objeto :: addcomp 1 Orbit",
    "rmcomp <obj> <compIdx> :: remove o componente :: rmcomp 1 0",
    "setfield <obj> <compIdx> <campoIdx> <valor> :: edita um campo de config do componente :: setfield 1 0 0 2.5",
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
