// Comandos de CONSULTA (só leem estado): state, res, help.
import { scene, S } from "../session";
import { setVsync } from "@engine/render/gpu3d";
import { commandHelpLine } from "../../api";
import { argInt } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";

/// Estado completo da cena + câmera (para a IA inspecionar).
export function cmdState(): string {
  let m = "[state] objs=" + scene.objects.length + " sel=" + S.selected + " playing=" + S.playing + " drawn=" + S.drawnLast +
          " tool=" + S.tool + " cam=(" + S.camX + "," + S.camY + "," + S.camZ + ") yaw=" + S.camYaw + " pitch=" + S.camPitch;
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i];
    m = m + " | #" + i + " " + o.name + " k" + o.meshKind + " cm" + o.customMesh +
        " pos(" + o.transform.px + "," + o.transform.py + "," + o.transform.pz + ")" +
        " scl(" + o.transform.sx + "," + o.transform.sy + "," + o.transform.sz + ")";
    i = i + 1;
  }
  return m;
}

/// Resolução lógica atual da janela.
export function cmdRes(w: number, h: number): string {
  return "[res] " + w + " x " + h;
}

/// Autodescrição: lista de comandos + assinatura (a IA descobre o que pode fazer).
export function cmdHelp(): string {
  return "[help] comandos (use 'doc' p/ detalhes+exemplos de cada um):" +
    " state | res | help | doc [prefixo] | dbg | tree | undo | redo" +
    " | spawn <nome> <x> <y> <z> [kind] [scale]  (kind 1=cubo 2=piramide 3=octaedro 4=esfera)" +
    " | move <i> <x> <y> <z>" +
    " | scl <i> <sx> <sy> <sz> | reset [i] | align [i] [step]" +
    " | mesh <i> <kind>" +
    " | color <i> <r> <g> <b>  (0..255)" +
    " | spin <i> <spdY> [spdX]" +
    " | rename <i> <nome> | select <i> | selectadd <i> | selectclear  (multi-seleção) | delete <i> | delsel  (deleta a seleção) | dup [i] | dupn <n> <espaço> [i]  (array)" +
    " | cam <x> <y> <z> <yaw> <pitch> | focus <i> | frameall | view <top|front|side|persp> | light [x y z amb] <top|front|side|persp> | grid  (chão xadrez) | vis [i] | iso [i]  (ocultar/isolar)" +
    " | tool [move|rotate|scale|select]  (gizmo da viewport) | snap [0|1]  (snap-to-grid)" +
    " | play | pause | stop | clear" +
    " | loadscene <path> | savescene <path> | instscene <path> [hostIdx]  (cena dentro de cena)" +
    " | parent <filho> <pai> | movetree <drag> <before> <newparent> | group | ungroup [i]" +
    " | menu [caminho]  (itens de script: Criar/…, Janela/…)" +
    " | gameview [jogo|cena|proporcao livre|16:9|4:3|camera todas|<obj>|previa on|off]  (aba Jogo)" +
    " || COMPONENTES: complist | comps <obj> | addcomp <obj> <nome> |" +
    " rmcomp <obj> <compIdx> | setfield <obj> <compIdx> <campoIdx> <valor>" +
    " || OSSOS/ANIMACAO: addskel <obj> <caminho.glb>  (Skeleton+AnimationPlayer) |" +
    " bones <obj> | pose <obj> <osso|nome> rot <yaw> <pitch> <roll>  (graus; q=yaw(Y)*pitch(Xlocal)*roll(Zlocal)) |" +
    " pose <obj> <osso|nome> pos <x> <y> <z> | pose ... turn <x|y|z> <graus> | pose ... shift <dx> <dy> <dz> |" +
    " resetpose <obj> | selbone <obj> <osso|-1> | anims <obj>  (clipes+duracao) |" +
    " anim <obj> play <nome> [loop|once] | anim <obj> pause | anim <obj> resume |" +
    " anim <obj> seek <s> | anim <obj> fade <nome> <s> | anim <obj> speed <x> | anim <obj> state" +
    " || ANIMATOR: animator <obj> load <arquivo.controller.json> | animator <obj> set <param> <valor> |" +
    " animator <obj> trigger <param> | animator <obj> state | animator <obj> params" +
    " || TEXTURA/MESH: makeprefab <path> [i] | instprefab <path> | loadobj <path> [nome]  (.obj/.glb/.gltf) | loadtex <obj> <path>" +
    " || DRAG&DROP: drop <path> [sx sy] | dropat <path> <x> <y> <z> | dropon <path> <obj> |" +
    " pickat <sx> <sy> | gizmoat <sx> <sy>  (clica num ícone de gizmo) | groundat <sx> <sy> | thumb <path> [cols]  (preview do asset)" +
    " || ARQUIVOS: ls [path] | mkdir <path> | rmpath <path> | readfile <path> |" +
    " writefile <path> <conteudo> | mv <de> <para>" + commandHelpLine();
}

/// vsync [0|1] — liga/desliga a espera pelo refresh do monitor.
///
/// Com vsync ligado (padrão) o FPS satura em ~60 e ESCONDE o custo real do
/// frame: 5 ms e 16 ms medem igual. Desligar mede a performance de verdade.
export function cmdVsync(parts: string[]): string {
  const pedido = argInt(parts, 1);
  if (pedido !== 0 && pedido !== 1) return erroUso("vsync");
  const on = pedido;
  setVsync(S.win, on);
  return "[ok] vsync " + (on !== 0 ? "LIGADO (limitado ao monitor)" : "DESLIGADO (mede o frame real)");
}
