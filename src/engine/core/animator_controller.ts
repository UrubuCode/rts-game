// Engine RTS — controlador do Animator (estilo Mecanim): o arquivo
// `.controller.json` com parâmetros, camadas, estados, transições e mistura 1D.
//
// Dois passos, cada um feito UMA vez:
//   1. `loadAnimatorController(caminho)`: lê e valida o JSON, resolvendo nomes
//      de estado/parâmetro em ÍNDICES (cache por caminho). Não depende do modelo.
//   2. `bindAnimatorController(ctrl, asset)`: resolve os nomes de CLIPE e de
//      OSSO contra um modelo (SkeletonAsset) — índices de clipe, durações e a
//      máscara de cada camada. Cache dentro do controlador, por asset.
// O Animator só lê arrays de números por frame: zero string, zero busca.
//
// Erros (JSON inválido, clipe/estado/parâmetro/osso inexistente) nunca lançam:
// ficam em `error` (texto legível, em português) e o Animator fica inerte.
//
// Formato (chaves em português):
//   { "parametros": [ { "nome", "tipo": "float"|"bool"|"trigger", "padrao"? } ],
//     "camadas": [ { "nome", "inicial", "peso"? (1), "mascara"? [ossos],
//       "estados": [ { "nome", "clipe", "laco"? (true), "velocidade"? (1) }
//                  | { "nome", "mistura": { "param", "clipes": [[clipe, limiar], ...] }, "laco"?, "velocidade"? } ],
//       "transicoes"?: [ { "de": estado|"*", "para", "quando"?: [[param] | [param, op, valor]],
//                          "saida"?: tempoNormalizado, "fade"?: segundos } ] } ] }
// A máscara lista ossos EXPLICITAMENTE (como a Avatar Mask da Unity): filhos
// de um osso da lista não entram sozinhos.
import fs from "@compat/fs.ts";
import type { SkeletonAsset } from "../render/gltf_anim";

export const PARAM_FLOAT: number = 0;
export const PARAM_BOOL: number = 1;
export const PARAM_TRIGGER: number = 2;

export const STATE_CLIP: number = 0;
export const STATE_BLEND: number = 1;

/// Operadores de condição. `COND_TRUE` = forma curta `[param]` (bool/trigger ligado).
export const COND_TRUE: number = 0;
export const COND_EQ: number = 1;
export const COND_NE: number = 2;
export const COND_GT: number = 3;
export const COND_LT: number = 4;
export const COND_GE: number = 5;
export const COND_LE: number = 6;
const COND_OPS: string[] = ["", "==", "!=", ">", "<", ">=", "<="];

/// Transição vinda de qualquer estado ("*").
export const FROM_ANY: number = 0 - 1;
/// Transição sem tempo de saída.
export const NO_EXIT: number = 0 - 1;

/// Controlador já validado. Estados, blocos de mistura, transições e condições
/// ficam em arrays PLANOS (índice global); cada camada guarda o início e a
/// quantidade dos seus. Imutável depois de carregado (compartilhado por todos
/// os Animators com o mesmo caminho).
export class AnimatorController {
  path: string;
  /// "" = válido; senão o motivo, legível.
  error: string;
  paramNames: string[]; paramTypes: number[]; paramDefaults: number[];
  layerNames: string[]; layerWeight: number[]; layerInitial: number[];
  layerMaskNames: string[][];   // [] = sem máscara (todos os ossos)
  layerStateStart: number[]; layerStateCount: number[];
  layerTransStart: number[]; layerTransCount: number[];
  stateNames: string[]; stateKind: number[]; stateClipName: string[];
  stateLoop: number[]; stateSpeed: number[];
  stateBlendParam: number[]; stateBlendStart: number[]; stateBlendCount: number[];
  blendClipName: string[]; blendThreshold: number[];
  transFrom: number[]; transTo: number[]; transExit: number[]; transFade: number[];
  transCondStart: number[]; transCondCount: number[];
  condParam: number[]; condOp: number[]; condValue: number[];
  // ligações a modelos já resolvidas (ver bindAnimatorController)
  bindAssets: SkeletonAsset[];
  bindings: AnimatorBinding[];

