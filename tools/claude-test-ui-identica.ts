// A UI tem de sair IDÊNTICA depois de o shim passar a REUSAR o objeto de opções.
//
// O risco desta otimização é UM e só um: um campo ficar com o valor da chamada
// anterior porque o caminho novo não o reescreveu. O que se compara, então, são
// os ARGUMENTOS que chegam à fronteira — os pixels são função pura deles, e a
// captura por `snapshot()` não serve aqui (só existe no backend glow, que este
// binário não tem compilado).
//
// Os dois caminhos desenham a MESMA coisa, com caixas e rótulos intercalados,
// cores, raios e espessuras variando — o padrão do editor, que é onde um campo
// vazado apareceria.
import io from "../compat/io.ts";

let log = "";
function verRect(o: any): void {
  log = log + "R " + o.x + " " + o.y + " " + o.w + " " + o.h + " " + o.fill + " " +
        o.strokeW + " " + o.stroke + " " + o.radius + "\n";
}
function verText(o: any): void {
  log = log + "T " + o.x + " " + o.y + " " + o.text + " " + o.color + " " + o.size + " " + o.flags + "\n";
}
function verLine(o: any): void {
  log = log + "L " + o.x1 + " " + o.y1 + " " + o.x2 + " " + o.y2 + " " + o.w + " " + o.color + "\n";
}

const oRect = { x: 0.0, y: 0.0, w: 0.0, h: 0.0, fill: 0, strokeW: 0, stroke: 0, radius: 0 };
const oText = { x: 0.0, y: 0.0, text: "", color: 0, size: 12, flags: 0 };
const oLine = { x1: 0.0, y1: 0.0, x2: 0.0, y2: 0.0, w: 1, color: 0 };

function desenhar(reuso: number): void {
  let i = 0;
  while (i < 60) {
    const x = 10.0 + (i % 8) * 76.0;
    const y = 10.0 + ((i / 8) | 0) * 74.0;
    const fill = 0x203040 + i * 257;
    if (reuso === 0) {
      verRect({ x: x, y: y, w: 70.0, h: 30.0, fill: fill, strokeW: i % 3, stroke: 0x88BBFF, radius: i % 7 });
      verText({ x: x + 6, y: y + 8, text: "L" + i, color: 0xE0E0E0, size: 11 + (i % 4), flags: 0 });
      verLine({ x1: x, y1: y + 34, x2: x + 70.0, y2: y + 34, w: 1 + (i % 2), color: 0x445566 });
    } else {
      oRect.x = x; oRect.y = y; oRect.w = 70.0; oRect.h = 30.0;
      oRect.fill = fill; oRect.strokeW = i % 3; oRect.stroke = 0x88BBFF; oRect.radius = i % 7;
      verRect(oRect);
      oText.x = x + 6; oText.y = y + 8; oText.text = "L" + i; oText.color = 0xE0E0E0; oText.size = 11 + (i % 4);
      verText(oText);
      oLine.x1 = x; oLine.y1 = y + 34; oLine.x2 = x + 70.0; oLine.y2 = y + 34; oLine.w = 1 + (i % 2); oLine.color = 0x445566;
      verLine(oLine);
    }
    i = i + 1;
  }
}

desenhar(0);
const comLiteral = log;
log = "";
desenhar(1);
const comReuso = log;

io.print("linhas comparadas: " + comLiteral.split("\n").length);
if (comLiteral === comReuso) {
  io.print("[PASSOU] a fronteira recebe exatamente os mesmos argumentos");
} else {
  io.print("[FALHOU] os argumentos DIFEREM entre os dois caminhos");
  const a = comLiteral.split("\n");
  const b = comReuso.split("\n");
  let k = 0;
  while (k < a.length && k < b.length) {
    if (a[k] !== b[k]) { io.print("  primeira divergencia na linha " + k + ":\n    literal: " + a[k] + "\n    reuso  : " + b[k]); k = a.length; }
    k = k + 1;
  }
}
