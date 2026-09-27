// Engine RTS — CAMERA: o ponto de vista como COMPONENT de um GameObject
// (o modelo da Unity). A câmera é parte da CENA, não estado solto do editor:
// aparece na hierarquia, tem transform, pode ser FILHA de outro objeto (um
// veículo, um alvo de follow) e receber scripts como qualquer GameObject.
//
// Quem renderiza lê a pose do TRANSFORM do dono:
//   posição = transform de MUNDO (wx,wy,wz) — herda do pai quando é filha
//   yaw     = transform.wry   |   pitch = transform.wrx
//
// O runtime do jogo (game.ts) renderiza por todas as câmeras ATIVAS da cena,
// por profundidade, cada uma na sua viewport (ver render/camera_views.ts). A
// viewport do editor mantém a fly-cam própria — editar não é jogar; o botão
// "Olhar" alinha uma na outra.

import math from "@compat/math.ts";
import { Behavior, KIND_CAMERA } from "./behavior";
import { GameObject, activeInScene } from "./gameobject";
import { activeScene } from "./active_scene";
import type { InspectorUI } from "./inspector_ui";

export const FUNDOS_CAMERA: string[] = ["ceu", "cor", "nada"];
/// Retângulo (pixels) de uma câmera que ainda não foi desenhada.
export const CAMERA_RETANGULO_PADRAO_L: number = 1280;
export const CAMERA_RETANGULO_PADRAO_A: number = 720;
/// Limites de validação da lente.
export const CAMERA_NEAR_MIN: number = 0.001;
export const CAMERA_FAR_FOLGA: number = 0.01;
export const CAMERA_ORTO_MIN: number = 0.001;
export const CAMERA_VIEWPORT_MIN: number = 0.01;
/// Índices no Inspector (ordem de declaração dos campos): FOV em graus e Main como caixa.
export const CAMERA_CAMPO_FOV: number = 0;
export const CAMERA_CAMPO_MAIN: number = 1;
export const GRAUS_POR_RAD: number = 57.29577951308232;
/// Faixa do FOV editável, em graus: slider do Inspector próprio e comando `camera`.
export const FOV_MIN_GRAUS: number = 10;
export const FOV_MAX_GRAUS: number = 150;
/// Rótulos do Inspector próprio (onInspectorGUI), como os `@label` dos campos.
const ROTULO_FOV: string = "Campo de visão";
const ROTULO_PRINCIPAL: string = "Principal";
const ROTULO_FUNDO: string = "Fundo";
const ROTULO_COR_FUNDO: string = "Cor do fundo";
const ROTULO_ALINHAR: string = "Alinhar com a vista";
/// FOV vertical aceito (radianos): 1° a 179°, fora disso tan(fov/2) degenera.
export const CAMERA_FOV_MIN: number = 0.017453292519943295;
export const CAMERA_FOV_MAX: number = 3.12413936106985;

/**
 * @componentCategory Renderização
 * @componentDescription Câmera do jogo: perspectiva ou ortográfica, viewport, fundo e ordem de desenho.
 * @componentKeywords camera câmera visão perspectiva ortográfica viewport
 */
export class Camera extends Behavior {
  /**
   * Campo de visão VERTICAL, em radianos (o Inspector mostra em graus).
   * @label FOV
   */
  fov: f64 = 1.05;
  /**
   * 1 = câmera principal (Camera.main()).
   * @label Main
   */
  isMain: number = 1;
  near: number = 0.1;
  far: number = 500.0;
  ortografica: boolean = false;
  /**
   * Meia altura da vista ortográfica, em unidades de mundo.
   * @label Tamanho orto
   */
  tamanhoOrto: number = 5.0;
  /** "ceu", "cor" ou "nada". */
  fundo: string = "ceu";
  /** @label Cor do fundo */
  corFundo: number = 0x1E2430;
  /** @range 0 1 */
  viewportX: number = 0.0;
  /**
   * A partir do TOPO da tela.
   * @range 0 1
   */
  viewportY: number = 0.0;
  /** @range 0.01 1 */
  viewportW: number = 1.0;
  /** @range 0.01 1 */
  viewportH: number = 1.0;
  /** Ordem de desenho: maior = por cima. */
  profundidade: number = 0.0;
  private retangulo: Float64Array = new Float64Array(4);
  /// right(3), up(3), fwd(3), pos(3) da pose de mundo, recalculados por chamada.
  private base: Float64Array = new Float64Array(12);

