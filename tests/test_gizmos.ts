// Teste SEM JANELA dos Gizmos: projeção (mesma conta de projPt), corte atrás da
// câmera, esfera e cone, ícone com a MESMA área para desenho e clique, cor,
// buffers reaproveitados, ganchos chamados no editor e nunca no jogo.
//
//   rts.exe run tests/test_gizmos.ts
import io from "@compat/io.ts";
import { Behavior } from "@engine/core/behavior";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Gizmos, gizmosBegin, registerGizmoDrawer, GIZMO_SEGMENTOS_CIRCULO, GIZMO_ARESTAS_CONE } from "@engine/core/gizmos";
import { coletarGizmos, gizmoIconAt, gizmosDoEditor, passeDeGizmosProtegido } from "@editor/gizmo_pass";
import { FALHA_GIZMO } from "@engine/core/behavior";
import { logEntries, LOG_ERROR } from "@engine/core/logger";
import { cmdGizmoAt } from "@editor/control/commands/gizmo";
import { S } from "@editor/control/session";
import { aplicarLuzes, aplicarAmbiente } from "@engine/render/scene_lighting";
import { VistasDeCamera, coletarCameras } from "@engine/render/camera_views";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function v3(x: number, y: number, z: number): Float64Array { const v = new Float64Array(3); v[0] = x; v[1] = y; v[2] = z; return v; }

const g = new Gizmos();
const pose = new Float64Array(8);
pose[5] = Math.PI / 2.0; pose[6] = 1280.0; pose[7] = 720.0;   // focal = 360
gizmosBegin(g, pose);
g.color(0xFF8000);
g.line(v3(0, 0, 10), v3(1, 0, 10));
check(g.nSeg === 1, "um segmento");
check(Math.abs(g.seg[0] - 640.0) < 1e-9 && Math.abs(g.seg[1] - 360.0) < 1e-9 && Math.abs(g.seg[2] - 676.0) < 1e-9, "(0,0,10)→(640,360); (1,0,10)→(676,360)");
check(g.seg[4] === 0xFF8000FF, "cor 0xRRGGBB vira 0xRRGGBBFF");
g.line(v3(0, 1, 10), v3(0, 0, -5));
check(g.nSeg === 1, "ponta atrás da câmera: segmento descartado");
g.wireSphere(v3(0, 0, 10), 1.0);
check(g.nSeg === 1 + 3 * GIZMO_SEGMENTOS_CIRCULO, "esfera = 3 círculos");
g.wireCone(v3(0, 0, 5), v3(0, 0, 1), 2.0, 90.0);
check(g.nSeg === 1 + 4 * GIZMO_SEGMENTOS_CIRCULO + GIZMO_ARESTAS_CONE, "cone = base + arestas");
const aresta = (1 + 3 * GIZMO_SEGMENTOS_CIRCULO) * 5;
check(Math.abs(g.seg[aresta] - 640.0) < 1e-9 && Math.abs(g.seg[aresta + 1] - 360.0) < 1e-9, "a primeira aresta sai do ápice");
g.lado = 24.0; g.dono = 3;
g.icon("luz-pontual", v3(0, 0, 10));
check(g.nIc === 1 && g.ic[0] === 628.0 && g.ic[1] === 348.0 && g.ic[2] === 24.0 && g.ic[3] === 3.0, "ícone centrado no ponto");
check(gizmoIconAt(g, 640.0, 360.0) === 3 && gizmoIconAt(g, 628.0, 348.0) === 3, "clique dentro seleciona o dono");
check(gizmoIconAt(g, 652.0, 360.0) === 0 - 1 && gizmoIconAt(g, 700.0, 360.0) === 0 - 1, "fora da mesma área: nada");
// buffers reaproveitados: frames iguais não crescem
const cap = g.seg.length; const capIc = g.ic.length;
let f = 0;
while (f < 100) { gizmosBegin(g, pose); g.wireSphere(v3(0, 0, 10), 1.0); g.wireCone(v3(0, 0, 5), v3(0, 1, 0), 2.0, 60.0); g.icon("camera", v3(0, 0, 10)); f = f + 1; }
check(g.seg.length === cap && g.ic.length === capIc, "buffers não crescem entre frames iguais");

