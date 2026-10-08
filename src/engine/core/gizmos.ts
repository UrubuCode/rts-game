// Engine RTS — GIZMOS: desenhador imediato do editor. Um Behavior desenha
// linhas, esferas, cones e ícones em onDrawGizmos(g); o editor projeta com a
// câmera da vista de Cena (a mesma conta de editor/gizmo.ts:projPt) e pinta por
// cima do 3D. Nada disto roda no jogo. Buffers crescem por dobra e são
// reaproveitados; os pontos de trabalho são campos, não alocações.
import math from "@compat/math.ts";
import type { Behavior } from "./behavior";
import type { GameObject } from "./gameobject";

export const GIZMO_SEGMENTOS_CIRCULO: number = 24;
export const GIZMO_ARESTAS_CONE: number = 8;
/// Pares de índice de vértice (0-7) de cada uma das 12 arestas de `wireBox`
/// (vértice `i`: bit0=eixo X, bit1=eixo Y, bit2=eixo Z, 0=-metade/1=+metade).
const ARESTAS_CAIXA: number[] = [0, 1, 0, 2, 1, 3, 2, 3, 4, 5, 4, 6, 5, 7, 6, 7, 0, 4, 1, 5, 2, 6, 3, 7];
/// Profundidade mínima de um ponto desenhado (a mesma de projPt).
export const GIZMO_Z_MIN: number = 0.2;
const FLOATS_SEGMENTO: number = 5;   // x1, y1, x2, y2, cor
const FLOATS_ICONE: number = 4;      // x, y, lado, dono
const SEGMENTOS_INICIAIS: number = 256;
const ICONES_INICIAIS: number = 32;
const DOIS_PI: number = 6.283185307179586;
const RAD_POR_GRAU: number = 0.017453292519943295;
const COR_PADRAO: number = 0xFFFFFFFF;
/// |dir.y| acima disto: o eixo auxiliar do cone vira +X (evita produto vetorial nulo).
const QUASE_VERTICAL: number = 0.99;

export type GizmoFn = (g: Gizmos, dono: GameObject, comp: Behavior) => void;

