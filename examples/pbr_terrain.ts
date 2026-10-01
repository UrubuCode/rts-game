// Run from repository root with the PBR runtime; see docs/render-pbr.md.
import { openWindow, pump, isOpen, beginFrame, endFrame, close, drawText, captureScene, setExposure } from "rts:egui";
import process from "node:process";
import fpsTerrainFs from "@compat/fs.ts";
import { Terrain } from "@engine/core/terrain";
import fpsPbrInput from "@compat/input.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Material } from "@engine/core/material";
import { initMeshes, upload, setCamBuf, setLgtBuf, setLightsBuf, setShadowBuf, setSkyBuf, frustumBeginBuf, frustumParams, winWidth, winHeight } from "@engine/render/gpu3d";
import { drawSceneObjects, prepararDesenho, DS_FLOATS, fParams } from "@engine/render/scenedraw";

const pbrWin = openWindow("RTS | Terreno / Escultura", 1280, 800, 0);
initMeshes(pbrWin);
const pbrScene = new Scene("Terreno / Escultura");
const pbrCfg = new Float64Array(DS_FLOATS);
const pbrCamera = new Float64Array([18,22,-28,-0.55,-0.5,1.05,1.6,0.1,200,0,5]);
const pbrSun = new Float64Array([0,0,0,0, -0.55,-0.8,0.35, 1,0.91,0.76,4,0, 0,0,1,0]);
const pbrSky = new Float64Array([1, 0.19,0.36,0.62, 0.65,0.73,0.83, 0.14,0.12,0.09, -0.55,-0.8,0.35, 0.025,0,1,0, 2,1,1,1,0.65]);
setLightsBuf(pbrWin,pbrSun,1);setSkyBuf(pbrWin,pbrSky);
setLgtBuf(pbrWin,new Float64Array([-5,8,-3,0.2]));
setShadowBuf(pbrWin,new Float64Array([-0.55,-0.8,0.35,0,1,1,16]));
setExposure(pbrWin,1);

