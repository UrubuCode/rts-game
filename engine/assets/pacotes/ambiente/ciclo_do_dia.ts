// Pacote ambiente: CicloDoDia gira a luz do sol (elevação e azimute) e
// interpola as cores do céu entre noite e dia. Roda no jogo.
import math from "@compat/math.ts";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { LUZ_DIRECIONAL } from "@engine/core/light";
import { Ambiente } from "@engine/core/ambiente";
import { activeScene } from "@engine/core/active_scene";

export const ELEVACAO_MAX: number = 1.3962634015954636;   // 80°
export const HORAS_DIA: number = 24.0;
const HORA_NASCENTE: number = 6.0;
const MEIO_DIA_EM_HORAS: number = 12.0;
const DOIS_PI: number = 6.283185307179586;
/// Duração mínima de um dia (s): evita divisão por zero no avanço da hora.
const DURACAO_MIN: number = 0.001;
export const DIA_TOPO: number[] = [0.25, 0.45, 0.80];
export const DIA_HORIZONTE: number[] = [0.70, 0.80, 0.90];
export const NOITE_TOPO: number[] = [0.01, 0.015, 0.05];
export const NOITE_HORIZONTE: number[] = [0.05, 0.05, 0.10];

export function avancarHora(hora: number, dt: number, duracao: number): number {
  const h = hora + dt * HORAS_DIA / (duracao > DURACAO_MIN ? duracao : DURACAO_MIN);
  return h - Math.floor(h / HORAS_DIA) * HORAS_DIA;
}
/// out = [pitch da luz (negativo = aponta para baixo), azimute, fator de dia 0..1].
export function cicloSol(hora: number, out: Float64Array): void {
  const s = math.sin((hora - HORA_NASCENTE) / MEIO_DIA_EM_HORAS * Math.PI);
  out[0] = 0.0 - s * ELEVACAO_MAX;
  out[1] = hora / HORAS_DIA * DOIS_PI;
  out[2] = Math.max(0.0, Math.min(1.0, s));
}
export function corDoCeu(a: Ambiente, fator: number): void {
  let k = 0;
  while (k < 3) {
    a.ceu.topo[k] = NOITE_TOPO[k] + (DIA_TOPO[k] - NOITE_TOPO[k]) * fator;
    a.ceu.horizonte[k] = NOITE_HORIZONTE[k] + (DIA_HORIZONTE[k] - NOITE_HORIZONTE[k]) * fator;
    k = k + 1;
  }
}
/**
 * @componentCategory Renderização
 * @componentDescription Gira o sol e interpola as cores do céu ao longo do dia.
 * @componentKeywords dia noite sol ciclo ambiente céu
 */
export class CicloDoDia extends Behavior {
  /**
   * Segundos de jogo por dia.
   * @range 1 86400
   */
  duracao: number = 120.0;
  /** @range 0 24 */
  hora: number = 8.0;
  /** Nome do objeto com a Light direcional; vazio = o "sol" do Ambiente ou a primeira direcional. */
  sol: string = "";
  private pose: Float64Array = new Float64Array(3);
  constructor() { super(); }
  update(dt: f64): void {
    this.hora = avancarHora(this.hora, dt, this.duracao);
    cicloSol(this.hora, this.pose);
    const sc = activeScene();
    if (sc === null) return;
    const nome = this.sol.length > 0 ? this.sol : sc.ambiente.sol;
    let alvo: GameObject | null = null;
    let i = 0;
    while (i < sc.lightObjs.length && alvo === null) {
      const o = sc.lightObjs[i];
      if (o.behaviors[o.lightIdx].lightType() === LUZ_DIRECIONAL && (nome.length === 0 || o.name === nome)) alvo = o;
      i = i + 1;
    }
    if (alvo !== null) { alvo.transform.rx = this.pose[0]; alvo.transform.ry = this.pose[1]; }
    corDoCeu(sc.ambiente, this.pose[2]);
  }
}
