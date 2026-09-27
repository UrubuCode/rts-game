// Teste SEM JANELA do `setfield`/`getfield` por NOME (componente e campo; o
// índice continua valendo) e por tipo de valor: número, booleano, texto (entre
// aspas ou resto da linha), cor #RRGGBB, opção de lista (enum) e vetor x,y,z
// do Transform. Tipo errado responde [erro] legível; setfield passa pelo
// fieldSet/onValidate como o Inspector e entra no Desfazer uma vez; getfield é
// consulta.
//
//   rts.exe run tests/test_ws_setfield.ts
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene } from "@editor/control/session";
import { DEG2RAD } from "@editor/bone_gizmo";
import { Light } from "@engine/core/light";
import { Camera } from "@engine/core/camera";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64): boolean { return Math.abs(a - b) < 1e-9; }
function ok(cmd: string): string {
  const u = history.undoDepth();
  const out = execCommand(800, 600, cmd);
  check(out.indexOf("[ok]") === 0, cmd + ": " + out);
  check(history.undoDepth() === u + 1, cmd + ": um snapshot de Desfazer");
  return out;
}
function erro(cmd: string): string {
  const u = history.undoDepth(); const r = history.redoDepth();
  const out = execCommand(800, 600, cmd);
  check(out.indexOf("[erro]") === 0, cmd + " deveria ser [erro]: " + out);
  check(out.indexOf("undefined") < 0 && out.indexOf("NaN") < 0, cmd + ": motivo legivel: " + out);
  check(history.undoDepth() === u && history.redoDepth() === r, cmd + ": erro nao mexe no Desfazer");
  return out;
}
function ler(cmd: string): string {
  const u = history.undoDepth(); const r = history.redoDepth();
  const out = execCommand(800, 600, cmd);
  check(out.indexOf("[getfield]") === 0, cmd + ": " + out);
  check(history.undoDepth() === u && history.redoDepth() === r, cmd + ": getfield e consulta");
  return out;
}

scene.clear(); history.u = []; history.r = [];
execCommand(800, 600, "spawn A 0 0 0");
execCommand(800, 600, "addcomp A Light");          // [0]
execCommand(800, 600, "addcomp A Camera");         // [1]
execCommand(800, 600, "addcomp A MotionSettings"); // [2]
execCommand(800, 600, "addcomp A Spinner");        // [3]
history.u = []; history.r = [];
const o = scene.objects[0];
const luz = o.behaviors[0] as Light;
const cam = o.behaviors[1] as Camera;

