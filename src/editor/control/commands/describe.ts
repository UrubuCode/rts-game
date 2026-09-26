// OBSERVAÇÃO pela porta de controle: `describe <obj> [json]` (tudo de um
// objeto) e `scene json [obj]` (o JSON do save, sem salvar). Só consultas: não
// mudam a cena, o documento nem o Desfazer.
//
// Os campos dos componentes vêm da reflexão gerada (fieldCount/fieldName/
// fieldType) e os dados completos de `componentToData`: nada é listado à mão,
// então um componente novo aparece aqui sem mudar este arquivo.
import { scene } from "@editor/control/session";
import { argObj, erroObj } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";
import { caminhoObjeto, filhosObjeto } from "@editor/control/object_ref";
import { objectToData, sceneToJSON } from "@editor/sceneio";
import { componentToData } from "@engine/components";
import { DEG2RAD } from "@editor/bone_gizmo";
import type { Behavior } from "@engine/core/behavior";

/// Casas mantidas ao converter para graus (tira o ruído de 89.99999999).
const ARREDONDA_GRAUS: f64 = 1e6;
const NL: string = "\n";

/// Radianos -> graus, arredondado.
export function graus(rad: f64): f64 {
  return Math.round((rad / DEG2RAD) * ARREDONDA_GRAUS) / ARREDONDA_GRAUS;
}

/// Valor do campo `fi` no tipo do JSON (number, boolean ou string).
export function valorCampo(b: Behavior, fi: number): any {
  const tipo = b.fieldType(fi);
  if (tipo === "string") return b.fieldStringGet(fi);
  if (tipo === "boolean") return b.fieldGet(fi) !== 0;
  return b.fieldGet(fi);
}

/// Um componente: índice, tipo, ativo, dados completos e campos da reflexão.
function componenteParaDados(b: Behavior, ci: number): any {
  const campos: any[] = [];
  let fi = 0;
  while (fi < b.fieldCount()) {
    campos.push({ index: fi, name: b.fieldName(fi), label: b.fieldLabel(fi), type: b.fieldType(fi), value: valorCampo(b, fi) });
    fi = fi + 1;
  }
  return { index: ci, type: b.typeName(), enabled: b.enabled !== 0, data: componentToData(b), fields: campos };
}

/// Tudo sobre o objeto `i` (a forma do `describe <obj> json`).
export function descreverObjeto(i: number): any {
  const o = scene.objects[i];
  const t = o.transform;
  const comps: any[] = [];
  let ci = 0;
  while (ci < o.behaviors.length) { comps.push(componenteParaDados(o.behaviors[ci], ci)); ci = ci + 1; }
  return {
    index: i, id: o.id, name: o.name, path: caminhoObjeto(scene, i),
    active: o.active, stationary: o.stationary, parent: o.parent, children: filhosObjeto(scene, i),
    transform: {
      pos: [t.px, t.py, t.pz],
      rot: { yaw: graus(t.ry), pitch: graus(t.rx), roll: graus(t.rz) },
      /// A ordem dos campos do Inspector: X = pitch, Y = yaw, Z = roll.
      rotInspector: [graus(t.rx), graus(t.ry), graus(t.rz)],
      scale: [t.sx, t.sy, t.sz],
      world: { pos: [t.wx, t.wy, t.wz], yaw: graus(t.wry), pitch: graus(t.wrx) }
    },
    appearance: {
      meshKind: o.meshKind, customMesh: o.customMesh, meshPath: o.meshPath, meshPart: o.meshPart,
      color: [o.cr, o.cg, o.cb], emissive: o.emissive, tex: o.tex, layer: o.layer, mask: o.mask,
      material: o.matIdx, renderer: o.rendIdx
    },
    components: comps
  };
}

function vetor(v: any): string { return "(" + v[0] + "," + v[1] + "," + v[2] + ")"; }

/// O mesmo conteúdo em texto (uma seção por linha).
function descreverTexto(d: any): string {
  const t = d.transform; const a = d.appearance;
  let filhos = "";
  let k = 0;
  while (k < d.children.length) { filhos = filhos + (k > 0 ? "," : "") + "#" + d.children[k]; k = k + 1; }
  let m = "[describe] #" + d.index + " " + d.name + " | caminho=" + d.path + " | id=" + d.id + " ativo=" + d.active +
    " estatico=" + d.stationary + " | pai=" + (d.parent >= 0 ? "#" + d.parent : "raiz") + " filhos=" + (filhos.length > 0 ? filhos : "nenhum");
  m = m + NL + "  transform: pos" + vetor(t.pos) + " rot(yaw=" + t.rot.yaw + " pitch=" + t.rot.pitch + " roll=" + t.rot.roll + ")" +
    " scl" + vetor(t.scale) + " | mundo pos" + vetor(t.world.pos) + " yaw=" + t.world.yaw + " pitch=" + t.world.pitch;
  m = m + NL + "  aparencia: mesh=" + a.meshKind + " custom=" + a.customMesh + " modelo=\"" + a.meshPath + "\" parte=" + a.meshPart +
    " cor" + vetor(a.color) + " emissive=" + a.emissive + " tex=" + a.tex + " layer=" + a.layer;
  let ci = 0;
  while (ci < d.components.length) {
    const c = d.components[ci];
    m = m + NL + "  [" + c.index + "] " + c.type + (c.enabled ? "" : " (desligado)");
    let fi = 0;
    while (fi < c.fields.length) {
      const f = c.fields[fi];
      m = m + " | " + f.index + " " + f.name + ":" + f.type + "=" + (f.type === "string" ? JSON.stringify(f.value) : "" + f.value);
      fi = fi + 1;
    }
    if (c.fields.length === 0) m = m + " dados=" + JSON.stringify(c.data);
    ci = ci + 1;
  }
  return m;
}

/// describe <obj> [json]
export function cmdDescribe(parts: string[]): string {
  if (parts.length < 2) return erroUso("describe");
  const i = argObj(parts, 1);
  if (i < 0) return erroObj(parts, 1);
  const formato = parts.length > 2 ? parts[2] : "";
  if (formato !== "" && formato !== "json") return erroUso("describe");
  const d = descreverObjeto(i);
  if (formato === "json") return "[describe] " + JSON.stringify(d);
  return descreverTexto(d);
}

/// scene json [obj] — o JSON que o save grava (ou um objeto), sem gravar nada.
export function cmdScene(parts: string[]): string {
  if (parts.length < 2 || parts[1] !== "json") return erroUso("scene");
  if (parts.length < 3) return "[scene] " + sceneToJSON();
  const i = argObj(parts, 2);
  if (i < 0) return erroObj(parts, 2);
  return "[scene] " + JSON.stringify(objectToData(scene.objects[i]));
}
