// Comandos de CENA/sessão: select, delete, cam, focus, play, pause, clear, loadscene.
import math from "../../../compat/math.ts";
import { playTone, activeVoices, audioReady, audioRate } from "../../../engine/audio/audio";
import { logTail, logClear, logCount, logCountAtLeast, LOG_INFO, LOG_WARN, LOG_ERROR, LOG_DEBUG } from "../../../engine/core/logger";
import math from "../../../compat/math.ts";
import { Fluid } from "../../../scripts/fluid";
import { scene, S } from "../session";
import { loadSceneFrom, instantiateSceneUnder, cloneObject, saveScene } from "../../sceneio";
import { GameObject } from "../../../engine/core/gameobject";

export function cmdSelect(parts: string[]): string {
  S.selected = parseFloat(parts[1]) | 0;
  S.selection = [];   // seleção ÚNICA (limpa a multi)
  return "[ok] select #" + S.selected;
}

/// selectadd <i> — adiciona à MULTI-seleção (o gizmo manipula todos juntos).
export function cmdSelectAdd(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: selectadd <i>";
  const i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  // garante o selected atual na lista + adiciona i (sem duplicar)
  if (S.selection.length === 0 && S.selected >= 0) S.selection.push(S.selected);
  let j = 0; let has = 0;
  while (j < S.selection.length) { if (S.selection[j] === i) has = 1; j = j + 1; }
  if (has === 0) S.selection.push(i);
  S.selected = i;
  return "[ok] selectadd #" + i + " (multi: " + S.selection.length + ")";
}

