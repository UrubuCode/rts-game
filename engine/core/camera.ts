// Engine RTS — Camera: posição + orientação (yaw/pitch) + FOV. É só estado;
// a projeção/desenho vive em engine/render/draw.ts (funções puras sobre
// primitivos, pra despachar bem no motor no render pass).

export class Camera {
  px: f64; py: f64; pz: f64;
  yaw: f64; pitch: f64;
  fov: f64;

  constructor() {
    this.px = 0.0; this.py = 2.0; this.pz = -8.0;
    this.yaw = 0.0; this.pitch = 0.0;
    this.fov = 1.05;   // ~60°
  }
}
