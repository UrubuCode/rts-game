/** @editorOnly */
// Pacote luz: gizmo da Light (ícone por tipo; seta, esfera de alcance ou cone
// quando selecionada), itens Criar/Luz/* e os comandos `luz` e `luzes`.
import { Editor, registerCommand, registerGizmo, Gizmos } from "@editor/api";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { Light, TIPOS_LUZ, FLOATS_POR_LUZ, LUZ_DIRECIONAL, LUZ_PONTUAL, LUZ_SPOT, LUZ_PADRAO_PITCH, LUZ_PADRAO_YAW } from "@engine/core/light";
import { corHex, lerCorHex } from "@engine/core/cor";

const ICONES_LUZ: string[] = ["luz-direcional", "luz-pontual", "luz-spot"];
const NOMES_LUZ: string[] = ["Luz Direcional", "Luz Pontual", "Luz Spot"];
/// Comprimento da seta da direcional no gizmo, em unidades de mundo.
const SETA_DIRECIONAL: number = 2.0;
/// O spot nasce apontando para baixo.
const PITCH_SPOT: number = 0.0 - 1.5707963267948966;
const pacote = new Float64Array(FLOATS_POR_LUZ);
const p0 = new Float64Array(3); const p1 = new Float64Array(3); const dir = new Float64Array(3);
const ponto = new Float64Array(5);

function desenharLuz(g: Gizmos, dono: GameObject, comp: Behavior): void {
  const luz = comp as Light;
  luz.lightPack(pacote, 0);
  const tipo = pacote[0];
  p0[0] = pacote[1]; p0[1] = pacote[2]; p0[2] = pacote[3];
  dir[0] = pacote[4]; dir[1] = pacote[5]; dir[2] = pacote[6];
  g.color(luz.cor);
  g.icon(ICONES_LUZ[tipo], p0);
  if (g.selecionado) {
    if (tipo === LUZ_DIRECIONAL) {
      p1[0] = p0[0] + dir[0] * SETA_DIRECIONAL; p1[1] = p0[1] + dir[1] * SETA_DIRECIONAL; p1[2] = p0[2] + dir[2] * SETA_DIRECIONAL;
      g.line(p0, p1);
    } else if (tipo === LUZ_PONTUAL) g.wireSphere(p0, luz.alcance);
    else g.wireCone(p0, dir, luz.alcance, luz.anguloSpot);
  }
}
registerGizmo("Light", desenharLuz);

/// Cria a luz na cena do editor, à frente da vista (ou em `pos`, se dado).
function criarLuz(tipo: string, pos: Float64Array | null): GameObject | null {
  const sc = Editor.scene();
  let o: GameObject | null = null;
  const t = TIPOS_LUZ.indexOf(tipo);
  if (sc !== null && t >= 0) {
    o = sc.createGameObject(NOMES_LUZ[t]);
    if (pos === null) { Editor.spawnPoint(ponto); o.transform.setPosition(ponto[0], ponto[1], ponto[2]); }
    else o.transform.setPosition(pos[0], pos[1], pos[2]);
    if (t === LUZ_DIRECIONAL) { o.transform.rx = LUZ_PADRAO_PITCH; o.transform.ry = LUZ_PADRAO_YAW; }
    if (t === LUZ_SPOT) o.transform.rx = PITCH_SPOT;
    const l = new Light(); l.tipo = tipo; o.addBehavior(l);
  }
  return o;
}
export class LuzMenu {
  /** @menuItem Criar/Luz/Direcional */
  static direcional(): void { criarLuz("direcional", null); }
  /** @menuItem Criar/Luz/Pontual */
  static pontual(): void { criarLuz("pontual", null); }
  /** @menuItem Criar/Luz/Spot */
  static spot(): void { criarLuz("spot", null); }
}

