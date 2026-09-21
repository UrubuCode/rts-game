// Teste de conformidade de layout de memória e offsets da física (Lote A).
// Valida PHYSICS_LAYOUT_VERSION, offsets dos registros de estáticos e corpos,
// integridade de tipos, bitmask de layer/mask, e recusa de versão inválida no rts:rigid.step.

import io from "@compat/io.ts";
import rigid from "@compat/rigid.ts";
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
  LAYER_DEFAULT,
  MASK_ALL,
  WORLD_PARAM_ANY_MASK,
  matBytesFor,
  matFillDefaults,
  matWriteBody,
  matWriteStatic,
} from "@engine/rigid/materials";
import { rbInit } from "@engine/rigid/gpurigid";
import { GameObject } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";
import { Rigidbody } from "@scripts/rigidbody";

let falhas = 0;
let totalChecks = 0;

function check(nome: string, cond: boolean, detalhe?: string): void {
  totalChecks = totalChecks + 1;
  if (cond) {
    io.print("  [OK] " + nome);
  } else {
    io.print("  [FALHA] " + nome + (detalhe ? " - " + detalhe : ""));
    falhas = falhas + 1;
  }
}

io.print("=== Teste de Layout de Memória e Offsets (Lote A) ===");

// 1. Constantes de layout e tipos
check("PHYSICS_LAYOUT_VERSION === 1", PHYSICS_LAYOUT_VERSION === 1);
check("BODY_UNASSIGNED === 0", BODY_UNASSIGNED === 0);
check("BODY_STATIC === 1", BODY_STATIC === 1);
check("BODY_KINEMATIC === 2", BODY_KINEMATIC === 2);
check("BODY_DYNAMIC === 3", BODY_DYNAMIC === 3);
check("MAT_STATIC_REC === 4", MAT_STATIC_REC === 4);
check("MAT_BODY_REC === 8", MAT_BODY_REC === 8);
check("MAT_MAX_STATICS === 256", MAT_MAX_STATICS === 256);
check("MAT_AT === 2056", MAT_AT === 2056);

// 2. Layout e defaults em buffer
const nCorpos = 4;
const totalFloats = MAT_AT + matBytesFor(nCorpos);
const buf = new Float32Array(totalFloats);
const bufU32 = new Uint32Array(buf.buffer, buf.byteOffset, buf.length);

matFillDefaults(buf, MAT_AT, nCorpos, bufU32);

// Checa defaults do primeiro e último estático
check("Static 0 restitution default", Math.abs(buf[MAT_AT + 0] - 0.0) < 1e-4);
check("Static 0 friction default", Math.abs(buf[MAT_AT + 1] - 0.35) < 1e-4);
check("Static 0 layer default (u32)", bufU32[MAT_AT + 2] === LAYER_DEFAULT);
check("Static 0 mask default (u32)", bufU32[MAT_AT + 3] === MASK_ALL);

const ultimoStatic = MAT_AT + (MAT_MAX_STATICS - 1) * MAT_STATIC_REC;
check("Static 255 layer default (u32)", bufU32[ultimoStatic + 2] === LAYER_DEFAULT);
check("Static 255 mask default (u32)", bufU32[ultimoStatic + 3] === MASK_ALL);

// Checa defaults do primeiro corpo
const bodiesBase = MAT_AT + MAT_MAX_STATICS * MAT_STATIC_REC;
check("Body base offset", bodiesBase === 2056 + 256 * 4);
check("Body 0 g default", Math.abs(buf[bodiesBase + 0] - 9.8) < 1e-4);
check("Body 0 restitution default", Math.abs(buf[bodiesBase + 1] - 0.0) < 1e-4);
check("Body 0 drag default", Math.abs(buf[bodiesBase + 2] - 0.0) < 1e-4);
check("Body 0 friction default", Math.abs(buf[bodiesBase + 3] - 0.35) < 1e-4);
check("Body 0 tipo default (3.0 = dynamic)", buf[bodiesBase + 5] === BODY_DYNAMIC);
check("Body 0 layer default (u32)", bufU32[bodiesBase + 6] === LAYER_DEFAULT);
check("Body 0 mask default (u32)", bufU32[bodiesBase + 7] === MASK_ALL);

