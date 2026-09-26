import io from "@compat/io.ts";
import { quatMulInto, quatRotateInto, quatNlerpInto, quatFromYawPitchInto, quatIdentity } from "@engine/render/quat";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64): boolean { return Math.abs(a - b) < 1e-9; }
const q = new Float64Array(4); const r = new Float64Array(4); const o = new Float64Array(4);
const v = new Float64Array(3); const w = new Float64Array(3);
quatIdentity(q); v[0] = 1; v[1] = 2; v[2] = 3; quatRotateInto(w, q, v);
check(perto(w[0], 1) && perto(w[1], 2) && perto(w[2], 3), "identidade nao gira");
// yaw 90: eixo local Z (0,0,1) vai para (1,0,0) na convencao do renderer (fwd = (sin yaw, 0, cos yaw))
quatFromYawPitchInto(q, Math.PI / 2, 0.0); v[0] = 0; v[1] = 0; v[2] = 1; quatRotateInto(w, q, v);
check(perto(w[0], 1) && perto(w[1], 0) && perto(w[2], 0), "yaw 90 leva Z a X: " + w[0] + "," + w[1] + "," + w[2]);
// pitch positivo olha para cima: Z vai para (0, sin p, cos p)
quatFromYawPitchInto(q, 0.0, 0.3); quatRotateInto(w, q, v);
check(perto(w[1], Math.sin(0.3)) && perto(w[2], Math.cos(0.3)), "pitch 0.3 levanta Z");
// composicao: yaw(a) * yaw(b) = yaw(a+b)
quatFromYawPitchInto(q, 0.4, 0.0); quatFromYawPitchInto(r, 0.5, 0.0); quatMulInto(o, q, r);
quatFromYawPitchInto(q, 0.9, 0.0);
check(perto(o[0], q[0]) && perto(o[1], q[1]) && perto(o[2], q[2]) && perto(o[3], q[3]), "composicao de yaws");
// nlerp: extremos e meio
quatFromYawPitchInto(q, 0.0, 0.0); quatFromYawPitchInto(r, 1.0, 0.0);
quatNlerpInto(o, q, r, 0.0); check(perto(o[1], q[1]) && perto(o[3], q[3]), "nlerp t=0");
quatNlerpInto(o, q, r, 1.0); check(perto(o[1], r[1]) && perto(o[3], r[3]), "nlerp t=1");
quatNlerpInto(o, q, r, 0.5); quatFromYawPitchInto(q, 0.5, 0.0);
check(perto(o[1], q[1]) && perto(o[3], q[3]), "nlerp t=0.5 = yaw 0.5 (mesmo eixo)");
// caminho curto: -r e r dao o mesmo resultado
r[0] = -r[0]; r[1] = -r[1]; r[2] = -r[2]; r[3] = -r[3]; quatFromYawPitchInto(q, 0.0, 0.0);
quatNlerpInto(o, q, r, 0.5); quatFromYawPitchInto(q, 0.5, 0.0);
check(perto(Math.abs(o[1]), Math.abs(q[1])) && o[3] > 0, "nlerp pelo caminho curto");
io.print("[PASSOU] quat: identidade, yaw/pitch, composicao, nlerp");
