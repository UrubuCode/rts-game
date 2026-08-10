// Verificação do porte de `editor/thumbs.ts` — RODA, não só compila.
//
// Abre uma janela de verdade, gera as miniaturas de um .obj, de um prefab e de
// uma cena do projeto, blita cada uma com drawThumb e imprime o thumbReport de
// cada uma. O que se lê no relatório: `lit` > 0 significa que o rasterizador
// pintou algo diferente do fundo, e `bg` > 0 que o fundo sobreviveu — as duas
// juntas são a assinatura de um preview de verdade, e não de um quadro chapado.

import { openWindow, pump, isOpen, close, beginFrame, endFrame } from "rts:egui";
import { drawThumb, thumbReport, TH_MODEL, TH_PREFAB, TH_SCENE, TH_IMAGE } from "../../editor/thumbs";

const MODELO = "assets/models/torus.obj";
const CENA = "assets/scene.json";

const win = openWindow("thumbs — porte", 420, 220, 0);
if (win <= 0) {
  println("openWindow devolveu 0 — o motivo saiu no stderr acima");
} else {
  println("== thumbReport (coloridos fundo distintas) ==");
  println("modelo " + MODELO);
  println(thumbReport(win, MODELO, TH_MODEL, 16));
  println("cena " + CENA);
  println(thumbReport(win, CENA, TH_SCENE, 16));
  // O caminho que ficou sem imgdec: tem de responder "(sem preview)" e não
  // explodir — é o fallback que assets.ts já desenha como ícone genérico.
  println("imagem (sem imgdec, esperado '(sem preview)')");
  println(thumbReport(win, "assets/README.txt", TH_IMAGE, 4));

  // E agora o blit propriamente dito, que é o que o thumbReport NÃO exercita.
  let frame = 0;
  let desenhou = 0;
  while (isOpen(win) && frame < 60) {
    pump(win);
    beginFrame(win);
    desenhou = drawThumb(win, MODELO, TH_MODEL, 20, 20, 96);
    drawThumb(win, CENA, TH_SCENE, 140, 20, 96);
    drawThumb(win, "assets/README.txt", TH_IMAGE, 260, 20, 96);
    endFrame(win);
    frame = frame + 1;
  }
  println("drawThumb(modelo) = " + desenhou + " (1 = blitou) apos " + frame + " frames");
  close(win);
}
