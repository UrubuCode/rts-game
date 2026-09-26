// Configuracao visual do editor. Mude aqui antes de ajustar coordenadas no frame.
// Medidas em pixels logicos; o estado mutavel dos paineis permanece em main.ts.
export const UI_MENU_H = 24;
export const UI_CONTROL_ROW_H = 46;
export const UI_BAR_H = UI_MENU_H + UI_CONTROL_ROW_H;
export const UI_STATUS_H = 24;
export const UI_HIER_DEFAULT = 250;
export const UI_INSP_DEFAULT = 290;
export const UI_PROJECT_DEFAULT = 200;
export const UI_HIER_MIN = 180;
export const UI_INSP_MIN = 260;
export const UI_PROJECT_MIN = 150;
export const UI_SCENE_MIN_W = 320;
export const UI_SCENE_MIN_H = 190;
export const UI_HIER_HEADER_H = 22;
export const UI_HIER_SEARCH_H = 60;
export const UI_HIER_ROW_H = 26;
export const UI_HIER_INDENT = 16;
export const UI_HIER_SCROLL_STEP = 3;
export const UI_HIER_DROP_EDGE = 8;
export const UI_SCROLL_THUMB_MIN_H = 24;
export const UI_NUMERIC = {
  height: 20, axisWidth: 16, padding: 6, textY: 3, font: 12,
  charWidth: 7, labelFraction: 0.44, labelGap: 8,
};
export const UI_COMPONENT_PICKER = {
  margin: 14, padding: 10, gap: 6, titleH: 30, searchH: 20,
  breadcrumbH: 28, rowH: 30, detailH: 72, maxRows: 7,
  buttonH: 24, font: 13, smallFont: 11, charW: 7,
  textY: 7, border: 1, radius: 4, scrollbarW: 3,
  searchId: 950, rowId: 1800, closeId: 1799,
  title: "Adicionar componente", searchHint: "Buscar nome ou função...",
  root: "Componentes", empty: "Nenhum componente encontrado",
  emptyHint: "Tente outro nome ou função.",
  help: "Enter seleciona • Esc fecha",
  categoryHint: "Escolha uma categoria ou busque.",
};
// Codigos do backend de input usados pelo navegador de componentes.
export const UI_PICKER_KEYS = { enter: 1, escape: 2, up: 5, down: 6, left: 7, right: 8 };
export const UI_INSPECTOR_SCROLL_STEP = 52;
export const UI_INSPECTOR = {
  padding: 12, gap: 6, rowH: 26, headerH: 24, objectH: 62,
  labelW: 62, axisGap: 3, font: 12, titleFont: 13, textY: 5,
  radius: 3, border: 1, iconW: 22, scrollbarW: 5, scrollbarHitW: 12,
  minThumbH: 24, footerH: 42, controlId: 4000,
  nameId: 951, title: "Inspector", transform: "Transform",
  appearance: "Geometria e material", position: "Posição", rotation: "Rotação", scale: "Escala",
  empty: "Selecione um objeto", emptyHint: "na Hierarquia ou na Cena.",
  active: "Ativo", stationary: "Estático", mesh: "Malha", texture: "Textura",
  changeMesh: "Próxima primitiva", noComponents: "Sem componentes adicionais",
  parent: "Pai: ", unparent: "Desaninhar", charWidth: 7,
};
export const UI_PLAY = {
  buttonW: 66, gap: 4, textY: 7, radius: 3, id: 5000,
  labels: ["Rodar", "Pausar", "Parar"],
  editing: "Editando", running: "Simulando • mudanças temporárias", paused: "Pausado • mudanças temporárias",
  saveBlocked: "Pare a simulação para salvar ou gerar o jogo.",
};
export const UI_MESH_NAMES: string[] = ["Sem malha", "Cubo", "Pirâmide", "Octaedro", "Esfera"];
export const UI_AXIS_NAMES: string[] = ["X", "Y", "Z"];
export const UI_CONTEXT_W = 168;
export const UI_CONTEXT_ROW_H = 24;
export const UI_PROJECT_HEADER_H = 24;
export const UI_PROJECT_PATH_Y = UI_PROJECT_HEADER_H + 2;
export const UI_PROJECT_PATH_H = 22;
export const UI_PROJECT_TOOL_W = 68;
export const UI_PROJECT_GRID_Y = UI_PROJECT_PATH_Y + UI_PROJECT_PATH_H + 6;
export const UI_PROJECT_TILE_W = 84;
export const UI_PROJECT_TILE_H = 78;
export const UI_PROJECT_ICON_SIZE = 46;
export const UI_PROJECT_TILE_GAP = 8;
export const UI_PROJECT_DRAG_DISTANCE_SQ = 25;
export const UI_PROJECT_THUMB_MIN_H = 18;
// Treeview do Project: mesmas medidas para desenho, hit-test e scroll.
export const UI_PROJECT_TREE_W = 180;
export const UI_PROJECT_TREE_FRACTION = 0.35;
export const UI_PROJECT_TREE_ROW_H = 22;
export const UI_PROJECT_TREE_INDENT = 14;
export const UI_PROJECT_TREE_PADDING = 6;
export const UI_PROJECT_TREE_TOGGLE_W = 16;
export const UI_PROJECT_TREE_ICON_SIZE = 10;
export const UI_PROJECT_TREE_ICON_GAP = 5;
export const UI_PROJECT_TREE_FONT = 12;
export const UI_PROJECT_TREE_CHAR_W = 7;
export const UI_PROJECT_TREE_SCROLL_STEP = 3;
export const UI_PROJECT_TREE_SCROLL_W = 5;
export const UI_PROJECT_TREE_MAX_DEPTH = 32;
export const UI_PROJECT_TREE_ROOT_LABEL = "Assets";
export const UI_PROJECT_CONTENT_PADDING = 10;
export const UI_MENU_W = 230;
export const UI_MENU_ROW_H = 27;
export const UI_MENU_PADDING = 8;
export const UI_MENU_START_X = 8;
export const UI_MENU_GAP = 4;
export const UI_SCENE_HEADER_H = 27;
export const UI_TOOL_X = 8;
export const UI_TOOL_Y = 32;
export const UI_TOOL_W = 248;
export const UI_TOOL_H = 36;
export const UI_TOOL_BUTTON_W = 54;
export const UI_TOOL_BUTTON_H = 28;
export const UI_TOOL_BUTTON_STEP = UI_TOOL_BUTTON_W + 4;
export const UI_CONTROL_Y = UI_MENU_H + 9;
export const UI_CONTROL_H = 28;

