// REFERÊNCIA A OBJETO pela porta de controle: caminho na hierarquia (Pai/Filho)
// e filhos diretos. Só funções puras sobre a cena recebida (sem importar a
// sessão), para servir ao despacho, aos comandos e aos pacotes.
//
// Só roda quando um comando chega (nunca por quadro).
import type { Scene } from "@engine/core/scene";

/// Separador do caminho na hierarquia (o mesmo do menu: `Pai/Filho`).
export const SEPARADOR_CAMINHO: string = "/";

/// Caminho do objeto `i` a partir da raiz ("Pai/Filho"). O limite de passos
/// protege de uma hierarquia cíclica (que a cena não deveria ter).
export function caminhoObjeto(sc: Scene, i: number): string {
  if (i < 0 || i >= sc.objects.length) return "";
  let s = sc.objects[i].name;
  let p = sc.objects[i].parent;
  let passos = 0;
  while (p >= 0 && p < sc.objects.length && passos < sc.objects.length) {
    s = sc.objects[p].name + SEPARADOR_CAMINHO + s;
    p = sc.objects[p].parent;
    passos = passos + 1;
  }
  return s;
}

/// Índices dos filhos diretos do objeto `i`.
export function filhosObjeto(sc: Scene, i: number): number[] {
  const out: number[] = [];
  let k = 0;
  while (k < sc.objects.length) { if (sc.objects[k].parent === i) out.push(k); k = k + 1; }
  return out;
}

/// Resultado de `resolverObjeto` quando nenhum objeto tem esse nome/caminho.
export const REF_NAO_ACHOU: number = 0 - 1;
/// Resultado de `resolverObjeto` quando mais de um objeto casa.
export const REF_AMBIGUO: number = 0 - 2;
const ASPAS: number = 34;     // '"'
const CERQUILHA: number = 35; // '#'
const MENOS: number = 45;     // '-'

/// "3", "-1" ou "#3": um ÍNDICE (não um nome).
export function ehIndice(tok: string): boolean {
  let i = 0;
  if (tok.length > 0 && (tok.charCodeAt(0) === CERQUILHA || tok.charCodeAt(0) === MENOS)) i = 1;
  if (i >= tok.length) return false;
  while (i < tok.length) { const c = tok.charCodeAt(i); if (c < 48 || c > 57) return false; i = i + 1; }
  return true;
}

/// Objetos cujo NOME é exatamente `tok`; sem nenhum, os cujo CAMINHO é `tok`.
export function candidatosObjeto(sc: Scene, tok: string): number[] {
  const out: number[] = [];
  let k = 0;
  while (k < sc.objects.length) { if (sc.objects[k].name === tok) out.push(k); k = k + 1; }
  if (out.length > 0 || tok.indexOf(SEPARADOR_CAMINHO) < 0) return out;
  k = 0;
  while (k < sc.objects.length) { if (caminhoObjeto(sc, k) === tok) out.push(k); k = k + 1; }
  return out;
}

/// Índice do objeto por nome exato ou caminho Pai/Filho: >= 0, REF_NAO_ACHOU
/// ou REF_AMBIGUO. Não interpreta índices (ver `ehIndice`).
export function resolverNome(sc: Scene, tok: string): number {
  const c = candidatosObjeto(sc, tok);
  if (c.length === 0) return REF_NAO_ACHOU;
  if (c.length > 1) return REF_AMBIGUO;
  return c[0];
}

/// Índice ("3"/"#3"), nome ou caminho -> índice na cena, ou -1 (não achou,
/// ambíguo ou índice fora da cena).
export function resolverObjeto(sc: Scene, tok: string): number {
  if (ehIndice(tok)) {
    const v = tok.charCodeAt(0) === CERQUILHA ? Number(tok.slice(1)) : Number(tok);
    return v >= 0 && v < sc.objects.length ? v : REF_NAO_ACHOU;
  }
  const i = resolverNome(sc, tok);
  return i >= 0 ? i : REF_NAO_ACHOU;
}

/// Mensagem legível para um nome/caminho que não resolveu.
export function erroReferencia(sc: Scene, tok: string): string {
  const c = candidatosObjeto(sc, tok);
  if (c.length === 0) return "[erro] objeto nao encontrado: '" + tok + "' (use o indice, o nome exato ou o caminho Pai/Filho; procure com find " + tok + ")";
  let s = "[erro] nome ambiguo: '" + tok + "' casa " + c.length + " objetos:";
  let k = 0;
  while (k < c.length) { s = s + (k > 0 ? "," : "") + " #" + c[k] + " " + caminhoObjeto(sc, c[k]); k = k + 1; }
  return s + " (use o indice ou o caminho)";
}

function contaAspas(t: string): number {
  let n = 0; let i = 0;
  while (i < t.length) { if (t.charCodeAt(i) === ASPAS) n = n + 1; i = i + 1; }
  return n;
}
function semAspas(t: string): string { return t.split("\"").join(""); }

/// Troca, em `parts`, cada argumento de objeto (posições `posicoes`) pelo
/// índice. Aspas juntam tokens ("Caixa Vermelha", Pai/"Meu Filho") e forçam
/// nome; sem aspas, "3"/"#3"/"-1" são índices (o comando valida a faixa).
/// Devolve "" ou a mensagem [erro].
export function resolverArgsObjeto(sc: Scene, parts: string[], posicoes: number[]): string {
  let k = 0;
  while (k < posicoes.length) {
    const p = posicoes[k];
    k = k + 1;
    if (p >= parts.length) continue;
    let tok = parts[p];
    let citado = false;
    if (contaAspas(tok) % 2 === 1) {
      let j = p + 1;
      let junto = tok;
      while (j < parts.length && contaAspas(junto) % 2 === 1) { junto = junto + " " + parts[j]; j = j + 1; }
      if (contaAspas(junto) % 2 === 1) return "[erro] aspas sem fechar no argumento " + p + ": " + junto;
      parts.splice(p + 1, j - p - 1);
      tok = junto;
    }
    if (contaAspas(tok) > 0) { citado = true; tok = semAspas(tok); }
    if (!citado && ehIndice(tok)) {
      if (tok.charCodeAt(0) === CERQUILHA) parts[p] = tok.slice(1);
      continue;
    }
    const i = resolverNome(sc, tok);
    if (i < 0) return erroReferencia(sc, tok);
    parts[p] = "" + i;
  }
  return "";
}

/// Objetos cujo nome contém `termo` (sem diferenciar maiúsculas).
export function buscarObjetos(sc: Scene, termo: string): number[] {
  const out: number[] = [];
  const t = termo.toLowerCase();
  let k = 0;
  while (k < sc.objects.length) { if (sc.objects[k].name.toLowerCase().indexOf(t) >= 0) out.push(k); k = k + 1; }
  return out;
}