  constructor() {
    super();
    this.retangulo[2] = CAMERA_RETANGULO_PADRAO_L;
    this.retangulo[3] = CAMERA_RETANGULO_PADRAO_A;
  }
  kind(): number { return KIND_CAMERA; }
  typeName(): string { return "Camera"; }
  toData(): any { return { type: "camera", fov: this.fov, isMain: this.isMain }; }
  // ── Inspector: só FOV (graus) e Main (caixa) são personalizados; os demais
  // campos seguem os automáticos gerados (não definir fieldCount aqui mantém
  // a geração automática — ver tools/generate-components.mjs).
  fieldType(i: number): string {
    if (i === CAMERA_CAMPO_MAIN) return "boolean";
    return super.fieldType(i);
  }
  fieldGet(i: number): f64 {
    if (i === CAMERA_CAMPO_FOV) return this.fov * GRAUS_POR_RAD;
    return super.fieldGet(i);
  }
  fieldSet(i: number, v: f64): void {
    if (i === CAMERA_CAMPO_FOV) {
      if (v !== v) return;
      this.fov = Math.max(CAMERA_FOV_MIN, Math.min(CAMERA_FOV_MAX, v / GRAUS_POR_RAD));
      this.onValidate("fov");
      return;
    }
    if (i === CAMERA_CAMPO_MAIN) { this.isMain = v !== 0.0 ? 1 : 0; this.onValidate("isMain"); return; }
    super.fieldSet(i, v);
  }
  /// FOV em graus num slider, Principal como caixa, fundo como lista e
  /// "Alinhar com a vista" (pose da câmera do editor, também numa filha).
  onInspectorGUI(ui: InspectorUI): void {
    const graus = this.fov * GRAUS_POR_RAD;
    const novo = ui.slider(ROTULO_FOV, graus, FOV_MIN_GRAUS, FOV_MAX_GRAUS);
    if (novo !== graus) this.fov = novo / GRAUS_POR_RAD;
    this.isMain = ui.toggle(ROTULO_PRINCIPAL, this.isMain !== 0) ? 1 : 0;
    ui.field("ortografica");
    if (this.ortografica) ui.field("tamanhoOrto");
    ui.field("near"); ui.field("far");
    const fundo = Math.max(0, FUNDOS_CAMERA.indexOf(this.fundo));
    const novoFundo = ui.dropdown(ROTULO_FUNDO, FUNDOS_CAMERA, fundo);
    if (novoFundo !== fundo) this.fundo = FUNDOS_CAMERA[novoFundo];
    if (this.fundo === "cor") this.corFundo = ui.color(ROTULO_COR_FUNDO, this.corFundo);
    ui.field("viewportX"); ui.field("viewportY"); ui.field("viewportW"); ui.field("viewportH");
    ui.field("profundidade");
    if (ui.button(ROTULO_ALINHAR)) ui.alinharComVista(this.owner);
  }
  camFov(): f64 { return this.fov; }
  onValidate(field: string): void {
    // `!(v >= min)` também pega NaN (toda comparação com NaN é falsa).
    if (!(this.fov >= CAMERA_FOV_MIN)) this.fov = CAMERA_FOV_MIN;
    if (this.fov > CAMERA_FOV_MAX) this.fov = CAMERA_FOV_MAX;
    if (!(this.near >= CAMERA_NEAR_MIN)) this.near = CAMERA_NEAR_MIN;
    if (!(this.far >= this.near + CAMERA_FAR_FOLGA)) this.far = this.near + CAMERA_FAR_FOLGA;
    if (!(this.tamanhoOrto >= CAMERA_ORTO_MIN)) this.tamanhoOrto = CAMERA_ORTO_MIN;
    if (FUNDOS_CAMERA.indexOf(this.fundo) < 0) this.fundo = "ceu";
    if (this.viewportX !== this.viewportX) this.viewportX = 0.0;
    if (this.viewportY !== this.viewportY) this.viewportY = 0.0;
    if (this.viewportW !== this.viewportW) this.viewportW = 1.0;
    if (this.viewportH !== this.viewportH) this.viewportH = 1.0;
    if (this.profundidade !== this.profundidade) this.profundidade = 0.0;
    this.viewportX = Math.max(0.0, Math.min(1.0 - CAMERA_VIEWPORT_MIN, this.viewportX));
    this.viewportY = Math.max(0.0, Math.min(1.0 - CAMERA_VIEWPORT_MIN, this.viewportY));
    this.viewportW = Math.max(CAMERA_VIEWPORT_MIN, Math.min(1.0 - this.viewportX, this.viewportW));
    this.viewportH = Math.max(CAMERA_VIEWPORT_MIN, Math.min(1.0 - this.viewportY, this.viewportH));
  }
  /// Retângulo em pixels onde esta câmera foi desenhada (a "tela" das APIs de raio).
  definirRetangulo(x: number, y: number, w: number, h: number): void {
    this.retangulo[0] = x; this.retangulo[1] = y; this.retangulo[2] = w; this.retangulo[3] = h;
  }
  retanguloPx(): Float64Array { return this.retangulo; }
  /// Retângulo desta câmera dentro da área `a` = [x, y, w, h] em pixels, pela
  /// viewport — com a mesma faixa do onValidate, para que um campo escrito
  /// direto por script (NaN, w = 0, x + w > 1) não gere uma vista degenerada.
  retanguloNaArea(a: Float64Array): void {
    let vx = this.viewportX === this.viewportX ? this.viewportX : 0.0;
    let vy = this.viewportY === this.viewportY ? this.viewportY : 0.0;
    vx = Math.max(0.0, Math.min(1.0 - CAMERA_VIEWPORT_MIN, vx));
    vy = Math.max(0.0, Math.min(1.0 - CAMERA_VIEWPORT_MIN, vy));
    const vw = Math.max(CAMERA_VIEWPORT_MIN, Math.min(1.0 - vx, this.viewportW === this.viewportW ? this.viewportW : 1.0));
    const vh = Math.max(CAMERA_VIEWPORT_MIN, Math.min(1.0 - vy, this.viewportH === this.viewportH ? this.viewportH : 1.0));
    this.definirRetangulo(a[0] + vx * a[2], a[1] + vy * a[3], vw * a[2], vh * a[3]);
  }
  aspecto(): number { return this.retangulo[3] > 0.0 ? this.retangulo[2] / this.retangulo[3] : 1.0; }
  atualizarBase(): void {
    const t = this.host; const b = this.base;
    const cy = math.cos(t.wry); const sy = math.sin(t.wry);
    const cp = math.cos(t.wrx); const sp = math.sin(t.wrx);
    b[0] = cy; b[1] = 0.0; b[2] = 0.0 - sy;                               // right
    b[3] = (0.0 - sy) * sp; b[4] = cp; b[5] = (0.0 - cy) * sp;             // up
    b[6] = sy * cp; b[7] = sp; b[8] = cy * cp;                            // fwd
    b[9] = t.wx; b[10] = t.wy; b[11] = t.wz;                              // pos
  }
  /// Raio pelo ponto (u, v) do viewport, (0, 0) embaixo à esquerda: out = origem(3), direção(3).
  viewportPointToRay(u: number, v: number, out: Float64Array): void {
    this.atualizarBase();
    const b = this.base;
    const nx = u * 2.0 - 1.0; const ny = v * 2.0 - 1.0;
    const asp = this.aspecto();
    const near = this.nearSeguro();
    if (this.ortografica) {
      const orto = this.ortoSeguro();
      const ox = nx * orto * asp; const oy = ny * orto;
      out[0] = b[9] + b[0] * ox + b[3] * oy + b[6] * near;
      out[1] = b[10] + b[1] * ox + b[4] * oy + b[7] * near;
      out[2] = b[11] + b[2] * ox + b[5] * oy + b[8] * near;
      out[3] = b[6]; out[4] = b[7]; out[5] = b[8];
    } else {
      const tv = math.tan(this.fovSeguro() * 0.5); const th = tv * asp;
      const dx = b[6] + b[0] * (nx * th) + b[3] * (ny * tv);
      const dy = b[7] + b[1] * (nx * th) + b[4] * (ny * tv);
      const dz = b[8] + b[2] * (nx * th) + b[5] * (ny * tv);
      out[0] = b[9] + dx * near; out[1] = b[10] + dy * near; out[2] = b[11] + dz * near;
      const l = math.sqrt(dx * dx + dy * dy + dz * dz);
      out[3] = dx / l; out[4] = dy / l; out[5] = dz / l;
    }
  }
  /// Raio pelo pixel (x, y) da tela (y para baixo), dentro do retângulo desta câmera.
  screenPointToRay(x: number, y: number, out: Float64Array): void {
    const r = this.retangulo;
    const u = r[2] > 0.0 ? (x - r[0]) / r[2] : 0.5;
    const v = r[3] > 0.0 ? 1.0 - (y - r[1]) / r[3] : 0.5;
    this.viewportPointToRay(u, v, out);
  }
  /// Ponto de mundo → out = [x px, y px, profundidade]; devolve 1 se está à frente do near.
  worldToScreenPoint(x: number, y: number, z: number, out: Float64Array): number {
    this.atualizarBase();
    const b = this.base; const r = this.retangulo;
    const dx = x - b[9]; const dy = y - b[10]; const dz = z - b[11];
    const xc = dx * b[0] + dy * b[1] + dz * b[2];
    const yc = dx * b[3] + dy * b[4] + dz * b[5];
    const zc = dx * b[6] + dy * b[7] + dz * b[8];
    const asp = this.aspecto();
    const near = this.nearSeguro();
    let ndx = 0.0; let ndy = 0.0; let frente = 0;
    if (this.ortografica) {
      const orto = this.ortoSeguro();
      ndx = xc / (orto * asp); ndy = yc / orto;
      frente = zc >= near ? 1 : 0;
    } else if (zc > 1e-9) {
      const tv = math.tan(this.fovSeguro() * 0.5);
      ndx = xc / (zc * tv * asp); ndy = yc / (zc * tv);
      frente = zc >= near ? 1 : 0;
    }
    out[0] = r[0] + (ndx * 0.5 + 0.5) * r[2];
    out[1] = r[1] + (0.5 - ndy * 0.5) * r[3];
    out[2] = zc;
    return frente;
  }
  // Leituras defensivas da lente: um valor fora da faixa que não passou pelo
  // onValidate (script que escreve o campo direto) não chega a dividir por zero.
  // `v >= min` é falso para NaN.
  nearSeguro(): number { return this.near >= CAMERA_NEAR_MIN ? this.near : CAMERA_NEAR_MIN; }
  ortoSeguro(): number { return this.tamanhoOrto >= CAMERA_ORTO_MIN ? this.tamanhoOrto : CAMERA_ORTO_MIN; }
  fovSeguro(): number {
    if (!(this.fov >= CAMERA_FOV_MIN)) return CAMERA_FOV_MIN;
    return this.fov <= CAMERA_FOV_MAX ? this.fov : CAMERA_FOV_MAX;
  }
  /// Os 11 números de `setCamBuf`, com o aspecto do retângulo desta câmera.
  parametrosDeRender(out: Float64Array): void {
    const t = this.host;
    out[0] = t.wx; out[1] = t.wy; out[2] = t.wz; out[3] = t.wry; out[4] = t.wrx;
    const near = this.nearSeguro();
    out[5] = this.fovSeguro(); out[6] = this.aspecto(); out[7] = near;
    out[8] = this.far >= near + CAMERA_FAR_FOLGA ? this.far : near + CAMERA_FAR_FOLGA;
    out[9] = this.ortografica ? 1.0 : 0.0; out[10] = this.ortoSeguro();
  }
  static main(): Camera | null { return cameraPrincipal(); }
  /// Câmeras ativas da cena ativa, em ordem de desenho. Devolve SEMPRE o mesmo
  /// array (reusado, sem alocação): a próxima chamada o sobrescreve — copie se
  /// precisar guardar.
  static all(): Camera[] { return todasAsCameras(); }
}

