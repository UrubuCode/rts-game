// Comandos de CONTROLE de componentes (via WebSocket) — a LLM lista/adiciona/
// remove componentes e edita os campos de config, igual ao inspector faz.
import { scene } from "../session";
import { COMPONENT_NAMES, createComponent } from "../../components";

/// comps <objIdx> — lista os componentes do objeto + campos e valores.
export function cmdComps(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  if (oi < 0 || oi >= scene.objects.length) return "[erro] objeto invalido";
  const o = scene.objects[oi];
  let m = "[comps] #" + oi + " " + o.name + " (" + o.behaviors.length + ")";
  let bc = 0;
  while (bc < o.behaviors.length) {
    m = m + " | [" + bc + "] " + o.behaviors[bc].typeName();
    let fi = 0;
    while (fi < o.behaviors[bc].fieldCount()) {
      m = m + " " + o.behaviors[bc].fieldLabel(fi) + "=" + o.behaviors[bc].fieldGet(fi);
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
  const oi = parseFloat(parts[1]) | 0;
  if (oi < 0 || oi >= scene.objects.length) return "[erro] objeto invalido";
  const o = scene.objects[oi];
  o.addBehavior(createComponent(parts[2]));
  // Um corpo com Rigidbody NÃO é estático: `spawn` marca `stationary = 1` (para
  // a posição pedida grudar), mas a colisão pula estáticos — o objeto caía
  // atravessando o chão porque nunca era testado. Anexar física desfaz a marca.
  if (parts[2] === "Rigidbody") { o.stationary = 0; o.refreshCollide(); }
  return "[ok] addcomp " + parts[2] + " -> #" + oi;
}

/// rmcomp <objIdx> <compIdx> — remove o componente.
export function cmdRmComp(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const ci = parseFloat(parts[2]) | 0;
  if (oi < 0 || oi >= scene.objects.length) return "[erro] objeto invalido";
  scene.objects[oi].removeBehavior(ci);
  return "[ok] rmcomp #" + oi + "[" + ci + "]";
}

/// setfield <objIdx> <compIdx> <fieldIdx> <valor> — edita um campo de config.
export function cmdSetField(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const ci = parseFloat(parts[2]) | 0;
  const fi = parseFloat(parts[3]) | 0;
  const val = parseFloat(parts[4]);
  if (oi < 0 || oi >= scene.objects.length) return "[erro] objeto invalido";
  const o = scene.objects[oi];
  if (ci < 0 || ci >= o.behaviors.length) return "[erro] componente invalido";
  o.behaviors[ci].fieldSet(fi, val);
  return "[ok] setfield #" + oi + "[" + ci + "]." + fi + " = " + val;
}