export class Gizmos {
  /// x, y, z, cos yaw, sin yaw, cos pitch, sin pitch, focal, largura, altura.
  cam: Float64Array;
  seg: Float64Array; nSeg: number;
  ic: Float64Array; icNomes: string[]; nIc: number;
  /// Cor corrente 0xRRGGBBAA (formato de app.line).
  cor: number;
  /// Índice na cena do objeto sendo desenhado (o dono dos ícones).
  dono: number;
  /// Lado do ícone em pixels (o editor põe UI_GIZMO.iconSize).
  lado: number;
  /// O objeto sendo desenhado está selecionado.
  selecionado: boolean;
  pa: Float64Array; pb: Float64Array;              // pontos projetados
  wa: Float64Array; wb: Float64Array; cb: Float64Array;   // pontos de mundo; centro da base do cone
  u: Float64Array; w: Float64Array;                // eixos do plano do círculo
  /// Raio da base do cone sendo desenhado (wireCone → coneArame).
  raioCone: number;
  /// Os 8 vértices (3 floats cada) da caixa sendo desenhada (wireBox → caixaArame).
  boxBuf: Float64Array;
  constructor() {
    this.cam = new Float64Array(10);
    this.seg = new Float64Array(SEGMENTOS_INICIAIS * FLOATS_SEGMENTO); this.nSeg = 0;
    this.ic = new Float64Array(ICONES_INICIAIS * FLOATS_ICONE); this.icNomes = []; this.nIc = 0;
    this.cor = COR_PADRAO; this.dono = 0 - 1; this.lado = 0.0; this.selecionado = false;
    this.pa = new Float64Array(2); this.pb = new Float64Array(2);
    this.wa = new Float64Array(3); this.wb = new Float64Array(3); this.cb = new Float64Array(3);
    this.u = new Float64Array(3); this.w = new Float64Array(3);
    this.raioCone = 0.0;
    this.boxBuf = new Float64Array(24);
  }
  color(rgb: number): void { this.cor = (rgb & 0xFFFFFF) * 256 + 255; }
  line(a: Float64Array, b: Float64Array): void { segmentoMundo(this, a, b); }
  /// Marcador de ponto em pixels: quatro arestas, legivel mesmo distante.
  pointHandle(c: Float64Array, radius: number): void {
    if (projetar(this, c, this.pa) === 0) return;
    garantirSegmentos(this, this.nSeg + 4);
    const x=this.pa[0], y=this.pa[1], s=this.seg;
    for(let i=0;i<4;i++) {
      const k=(this.nSeg+i)*FLOATS_SEGMENTO, j=(i+1)%4;
      s[k]=x+(i===0?-radius:i===2?radius:0); s[k+1]=y+(i===1?-radius:i===3?radius:0);
      s[k+2]=x+(j===0?-radius:j===2?radius:0); s[k+3]=y+(j===1?-radius:j===3?radius:0); s[k+4]=this.cor;
    }
    this.nSeg+=4;
  }
  wireSphere(c: Float64Array, r: number): void { circulo(this, c, r, 0); circulo(this, c, r, 1); circulo(this, c, r, 2); }
  /// Ápice `apice`, eixo `dir` (unitário), altura `comprimento`, abertura TOTAL `anguloGraus`.
  wireCone(apice: Float64Array, dir: Float64Array, comprimento: number, anguloGraus: number): void {
    this.raioCone = comprimento * math.tan(anguloGraus * 0.5 * RAD_POR_GRAU);
    coneArame(this, apice, dir, comprimento);
  }
  icon(nome: string, pos: Float64Array): void { iconeMundo(this, nome, pos); }
  /// Caixa de arestas alinhada aos eixos, centro `c`, tamanho TOTAL por eixo
  /// em `tamanho` (não a meia-extensão): 8 vértices, 12 arestas. 2
  /// parâmetros (dentro do limite do RTS); vértices em `boxBuf` (campo
  /// reaproveitado, sem alocar por chamada — o formato do emissor de
  /// partículas muda pelo Inspector, não por quadro, mas o gizmo redesenha
  /// todo quadro do objeto selecionado).
  wireBox(c: Float64Array, tamanho: Float64Array): void { caixaArame(this, c, tamanho); }
}

