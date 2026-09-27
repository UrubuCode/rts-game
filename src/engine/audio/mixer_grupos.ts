// Grupos do mixer (spec §3.7): árvore com nome livre, cada grupo com volume,
// mudo e pausa. Arquivo de PROJETO (`assets/audio/mixer.json`), como o asset
// da Unity: vale para todas as cenas e não entra no Desfazer da cena.
//
// O ganho efetivo é calculado uma vez por MUDANÇA (contador de versão), não
// por voz: `ganhoGrupo(i)` lê uma tabela recalculada só quando a versão muda.
import fs from "@compat/fs.ts";

export const MAX_GRUPOS: number = 16;
export const GRUPO_MASTER: number = 0;
export const MIXER_ARQUIVO: string = "assets/audio/mixer.json";
export const GRUPOS_PADRAO: string[] = ["Master", "Música", "Efeitos", "Voz"];

const grpNomes: string[] = [];
const grpPai: number[] = [];
const grpVolume = new Float64Array(MAX_GRUPOS);
const grpMudo = new Float64Array(MAX_GRUPOS);
const grpPausa = new Float64Array(MAX_GRUPOS);
const grpEfetivo = new Float64Array(MAX_GRUPOS);
const grpPausaEf = new Float64Array(MAX_GRUPOS);
let grpVersao: number = 1;
let grpCalculada: number = 0;
let grpSalva: number = 1;

/// Os quatro grupos padrão (Master + Música/Efeitos/Voz sob ele), tudo a 1,0.
export function mixerPadrao(): void {
  grpNomes.length = 0; grpPai.length = 0;
  let i = 0;
  while (i < GRUPOS_PADRAO.length) {
    grpNomes.push(GRUPOS_PADRAO[i]); grpPai.push(i === 0 ? 0 - 1 : GRUPO_MASTER);
    grpVolume[i] = 1.0; grpMudo[i] = 0.0; grpPausa[i] = 0.0;
    i = i + 1;
  }
  grpVersao = grpVersao + 1; grpSalva = grpVersao;
}
mixerPadrao();

export function mixerNGrupos(): number { return grpNomes.length; }
export function grupoNome(i: number): string { return i >= 0 && i < grpNomes.length ? grpNomes[i] : ""; }
export function grupoPai(i: number): number { return i >= 0 && i < grpPai.length ? grpPai[i] : 0 - 1; }
export function grupoIndex(nome: string): number { return grpNomes.indexOf(nome); }
export function grupoVolume(i: number): f64 { return i >= 0 && i < grpNomes.length ? grpVolume[i] : 0.0; }
export function grupoMudo(i: number): number { return i >= 0 && i < grpNomes.length && grpMudo[i] !== 0.0 ? 1 : 0; }
export function grupoPausa(i: number): number { return i >= 0 && i < grpNomes.length && grpPausa[i] !== 0.0 ? 1 : 0; }
export function mixerVersao(): number { return grpVersao; }
export function mixerAlterado(): number { return grpVersao !== grpSalva ? 1 : 0; }

function grpValido(i: number): boolean { return i >= 0 && i < grpNomes.length; }
export function mixerSetVolume(i: number, v: f64): void {
  // NaN/±Infinity: mantém o valor anterior — `v < 0`/`v > 1` são ambos falsos
  // com NaN, então sem esta checagem NaN passava direto pro ganho da voz.
  if (!grpValido(i) || !Number.isFinite(v)) return;
  grpVolume[i] = v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
  grpVersao = grpVersao + 1;
}
export function mixerSetMudo(i: number, m: number): void { if (grpValido(i)) { grpMudo[i] = m !== 0 ? 1.0 : 0.0; grpVersao = grpVersao + 1; } }
export function mixerSetPausa(i: number, p: number): void { if (grpValido(i)) { grpPausa[i] = p !== 0 ? 1.0 : 0.0; grpVersao = grpVersao + 1; } }

/// Recalcula a tabela efetiva. Os pais vêm sempre antes dos filhos na lista
/// (validado na carga), então uma passada só já resolve a cadeia toda.
function grpRecalcular(): void {
  let i = 0;
  while (i < grpNomes.length) {
    const pai = grpPai[i];
    const proprio: f64 = grpMudo[i] !== 0.0 ? 0.0 : grpVolume[i];
    grpEfetivo[i] = pai >= 0 ? proprio * grpEfetivo[pai] : proprio;
    grpPausaEf[i] = grpPausa[i] !== 0.0 || (pai >= 0 && grpPausaEf[pai] !== 0.0) ? 1.0 : 0.0;
    i = i + 1;
  }
  grpCalculada = grpVersao;
}
/// Ganho efetivo da cadeia (produto até a raiz; 0 com um mudo em qualquer elo).
export function ganhoGrupo(i: number): f64 {
  if (grpCalculada !== grpVersao) grpRecalcular();
  return i >= 0 && i < grpNomes.length ? grpEfetivo[i] : grpEfetivo[GRUPO_MASTER];
}
/// 1 se `i` ou algum ancestral estiver em pausa.
export function grupoPausado(i: number): number {
  if (grpCalculada !== grpVersao) grpRecalcular();
  return i >= 0 && i < grpNomes.length && grpPausaEf[i] !== 0.0 ? 1 : 0;
}