/// iso [i] — ISOLA o objeto: esconde todos os outros (active=0). Chamar de novo (ou
/// com -1) mostra todos de volta. Útil pra focar num objeto numa cena cheia.
export function cmdIso(parts: string[]): string {
  let i = S.selected;
  if (parts.length > 1) i = parseFloat(parts[1]) | 0;
  // se já está isolado (algum inativo e o alvo ativo), ou i<0 → mostra todos
  let anyHidden = 0;
  let k = 0;
  while (k < scene.objects.length) { if (scene.objects[k].active === 0) anyHidden = 1; k = k + 1; }
  if (i < 0 || anyHidden !== 0) {
    let j = 0;
    while (j < scene.objects.length) { scene.objects[j].active = 1; j = j + 1; }
    return "[ok] iso off (todos visíveis)";
  }
  if (i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  let j = 0;
  while (j < scene.objects.length) { scene.objects[j].active = (j === i) ? 1 : 0; j = j + 1; }
  return "[ok] iso #" + i + " (resto oculto)";
}

/// group — cria um GameObject VAZIO (nó) e aninha os selecionados (multi ou o único)
/// sob ele. Mover/rotacionar o grupo move todos juntos (via parent). Ctrl+G da Unity.
export function cmdGroup(parts: string[]): string {
  // seleção efetiva
  const sel: number[] = [];
  if (S.selection.length > 0) {
    let k = 0; while (k < S.selection.length) { sel.push(S.selection[k]); k = k + 1; }
  } else if (S.selected >= 0 && S.selected < scene.objects.length) {
    sel.push(S.selected);
  }
  if (sel.length === 0) return "[erro] nada selecionado pra agrupar";
  const g = new GameObject("Group");   // meshKind 0 = nó vazio (não desenha)
  scene.add(g);
  const gidx = scene.objects.length - 1;
  let j = 0;
  while (j < sel.length) {
    const oi = sel[j];
    if (oi >= 0 && oi < scene.objects.length && oi !== gidx) { scene.objects[oi].parent = gidx; scene.objects[oi].refreshCollide(); }
    j = j + 1;
  }
  S.selected = gidx; S.selection = [];
  return "[ok] group " + sel.length + " objs sob #" + gidx;
}

/// ungroup [i] — DISSOLVE o grupo #i (default=selecionado): baka a posição de mundo
/// nos filhos diretos (pra não pularem) e remove o nó do grupo (os filhos viram raiz).
export function cmdUngroup(parts: string[]): string {
  let gi = S.selected;
  if (parts.length > 1) gi = parseFloat(parts[1]) | 0;
  if (gi < 0 || gi >= scene.objects.length) return "[erro] objeto invalido: " + gi;
  let k = 0; let n = 0;
  while (k < scene.objects.length) {
    const o = scene.objects[k];
    if (o.parent === gi) {
      o.transform.px = o.transform.wx; o.transform.py = o.transform.wy; o.transform.pz = o.transform.wz;
      o.transform.rx = o.transform.wrx; o.transform.ry = o.transform.wry;
      n = n + 1;
    }
    k = k + 1;
  }
  scene.removeAt(gi);   // filhos com parent==gi viram raiz (parent -1)
  S.selected = 0;
  return "[ok] ungroup #" + gi + " (" + n + " filhos soltos)";
}

/// vis [i] — TOGGLE de visibilidade do objeto (active). O render pula os inativos.
export function cmdVis(parts: string[]): string {
  let i = S.selected;
  if (parts.length > 1) i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  const o = scene.objects[i];
  o.active = o.active !== 0 ? 0 : 1;
  return "[ok] vis #" + i + " = " + (o.active !== 0 ? "on" : "off");
}

/// grid — TOGGLE de um chão-grade (plano xadrez grande, depth-tested) em y=0.
export function cmdGrid(parts: string[]): string {
  // remove se já existe (toggle off)
  let gi = 0 - 1;
  let i = 0;
  while (i < scene.objects.length) { if (scene.objects[i].name === "__grid") gi = i; i = i + 1; }
  if (gi >= 0) { scene.removeAt(gi); return "[ok] grid off"; }
  // senão cria: cubo achatado grande com textura xadrez (tex=1)
  const g = new GameObject("__grid");
  g.setMesh(1, 90, 90, 100);
  g.transform.setPosition(0, 0 - 0.02, 0);
  g.transform.sx = 60.0; g.transform.sy = 0.02; g.transform.sz = 60.0;
  g.tex = 1; g.stationary = 1;
  scene.add(g);
  return "[ok] grid on (chão xadrez 60x60)";
}

/// light [x y z ambient] — posição da luz pontual + ambiente (0..1). Sem args = consulta.
export function cmdLight(parts: string[]): string {
  if (parts.length < 5) {
    return "[light] pos(" + S.lightX + "," + S.lightY + "," + S.lightZ + ") amb=" + S.lightAmb + " (use: light x y z ambient)";
  }
  S.lightX = parseFloat(parts[1]); S.lightY = parseFloat(parts[2]); S.lightZ = parseFloat(parts[3]);
  S.lightAmb = parseFloat(parts[4]);
  return "[ok] light pos(" + S.lightX + "," + S.lightY + "," + S.lightZ + ") amb=" + S.lightAmb;
}

/// frameall — enquadra a câmera pra ver TODA a cena (centro médio + distância pelo
/// espalhamento). Complementa `focus` (1 objeto) e `view` (presets fixos).
export function cmdFrameAll(parts: string[]): string {
  let cx = 0.0; let cy = 0.0; let cz = 0.0; let cnt = 0;
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i];
    if (o.meshKind !== 0 || o.customMesh > 0) {
      cx = cx + o.transform.wx; cy = cy + o.transform.wy; cz = cz + o.transform.wz; cnt = cnt + 1;
    }
    i = i + 1;
  }
  if (cnt === 0) return "[erro] cena vazia";
  cx = cx / cnt; cy = cy / cnt; cz = cz / cnt;
  // raio ~ maior distância de um objeto ao centro
  let rad = 3.0; let j = 0;
  while (j < scene.objects.length) {
    const o = scene.objects[j];
    if (o.meshKind !== 0 || o.customMesh > 0) {
      const dx = o.transform.wx - cx; const dy = o.transform.wy - cy; const dz = o.transform.wz - cz;
      const d = math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > rad) rad = d;
    }
    j = j + 1;
  }
  const dist = rad * 2.2 + 4.0;
  S.camX = cx; S.camY = cy + dist * 0.5; S.camZ = cz - dist;
  S.camYaw = 0.0; S.camPitch = math.atan2(cy - S.camY, dist);
  return "[ok] frameall (centro " + (cx | 0) + "," + (cy | 0) + "," + (cz | 0) + " r" + (rad | 0) + ")";
}

