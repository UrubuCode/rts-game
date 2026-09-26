// Comandos de CONTROLE do Animator (via WebSocket) — o mesmo que o Inspector
// faz na seção "Animator", em texto: trocar o controlador, mexer em
// parâmetros, disparar triggers e ler estado/parâmetros.
//
//   animator <obj> load <arquivo>        troca o controlador (campo salvo: undo)
//   animator <obj> set <param> <valor>   float = número; bool = true/false/1/0
//   animator <obj> trigger <param>       arma o trigger
//   animator <obj> state                 estado atual por camada (+ tempo, fade, erro)
//   animator <obj> params                parâmetros (nome, tipo, valor)
//
// Parâmetros e estados são estado de EXECUÇÃO (não vão para a cena), então
// `set`/`trigger`/`state`/`params` não empilham undo. `load` empilha 1
// snapshot aqui mesmo, e só depois de validar o arquivo e só se o caminho
// mudar (o dispatch não tira o snapshot genérico de `animator`). Fora do Play, `set`/`trigger` começam a prévia do Animator
// (skeleton_preview.ts): ele avança só na pose de trabalho até a prévia acabar.
import { argObj, erroObj } from "@editor/control/args";
import { scene } from "../session";
import type { GameObject } from "@engine/core/gameobject";
import type { Animator } from "@engine/core/animator";
import { PARAM_FLOAT, PARAM_BOOL, PARAM_TRIGGER, reloadAnimatorController } from "@engine/core/animator_controller";
import { history } from "../../undo";
import { animatorOfObject, animatorPreviewTouch, animatorPreviewIsActive } from "../../skeleton_preview";

function objOrNull(oi: number): GameObject | null {
  if (oi < 0 || oi >= scene.objects.length) return null;
  return scene.objects[oi];
}

/// Nome do tipo do parâmetro, como no controlador.
export function animatorParamTypeName(t: number): string {
  if (t === PARAM_FLOAT) return "float";
  if (t === PARAM_BOOL) return "bool";
  if (t === PARAM_TRIGGER) return "trigger";
  return "?";
}

/// Valor do parâmetro `i` em texto (float com 2 casas, bool, trigger armado).
export function animatorParamText(an: Animator, i: number): string {
  const t = an.paramType(i); const v = an.paramValue(i);
  if (t === PARAM_FLOAT) return v.toFixed(2);
  if (t === PARAM_BOOL) return v !== 0.0 ? "true" : "false";
  return v !== 0.0 ? "armado" : "desarmado";
}

export function cmdAnimator(parts: string[]): string {
  const oi = argObj(parts, 1);
  const o = objOrNull(oi);
  if (o === null) return erroObj(parts, 1);
  const an = animatorOfObject(o);
  if (an === null) return "[erro] objeto sem Animator";
  const sub = parts[2];
  if (sub === "load") {
    const path = parts[3];
    if (path === undefined || path === "") return "[erro] load precisa do caminho do .controller.json";
    // relê o arquivo ANTES de mexer no componente: arquivo com erro
    // (inexistente, JSON, nomes) não muda nada nem empilha undo
    const lido = reloadAnimatorController(path);
    if (lido.error !== "") return "[erro] controlador nao carregou: " + lido.error;
    // o campo salvo só muda se o caminho for outro: só aí 1 snapshot (antes)
    if (path !== an.controller) history.snapshot();
    an.controller = path;
    an.onValidate("controller");   // usa o controlador recém-relido (cache)
    // controlador válido que não liga AO OBJETO (sem Skeleton, clipe que o
    // modelo não tem) fica escolhido — o autor pode pôr o Skeleton depois
    const aviso = an.errorText();
    if (aviso !== "") return "[ok] animator load " + path + " -> #" + oi + " (aviso: inerte ate corrigir: " + aviso + ")";
    return "[ok] animator load " + path + " -> #" + oi;
  }
  if (sub === "set") {
    const nome = parts[3]; const valor = parts[4];
    if (nome === undefined || nome === "" || valor === undefined || valor === "") return "[erro] set precisa de <param> <valor>";
    const i = an.paramIndex(nome);
    if (i < 0) return "[erro] parametro inexistente: " + nome + (an.errorText() !== "" ? " (" + an.errorText() + ")" : "");
    const t = an.paramType(i);
    if (t === PARAM_FLOAT) {
      const v = parseFloat(valor);
      if (v !== v) return "[erro] " + nome + " e float: valor numerico";
      an.setFloatAt(i, v);
    } else if (t === PARAM_BOOL) {
      if (valor !== "true" && valor !== "false" && valor !== "1" && valor !== "0") return "[erro] " + nome + " e bool: use true/false";
      an.setBoolAt(i, valor === "true" || valor === "1");
    } else return "[erro] " + nome + " e trigger: use animator " + oi + " trigger " + nome;
    animatorPreviewTouch(an);
    return "[ok] animator set " + nome + " " + animatorParamText(an, i) + " #" + oi;
  }
  if (sub === "trigger") {
    const nome = parts[3];
    if (nome === undefined || nome === "") return "[erro] trigger precisa do nome do parametro";
    const i = an.paramIndex(nome);
    if (i < 0) return "[erro] parametro inexistente: " + nome;
    if (an.paramType(i) !== PARAM_TRIGGER) return "[erro] " + nome + " nao e trigger";
    an.setTriggerAt(i);
    animatorPreviewTouch(an);
    return "[ok] animator trigger " + nome + " #" + oi;
  }
  if (sub === "state") {
    let m = "[animator] #" + oi + " controller=" + an.controller;
    const err = an.errorText();
    if (err !== "") return m + " erro=" + err;
    m = m + " previa=" + (animatorPreviewIsActive(an) ? "sim" : "nao");
    let l = 0;
    while (l < an.layerCount()) {
      m = m + " | " + an.layerName(l) + ": " + an.stateName(l) + " t=" + an.stateTime(l).toFixed(2);
      const from = an.fadingFrom(l);
      if (from !== "") m = m + " (fade de " + from + " " + Math.round(an.fadeProgress(l) * 100.0) + "%)";
      l = l + 1;
    }
    return m;
  }
  if (sub === "params") {
    const n = an.paramCount();
    const err = an.errorText();
    let m = "[params] #" + oi + " " + n;
    let i = 0;
    while (i < n) {
      m = m + " | " + an.paramName(i) + " " + animatorParamTypeName(an.paramType(i)) + " " + animatorParamText(an, i);
      i = i + 1;
    }
    if (err !== "") m = m + " erro=" + err;
    return m;
  }
  return "[erro] subcomando invalido (use load, set, trigger, state ou params): " + sub;
}