export const UI_MENU_NAMES: string[] = ["Arquivo", "Editar", "Criar", "Configurações", "Ajuda"];
export const UI_MENU_BUTTON_W: number[] = [66, 56, 54, 120, 52];
export const UI_TOOLS: string[] = ["Mover", "Girar", "Escala", "Grade"];
export const UI_FILE_ACTIONS: string[] = ["Abrir cena...", "Nova cena", "Salvar cena    Ctrl+S", "Salvar como...", "Build do jogo"];
export const UI_EDIT_ACTIONS: string[] = ["Desfazer    Ctrl+Z", "Refazer    Ctrl+Y", "Duplicar    Ctrl+D", "Excluir    Delete"];
export const UI_CONTEXT_ACTIONS: string[] = ["Duplicar", "Excluir"];
export const UI_HELP_ACTIONS: string[] = ["Atalhos e navegação"];

// Paleta compartilhada pelos paineis legados e pelos gizmos. Os nomes descrevem
// o papel visual; nao codificam RGB nos consumidores.
export const UI_SCRIPT_DROP = {
  cursorX: 12, cursorY: 24, width: 510, height: 28, padding: 8,
  noticeX: 12, noticeY: 8, noticeFrames: 360,
  ready: "Adicionar componente em ",
};

export const UI_CODE_EDITOR = {
  title: "Editor de codigo", pathLabel: "Caminho do executavel (.exe)",
  installed: "Escolha um editor instalado", system: "Padrao do Windows",
  custom: "Personalizado", browse: "Procurar...", selected: "> ",
  empty: "Nenhum editor detectado. Use Procurar para selecionar um .exe.",
  hint: "Vazio usa o padrao do Windows. Preferencia local deste projeto.",
  save: "Salvar", cancel: "Cancelar", width: 620, height: 250,
  padding: 18, rowH: 26, listY: 80, listGap: 4, labelY: 52,
  buttonW: 90, gap: 10, fieldId: 78000,
};

