// gameview — a aba Jogo pela porta de controle (estado do editor, sem Desfazer).
import { scene, S } from "../session";
import { UI_GAME_VIEW as G } from "../../ui_config";
export function cmdGameView(parts: string[]): string {
  const acao = parts.length > 1 ? parts[1] : "";
  let out = "";
  if (acao === "") {
    out = "[gameview] aba=" + (S.gameView !== 0 ? "jogo" : "cena") + " proporcao=" + G.aspectTokens[S.gameAspect] +
      " camera=" + (S.gameCamera !== null && scene.objects.indexOf(S.gameCamera) >= 0 ? "#" + scene.objects.indexOf(S.gameCamera) : "todas") + " previa=" + (S.cameraPreview !== 0 ? "on" : "off");
  } else if (acao === "jogo" || acao === "cena") { S.gameView = acao === "jogo" ? 1 : 0; out = "[ok] aba " + acao; }
  else if (acao === "proporcao") {
    const k = G.aspectTokens.indexOf(parts.length > 2 ? parts[2] : "");
    if (k < 0) out = "[erro] proporcao: use " + G.aspectTokens.join(", ");
    else { S.gameAspect = k; out = "[ok] proporcao " + G.aspectTokens[k]; }
  } else if (acao === "camera") {
    const alvo = parts.length > 2 ? parts[2] : "";
    const i = parseFloat(alvo);
    if (alvo === "todas") { S.gameCamera = null; out = "[ok] camera todas"; }
    else if (i === i && i === Math.floor(i) && i >= 0 && i < scene.objects.length && scene.objects[i].camIdx >= 0) { S.gameCamera = scene.objects[i]; out = "[ok] camera #" + i; }
    else out = "[erro] camera: use todas ou o índice de um objeto com Camera";
  } else if (acao === "previa") {
    const v = parts.length > 2 ? parts[2] : "";
    if (v === "on" || v === "off") { S.cameraPreview = v === "on" ? 1 : 0; out = "[ok] previa " + v; }
    else out = "[erro] previa: use on ou off";
  } else out = "[erro] uso: gameview [jogo|cena|proporcao <p>|camera <todas|obj>|previa <on|off>]";
  return out;
}
