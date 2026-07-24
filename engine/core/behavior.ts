// Engine RTS — Behavior: o "MonoBehaviour". Todo script de gameplay estende
// isto e sobrescreve mount()/update(dt). Rodam num array polimórfico no
// GameObject (dispatch virtual provado no motor).
//
// REGRA: um Behavior só mexe no próprio transform (host). Ele NÃO desenha —
// o render é um passe separado (engine/render/draw.ts), como o Renderer do
// Unity é dirigido pelo motor, não pelo script.

import { Transform } from "./transform";

// TIPOS de component (tag numérica) — o primitivo do modelo uniforme "tudo é
// GameObject + componentes". Systems e o render acham um component por kind()
// (GameObject.componentIdx) sem cast nem parse de string. Novos componentes
// (Renderer, Collider, UI, Light…) entram aqui e plugam da mesma forma.
export const KIND_SCRIPT: number = 0;     // gameplay genérico (default)
export const KIND_MATERIAL: number = 1;   // aparência (textura/cor/emissivo)
export const KIND_RENDERER: number = 2;   // geometria a desenhar (mesh/primitivo)
// reservados p/ as próximas camadas: 3=COLLIDER, 4=UI, 5=LIGHT…

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

  // ── IDENTIDADE do component (modelo uniforme) ───────────────────────────────
  /// O TIPO deste component (uma das consts KIND_*). Systems e o render acham um
  /// component por kind() sem cast. Default = KIND_SCRIPT (gameplay genérico); o
  /// Material devolve KIND_MATERIAL, futuros Renderer/Collider/UI os seus.
  kind(): number { return KIND_SCRIPT; }

  // ── SURFACE DE MATERIAL (lida pelo render via dispatch virtual, sem cast) ────
  // O component Material sobrescreve estes; qualquer outro Behavior devolve os
  // defaults (o render só consulta um component cujo kind()===KIND_MATERIAL).
  /// Id da textura de imagem real (>=2) ou 0 (sem imagem).
  matTexId(): number { return 0; }
  /// 1 = emissivo (não sombreado).
  matEmissive(): number { return 0; }
  /// Modo de textura procedural quando NÃO há imagem: 0=nenhuma, 1=xadrez.
  matTexMode(): number { return 0; }
  /// Aplica uma textura de imagem (id + path) — só o Material implementa; nos
  /// demais é no-op. Chamado pelo asset browser / ws ao aplicar uma textura.
  setMatTexture(id: number, path: string): void {}

  // ── SURFACE DE RENDERER (lida pelo render via dispatch virtual, sem cast) ────
  // O MeshRenderer sobrescreve; os demais devolvem 0 (o render só consulta um
  // component cujo kind()===KIND_RENDERER).
  /// Primitivo a desenhar: 1=cubo, 2=pirâmide, 3=octaedro, 4=esfera (0 = usar mesh).
  rMeshKind(): number { return 0; }
  /// Id de mesh carregada (.obj) — tem prioridade sobre rMeshKind (0 = nenhuma).
  rCustomMesh(): number { return 0; }
}
