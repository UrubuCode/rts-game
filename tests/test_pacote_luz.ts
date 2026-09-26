// Teste SEM JANELA do pacote luz/: comandos `luz`/`luzes`, itens Criar/Luz/*
// e o gizmo da luz (ícone por tipo; seta, esfera ou cone quando selecionada).
//   rts.exe run tests/test_pacote_luz.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { Light } from "@engine/core/light";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { gizmosBegin, GIZMO_SEGMENTOS_CIRCULO, GIZMO_ARESTAS_CONE } from "@engine/core/gizmos";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "luz add pontual 1 2 3").indexOf("[ok] #0") === 0, "luz add");
const l = scene.objects[0].behaviors[0] as Light;
check(l.tipo === "pontual" && scene.objects[0].transform.px === 1.0 && history.undoDepth() === 1, "pontual em (1,2,3) com Desfazer");
check(execCommand(800, 600, "luz 0 set cor #ff8000").indexOf("[ok]") === 0 && l.cor === 0xFF8000, "cor");
check(execCommand(800, 600, "luz 0 set intensidade 2.5").indexOf("[ok]") === 0 && l.intensidade === 2.5, "intensidade");
check(execCommand(800, 600, "luz 0 set tipo spot").indexOf("[ok]") === 0 && l.tipo === "spot", "tipo");
check(execCommand(800, 600, "luz 0 set tipo lanterna").indexOf("[erro]") === 0, "tipo inválido");
check(execCommand(800, 600, "luz 0 set cor laranja").indexOf("[erro]") === 0, "cor inválida");
check(execCommand(800, 600, "luz 7 set cor #ffffff").indexOf("[erro]") === 0, "objeto sem luz");
check(execCommand(800, 600, "luz add lanterna 0 0 0").indexOf("[erro]") === 0, "add com tipo inválido");
const d = history.undoDepth();
check(execCommand(800, 600, "luzes").indexOf("#0 Luz Pontual tipo=spot cor=#FF8000") > 0 && history.undoDepth() === d, "luzes é consulta");
check(execCommand(800, 600, "help").indexOf("luz add") > 0, "comando no help");
// itens de menu
S.camX = 0.0; S.camY = 0.0; S.camZ = 0.0; S.camYaw = 0.0; S.camPitch = 0.0;
check(executarItemDeMenu(indiceDoCaminho("Criar/Luz/Spot"), 0 - 1) === "", "Criar/Luz/Spot");
const spot = scene.objects[S.selected];
check(spot.name === "Luz Spot" && spot.transform.pz === 8.0 && Math.abs(spot.transform.rx + Math.PI / 2.0) < 1e-12, "spot nasce à frente apontando para baixo");
check(indiceDoCaminho("Criar/Luz/Direcional") >= 0 && indiceDoCaminho("Criar/Luz/Pontual") >= 0, "os três itens");
// gizmo
scene.computeWorld();
const gp = new Float64Array(8); gp[2] = 0 - 20.0; gp[5] = 1.0; gp[6] = 1280.0; gp[7] = 720.0;
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0 - 1);
check(gizmosDoEditor.nIc === 2 && gizmosDoEditor.icNomes[0] === "luz-spot" && gizmosDoEditor.nSeg === 0, "só ícones sem seleção");
l.tipo = "pontual";
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0);
check(gizmosDoEditor.nSeg === 3 * GIZMO_SEGMENTOS_CIRCULO && gizmosDoEditor.icNomes[0] === "luz-pontual", "pontual selecionada: esfera de alcance");
l.tipo = "spot";
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0);
check(gizmosDoEditor.nSeg === GIZMO_SEGMENTOS_CIRCULO + GIZMO_ARESTAS_CONE, "spot selecionada: cone");
l.tipo = "direcional";
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0);
check(gizmosDoEditor.nSeg === 1, "direcional selecionada: uma seta");
io.print("[PASSOU] pacote luz: comandos, consulta, menus, gizmo por tipo");
