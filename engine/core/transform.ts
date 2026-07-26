// Engine RTS — Transform: posição, rotação (euler, radianos) e escala.
// Campos planos (px..sz) — dispatch provado no motor, evita aninhar Vec3.

export class Transform {
  px: f64; py: f64; pz: f64;   // posição no mundo
  rx: f64; ry: f64; rz: f64;   // rotação euler (rad)
  sx: f64; sy: f64; sz: f64;   // escala
  /// Velocidade LINEAR nos três eixos. Antes só existia `vy`: sem `vx`/`vz` não
  /// há momento horizontal, então dois corpos que se chocam nunca trocam
  /// impulso — a colisão só os separava e eles paravam. Com os três eixos a
  /// resposta dinâmica (bater, deslizar, ricochetear) passa a ser possível.
  vx: f64;
  vy: f64;
  vz: f64;
  /// Massa para a resposta de impulso. 0 = INFINITA (corpo imóvel: chão, parede).
  /// Um corpo leve batendo num pesado é rebatido; o inverso mal o move.
  mass: f64;
  /// SLEEPING de corpo rígido. `quiet` conta frames quase sem movimento; ao
  /// passar do limiar a colisão marca `asleep = 1` e quem INTEGRA (Rigidbody,
  /// demos) deve pular o corpo — é o contrato que tira um castelo em repouso do
  /// caminho quente. A colisão ACORDA o corpo quando um contato de verdade
  /// chega (ver `solvePair`). Sem isto, 392 blocos empilhados chacoalhavam para
  /// sempre: a gravidade os afundava 2 mm no apoio, o impulso devolvia com
  /// quique, e o passe inteiro rodava todo frame — o fps despencava.
  asleep: number;
  quiet: number;
  /// Restituição (0 = não quica, 1 = elástico) e atrito tangencial (0 = gelo,
  /// 1 = trava). Vivem no Transform e não no script porque a COLISÃO os lê, e
  /// ela roda sobre `trs[]` sem tocar em behaviors.
  restitution: f64;
  friction: f64;
  wx: f64; wy: f64; wz: f64;   // posição de MUNDO (computada por Scene.computeWorld)
  wrx: f64; wry: f64;          // rotação de MUNDO (herdada do pai)

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
