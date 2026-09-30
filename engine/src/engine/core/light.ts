// Engine RTS — LIGHT: luz como COMPONENT de um GameObject (modelo da Unity).
// Posição e direção vêm do Transform de MUNDO do dono: a direção é o eixo +Z
// local, na convenção da câmera — fwd = (sin yaw·cos p, sin p, cos yaw·cos p),
// yaw = wry, pitch = wrx, pitch > 0 olha para cima. O renderer recebe até
// MAX_LUZES por frame (`Scene.collectLights`), com a direcional principal primeiro.
import math from "@compat/math.ts";
import { Behavior, KIND_LIGHT, FIELD_HINT_COLOR, FIELD_HINT_ENUM } from "./behavior";
import { GameObject, activeInScene } from "./gameobject";
import type { Scene } from "./scene";
import type { InspectorUI } from "./inspector_ui";

export const MAX_LUZES: number = 8;
export const FLOATS_POR_LUZ: number = 16;
export const LUZ_DIRECIONAL: number = 0;
export const LUZ_PONTUAL: number = 1;
export const LUZ_SPOT: number = 2;
export const TIPOS_LUZ: string[] = ["direcional", "pontual", "spot"];
/// Abertura total aceita do spot, em graus (a mesma faixa do @range do campo).
export const SPOT_ANGULO_MIN: number = 1.0;
export const SPOT_ANGULO_MAX: number = 179.0;
/// O cone interno do spot é esta fração do externo; a borda suave fica entre os dois.
export const SPOT_FRACAO_INTERNA: number = 0.8;
/// Pose da "Luz Direcional" de uma cena nova: sol a 50° de altura, azimute de 30°.
export const LUZ_PADRAO_PITCH: number = 0.0 - 0.8726646259971648;
export const LUZ_PADRAO_YAW: number = 0.5235987755982988;
export const LUZ_PADRAO_ALTURA: number = 10.0;
const RAD_POR_GRAU: number = 0.017453292519943295;
/// Capacidade inicial do rascunho de distâncias (cresce por dobra). Exportada
/// porque `Scene` a usa para o `luzDist` inicial do construtor (mesma medida
/// nos dois lugares, em vez de repetir o literal).
export const LUZ_DIST_INICIAL: number = 16;
/// Rótulos do Inspector próprio (onInspectorGUI), como os `@label` dos campos.
const ROTULO_TIPO: string = "Tipo";
const ROTULO_COR: string = "Cor";

/**
 * @componentCategory Renderização
 * @componentDescription Luz direcional, pontual ou spot usada pelo renderer.
 * @componentKeywords luz light sol lâmpada lampada spot iluminação
 */
export class Light extends Behavior {
  /** "direcional", "pontual" ou "spot". */
  tipo: string = "direcional";
  /** Cor 0xRRGGBB. */
  cor: number = 0xFFFFFF;
  /** @range 0 100 */
  intensidade: number = 1.0;
  /**
   * Distância em que a pontual e o spot chegam a zero.
   * @range 0 10000
   */
  alcance: number = 10.0;
  /**
   * Abertura total do cone do spot, em graus.
   * @label Ângulo do spot
   * @range 1 179
   */
  anguloSpot: number = 45.0;
  /** Só a primeira direcional com sombra usa o shadow map. */
  sombra: boolean = false;

