// Engine RTS — Transform: posição, rotação (euler, radianos) e escala.
// Campos planos (px..sz) — dispatch provado no motor, evita aninhar Vec3.

export class Transform {
  px: f64; py: f64; pz: f64;   // posição no mundo
  rx: f64; ry: f64; rz: f64;   // rotação euler (rad)
  sx: f64; sy: f64; sz: f64;   // escala
  vy: f64;                     // velocidade vertical (física: Rigidbody + colisão)
  wx: f64; wy: f64; wz: f64;   // posição de MUNDO (computada por Scene.computeWorld)
  wrx: f64; wry: f64;          // rotação de MUNDO (herdada do pai)

  constructor() {
    this.px = 0.0; this.py = 0.0; this.pz = 0.0;
    this.rx = 0.0; this.ry = 0.0; this.rz = 0.0;
    this.sx = 1.0; this.sy = 1.0; this.sz = 1.0;
    this.vy = 0.0;
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
