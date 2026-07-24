// Editor RTS — DRAG & DROP de assets (estilo Unity), a LÓGICA compartilhada.
// Mesma implementação para as DUAS entradas:
//   • o humano arrastando um tile do Project com o mouse (main.ts)
//   • a LLM/ferramenta pelo WebSocket (comandos `drop`/`droptex`/`dropmesh`)
// Assim os dois caminhos não divergem: quem muda a regra muda aqui uma vez.
//
// Um asset é identificado por um PAYLOAD tipado "<kind>:<path>" — o mesmo que o
// asset browser produz ao arrastar (assets.ts: assetDragPayload).

import { scene, S } from "./control/session";
import { GameObject } from "../engine/core/gameobject";
import { instantiatePrefab, loadSceneFrom } from "./sceneio";
import { loadObj, loadTexture } from "../engine/render/gpu3d";
import { loadModel, isModelPath, SubMesh } from "../engine/render/model";
import { screenToPlane, screenToForward, snapv } from "./gizmo";
import { subStr } from "./widgets";

/// Classifica um path em `kind` de drop pela EXTENSÃO — espelha o classify() do
/// asset browser, pra `drop <path>` pelo WS aceitar o mesmo que o mouse aceita.
export function kindOfPath(path: string): string {
  if (endsW(path, ".prefab.json")) return "prefab";
  if (endsW(path, ".json")) return "scene";
  if (endsW(path, ".png") || endsW(path, ".jpg") || endsW(path, ".jpeg") || endsW(path, ".bmp")) return "tex";
  if (isModelPath(path)) return "model";   // .obj / .glb / .gltf
  return "other";
}
function endsW(s: string, suf: string): boolean {
  const n = s.length; const m = suf.length;
  if (m > n) return false;
  let i = 0;
  while (i < m) { if (s.charCodeAt(n - m + i) !== suf.charCodeAt(i)) return false; i = i + 1; }
  return true;
}

/// nome do arquivo sem pasta e sem extensão — vira o nome do GameObject criado.
export function baseName(path: string): string {
  let cut = 0 - 1;
  let i = 0;
  while (i < path.length) { if (path.charCodeAt(i) === 47) cut = i; i = i + 1; }
  let s = path;
  if (cut >= 0) s = subStr(path, cut + 1, path.length);
  let dot = 0 - 1;
  let j = 0;
  while (j < s.length) { if (s.charCodeAt(j) === 46) dot = j; j = j + 1; }
  if (dot > 0) s = subStr(s, 0, dot);
  if (s.length === 0) return "Asset";
  return s;
}

/// Ponto do MUNDO sob um pixel da tela: intersecta o raio da câmera com o plano
/// do chão (Y=0); se o raio não bater no chão (mirando o céu), cai 12 unidades à
/// frente. Aplica o snap-to-grid quando S.snap está ligado. Devolve [x,y,z].
export function groundAt(sx: f64, sy: f64, focalW: f64, W: f64, H: f64,
                         cyw: f64, syw: f64, cpt: f64, spt: f64): f64[] {
  let wx: f64 = 0.0; let wy: f64 = 0.0; let wz: f64 = 0.0;
  const hit = screenToPlane(sx, sy, S.camX, S.camY, S.camZ, cyw, syw, cpt, spt, focalW, W, H, 0.0);
  if (hit[3] !== 0.0) { wx = hit[0]; wy = hit[1]; wz = hit[2]; }
  else {
    const fwd = screenToForward(sx, sy, S.camX, S.camY, S.camZ, cyw, syw, cpt, spt, focalW, W, H, 12.0);
    wx = fwd[0]; wy = fwd[1]; wz = fwd[2];
  }
  if (S.snap !== 0) { wx = snapv(wx, 0.5); wz = snapv(wz, 0.5); }
  const out: f64[] = [wx, wy, wz];
  return out;
}

/// Objeto sob um pixel da tela (centro projetado mais próximo, dentro de um raio).
/// -1 = nenhum. Mesmo critério do picking de seleção do editor.
export function pickAt(sx: f64, sy: f64, focalW: f64, W: f64, H: f64,
                       cyw: f64, syw: f64, cpt: f64, spt: f64): number {
  let best = 0 - 1;
  let bestD: f64 = 1e30;
  let pi = 0;
  while (pi < scene.objects.length) {
    const po = scene.objects[pi];
    if (po.meshKind !== 0 || po.customMesh > 0) {
      const dx = po.transform.wx - S.camX; const dy = po.transform.wy - S.camY; const dz = po.transform.wz - S.camZ;
      const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
      const y2 = dy * cpt - z1 * spt; const z2 = dy * spt + z1 * cpt;
      if (z2 > 0.2) {
        const psx = W * 0.5 + (x1 / z2) * focalW; const psy = H * 0.5 - (y2 / z2) * focalW;
        const ex = psx - sx; const ey = psy - sy; const d2 = ex * ex + ey * ey;
        if (d2 < bestD && d2 < 4000) { bestD = d2; best = pi; }
      }
    }
    pi = pi + 1;
  }
  return best;
}

