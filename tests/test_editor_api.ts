// Teste SEM JANELA da API de extensão do editor: no-ops fora do editor,
// registerCommand (help, doc, resposta, erro, snapshot só se muta, nomes
// recusados), ganchos (salvar, abrirCena, entrarPlay, sairPlay), seleção.
//
//   rts.exe run tests/test_editor_api.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { unlinkSync } from "node:fs";
import { registerCommand, Editor, emitEditorEvent } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene, S } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
import { sceneDocument } from "@editor/scene_document";
import { REGISTRO } from "@engine/generated/components";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
check(REGISTRO === "editor", "o editor usa o registro completo");

// fora do editor: no-ops, sem erro
check(Editor.scene() === null && Editor.selection() === null, "sem host: nada");
Editor.log("x"); Editor.snapshot("x"); Editor.select(null);
// gancho registrado sem host (jogo exportado): emitir não o executa
const semHost: string[] = [];
check(Editor.on("salvar", (a: string) => { semHost.push(a); }), "gancho aceito mesmo sem host");
emitEditorEvent("salvar", "x");
check(semHost.length === 0, "sem host, ganchos não rodam");
instalarEditorReal();
check(Editor.scene() === scene, "com host: a cena do editor");

const chamadas: string[] = [];
check(registerCommand("teste_eco", "teste_eco <texto> :: ecoa o texto", false, (p: string[]) => { chamadas.push(p[1]); return "eco " + p[1]; }), "registra");
check(!registerCommand("move", "x", false, (p: string[]) => ""), "nome embutido recusado");
check(!registerCommand("teste_eco", "x", false, (p: string[]) => ""), "duplicado recusado");
check(!registerCommand("com espaco", "x", false, (p: string[]) => ""), "nome com espaço recusado");
check(!registerCommand("", "x", false, (p: string[]) => ""), "nome vazio recusado");
check(registerCommand("teste_recusa", "teste_recusa :: muta mas recusa", true, (p: string[]) => "[erro] recusado"), "registra o que muta e recusa");
check(registerCommand("teste_lanca_muta", "teste_lanca_muta :: muta e lança", true, (p: string[]) => { throw new Error("pifou"); }), "registra o que muta e lança");
check(registerCommand("teste_sem_nome", "<a> :: ajuda sem o nome", false, (p: string[]) => "x"), "registra ajuda sem o nome");
check(registerCommand("teste_cria", "teste_cria :: cria um objeto", true, (p: string[]) => { scene.createGameObject("Criado"); return "[ok] criado"; }), "registra o que muta");
check(registerCommand("teste_falha", "teste_falha :: lança", false, (p: string[]) => { throw new Error("quebrou"); }), "registra o que lança");

scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "teste_eco oi") === "[ok] eco oi" && chamadas.length === 1, "resposta ganha [ok]");
check(history.undoDepth() === 0, "muta = false não empilha Desfazer");
check(execCommand(800, 600, "teste_cria") === "[ok] criado" && history.undoDepth() === 1 && scene.objects.length === 1, "muta = true: 1 snapshot, sem [ok] duplicado");
check(execCommand(800, 600, "undo").indexOf("[ok]") === 0 && scene.objects.length === 0, "Desfazer tira o criado");
check(history.undoDepth() === 0 && history.redoDepth() === 1, "o criado foi para o Refazer");
check(execCommand(800, 600, "teste_recusa") === "[erro] recusado", "[erro] passa sem prefixo");
check(history.undoDepth() === 0 && history.redoDepth() === 1, "muta + [erro]: snapshot descartado e Refazer intacto");
check(execCommand(800, 600, "teste_lanca_muta") === "[erro] teste_lanca_muta: pifou", "muta + exceção: [erro] <nome>: <mensagem>");
check(history.undoDepth() === 0 && history.redoDepth() === 1, "muta + exceção: snapshot descartado");
check(execCommand(800, 600, "teste_falha") === "[erro] teste_falha: quebrou", "exceção vira [erro] <nome>: <mensagem>");
check(execCommand(800, 600, "help").indexOf("teste_eco <texto>") > 0, "aparece no help");
check(execCommand(800, 600, "doc teste_cria").indexOf("cria um objeto") > 0, "aparece no doc");
check(execCommand(800, 600, "help").indexOf("teste_sem_nome <a>") > 0, "help ganha o nome quando a ajuda não o traz");
check(execCommand(800, 600, "doc teste_sem_nome").indexOf("teste_sem_nome <a> :: ajuda sem o nome :: teste_sem_nome") > 0, "doc <prefixo> acha a ajuda sem o nome");
check(execCommand(800, 600, "nao_existe").indexOf("[erro] desconhecido") === 0, "desconhecido continua desconhecido");

// ganchos
const eventos: string[] = [];
check(Editor.on("salvar", (a: string) => { eventos.push("salvar:" + a); }), "gancho salvar");
check(Editor.on("abrirCena", (a: string) => { eventos.push("abrir:" + a); }), "gancho abrirCena");
check(Editor.on("entrarPlay", (a: string) => { eventos.push("play"); }), "gancho entrarPlay");
check(Editor.on("sairPlay", (a: string) => { eventos.push("stop"); }), "gancho sairPlay");
check(!Editor.on("inventado", (a: string) => {}), "evento desconhecido recusado");
Editor.on("salvar", (a: string) => { throw new Error("gancho ruim"); });
fs.create_dir_all("build");
const arquivo = "build/claude-teste-api.json";
scene.createGameObject("Salvo");
check(sceneDocument.save(arquivo), "salvar funciona mesmo com um gancho que lança");
check(eventos.indexOf("salvar:" + arquivo) >= 0, "salvar disparou");
sceneDocument.request("open", arquivo); sceneDocument.complete();
check(eventos.indexOf("abrir:" + arquivo) >= 0, "abrirCena disparou");
const abertosAntes = eventos.length;
check(execCommand(800, 600, "loadscene " + arquivo).indexOf("[ok]") === 0, "loadscene pelo WS");
check(eventos.length === abertosAntes + 1 && eventos[abertosAntes] === "abrir:" + arquivo, "abrirCena disparou pelo WS loadscene");
check(playMode.play() && eventos.indexOf("play") >= 0, "entrarPlay disparou");
playMode.stop();
check(eventos.indexOf("stop") >= 0, "sairPlay disparou");
unlinkSync(arquivo);

// seleção e pose da vista
Editor.select(scene.objects[0]);
check(S.selected === 0 && Editor.selection() === scene.objects[0], "select/selection");
const pose = new Float64Array(5);
S.camX = 1.0; S.camY = 2.0; S.camZ = 3.0; S.camYaw = 0.0; S.camPitch = 0.0;
Editor.viewPose(pose); check(pose[0] === 1.0 && pose[2] === 3.0, "viewPose");
Editor.spawnPoint(pose); check(Math.abs(pose[2] - 11.0) < 1e-9 && pose[0] === 1.0, "spawnPoint a 8 u à frente");
io.print("[PASSOU] editor api: no-ops, registerCommand, help/doc, snapshot só se muta, ganchos, select");
