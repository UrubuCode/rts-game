import { createAppAt } from "../src/compat/app";
import { initMeshes,setCamBuf } from "@engine/render/gpu3d";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { AdaptiveWater } from "@engine/core/adaptive_water";
import { Terrain } from "@engine/core/terrain";
function check(ok:boolean,msg:string):void{if(!ok)throw new Error(msg);}
const app=createAppAt("Adaptive water test",320,240,120,90),win=app._win;initMeshes(win);
const scene=new Scene(),ground=new GameObject("Terrain"),terrain=new Terrain(),go=new GameObject("Water"),water=new AdaptiveWater();
ground.addBehavior(terrain);scene.add(ground);water.resolution=4;water.sourceRate=16;go.addBehavior(water);scene.add(go);scene.computeWorld();water.previewSecond();water.bake();
const pos=new Float64Array(3),camera=new Float64Array([0,20,-30,0,-.5,1,1.33,.1,500,0,5]);
function draw():void{if(app.beginFrame()){setCamBuf(win,camera);water.drawSelf(win,pos,-1);app.endFrame();}}
draw();const access:any=water,id=access.mesh;check(id>0,"upload");
for(let i=0;i<8;i++){water.update(.05);draw();}check(access.mesh===id,"snapshot reutiliza malha");
water.previewSecond();draw();check(access.mesh>0&&access.mesh!==id,"volume alterado atualiza malha");
water.releaseResources();water.releaseResources();draw();check(access.mesh>0,"restaura snapshot apos liberar recursos");
scene.clear();if(app.beginFrame())app.endFrame();app.close();console.log("adaptive-water-gpu OK: upload, cache congelado, atualizacao e descarte");