// ganchos: o editor chama, o jogo nunca
class ContaGizmos extends Behavior {
  n: number = 0; sel: number = 0;
  typeName(): string { return "ContaGizmos"; }
  onDrawGizmos(gz: Gizmos): void { this.n = this.n + 1; }
  onDrawGizmosSelected(gz: Gizmos): void { this.sel = this.sel + 1; }
}
const desenhos: string[] = [];
check(registerGizmoDrawer("ContaGizmos", (gz: Gizmos, dono: GameObject, comp: Behavior) => { desenhos.push(dono.name + (gz.selecionado ? "*" : "")); }), "registra desenhador");
check(!registerGizmoDrawer("ContaGizmos", (gz: Gizmos, dono: GameObject, comp: Behavior) => {}), "tipo repetido recusado");
const sc = new Scene("gizmos");
const a = sc.createGameObject("A"); const ca = new ContaGizmos(); a.addBehavior(ca);
const b = sc.createGameObject("B"); const cb = new ContaGizmos(); b.addBehavior(cb);
const c = sc.createGameObject("C");
check(a.gizmoFlag === 1 && c.gizmoFlag === 0, "gizmoFlag só em quem desenha");
sc.update(1.0 / 60.0); sc.computeWorld();
const cam = new Float64Array(3); const legado = new Float64Array(4);
aplicarLuzes(0, sc, cam, legado); aplicarAmbiente(0, sc);
coletarCameras(new VistasDeCamera(), sc, null);
check(ca.n === 0 && ca.sel === 0 && desenhos.length === 0, "nada de gizmo no caminho do jogo");
gizmosBegin(g, pose);
check(coletarGizmos(g, sc, 1) === 2, "dois objetos desenharam");
check(ca.n === 1 && cb.n === 1 && ca.sel === 0 && cb.sel === 1, "onDrawGizmosSelected só no selecionado");
check(desenhos.join(",") === "A,B*", "desenhador por tipo recebe dono e seleção: " + desenhos.join(","));
b.active = 0; gizmosBegin(g, pose); coletarGizmos(g, sc, 1);
check(cb.n === 1, "objeto inativo não desenha gizmo");
// WS: gizmoat usa a instância do editor e a mesma área do clique
gizmosBegin(gizmosDoEditor, pose); gizmosDoEditor.lado = 24.0; gizmosDoEditor.dono = 0;
gizmosDoEditor.icon("camera", v3(0, 0, 10));
check(cmdGizmoAt(["gizmoat", "640", "360"]).indexOf("[ok] #0") === 0 && S.selected === 0, "gizmoat seleciona o dono");
check(cmdGizmoAt(["gizmoat", "10", "10"]).indexOf("[gizmoat] nenhum") === 0, "fora de ícone: nenhum");
check(cmdGizmoAt(["gizmoat", "x"]).indexOf("[erro]") === 0, "argumentos inválidos = erro");

// script que lança em onDrawGizmos: o quadro do editor termina, o erro vai ao
// Console uma vez e o gizmo desse componente fica desligado; os demais seguem.
class GizmoQuebrado extends Behavior {
  n: number = 0;
  typeName(): string { return "GizmoQuebrado"; }
  onDrawGizmos(gz: Gizmos): void { this.n = this.n + 1; throw new Error("gizmo quebrado de propósito"); }
}
class GizmoBom extends Behavior {
  typeName(): string { return "GizmoBom"; }
}
// desenhador por tipo: o bom desenha um ícone; o do quebrado lançaria também
// (nunca chega a rodar: o onDrawGizmos lança antes e o componente é desligado)
registerGizmoDrawer("GizmoBom", (gz: Gizmos, dono: GameObject, comp: Behavior) => { gz.icon("camera", v3(0, 0, 10)); });
registerGizmoDrawer("GizmoQuebrado", (gz: Gizmos, dono: GameObject, comp: Behavior) => { throw new Error("desenhador quebrado"); });
function errosDoGizmo(): number { return logEntries(LOG_ERROR, "GizmoQuebrado").length; }
const sq = new Scene("gizmo quebrado");
sq.createGameObject("Bom").addBehavior(new GizmoBom());
const quebrado = new GizmoQuebrado(); sq.createGameObject("Q").addBehavior(quebrado);
sq.computeWorld();
const errosAntes = errosDoGizmo();
gizmosBegin(g, pose);
check(passeDeGizmosProtegido(g, sq, 0 - 1) === 2, "o passe protegido termina o quadro");
check(quebrado.n === 1 && (quebrado.falhasEditor & FALHA_GIZMO) !== 0, "o componente que lançou fica com o gizmo desligado");
check(g.nIc === 1, "o quadro recoleta sem duplicar o gizmo dos outros: " + g.nIc);
check(errosDoGizmo() === errosAntes + 1, "erro registrado uma vez com o tipo");
check(logEntries(LOG_ERROR, "em 'Q'").length >= 1, "o erro nomeia o objeto");
gizmosBegin(g, pose);
check(passeDeGizmosProtegido(g, sq, 0 - 1) === 2 && quebrado.n === 1 && g.nIc === 1, "quadros seguintes pulam o gizmo desligado");
check(errosDoGizmo() === errosAntes + 1, "sem repetir o erro");
// desenhador registrado (pacote) que lança: mesmo tratamento
class SoDesenhador extends Behavior { typeName(): string { return "SoDesenhador"; } }
registerGizmoDrawer("SoDesenhador", (gz: Gizmos, dono: GameObject, comp: Behavior) => { throw new Error("desenhador de pacote quebrado"); });
const sd = new SoDesenhador(); sq.createGameObject("D").addBehavior(sd);
const errosDesenhador = logEntries(LOG_ERROR, "SoDesenhador").length;
gizmosBegin(g, pose);
check(passeDeGizmosProtegido(g, sq, 0 - 1) === 3 && (sd.falhasEditor & FALHA_GIZMO) !== 0 && g.nIc === 1, "desenhador que lança: desligado, quadro completo");
check(logEntries(LOG_ERROR, "SoDesenhador").length === errosDesenhador + 1, "erro do desenhador registrado uma vez");
io.print("[PASSOU] gizmos: projeção, corte, esfera/cone, ícone clicável, reuso, só no editor, gizmoat, exceção de script contida");
