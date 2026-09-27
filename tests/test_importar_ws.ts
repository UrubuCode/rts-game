import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import "@engine/generated/editor_extensions";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { history } from "@editor/undo";
import { AudioSource } from "@scripts/audiosource";

function check(c: boolean, m: string): void { if (!c) throw new Error("FALHOU: " + m); }
function cmd(l: string): string { return execCommand(800, 600, l); }

instalarEditorReal();

fs.create_dir_all("build/test-import-src");
fs.write("build/test-import-src/efeito.wav", "conteudo-fake");
try { fs.remove_dir_all("assets/importados-teste"); } catch {}

// ── WS importar <caminho> [pasta] ────────────────────────────────────────
const r1 = cmd("importar build/test-import-src/efeito.wav assets/importados-teste");
check(r1.indexOf("[ok] importado") === 0, "importar responde [ok]: " + r1);
check(fs.exists("assets/importados-teste/efeito.wav"), "arquivo foi copiado pra dentro de assets/");

const r2 = cmd("importar build/test-import-src/nao-existe.wav assets/importados-teste");
check(r2.indexOf("[erro]") === 0, "importar de arquivo inexistente da erro claro: " + r2);

// default sem pasta: .wav vai pra assets/audio
try { fs.remove_file("assets/audio/efeito.wav"); } catch {}
const r3 = cmd("importar build/test-import-src/efeito.wav");
check(r3.indexOf("assets/audio/efeito") >= 0, "sem pasta, audio vai pra assets/audio: " + r3);

// ── setfield AudioSource clip / modo ──────────────────────────────────────
scene.clear(); history.u = []; history.r = [];
const go = scene.createGameObject("Fonte");
const src = new AudioSource();
go.addBehavior(src);
const rc = cmd("setfield 0 AudioSource clip assets/audio/efeito.wav");
check(rc.indexOf("[ok]") === 0, "setfield clip: " + rc);
check(src.clip === "assets/audio/efeito.wav", "clip foi setado: " + src.clip);
const rm = cmd("setfield 0 AudioSource modo arquivo");
check(rm.indexOf("[ok]") === 0, "setfield modo: " + rm);
check(src.modo === "arquivo", "modo foi setado: " + src.modo);
const rm2 = cmd("setfield 0 AudioSource modo gerador");
check(rm2.indexOf("[ok]") === 0 && src.modo === "gerador", "setfield modo de volta pra gerador: " + rm2);

io.print("[PASSOU] WS importar + setfield AudioSource clip/modo");