  constructor(path: string) {
    this.path = path; this.error = "";
    this.paramNames = []; this.paramTypes = []; this.paramDefaults = [];
    this.layerNames = []; this.layerWeight = []; this.layerInitial = []; this.layerMaskNames = [];
    this.layerStateStart = []; this.layerStateCount = []; this.layerTransStart = []; this.layerTransCount = [];
    this.stateNames = []; this.stateKind = []; this.stateClipName = []; this.stateLoop = []; this.stateSpeed = [];
    this.stateBlendParam = []; this.stateBlendStart = []; this.stateBlendCount = [];
    this.blendClipName = []; this.blendThreshold = [];
    this.transFrom = []; this.transTo = []; this.transExit = []; this.transFade = [];
    this.transCondStart = []; this.transCondCount = [];
    this.condParam = []; this.condOp = []; this.condValue = [];
    this.bindAssets = []; this.bindings = [];
  }
}

/// Controlador resolvido contra UM modelo: clipe e duração de cada estado
/// simples e de cada entrada de mistura, e a máscara (1 byte por osso) de cada
/// camada — camada sem máscara tem todos os ossos ligados.
export class AnimatorBinding {
  asset: SkeletonAsset;
  error: string;
  stateClip: number[]; stateDur: number[];
  blendClip: number[]; blendDur: number[];
  layerMask: Uint8Array[];
  constructor(asset: SkeletonAsset) {
    this.asset = asset; this.error = "";
    this.stateClip = []; this.stateDur = []; this.blendClip = []; this.blendDur = [];
    this.layerMask = [];
  }
}

const CACHE_PATHS: string[] = [];
const CACHE_CTRLS: AnimatorController[] = [];

function cachePut(c: AnimatorController): void {
  const i = CACHE_PATHS.indexOf(c.path);
  if (i >= 0) CACHE_CTRLS[i] = c;
  else { CACHE_PATHS.push(c.path); CACHE_CTRLS.push(c); }
}

/// Controlador do arquivo `path` (lido e validado 1x; depois, do cache). Nunca
/// lança: arquivo ausente/JSON inválido/nome inexistente viram `error`.
export function loadAnimatorController(path: string): AnimatorController {
  const i = CACHE_PATHS.indexOf(path);
  if (i >= 0) return CACHE_CTRLS[i];
  return reloadAnimatorController(path);
}

/// Relê `path` do disco mesmo se já estiver no cache (o autor editou o arquivo).
/// Animators já ligados ao controlador antigo o mantêm até recarregarem.
export function reloadAnimatorController(path: string): AnimatorController {
  let c: AnimatorController;
  if (path === "") { c = new AnimatorController(path); c.error = "nenhum controlador escolhido"; return c; }
  let text = "";
  let lido = false;
  try {
    if (fs.exists(path)) { text = fs.read_text(path); lido = true; }
  } catch (e) { lido = false; }
  if (!lido) { c = new AnimatorController(path); c.error = "controlador nao encontrado: " + path; }
  else c = parseAnimatorController(path, text);
  cachePut(c);
  return c;
}

/// Registra um controlador a partir do TEXTO (testes e ferramentas: nada é
/// escrito em disco). Substitui o que houver no cache com o mesmo caminho.
export function registerAnimatorController(path: string, text: string): AnimatorController {
  const c = parseAnimatorController(path, text);
  cachePut(c);
  return c;
}

/// Lê e valida o texto de um controlador (não usa o cache).
export function parseAnimatorController(path: string, text: string): AnimatorController {
  const c = new AnimatorController(path);
  let data: any = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  if (data === null || data === undefined || typeof data !== "object") {
    c.error = "JSON invalido em " + path;
    return c;
  }
  const err = fillController(c, data);
  if (err !== "") {
    // erro: nada de meio-carregado — o Animator vê um controlador vazio
    const vazio = new AnimatorController(path);
    vazio.error = path + ": " + err;
    return vazio;
  }
  return c;
}

function isStr(v: any): boolean { return typeof v === "string"; }
function isNum(v: any): boolean { return typeof v === "number" && v === v; }
function isArr(v: any): boolean { return v !== undefined && v !== null && typeof v === "object" && typeof v.length === "number"; }