/// view <top|front|side|persp> — posiciona a câmera num preset (olhando a origem).
export function cmdView(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: view <top|front|side|persp>";
  const v = parts[1];
  if (v === "top") {
    S.camX = 0.0; S.camY = 22.0; S.camZ = 0.1; S.camYaw = 0.0; S.camPitch = 0 - 1.55;
  } else if (v === "front") {
    S.camX = 0.0; S.camY = 4.0; S.camZ = 0 - 20.0; S.camYaw = 0.0; S.camPitch = 0 - 0.15;
  } else if (v === "side") {
    S.camX = 0 - 20.0; S.camY = 4.0; S.camZ = 0.0; S.camYaw = 1.5708; S.camPitch = 0 - 0.15;
  } else if (v === "persp") {
    S.camX = 0.0; S.camY = 11.0; S.camZ = 0 - 15.0; S.camYaw = 0.0; S.camPitch = 0 - 0.5;
  } else {
    return "[erro] view invalido: " + v + " (top|front|side|persp)";
  }
  return "[ok] view " + v;
}

/// rename <i> <nome...> — renomeia o objeto (nome = resto da linha).
export function cmdRename(parts: string[]): string {
  if (parts.length < 3) return "[erro] uso: rename <i> <nome>";
  const i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  let nm = parts[2];
  let k = 3;
  while (k < parts.length) { nm = nm + " " + parts[k]; k = k + 1; }
  scene.objects[i].name = nm;
  return "[ok] rename #" + i + " -> " + nm;
}

/// selectclear — volta pra seleção única (esvazia a multi).
export function cmdSelectClear(parts: string[]): string {
  S.selection = [];
  return "[ok] selectclear (seleção única)";
}

/// focus <i> — enquadra a câmera do editor no objeto (Unity "frame selected").
export function cmdFocus(parts: string[]): string {
  const idx = parseFloat(parts[1]) | 0;
  if (idx < 0 || idx >= scene.objects.length) return "[erro] objeto invalido";
  const o = scene.objects[idx];
  const wx: f64 = o.transform.wx; const wy: f64 = o.transform.wy; const wz: f64 = o.transform.wz;
  let sz: f64 = o.transform.sx;
  if (o.transform.sy > sz) sz = o.transform.sy;
  if (o.transform.sz > sz) sz = o.transform.sz;
  const dist: f64 = sz * 2.2 + 3.0;
  S.camX = wx; S.camY = wy + dist * 0.4; S.camZ = wz - dist; S.camYaw = 0.0;
  S.camPitch = math.atan2(wy - S.camY, dist);
  return "[ok] focus #" + idx + " " + o.name;
}

export function cmdDelete(parts: string[]): string {
  const i = parseFloat(parts[1]) | 0;
  // `removeAt` ignora índice fora da faixa, então sem esta checagem o comando
  // reportava "[ok] delete" sem ter apagado nada — falha em silêncio, que é o
  // pior tipo. Apareceu no log: `delete 99999 -> [ok] delete`.
  if (i < 0 || i >= scene.objects.length) {
    return "[erro] indice invalido: " + i + " (a cena tem " + scene.objects.length + " objetos)";
  }
  const nome = scene.objects[i].name;
  scene.removeAt(i);
  if (S.selected >= scene.objects.length) S.selected = scene.objects.length - 1;
  if (S.selected < 0) S.selected = 0;
  return "[ok] delete #" + i + " (" + nome + ")";
}

/// delsel — remove TODOS os objetos da multi-seleção (ou o único selecionado).
/// Remove do MAIOR índice pro menor pra os índices não invalidarem no meio.
export function cmdDelSel(parts: string[]): string {
  const idxs: number[] = [];
  if (S.selection.length > 0) {
    let k = 0; while (k < S.selection.length) { idxs.push(S.selection[k]); k = k + 1; }
  } else if (S.selected >= 0) {
    idxs.push(S.selected);
  }
  if (idxs.length === 0) return "[erro] nada selecionado";
  // sort DESCENDENTE (bubble; lista pequena) pra remover do maior pro menor
  let a = 0;
  while (a < idxs.length) {
    let b = a + 1;
    while (b < idxs.length) {
      if (idxs[b] > idxs[a]) { const t = idxs[a]; idxs[a] = idxs[b]; idxs[b] = t; }
      b = b + 1;
    }
    a = a + 1;
  }
  let removed = 0; let k = 0;
  while (k < idxs.length) {
    const v = idxs[k];
    if (v >= 0 && v < scene.objects.length) { scene.removeAt(v); removed = removed + 1; }
    k = k + 1;
  }
  S.selection = []; S.selected = 0;
  return "[ok] delsel (" + removed + " removidos)";
}

