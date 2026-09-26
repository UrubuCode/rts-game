// Comandos de CONTROLE de componentes (via WebSocket) — a LLM lista/adiciona/
// remove componentes e edita os campos de config, igual ao inspector faz.
import { scene } from "../session";
import { COMPONENT_NAMES, createComponent } from "@editor/components";
import { argInt, argObj, erroObj, numeroEstrito } from "@editor/control/args";
import { tipoCampo, textoCampo, definirCampo, validarCampo, TIPO_STRING, TIPO_NUMBER, TIPO_ENUM, TIPO_VECTOR } from "@editor/control/fields";
import { graus } from "@editor/control/commands/describe";
import { DEG2RAD } from "@editor/bone_gizmo";
import { history } from "@editor/undo";
import type { Behavior } from "@engine/core/behavior";
import { erroUso } from "@editor/control/builtin_commands";

/// comps <objIdx> — lista os componentes do objeto + campos e valores.
export function cmdComps(parts: string[]): string {
  const oi = argObj(parts, 1);
  if (oi < 0) return parts.length < 2 ? erroUso("comps") : erroObj(parts, 1);
  const o = scene.objects[oi];
  let m = "[comps] #" + oi + " " + o.name + " (" + o.behaviors.length + ")";
  let bc = 0;
  while (bc < o.behaviors.length) {
    m = m + " | [" + bc + "] " + o.behaviors[bc].typeName();
    let fi = 0;
    while (fi < o.behaviors[bc].fieldCount()) {
      const component = o.behaviors[bc];
      const value = component.fieldType(fi) === "string" ? component.fieldStringGet(fi) : "" + component.fieldGet(fi);
      m = m + " " + component.fieldLabel(fi) + "=" + value;
      fi = fi + 1;
    }
    bc = bc + 1;
  }
  return m;
}

/// complist — nomes dos componentes que dá pra adicionar.
export function cmdCompList(): string {
  let m = "[componentes]";
  let i = 0;
  while (i < COMPONENT_NAMES.length) { m = m + " " + COMPONENT_NAMES[i]; i = i + 1; }
  return m;
}

/// addcomp <objIdx> <nome> — anexa um componente ao objeto.
export function cmdAddComp(parts: string[]): string {
  if (parts.length < 3) return erroUso("addcomp");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  if (COMPONENT_NAMES.indexOf(parts[2]) < 0) return "[erro] componente nao registrado: " + parts[2] + " (veja complist)";
  const o = scene.objects[oi];
  const component = createComponent(parts[2]);
  o.addBehavior(component); component.mount();
  // Um corpo com Rigidbody NÃO é estático: `spawn` marca `stationary = 1` (para
  // a posição pedida grudar), mas a colisão pula estáticos — o objeto caía
  // atravessando o chão porque nunca era testado. Anexar física desfaz a marca.
  if (component.bodyIntegrates() !== 0) {
    o.stationary = 0;
    o.refreshCollide();
    // o corpo muda de LISTA na colisão (estáticos vivem fora do grid): sem
    // recoletar, ele continuaria na lista de estáticos e cairia pelo chão
    scene.markStaticDirty();
  }
  scene.markCollidersDirty();
  return "[ok] addcomp " + parts[2] + " -> #" + oi;
}

/// rmcomp <objIdx> <compIdx> — remove o componente.
export function cmdRmComp(parts: string[]): string {
  if (parts.length < 3) return erroUso("rmcomp");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  const ci = argInt(parts, 2);
  if (!(ci >= 0 && ci < scene.objects[oi].behaviors.length)) return "[erro] componente invalido: '" + parts[2] + "' (#" + oi + " tem " + scene.objects[oi].behaviors.length + ")";
  scene.objects[oi].removeBehavior(ci);
  scene.markCollidersDirty();
  return "[ok] rmcomp #" + oi + "[" + ci + "]";
}

// ── setfield / getfield por NOME ────────────────────────────────────────────

/// Pseudo-componente do Transform (não é um Behavior): campos vetoriais.
const TRANSFORM: string = "transform";
/// Campos do Transform aceitos (nome do Inspector e apelido curto).
const TRANSFORM_CAMPOS: string[] = ["position", "rotation", "scale"];
const TRANSFORM_APELIDOS: string[] = ["pos", "rot", "scl"];
/// Motivo do último "não achou" de `acharComponente`/`acharCampo`.
const motivo: string[] = [""];

