// Componente MATERIAL FÍSICO: define de que a superfície é feita.
//
// Antes, massa/restituição/atrito eram campos soltos do Transform, com defaults
// arbitrários (`mass = 1`, `friction = 0.35`) que TODO objeto carregava —
// inclusive uma parede sem física nenhuma. Transform é ONDE o objeto está;
// de que ele é feito é outra coisa, e pertence a um componente.
//
// Aqui há PRESETS nomeados. O ganho não é escrever menos: é que "gelo" e
// "borracha" são conceitos que o usuário tem na cabeça, enquanto
// `friction = 0.05, restitution = 0.1` são dois números que ele teria de
// descobrir por tentativa.
//
// Uso: anexe ao objeto e escolha o preset (ou ajuste os campos à mão).
//   obj.addBehavior(new PhysicsMaterial(MAT_RUBBER));

import { Behavior } from "../engine/core/behavior";

/// Presets. Os valores vêm da faixa usual em engines de jogo — não são medidas
/// físicas reais (borracha de verdade tem restituição ~0,8 contra aço, mas num
/// jogo isso parece morto; 0,85 "sente" como borracha).
export const MAT_DEFAULT = 0;
export const MAT_WOOD = 1;
export const MAT_METAL = 2;
export const MAT_RUBBER = 3;
export const MAT_ICE = 4;
export const MAT_STONE = 5;
/// Densidade em unidades arbitrárias por volume — a massa sai dela vezes o
/// volume do objeto, para uma caixa grande de pedra pesar mais que uma pequena.
/// É o que evita ter de ajustar massa a mão em cada objeto.
function presetDensity(p: number): f64 {
  if (p === MAT_WOOD) return 0.6;
  if (p === MAT_METAL) return 7.8;
  if (p === MAT_RUBBER) return 1.2;
  if (p === MAT_ICE) return 0.9;
  if (p === MAT_STONE) return 2.6;
  return 1.0;
}
function presetRestitution(p: number): f64 {
  if (p === MAT_WOOD) return 0.25;
  if (p === MAT_METAL) return 0.35;
  if (p === MAT_RUBBER) return 0.85;
  if (p === MAT_ICE) return 0.1;
  if (p === MAT_STONE) return 0.15;
  return 0.2;
}
function presetFriction(p: number): f64 {
  if (p === MAT_WOOD) return 0.5;
  if (p === MAT_METAL) return 0.3;
  if (p === MAT_RUBBER) return 0.9;
  if (p === MAT_ICE) return 0.05;
  if (p === MAT_STONE) return 0.7;
  return 0.35;
}

export class PhysicsMaterial extends Behavior {
  preset: f64;
  density: f64;
  restitution: f64;
  friction: f64;

  constructor(preset: number) {
    super();
    this.preset = preset * 1.0;
    this.density = presetDensity(preset);
    this.restitution = presetRestitution(preset);
    this.friction = presetFriction(preset);
  }

  /// Aplica ao Transform, que é o que a colisão lê (ela percorre `trs[]` sem
  /// tocar em behaviors — pôr o material lá custaria uma busca por componente
  /// em cada par testado, no laço mais quente do motor).
  ///
  /// A MASSA sai de densidade × volume: uma caixa de pedra 4x4x4 pesa 64x uma
  /// de 1x1x1, sem o usuário calcular nada.
  apply(): void {
    const t = this.host;
    const vol = t.sx * t.sy * t.sz;
    t.mass = this.density * vol;
    t.restitution = this.restitution;
    t.friction = this.friction;
  }

  mount(): void { this.apply(); }

  update(dt: f64): void {
    // Reaplica todo frame porque a MASSA depende da escala, e escalar um objeto
    // pelo gizmo tem de mudar o peso dele. É barato: três multiplicações.
    this.apply();
  }

  /// Troca para outro preset (recarrega os três valores).
  setPreset(p: number): void {
    this.preset = p * 1.0;
    this.density = presetDensity(p);
    this.restitution = presetRestitution(p);
    this.friction = presetFriction(p);
    this.apply();
  }

  toData(): any {
    return { type: "physicsmaterial", preset: this.preset, density: this.density,
             restitution: this.restitution, friction: this.friction };
  }

  typeName(): string { return "PhysicsMaterial"; }
  fieldCount(): number { return 4; }
  fieldLabel(i: number): string {
    if (i === 0) return "Preset";
    if (i === 1) return "Dens";
    if (i === 2) return "Quique";
    return "Atrito";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.preset;
    if (i === 1) return this.density;
    if (i === 2) return this.restitution;
    return this.friction;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) { this.setPreset(v | 0); return; }
    if (i === 1) this.density = v;
    else if (i === 2) this.restitution = v;
    else this.friction = v;
    this.apply();
  }
}