const fpsTerrainFile="assets/pbr/terrain.heightmap.json";
const fpsTerrain=fpsTerrainFs.exists(fpsTerrainFile)?Terrain.fromData(JSON.parse(fpsTerrainFs.read_text(fpsTerrainFile))):new Terrain();
if(!fpsTerrainFs.exists(fpsTerrainFile)){
  fpsTerrain.fieldSet(0,48);fpsTerrain.fieldSet(1,64);
  fpsTerrain.brush(-9,7,12,7);fpsTerrain.brush(9,5,10,5);fpsTerrain.brush(0,-8,9,3);
}
const fpsTerrainObject=new GameObject("Terreno editavel");fpsTerrainObject.addBehavior(fpsTerrain);
pbrScene.add(fpsTerrainObject);
let fpsTerrainStatus="Pincel: 4 m | Relevo salvo e reaberto automaticamente nesta demo";
let fpsTerrainPaintTime=0;
function fpsTerrainSave():void {
  try{fpsTerrainFs.write(fpsTerrainFile,JSON.stringify(fpsTerrain.toData()));fpsTerrainStatus="Salvo: "+fpsTerrainFile;}
  catch(e){fpsTerrainStatus="Falha ao salvar: "+String(e);}
}
function fpsTerrainPaint(dt:number):void {
  if(fpsPbrInput.key(pbrWin,144,1))fpsTerrainSave();
  // Wheel changes radius; right mouse is reserved for the free camera.
  const wheel=fpsPbrInput.wheel(pbrWin);
  if(wheel!==0){fpsTerrain.brushRadius=Math.max(0.5,Math.min(16,fpsTerrain.brushRadius+wheel*0.5));fpsTerrainStatus="Raio do pincel: "+fpsTerrain.brushRadius.toFixed(1)+" m";}
  if(!fpsPbrInput.mouseDown(pbrWin,0)||fpsPbrInput.mouseDown(pbrWin,1)){fpsTerrainPaintTime=0;return;}
  fpsTerrainPaintTime+=dt;if(fpsTerrainPaintTime<0.1)return;
  const strength=fpsTerrainPaintTime*4;fpsTerrainPaintTime=0;
  const width=winWidth(pbrWin),height=winHeight(pbrWin),mx=fpsPbrInput.mouseX(pbrWin),my=fpsPbrInput.mouseY(pbrWin);
  if(width<=0||height<=0||mx<0||my<155||mx>=width||my>=height)return;
  const tangent=Math.tan(pbrCamera[5]/2);
  const vx=(mx/width*2-1)*tangent*width/height,vy=(1-my/height*2)*tangent;
  const cp=Math.cos(pbrCamera[4]),sp=Math.sin(pbrCamera[4]),cy=Math.cos(pbrCamera[3]),sy=Math.sin(pbrCamera[3]);
  const py=vy*cp+sp,pz=cp-vy*sp,px=vx*cy+pz*sy,pzz=pz*cy-vx*sy;
  const length=Math.sqrt(px*px+py*py+pzz*pzz),dx=px/length,dy=py/length,dz=pzz/length;
  for(let t=0.25;t<200;t+=0.25){
    const x=pbrCamera[0]+dx*t,z=pbrCamera[2]+dz*t,y=pbrCamera[1]+dy*t;
    if(Math.abs(x)>fpsTerrain.size/2||Math.abs(z)>fpsTerrain.size/2)continue;
    if(y<=fpsTerrain.heightAt(x,z)){
      fpsTerrain.brushX=x;fpsTerrain.brushZ=z;
      fpsTerrain.brush(x,z,fpsTerrain.brushRadius,fpsPbrInput.modShift(pbrWin)?-strength:strength);
      fpsTerrainStatus="Relevo alterado (F5 salva) | Raio "+fpsTerrain.brushRadius.toFixed(1)+" m";return;
    }
  }
}

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
    pbrCamera[0]=18;pbrCamera[1]=22;pbrCamera[2]=-28;pbrCamera[3]=-0.55;pbrCamera[4]=-0.5;
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
  beginFrame(pbrWin);
  if(fpsPbrInput.key(pbrWin,2,0)){endFrame(pbrWin);break;}
  const fpsPbrTime=performance.now();
  fpsPbrMoveCamera(Math.min(0.05,Math.max(0,(fpsPbrTime-fpsPbrLastTime)/1000)));
  fpsTerrainPaint(Math.min(0.05,Math.max(0,(fpsPbrTime-fpsPbrLastTime)/1000)));
  fpsPbrLastTime=fpsPbrTime;
  const fpsPbrHeight=winHeight(pbrWin);
  if(fpsPbrHeight>0)pbrCamera[6]=winWidth(pbrWin)/fpsPbrHeight;
  setCamBuf(pbrWin,pbrCamera);frustumBeginBuf(pbrCamera);frustumParams(fParams);
  prepararDesenho(pbrCfg,fParams,-1,1);drawSceneObjects(pbrScene,pbrScene.objects.length,pbrWin,pbrCfg);
  drawText(pbrWin,{x:28,y:25,text:"RTS / TERRAIN LAB",size:24,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:58,text:"Esquerdo: elevar | Shift + esquerdo: rebaixar | F5: salvar | Roda do mouse: raio",size:15,color:0xffd5d9dd});
  drawText(pbrWin,{x:28,y:137,text:fpsTerrainStatus,size:15,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:82,text:pbrFpsText,size:18,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:108,text:"WASD: mover | Mouse direito: olhar | Q/E: altura | Shift: acelerar | R: restaurar | Esc: sair",size:15,color:0xfff5f1e8});
  if(pbrFrame===8&&pbrCapture.length>0) {
    if(!captureScene(pbrWin,pbrCapture,1280,800))throw new Error("PBR capture failed");
    // Capture consumes the queued geometry; refill it for the visible frame.
    drawSceneObjects(pbrScene,pbrScene.objects.length,pbrWin,pbrCfg);
  }
  endFrame(pbrWin);pbrFrame++;
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
close(pbrWin);
println("PASS pbr_terrain: "+pbrFrame+" frames");