/// Componente `tok` (índice ou nome do tipo) do objeto; -1 com `motivo`.
function acharComponente(oi: number, tok: string): number {
  const o = scene.objects[oi];
  const n = argInt([tok], 0);
  if (n === n) {
    if (n >= 0 && n < o.behaviors.length) return n;
    motivo[0] = "componente invalido: " + tok + " (#" + oi + " tem " + o.behaviors.length + ")";
    return 0 - 1;
  }
  let achado = 0 - 1; let quantos = 0; let lista = ""; let iguais = "";
  let k = 0;
  while (k < o.behaviors.length) {
    const nome = o.behaviors[k].typeName();
    lista = lista + (k > 0 ? ", " : "") + "[" + k + "] " + nome;
    if (nome.toLowerCase() === tok.toLowerCase()) { achado = k; quantos = quantos + 1; iguais = iguais + " [" + k + "]"; }
    k = k + 1;
  }
  if (quantos === 1) return achado;
  if (quantos > 1) motivo[0] = "componente ambiguo: #" + oi + " tem " + quantos + " " + tok + ":" + iguais + " (use o indice)";
  else motivo[0] = "#" + oi + " nao tem " + tok + " (tem: " + (lista.length > 0 ? lista : "nenhum") + "; e o Transform)";
  return 0 - 1;
}

/// Campo `tok` (índice, nome na classe ou rótulo) do componente; -1 com `motivo`.
function acharCampo(b: Behavior, tok: string): number {
  const n = argInt([tok], 0);
  if (n === n) {
    if (n >= 0 && n < b.fieldCount()) return n;
    motivo[0] = "campo invalido: " + tok + " (" + b.typeName() + " tem " + b.fieldCount() + ")";
    return 0 - 1;
  }
  let semCaixa = 0 - 1; let lista = "";
  let k = 0;
  while (k < b.fieldCount()) {
    if (b.fieldName(k) === tok) return k;
    if (b.fieldLabel(k).toLowerCase() === tok.toLowerCase() || b.fieldName(k).toLowerCase() === tok.toLowerCase()) semCaixa = k;
    lista = lista + (k > 0 ? ", " : "") + k + " " + b.fieldName(k) + ":" + tipoCampo(b, k);
    k = k + 1;
  }
  if (semCaixa >= 0) return semCaixa;
  motivo[0] = b.typeName() + " nao tem o campo " + tok + " (campos: " + (lista.length > 0 ? lista : "nenhum") + ")";
  return 0 - 1;
}

/// Índice do campo do Transform (0 posição, 1 rotação, 2 escala) ou -1.
function campoTransform(tok: string): number {
  const t = tok.toLowerCase();
  const i = TRANSFORM_CAMPOS.indexOf(t);
  return i >= 0 ? i : TRANSFORM_APELIDOS.indexOf(t);
}

/// Vetor do Transform em texto "x,y,z" (rotação em graus, ordem do Inspector).
function vetorTransform(oi: number, ci: number): string {
  const t = scene.objects[oi].transform;
  if (ci === 0) return t.px + "," + t.py + "," + t.pz;
  if (ci === 1) return graus(t.rx) + "," + graus(t.ry) + "," + graus(t.rz);
  return t.sx + "," + t.sy + "," + t.sz;
}

const VETOR: Float64Array = new Float64Array(3);
/// "1,2,3" ou "1 2 3" -> 3 números em VETOR; false se não forem 3 números.
function lerVetor(texto: string): boolean {
  const partes = texto.indexOf(",") >= 0 ? texto.split(",") : texto.split(" ");
  let n = 0; let k = 0;
  while (k < partes.length) {
    const p = partes[k].trim();
    if (p.length > 0) {
      if (n >= 3) return false;
      const v = numeroEstrito(p);
      if (v !== v) return false;
      VETOR[n] = v; n = n + 1;
    }
    k = k + 1;
  }
  return n === 3;
}