/// Converte uma SUBMESH carregada num GameObject pronto pra cena: mesh na VRAM,
/// cor difusa do material (.mtl / glTF baseColor) e textura, se o arquivo trouxe.
function partToObject(sm: SubMesh, name: string, srcPath: string, partIdx: number, win: number): GameObject {
  const go = new GameObject(name);
  go.setMesh(1, sm.cr, sm.cg, sm.cb);   // customMesh manda no render; meshKind é fallback
  go.customMesh = sm.meshId;
  go.meshPath = srcPath;
  go.meshPart = partIdx;                // pra reconstruir a submesh certa no load
  go.stationary = 1;
  if (sm.texPath.length > 0) {
    const tid = loadTexture(win, sm.texPath) | 0;
    if (tid > 0) go.applyTexture(tid, sm.texPath);
  }
  return go;
}

/// INSTANCIA um asset na cena numa posição de MUNDO. `placed`=0 usa a posição
/// padrão do asset (drop sem coordenada, ex.: solto na hierarquia). Devolve o
/// índice do objeto criado, ou -1 quando o asset não gera objeto (cena/pasta).
export function instantiateAt(kind: string, path: string, wx: f64, wy: f64, wz: f64,
                              placed: number, win: number): number {
  if (kind === "prefab") {
    const before = scene.objects.length;
    instantiatePrefab(path);
    if (scene.objects.length > before) {
      const ni = scene.objects.length - 1;
      // ASSENTA sobre o chão: o ponto do drop é o piso (Y=0), então sobe metade
      // da altura — senão o objeto nasce cravado no chão e a colisão o expulsa.
      if (placed !== 0) scene.objects[ni].transform.setPosition(wx, wy + scene.objects[ni].transform.sy * 0.5, wz);
      S.selected = ni;
      return ni;
    }
  } else if (kind === "model") {
    // .obj/.glb/.gltf → 1..N submeshes (multi-material vira várias). A cadeia de
    // render é 1 objeto → 1 mesh → 1 material, então CADA submesh vira um
    // GameObject; com mais de uma, elas nascem sob um nó-raiz que agrupa tudo
    // (mover/rotacionar a raiz move o modelo inteiro).
    const parts = loadModel(win, path);
    if (parts.length === 0) return 0 - 1;
    let py: f64 = 1.0;
    let px: f64 = 0.0; let pz: f64 = 0.0;
    if (placed !== 0) { px = wx; py = wy + 0.5; pz = wz; }

    if (parts.length === 1) {
      const go = partToObject(parts[0], baseName(path), path, 0, win);
      go.transform.setPosition(px, py, pz);
      scene.add(go);
      S.selected = scene.objects.length - 1;
      return S.selected;
    }
    // raiz vazia (meshKind 0 = só nó) + uma filha por submesh
    const root = new GameObject(baseName(path));
    root.transform.setPosition(px, py, pz);
    root.stationary = 1;
    scene.add(root);
    const rootIdx = scene.objects.length - 1;
    let i = 0;
    while (i < parts.length) {
      const child = partToObject(parts[i], parts[i].name, path, i, win);
      child.parent = rootIdx;   // offset local zero: a submesh já vem no espaço do modelo
      scene.add(child);
      i = i + 1;
    }
    S.selected = rootIdx;
    return rootIdx;
  } else if (kind === "tex") {
    // textura solta no VAZIO: cria um cubo já texturizado (aplicar num objeto
    // EXISTENTE é o outro caminho — applyTexToObject).
    const tid = loadTexture(win, path) | 0;
    if (tid > 0) {
      const go = new GameObject(baseName(path));
      go.setMesh(1, 220, 220, 220);
      if (placed !== 0) go.transform.setPosition(wx, wy + go.transform.sy * 0.5, wz);
      else go.transform.setPosition(0.0, 1.0, 0.0);
      go.applyTexture(tid, path);
      scene.add(go);
      S.selected = scene.objects.length - 1;
      return S.selected;
    }
  } else if (kind === "scene") {
    // cena arrastada = abrir (mesma semântica do duplo-clique no Project)
    loadSceneFrom(path);
    S.selected = 0;
  }
  // "other"/pasta/script: sem efeito na cena
  return 0 - 1;
}

/// Aplica uma imagem como textura num objeto EXISTENTE. Devolve o id de GPU
/// (0 = falhou ao carregar/índice inválido).
export function applyTexToObject(idx: number, path: string, win: number): number {
  if (idx < 0 || idx >= scene.objects.length) return 0;
  const tid = loadTexture(win, path) | 0;
  if (tid <= 0) return 0;
  scene.objects[idx].applyTexture(tid, path);
  return tid;
}

/// Troca a MESH de um objeto existente por um modelo do disco (.obj/.glb/.gltf —
/// slot Mesh do inspector). Modelo multi-submesh: usa a PRIMEIRA parte, já que o
/// objeto-alvo é um só (pra trazer todas, arraste pra cena em vez do slot).
/// Também adota a cor/textura do material daquela parte. Devolve o mesh id (0 = falhou).
export function applyMeshToObject(idx: number, path: string, win: number): number {
  if (idx < 0 || idx >= scene.objects.length) return 0;
  const parts = loadModel(win, path);
  if (parts.length === 0) return 0;
  const sm = parts[0];
  const o = scene.objects[idx];
  o.customMesh = sm.meshId;
  o.meshPath = path;
  o.cr = sm.cr; o.cg = sm.cg; o.cb = sm.cb;
  if (sm.texPath.length > 0) {
    const tid = loadTexture(win, sm.texPath) | 0;
    if (tid > 0) o.applyTexture(tid, sm.texPath);
  }
  return sm.meshId;
}
