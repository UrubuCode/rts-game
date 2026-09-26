// Teste SEM JANELA do Ambiente: padrão = visual de hoje, envio só quando muda,
// ida e volta no JSON da cena, JSON inválido recusado antes de mexer na cena,
// e o Play devolvendo o Ambiente ao parar.
//
//   rts.exe run tests/test_ambiente.ts
import io from "@compat/io.ts";
import { Ambiente, SKY_FLOATS, ambienteToData, ambienteFromData, empacotarCeu, ambienteSync } from "@engine/core/ambiente";
import { sceneToJSON, sceneFromJSON } from "@editor/sceneio";
import { scene } from "@editor/control/session";
import { playMode } from "@editor/play_mode";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const sol = new Float64Array(3); sol[1] = -1.0;
const pac = new Float64Array(SKY_FLOATS);

// 1) padrão = céu estrelado de hoje, sem neblina, ambiente 0,25
const a = new Ambiente();
check(a.ceu.modo === "estrelas" && a.neblina.densidade === 0.0 && a.luzAmbiente.intensidade === 0.25, "padrão de hoje");
empacotarCeu(a, sol, 0, pac);
check(pac[0] === 0.0 && pac[15] === 1.0 && pac[17] === 1.0 && pac[21] === 0.25, "modo 0, exposição 1, ambiente cor 0,25");
check(pac[10] === 0.0 && pac[11] === -1.0, "direção do sol copiada");

// 2) envio só quando muda
check(ambienteSync(a, sol, 0) === 3, "primeira vez envia céu e neblina");
check(ambienteSync(a, sol, 0) === 0, "nada mudou: nada enviado");
const v0 = a.versao;
a.ceu.topo[0] = 0.9;
check(ambienteSync(a, sol, 0) === 1 && a.versao === v0 + 1, "escrever ceu.topo direto é detectado e sobe a versão");
a.neblina.densidade = 0.02;
check(ambienteSync(a, sol, 0) === 2, "só a neblina mudou");
sol[0] = 0.5;
check(ambienteSync(a, sol, 0) === 1, "o sol girou: céu reenviado");
check(ambienteSync(a, sol, 7) === 1, "a textura carregou: céu reenviado");

// 3) ida e volta pelo JSON da cena
scene.clear();
scene.ambiente.ceu.modo = "procedural"; scene.ambiente.ceu.horizonte[2] = 0.33;
scene.ambiente.neblina.densidade = 0.05; scene.ambiente.luzAmbiente.modo = "ceu"; scene.ambiente.sol = "Sol";
const json = sceneToJSON();
scene.ambiente.ceu.modo = "cor"; scene.ambiente.sol = "";
sceneFromJSON(json);
check(scene.ambiente.ceu.modo === "procedural" && scene.ambiente.ceu.horizonte[2] === 0.33, "céu volta do JSON");
check(scene.ambiente.neblina.densidade === 0.05 && scene.ambiente.luzAmbiente.modo === "ceu" && scene.ambiente.sol === "Sol", "neblina, ambiente e sol voltam");

// 4) cena sem bloco = padrão de hoje
sceneFromJSON("{\"objects\":[]}");
check(scene.ambiente.ceu.modo === "estrelas" && scene.ambiente.neblina.densidade === 0.0 && scene.ambiente.sol === "", "sem bloco: visual de hoje");

// 5) bloco inválido: erro legível e a cena atual intocada
scene.createGameObject("Fica");
const ruins: string[] = [
  "{\"objects\":[],\"ambiente\":{\"ceu\":{\"topo\":[1,2]}}}",
  "{\"objects\":[],\"ambiente\":{\"ceu\":{\"modo\":\"nublado\"}}}",
  "{\"objects\":[],\"ambiente\":{\"neblina\":{\"densidade\":-1}}}",
  "{\"objects\":[],\"ambiente\":{\"luzAmbiente\":{\"intensidade\":\"alta\"}}}",
  "{\"objects\":[],\"ambiente\":{\"sol\":3}}",
];
let r = 0;
while (r < ruins.length) {
  let erro = "";
  try { sceneFromJSON(ruins[r]); } catch (e) { erro = String(e); }
  check(erro.indexOf("ambiente.") >= 0, "erro legível no caso " + r + ": " + erro);
  check(scene.objects.length === 1 && scene.objects[0].name === "Fica", "cena intocada no caso " + r);
  r = r + 1;
}
const d = new Ambiente();
let erroDireto = "";
try { ambienteFromData(d, { ceu: { exposicao: "x" } }); } catch (e) { erroDireto = String(e); }
check(erroDireto.indexOf("ambiente.ceu.exposicao") >= 0 && d.ceu.exposicao === 1.0, "ambienteFromData não toca o destino quando falha");
check(ambienteToData(d).ceu.modo === "estrelas", "ambienteToData");

// 6) Play: o que a simulação muda no Ambiente volta ao parar
scene.ambiente.ceu.exposicao = 1.0;
check(playMode.play(), "play");
scene.ambiente.ceu.exposicao = 3.0;
playMode.stop();
check(scene.ambiente.ceu.exposicao === 1.0, "parar devolve o Ambiente de edição");
io.print("[PASSOU] ambiente: padrão, envio só quando muda, JSON ida e volta, sem bloco, inválido, Play");
