// Teste SEM JANELA: montagem dos menus a partir do catálogo, conversão de cor,
// pose de mundo → local (inverso de Scene.applyParentTo) e o comando `menu`.
//   rts.exe run tests/test_menu_items.ts
import io from "@compat/io.ts";
import { montarMenu } from "@editor/menu_items";
import { cmdMenu } from "@editor/control/commands/menu";
import { corHex, lerCorHex } from "@engine/core/cor";
import { definirPoseDeMundo } from "@engine/core/pose";
import { Scene } from "@engine/core/scene";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const caminhos: string[] = ["Criar/Luz/Pontual", "Janela/Ambiente", "Criar/Câmera"];
const m = montarMenu("Criar/", ["Cubo", "Esfera"], caminhos);
check(m.fixos === 2 && m.rotulos.join("|") === "Cubo|Esfera|Luz/Pontual|Câmera", "fixos antes, itens sem o prefixo: " + m.rotulos.join("|"));
check(m.itens.length === 2 && m.itens[0] === 0 && m.itens[1] === 2, "índices no catálogo");
check(montarMenu("Janela/", [], caminhos).rotulos.join("|") === "Ambiente", "menu Janela");
check(corHex(0xFF8000) === "#FF8000" && corHex(0x0A0B0C) === "#0A0B0C", "corHex");
check(lerCorHex("#ff8000") === 0xFF8000 && lerCorHex("0a0b0c") === 0x0A0B0C, "lerCorHex aceita com e sem #");
check(lerCorHex("#ff80") === 0 - 1 && lerCorHex("#gg8000") === 0 - 1 && lerCorHex("") === 0 - 1, "inválidos = -1");
// pose de mundo → local numa filha de pai girado
const sc = new Scene("pose");
const pai = sc.createGameObject("Pai"); pai.transform.setPosition(10.0, 1.0, 0.0); pai.transform.ry = Math.PI / 2.0; pai.transform.rx = 0.1;
const filho = sc.createGameObject("Filho"); filho.parent = 0;
sc.computeWorld();
const pose = new Float64Array(5); pose[0] = 3.0; pose[1] = 4.0; pose[2] = 5.0; pose[3] = 0.5; pose[4] = 0 - 0.2;
definirPoseDeMundo(sc, filho, pose); sc.computeWorld();
const t = filho.transform;
check(Math.abs(t.wx - 3.0) < 1e-9 && Math.abs(t.wy - 4.0) < 1e-9 && Math.abs(t.wz - 5.0) < 1e-9, "filha: posição de mundo pedida");
check(Math.abs(t.wry - 0.5) < 1e-9 && Math.abs(t.wrx + 0.2) < 1e-9, "filha: ângulos de mundo pedidos");
check(cmdMenu(["menu", "Criar/Inexistente"]).indexOf("[erro]") === 0, "caminho inexistente = erro");
check(cmdMenu(["menu"]).indexOf("[menu]") === 0, "lista");
io.print("[PASSOU] menu: montagem, cor, pose de mundo, comando menu");
