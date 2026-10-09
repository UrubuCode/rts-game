// Diagnóstico das duas pendências de física da auditoria de 2026-09-28/29.
// Só cria cenas em memória. A saída compara o contrato esperado com o atual;
// este arquivo não é uma suíte verde nem faz parte do CI.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import { PhysicsMaterial, MAT_RUBBER } from "@scripts/physicsmaterial";
import { BODY_STATIC } from "@engine/rigid/materials";

const staticScene = new Scene("static-audit");
const object = new GameObject("static");
const body = new Rigidbody();
body.bodyType = BODY_STATIC;
body.floorY = -1e9;
object.transform.py = 10;
object.addBehavior(body);
staticScene.add(object);
staticScene.update(1 / 60);
io.print("STATIC esperado y=10 vy=0; observado y=" + object.transform.py + " vy=" + object.transform.vy);
staticScene.clear();

const materialScene = new Scene("material-audit");
const ball = new GameObject("rubber");
const dynamic = new Rigidbody();
dynamic.floorY = -1e9;
ball.addBehavior(dynamic);
ball.addBehavior(new PhysicsMaterial(MAT_RUBBER));
materialScene.add(ball);
io.print("MATERIAL antes: massa=" + ball.transform.mass + " quique=" + ball.transform.restitution);
materialScene.update(1 / 60);
io.print("MATERIAL depois: massa=" + ball.transform.mass + " quique=" + ball.transform.restitution);
materialScene.clear();
