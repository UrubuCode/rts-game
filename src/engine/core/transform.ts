// Engine RTS — Transform: posição, rotação (euler, radianos) e escala.
// Campos planos (px..sz) — dispatch provado no motor, evita aninhar Vec3.

export class Transform {
  // ── OS QUINZE PRIMEIROS SÃO OS QUE CABEM NO CAMINHO RÁPIDO ────────────────
  //
  // A ORDEM DESTA DECLARAÇÃO É DESEMPENHO, não estilo. O motor guarda os
  // primeiros `INLINE_SLOTS = 15` campos de um objeto em slots inline, que o
  // código compilado alcança por offset constante; do décimo sexto em diante a
  // leitura cai no caminho dinâmico de propriedade.
  //
  // MEDIDO nesta cena, 8000 objetos: ler um campo de `GameObject` custa 5,6 ns e
  // ler um campo de `Transform` custava ~318 ns — 57×. A causa era esta lista:
  // `wx, wy, wz, wrx, wry` estavam DEPOIS de `mass`, `asleep`, `quiet`,
  // `restitution` e `friction`, e transbordavam. São exatamente os campos que
  // `computeWorld` lê para todo objeto, todo frame.
  //
  // Quem entra aqui é quem é lido em laço sobre a cena inteira. Quem sai é quem
  // é lido por corpo em contato — bem menos frequente. Antes de acrescentar um
  // campo nesta classe, saiba qual dos dois ele é: um campo frio inserido no
  // meio empurra um quente para fora e o custo aparece longe daqui.
  px: f64; py: f64; pz: f64;   // posição local            — computeWorld + update
  rx: f64; ry: f64;            // rotação euler lida no mundo — computeWorld
  wx: f64; wy: f64; wz: f64;   // posição de MUNDO           — computeWorld
  wrx: f64; wry: f64;          // rotação de MUNDO           — computeWorld
  vx: f64; vy: f64; vz: f64;   // velocidade linear          — update
  /// SLEEPING de corpo rígido: `quiet` conta frames quase sem movimento e ao
  /// passar do limiar a colisão marca `asleep = 1`; quem INTEGRA pula o corpo.
  /// Sem isto, 392 blocos empilhados chacoalhavam para sempre. `asleep` fica
  /// entre os quinze porque o laço de colisão o consulta por objeto; `quiet` não
  /// precisa, porque só é tocado por quem já está no caminho lento.
  asleep: number;
  /// Massa para a resposta de impulso. 0 = INFINITA (chão, parede).
  mass: f64;

  // ── DAQUI PARA BAIXO TRANSBORDA, e a escolha é medida ─────────────────────
  //
  // São 17 campos lidos por objeto por frame para 15 slots — cobertor curto, e
  // o que sai é escolhido por medida e não por gosto. A primeira tentativa pôs
  // `sx/sy/sz` dentro e deixou `vx/vy/vz` fora: `computeWorld` caiu 17× e o
  // `update` PIOROU 4× (1,08 para 4,17 ms a 1000 objetos), porque é a
  // velocidade que a integração lê todo frame. Trocado.
  //
  // A escala sai porque quem a lê em volume é o laço de PARES da colisão — e o
  // padrão hoje não é ele: o solver em Rust e a GPU trabalham sobre
  // `Float32Array`, e `collider.ts` resolve a forma uma vez por varredura, não
  // por objeto por frame.
  //
  // `rz` sai porque `computeWorld` não o lê: o mundo herda só `wrx`/`wry`.
  sx: f64; sy: f64; sz: f64;   // escala — por PAR na colisão, não por objeto
  rz: f64;                     // roll — não entra na pose de mundo
  quiet: number;
  /// Restituição (0 = não quica, 1 = elástico) e atrito tangencial. Vivem no
  /// Transform e não no script porque a COLISÃO os lê, e ela roda sobre `trs[]`
  /// sem tocar em behaviors — mas por PAR em contato, não por objeto da cena.
  restitution: f64;
  friction: f64;

  constructor() {
    this.px = 0.0; this.py = 0.0; this.pz = 0.0;
    this.rx = 0.0; this.ry = 0.0; this.rz = 0.0;
    this.sx = 1.0; this.sy = 1.0; this.sz = 1.0;
    this.vx = 0.0;
    this.vy = 0.0;
    this.vz = 0.0;
    this.mass = 1.0;
    this.asleep = 0;
    this.quiet = 0;
    this.restitution = 0.0;
    this.friction = 0.35;
    this.wx = 0.0; this.wy = 0.0; this.wz = 0.0;
    this.wrx = 0.0; this.wry = 0.0;
  }

  setPosition(x: f64, y: f64, z: f64): void {
    this.px = x; this.py = y; this.pz = z;
  }
  setScale(s: f64): void {
    this.sx = s; this.sy = s; this.sz = s;
  }
}
