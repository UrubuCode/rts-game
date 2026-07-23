// Engine RTS — Behavior: o "MonoBehaviour". Todo script de gameplay estende
// isto e sobrescreve mount()/update(dt). Rodam num array polimórfico no
// GameObject (dispatch virtual provado no motor).
//
// REGRA: um Behavior só mexe no próprio transform (host). Ele NÃO desenha —
// o render é um passe separado (engine/render/draw.ts), como o Renderer do
// Unity é dirigido pelo motor, não pelo script.

import { Transform } from "./transform";

export class Behavior {
  host: Transform;   // transform do GameObject dono (setado no attach)
  enabled: number;

  constructor() {
    this.host = new Transform();
    this.enabled = 1;
  }

  /// Liga o script ao transform do GameObject dono.
  attach(t: Transform): void {
    this.host = t;
  }

  /// Chamado uma vez quando o objeto entra na cena (Awake/Start do Unity).
  mount(): void {}
  /// Chamado todo frame com o delta em SEGUNDOS.
  update(dt: f64): void {}

  /// Devolve os dados do script como objeto simples (pra JSON.stringify da cena).
  /// `null` = não serializa. Subclasses sobrescrevem (o componente se descreve
  /// sozinho); o objeto é o que vai pro array `scripts` da cena.
  toData(): any {
    return null;
  }

  // ── SURFACE DE CONFIG (Inspector estilo Unity) ──────────────────────────────
  // O componente se autodescreve: nome + campos numéricos editáveis. O inspector
  // itera fieldCount() e desenha um numField por campo, lendo fieldGet/fieldSet.
  /// Nome do componente exibido no cabeçalho do inspector.
  typeName(): string { return "Script"; }
  /// Quantos campos numéricos editáveis este componente expõe.
  fieldCount(): number { return 0; }
  /// Rótulo curto do campo `i` (ex.: "SpdY").
  fieldLabel(i: number): string { return ""; }
  /// Valor atual do campo `i`.
  fieldGet(i: number): f64 { return 0.0; }
  /// Grava `v` no campo `i` (chamado pelo inspector ao arrastar/editar).
  fieldSet(i: number, v: f64): void {}
}
