// Teste de conformidade de layout de memória e offsets da física (Lote A).
// Valida PHYSICS_LAYOUT_VERSION, offsets dos registros de estáticos e corpos,
// integridade de tipos (bodyType 0, 1, 2, 3), e integridade de bitmask de layer/mask (sem perda de precisão float).

import io from "@compat/io.ts";
import {
  PHYSICS_LAYOUT_VERSION,
  BODY_UNASSIGNED,
  BODY_STATIC,
  BODY_KINEMATIC,
  BODY_DYNAMIC,
  MAT_AT,
  MAT_MAX_STATICS,
  MAT_STATIC_REC,
  MAT_BODY_REC,
  matBytesFor,
  matFillDefaults,
  matWriteBody,
  matWriteStatic,
} from "@engine/rigid/materials";
import { GameObject } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";

let falhas = 0;
function assertEq(nome: string, obtido: any, esperado: any): void {
  if (obtido !== esperado) {
    io.print("[FALHOU] " + nome + ": esperado " + esperado + ", obtido " + obtido);
    falhas = falhas + 1;
  } else {
    io.print("[PASSOU] " + nome + ": " + obtido);
  }
}
function assertApprox(nome: string, obtido: f64, esperado: f64): void {
  const diff = Math.abs(obtido - esperado);
  if (diff > 1e-4) {
    io.print("[FALHOU] " + nome + ": esperado " + esperado + ", obtido " + obtido);
    falhas = falhas + 1;
  } else {
    io.print("[PASSOU] " + nome + ": " + obtido);
  }
}

io.print("=== Teste de Versão e Constantes ===");
assertEq("PHYSICS_LAYOUT_VERSION", PHYSICS_LAYOUT_VERSION, 1);
assertEq("BODY_UNASSIGNED", BODY_UNASSIGNED, 0);
assertEq("BODY_STATIC", BODY_STATIC, 1);
assertEq("BODY_KINEMATIC", BODY_KINEMATIC, 2);
assertEq("BODY_DYNAMIC", BODY_DYNAMIC, 3);
assertEq("MAT_STATIC_REC", MAT_STATIC_REC, 4);
assertEq("MAT_BODY_REC", MAT_BODY_REC, 8);
assertEq("MAT_MAX_STATICS", MAT_MAX_STATICS, 256);
assertEq("MAT_AT", MAT_AT, 2052);

io.print("=== Teste de Layout e Defaults em Float32Array ===");
const nCorpos = 4;
const totalFloats = MAT_AT + matBytesFor(nCorpos);
const buf = new Float32Array(totalFloats);
const bufU32 = new Uint32Array(buf.buffer, buf.byteOffset, buf.length);

matFillDefaults(buf, MAT_AT, nCorpos);

// Checa defaults do primeiro e último estático
assertApprox("Static 0 restitution default", buf[MAT_AT + 0], 0.0);
assertApprox("Static 0 friction default", buf[MAT_AT + 1], 0.35);
assertEq("Static 0 layer default (u32)", bufU32[MAT_AT + 2], 1);
assertEq("Static 0 mask default (u32)", bufU32[MAT_AT + 3], 0xFFFFFFFF);

const ultimoStatic = MAT_AT + (MAT_MAX_STATICS - 1) * MAT_STATIC_REC;
assertEq("Static 255 layer default (u32)", bufU32[ultimoStatic + 2], 1);
assertEq("Static 255 mask default (u32)", bufU32[ultimoStatic + 3], 0xFFFFFFFF);

// Checa defaults do primeiro e último corpo
const bodiesBase = MAT_AT + MAT_MAX_STATICS * MAT_STATIC_REC;
assertEq("Body base offset", bodiesBase, 2052 + 256 * 4);
assertApprox("Body 0 g default", buf[bodiesBase + 0], 9.8);
assertApprox("Body 0 restitution default", buf[bodiesBase + 1], 0.0);
assertApprox("Body 0 drag default", buf[bodiesBase + 2], 0.0);
assertApprox("Body 0 friction default", buf[bodiesBase + 3], 0.35);
assertEq("Body 0 tipo default (3.0 = dynamic)", buf[bodiesBase + 5], BODY_DYNAMIC);
assertEq("Body 0 layer default (u32)", bufU32[bodiesBase + 6], 1);
assertEq("Body 0 mask default (u32)", bufU32[bodiesBase + 7], 0xFFFFFFFF);

io.print("=== Teste de Escrita e Bitmasks (matWriteBody / matWriteStatic) ===");
const obj = new GameObject("TestObj");
obj.layer = 0x00000004; // bit 2
obj.mask = 0x80000001;  // bit 31 e bit 0
obj.bodyType = BODY_KINEMATIC;
obj.transform.restitution = 0.75;
obj.transform.friction = 0.42;

matWriteBody(buf, MAT_AT, 2, obj, obj.transform);
const body2Base = bodiesBase + 2 * MAT_BODY_REC;
assertEq("Body 2 tipo escrito", buf[body2Base + 5], BODY_KINEMATIC);
assertEq("Body 2 layer (u32 preservado)", bufU32[body2Base + 6], 0x00000004);
assertEq("Body 2 mask (u32 preservado)", bufU32[body2Base + 7], 0x80000001);

const staticObj = new GameObject("StaticObj");
staticObj.layer = 0x00000002;
staticObj.mask = 0x00000004;
staticObj.transform.restitution = 0.5;
staticObj.transform.friction = 0.2;

matWriteStatic(buf, MAT_AT, 10, staticObj.transform, staticObj);
const static10Base = MAT_AT + 10 * MAT_STATIC_REC;
assertApprox("Static 10 restitution", buf[static10Base + 0], 0.5);
assertApprox("Static 10 friction", buf[static10Base + 1], 0.2);
assertEq("Static 10 layer (u32 preservado)", bufU32[static10Base + 2], 0x00000002);
assertEq("Static 10 mask (u32 preservado)", bufU32[static10Base + 3], 0x00000004);

if (falhas === 0) {
  io.print("[RESULTADO] Todos os testes de layout de memoria e offsets passaram!");
} else {
  io.print("[RESULTADO] " + falhas + " falhas detectadas!");
}