export function cmdCam(parts: string[]): string {
  S.camX = parseFloat(parts[1]); S.camY = parseFloat(parts[2]); S.camZ = parseFloat(parts[3]);
  S.camYaw = parseFloat(parts[4]); S.camPitch = parseFloat(parts[5]);
  return "[ok] cam";
}

export function cmdPlay(): string { S.playing = 1; return "[ok] play"; }
export function cmdPause(): string { S.playing = 0; return "[ok] pause"; }

export function cmdClear(): string {
  scene.clear();
  S.selected = 0;
  return "[ok] clear";
}

export function cmdLoad(parts: string[]): string {
  loadSceneFrom(parts[1]);
  return "[ok] loadscene " + parts[1] + " -> " + scene.objects.length;
}

/// savescene <path> — SALVA a cena atual num arquivo JSON (fecha o loop com loadscene).
export function cmdSaveScene(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: savescene <path>";
  const n = saveScene(parts[1]) | 0;
  return "[ok] savescene " + parts[1] + " <- " + n + " objs";
}

/// dup [i] — duplica o objeto (default = selecionado), deslocado em +1 no X, e
/// seleciona a cópia. (Clone raso: copia transform+aparência; behaviors ainda não.)
export function cmdDup(parts: string[]): string {
  let i = S.selected;
  if (parts.length > 1) i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  const g = cloneObject(scene.objects[i]);   // transform+aparência + scripts de gameplay
  g.transform.px = g.transform.px + 1.0;
  scene.add(g);
  S.selected = scene.objects.length - 1;
  return "[ok] dup #" + i + " -> #" + S.selected + " (" + g.name + ")";
}

