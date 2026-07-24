// Comandos de DRAG & DROP de assets pelo WebSocket — o equivalente, para a LLM,
// de arrastar um tile do Project pra cena/objeto/slot com o mouse. Compartilham
// a MESMA lógica do drag do humano (editor/dnd.ts), então os dois não divergem.
//
// A coordenada de tela é opcional: com <sx> <sy> o asset cai no ponto do CHÃO sob
// aquele pixel (como o mouse); sem ela, usa a posição padrão ou a que for passada
// em coordenadas de mundo.
import math from "rts:math";
import fs from "rts:fs";

import { scene, S } from "../session";
import { kindOfPath, instantiateAt, groundAt, pickAt, applyTexToObject, applyMeshToObject } from "../../dnd";
import { isModelPath } from "../../../engine/render/model";
import { thumbReport, TH_IMAGE, TH_MODEL, TH_PREFAB, TH_SCENE } from "../../thumbs";
import { subStr } from "../../widgets";

const FOV: f64 = 1.0472;

// componentes da câmera usados pela projeção (mesma decomposição do main).
function focal(h: number): f64 { return (h * 0.5) / math.tan(FOV * 0.5); }

/// drop <path> [sx sy] — "arrasta" o asset pra CENA. Com <sx> <sy> (pixels da
/// janela) o objeto nasce no ponto do chão sob esse pixel — igual a soltar o
/// mouse ali; sem eles, cai na posição padrão do asset.
/// Aceita o mesmo que o Project aceita: prefab, .obj, imagem, cena.
export function cmdDrop(parts: string[], w: number, h: number): string {
  if (parts.length < 2) return "[erro] uso: drop <path> [sx sy]";
  const path = parts[1];
  if (!fs.exists(path)) return "[erro] nao existe: " + path;
  const kind = kindOfPath(path);
  if (kind === "other") return "[erro] asset nao soltavel na cena: " + path + " (use prefab/.obj/imagem/cena)";

  let wx: f64 = 0.0; let wy: f64 = 0.0; let wz: f64 = 0.0;
  let placed = 0;
  let where = "(posicao padrao)";
  if (parts.length >= 4) {
    const sx = parseFloat(parts[2]);
    const sy = parseFloat(parts[3]);
    const cyw = math.cos(S.camYaw); const syw = math.sin(S.camYaw);
    const cpt = math.cos(S.camPitch); const spt = math.sin(S.camPitch);
    const g = groundAt(sx, sy, focal(h), w, h, cyw, syw, cpt, spt);
    wx = g[0]; wy = g[1]; wz = g[2];
    placed = 1;
    where = "tela(" + sx + "," + sy + ") -> mundo(" + wx + "," + wy + "," + wz + ")";
  }

  const before = scene.objects.length;
  const idx = instantiateAt(kind, path, wx, wy, wz, placed, S.win);
  if (idx < 0) {
    if (kind === "scene") return "[ok] drop " + path + " -> cena carregada (" + scene.objects.length + " objs)";
    return "[erro] falha ao instanciar: " + path;
  }
  return "[ok] drop " + path + " [" + kind + "] -> #" + idx + " " + scene.objects[idx].name +
    " " + where + " (objs " + before + "->" + scene.objects.length + ")";
}

/// dropat <path> <x> <y> <z> — solta o asset direto numa posição de MUNDO
/// (sem passar por coordenada de tela). Útil pra script/automação.
export function cmdDropAt(parts: string[]): string {
  if (parts.length < 5) return "[erro] uso: dropat <path> <x> <y> <z>";
  const path = parts[1];
  if (!fs.exists(path)) return "[erro] nao existe: " + path;
  const kind = kindOfPath(path);
  if (kind === "other") return "[erro] asset nao soltavel na cena: " + path;
  const x = parseFloat(parts[2]);
  const y = parseFloat(parts[3]);
  const z = parseFloat(parts[4]);
  const idx = instantiateAt(kind, path, x, y, z, 1, S.win);
  if (idx < 0) {
    if (kind === "scene") return "[ok] dropat " + path + " -> cena carregada";
    return "[erro] falha ao instanciar: " + path;
  }
  return "[ok] dropat " + path + " [" + kind + "] -> #" + idx + " em (" + x + "," + y + "," + z + ")";
}

