// REGISTRO DE FALHAS para diagnóstico: a última exceção capturada (com a
// pilha, quando o runtime a dá) e os assets que não carregaram. O log guarda a
// mensagem; aqui fica o que o log não tem — a pilha e a lista estruturada —
// para `errors` e `assets errors` da porta de controle.
//
// Só é escrito nos caminhos de falha (um `catch`, um carregamento que falhou),
// nunca por quadro.

/// Quantos assets com falha são lembrados (os mais antigos saem).
export const FALHAS_ASSET_MAX: number = 64;

export class ExcecaoRegistrada {
  origem: string = "";
  mensagem: string = "";
  pilha: string = "";
  quandoMs: number = 0;
}

let ultima: ExcecaoRegistrada | null = null;
let totalExcecoes = 0;

/// Guarda a exceção `erro` capturada em `origem` ("simulacao", "comando move"...).
export function registrarExcecao(origem: string, erro: any): void {
  const e = new ExcecaoRegistrada();
  e.origem = origem;
  e.mensagem = erro instanceof Error ? erro.message : String(erro);
  const pilha = erro !== null && erro !== undefined ? erro.stack : undefined;
  e.pilha = typeof pilha === "string" ? pilha : "";
  e.quandoMs = Date.now();
  ultima = e;
  totalExcecoes = totalExcecoes + 1;
}
export function ultimaExcecao(): ExcecaoRegistrada | null { return ultima; }
export function totalDeExcecoes(): number { return totalExcecoes; }

export class FalhaAsset {
  tipo: string = "";      // "textura", "modelo", "ceu", "esqueleto"
  caminho: string = "";
  motivo: string = "";
  vezes: number = 0;
  quandoMs: number = 0;
}
const falhasAsset: FalhaAsset[] = [];

/// Um asset não carregou. O mesmo tipo+caminho soma em `vezes`.
export function registrarFalhaAsset(tipo: string, caminho: string, motivo: string): void {
  let i = 0;
  while (i < falhasAsset.length) {
    const f = falhasAsset[i];
    if (f.tipo === tipo && f.caminho === caminho) { f.motivo = motivo; f.vezes = f.vezes + 1; f.quandoMs = Date.now(); return; }
    i = i + 1;
  }
  const f = new FalhaAsset();
  f.tipo = tipo; f.caminho = caminho; f.motivo = motivo; f.vezes = 1; f.quandoMs = Date.now();
  falhasAsset.push(f);
  while (falhasAsset.length > FALHAS_ASSET_MAX) falhasAsset.shift();
}
export function falhasDeAsset(): FalhaAsset[] { return falhasAsset; }
export function limparFalhas(): void { falhasAsset.length = 0; ultima = null; totalExcecoes = 0; }
