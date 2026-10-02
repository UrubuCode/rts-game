import { Spline } from "@engine/core/spline";
import { WaterBody } from "@engine/core/water_body";
// Run from repository root with the PBR runtime; see docs/render-pbr.md.
import { openWindow, pump, isOpen, beginFrame, endFrame, close, drawText, captureScene, setExposure } from "rts:egui";
import { benchInit,benchFrameBegin,benchCpuEnd,benchFrameEnd } from "@engine/core/frame_bench";
import { setVsync } from "rts:egui";
import process from "node:process";
import fpsPbrInput from "@compat/input.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { WaterSurface } from "@engine/core/water_surface";
import { Buoyancy } from "@engine/core/buoyancy";
import { Rigidbody } from "@scripts/rigidbody";
import { Terrain } from "@engine/core/terrain";
import { Material } from "@engine/core/material";
import { initMeshes, upload, setCamBuf, setLgtBuf, setLightsBuf, setShadowBuf, setSkyBuf, frustumBeginBuf, frustumParams, winWidth, winHeight } from "@engine/render/gpu3d";
import { drawSceneObjects, prepararDesenho, DS_FLOATS, fParams } from "@engine/render/scenedraw";

const pbrWin = openWindow("RTS | Lago / WaterSurface", 1280, 800, 0);
initMeshes(pbrWin);benchInit();if(process.env.RTS_VSYNC==="0")setVsync(pbrWin,false);
const pbrScene = new Scene("Lago / WaterSurface");
const pbrCfg = new Float64Array(DS_FLOATS);
const pbrCamera = new Float64Array([17,9,-24,-0.55,-0.24,0.9,1.6,0.1,180,0,5]);
const pbrSun = new Float64Array([0,0,0,0, -0.55,-0.8,0.35, 1,0.91,0.76,4,0, 0,0,1,0]);
const pbrSky = new Float64Array([1, 0.19,0.36,0.62, 0.65,0.73,0.83, 0.14,0.12,0.09, -0.55,-0.8,0.35, 0.025,0,1,0, 2,1,1,1,0.65]);
setLightsBuf(pbrWin,pbrSun,1);setSkyBuf(pbrWin,pbrSky);
setLgtBuf(pbrWin,new Float64Array([-5,8,-3,0.2]));
setShadowBuf(pbrWin,new Float64Array([-0.55,-0.8,0.35,0,1,1,16]));
setExposure(pbrWin,1);


