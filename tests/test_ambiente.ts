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

// 1) padrão = céu estrelado de hoje, sem neblina, ambiente ESCALAR LEGADO
// (out[17] = 0: o shader usa cam.light.w, não env.amb/env.sky — Fix round 1)
const a = new Ambiente();
check(a.ceu.modo === "estrelas" && a.neblina.densidade === 0.0 && a.luzAmbiente.modo === "legado" && a.luzAmbiente.intensidade === 0.25, "padrão de hoje");
empacotarCeu(a, sol, 0, pac);
check(pac[0] === 0.0 && pac[15] === 1.0 && pac[17] === 0.0, "modo 0, exposição 1, ambiente LEGADO (0)");
check(pac[10] === 0.0 && pac[11] === -1.0, "direção do sol copiada");

// 1b) modo explícito muda o código empacotado (legado 0, cor 1, ceu 2 — bate
// com `ambiente()` em shader.rs: modo<0.5 legado, modo<1.5 cor, senão céu)
const acor = new Ambiente(); acor.luzAmbiente.modo = "cor";
empacotarCeu(acor, sol, 0, pac); check(pac[17] === 1.0, "luzAmbiente cor: mode 1");
const aceu = new Ambiente(); aceu.luzAmbiente.modo = "ceu";
empacotarCeu(aceu, sol, 0, pac); check(pac[17] === 2.0, "luzAmbiente ceu: mode 2");

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

// 4) cena sem bloco = padrão de hoje (inclusive o modo legado da luz ambiente)
sceneFromJSON("{\"objects\":[]}");
check(scene.ambiente.ceu.modo === "estrelas" && scene.ambiente.neblina.densidade === 0.0 && scene.ambiente.luzAmbiente.modo === "legado" && scene.ambiente.sol === "", "sem bloco: visual de hoje");

// 4b) só "light" (sem "ambiente"): empacota modo legado (0) — o cam.light.w
// do bloco "light"/ws `light` continua sendo quem manda no ambiente
sceneFromJSON("{\"objects\":[],\"light\":[7,13,5,0.6]}");
check(scene.ambiente.luzAmbiente.modo === "legado", "só light, sem ambiente: luzAmbiente fica legado");
empacotarCeu(scene.ambiente, sol, 0, pac);
check(pac[17] === 0.0, "só light, sem ambiente: out[17] = 0 (legado) — ambiente vem de cam.light.w = 0,6");

// 4c) bloco "ambiente" com luzAmbiente.modo "cor" explícito: empacota mode 1
sceneFromJSON("{\"objects\":[],\"ambiente\":{\"luzAmbiente\":{\"modo\":\"cor\"}}}");
check(scene.ambiente.luzAmbiente.modo === "cor", "luzAmbiente.modo explícito é respeitado");
empacotarCeu(scene.ambiente, sol, 0, pac);
check(pac[17] === 1.0, "luzAmbiente.modo cor explícito: out[17] = 1");

// 5) bloco inválido: erro legível e a cena atual intocada
scene.createGameObject("Fica");
const ruins: string[] = [
  "{\"objects\":[],\"ambiente\":{\"ceu\":{\"topo\":[1,2]}}}",
  "{\"objects\":[],\"ambiente\":{\"ceu\":{\"modo\":\"nublado\"}}}",
  "{\"objects\":[],\"ambiente\":{\"neblina\":{\"densidade\":-1}}}",
  "{\"objects\":[],\"ambiente\":{\"luzAmbiente\":{\"intensidade\":\"alta\"}}}",
  "{\"objects\":[],\"ambiente\":{\"sol\":3}}",
  "{\"objects\":[],\"ambiente\":{\"ceu\":null}}",
  "{\"objects\":[],\"ambiente\":{\"ceu\":5}}",
  "{\"objects\":[],\"ambiente\":{\"neblina\":\"densa\"}}",
  "{\"objects\":[],\"ambiente\":{\"luzAmbiente\":[1,2,3]}}",
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