export const UI_CONSOLE = {
  padding: 8, gap: 4, toolbarH: 30, buttonH: 22, rowH: 22, detailH: 68,
  detailHeaderH: 22, detailLineH: 16, footerH: 20, clearW: 80, collapseW: 90,
  counterW: 60, iconButtonW: 30, iconSize: 16, iconGap: 6, scrollbarW: 4, repeatW: 40,
  charW: 7, font: 12, smallFont: 11, textY: 4, border: 1, radius: 2,
  narrowW: 510, searchId: 78100, scrollStep: 3,
  clear: "Limpar", collapse: "Agrupar", search: "Buscar mensagens...",
  levels: ["Informacoes", "Avisos", "Erros"], icons: ["info", "warning", "error"],
  empty: "Nenhuma mensagem no Console", emptyFiltered: "Nenhuma mensagem corresponde aos filtros",
  hint: "Selecione uma mensagem para ver os detalhes", open: "Abrir fonte", details: "DETALHES",
  follow: "Acompanhar novas mensagens", paused: "Rolagem pausada", count: " mensagens",
};
export const UI_ICONS = {
  directory: "assets/editor/icons/", maxPixels: 256,
  names: ["info", "warning", "error", "clear", "collapse", "search", "follow"],
};
export const UI_WORKSPACE = {
  tabs: ["Cena", "Jogo"], bottomTabs: ["Project", "Console"], tabW: 90, tabH: 24,
  gap: 4, padding: 6, noCamera: "Nenhuma Camera ativa. Adicione Camera a um GameObject.",
  gameHint: "Jogo: camera da cena, sem ferramentas de edicao",
  buildRunning: "Compilando jogo... acompanhe no Console", buildResult: "Build: resultado e caminho no Console",
};
export const UI_DOCUMENT = {
  width: 540, height: 194, padding: 16, rowH: 28, gap: 8,
  title: "Alteracoes nao salvas", hint: "Deseja salvar antes de continuar?",
  save: "Salvar e continuar", discard: "Descartar", cancel: "Cancelar",
  untitled: "Sem titulo", pollMs: 750,
};