// 3. Escrita e bitmasks (matWriteBody / matWriteStatic)
const obj = new GameObject("TestObj");
obj.layer = 0x00000004; // bit 2
obj.mask = 0x80000001;  // bit 31 e bit 0
const rb = new Rigidbody(0, 0);
rb.bodyType = BODY_KINEMATIC;
obj.addBehavior(rb);
obj.transform.restitution = 0.75;
obj.transform.friction = 0.42;

matWriteBody(buf, MAT_AT, 2, obj, obj.transform, bufU32);
const body2Base = bodiesBase + 2 * MAT_BODY_REC;
check("Body 2 tipo escrito (BODY_KINEMATIC)", buf[body2Base + 5] === BODY_KINEMATIC);
check("Body 2 layer (u32 preservado)", bufU32[body2Base + 6] === 0x00000004);
check("Body 2 mask (u32 preservado)", bufU32[body2Base + 7] === 0x80000001);

const staticObj = new GameObject("StaticObj");
staticObj.layer = 0x00000002;
staticObj.mask = 0x00000004;
staticObj.transform.restitution = 0.5;
staticObj.transform.friction = 0.2;

matWriteStatic(buf, MAT_AT, 10, staticObj.transform, staticObj, bufU32);
const static10Base = MAT_AT + 10 * MAT_STATIC_REC;
check("Static 10 restitution", Math.abs(buf[static10Base + 0] - 0.5) < 1e-4);
check("Static 10 friction", Math.abs(buf[static10Base + 1] - 0.2) < 1e-4);
check("Static 10 layer (u32 preservado)", bufU32[static10Base + 2] === 0x00000002);
check("Static 10 mask (u32 preservado)", bufU32[static10Base + 3] === 0x00000004);

// 4. Teste de recusa e aceite de versão de layout em rts:rigid.step
const pos = new Float32Array(4);
const vel = new Float32Array(4);
const ext = new Float32Array(4);
ext[3] = 1.0; // invMass > 0
const stepWorld = new Float32Array(MAT_AT + matBytesFor(1));
const stepWorldU32 = new Uint32Array(stepWorld.buffer);
stepWorld[0] = 0.016; // dt
stepWorld[2] = 1.0;   // cellSize
stepWorld[3] = 1.0;   // substeps
matFillDefaults(stepWorld, MAT_AT, 1, stepWorldU32);

// Versão inválida (999.0) -> rts:rigid.step deve recusar e devolver 0
stepWorld[4] = 999.0;
const recusou = rigid.step(pos, vel, ext, stepWorld);
check("Recusa de versao de layout invalida (999.0 -> 0)", recusou === 0);

// Versão válida (PHYSICS_LAYOUT_VERSION = 1.0) -> rts:rigid.step deve aceitar e mover 1 corpo
stepWorld[4] = PHYSICS_LAYOUT_VERSION * 1.0;
const aceitou = rigid.step(pos, vel, ext, stepWorld);
check("Aceite de versao de layout valida (1.0 -> 1)", aceitou === 1);

// 5. Teste de recusa e aceite de versão de layout no rbInit (GPU)
check("WORLD_PARAM_ANY_MASK === 5", WORLD_PARAM_ANY_MASK === 5);
check("rbInit recusa versao de layout invalida (999 -> 0)", rbInit(1, 999) === 0);
check("rbInit aceita versao de layout valida (1 -> 1)", rbInit(1, 1) === 1);

if (falhas === 0) {
  io.print("[PASSOU] Layout de memoria, offsets e versao de layout (" + totalChecks + "/" + totalChecks + ")");
} else {
  io.print("[FALHA] Total de falhas: " + falhas + "/" + totalChecks);
}