  constructor() { super(); }
  kind(): number { return KIND_LIGHT; }
  lightType(): number {
    let t = LUZ_DIRECIONAL;
    if (this.tipo === "pontual") t = LUZ_PONTUAL;
    else if (this.tipo === "spot") t = LUZ_SPOT;
    return t;
  }
  /// A porta de controle aceita #RRGGBB em `cor` e só as opções da lista em `tipo`.
  fieldHint(i: number): string {
    const n = this.fieldName(i);
    if (n === "cor") return FIELD_HINT_COLOR;
    if (n === "tipo") return FIELD_HINT_ENUM;
    return "";
  }
  fieldOptions(i: number): string[] { return this.fieldName(i) === "tipo" ? TIPOS_LUZ : super.fieldOptions(i); }
  onValidate(field: string): void {
    if (field === "tipo" && TIPOS_LUZ.indexOf(this.tipo) < 0) this.tipo = "direcional";
    // `!(v >= min)` também pega NaN.
    if (!(this.anguloSpot >= SPOT_ANGULO_MIN)) this.anguloSpot = SPOT_ANGULO_MIN;
    if (this.anguloSpot > SPOT_ANGULO_MAX) this.anguloSpot = SPOT_ANGULO_MAX;
  }
  lightCastsShadow(): number { return this.sombra ? 1 : 0; }
  /// Tipo como lista, cor em #RRGGBB e só os campos que valem para o tipo.
  onInspectorGUI(ui: InspectorUI): void {
    const tipo = Math.max(0, TIPOS_LUZ.indexOf(this.tipo));
    const novoTipo = ui.dropdown(ROTULO_TIPO, TIPOS_LUZ, tipo);
    if (novoTipo !== tipo) this.tipo = TIPOS_LUZ[novoTipo];
    this.cor = ui.color(ROTULO_COR, this.cor);
    ui.field("intensidade");
    if (this.tipo !== "direcional") ui.field("alcance");
    if (this.tipo === "spot") ui.field("anguloSpot");
    if (this.tipo === "direcional") ui.field("sombra");
  }
  lightPack(out: Float64Array, base: number): void {
    const t = this.host;
    const cp = math.cos(t.wrx); const sp = math.sin(t.wrx);
    const cy = math.cos(t.wry); const sy = math.sin(t.wry);
    const meio = this.anguloSpot * 0.5 * RAD_POR_GRAU;
    out[base] = this.lightType();
    out[base + 1] = t.wx; out[base + 2] = t.wy; out[base + 3] = t.wz;
    out[base + 4] = sy * cp; out[base + 5] = sp; out[base + 6] = cy * cp;
    out[base + 7] = ((this.cor >> 16) & 255) / 255.0;
    out[base + 8] = ((this.cor >> 8) & 255) / 255.0;
    out[base + 9] = (this.cor & 255) / 255.0;
    out[base + 10] = this.intensidade;
    out[base + 11] = this.alcance;
    out[base + 12] = math.cos(meio * SPOT_FRACAO_INTERNA);
    out[base + 13] = math.cos(meio);
    out[base + 14] = this.sombra ? 1.0 : 0.0;
    out[base + 15] = 0.0;
  }
}

function capacidadePara(n: number): number {
  let c = LUZ_DIST_INICIAL;
  while (c < n) c = c * 2;
  return c;
}