export const UI_C = {
  consoleBackground: 0x26282CFF, consoleToolbar: 0x303237FF,
  consoleRowAlternate: 0x2B2D31FF, consoleHover: 0x383C43FF,
  consoleSelected: 0x344D68FF, consoleActive: 0x414A55FF,
  consoleBorder: 0x1F2125FF, consoleDetail: 0x222428FF,
  consoleText: 0xD2D5DBFF, consoleMuted: 0x8F969FFF,
  consoleAccent: 0x80B7E2FF, consoleScroll: 0x666D76FF,
  white: 0xFFFFFFFF,
  axisSelected: 0xFFFFFFCC,
  axisX: 0xE05A5AFF,
  axisY: 0x6ABF4BFF,
  axisZ: 0x4B8FE0FF,
  widgetAxisX: 0xC85A5AFF,
  widgetAxisY: 0x88C05AFF,
  widgetAxisZ: 0x5A82C8FF,
  axisXY: 0xC8C860AA,
  axisXZ: 0xC860C8AA,
  axisYZ: 0x60C8C8AA,
  gizmoCenter: 0xCCCCCCFF,
  toolbar: 0x393939FF,
  menuOpen: 0x475B75FF,
  menuText: 0xD2D2D2FF,
  border: 0x232323FF,
  brandText: 0xE0E7F0FF,
  controlIdle: 0x2D2D2DFF,
  controlHover: 0x454545FF,
  controlActive: 0x4A75B0FF,
  controlText: 0xE0E0E0FF,
  buildIdle: 0x2D6A3AFF,
  buildHover: 0x3D8A4AFF,
  buildText: 0xE8E8E8FF,
  primaryText: 0xC8C8C8FF,
  secondaryText: 0x909090FF,
  sceneTab: 0x41444BFF,
  sceneTabText: 0xD8D8D8FF,
  sceneHeader: 0x2B2D32EE,
  toolIdle: 0x333842FF,
  toolHover: 0x454B56FF,
  toolBorder: 0x1D222AFF,
  toolText: 0xE2E7EDFF,
  toolBack: 0x252932EE,
  toolBackBorder: 0x15191FFF,
  panel: 0x383838FF,
  panelHeader: 0x303030FF,
  widgetHeader: 0x3C3C3CFF,
  panelTab: 0x424242FF,
  panelTitle: 0xCACACAFF,
  panelCount: 0x808080FF,
  placeholder: 0x777777FF,
  searchResult: 0x9AAFD0FF,
  hint: 0x8A8A8AFF,
  rowIdle: 0x333333FF,
  rowDropTarget: 0x2E5A3AFF,
  hierarchyBranch: 0x556377FF,
  emptyText: 0xA0A0A0FF,
  scrollbarTrack: 0x2A2A2AFF,
  scrollbarThumb: 0x5A5A5AFF,
  scrollbarHover: 0x6E6E6EFF,
  scrollbarDrag: 0x8AA0BFFF,
  dropMarker: 0x77DD99FF,
  dragGhost: 0x2E4E86EE,
  dragGhostBorder: 0x88BBFFFF,
  inspectorEmptyTitle: 0xD0D0D0FF,
  inspectorEmptyHint: 0x919191FF,
  parentText: 0x9A9A9AFF,
  disabledText: 0x707070FF,
  sectionTitle: 0xB8B8B8FF,
  componentHeader: 0x414141FF,
  componentChevron: 0xB0B0B0FF,
  componentEnabled: 0x5A7FB0FF,
  componentScrollTrack: 0x292929FF,
  componentScrollThumb: 0x7891B0FF,
  popupDark: 0x252525FF,
  menuPopup: 0x24272CFF,
  menuPopupBorder: 0x4D5560FF,
  menuItemHover: 0x405D82FF,
  menuItemText: 0xDEE3E9FF,
  fieldSelection: 0x3A6C9FFF,
  axisLabelText: 0x101010FF,
  numberEditor: 0x1A1F28FF,
  numberEditorBorder: 0x3399FFFF,
  checkboxMark: 0x66BB66FF,
  assetFolder: 0xCBAF5AFF,
  assetScene: 0x66BB77FF,
  assetPrefab: 0x5AC8C8FF,
  assetImage: 0xB06AC8FF,
  assetScript: 0x5A82C8FF,
  assetPreset: 0xD2963EFF,
  assetModel: 0x9AA0A8FF,
  assetText: 0x808890FF,
  assetOther: 0x6A6A6AFF,
  assetDragGhost: 0x1E1E22EE,
  assetThumbnailLight: 0xFFFFFFAA,
  assetThumbnailShadow: 0x00000066,
  assetThumbnailLabel: 0x101014FF,
  assetDeleteWarning: 0xE8A0A0FF,
  assetDeleteArmed: 0x6A3030FF,
  assetSelectionGhost: 0x5A7FB055,
  popupDarkBorder: 0x151515FF,
  popupHover: 0x3A5A80FF,
  popupText: 0xD4D4D4FF,
  statusText: 0xB8C1CDFF,
  splitterHover: 0x6A9DD2FF,
  dropTint: 0x77DD9955,
  contextBorder: 0x3C3C3CFF,
  contextHover: 0x3A5A8AFF,
  destructiveText: 0xE08080FF,
  helpBackground: 0x242931F7,
  helpBorder: 0x6680A0FF,
  helpTitle: 0xE7ECF4FF,
  helpText: 0xCFD6DFFF,
  boneSelected: 0x344D68FF,
  boneRow: 0x2F2F2FFF,
  clipActive: 0x4A75B0FF,
  timelineTrack: 0x252525FF,
  timelineFill: 0x3A6C9FFF,
  timelineHandle: 0xD8E4F2FF,
  timelineText: 0xE6E6E6FF,
};
// Seção "Esqueleto" do Inspector (Skeleton + AnimationPlayer). As medidas de
// linha/cabeçalho são as de UI_INSPECTOR; aqui ficam só as próprias da seção.
export const UI_SKELETON = {
  boneIndent: 12, maxIndentDepth: 8, boneRowH: 22, clipRowH: 22,
  timelineH: 20, handleW: 4, buttonGap: 6, textY: 3,
  title: "Esqueleto", bones: "Ossos", clips: "Clipes",
  play: "Tocar", pause: "Pausar", stop: "Parar", resetPose: "Resetar pose",
  noModel: "Modelo não carregado", noClips: "O modelo não tem clipes",
  noPlayer: "Adicione um AnimationPlayer", noPlayerHint: "para tocar os clipes.",
  timeUnit: " s", timeSeparator: " / ", timeDigits: 2,
  countOpen: " (", countClose: ")", clipDurationOpen: "  (", clipDurationClose: ")",
  // campos do osso selecionado (rotação em graus: yaw/pitch/roll, a mesma
  // convenção do `pose rot` do WebSocket; posição local ao pai)
  boneSelected: "Osso: ", boneRotation: "Rot. (°)", bonePosition: "Posição",
  rotationAxes: ["Y", "P", "R"],
};