/// Ordem de desenho: menor profundidade antes; no empate, a Main por último (fica por cima).
export function cameraVemAntes(a: Camera, b: Camera): boolean {
  return a.profundidade < b.profundidade || (a.profundidade === b.profundidade && a.isMain === 0 && b.isMain !== 0);
}
/// Ordenação por inserção, estável, sem alocação. `cams` chega na ordem da
/// cena; a principal (a primeira com isMain, senão a primeira — a mesma de
/// `Camera.main()`) vai para o fim do seu grupo de profundidade. Assim uma cena
/// antiga com duas câmeras isMain de tela cheia continua mostrando a imagem da
/// Main, como quando o jogo desenhava só por ela.
export function ordenarCameras(cams: Camera[], n: number): void {
  if (n <= 0) return;
  let principal = cams[0];
  let p = 0;
  while (p < n) { if (cams[p].isMain !== 0) { principal = cams[p]; break; } p = p + 1; }
  let i = 1;
  while (i < n) {
    const c = cams[i];
    let j = i - 1;
    while (j >= 0 && cameraVemAntes(c, cams[j])) { cams[j + 1] = cams[j]; j = j - 1; }
    cams[j + 1] = c;
    i = i + 1;
  }
  let k = 0;
  while (k < n && cams[k] !== principal) k = k + 1;
  while (k + 1 < n && cams[k + 1].profundidade === principal.profundidade) {
    cams[k] = cams[k + 1]; k = k + 1;
  }
  cams[k] = principal;
}
const todas: Camera[] = [];
function cameraPrincipal(): Camera | null {
  const sc = activeScene();
  let achada: Camera | null = null;
  let primeira: Camera | null = null;
  if (sc !== null) {
    const lista: GameObject[] = sc.camObjs;
    let i = 0;
    while (i < lista.length && achada === null) {
      const o = lista[i];
      const c = o.behaviors[o.camIdx] as Camera;
      if (c.enabled !== 0 && activeInScene(sc.objects, o)) {
        if (c.isMain !== 0) achada = c;
        else if (primeira === null) primeira = c;
      }
      i = i + 1;
    }
  }
  return achada !== null ? achada : primeira;
}
function todasAsCameras(): Camera[] {
  todas.length = 0;
  const sc = activeScene();
  if (sc !== null) {
    let i = 0;
    while (i < sc.camObjs.length) {
      const o = sc.camObjs[i];
      const c = o.behaviors[o.camIdx] as Camera;
      if (c.enabled !== 0 && activeInScene(sc.objects, o)) todas.push(c);
      i = i + 1;
    }
  }
  ordenarCameras(todas, todas.length);
  return todas;
}
