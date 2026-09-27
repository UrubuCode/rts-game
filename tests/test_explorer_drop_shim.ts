// Teste SEM JANELA da soltura do Explorer (item 3 do brief de arquivos
// universais). Uma soltura FÍSICA do sistema de arquivos não dá pra simular
// sem um humano de verdade (é o SO que gera o evento) — como combinado com o
// controlador, este teste cobre a MESMA lógica que `main.ts` chama no quadro
// em que `input.droppedCount(win) > 0` (import + classificação + ação por
// alvo), pelas rotas que já são cobertas por: 1) os comandos WS
// `drop`/`dropon` (o mesmo caminho de `instantiateAt`/`applyAudioToObject`/
// `applyTexToObject` que `handleExplorerDrop` usa) e 2) chamando
// `kindOfPathAll`/`importFileToAssets` diretamente, como `handleExplorerDrop`
// faz por arquivo solto. A verificação manual (arrastar do Explorer de
// verdade) fica pro controlador/humano.
//   rts.exe run tests/test_explorer_drop_shim.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import "@engine/generated/editor_extensions";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { history } from "@editor/undo";
import { AudioSource } from "@scripts/audiosource";
import { kindOfPathAll, applyAudioToObject } from "@editor/dnd";
import { importFileToAssets, defaultImportDir, ASSETS_AUDIO_DIR } from "@editor/import_assets";
import { assetsCurrentDir, assetsInit } from "@editor/assets";

function check(c: boolean, m: string): void { if (!c) throw new Error("FALHOU: " + m); }
function cmd(l: string): string { return execCommand(800, 600, l); }

instalarEditorReal();
assetsInit();

// ── arquivos "soltos" de fora do projeto (como um arrasto do Explorer traria) ─
fs.create_dir_all("build/test-explorer-src");
fs.write("build/test-explorer-src/bumm.ogg", "conteudo-fake-audio");
fs.write("build/test-explorer-src/pele.png", "conteudo-fake-imagem");
try { fs.remove_file("assets/audio/bumm.ogg"); } catch {}
try { fs.remove_file(assetsCurrentDir() + "/pele.png"); } catch {}

// ── 1) classificação por extensão (o que handleExplorerDrop chama por arquivo) ─
check(kindOfPathAll("build/test-explorer-src/bumm.ogg") === "audio", "classifica .ogg como audio");
check(kindOfPathAll("build/test-explorer-src/pele.png") === "tex", "classifica .png como tex (marcador: imagem)");
check(kindOfPathAll("build/test-explorer-src/roteiro.ts") === "script", "classifica .ts como script");

// ── 2) destino: fora do Project, áudio vai pra assets/audio; resto pra pasta aberta ─
check(defaultImportDir("build/test-explorer-src/bumm.ogg", assetsCurrentDir()) === ASSETS_AUDIO_DIR,
  "audio fora do Project -> assets/audio");
check(defaultImportDir("build/test-explorer-src/pele.png", assetsCurrentDir()) === assetsCurrentDir(),
  "outros tipos fora do Project -> pasta aberta");

// ── 3) import (mesma função de importar/handleExplorerDrop) ────────────────
const destAudio = importFileToAssets("build/test-explorer-src/bumm.ogg", ASSETS_AUDIO_DIR);
check(destAudio === "assets/audio/bumm.ogg" && fs.exists(destAudio), "audio importado pra assets/audio: " + destAudio);
const destImg = importFileToAssets("build/test-explorer-src/pele.png", assetsCurrentDir());
check(fs.exists(destImg), "imagem importada pra pasta aberta: " + destImg);

// ── 4) região VIEWPORT vazio: solto vira "Fonte de áudio" (drop <path> WS —
// o mesmo instantiateAt que handleExplorerDrop chama pra essa região) ───────
scene.clear(); history.u = []; history.r = [];
const rDrop = cmd("drop " + destAudio + " 400 300");
check(rDrop.indexOf("[ok] drop") === 0 && rDrop.indexOf("[audio]") > 0, "drop de audio na viewport cria objeto: " + rDrop);
check(scene.objects.length === 1, "1 objeto criado");
const criado = scene.objects[0].behaviors[0] as AudioSource;
check(criado.clip === destAudio && criado.modo === "arquivo", "AudioSource criado com o clipe, modo arquivo: " + criado.clip);

// ── 5) região HIERARQUIA (objeto já existe): troca/adiciona AudioSource —
// dropon <path> <obj>, o mesmo applyAudioToObject que handleExplorerDrop usa ─
const alvo = scene.createGameObject("Alvo");
check(alvo.behaviors.length === 0, "alvo comeca sem componentes");
const rDropOn = cmd("dropon " + destAudio + " 1");
check(rDropOn.indexOf("[ok] dropon") === 0, "dropon audio: " + rDropOn);
check(alvo.behaviors.length === 1 && (alvo.behaviors[0] as AudioSource).clip === destAudio,
  "dropon adicionou AudioSource com o clipe");
// soltar de novo no MESMO objeto troca o clipe do AudioSource existente (não duplica)
applyAudioToObject(1, "assets/audio/bumm.ogg");
check(alvo.behaviors.length === 1, "2ª soltura no mesmo objeto nao duplica o AudioSource");

// ── 6) região INSPECTOR/campo: já coberto por test_object_field.ts (soltar um
// tile no ObjectField) — aqui só confirma que setfield aceita o caminho, como
// o item 4 pede (agente grava o mesmo jeito que o drop grava) ──────────────
const rSet = cmd("setfield 1 AudioSource clip " + destAudio);
check(rSet.indexOf("[ok]") === 0, "setfield no campo @asset: " + rSet);

fs.remove_file(destAudio);
fs.remove_file(destImg);
io.print("[PASSOU] Explorer drop (shim): classificação, destino, import, viewport, hierarquia, campo — sem soltura física (coberta manualmente pelo controlador)");
