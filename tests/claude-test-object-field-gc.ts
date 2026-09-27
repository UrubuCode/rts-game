// Sonda de ALOCAÇÃO do ObjectField do Inspector (item 2 do brief de
// áudio-arquivos): Inspector.renderProtegido com um AudioSource em modo
// arquivo (clip preenchido) selecionado — a caixa do clipe, o rótulo
// cacheado (Map por chave, refeito só quando o valor muda) e o botão ⊙ ficam
// no caminho por quadro sempre que esse objeto está selecionado. Rodar com
// RTS_GC_DEBUG=1 e contar "rts-gc" ENTRE os marcadores "FASE": 0 coletas com
// 200 000 quadros.
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-object-field-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Inspector } from "@editor/inspector";
import { scene, S } from "@editor/control/session";
import { AudioSource } from "@scripts/audiosource";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));

class TestApp {
  _win: number = 0; focus: number = 0 - 1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  at(x: number, y: number, w: number, h: number): void {}
  textField(id: number, value: string, enabled: boolean): string { return value; }
  // sempre "hot" (1 = hover): exercita o realce do ObjectField sem clicar
  // (clicar chamaria assetsPing, I/O real — fora do caminho por quadro).
  clickableAt(id: number): number { return 1; }
  clickable(x: number, y: number, w: number, h: number): number { return 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  button(label: string): boolean { return false; }
  keyPressed(code: number): number { return 0; }
}

const app = new TestApp();
const inspector = new Inspector(app);
scene.clear();
const o = scene.createGameObject("Fonte");
const as = new AudioSource();
as.modo = "arquivo";
as.clip = "assets/audio/inexistente-de-proposito.wav"; // só o rótulo/ícone importam aqui
as.onValidate("clip");
o.addBehavior(as);
S.selected = 0; S.selection = [0];

function frame(drag: number): void {
  inspector.area(0, 0, 300, 4000);
  inspector.mouse(0 - 1, 0 - 1, 0, 0);
  inspector.drag(drag, drag);
  inspector.renderProtegido(app, false, 0, 0);
}

// aquece fora da fase (controles criados uma vez, ícone decodificado 1x)
frame(0); frame(0);

io.print("FASE inspector-objectfield " + n);
let f = 0;
while (f < n) {
  // alterna arraste ligado/desligado — exercita os dois ramos de realce sem
  // mudar o VALOR do campo (sem miss no cache do rótulo).
  frame(f % 2);
  f = f + 1;
}
io.print("FASE fim");