/// dropon <path> <objIdx> — solta o asset SOBRE um objeto existente, como largar
/// no slot do inspector / na linha da hierarquia:
///   imagem → vira a TEXTURA do objeto | .obj → vira a MESH do objeto
export function cmdDropOn(parts: string[]): string {
  if (parts.length < 3) return "[erro] uso: dropon <path> <objIdx>";
  const path = parts[1];
  if (!fs.exists(path)) return "[erro] nao existe: " + path;
  const oi = parseFloat(parts[2]) | 0;
  if (oi < 0 || oi >= scene.objects.length) return "[erro] objeto invalido: " + oi;
  const kind = kindOfPath(path);
  if (kind === "tex") {
    const tid = applyTexToObject(oi, path, S.win);
    if (tid === 0) return "[erro] falha ao carregar textura: " + path;
    S.selected = oi;
    return "[ok] dropon " + path + " -> textura de #" + oi + " (" + scene.objects[oi].name + ") tex#" + tid;
  }
  if (kind === "model") {
    const mid = applyMeshToObject(oi, path, S.win);
    if (mid === 0) return "[erro] falha ao carregar mesh: " + path;
    S.selected = oi;
    return "[ok] dropon " + path + " -> mesh de #" + oi + " (" + scene.objects[oi].name + ") mesh#" + mid;
  }
  return "[erro] " + kind + " nao se aplica a um objeto (use imagem pra textura ou .obj pra mesh)";
}

/// pickat <sx> <sy> — qual objeto está sob esse pixel da tela? (-1 = nenhum).
/// É o hit-test que o drop de textura usa pra decidir "aplicar" vs "criar novo".
export function cmdPickAt(parts: string[], w: number, h: number): string {
  if (parts.length < 3) return "[erro] uso: pickat <sx> <sy>";
  const sx = parseFloat(parts[1]);
  const sy = parseFloat(parts[2]);
  const cyw = math.cos(S.camYaw); const syw = math.sin(S.camYaw);
  const cpt = math.cos(S.camPitch); const spt = math.sin(S.camPitch);
  const i = pickAt(sx, sy, focal(h), w, h, cyw, syw, cpt, spt);
  if (i < 0) return "[pickat] (" + sx + "," + sy + ") -> nenhum objeto";
  return "[pickat] (" + sx + "," + sy + ") -> #" + i + " " + scene.objects[i].name;
}

/// thumb <path> [cols] — INSPECIONA o thumbnail que o Project mostra pro asset
/// (a própria imagem, ou um render 3D da malha). Devolve estatísticas dos pixels
/// + preview ASCII, pra validar o preview SEM screenshot. cols default 16.
export function cmdThumb(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: thumb <path> [cols]";
  const path = parts[1];
  if (!fs.exists(path)) return "[erro] nao existe: " + path;
  let cols = 16;
  if (parts.length > 2) cols = parseFloat(parts[2]) | 0;
  if (cols < 4) cols = 4;
  if (cols > 48) cols = 48;
  // classifica pela extensão, do mesmo jeito que o asset browser: modelo e
  // prefab/cena viram render 3D; o resto é tentado como imagem.
  const k = kindOfPath(path);
  let kind = TH_IMAGE;
  if (k === "model") kind = TH_MODEL;
  else if (k === "prefab") kind = TH_PREFAB;
  else if (k === "scene") kind = TH_SCENE;
  const rep = thumbReport(S.win, path, kind, cols);
  const nl = rep.indexOf("\n");
  // subStr (nao `.substring` direto): a string vem de funcao que le estado de
  // MODULO — fatiar sem passar por parametro devolve "undefined" no motor.
  const head = subStr(rep, 0, nl);
  const art = subStr(rep, nl + 1, rep.length);
  let tipo = "imagem";
  if (kind === TH_MODEL) tipo = "modelo(render 3D)";
  else if (kind === TH_PREFAB) tipo = "prefab(render 3D)";
  else if (kind === TH_SCENE) tipo = "cena(render 3D)";
  // O ASCII usa "|" como quebra de linha: o protocolo ws manda UMA resposta por
  // linha, então um \n aqui truncaria a mensagem. O cliente troca | por \n.
  return "[thumb] " + path + " " + tipo + " | px/fundo/cores = " + head + " | " + art;
}

/// groundat <sx> <sy> — ponto do CHÃO (plano Y=0) sob esse pixel. É a conversão
/// tela→mundo que posiciona o objeto arrastado; útil pra mirar antes de soltar.
export function cmdGroundAt(parts: string[], w: number, h: number): string {
  if (parts.length < 3) return "[erro] uso: groundat <sx> <sy>";
  const sx = parseFloat(parts[1]);
  const sy = parseFloat(parts[2]);
  const cyw = math.cos(S.camYaw); const syw = math.sin(S.camYaw);
  const cpt = math.cos(S.camPitch); const spt = math.sin(S.camPitch);
  const g = groundAt(sx, sy, focal(h), w, h, cyw, syw, cpt, spt);
  return "[groundat] (" + sx + "," + sy + ") -> mundo(" + g[0] + "," + g[1] + "," + g[2] + ")";
}
