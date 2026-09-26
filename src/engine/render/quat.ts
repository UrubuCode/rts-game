// Quaternions [x, y, z, w] em Float64Array, sem alocação: toda saída vai num
// buffer do chamador. Convenção do renderer: yaw em Y leva o eixo Z local a
// (sin yaw, 0, cos yaw); pitch > 0 olha para cima.
export function quatIdentity(out: Float64Array): void { out[0] = 0.0; out[1] = 0.0; out[2] = 0.0; out[3] = 1.0; }

/// out = a * b (aplica b, depois a). `out` pode ser `a` ou `b`.
export function quatMulInto(out: Float64Array, a: Float64Array, b: Float64Array): void {
  const ax = a[0]; const ay = a[1]; const az = a[2]; const aw = a[3];
  const bx = b[0]; const by = b[1]; const bz = b[2]; const bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/// out = q · v · q⁻¹ (q unitário). `out` pode ser `v`.
export function quatRotateInto(out: Float64Array, q: Float64Array, v: Float64Array): void {
  const x = q[0]; const y = q[1]; const z = q[2]; const w = q[3];
  const vx = v[0]; const vy = v[1]; const vz = v[2];
  const tx = 2.0 * (y * vz - z * vy); const ty = 2.0 * (z * vx - x * vz); const tz = 2.0 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
}

/// Interpolação normalizada pelo caminho curto.
export function quatNlerpInto(out: Float64Array, a: Float64Array, b: Float64Array, t: f64): void {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s: f64 = dot < 0.0 ? 0.0 - 1.0 : 1.0;
  const u = 1.0 - t;
  let x = a[0] * u + b[0] * s * t; let y = a[1] * u + b[1] * s * t;
  let z = a[2] * u + b[2] * s * t; let w = a[3] * u + b[3] * s * t;
  const n = Math.sqrt(x * x + y * y + z * z + w * w);
  if (n > 1e-12) { x = x / n; y = y / n; z = z / n; w = w / n; } else { x = 0.0; y = 0.0; z = 0.0; w = 1.0; }
  out[0] = x; out[1] = y; out[2] = z; out[3] = w;
}

/// yaw em Y e depois pitch em X LOCAL (a câmera do renderer).
export function quatFromYawPitchInto(out: Float64Array, yaw: f64, pitch: f64): void {
  const hy = yaw * 0.5; const hp = (0.0 - pitch) * 0.5;   // pitch>0 levanta Z: gira -pitch em X
  const cy = Math.cos(hy); const sy = Math.sin(hy); const cp = Math.cos(hp); const sp = Math.sin(hp);
  // q = qYaw * qPitch
  out[0] = cy * sp; out[1] = sy * cp; out[2] = 0.0 - sy * sp; out[3] = cy * cp;
}