const river=new GameObject("Rio"),curve=new Spline(),water=new WaterBody();curve.points="[[-16,0,-13,6,3,2],[-7,0,-3,8,3,2],[5,0,2,7,3,2],[14,0,15,8,3,1]]";curve.onValidate("points");river.addBehavior(curve);river.addBehavior(water);pbrScene.add(river);
const ground=new GameObject("Margens"),terrain=new Terrain();terrain.size=72;terrain.fieldSet(1,128);ground.transform.py=.5;ground.addBehavior(terrain);pbrScene.add(ground);
const lake=new GameObject("Lago"),outline=new Spline(),lakeWater=new WaterBody();outline.closed=true;outline.points="[[8,0,13,6,3,0],[20,0,12,6,3,0],[25,0,23,6,3,0],[12,0,26,6,3,0]]";outline.onValidate("points");lake.addBehavior(outline);lake.addBehavior(lakeWater);pbrScene.add(lake);
pbrScene.computeWorld();water.terrainObject="Margens";lakeWater.terrainObject="Margens";water.carveTerrain();lakeWater.carveTerrain();
function solid(name:string,pos:number[],size:number[],color:number):GameObject {
 const o=new GameObject(name);o.setMesh(1,(color>>16)&255,(color>>8)&255,color&255);o.transform.setPosition(pos[0],pos[1],pos[2]);o.transform.sx=size[0];o.transform.sy=size[1];o.transform.sz=size[2];
 const material=new Material();material.pbr=1;material.roughness=.7;o.addBehavior(material);pbrScene.add(o);return o;
}
for(let i=0;i<18;i++){
 const angle=i*2.4;const radius=18+Math.sin(i*3)*2;
 const rock=solid("Pedra",[Math.cos(angle)*radius,.4+Math.sin(i)*.4,Math.sin(angle)*radius],[1.3+Math.sin(i)*.4,1.5,1.1],0x84877b);rock.meshKind=4;
}
solid("Farol",[-5,3,7],[1.5,6,1.5],0xa83c2d);solid("Topo",[-5,6.1,7],[2,.3,2],0xede8d9);
const floating=solid("Caixa flutuante",[-7,1,-3],[1.4,1,1],0xc99a54);
const floatingBody=new Rigidbody();floatingBody.mass=.5;floatingBody.floorY=-20;floating.addBehavior(new Buoyancy());floating.addBehavior(floatingBody);floating.mount();
water.enabled=process.env.RTS_WATER_DISABLED==="1"?0:1;lakeWater.enabled=water.enabled;
pbrScene.computeWorld();
const pbrFrames = Number(process.env.RTS_PBR_FRAMES || "0");
const pbrCapture = process.env.RTS_PBR_CAPTURE || "";
let pbrFrame=0;
let pbrSampleStart=performance.now();
let pbrSampleFrames=0;
let pbrFpsText="FPS: medindo... | VSync ligado";
let fpsPbrLastTime=performance.now();
function fpsPbrMoveCamera(dt: number): void {
  if(fpsPbrInput.key(pbrWin,117,0)) {
    pbrCamera[0]=17;pbrCamera[1]=9;pbrCamera[2]=-24;pbrCamera[3]=-0.55;pbrCamera[4]=-0.24;
    return;
  }
  if(fpsPbrInput.mouseDown(pbrWin,1)) {
    pbrCamera[3]+=fpsPbrInput.mouseDeltaX(pbrWin)*0.004;
    pbrCamera[4]=Math.max(-1.45,Math.min(1.45,pbrCamera[4]-fpsPbrInput.mouseDeltaY(pbrWin)*0.004));
  }
  let forward=0;let right=0;let up=0;
  if(fpsPbrInput.key(pbrWin,122,0))forward++;
  if(fpsPbrInput.key(pbrWin,118,0))forward--;
  if(fpsPbrInput.key(pbrWin,103,0))right++;
  if(fpsPbrInput.key(pbrWin,100,0))right--;
  if(fpsPbrInput.key(pbrWin,104,0))up++;
  if(fpsPbrInput.key(pbrWin,116,0))up--;
  const len=Math.sqrt(forward*forward+right*right+up*up);
  if(len===0)return;
  const step=dt*(fpsPbrInput.modShift(pbrWin)?15:5)/len;
  const sy=Math.sin(pbrCamera[3]),cy=Math.cos(pbrCamera[3]);
  const sp=Math.sin(pbrCamera[4]),cp=Math.cos(pbrCamera[4]);
  pbrCamera[0]+=(forward*sy*cp+right*cy)*step;
  pbrCamera[1]+=(forward*sp+up)*step;
  pbrCamera[2]+=(forward*cy*cp-right*sy)*step;
}
while(pump(pbrWin)&&isOpen(pbrWin)) {
  benchFrameBegin();beginFrame(pbrWin);
  if(fpsPbrInput.key(pbrWin,2,0)){endFrame(pbrWin);break;}
  const fpsPbrTime=performance.now();
  fpsPbrMoveCamera(Math.min(0.05,Math.max(0,(fpsPbrTime-fpsPbrLastTime)/1000)));
  pbrScene.update(Math.min(.05,Math.max(0,(fpsPbrTime-fpsPbrLastTime)/1000)));pbrScene.computeWorld();
  fpsPbrLastTime=fpsPbrTime;
  const fpsPbrHeight=winHeight(pbrWin);
  if(fpsPbrHeight>0)pbrCamera[6]=winWidth(pbrWin)/fpsPbrHeight;
  setCamBuf(pbrWin,pbrCamera);frustumBeginBuf(pbrCamera);frustumParams(fParams);
  prepararDesenho(pbrCfg,fParams,-1,1);drawSceneObjects(pbrScene,pbrScene.objects.length,pbrWin,pbrCfg);
  drawText(pbrWin,{x:28,y:25,text:"RTS / SPLINE WATER",size:24,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:58,text:"Rio por spline | Corrente transporta a caixa | Lago e leito escavado",size:15,color:0xffd5d9dd});
  drawText(pbrWin,{x:28,y:82,text:pbrFpsText,size:18,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:108,text:"WASD: mover | Mouse direito: olhar | Q/E: altura | Shift: acelerar | R: restaurar | Esc: sair",size:15,color:0xfff5f1e8});
  if(pbrFrame===Number(process.env.RTS_PBR_CAPTURE_FRAME||"8")&&pbrCapture.length>0) {
    if(!captureScene(pbrWin,pbrCapture,1280,800))throw new Error("PBR capture failed");
    // Capture consumes the queued geometry; refill it for the visible frame.
    drawSceneObjects(pbrScene,pbrScene.objects.length,pbrWin,pbrCfg);
  }
  benchCpuEnd();endFrame(pbrWin);pbrFrame++;if(benchFrameEnd()!==0)break;
  pbrSampleFrames++;
  const pbrNow=performance.now();
  const pbrElapsed=pbrNow-pbrSampleStart;
  if(pbrElapsed>=1000) {
    pbrFpsText="FPS: "+(pbrSampleFrames*1000/pbrElapsed).toFixed(1)+" | "+(pbrElapsed/pbrSampleFrames).toFixed(2)+" ms/quadro | VSync ligado";
    println(pbrFpsText);
    pbrSampleStart=pbrNow;pbrSampleFrames=0;
  }
  if(pbrFrames>0&&pbrFrame>=pbrFrames)break;
}
pbrScene.clear();close(pbrWin);
println("PASS pbr_water_spline: "+pbrFrame+" frames");
