// Engine RTS — AMBIENTE: configurações de render da cena (o RenderSettings da
// Unity): céu, neblina, luz ambiente e qual direcional é o sol. Vive em
// `scene.ambiente` e no JSON da cena como bloco "ambiente". Scripts leem e
// escrevem os campos direto; `ambienteSync` compara o empacotado com o último
// enviado, e só então o renderer recebe setSky/setFog.
export const SKY_FLOATS: number = 22;
export const MODOS_CEU: string[] = ["estrelas", "procedural", "cor", "panorama"];
export const MODOS_LUZ_AMBIENTE: string[] = ["cor", "ceu"];
/// Códigos do `setSky` para `luzAmbiente.modo` (0 = escalar legado do setLight).
const AMBIENTE_COR: number = 1;
const AMBIENTE_CEU: number = 2;

function rgb(r: number, g: number, b: number): Float64Array {
  const v = new Float64Array(3); v[0] = r; v[1] = g; v[2] = b; return v;
}
export class CeuConfig {
  modo: string; topo: Float64Array; horizonte: Float64Array; chao: Float64Array;
  estrelas: number; exposicao: number; textura: string; tamanhoSol: number;
  constructor() {
    this.modo = "estrelas"; this.topo = rgb(0.25, 0.45, 0.80); this.horizonte = rgb(0.70, 0.80, 0.90);
    this.chao = rgb(0.25, 0.23, 0.20); this.estrelas = 0.0; this.exposicao = 1.0; this.textura = ""; this.tamanhoSol = 0.04;
  }
}
export class NeblinaConfig {
  cor: Float64Array; densidade: number;
  constructor() { this.cor = rgb(0.60, 0.65, 0.70); this.densidade = 0.0; }
}
export class LuzAmbienteConfig {
  modo: string; cor: Float64Array; intensidade: number;
  constructor() { this.modo = "cor"; this.cor = rgb(1.0, 1.0, 1.0); this.intensidade = 0.25; }
}
export class Ambiente {
  ceu: CeuConfig; neblina: NeblinaConfig; luzAmbiente: LuzAmbienteConfig;
  /// Nome do GameObject da direcional que dá a direção do sol ("" = a primeira).
  sol: string;
  /// Sobe a cada envio ao renderer (a UI do Ambiente compara com a sua).
  versao: number;
  pacote: Float64Array; enviado: Float64Array; neblinaPacote: Float64Array; neblinaEnviada: Float64Array;
  constructor() {
    this.ceu = new CeuConfig(); this.neblina = new NeblinaConfig(); this.luzAmbiente = new LuzAmbienteConfig();
    this.sol = ""; this.versao = 0;
    this.pacote = new Float64Array(SKY_FLOATS); this.enviado = new Float64Array(SKY_FLOATS);
    this.neblinaPacote = new Float64Array(4); this.neblinaEnviada = new Float64Array(4);
    this.enviado[0] = 0.0 - 1.0; this.neblinaEnviada[3] = 0.0 - 1.0;   // força o 1º envio
  }
}

function copiar3(dst: Float64Array, src: Float64Array): void { dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2]; }
export function copiarAmbiente(dst: Ambiente, src: Ambiente): void {
  dst.ceu.modo = src.ceu.modo; copiar3(dst.ceu.topo, src.ceu.topo); copiar3(dst.ceu.horizonte, src.ceu.horizonte);
  copiar3(dst.ceu.chao, src.ceu.chao); dst.ceu.estrelas = src.ceu.estrelas; dst.ceu.exposicao = src.ceu.exposicao;
  dst.ceu.textura = src.ceu.textura; dst.ceu.tamanhoSol = src.ceu.tamanhoSol;
  copiar3(dst.neblina.cor, src.neblina.cor); dst.neblina.densidade = src.neblina.densidade;
  dst.luzAmbiente.modo = src.luzAmbiente.modo; copiar3(dst.luzAmbiente.cor, src.luzAmbiente.cor);
  dst.luzAmbiente.intensidade = src.luzAmbiente.intensidade; dst.sol = src.sol;
}
export function ambientePadrao(dst: Ambiente): void { copiarAmbiente(dst, new Ambiente()); }

function arr3(v: Float64Array): number[] { const a: number[] = [v[0], v[1], v[2]]; return a; }
export function ambienteToData(a: Ambiente): any {
  return {
    ceu: { modo: a.ceu.modo, topo: arr3(a.ceu.topo), horizonte: arr3(a.ceu.horizonte), chao: arr3(a.ceu.chao),
           estrelas: a.ceu.estrelas, exposicao: a.ceu.exposicao, textura: a.ceu.textura, tamanhoSol: a.ceu.tamanhoSol },
    neblina: { cor: arr3(a.neblina.cor), densidade: a.neblina.densidade },
    luzAmbiente: { modo: a.luzAmbiente.modo, cor: arr3(a.luzAmbiente.cor), intensidade: a.luzAmbiente.intensidade },
    sol: a.sol,
  };
}