function fillController(c: AnimatorController, data: any): string {
  // parâmetros
  const ps = data.parametros;
  if (ps !== undefined && ps !== null) {
    if (!isArr(ps)) return "'parametros' deve ser uma lista";
    let i = 0;
    while (i < ps.length) {
      const p = ps[i];
      if (p === null || p === undefined || !isStr(p.nome) || p.nome === "") return "parametro " + i + " sem 'nome'";
      if (c.paramNames.indexOf(p.nome) >= 0) return "parametro repetido: " + p.nome;
      let tipo = 0 - 1;
      if (p.tipo === "float") tipo = PARAM_FLOAT;
      else if (p.tipo === "bool") tipo = PARAM_BOOL;
      else if (p.tipo === "trigger") tipo = PARAM_TRIGGER;
      if (tipo < 0) return "parametro '" + p.nome + "': tipo invalido (use float, bool ou trigger)";
      let padrao: number = 0.0;
      if (p.padrao !== undefined && p.padrao !== null) {
        if (tipo === PARAM_FLOAT && isNum(p.padrao)) padrao = p.padrao;
        else if (tipo === PARAM_BOOL && typeof p.padrao === "boolean") padrao = p.padrao ? 1.0 : 0.0;
        else if (tipo === PARAM_TRIGGER) return "parametro '" + p.nome + "': trigger nao tem 'padrao'";
        else return "parametro '" + p.nome + "': 'padrao' incompativel com o tipo";
      }
      c.paramNames.push(p.nome); c.paramTypes.push(tipo); c.paramDefaults.push(padrao);
      i = i + 1;
    }
  }
  // camadas
  const ls = data.camadas;
  if (!isArr(ls) || ls.length === 0) return "precisa de ao menos uma camada em 'camadas'";
  let li = 0;
  while (li < ls.length) {
    const err = fillLayer(c, ls[li], li);
    if (err !== "") return err;
    li = li + 1;
  }
  return "";
}

function fillLayer(c: AnimatorController, l: any, li: number): string {
  if (l === null || l === undefined || !isStr(l.nome) || l.nome === "") return "camada " + li + " sem 'nome'";
  const nome: string = l.nome;
  if (c.layerNames.indexOf(nome) >= 0) return "camada repetida: " + nome;
  let peso: number = 1.0;
  if (l.peso !== undefined && l.peso !== null) {
    if (!isNum(l.peso)) return "camada '" + nome + "': 'peso' deve ser numero";
    peso = Math.max(0.0, Math.min(1.0, l.peso));
  }
  const mask: string[] = [];
  if (l.mascara !== undefined && l.mascara !== null) {
    if (!isArr(l.mascara)) return "camada '" + nome + "': 'mascara' deve ser uma lista de ossos";
    let k = 0;
    while (k < l.mascara.length) {
      if (!isStr(l.mascara[k])) return "camada '" + nome + "': osso da mascara deve ser texto";
      mask.push(l.mascara[k]);
      k = k + 1;
    }
    if (mask.length === 0) return "camada '" + nome + "': 'mascara' vazia (omita para todos os ossos)";
  }
  const es = l.estados;
  if (!isArr(es) || es.length === 0) return "camada '" + nome + "': precisa de ao menos um estado";
  const stateStart = c.stateNames.length;
  let si = 0;
  while (si < es.length) {
    const err = fillState(c, es[si], nome, stateStart);
    if (err !== "") return err;
    si = si + 1;
  }
  const stateCount = c.stateNames.length - stateStart;
  if (!isStr(l.inicial)) return "camada '" + nome + "': falta 'inicial'";
  const inicial = localState(c, stateStart, stateCount, l.inicial);
  if (inicial < 0) return "camada '" + nome + "': estado inicial inexistente: " + l.inicial;
  const transStart = c.transFrom.length;
  const ts = l.transicoes;
  if (ts !== undefined && ts !== null) {
    if (!isArr(ts)) return "camada '" + nome + "': 'transicoes' deve ser uma lista";
    let ti = 0;
    while (ti < ts.length) {
      const err = fillTransition(c, ts[ti], nome, stateStart, stateCount);
      if (err !== "") return err;
      ti = ti + 1;
    }
  }
  c.layerNames.push(nome); c.layerWeight.push(peso); c.layerInitial.push(inicial);
  c.layerMaskNames.push(mask);
  c.layerStateStart.push(stateStart); c.layerStateCount.push(stateCount);
  c.layerTransStart.push(transStart); c.layerTransCount.push(c.transFrom.length - transStart);
  return "";
}

// índice GLOBAL do estado `name` dentro da camada (ou -1)
function localState(c: AnimatorController, start: number, count: number, name: string): number {
  let i = 0;
  while (i < count) { if (c.stateNames[start + i] === name) return start + i; i = i + 1; }
  return 0 - 1;
}

