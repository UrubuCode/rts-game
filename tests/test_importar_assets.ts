import fs from "@compat/fs.ts";
import { importFileToAssets, isAudioPath, defaultImportDir } from "@editor/import_assets";
import io from "@compat/io.ts";

function check(c: boolean, m: string): void { if (!c) throw new Error("FALHOU: " + m); }

fs.create_dir_all("build/test-import-src");
fs.write("build/test-import-src/som.wav", "conteudo-fake");
check(isAudioPath("build/test-import-src/som.wav"), "classifica .wav como audio");
check(!isAudioPath("build/test-import-src/textura.png"), "png nao e audio");

// remove destino de execuções anteriores
try { fs.remove_dir_all("build/test-import-dest"); } catch {}

const d1 = importFileToAssets("build/test-import-src/som.wav", "build/test-import-dest");
check(d1 === "build/test-import-dest/som.wav", "primeira copia: nome original, got=" + d1);
check(fs.exists(d1), "arquivo copiado existe");

const d2 = importFileToAssets("build/test-import-src/som.wav", "build/test-import-dest");
check(d2 === "build/test-import-dest/som 1.wav", "colisao: sufixo ' 1', got=" + d2);

const d3 = importFileToAssets("build/test-import-src/som.wav", "build/test-import-dest");
check(d3 === "build/test-import-dest/som 2.wav", "colisao: sufixo ' 2', got=" + d3);

// arquivo ja dentro de assets/: nao copia, usa o caminho
fs.create_dir_all("assets/audio");
fs.write("assets/audio/ja-existe.wav", "x");
const d4 = importFileToAssets("assets/audio/ja-existe.wav", "build/test-import-dest");
check(d4 === "assets/audio/ja-existe.wav", "ja dentro de assets: usa o caminho, got=" + d4);
fs.remove_file("assets/audio/ja-existe.wav");

// arquivo inexistente -> erro claro
let threw = false;
try { importFileToAssets("build/test-import-src/nao-existe.wav", "build/test-import-dest"); }
catch (e) { threw = true; check(String(e).indexOf("não encontrado") >= 0, "mensagem clara: " + String(e)); }
check(threw, "arquivo inexistente lanca erro");

check(defaultImportDir("x.wav", "assets/qualquer") === "assets/audio", "default de audio e assets/audio");
check(defaultImportDir("x.png", "assets/qualquer") === "assets/qualquer", "default de outros e a pasta aberta");

io.print("[PASSOU] importFileToAssets: copia, sufixo em colisao, ja-dentro-de-assets, arquivo sumiu, defaultImportDir");
