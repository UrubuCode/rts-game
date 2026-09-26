// Comandos de CONTROLE de componentes (via WebSocket) — a LLM lista/adiciona/
// remove componentes e edita os campos de config, igual ao inspector faz.
import { scene } from "../session";
import { COMPONENT_NAMES, createComponent } from "@editor/components";
import { argInt, argObj, erroObj } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";

/// comps <objIdx> — lista os componentes do objeto + campos e valores.
export function cmdComps(parts: string[]): string {
  const oi = argObj(parts, 1);
  if (oi < 0) return parts.length < 2 ? erroUso("comps") : erroObj(parts, 1);
  const o = scene.objects[oi];
  let m = "[comps] #" + oi + " " + o.name + " (" + o.behaviors.length + ")";
  let bc = 0;
  while (bc < o.behaviors.length) {
    m = m + " | [" + bc + "] " + o.behaviors[bc].typeName();
    let fi = 0;
    while (fi < o.behaviors[bc].fieldCount()) {
      const component = o.behaviors[bc];
      const value = component.fieldType(fi) === "string" ? component.fieldStringGet(fi) : "" + component.fieldGet(fi);
      m = m + " " + component.fieldLabel(fi) + "=" + value;
      fi = fi + 1;
    }
    bc = bc + 1;
  }
  return m;
}

/// complist — nomes dos componentes que dá pra adicionar.
export function cmdCompList(): string {
  let m = "[componentes]";
  let i = 0;
  while (i < COMPONENT_NAMES.length) { m = m + " " + COMPONENT_NAMES[i]; i = i + 1; }
  return m;
}

/// addcomp <objIdx> <nome> — anexa um componente ao objeto.
export function cmdAddComp(parts: string[]): string {
  if (parts.length < 3) return erroUso("addcomp");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  if (COMPONENT_NAMES.indexOf(parts[2]) < 0) return "[erro] componente nao registrado: " + parts[2] + " (veja complist)";
  const o = scene.objects[oi];
  const component = createComponent(parts[2]);
  o.addBehavior(component); component.mount();
  // Um corpo com Rigidbody NÃO é estático: `spawn` marca `stationary = 1` (para
  // a posição pedida grudar), mas a colisão pula estáticos — o objeto caía
  // atravessando o chão porque nunca era testado. Anexar física desfaz a marca.
  if (component.bodyIntegrates() !== 0) {
    o.stationary = 0;
    o.refreshCollide();
    // o corpo muda de LISTA na colisão (estáticos vivem fora do grid): sem
    // recoletar, ele continuaria na lista de estáticos e cairia pelo chão
    scene.markStaticDirty();
  }
  scene.markCollidersDirty();
  return "[ok] addcomp " + parts[2] + " -> #" + oi;
}

/// rmcomp <objIdx> <compIdx> — remove o componente.
export function cmdRmComp(parts: string[]): string {
  if (parts.length < 3) return erroUso("rmcomp");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  const ci = argInt(parts, 2);
  if (!(ci >= 0 && ci < scene.objects[oi].behaviors.length)) return "[erro] componente invalido: '" + parts[2] + "' (#" + oi + " tem " + scene.objects[oi].behaviors.length + ")";
  scene.objects[oi].removeBehavior(ci);
  scene.markCollidersDirty();
  return "[ok] rmcomp #" + oi + "[" + ci + "]";
}

/// setfield <objIdx> <compIdx> <fieldIdx> <valor> — edita um campo de config.
export function cmdSetField(parts: string[]): string {
  if (parts.length < 5) return erroUso("setfield");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  const o = scene.objects[oi];
  const ci = argInt(parts, 2);
  if (!(ci >= 0 && ci < o.behaviors.length)) return "[erro] componente invalido: '" + parts[2] + "' (#" + oi + " tem " + o.behaviors.length + ")";
  const component = o.behaviors[ci];
  const fi = argInt(parts, 3);
  if (!(fi >= 0 && fi < component.fieldCount())) return "[erro] campo invalido: '" + parts[3] + "' (" + component.typeName() + " tem " + component.fieldCount() + ")";
  if (component.fieldType(fi) === "string") {
    const value = parts.slice(4).join(" ");
    component.fieldStringSet(fi, value);
    return "[ok] setfield texto = " + value;
  }
  const val = parts[4] === "true" ? 1 : parts[4] === "false" ? 0 : parseFloat(parts[4]);
  if (val !== val || val <= -1e30 || val >= 1e30) return "[erro] valor numerico invalido";
  component.fieldSet(fi, val); scene.markCollidersDirty();
  return "[ok] setfield #" + oi + "[" + ci + "]." + fi + " = " + component.fieldGet(fi);
}
