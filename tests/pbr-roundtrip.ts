import { Material } from "@engine/core/material";
import { GameObject } from "@engine/core/gameobject";
import { objectToData, buildObject } from "@editor/sceneio";
import { Ambiente, ambienteToData, ambienteFromData } from "@engine/core/ambiente";

function pbrCheck(ok: boolean, label: string): void { if (!ok) throw new Error(label); }
const pbrGo = new GameObject("material roundtrip");
pbrGo.setMesh(1,200,150,80);
const pbrMat = new Material();pbrMat.pbr=1;pbrMat.roughness=0.3;pbrMat.metallic=0.8;
pbrMat.normalPath="assets/pbr/stone-normal.png";pbrMat.emissiveR=4;
pbrGo.addBehavior(pbrMat);
const pbrData=objectToData(pbrGo);
const pbrCopy=buildObject(JSON.parse(JSON.stringify(pbrData)));
pbrCheck(pbrCopy.matIdx>=0,"material missing after GameObject roundtrip");
pbrCheck(JSON.stringify(pbrCopy.behaviors[pbrCopy.matIdx].toData())===JSON.stringify(pbrMat.toData()),"scene serializer discarded PBR fields");
const pbrEnv=new Ambiente();pbrEnv.exposicao=1.7;
const pbrRestored=new Ambiente();ambienteFromData(pbrRestored,ambienteToData(pbrEnv));
pbrCheck(pbrRestored.exposicao===1.7,"exposure not persisted");
ambienteFromData(pbrRestored,{});pbrCheck(pbrRestored.exposicao===0,"legacy scene must disable tone mapping");
let pbrRejected=false;try {ambienteFromData(pbrRestored,{exposicao:-1});} catch(e){pbrRejected=true;}
pbrCheck(pbrRejected,"invalid exposure accepted");
println("PASS pbr-roundtrip: scene serializer, material maps, exposure, legacy defaults");
