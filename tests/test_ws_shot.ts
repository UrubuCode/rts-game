// Teste SEM JANELA do `shot`: `shot diff` sobre PNGs do mesmo formato que a
// captura grava (System.Drawing), argumentos inválidos, e o caminho ADIADO da
// captura (a resposta chega depois do processo; sem janela, o script responde
// que o processo não tem janela e nada é gravado).
//
//   rts.exe run tests/test_ws_shot.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { spawnSync } from "node:child_process";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { RESPOSTA_ADIADA, tomarAdiado, avancarAdiado } from "@editor/control/adiado";
import { compararPNG } from "@editor/control/commands/shot";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
instalarEditorReal();
fs.create_dir_all("build/claude-shot-test");
const A = "build/claude-shot-test/a.png";
const B = "build/claude-shot-test/b.png";
const C = "build/claude-shot-test/c.png";
// 10x10 preto; B = A com 3 pixels vermelhos; C = 12x10 (tamanho diferente)
const ps = "Add-Type -AssemblyName System.Drawing; " +
  "$a = New-Object System.Drawing.Bitmap 10,10; $g=[System.Drawing.Graphics]::FromImage($a); $g.Clear([System.Drawing.Color]::Black); $g.Dispose(); $a.Save('" + A + "', [System.Drawing.Imaging.ImageFormat]::Png); " +
  "$a.SetPixel(1,2,[System.Drawing.Color]::Red); $a.SetPixel(7,8,[System.Drawing.Color]::Red); $a.SetPixel(4,4,[System.Drawing.Color]::FromArgb(255,5,0,0)); $a.Save('" + B + "', [System.Drawing.Imaging.ImageFormat]::Png); " +
  "$c = New-Object System.Drawing.Bitmap 12,10; $c.Save('" + C + "', [System.Drawing.Imaging.ImageFormat]::Png)";
const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" });
check(r.status === 0 && fs.exists(A) && fs.exists(B) && fs.exists(C), "gerou os PNGs de teste: " + r.stderr);

const iguais = execCommand(800, 600, "shot diff " + A + " " + A);
check(iguais.indexOf("[shot] diff 0.000% (0 de 100 pixels, 10x10") === 0, "iguais: " + iguais);
const tres = execCommand(800, 600, "shot diff " + A + " " + B);
check(tres.indexOf("[shot] diff 3.000% (3 de 100 pixels") === 0, "3 pixels: " + tres);
check(tres.indexOf("caixa=1,2,7,7") > 0, "caixa dos pixels diferentes: " + tres);
// tolerância 10: o pixel (5,0,0) some da contagem
const tol = execCommand(800, 600, "shot diff " + A + " " + B + " 10");
check(tol.indexOf("[shot] diff 2.000% (2 de 100") === 0, "tolerancia: " + tol);
const d = compararPNG(A, B, 0);
check(d.diferentes === 3 && d.largura === 10 && d.percentual() === 3.0, "compararPNG direto");
check(execCommand(800, 600, "shot diff " + A + " " + C).indexOf("[erro] shot diff: tamanhos diferentes") === 0, "tamanhos");
check(execCommand(800, 600, "shot diff " + A + " build/nao_existe.png").indexOf("[erro] shot diff: nao existe") === 0, "inexistente");
const ruins: string[] = ["shot diff", "shot diff " + A, "shot diff " + A + " " + B + " 999", "shot diff " + A + " " + B + " x",
  "shot foto.jpg", "shot a.png b.png", "shot tela", "shot -Saida.png", "shot C:/Windows/Temp/fora.png", "shot ../fora.png"];
let i = 0;
while (i < ruins.length) {
  const out = execCommand(800, 600, ruins[i]);
  check(out.indexOf("[erro]") === 0, ruins[i] + " deveria ser [erro]: " + out);
  i = i + 1;
}
// sem janela desenhada, `shot jogo` recusa na hora (sem processo)
check(execCommand(800, 600, "shot jogo").indexOf("[erro] shot jogo") === 0, "shot jogo sem vista");

// Captura ADIADA: sem janela, o script responde que o processo não tem janela.
const saida = "build/claude-shot-test/sem-janela.png";
const out = execCommand(800, 600, "shot " + saida);
check(out === RESPOSTA_ADIADA, "shot adia a resposta: " + out);
const espera = tomarAdiado();
check(espera !== null && tomarAdiado() === null, "a espera e entregue uma vez");
let voltas = 0;
while (!avancarAdiado(espera)) { pumpEvents(); voltas = voltas + 1; }
check(espera.texto.indexOf("[erro] shot: processo") === 0 && espera.texto.indexOf("sem janela") > 0, "sem janela: " + espera.texto);
check(!fs.exists(saida), "nada gravado sem janela");
check(execCommand(800, 600, "doc json").indexOf("\"name\":\"shot\"") > 0, "shot no manifesto");
io.print("[PASSOU] ws shot: diff (percentual, caixa, tolerancia, tamanhos), argumentos e captura adiada (" + voltas + " voltas)");