// número, por nome de componente e de campo
ok("setfield A Light intensidade 2.5");
check(luz.intensidade === 2.5, "numero");
const aj = ok("setfield A Light anguloSpot 500");
check(luz.anguloSpot === 179 && aj.indexOf("179") > 0, "o @range/onValidate ajusta e a resposta mostra o valor final: " + aj);
erro("setfield A Light intensidade abc");
ok("setfield A 3 speedY 4");
ok("setfield A Spinner 0 5");
// booleano
ok("setfield A Light sombra true");
check(luz.sombra === true, "boolean true");
ok("setfield A Light sombra false");
check(luz.sombra === false, "boolean false");
check(erro("setfield A Light sombra talvez").indexOf("true") > 0, "boolean: diz o que aceita");
// cor
ok("setfield A Light cor #FF8800");
check(luz.cor === 0xFF8800, "cor #RRGGBB");
ok("setfield A Light cor #00ff00");
check(luz.cor === 0x00FF00, "cor em minusculas");
erro("setfield A Light cor #GG0000");
erro("setfield A Light cor vermelho");
ok("setfield A Camera corFundo #102030");
check(cam.corFundo === 0x102030, "cor da camera");
// enum
ok("setfield A Light tipo spot");
check(luz.tipo === "spot", "enum por texto");
ok("setfield A Light tipo PONTUAL");
check(luz.tipo === "pontual", "enum sem diferenciar maiusculas grava a opcao canonica");
const en = erro("setfield A Light tipo laser");
check(en.indexOf("direcional") > 0 && en.indexOf("spot") > 0, "enum invalido lista as opcoes: " + en);
ok("setfield A Camera fundo cor");
check(cam.fundo === "cor", "enum da camera");
// campo com conversão própria (fov em graus) e por rótulo
ok("setfield A Camera fov 70");
check(Math.abs(cam.fov - 70.0 * DEG2RAD) < 1e-4, "fov em graus pelo fieldSet do componente");
ok("setfield A Camera Main false");
check(cam.isMain === 0, "campo pelo rotulo");
// texto
ok("setfield A MotionSettings label \"Meu rotulo\"");
check((o.behaviors[2] as any).label === "Meu rotulo", "texto entre aspas");
ok("setfield A MotionSettings label dois nomes");
check((o.behaviors[2] as any).label === "dois nomes", "texto = resto da linha");
// índices continuam valendo
ok("setfield 0 0 1 #0000FF");
check(luz.cor === 0x0000FF, "indices");
// Transform
ok("setfield A Transform position 1,2,3");
check(o.transform.px === 1.0 && o.transform.py === 2.0 && o.transform.pz === 3.0, "vetor x,y,z");
ok("setfield A Transform rotation 30,90,0");
check(perto(o.transform.rx, 30 * DEG2RAD) && perto(o.transform.ry, 90 * DEG2RAD), "rotation em graus na ordem do Inspector (X=pitch, Y=yaw)");
ok("setfield A Transform scale 2 2 2");
check(o.transform.sx === 2.0 && o.transform.sz === 2.0, "vetor separado por espaco");
erro("setfield A Transform position 1,2");
erro("setfield A Transform position 1,x,3");
erro("setfield A Transform cor 1,2,3");
// erros de endereçamento
check(erro("setfield A Rigidbody massa 1").indexOf("Light") > 0, "componente ausente lista os que existem");
check(erro("setfield A Light brilho 1").indexOf("intensidade") > 0, "campo ausente lista os campos");
erro("setfield A 9 0 1");
erro("setfield A Light 99 1");
erro("setfield A Light intensidade");
execCommand(800, 600, "addcomp A Spinner");         // [4] segundo Spinner
check(erro("setfield A Spinner speedY 1").indexOf("[3]") > 0, "componente ambiguo lista os indices");

// getfield: valor com o tipo
check(ler("getfield A Light cor").indexOf("color = #0000FF") > 0, "getfield cor");
const gt = ler("getfield A Light tipo");
check(gt.indexOf("enum = pontual") > 0 && gt.indexOf("direcional|pontual|spot") > 0, "getfield enum com opcoes: " + gt);
check(ler("getfield A Light sombra").indexOf("boolean = false") > 0, "getfield boolean");
check(ler("getfield A Light intensidade").indexOf("number = 2.5") > 0, "getfield number");
check(ler("getfield A MotionSettings label").indexOf("string = \"dois nomes\"") > 0, "getfield string");
check(ler("getfield A Transform position").indexOf("vector = 1,2,3") > 0, "getfield vetor");
check(ler("getfield A Transform rotation").indexOf("vector = 30,90,0") > 0, "getfield rotacao em graus");
check(execCommand(800, 600, "getfield A Light").indexOf("[erro]") === 0, "getfield sem campo");
// describe mostra a cor em hexadecimal e as opções do enum
const d = JSON.parse(execCommand(800, 600, "describe A json").slice("[describe] ".length));
const campoCor = d.components[0].fields[1];
check(campoCor.name === "cor" && campoCor.type === "color" && campoCor.value === "#0000FF", "describe: cor em #RRGGBB: " + JSON.stringify(campoCor));
check(d.components[0].fields[0].type === "enum" && d.components[0].fields[0].options.length === 3, "describe: enum com opcoes");
println("[PASSOU] ws setfield: por nome e indice, numero/boolean/texto/cor/enum/vetor, onValidate, getfield com tipo");