/// Preenche `buf` com até MAX_LUZES luzes e devolve quantas. A direcional
/// PRINCIPAL vem primeiro (slot 0) — e é ela que `aplicarLuzes` manda pro
/// shadow map quando tem sombra. Prioridade: a primeira direcional ATIVA com
/// `sombra`, senão a primeira direcional ativa qualquer (o `ambiente.sol` não
/// entra aqui: só aponta o disco do céu, ver `direcaoSol`). As demais luzes
/// seguem por distância a `cam` [x, y, z]. Sem alocação: as distâncias ficam
/// em `sc.luzDist`, que só cresce. Inativas (inclusive por ancestral) e
/// desligadas ficam fora.
export function coletarLuzes(sc: Scene, buf: Float64Array, cam: Float64Array): number {
  const lista: GameObject[] = sc.lightObjs;
  const total = lista.length;
  if (sc.luzDist.length < total) sc.luzDist = new Float64Array(capacidadePara(total));
  const dist: Float64Array = sc.luzDist;
  let primeiraDir = 0 - 1;
  let primeiraComSombra = 0 - 1;
  let i = 0;
  while (i < total) {
    const o = lista[i];
    const l = o.behaviors[o.lightIdx];
    dist[i] = 0.0 - 1.0;
    if (l.enabled !== 0 && activeInScene(sc.objects, o)) {
      if (l.lightType() === LUZ_DIRECIONAL) {
        dist[i] = 0.0;
        if (primeiraDir < 0) primeiraDir = i;
        if (primeiraComSombra < 0 && l.lightCastsShadow() !== 0) primeiraComSombra = i;
      } else {
        const t = o.transform;
        const dx = t.wx - cam[0]; const dy = t.wy - cam[1]; const dz = t.wz - cam[2];
        dist[i] = 1.0 + dx * dx + dy * dy + dz * dz;   // +1: depois de toda direcional
      }
    }
    i = i + 1;
  }
  const principal = primeiraComSombra >= 0 ? primeiraComSombra : primeiraDir;
  let n = 0;
  if (principal >= 0) {
    const op = lista[principal];
    op.behaviors[op.lightIdx].lightPack(buf, 0);
    dist[principal] = 0.0 - 1.0;
    n = 1;
  }
  let procurar = true;
  while (procurar && n < MAX_LUZES) {
    let melhor = 0 - 1;
    let k = 0;
    while (k < total) {
      if (dist[k] >= 0.0 && (melhor < 0 || dist[k] < dist[melhor])) melhor = k;
      k = k + 1;
    }
    if (melhor < 0) procurar = false;
    else {
      const o = lista[melhor];
      o.behaviors[o.lightIdx].lightPack(buf, n * FLOATS_POR_LUZ);
      dist[melhor] = 0.0 - 1.0;
      n = n + 1;
    }
  }
  return n;
}

/// Direção da direcional de nome `nome` (o `ambiente.sol` do Task 5) — SÓ pra
/// onde o disco do céu aponta, sem afetar o slot 0/sombra de `coletarLuzes`
/// (esses são independentes: o sol do céu pode ser uma direcional diferente da
/// que lança sombra). Devolve 0 e não toca `out` se `nome` for vazio, não
/// existir, não for direcional, estiver desligada/inativa — quem chama cai pro
/// slot 0 ou pro SOL_PADRAO. Sem alocação.
export function direcaoSol(sc: Scene, nome: string, out: Float64Array): number {
  if (nome.length === 0) return 0;
  const lista = sc.lightObjs;
  const total = lista.length;
  let i = 0;
  while (i < total) {
    const o = lista[i];
    if (o.name === nome) {
      const l = o.behaviors[o.lightIdx];
      if (l.enabled === 0 || l.lightType() !== LUZ_DIRECIONAL || !activeInScene(sc.objects, o)) return 0;
      const t = o.transform;
      const cp = math.cos(t.wrx); const sp = math.sin(t.wrx);
      const cy = math.cos(t.wry); const sy = math.sin(t.wry);
      out[0] = sy * cp; out[1] = sp; out[2] = cy * cp;
      return 1;
    }
    i = i + 1;
  }
  return 0;
}

/// Há alguma direcional ativa e ligada com `sombra`? (a que ocuparia o shadow
/// map em `coletarLuzes`). Quem cria uma direcional usa isto para que a
/// primeira nasça com sombra, como a luz padrão da cena nova.
export function haDirecionalComSombra(sc: Scene): boolean {
  const lista = sc.lightObjs;
  let i = 0;
  while (i < lista.length) {
    const o = lista[i];
    const l = o.behaviors[o.lightIdx];
    if (l.enabled !== 0 && l.lightType() === LUZ_DIRECIONAL && l.lightCastsShadow() !== 0 && activeInScene(sc.objects, o)) return true;
    i = i + 1;
  }
  return false;
}

/// A "Luz Direcional" com sombra que toda cena nova ganha.
export function criarLuzDirecionalPadrao(sc: Scene): GameObject {
  const o = sc.createGameObject("Luz Direcional");
  o.transform.setPosition(0.0, LUZ_PADRAO_ALTURA, 0.0);
  o.transform.rx = LUZ_PADRAO_PITCH;
  o.transform.ry = LUZ_PADRAO_YAW;
  const l = new Light();
  l.sombra = true;
  o.addBehavior(l);
  return o;
}
