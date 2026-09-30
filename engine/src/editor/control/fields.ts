// CAMPOS DE COMPONENTE pela porta de controle: tipo visto pelo agente
// (number, boolean, string, color, enum), leitura em texto/JSON e escrita a
// partir do texto do comando. A escrita passa por fieldSet/fieldStringSet —
// os mesmos do Inspector, que rodam onValidate e os limites do componente.
//
// Só roda quando um comando chega (nunca por quadro).
import { Behavior, FIELD_HINT_COLOR, FIELD_HINT_ENUM } from "@engine/core/behavior";
import { numeroEstrito } from "@editor/control/args";

/// Tipos que o agente vê (os do gerador + as dicas do componente).
export const TIPO_NUMBER: string = "number";
export const TIPO_BOOLEAN: string = "boolean";
export const TIPO_STRING: string = "string";
export const TIPO_COLOR: string = FIELD_HINT_COLOR;
export const TIPO_ENUM: string = FIELD_HINT_ENUM;
export const TIPO_VECTOR: string = "vector";

const COR_MAXIMA: number = 0xFFFFFF;
const DIGITOS_COR: number = 6;
const CERQUILHA: number = 35;   // '#'
const HEX: string = "0123456789abcdef";

/// Tipo do campo `fi` como o agente vê.
export function tipoCampo(b: Behavior, fi: number): string {
  const dica = b.fieldHint(fi);
  if (dica.length > 0) return dica;
  return b.fieldType(fi);
}

/// 0xRRGGBB -> "#RRGGBB".
export function hexCor(v: number): string {
  let n = Math.max(0, Math.min(COR_MAXIMA, Math.floor(v)));
  let s = "";
  let k = 0;
  while (k < DIGITOS_COR) { s = HEX.charAt(n % 16) + s; n = Math.floor(n / 16); k = k + 1; }
  return "#" + s.toUpperCase();
}

/// "#RRGGBB" (ou "RRGGBB") -> 0xRRGGBB; -1 se não for uma cor.
export function lerCor(t: string): number {
  const s = t.length > 0 && t.charCodeAt(0) === CERQUILHA ? t.slice(1).toLowerCase() : t.toLowerCase();
  if (s.length !== DIGITOS_COR) return 0 - 1;
  let v = 0;
  let k = 0;
  while (k < s.length) {
    const d = HEX.indexOf(s.charAt(k));
    if (d < 0) return 0 - 1;
    v = v * 16 + d;
    k = k + 1;
  }
  return v;
}

/// Valor do campo para o JSON (cor em "#RRGGBB").
export function valorCampoJson(b: Behavior, fi: number): any {
  const tipo = tipoCampo(b, fi);
  if (tipo === TIPO_STRING || tipo === TIPO_ENUM) return b.fieldStringGet(fi);
  if (tipo === TIPO_BOOLEAN) return b.fieldGet(fi) !== 0;
  if (tipo === TIPO_COLOR) return hexCor(b.fieldGet(fi));
  return b.fieldGet(fi);
}

/// Valor do campo em texto (texto entre aspas; cor em #RRGGBB).
export function textoCampo(b: Behavior, fi: number): string {
  const v = valorCampoJson(b, fi);
  return b.fieldType(fi) === TIPO_STRING && tipoCampo(b, fi) === TIPO_STRING ? JSON.stringify(v) : "" + v;
}

/// Tira as aspas de fora ("texto com espaço" -> texto com espaço).
export function semAspasExternas(t: string): string {
  if (t.length >= 2 && t.charCodeAt(0) === 34 && t.charCodeAt(t.length - 1) === 34) return t.slice(1, t.length - 1);
  return t;
}

/// Valor interpretado pelo último `interpretar` (número ou texto).
const LIDO_NUM: Float64Array = new Float64Array(1);
const LIDO_TEXTO: string[] = [""];

/// Interpreta `texto` para o campo `fi` conforme o tipo, SEM gravar. Devolve ""
/// (valor em LIDO_NUM/LIDO_TEXTO) ou o motivo do erro, sem prefixo.
function interpretar(b: Behavior, fi: number, texto: string): string {
  const tipo = tipoCampo(b, fi);
  const nome = b.typeName() + "." + b.fieldName(fi);
  if (tipo === TIPO_BOOLEAN) {
    if (texto === "true" || texto === "1") LIDO_NUM[0] = 1;
    else if (texto === "false" || texto === "0") LIDO_NUM[0] = 0;
    else return nome + " e boolean: use true ou false (recebi '" + texto + "')";
    return "";
  }
  if (tipo === TIPO_COLOR) {
    let v = lerCor(texto);
    if (v < 0) { const n = numeroEstrito(texto); if (n === Math.floor(n) && n >= 0 && n <= COR_MAXIMA) v = n; }
    if (v < 0) return nome + " e color: use #RRGGBB (recebi '" + texto + "')";
    LIDO_NUM[0] = v;
    return "";
  }
  if (tipo === TIPO_ENUM) {
    const opcoes = b.fieldOptions(fi);
    let achou = 0 - 1;
    let k = 0;
    while (k < opcoes.length) { if (opcoes[k].toLowerCase() === texto.toLowerCase()) achou = k; k = k + 1; }
    if (achou < 0) return nome + " e enum: use " + opcoes.join(" | ") + " (recebi '" + texto + "')";
    LIDO_TEXTO[0] = opcoes[achou];
    return "";
  }
  if (tipo === TIPO_STRING) { LIDO_TEXTO[0] = semAspasExternas(texto); return ""; }
  const n = numeroEstrito(texto);
  if (n !== n) return nome + " e number: use um numero (recebi '" + texto + "')";
  LIDO_NUM[0] = n;
  return "";
}

/// Grava `texto` no campo `fi` pelo fieldSet/fieldStringSet do componente (o
/// caminho do Inspector: onValidate e limites). Devolve "" ou o motivo do erro.
export function definirCampo(b: Behavior, fi: number, texto: string): string {
  const problema = interpretar(b, fi, texto);
  if (problema.length > 0) return problema;
  if (b.fieldType(fi) === TIPO_STRING) b.fieldStringSet(fi, LIDO_TEXTO[0]);
  else b.fieldSet(fi, LIDO_NUM[0]);
  return "";
}