function fillState(c: AnimatorController, e: any, layer: string, stateStart: number): string {
  if (e === null || e === undefined || !isStr(e.nome) || e.nome === "") return "camada '" + layer + "': estado sem 'nome'";
  const nome: string = e.nome;
  if (localState(c, stateStart, c.stateNames.length - stateStart, nome) >= 0) return "camada '" + layer + "': estado repetido: " + nome;
  const onde = "estado '" + layer + "/" + nome + "'";
  let laco = 1;
  if (e.laco !== undefined && e.laco !== null) {
    if (typeof e.laco !== "boolean") return onde + ": 'laco' deve ser true/false";
    laco = e.laco ? 1 : 0;
  }
  let vel: number = 1.0;
  if (e.velocidade !== undefined && e.velocidade !== null) {
    if (!isNum(e.velocidade)) return onde + ": 'velocidade' deve ser numero";
    vel = e.velocidade;
  }
  const temClipe = e.clipe !== undefined && e.clipe !== null;
  const temMistura = e.mistura !== undefined && e.mistura !== null;
  if (temClipe === temMistura) return onde + ": use 'clipe' OU 'mistura'";
  if (temClipe) {
    if (!isStr(e.clipe) || e.clipe === "") return onde + ": 'clipe' deve ser o nome de um clipe";
    c.stateNames.push(nome); c.stateKind.push(STATE_CLIP); c.stateClipName.push(e.clipe);
    c.stateLoop.push(laco); c.stateSpeed.push(vel);
    c.stateBlendParam.push(0 - 1); c.stateBlendStart.push(0); c.stateBlendCount.push(0);
    return "";
  }
  const m = e.mistura;
  if (!isStr(m.param)) return onde + ": 'mistura' precisa de 'param'";
  const pi = c.paramNames.indexOf(m.param);
  if (pi < 0) return onde + ": parametro inexistente na mistura: " + m.param;
  if (c.paramTypes[pi] !== PARAM_FLOAT) return onde + ": o parametro da mistura deve ser float: " + m.param;
  if (!isArr(m.clipes) || m.clipes.length === 0) return onde + ": 'mistura.clipes' precisa de [clipe, limiar] (ao menos 1)";
  const bs = c.blendClipName.length;
  let k = 0;
  while (k < m.clipes.length) {
    const par = m.clipes[k];
    if (!isArr(par) || par.length !== 2 || !isStr(par[0]) || !isNum(par[1])) return onde + ": entrada " + k + " da mistura deve ser [clipe, limiar]";
    if (k > 0 && par[1] <= c.blendThreshold[bs + k - 1]) return onde + ": limiares da mistura devem ser crescentes";
    c.blendClipName.push(par[0]); c.blendThreshold.push(par[1]);
    k = k + 1;
  }
  c.stateNames.push(nome); c.stateKind.push(STATE_BLEND); c.stateClipName.push("");
  c.stateLoop.push(laco); c.stateSpeed.push(vel);
  c.stateBlendParam.push(pi); c.stateBlendStart.push(bs); c.stateBlendCount.push(m.clipes.length);
  return "";
}

function fillTransition(c: AnimatorController, t: any, layer: string, stateStart: number, stateCount: number): string {
  const onde = "camada '" + layer + "', transicao " + c.transFrom.length;
  if (t === null || t === undefined) return onde + ": vazia";
  let de = FROM_ANY;
  if (!isStr(t.de)) return onde + ": falta 'de' (estado ou \"*\")";
  if (t.de !== "*") {
    de = localState(c, stateStart, stateCount, t.de);
    if (de < 0) return onde + ": estado 'de' inexistente: " + t.de;
  }
  if (!isStr(t.para)) return onde + ": falta 'para'";
  const para = localState(c, stateStart, stateCount, t.para);
  if (para < 0) return onde + ": estado 'para' inexistente: " + t.para;
  let saida: number = NO_EXIT;
  if (t.saida !== undefined && t.saida !== null) {
    if (!isNum(t.saida) || t.saida < 0.0) return onde + ": 'saida' deve ser numero >= 0";
    saida = t.saida;
  }
  let fade: number = 0.0;
  if (t.fade !== undefined && t.fade !== null) {
    if (!isNum(t.fade) || t.fade < 0.0) return onde + ": 'fade' deve ser numero >= 0";
    fade = t.fade;
  }
  const cs = c.condParam.length;
  const q = t.quando;
  if (q !== undefined && q !== null) {
    if (!isArr(q)) return onde + ": 'quando' deve ser uma lista de condicoes";
    let k = 0;
    while (k < q.length) {
      const err = fillCondition(c, q[k], onde);
      if (err !== "") return err;
      k = k + 1;
    }
  }
  const cc = c.condParam.length - cs;
  if (cc === 0 && saida === NO_EXIT) return onde + ": precisa de 'quando' ou 'saida'";
  c.transFrom.push(de); c.transTo.push(para); c.transExit.push(saida); c.transFade.push(fade);
  c.transCondStart.push(cs); c.transCondCount.push(cc);
  return "";
}

