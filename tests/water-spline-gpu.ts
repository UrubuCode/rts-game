import { openWindow,pump,beginFrame,endFrame,close } from "rts:egui";
import { initMeshes,setCamBuf,frustumBeginBuf } from "@engine/render/gpu3d";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Spline } from "@engine/core/spline";
import { WaterBody } from "@engine/core/water_body";
function check(ok:boolean,msg:string):void{if(!ok)throw new Error(msg);println("[OK] "+msg);}
const win=openWindow("RTS | Cache de agua",320,240,0);initMeshes(win);
const scene=new Scene(),o=new GameObject("River"),curve=new Spline(),body=new WaterBody();o.addBehavior(curve);o.addBehavior(body);scene.add(o);scene.computeWorld();
const pos=new Float64Array(3),camera=new Float64Array([0,10,-30,0,-.3,1,1.33,.1,500,0,5]);
for(let i=0;i<8;i++){pump(win);beginFrame(win);setCamBuf(win,camera);frustumBeginBuf(camera);body.drawSelf(win,pos,-1);endFrame(win);}
const access:any=body,ids:number[]=[];let uploaded=0;
for(let i=0;i<access.patches.length;i++){ids.push(access.patches[i].mesh);if(ids[i]>0)uploaded++;}
check(uploaded>0,"trechos visiveis enviados a GPU");
camera[3]=Math.PI;pump(win);beginFrame(win);setCamBuf(win,camera);frustumBeginBuf(camera);body.drawSelf(win,pos,-1);endFrame(win);
camera[3]=0;pump(win);beginFrame(win);setCamBuf(win,camera);frustumBeginBuf(camera);body.drawSelf(win,pos,-1);endFrame(win);
for(let i=0;i<ids.length;i++)check(ids[i]===access.patches[i].mesh,"retorno preserva identificador da malha");
const p=new Float64Array(6);curve.point(1,p);p[0]+=2;curve.setPoint(1,p);body.synchronize();
for(let i=0;i<access.patches.length;i++)check(access.patches[i].mesh===0,"edicao invalida malhas antigas");
body.releaseResources();body.releaseResources();scene.clear();close(win);println("[PASSOU] water-spline-gpu");