function luzDe(indice: string): Light | null {
  const sc = Editor.scene(); const i = parseFloat(indice);
  let l: Light | null = null;
  if (sc !== null && i === Math.floor(i) && i >= 0 && i < sc.objects.length && sc.objects[i].lightIdx >= 0) l = sc.objects[i].behaviors[sc.objects[i].lightIdx] as Light;
  return l;
}
function cmdLuz(p: string[]): string {
  let out = "[erro] uso: luz add <tipo> <x> <y> <z> | luz <obj> set <tipo|cor|intensidade|alcance|angulo|sombra> <valor>";
  if (p.length >= 6 && p[1] === "add") {
    const xyz = new Float64Array(3); xyz[0] = parseFloat(p[3]); xyz[1] = parseFloat(p[4]); xyz[2] = parseFloat(p[5]);
    if (TIPOS_LUZ.indexOf(p[2]) < 0) out = "[erro] tipo de luz: use " + TIPOS_LUZ.join(", ");
    else if (xyz[0] !== xyz[0] || xyz[1] !== xyz[1] || xyz[2] !== xyz[2]) out = "[erro] posição inválida";
    else {
      const o = criarLuz(p[2], xyz);
      const sc = Editor.scene();
      if (o !== null && sc !== null) { const i = sc.objects.length - 1; Editor.select(o); out = "[ok] #" + i + " " + o.name; }
    }
  } else if (p.length >= 5 && p[2] === "set") {
    const l = luzDe(p[1]);
    const v = parseFloat(p[4]);
    if (l === null) out = "[erro] objeto sem Light: " + p[1];
    else if (p[3] === "tipo") { if (TIPOS_LUZ.indexOf(p[4]) < 0) out = "[erro] tipo de luz: use " + TIPOS_LUZ.join(", "); else { l.tipo = p[4]; out = "[ok] tipo=" + l.tipo; } }
    else if (p[3] === "cor") { const c = lerCorHex(p[4]); if (c < 0) out = "[erro] cor: use #RRGGBB"; else { l.cor = c; out = "[ok] cor=" + corHex(c); } }
    else if (v !== v || v < 0.0) out = "[erro] valor numérico >= 0";
    else if (p[3] === "intensidade") { l.intensidade = v; out = "[ok] intensidade=" + v; }
    else if (p[3] === "alcance") { l.alcance = v; out = "[ok] alcance=" + v; }
    else if (p[3] === "angulo") { l.anguloSpot = v; l.onValidate("anguloSpot"); out = "[ok] angulo=" + l.anguloSpot; }
    else if (p[3] === "sombra") { l.sombra = v !== 0.0; out = "[ok] sombra=" + (l.sombra ? 1 : 0); }
    else out = "[erro] campo: tipo, cor, intensidade, alcance, angulo, sombra";
  }
  return out;
}
function cmdLuzes(p: string[]): string {
  const sc = Editor.scene();
  let out = "[luzes]";
  if (sc !== null) {
    let i = 0;
    while (i < sc.objects.length) {
      const o = sc.objects[i];
      if (o.lightIdx >= 0) {
        const l = o.behaviors[o.lightIdx] as Light;
        out = out + " | #" + i + " " + o.name + " tipo=" + l.tipo + " cor=" + corHex(l.cor) + " int=" + l.intensidade +
          " alc=" + l.alcance + " ang=" + l.anguloSpot + " sombra=" + (l.sombra ? 1 : 0) + (o.active !== 0 ? "" : " (inativa)");
      }
      i = i + 1;
    }
  }
  return out;
}
registerCommand("luz", "luz add <tipo> <x> <y> <z> | luz <obj> set <campo> <valor> :: cria uma luz ou muda um campo (cor em #RRGGBB, ângulo do spot em graus) :: luz add pontual 0 3 0", true, cmdLuz);
registerCommand("luzes", "luzes :: lista as luzes da cena (tipo, cor, intensidade, alcance, ângulo, sombra) :: luzes", false, cmdLuzes);