export function gizmosBegin(g: Gizmos, pose: Float64Array): void {
  const c = g.cam;
  c[0] = pose[0]; c[1] = pose[1]; c[2] = pose[2];
  c[3] = math.cos(pose[3]); c[4] = math.sin(pose[3]); c[5] = math.cos(pose[4]); c[6] = math.sin(pose[4]);
  c[7] = (pose[7] * 0.5) / math.tan(pose[5] * 0.5); c[8] = pose[6]; c[9] = pose[7];
  g.nSeg = 0; g.nIc = 0; g.cor = COR_PADRAO; g.dono = 0 - 1; g.selecionado = false;
}
function projetar(g: Gizmos, p: Float64Array, out: Float64Array): number {
  const c = g.cam;
  const dx = p[0] - c[0]; const dy = p[1] - c[1]; const dz = p[2] - c[2];
  const x1 = dx * c[3] - dz * c[4]; const z1 = dx * c[4] + dz * c[3];
  const y2 = dy * c[5] - z1 * c[6]; const z2 = dy * c[6] + z1 * c[5];
  let ok = 0;
  if (z2 > GIZMO_Z_MIN) { out[0] = c[8] * 0.5 + (x1 / z2) * c[7]; out[1] = c[9] * 0.5 - (y2 / z2) * c[7]; ok = 1; }
  return ok;
}
function garantirSegmentos(g: Gizmos, n: number): void {
  if (g.seg.length >= n * FLOATS_SEGMENTO) return;
  let cap = g.seg.length / FLOATS_SEGMENTO;
  while (cap < n) cap = cap * 2;
  const novo = new Float64Array(cap * FLOATS_SEGMENTO);
  let i = 0; while (i < g.nSeg * FLOATS_SEGMENTO) { novo[i] = g.seg[i]; i = i + 1; }
  g.seg = novo;
}
function garantirIcones(g: Gizmos, n: number): void {
  if (g.ic.length >= n * FLOATS_ICONE) return;
  let cap = g.ic.length / FLOATS_ICONE;
  while (cap < n) cap = cap * 2;
  const novo = new Float64Array(cap * FLOATS_ICONE);
  let i = 0; while (i < g.nIc * FLOATS_ICONE) { novo[i] = g.ic[i]; i = i + 1; }
  g.ic = novo;
}
function segmentoMundo(g: Gizmos, a: Float64Array, b: Float64Array): void {
  if (projetar(g, a, g.pa) !== 0 && projetar(g, b, g.pb) !== 0) {
    garantirSegmentos(g, g.nSeg + 1);
    const k = g.nSeg * FLOATS_SEGMENTO;
    g.seg[k] = g.pa[0]; g.seg[k + 1] = g.pa[1]; g.seg[k + 2] = g.pb[0]; g.seg[k + 3] = g.pb[1]; g.seg[k + 4] = g.cor;
    g.nSeg = g.nSeg + 1;
  }
}
function iconeMundo(g: Gizmos, nome: string, pos: Float64Array): void {
  if (projetar(g, pos, g.pa) !== 0) {
    garantirIcones(g, g.nIc + 1);
    const k = g.nIc * FLOATS_ICONE;
    g.ic[k] = g.pa[0] - g.lado * 0.5; g.ic[k + 1] = g.pa[1] - g.lado * 0.5; g.ic[k + 2] = g.lado; g.ic[k + 3] = g.dono;
    if (g.icNomes.length <= g.nIc) g.icNomes.push(nome); else g.icNomes[g.nIc] = nome;
    g.nIc = g.nIc + 1;
  }
}
/// Ponto do círculo de centro `c`, raio `r`, ângulo `a`, no plano gerado por g.u/g.w → g.wa.
function pontoDoCirculo(g: Gizmos, c: Float64Array, r: number, a: number): void {
  const ca = math.cos(a) * r; const sa = math.sin(a) * r;
  g.wa[0] = c[0] + g.u[0] * ca + g.w[0] * sa;
  g.wa[1] = c[1] + g.u[1] * ca + g.w[1] * sa;
  g.wa[2] = c[2] + g.u[2] * ca + g.w[2] * sa;
}
/// Anel no plano de g.u/g.w (usa g.wa e g.wb).
function anel(g: Gizmos, c: Float64Array, r: number): void {
  let k = 0;
  while (k < GIZMO_SEGMENTOS_CIRCULO) {
    pontoDoCirculo(g, c, r, ((k + 1) / GIZMO_SEGMENTOS_CIRCULO) * DOIS_PI);
    g.wb[0] = g.wa[0]; g.wb[1] = g.wa[1]; g.wb[2] = g.wa[2];
    pontoDoCirculo(g, c, r, (k / GIZMO_SEGMENTOS_CIRCULO) * DOIS_PI);
    segmentoMundo(g, g.wa, g.wb);
    k = k + 1;
  }
}
/// Plano 0 = YZ, 1 = XZ, 2 = XY.
function circulo(g: Gizmos, c: Float64Array, r: number, plano: number): void {
  g.u[0] = plano === 0 ? 0.0 : 1.0; g.u[1] = plano === 0 ? 1.0 : 0.0; g.u[2] = 0.0;
  g.w[0] = 0.0; g.w[1] = plano === 2 ? 1.0 : 0.0; g.w[2] = plano === 2 ? 0.0 : 1.0;
  anel(g, c, r);
}
/// Raio da base em g.raioCone. 4 parâmetros: com 5+ o RTS aloca a cada chamada (rts#2760).
function coneArame(g: Gizmos, apice: Float64Array, dir: Float64Array, comprimento: number): void {
  const raio = g.raioCone;
  // u = normalize(dir × aux), w = dir × u; aux = +Y, ou +X quando dir ~ ±Y
  const ax = Math.abs(dir[1]) > QUASE_VERTICAL ? 1.0 : 0.0; const ay = 1.0 - ax;
  g.u[0] = 0.0 - dir[2] * ay; g.u[1] = dir[2] * ax; g.u[2] = dir[0] * ay - dir[1] * ax;
  const lu = math.sqrt(g.u[0] * g.u[0] + g.u[1] * g.u[1] + g.u[2] * g.u[2]);
  g.u[0] = g.u[0] / lu; g.u[1] = g.u[1] / lu; g.u[2] = g.u[2] / lu;
  g.w[0] = dir[1] * g.u[2] - dir[2] * g.u[1]; g.w[1] = dir[2] * g.u[0] - dir[0] * g.u[2]; g.w[2] = dir[0] * g.u[1] - dir[1] * g.u[0];
  g.cb[0] = apice[0] + dir[0] * comprimento; g.cb[1] = apice[1] + dir[1] * comprimento; g.cb[2] = apice[2] + dir[2] * comprimento;
  let k = 0;
  while (k < GIZMO_ARESTAS_CONE) {
    pontoDoCirculo(g, g.cb, raio, (k / GIZMO_ARESTAS_CONE) * DOIS_PI);
    segmentoMundo(g, apice, g.wa);
    k = k + 1;
  }
  anel(g, g.cb, raio);
}