/// dupn <count> <espaco> [i] — duplica o objeto em ARRAY: `count` cópias em linha no
/// X, espaçadas por `espaco`. Útil pra montar níveis (cercas, colunas, etc).
export function cmdDupN(parts: string[]): string {
  if (parts.length < 3) return "[erro] uso: dupn <count> <espaco> [i]";
  const count = parseFloat(parts[1]) | 0;
  const gap = parseFloat(parts[2]);
  let i = S.selected;
  if (parts.length > 3) i = parseFloat(parts[3]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  if (count < 1 || count > 200) return "[erro] count fora de 1..200";
  const src = scene.objects[i];
  let k = 0;
  while (k < count) {
    const g = cloneObject(src);
    g.transform.px = g.transform.px + gap * (k + 1);
    scene.add(g);
    k = k + 1;
  }
  S.selected = scene.objects.length - 1;
  return "[ok] dupn " + count + "x (espaço " + gap + ") de #" + i;
}

/// instscene <path> [hostIdx] — CENA DENTRO DE CENA: instancia uma cena inteira
/// sob o objeto hostIdx (default = selecionado). Mover o host move a sub-cena toda.
export function cmdInstScene(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: instscene <path> [hostIdx]";
  let host = S.selected;
  if (parts.length > 2) host = parseFloat(parts[2]) | 0;
  const before = scene.objects.length;
  const n = instantiateSceneUnder(parts[1], host) | 0;
  if (n === 0) return "[erro] falha ao instanciar (arquivo/objetos): " + parts[1];
  return "[ok] instscene " + parts[1] + " -> " + n + " objs sob #" + host + " (cena agora com " + scene.objects.length + ")";
}

/// hier [linha] — inspeciona (e opcionalmente move) o SCROLL da hierarquia.
/// Sem argumento devolve o estado; com um número rola até aquela linha.
///
/// Existe porque não havia como verificar o scroll sem olhar a tela. O estado
/// visível de uma UI imediata tem de ser inspecionável por comando, ou a única
/// validação possível vira screenshot — que rouba o foco do usuário e falha em
/// silêncio quando a janela está coberta.
export function cmdHier(parts: string[]): string {
  const n = scene.objects.length;
  if (parts.length > 1) {
    let want = parseFloat(parts[1]) | 0;
    let maxS = n - S.hierVis;
    if (maxS < 0) maxS = 0;
    if (want < 0) want = 0;
    if (want > maxS) want = maxS;
    S.hierScroll = want;
  }
  let maxS = n - S.hierVis;
  if (maxS < 0) maxS = 0;
  const first = S.hierScroll;
  let last = first + S.hierVis - 1;
  if (last >= n) last = n - 1;
  let m = "[hier] scroll=" + first + "/" + maxS + " visiveis=" + S.hierVis +
          " objs=" + n + " mostrando linhas " + first + ".." + last;
  if (n > 0 && first < n) m = m + " | topo=" + scene.objects[first].name;
  if (n > 0 && last >= 0 && last < n) m = m + " | base=" + scene.objects[last].name;
  return m;
}

/// snd [freq] [dur] [vol] — toca um beep e devolve o estado do mixer.
/// Sem áudio audível do outro lado, é assim que se verifica que o subsistema
/// está vivo: o retorno diz se o dispositivo abriu e quantas vozes estão
/// soando, o que é inspecionável por teste.
export function cmdSnd(parts: string[]): string {
  if (audioReady() === 0) return "[snd] sem dispositivo de audio (o jogo roda mudo)";
  let f: f64 = 440.0;
  let d: f64 = 0.2;
  let v: f64 = 0.3;
  if (parts.length > 1) f = parseFloat(parts[1]);
  if (parts.length > 2) d = parseFloat(parts[2]);
  if (parts.length > 3) v = parseFloat(parts[3]);
  const got = playTone(f, d, v);
  return "[snd] " + (got !== 0 ? "tocando" : "SEM VOZ LIVRE") +
         " freq=" + f + " dur=" + d + " vol=" + v +
         " | vozes ativas=" + activeVoices() + " rate=" + audioRate();
}

/// log [n|nivel|texto] — histórico do log da engine.
///   log            últimas 20
///   log 50         últimas 50
///   log erro       só erros
///   log warn       avisos e erros
///   log textura    só linhas contendo "textura"
///   log clear      esvazia
///
/// Existe porque `io.print` some no stdout assim que a janela do editor abre:
/// não havia como ler o que a engine registrou sem fechar o programa. Com isto
/// dá para investigar com o editor VIVO, que é como o resto da verificação
/// desta engine funciona.
export function cmdLog(parts: string[]): string {
  let n = 20;
  let level = LOG_INFO;
  let filter = "";
  if (parts.length > 1) {
    const a = parts[1];
    if (a === "clear") { logClear(); return "[log] limpo"; }
    if (a === "erro" || a === "error") level = LOG_ERROR;
    else if (a === "warn" || a === "aviso") level = LOG_WARN;
    else if (a === "debug") level = LOG_DEBUG;
    else {
      const num = parseFloat(a);
      if (num === num && num > 0.0) n = num | 0;   // NaN !== NaN: não é número
      else filter = a;
    }
  }
  const errs = logCountAtLeast(LOG_ERROR);
  const warns = logCountAtLeast(LOG_WARN);
  const head = "[resumo] " + logCount() + " mensagens, " + warns + " avisos+, " + errs + " erros | ";
  return head + logTail(n, level, filter);
}

// ── inspeção do SIMULADOR DE LÍQUIDO ────────────────────────────────────────
// O `fluid_demo` registra aqui o seu Fluid; sem isso não havia como inspecionar
// a simulação em execução — a única saída era screenshot, que rouba o foco do
// usuário e mostra qualquer janela que esteja por cima.
let inspFluid: Fluid | null = null;
let inspFirst = 0;
/// Último dt que a demo passou ao `step` — a diferença mais provável entre a
/// simulação que roda na tela e a que roda num teste headless.
let inspDt: f64 = 0.0;
export function setInspectDt(v: f64): void { inspDt = v; }
export function setInspectFluid(f: Fluid, first: number): void {
  inspFluid = f;
  inspFirst = first;
}

/// fluid [n] — estado da simulação de líquido em TEMPO DE EXECUÇÃO.
/// Sem argumento: resumo (extensão, velocidade, densidade, quantas paradas).
/// Com um número: também as N primeiras partículas, uma a uma.
export function cmdFluid(parts: string[]): string {
  const f = inspFluid;
  if (f === null) return "[fluid] nenhum simulador registrado (rode fluid_demo.ts)";
  const n = f.n;
  if (n === 0) return "[fluid] 0 particulas";
  let x0: f64 = 1e9; let x1: f64 = 0.0 - 1e9;
  let y0: f64 = 1e9; let y1: f64 = 0.0 - 1e9;
  let z0: f64 = 1e9; let z1: f64 = 0.0 - 1e9;
  let vsum: f64 = 0.0; let vmax: f64 = 0.0;
  let paradas = 0;
  let fora = 0;
  let k = 0;
  while (k < n) {
    const t = f.trs[k];
    if (t.px < x0) x0 = t.px;
    if (t.px > x1) x1 = t.px;
    if (t.py < y0) y0 = t.py;
    if (t.py > y1) y1 = t.py;
    if (t.pz < z0) z0 = t.pz;
    if (t.pz > z1) z1 = t.pz;
    const v = math.sqrt(f.vx[k]*f.vx[k] + f.vy[k]*f.vy[k] + f.vz[k]*f.vz[k]);
    vsum = vsum + v;
    if (v > vmax) vmax = v;
    if (v === 0.0) paradas = paradas + 1;
    // fora da caixa? (margem de 0.5 para o reposicionamento na borda)
    if (t.px < f.minX - 0.5 || t.px > f.maxX + 0.5 ||
        t.pz < f.minZ - 0.5 || t.pz > f.maxZ + 0.5 || t.py < f.minY - 0.5) fora = fora + 1;
    k = k + 1;
  }
  // localiza o MAIS RAPIDO e a MAIOR PRESSAO — os dois suspeitos de sempre
  let fastI = 0; let fastV: f64 = 0.0;
  let hiPresI = 0; let hiPres: f64 = 0.0;
  k = 0;
  while (k < n) {
    const v = math.sqrt(f.vx[k]*f.vx[k] + f.vy[k]*f.vy[k] + f.vz[k]*f.vz[k]);
    if (v > fastV) { fastV = v; fastI = k; }
    if (f.pres[k] > hiPres) { hiPres = f.pres[k]; hiPresI = k; }
    k = k + 1;
  }
  const ft = f.trs[fastI];
  const pt = f.trs[hiPresI];
  let m = "[fluid] " + n + " particulas dt=" + flR2(inspDt * 1000.0) + "ms" +
          " | RAPIDA #" + fastI + " v=" + flR2(fastV) + " em(" + flR2(ft.px) + "," + flR2(ft.py) + "," + flR2(ft.pz) + ")" +
          " | PRESSAO #" + hiPresI + " p=" + flR2(hiPres) + " dens=" + flR2(f.dens[hiPresI]) +
          " em(" + flR2(pt.px) + "," + flR2(pt.py) + "," + flR2(pt.pz) + ") viz=" + f.nbrCnt[hiPresI] +
          " | X " + flR2(x0) + ".." + flR2(x1) +
          " Y " + flR2(y0) + ".." + flR2(y1) +
          " Z " + flR2(z0) + ".." + flR2(z1) +
          " | camadas=" + flR2((y1 - y0) / 0.62) +
          " | |v| medio=" + flR2(vsum / n) + " max=" + flR2(vmax) +
          " | paradas=" + paradas + "/" + n +
          " | FORA da caixa=" + fora;
  if (parts.length > 1) {
    let q = parseFloat(parts[1]) | 0;
    if (q > n) q = n;
    let i = 0;
    while (i < q) {
      const t = f.trs[i];
      // fy inclui GRAVITY (-22). Se fy > -22, ALGO esta empurrando pra cima.
      m = m + " | #" + i + " pos(" + flR2(t.px) + "," + flR2(t.py) + "," + flR2(t.pz) +
          ") v(" + flR2(f.vx[i]) + "," + flR2(f.vy[i]) + "," + flR2(f.vz[i]) +
          ") dens=" + flR2(f.dens[i]) + " pres=" + flR2(f.pres[i]) +
          " f(" + flR2(f.fx[i]) + "," + flR2(f.fy[i]) + "," + flR2(f.fz[i]) +
          ") viz=" + f.nbrCnt[i];
      i = i + 1;
    }
  }
  return m;
}

/// duas casas decimais (o subset não tem toFixed)
function flR2(v: f64): f64 {
  return math.floor(v * 100.0) / 100.0;
}
