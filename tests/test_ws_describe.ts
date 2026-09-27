// Teste SEM JANELA da OBSERVAÇÃO pela porta de controle: `describe <obj>`
// (texto e JSON: caminho, transform em graus, mundo, aparência, filhos, cada
// componente com todos os campos), `scene json [obj]` (o JSON do save sem
// salvar, sem mudar o documento, sem gancho) e a rotação no `state`. Todos são
// consultas: não mexem no Desfazer.
//
//   rts.exe run tests/test_ws_describe.ts
import { Editor } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene, S } from "@editor/control/session";
import { sceneToJSON } from "@editor/sceneio";
import { sceneDocument } from "@editor/scene_document";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function corpo(out: string, tag: string): any {
  check(out.indexOf(tag + " ") === 0, "resposta com " + tag + ": " + out);
  return JSON.parse(out.slice(tag.length + 1));
}
instalarEditorReal();
const salvos: string[] = [];
Editor.on("salvar", (a: string) => { salvos.push(a); });

scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "spawn Pai 1 0 0").indexOf("[ok]") === 0, "spawn Pai");
check(execCommand(800, 600, "spawn Filho 2 0 0").indexOf("[ok]") === 0, "spawn Filho");
check(execCommand(800, 600, "parent 1 0").indexOf("[ok]") === 0, "Filho sob Pai");
check(execCommand(800, 600, "spin 1 1.5 0.25").indexOf("[ok]") === 0, "Spinner no Filho");
check(execCommand(800, 600, "addcomp 1 Light").indexOf("[ok]") === 0, "Light no Filho");
check(execCommand(800, 600, "color 1 10 20 30").indexOf("[ok]") === 0, "cor");
scene.objects[1].transform.ry = Math.PI / 2.0;   // yaw 90
scene.objects[1].transform.rx = Math.PI / 6.0;   // pitch 30
scene.objects[0].transform.ry = Math.PI;         // o pai girado: o mundo do filho muda
scene.computeWorld();
const undoAntes = history.undoDepth(); const redoAntes = history.redoDepth();
const docAntes = sceneDocument.path;
const cenaAntes = sceneToJSON();

// ── describe <obj> json ─────────────────────────────────────────────────────
const d = corpo(execCommand(800, 600, "describe 1 json"), "[describe]");
check(d.index === 1 && d.name === "Filho" && d.path === "Pai/Filho", "indice, nome e caminho: " + JSON.stringify(d));
check(d.active === 1 && d.parent === 0 && d.children.length === 0, "ativo, pai, filhos");
check(Math.abs(d.transform.rot.yaw - 90.0) < 1e-6 && Math.abs(d.transform.rot.pitch - 30.0) < 1e-6 && d.transform.rot.roll === 0, "rot em graus yaw/pitch/roll");
check(d.transform.pos[0] === 2 && d.transform.scale[0] === 1, "pos e escala locais");
check(Math.abs(d.transform.world.pos[0] - (0 - 1.0)) < 1e-6 && Math.abs(d.transform.world.yaw - 270.0) < 1e-6, "mundo: o pai em x=1 girado 180 leva o filho (local x=2) a x=-1: " + JSON.stringify(d.transform.world));
check(d.appearance.meshKind === 1 && d.appearance.color[0] === 10 && d.appearance.color[2] === 30, "aparencia");
check(d.components.length === 2, "dois componentes");
const spin = d.components[0];
check(spin.type === "Spinner" && spin.index === 0 && spin.enabled === true, "Spinner: " + JSON.stringify(spin));
check(spin.data !== null && spin.data.type !== undefined, "dados do componentToData");
const luz = d.components[1];
check(luz.type === "Light", "Light");
let nomes = "";
let k = 0;
while (k < luz.fields.length) { nomes = nomes + luz.fields[k].name + ":" + luz.fields[k].type + "=" + luz.fields[k].value + " "; k = k + 1; }
check(nomes.indexOf("tipo:enum=direcional") >= 0 && nomes.indexOf("cor:color=#FFFFFF") >= 0 && nomes.indexOf("intensidade:number=1") >= 0 && nomes.indexOf("sombra:boolean=false") >= 0,
  "campos da reflexao com nome, tipo e valor: " + nomes);
const dp = corpo(execCommand(800, 600, "describe 0 json"), "[describe]");
check(dp.path === "Pai" && dp.children.length === 1 && dp.children[0] === 1 && dp.parent === -1, "pai lista o filho");

// ── describe <obj> (texto) ──────────────────────────────────────────────────
const t = execCommand(800, 600, "describe 1");
check(t.indexOf("[describe] #1 Filho") === 0 && t.indexOf("Pai/Filho") > 0, "texto: cabeçalho e caminho: " + t);
check(t.indexOf("yaw=90") > 0 && t.indexOf("pitch=30") > 0, "texto: rotação em graus");
check(t.indexOf("Spinner") > 0 && t.indexOf("Light") > 0 && t.indexOf("intensidade") > 0, "texto: componentes e campos");
check(execCommand(800, 600, "describe 9").indexOf("[erro]") === 0, "describe objeto invalido");
check(execCommand(800, 600, "describe").indexOf("[erro]") === 0, "describe sem objeto");
check(execCommand(800, 600, "describe 1 xml").indexOf("[erro]") === 0, "describe formato invalido");

// ── scene json [obj] ────────────────────────────────────────────────────────
const sj = execCommand(800, 600, "scene json");
check(sj === "[scene] " + sceneToJSON(), "scene json = o JSON do save");
const oj = corpo(execCommand(800, 600, "scene json 1"), "[scene]");
check(oj.name === "Filho" && oj.parent === 0 && oj.scripts.length === 2, "scene json <obj> = objectToData");
check(execCommand(800, 600, "scene").indexOf("[erro]") === 0 && execCommand(800, 600, "scene json 7").indexOf("[erro]") === 0, "scene: uso e objeto invalido");
check(sceneDocument.path === docAntes && salvos.length === 0, "scene json nao salva, nao muda o documento nem dispara o gancho");

// ── state com rotação ───────────────────────────────────────────────────────
const st = execCommand(800, 600, "state");
check(st.indexOf("#1 Filho") > 0 && st.indexOf("rot(90,30,0)") > 0, "state traz rot(yaw,pitch,roll) em graus: " + st);

check(history.undoDepth() === undoAntes && history.redoDepth() === redoAntes, "consultas nao mexem no Desfazer");
check(sceneToJSON() === cenaAntes, "consultas nao mudam a cena");
S.selected = 0;
println("[PASSOU] ws describe: describe texto/json, scene json sem salvar, state com rotacao");
