// Run from repository root with the PBR runtime; see docs/render-pbr.md.
import { openWindow, pump, isOpen, beginFrame, endFrame, close, drawText, captureScene, setExposure } from "rts:egui";
import process from "node:process";
import fpsPbrInput from "@compat/input.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Material } from "@engine/core/material";
import { initMeshes, upload, setCamBuf, setLgtBuf, setLightsBuf, setShadowBuf, setSkyBuf, frustumBeginBuf, frustumParams, winWidth, winHeight } from "@engine/render/gpu3d";
import { drawSceneObjects, prepararDesenho, DS_FLOATS, fParams } from "@engine/render/scenedraw";

const pbrWin = openWindow("RTS | Patio PBR", 1280, 800, 0);
initMeshes(pbrWin);
const pbrScene = new Scene("Patio PBR");
const pbrCfg = new Float64Array(DS_FLOATS);
const pbrCamera = new Float64Array([9,6,-12,-0.55,-0.23,0.9,1.6,0.1,150,0,5]);
const pbrSun = new Float64Array([0,0,0,0, -0.55,-0.8,0.35, 1,0.91,0.76,4,0, 0,0,1,0]);
const pbrSky = new Float64Array([1, 0.19,0.36,0.62, 0.65,0.73,0.83, 0.14,0.12,0.09, -0.55,-0.8,0.35, 0.025,0,1,0, 2,1,1,1,0.65]);
setLightsBuf(pbrWin,pbrSun,1);setSkyBuf(pbrWin,pbrSky);
setLgtBuf(pbrWin,new Float64Array([-5,8,-3,0.2]));
setShadowBuf(pbrWin,new Float64Array([-0.55,-0.8,0.35,0,1,1,16]));
setExposure(pbrWin,1);

// Rounded cube: bevels catch grazing highlights, unlike infinitely sharp boxes.
function pbrRoundedCube(): number {
  const v: number[]=[];const idx: number[]=[];const steps=10;
  for(let face=0;face<6;face++)for(let y=0;y<=steps;y++)for(let x=0;x<=steps;x++) {
    let a=x/steps-0.5,b=y/steps-0.5;let px=0,py=0,pz=0;
    if(face<2){px=face===0?-0.5:0.5;py=b;pz=a;}
    else if(face<4){py=face===2?-0.5:0.5;px=a;pz=b;}
    else {pz=face===4?-0.5:0.5;px=a;py=b;}
    const cx=Math.max(-0.44,Math.min(0.44,px)),cy=Math.max(-0.44,Math.min(0.44,py)),cz=Math.max(-0.44,Math.min(0.44,pz));
    const dx=px-cx,dy=py-cy,dz=pz-cz,len=Math.sqrt(dx*dx+dy*dy+dz*dz);
    v.push(cx+dx/len*0.06,cy+dy/len*0.06,cz+dz/len*0.06,dx/len,dy/len,dz/len,x/steps,y/steps);
    if(x<steps&&y<steps){const k=face*(steps+1)*(steps+1)+y*(steps+1)+x;idx.push(k,k+1,k+steps+1,k+1,k+steps+2,k+steps+1);}
  }
  return upload(pbrWin,v,idx);
}
const pbrBevel=pbrRoundedCube();
function pbrMaterial(kind: string, roughness: number, metallic: number): Material {
  const m=new Material();m.pbr=1;m.roughness=roughness;m.metallic=metallic;
  if(kind.length>0){m.texturePath="assets/pbr/"+kind+"-base.png";m.normalPath="assets/pbr/"+kind+"-normal.png";
    m.metallicRoughnessPath="assets/pbr/"+kind+"-orm.png";m.occlusionPath=m.metallicRoughnessPath;m.tile=1;}
  return m;
}
function pbrObject(name: string, pos: number[], size: number[], material: Material, color: number): GameObject {
  const o=new GameObject(name);o.setMesh(1,(color>>16)&255,(color>>8)&255,color&255);
  o.customMesh=pbrBevel;o.transform.setPosition(pos[0],pos[1],pos[2]);
  o.transform.sx=size[0];o.transform.sy=size[1];o.transform.sz=size[2];o.stationary=1;
  o.addBehavior(material);pbrScene.add(o);return o;
}
pbrObject("piso",[0,-0.15,1],[18,0.3,18],pbrMaterial("stone",1,0),0xffffff);
pbrObject("parede",[0,2.4,7],[17,4.8,0.45],pbrMaterial("stone",1,0),0xe8e2d6);
for(let i=0;i<5;i++) {
  const x=(i-2)*3.2;
  pbrObject("coluna",[x,2.5,5.5],[0.45,5,0.45],pbrMaterial("",0.75,0),0xb4b4ad);
  pbrObject("travessa",[x,5,1.5],[0.3,0.3,9],pbrMaterial("wood",1,0),0xffffff);
}
for(let i=0;i<7;i++)pbrObject("ripado",[0,5.15,-2+i*1.25],[14,0.14,0.15],pbrMaterial("wood",1,0),0xffffff);
for(let side=0;side<2;side++) {
  const x=side===0?-5:5;
  pbrObject("banco",[x,0.8,1],[2,0.25,4],pbrMaterial("wood",1,0),0xffffff);
  pbrObject("apoio",[x,0.35,-0.25],[1.5,0.7,0.3],pbrMaterial("metal",1,1),0x737b82);
  pbrObject("apoio",[x,0.35,2.25],[1.5,0.7,0.3],pbrMaterial("metal",1,1),0x737b82);
}
for(let i=0;i<5;i++) {
  const x=(i-2)*1.7;
  pbrObject("pedestal",[x,0.3,1],[1.25,0.6,1.25],pbrMaterial("",0.9,0),0x5c6268);
  const ball=new GameObject("metal-rugosidade-"+i);ball.setMesh(4,205,151,74);ball.transform.setPosition(x,1.45,1);
  ball.transform.setScale(1.4);ball.addBehavior(pbrMaterial("",0.08+i*0.21,1));pbrScene.add(ball);
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
    pbrCamera[0]=9;pbrCamera[1]=6;pbrCamera[2]=-12;pbrCamera[3]=-0.55;pbrCamera[4]=-0.23;
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
  fpsPbrLastTime=fpsPbrTime;
  const fpsPbrHeight=winHeight(pbrWin);
  if(fpsPbrHeight>0)pbrCamera[6]=winWidth(pbrWin)/fpsPbrHeight;
  setCamBuf(pbrWin,pbrCamera);frustumBeginBuf(pbrCamera);frustumParams(fParams);
  prepararDesenho(pbrCfg,fParams,-1,1);drawSceneObjects(pbrScene,pbrScene.objects.length,pbrWin,pbrCfg);
  drawText(pbrWin,{x:28,y:25,text:"RTS / MATERIAL LAB",size:24,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:58,text:"Patio PBR   |   GGX + normal maps + HDR   |   metal: rugosidade 0.08 a 0.92",size:15,color:0xffd5d9dd});
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
println("PASS pbr_courtyard: "+pbrFrame+" frames");