function erro(campo: string, motivo: string): Error { return new Error("ambiente." + campo + ": " + motivo); }
function lerNumero(v: any, campo: string, padrao: number): number {
  if (v === undefined) return padrao;
  if (typeof v !== "number" || !Number.isFinite(v)) throw erro(campo, "deve ser um número");
  if (v < 0.0) throw erro(campo, "deve ser >= 0");
  return v;
}
function lerCor(v: any, campo: string, dst: Float64Array): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length !== 3) throw erro(campo, "deve ser [r, g, b]");
  let i = 0;
  while (i < 3) {
    if (typeof v[i] !== "number" || !Number.isFinite(v[i]) || v[i] < 0.0) throw erro(campo, "componentes >= 0");
    dst[i] = v[i]; i = i + 1;
  }
}
function lerModo(v: any, campo: string, validos: string[], padrao: string): string {
  if (v === undefined) return padrao;
  if (typeof v !== "string" || validos.indexOf(v) < 0) throw erro(campo, "use " + validos.join(", "));
  return v;
}
function lerTexto(v: any, campo: string, padrao: string): string {
  if (v === undefined) return padrao;
  if (typeof v !== "string") throw erro(campo, "deve ser texto");
  return v;
}
/// Lê o bloco num Ambiente temporário e só copia para `dst` se tudo for válido.
export function ambienteFromData(dst: Ambiente, d: any): void {
  if (d === null || typeof d !== "object") throw erro("", "deve ser um objeto");
  const t = new Ambiente();
  const c = d.ceu !== undefined ? d.ceu : {};
  const n = d.neblina !== undefined ? d.neblina : {};
  const l = d.luzAmbiente !== undefined ? d.luzAmbiente : {};
  t.ceu.modo = lerModo(c.modo, "ceu.modo", MODOS_CEU, t.ceu.modo);
  lerCor(c.topo, "ceu.topo", t.ceu.topo); lerCor(c.horizonte, "ceu.horizonte", t.ceu.horizonte); lerCor(c.chao, "ceu.chao", t.ceu.chao);
  t.ceu.estrelas = lerNumero(c.estrelas, "ceu.estrelas", t.ceu.estrelas);
  t.ceu.exposicao = lerNumero(c.exposicao, "ceu.exposicao", t.ceu.exposicao);
  t.ceu.textura = lerTexto(c.textura, "ceu.textura", t.ceu.textura);
  t.ceu.tamanhoSol = lerNumero(c.tamanhoSol, "ceu.tamanhoSol", t.ceu.tamanhoSol);
  lerCor(n.cor, "neblina.cor", t.neblina.cor);
  t.neblina.densidade = lerNumero(n.densidade, "neblina.densidade", t.neblina.densidade);
  t.luzAmbiente.modo = lerModo(l.modo, "luzAmbiente.modo", MODOS_LUZ_AMBIENTE, t.luzAmbiente.modo);
  lerCor(l.cor, "luzAmbiente.cor", t.luzAmbiente.cor);
  t.luzAmbiente.intensidade = lerNumero(l.intensidade, "luzAmbiente.intensidade", t.luzAmbiente.intensidade);
  t.sol = lerTexto(d.sol, "sol", t.sol);
  copiarAmbiente(dst, t);
}

/// Os 22 floats do `setSky` (mesma ordem de SKY_IN em rts-egui/.../lights.rs).
export function empacotarCeu(a: Ambiente, sol: Float64Array, texturaId: number, out: Float64Array): void {
  const m = MODOS_CEU.indexOf(a.ceu.modo);
  out[0] = m >= 0 ? m : 0;
  out[1] = a.ceu.topo[0]; out[2] = a.ceu.topo[1]; out[3] = a.ceu.topo[2];
  out[4] = a.ceu.horizonte[0]; out[5] = a.ceu.horizonte[1]; out[6] = a.ceu.horizonte[2];
  out[7] = a.ceu.chao[0]; out[8] = a.ceu.chao[1]; out[9] = a.ceu.chao[2];
  out[10] = sol[0]; out[11] = sol[1]; out[12] = sol[2];
  out[13] = a.ceu.tamanhoSol; out[14] = a.ceu.estrelas; out[15] = a.ceu.exposicao; out[16] = texturaId;
  out[17] = a.luzAmbiente.modo === "ceu" ? AMBIENTE_CEU : AMBIENTE_COR;
  out[18] = a.luzAmbiente.cor[0]; out[19] = a.luzAmbiente.cor[1]; out[20] = a.luzAmbiente.cor[2];
  out[21] = a.luzAmbiente.intensidade;
}
function iguais(a: Float64Array, b: Float64Array): boolean {
  let i = 0; let ok = true;
  while (ok && i < a.length) { if (a[i] !== b[i]) ok = false; i = i + 1; }
  return ok;
}
function copiarBuf(dst: Float64Array, src: Float64Array): void { let i = 0; while (i < src.length) { dst[i] = src[i]; i = i + 1; } }
/// 1 = céu mudou, 2 = neblina mudou (soma). Atualiza os "enviados" e a versão.
export function ambienteSync(a: Ambiente, sol: Float64Array, texturaId: number): number {
  let bits = 0;
  empacotarCeu(a, sol, texturaId, a.pacote);
  if (!iguais(a.pacote, a.enviado)) { copiarBuf(a.enviado, a.pacote); bits = bits + 1; }
  a.neblinaPacote[0] = a.neblina.cor[0]; a.neblinaPacote[1] = a.neblina.cor[1];
  a.neblinaPacote[2] = a.neblina.cor[2]; a.neblinaPacote[3] = a.neblina.densidade;
  if (!iguais(a.neblinaPacote, a.neblinaEnviada)) { copiarBuf(a.neblinaEnviada, a.neblinaPacote); bits = bits + 2; }
  if (bits !== 0) a.versao = a.versao + 1;
  return bits;
}