export function mixerParaJson(): string {
  let s = "{\n  \"grupos\": [\n";
  let i = 0;
  while (i < grpNomes.length) {
    s = s + "    { \"nome\": " + JSON.stringify(grpNomes[i]) + ", \"pai\": " + JSON.stringify(grpPai[i] >= 0 ? grpNomes[grpPai[i]] : "") +
        ", \"volume\": " + grpVolume[i] + ", \"mudo\": " + (grpMudo[i] !== 0.0 ? "true" : "false") +
        ", \"pausa\": " + (grpPausa[i] !== 0.0 ? "true" : "false") + " }" + (i + 1 < grpNomes.length ? "," : "") + "\n";
    i = i + 1;
  }
  return s + "  ]\n}\n";
}

function isArr(v: any): boolean { return v !== undefined && v !== null && typeof v === "object" && typeof v.length === "number"; }

/// Valida TUDO antes de trocar: um JSON recusado deixa o mixer como estava.
export function mixerDeJson(texto: string): string {
  let dados: any = null;
  try { dados = JSON.parse(texto); } catch (e) { return "mixer.json: JSON inválido (" + (e as Error).message + ")"; }
  if (dados === null || dados === undefined || typeof dados !== "object") return "mixer.json: JSON inválido (raiz não é um objeto)";
  if (dados.grupos === undefined || dados.grupos === null || !isArr(dados.grupos)) return "mixer.json: falta a lista \"grupos\"";
  const g: any[] = dados.grupos;
  if (g.length === 0) return "mixer.json: lista de grupos vazio";
  if (g.length > MAX_GRUPOS) return "mixer.json: mais de " + MAX_GRUPOS + " grupos";
  const nomes: string[] = []; const pais: number[] = []; const vols: f64[] = []; const mudos: f64[] = []; const pausas: f64[] = [];
  let i = 0;
  while (i < g.length) {
    const e = g[i];
    if (e === null || e === undefined || typeof e.nome !== "string" || e.nome.length === 0) return "mixer.json: grupo " + i + " sem nome";
    if (nomes.indexOf(e.nome) >= 0) return "mixer.json: nome repetido \"" + e.nome + "\"";
    const paiNome: string = typeof e.pai === "string" ? e.pai : "";
    let pai = 0 - 1;
    if (i === 0) { if (paiNome !== "") return "mixer.json: o primeiro grupo é a raiz (pai \"\")"; }
    else {
      pai = nomes.indexOf(paiNome);
      if (pai < 0) return "mixer.json: pai \"" + paiNome + "\" de \"" + e.nome + "\" não vem antes dele na lista";
    }
    if (typeof e.volume !== "number" || !(e.volume >= 0.0 && e.volume <= 1.0)) return "mixer.json: volume de \"" + e.nome + "\" fora de 0..1";
    nomes.push(e.nome); pais.push(pai); vols.push(e.volume);
    mudos.push(e.mudo === true ? 1.0 : 0.0); pausas.push(e.pausa === true ? 1.0 : 0.0);
    i = i + 1;
  }
  grpNomes.length = 0; grpPai.length = 0;
  i = 0;
  while (i < nomes.length) {
    grpNomes.push(nomes[i]); grpPai.push(pais[i]);
    grpVolume[i] = vols[i]; grpMudo[i] = mudos[i]; grpPausa[i] = pausas[i];
    i = i + 1;
  }
  grpVersao = grpVersao + 1;
  grpSalva = grpVersao;
  return "";
}

/// Sem arquivo: os quatro padrão, sem erro. Com arquivo, erro ou JSON
/// inválido: mensagem, e o mixer fica como estava (`mixerDeJson` só troca o
/// estado depois de validar tudo).
export function carregarMixer(caminho: string): string {
  if (!fs.exists(caminho)) { mixerPadrao(); return ""; }
  let texto: string | undefined;
  try { texto = fs.read_text(caminho); } catch (e) { texto = undefined; }
  // `fs.read_text` pode devolver `undefined` sem lançar (I/O falhou em
  // silêncio) — trata como erro de leitura, não como "arquivo ausente".
  if (texto === undefined || texto === null) return "mixer.json: falha ao ler " + caminho;
  return mixerDeJson(texto);
}

export function salvarMixer(caminho: string): string {
  const texto = mixerParaJson();
  fs.write(caminho, texto);
  let lido: string | undefined;
  try { lido = fs.exists(caminho) ? fs.read_text(caminho) : undefined; } catch (e) { lido = undefined; }
  if (lido !== texto) return "mixer.json: a escrita em " + caminho + " não se confirmou";
  grpSalva = grpVersao;
  return "";
}

/// A API do spec (§3.7), por nome. Resolva o índice uma vez (`grupoIndex`) num
/// caminho por quadro; estes métodos comparam string a cada chamada.
export class Mixer {
  static setVolume(grupo: string, v: f64): boolean { const i = grupoIndex(grupo); if (i < 0) return false; mixerSetVolume(i, v); return true; }
  static mute(grupo: string, m: boolean): boolean { const i = grupoIndex(grupo); if (i < 0) return false; mixerSetMudo(i, m ? 1 : 0); return true; }
  static pause(grupo: string, p: boolean): boolean { const i = grupoIndex(grupo); if (i < 0) return false; mixerSetPausa(i, p ? 1 : 0); return true; }
  static grupoIndex(nome: string): number { return grupoIndex(nome); }
}