function setTransform(oi: number, campo: string, texto: string): string {
  const ci = campoTransform(campo);
  if (ci < 0) return "[erro] Transform nao tem o campo " + campo + " (campos: position, rotation, scale)";
  if (!lerVetor(texto)) return "[erro] Transform." + TRANSFORM_CAMPOS[ci] + " e vector: use x,y,z (recebi '" + texto + "')";
  const t = scene.objects[oi].transform;
  history.snapshot();
  if (ci === 0) { t.px = VETOR[0]; t.py = VETOR[1]; t.pz = VETOR[2]; }
  else if (ci === 1) { t.rx = VETOR[0] * DEG2RAD; t.ry = VETOR[1] * DEG2RAD; t.rz = VETOR[2] * DEG2RAD; }
  else { t.sx = VETOR[0]; t.sy = VETOR[1]; t.sz = VETOR[2]; scene.markStaticDirty(); }
  scene.markCollidersDirty();
  return "[ok] setfield #" + oi + " Transform." + TRANSFORM_CAMPOS[ci] + " = " + vetorTransform(oi, ci);
}

/// O componente mudou o número pedido (limite do @range, onValidate)?
function foiAjustado(b: Behavior, fi: number, texto: string): boolean {
  const pedido = numeroEstrito(texto);
  if (b.fieldType(fi) !== TIPO_NUMBER || tipoCampo(b, fi) !== TIPO_NUMBER || pedido !== pedido) return false;
  return Math.abs(b.fieldGet(fi) - pedido) > TOLERANCIA_AJUSTE * Math.max(1.0, Math.abs(pedido));
}
/// Diferença relativa abaixo da qual o número gravado é o pedido (conversões
/// de unidade, como o FOV em graus, arredondam).
const TOLERANCIA_AJUSTE: f64 = 1e-9;

/// setfield <obj> <comp|Nome> <campo|nome> <valor> — edita um campo como o
/// Inspector (fieldSet/fieldStringSet, que rodam onValidate e os limites). O
/// valor é o resto da linha. O snapshot de Desfazer é tirado aqui, depois de
/// validar tudo e antes de gravar.
export function cmdSetField(parts: string[]): string {
  if (parts.length < 5) return erroUso("setfield");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  const texto = parts.slice(4).join(" ");
  if (parts[2].toLowerCase() === TRANSFORM) return setTransform(oi, parts[3], texto);
  const ci = acharComponente(oi, parts[2]);
  if (ci < 0) return "[erro] " + motivo[0];
  const b = scene.objects[oi].behaviors[ci];
  const fi = acharCampo(b, parts[3]);
  if (fi < 0) return "[erro] " + motivo[0];
  const problema = validarCampo(b, fi, texto);
  if (problema.length > 0) return "[erro] " + problema;
  history.snapshot();
  definirCampo(b, fi, texto);
  if (b.fieldType(fi) !== TIPO_STRING) scene.markCollidersDirty();
  return "[ok] setfield #" + oi + "[" + ci + "] " + b.typeName() + "." + b.fieldName(fi) + " = " + textoCampo(b, fi) +
    (foiAjustado(b, fi, texto) ? " (pedido " + texto + ", ajustado pelo componente)" : "");
}

/// getfield <obj> <comp|Nome> <campo|nome> — valor e tipo do campo.
export function cmdGetField(parts: string[]): string {
  if (parts.length < 4) return erroUso("getfield");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  if (parts[2].toLowerCase() === TRANSFORM) {
    const tci = campoTransform(parts[3]);
    if (tci < 0) return "[erro] Transform nao tem o campo " + parts[3] + " (campos: position, rotation, scale)";
    return "[getfield] #" + oi + " Transform." + TRANSFORM_CAMPOS[tci] + " " + TIPO_VECTOR + " = " + vetorTransform(oi, tci) +
      (tci === 1 ? " (graus X,Y,Z do Inspector)" : "");
  }
  const ci = acharComponente(oi, parts[2]);
  if (ci < 0) return "[erro] " + motivo[0];
  const b = scene.objects[oi].behaviors[ci];
  const fi = acharCampo(b, parts[3]);
  if (fi < 0) return "[erro] " + motivo[0];
  const tipo = tipoCampo(b, fi);
  return "[getfield] #" + oi + "[" + ci + "] " + b.typeName() + "." + b.fieldName(fi) + " " + tipo + " = " + textoCampo(b, fi) +
    (tipo === TIPO_ENUM ? " (opcoes: " + b.fieldOptions(fi).join("|") + ")" : "");
}