function fillCondition(c: AnimatorController, cond: any, onde: string): string {
  if (!isArr(cond) || (cond.length !== 1 && cond.length !== 3) || !isStr(cond[0])) return onde + ": condicao deve ser [param] ou [param, op, valor]";
  const pi = c.paramNames.indexOf(cond[0]);
  if (pi < 0) return onde + ": parametro inexistente: " + cond[0];
  const tipo = c.paramTypes[pi];
  if (cond.length === 1) {
    if (tipo === PARAM_FLOAT) return onde + ": [" + cond[0] + "] sozinho so vale para bool/trigger";
    c.condParam.push(pi); c.condOp.push(COND_TRUE); c.condValue.push(1.0);
    return "";
  }
  if (tipo === PARAM_TRIGGER) return onde + ": trigger usa a forma curta [" + cond[0] + "]";
  const op = isStr(cond[1]) ? COND_OPS.indexOf(cond[1]) : 0 - 1;
  if (op <= 0) return onde + ": operador invalido: " + cond[1] + " (use ==, !=, >, <, >=, <=)";
  let v: number = 0.0;
  if (tipo === PARAM_BOOL) {
    if (typeof cond[2] !== "boolean") return onde + ": " + cond[0] + " e bool: compare com true/false";
    if (op !== COND_EQ && op !== COND_NE) return onde + ": bool so aceita == ou !=";
    v = cond[2] ? 1.0 : 0.0;
  } else {
    if (!isNum(cond[2])) return onde + ": " + cond[0] + " e float: compare com um numero";
    v = cond[2];
  }
  c.condParam.push(pi); c.condOp.push(op); c.condValue.push(v);
  return "";
}

/// Liga `c` a um modelo (clipes e ossos por nome -> índice), 1x por par
/// (controlador, asset). Nome inexistente vira `error` na ligação.
export function bindAnimatorController(c: AnimatorController, asset: SkeletonAsset): AnimatorBinding {
  const cached = c.bindAssets.indexOf(asset);
  if (cached >= 0) return c.bindings[cached];
  const b = new AnimatorBinding(asset);
  b.error = fillBinding(c, b, asset);
  c.bindAssets.push(asset); c.bindings.push(b);
  return b;
}

function fillBinding(c: AnimatorController, b: AnimatorBinding, asset: SkeletonAsset): string {
  let s = 0;
  while (s < c.stateNames.length) {
    if (c.stateKind[s] === STATE_CLIP) {
      const ci = asset.clipIndex(c.stateClipName[s]);
      if (ci < 0) return c.path + ": clipe inexistente em " + asset.path + ": " + c.stateClipName[s] + " (estado " + c.stateNames[s] + ")";
      b.stateClip.push(ci); b.stateDur.push(asset.clips[ci].duration);
    } else { b.stateClip.push(0 - 1); b.stateDur.push(0.0); }
    s = s + 1;
  }
  let k = 0;
  while (k < c.blendClipName.length) {
    const ci = asset.clipIndex(c.blendClipName[k]);
    if (ci < 0) return c.path + ": clipe inexistente em " + asset.path + ": " + c.blendClipName[k] + " (mistura)";
    b.blendClip.push(ci); b.blendDur.push(asset.clips[ci].duration);
    k = k + 1;
  }
  const n = asset.boneNames.length;
  let l = 0;
  while (l < c.layerNames.length) {
    const names = c.layerMaskNames[l];
    const mask = new Uint8Array(n);
    if (names.length === 0) { let i = 0; while (i < n) { mask[i] = 1; i = i + 1; } }
    else {
      let i = 0;
      while (i < names.length) {
        const bone = asset.boneNames.indexOf(names[i]);
        if (bone < 0) return c.path + ": osso inexistente em " + asset.path + ": " + names[i] + " (mascara da camada " + c.layerNames[l] + ")";
        mask[bone] = 1;
        i = i + 1;
      }
    }
    b.layerMask.push(mask);
    l = l + 1;
  }
  return "";
}
