// Teste SEM JANELA do ObjectField (item 2 do brief de áudio-arquivos): rótulo
// Nenhum/nome, ping no Project, Delete/Backspace limpa, soltar um tile define
// clip + modo, e o seletor "Selecionar AudioClip" (lista, busca, Nenhum,
// clique só seleciona, duplo-clique/Enter confirma).
//   rts.exe run tests/test_object_field.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { Inspector } from "@editor/inspector";
import { EditorControl } from "@editor/ui_controls";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import { AudioSource } from "@scripts/audiosource";
import { assetsInit, assetSelectedName, assetsCurrentDir } from "@editor/assets";
import { UI_PICKER_KEYS as K, UI_OBJECT_PICKER as OP } from "@editor/ui_config";

function check(c: boolean, m: string): void { if (!c) throw new Error("FALHOU: " + m); }

class TestApp {
  _win: number = 0;
  focus: number = 0 - 1;
  clickId: number = 0 - 1;
  hoverId: number = 0 - 1;
  key: number = 0;
  textoId: number = 0 - 1; texto: string = "";
  row: number = 0; clickedRow: number = 0 - 1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  keyPressed(code: number): number { return code === this.key ? 1 : 0; }
  at(x: number, y: number, w: number, h: number): void {}
  clickableAt(id: number): number {
    if (id === this.clickId) return 3;
    if (id === this.hoverId) return 1;
    return 0;
  }
  textField(id: number, value: string, enabled: boolean): string {
    return id === this.textoId ? this.texto : value;
  }
  button(label: string): boolean { return false; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  clickable(x: number, y: number, w: number, h: number): number {
    const row = this.row; this.row = this.row + 1;
    return row === this.clickedRow ? 3 : 0;
  }
}

// ── arquivos reais sob assets/audio/ (removidos no fim) ─────────────────────
fs.create_dir_all("assets/audio");
const P1 = "assets/audio/__teste_objectfield.wav";
const P2 = "assets/audio/__teste_objectfield2.ogg";
try { fs.remove_file(P1); } catch {}
try { fs.remove_file(P2); } catch {}
fs.write(P1, "fake");
fs.write(P2, "fake");

const PANEL_H = 4000;
const app = new TestApp();
const inspector = new Inspector(app);
function render(mx: number, my: number, down: number, pressed: number): void {
  app.row = 0;
  inspector.area(0, 0, 300, PANEL_H); inspector.mouse(mx, my, down, pressed);
  inspector.render(app, false, 0, 0);
}
function control(name: string): EditorControl {
  const i = inspector.ui.names.indexOf(name); check(i >= 0, "controle ausente: " + name); return inspector.ui.controls[i];
}

scene.clear(); history.u = []; history.r = [];
const o = scene.createGameObject("Fonte");
const as = new AudioSource();
o.addBehavior(as);
S.selected = 0; S.selection = [0];

render(0 - 1, 0 - 1, 0, 0);
const field = control("Components/0/GUI/1");
check(field.label === "Nenhum (AudioClip)", "rotulo vazio: " + field.label);
check(field.icon === "audio-fonte", "icone do campo: " + field.icon);

as.clip = P1; as.onValidate("clip");
render(0 - 1, 0 - 1, 0, 0);
check(field.label === "__teste_objectfield (AudioClip)", "rotulo com nome (sem pasta/extensao): " + field.label);
check(as.modo === "arquivo", "onValidate('clip') liga o modo arquivo");

// ── ping: clique simples no campo seleciona o tile no Project ──────────────
assetsInit();
app.clickId = field.id;
render(0 - 1, 0 - 1, 0, 0);
app.clickId = 0 - 1;
check(inspector.pinged, "clique pinga");
check(assetsCurrentDir() === "assets/audio", "ping abre a pasta do clipe: " + assetsCurrentDir());
check(assetSelectedName().indexOf("__teste_objectfield.wav") === 0, "ping seleciona o tile: " + assetSelectedName());
check(inspector.objFocusComp === as, "clique focou o campo (pro Delete)");

// ── Delete com o campo focado limpa (Nenhum), com Desfazer ──────────────────
const antesDel = history.undoDepth();
app.key = K.del;
render(0 - 1, 0 - 1, 0, 0);
app.key = 0;
check(as.clip === "" && history.undoDepth() === antesDel + 1, "Delete limpa com Desfazer: clip=" + as.clip);

// ── soltar um tile do Project no campo define clip (+ mantém modo arquivo,
// já ligado — o campo só aparece nesse modo), com Desfazer ─────────────────
as.clip = P1; as.onValidate("clip"); // clip preenchido, mas ainda não é P2
render(0 - 1, 0 - 1, 0, 0); // recomputa objHotComp (reset a cada render)
app.hoverId = field.id;
inspector.drag(1, 1);
render(0 - 1, 0 - 1, 0, 0);
app.hoverId = 0 - 1;
check(inspector.objectHot() === 1, "campo fica \"hot\" com um arraste compativel por cima");
const antesDrop = history.undoDepth();
inspector.dropObjectField(P2);
check(as.clip === P2 && as.modo === "arquivo" && history.undoDepth() === antesDrop + 1,
  "solto define clip (modo arquivo continua ligado), com Desfazer: clip=" + as.clip + " modo=" + as.modo);

// ── seletor "Selecionar AudioClip": abrir, listar, buscar, Nenhum ───────────
inspector.drag(0, 0);
render(0 - 1, 0 - 1, 0, 0);
const pick = control("Components/0/GUI/1/Pick");
app.clickId = pick.id;
render(0 - 1, 0 - 1, 0, 0);
app.clickId = 0 - 1;
check(inspector.objOpened === 1, "botao seletor abre o picker");

// busca por um nome exclusivo dos arquivos de teste
app.textoId = OP.searchId; app.texto = "__teste_objectfield";
render(0 - 1, 0 - 1, 0, 0);
app.textoId = 0 - 1;
check(inspector.objPicker.matches.length === 2, "busca encontra os 2 arquivos de teste: " + inspector.objPicker.matches.length);

// clique simples SELECIONA (não confirma ainda) — ordenado, a linha 1 é o
// primeiro resultado ("__teste_objectfield.wav" vem antes de "...2.ogg").
app.clickedRow = 1; // 0 = "Nenhum"; 1 = primeiro resultado da busca (P1)
render(0 - 1, 0 - 1, 0, 0);
check(as.clip === P2, "clique simples nao confirma ainda: clip=" + as.clip);
// duplo-clique (mesma linha, quadro seguinte) CONFIRMA
render(0 - 1, 0 - 1, 0, 0);
app.clickedRow = 0 - 1;
check(inspector.objOpened === 0 && as.clip === P1, "duplo-clique confirma a escolha (P1): clip=" + as.clip);

// reabre e escolhe "Nenhum" (linha 0) por Enter
render(0 - 1, 0 - 1, 0, 0);
const pick2 = control("Components/0/GUI/1/Pick");
app.clickId = pick2.id;
render(0 - 1, 0 - 1, 0, 0);
app.clickId = 0 - 1;
check(inspector.objOpened === 1, "reabre o picker");
const antesNenhum = history.undoDepth();
app.key = K.enter;
render(0 - 1, 0 - 1, 0, 0);
app.key = 0;
check(as.clip === "" && inspector.objOpened === 0 && history.undoDepth() === antesNenhum + 1,
  "Enter em \"Nenhum\" limpa o clipe, com Desfazer: clip=" + as.clip);

fs.remove_file(P1);
fs.remove_file(P2);
io.print("[PASSOU] ObjectField: rotulo, icone, ping, Delete, solto, seletor (busca/clique-seleciona/duplo-clique-confirma/Nenhum)");