/// Vértices em `g.boxBuf` (índice `i`: bit0=X, bit1=Y, bit2=Z, 0=-metade/1=+metade
/// de `tamanho`), arestas por `ARESTAS_CAIXA`, cada uma desenhada via `g.wa`/`g.wb`
/// (reaproveitados, como o resto do módulo). 3 parâmetros (limite do RTS).
function caixaArame(g: Gizmos, c: Float64Array, tamanho: Float64Array): void {
  const hx = tamanho[0] * 0.5; const hy = tamanho[1] * 0.5; const hz = tamanho[2] * 0.5;
  const v = g.boxBuf;
  let i = 0;
  while (i < 8) {
    const k = i * 3;
    v[k] = c[0] + ((i & 1) !== 0 ? hx : 0.0 - hx);
    v[k + 1] = c[1] + ((i & 2) !== 0 ? hy : 0.0 - hy);
    v[k + 2] = c[2] + ((i & 4) !== 0 ? hz : 0.0 - hz);
    i = i + 1;
  }
  let e = 0;
  while (e < ARESTAS_CAIXA.length) {
    const ka = ARESTAS_CAIXA[e] * 3; const kb = ARESTAS_CAIXA[e + 1] * 3;
    g.wa[0] = v[ka]; g.wa[1] = v[ka + 1]; g.wa[2] = v[ka + 2];
    g.wb[0] = v[kb]; g.wb[1] = v[kb + 1]; g.wb[2] = v[kb + 2];
    segmentoMundo(g, g.wa, g.wb);
    e = e + 2;
  }
}

const tiposGizmo: string[] = [];
const fnsGizmo: GizmoFn[] = [];
/// Desenhador para um tipo de componente (typeName), para quem não pode
/// sobrescrever onDrawGizmos (ex.: Light e Camera, do núcleo, desenhados por
/// pacote). Registre ANTES de criar objetos: o gizmoFlag é calculado ao anexar.
export function registerGizmoDrawer(tipo: string, fn: GizmoFn): boolean {
  const ok = tipo.length > 0 && tiposGizmo.indexOf(tipo) < 0;
  if (ok) { tiposGizmo.push(tipo); fnsGizmo.push(fn); }
  return ok;
}
export function gizmoDrawerIndex(tipo: string): number { return tiposGizmo.indexOf(tipo); }
export function runGizmoDrawer(i: number, g: Gizmos, dono: GameObject, comp: Behavior): void { fnsGizmo[i](g, dono, comp); }
