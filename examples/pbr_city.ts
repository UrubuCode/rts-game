// Run from repository root with the PBR runtime; see docs/render-pbr.md.
import { openWindow, pump, isOpen, beginFrame, endFrame, close, drawText, drawRect, captureScene, setExposure } from "rts:egui";
import process from "node:process";
import fpsPbrInput from "@compat/input.ts";
import fpsCityTime from "@compat/time.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Material } from "@engine/core/material";
import { Skeleton } from "@engine/core/skeleton";
import { sampleClipInto } from "@engine/core/animation_player";
import { RoutePath } from "@engine/core/route_path";
import { RouteAgent } from "@engine/core/route_agent";
import { TextureLoadOperation } from "@engine/render/texture_loading";
import { acquireSkeletonAsset } from "@engine/render/gltf_anim";
import { LoadingScreen } from "@engine/render/loading_screen";
import { CityLayout } from "@engine/core/city_layout";
import { RouteNode as FpsRouteNode, RouteMotion as FpsRouteAgent, ROUTE_WALK as FPS_ROUTE_WALK } from "@engine/core/route_motion";
import { initMeshes, upload, setCamBuf, setLgtBuf, setLightsBuf, setShadowBuf, setSkyBuf, frustumBeginBuf, frustumParams, setFogBuf, winWidth, winHeight, setVsync } from "@engine/render/gpu3d";
import { drawSceneObjects, prepararDesenho, DS_FLOATS, fParams } from "@engine/render/scenedraw";

const fpsCityStartup=performance.now();
const fpsCityLoadUI=new LoadingScreen();
const fpsCityLayout=new CityLayout(Number(process.env.RTS_CITY_SEED||"42"));
println("City seed: "+fpsCityLayout.seed);
const pbrWin = openWindow("RTS | Cidade / Por do sol", 1280, 800, 0);
let fpsCityLoadLast=performance.now();
let fpsCityLoadMax=0;
let fpsCityLoadLabel="abertura";
let fpsCityLoadProgress=0;
let fpsCityPedestrianMax=0;
function fpsCityLoading(label:string,progress:number):void {
  const elapsed=performance.now()-fpsCityLoadLast;
  fpsCityLoadMax=Math.max(fpsCityLoadMax,elapsed);
  if(fpsCityLoadLabel==="Carregando pedestres"||fpsCityLoadLabel==="Preparando texturas dos pedestres")fpsCityPedestrianMax=Math.max(fpsCityPedestrianMax,elapsed);
  if(elapsed>50)println("City load slice: "+fpsCityLoadLabel+" / "+elapsed.toFixed(2)+" ms");
  fpsCityLoadLabel=label;
  progress=Math.max(progress,fpsCityLoadProgress);fpsCityLoadProgress=progress;
  if(!pump(pbrWin)||!isOpen(pbrWin)){close(pbrWin);process.exit(0);}
  beginFrame(pbrWin);
  if(fpsPbrInput.key(pbrWin,2,0)){endFrame(pbrWin);close(pbrWin);process.exit(0);}
  fpsCityLoadUI.draw(pbrWin,label,progress);
  endFrame(pbrWin);fpsCityLoadLast=performance.now();
}
fpsCityLoading("Inicializando renderizacao",0);
initMeshes(pbrWin);
const pbrScene = new Scene("Cidade / Por do sol");
const pbrCfg = new Float64Array(DS_FLOATS);
const pbrCamera = new Float64Array([1,6,-29,0.04,-0.025,1.05,1.6,0.1,450,0,5]);
// Static architecture is merged by material: thousands of details, few draws.
const fpsCitySun=new Float64Array([0,0,0,0, -0.015,-0.12,-1, 1,0.46,0.18,3.5,0, 0,0,1,0]);
const fpsCitySky=new Float64Array([1, 0.10,0.16,0.32, 1,0.32,0.09, 0.07,0.08,0.12, -0.015,-0.12,-1, 0.037,0,1,0, 2,1,1,1,0.4]);
setLightsBuf(pbrWin,fpsCitySun,1);setSkyBuf(pbrWin,fpsCitySky);
setLgtBuf(pbrWin,new Float64Array([-10,20,80,0.2]));
setShadowBuf(pbrWin,new Float64Array([-0.015,-0.12,-1,0,0,35,95]));
setFogBuf(pbrWin,new Float64Array([0.52,0.22,0.12,0.002]));setExposure(pbrWin,1.1);
class FpsCityBatch {
  vertices: number[]=[];indices: number[]=[];
  material: Material; color: number;
  constructor(color: number, rough: number, metal: number, emission: number) {
    this.color=color;this.material=new Material();this.material.pbr=1;
    this.material.roughness=rough;this.material.metallic=metal;
    this.material.emissiveR=emission;this.material.emissiveG=emission*0.48;this.material.emissiveB=emission*0.13;
  }
  box(x:number,y:number,z:number,w:number,h:number,d:number):void {
    // Each face uses an outward orthogonal basis (u cross v = normal).
    const basis=[0,0,1,1,0,0,0,1,0, 0,0,-1,-1,0,0,0,1,0,
      1,0,0,0,0,-1,0,1,0, -1,0,0,0,0,1,0,1,0,
      0,1,0,1,0,0,0,0,-1, 0,-1,0,1,0,0,0,0,1];
    for(let f=0;f<6;f++) {
      const b=f*9,n=this.vertices.length/8;
      for(let c=0;c<4;c++) {
        const u=c===0||c===3?-1:1,v=c<2?-1:1;
        this.vertices.push(x+(basis[b]+basis[b+3]*u+basis[b+6]*v)*w/2,
          y+(basis[b+1]+basis[b+4]*u+basis[b+7]*v)*h/2,
          z+(basis[b+2]+basis[b+5]*u+basis[b+8]*v)*d/2,
          basis[b],basis[b+1],basis[b+2],u<0?0:1,v<0?0:1);
      }
      this.indices.push(n,n+1,n+2,n,n+2,n+3);
    }
  }
  finish(name:string):GameObject {
    const o=new GameObject(name);o.setMesh(1,(this.color>>16)&255,(this.color>>8)&255,this.color&255);
    o.customMesh=upload(pbrWin,this.vertices,this.indices);o.transform.setPosition(0,0,0);
    o.stationary=1;o.addBehavior(this.material);pbrScene.add(o);return o;
  }
}
const fpsCityRoad=new FpsCityBatch(0x343843,0.95,0,0);
const fpsCityPaving=new FpsCityBatch(0x969287,0.9,0,0);
const fpsCityCream=new FpsCityBatch(0xc7b599,0.8,0,0);
const fpsCityBrick=new FpsCityBatch(0x965c48,0.85,0,0);
const fpsCityDark=new FpsCityBatch(0x4b535f,0.68,0.2,0);
const fpsCityGlass=new FpsCityBatch(0x537480,0.16,0.75,0);
const fpsCityWarm=new FpsCityBatch(0xc18a44,0.28,0.3,1.7);
const fpsCityTrim=new FpsCityBatch(0x252b32,0.4,0.65,0);
const fpsCityPaint=new FpsCityBatch(0xdccca2,0.7,0,0);
const fpsCityRed=new FpsCityBatch(0x893b2d,0.24,0.55,0);
const fpsCityLight=new FpsCityBatch(0xffc270,0.35,0,5);
fpsCityPaving.material.texturePath="assets/pbr/stone-base.png";
fpsCityPaving.material.normalPath="assets/pbr/stone-normal.png";
fpsCityPaving.material.tile=24;
fpsCityRoad.box(0,-0.3,50,190,0.5,260);
for(let side=0;side<2;side++) {
  const sign=side===0?-1:1;
  fpsCityPaving.box(sign*19,0,45,20,0.3,170);
  fpsCityCream.box(sign*9.2,0.18,45,0.3,0.35,170);
  for(let block=0;block<7;block++) {
    fpsCityLoading("Construindo quarteiroes",0.05+(side*7+block)/14*0.3);
    const lot=fpsCityLayout.lots[side*7+block];
    const z=lot.z,h=lot.height,w=lot.width,d=lot.depth;
    const x=lot.x;const facade=lot.facade===0?fpsCityBrick:lot.facade===1?fpsCityCream:fpsCityDark;
    facade.box(x,h/2,z,w,h,d);
    fpsCityCream.box(x,h+0.25,z,w+0.5,0.5,d+0.5);
    fpsCityTrim.box(x,h+0.9,z+2,3,1.3,3);
    for(let floor=0;floor<Math.floor(h/3);floor++) {
      const y=2+floor*3;
      // Street-facing windows and front/back elevation details.
      for(let col=0;col<5;col++) {
        const wz=z-6+col*3;
        const glass=(floor+col+block)%5===0?fpsCityWarm:fpsCityGlass;
        fpsCityTrim.box(x-sign*(w/2+0.06),y,wz,0.15,2.05,1.95);
        glass.box(x-sign*(w/2+0.15),y,wz,0.08,1.75,1.65);
        fpsCityCream.box(x-sign*(w/2+0.25),y-1.1,wz,0.48,0.14,2.15);
      }
      for(let col=0;col<4;col++) {
        const wx=x-w/2+1.5+col*(w-3)/3;
        const glass=(col+floor+side)%6===0?fpsCityWarm:fpsCityGlass;
        glass.box(wx,y,z-d/2-0.04,1.5,1.85,0.12);
      }
      if(floor%3===0)fpsCityCream.box(x,y-1.4,z,w+0.2,0.18,d+0.2);
    }
    // Storefront canopy and illuminated strip.
    fpsCityTrim.box(x-sign*(w/2+0.9),3.1,z,1.8,0.2,d-1);
    fpsCityWarm.box(x-sign*(w/2+1.75),2.95,z,0.1,0.12,d-2);
  }
  for(let i=0;i<9;i++) {
    fpsCityLoading("Montando ruas e vegetacao",0.05+side*0.15+0.13+i/9*0.02);
    const z=i*17-20,x=sign*8.7;
    fpsCityTrim.box(x,2.8,z,0.14,5.6,0.14);
    fpsCityTrim.box(x-sign*0.65,5.5,z,1.4,0.12,0.12);
    fpsCityLight.box(x-sign*1.2,5.43,z,0.65,0.08,0.35);
    // Planter and tree trunks; foliage uses the existing sphere mesh.
    fpsCityPaving.box(sign*10.8,0.35,z+6,1.6,0.6,1.6);
    fpsCityBrick.box(sign*10.8,1.65,z+6,0.28,2.5,0.28);
    const tree=new GameObject("arvore");tree.setMesh(4,68+i%3*8,85+i%2*9,48);
    tree.transform.setPosition(sign*10.8,3.5,z+6);tree.transform.sx=2.8;tree.transform.sy=3.8;tree.transform.sz=2.8;
    const mat=new Material();mat.pbr=1;mat.roughness=0.95;tree.addBehavior(mat);tree.stationary=1;pbrScene.add(tree);
    if(i%2===0) {
      const cx=sign*6.7,cz=z+3;
      const car=i%4===0?fpsCityRed:fpsCityDark;
      car.box(cx,0.65,cz,1.8,0.8,4.2);car.box(cx,1.25,cz,1.65,0.65,2.2);
      fpsCityGlass.box(cx,1.4,cz-1.12,1.5,0.43,0.05);
      fpsCityGlass.box(cx-sign*0.84,1.37,cz,0.04,0.4,1.95);
      for(let wheel=0;wheel<4;wheel++)fpsCityTrim.box(cx+(wheel<2?-0.91:0.91),0.4,cz+(wheel%2===0?-1.3:1.3),0.22,0.65,0.65);
      fpsCityLight.box(cx-0.6,0.7,cz-2.12,0.35,0.17,0.04);fpsCityLight.box(cx+0.6,0.7,cz-2.12,0.35,0.17,0.04);
    }
  }
}
for(let z=-35;z<135;z+=7) {fpsCityPaint.box(-0.12,-0.035,z,0.1,0.035,3);fpsCityPaint.box(0.12,-0.035,z,0.1,0.035,3);}
for(let cross=0;cross<3;cross++)for(let i=0;i<10;i++)fpsCityPaint.box(-7+i*1.55,-0.025,-11+cross*50,0.8,0.04,3);
// Distant skyline closes the boulevard while leaving the setting sun visible.
for(let i=0;i<fpsCityLayout.skyline.length;i++) {
  const lot=fpsCityLayout.skyline[i],x=lot.x,h=lot.height;
  fpsCityDark.box(x,h/2,lot.z,lot.width,h,lot.depth);
  for(let floor=0;floor<Math.floor(h/4);floor++)fpsCityGlass.box(x,2+floor*4,lot.z-lot.depth/2-.05,lot.width*.8,1.5,0.1);
}
fpsCityRoad.finish("asfalto");fpsCityPaving.finish("calcadas");fpsCityCream.finish("fachadas claras");
fpsCityBrick.finish("terracota");fpsCityDark.finish("edificios escuros");fpsCityGlass.finish("vidro");
fpsCityWarm.finish("janelas acesas");fpsCityTrim.finish("metal");fpsCityPaint.finish("sinalizacao");
fpsCityRed.finish("carros");fpsCityLight.finish("luminarias");
fpsCityLoading("Preparando personagens",0.35);

// Civilian patrols reuse the existing Kenney rigs and walk/idle clips.
const fpsCityPeople:GameObject[]=[];
const fpsCityRigs:Skeleton[]=[];
const fpsCityWalkers:RouteAgent[]=[];
const fpsCityWalkClips:number[]=[];
const fpsCityIdleClips:number[]=[];
const fpsCityModels=["a","b","c","d"];
// Decode 1024² character atlases and build their mips off the UI thread.
// Cache them before Skeleton loads, so its synchronous texture path is a hit.
for(let i=0;i<fpsCityModels.length;i++){
  const texture=new TextureLoadOperation(pbrWin,"assets/kenney/personagens/Textures/texture-"+fpsCityModels[i]+".png");
  while(!texture.done){
    fpsCityLoading("Preparando texturas dos pedestres",0.36+(i+texture.progress)/4*0.04);
    texture.tick();
  }
  if(texture.error.length>0)throw new Error(texture.error);
}
for(let side=0;side<2;side++)for(let i=0;i<10;i++) {
  fpsCityLoading("Carregando pedestres",0.4+(side*10+i)/20*0.4);
  const x=(side===0?-1:1)*9.6,z=-29+i*15;
  const path=new RoutePath();
  path.nodes=[new FpsRouteNode(0,0,[1],0.8),new FpsRouteNode(0,4,[0,2],0),new FpsRouteNode(0,8,[1],1.6)];
  const route=new RouteAgent();route.startNode=i%3;route.seed=77+i*13+side*29;
  const person=new GameObject("pedestre-"+side+"-"+i);
  person.transform.setScale(1.8/2.7);
  person.transform.setPosition(x,0.16,z);
  const rig=new Skeleton("assets/kenney/personagens/character-"+fpsCityModels[(i+side)%4]+".glb");
  const preparedRig=acquireSkeletonAsset(pbrWin,rig.modelPath,()=>{
    if(performance.now()-fpsCityLoadLast>=8)fpsCityLoading("Carregando pedestres",0.4+(side*10+i)/20*0.4);
  });
  try {
    person.addBehavior(rig);person.addBehavior(path);person.addBehavior(route);pbrScene.add(person);rig.ensureAsset(pbrWin);
  } finally { preparedRig.release(); }
  route.update(i*0.37);
  if(rig.asset===null)throw new Error("Modelo de pedestre nao carregou");
  const walk=rig.asset.clipIndex("walk"),idle=rig.asset.clipIndex("idle");
  if(walk<0||idle<0)throw new Error("Clipes walk/idle ausentes");
  fpsCityPeople.push(person);fpsCityRigs.push(rig);fpsCityWalkers.push(route);
  fpsCityWalkClips.push(walk);fpsCityIdleClips.push(idle);
}
// Two lanes connected at the ends of the avenue. Same speed prevents overtaking.
const fpsCityRoadRoute=[new FpsRouteNode(-3.1,-62,[1],0),new FpsRouteNode(3.1,-62,[2],0),
  new FpsRouteNode(3.1,151,[3],0),new FpsRouteNode(-3.1,151,[0],0)];
const fpsCityDrivers:FpsRouteAgent[]=[];
const fpsCityMovingParts:GameObject[]=[];
for(let i=0;i<8;i++) {
  fpsCityLoading("Preparando trafego",0.8+i/8*0.15);
  const driver=new FpsRouteAgent(fpsCityRoadRoute,0,6.5,100+i);driver.step(i*8.8);
  fpsCityDrivers.push(driver);
  const paint=new FpsCityBatch(i%3===0?0x244c68:i%3===1?0x9b4433:0xb2ac93,0.26,0.5,0);
  const glass=new FpsCityBatch(0x315263,0.14,0.7,0);
  const rubber=new FpsCityBatch(0x171c23,0.8,0,0);
  const lamps=new FpsCityBatch(0xffcf86,0.4,0,3);
  paint.box(0,0.68,0,1.85,0.75,4.2);paint.box(0,1.2,-0.12,1.7,0.65,2.3);
  glass.box(0,1.3,1.05,1.5,0.43,0.08);glass.box(0,1.3,-1.29,1.5,0.43,0.08);
  glass.box(-0.86,1.33,-0.12,0.04,0.4,2.05);glass.box(0.86,1.33,-0.12,0.04,0.4,2.05);
  for(let w=0;w<4;w++)rubber.box(w<2?-0.94:0.94,0.38,w%2===0?-1.3:1.3,0.22,0.64,0.64);
  lamps.box(-0.61,0.76,2.13,0.4,0.19,0.05);lamps.box(0.61,0.76,2.13,0.4,0.19,0.05);
  fpsCityMovingParts.push(paint.finish("carro-movel"));fpsCityMovingParts.push(glass.finish("vidros-carro"));
  fpsCityMovingParts.push(rubber.finish("rodas-carro"));fpsCityMovingParts.push(lamps.finish("farois-carro"));
}
let fpsCityLifeTime=0;
function fpsCityLifeStep(dt:number):void {
  fpsCityLifeTime+=dt;
  for(let i=0;i<fpsCityWalkers.length;i++) {
    const controller=fpsCityWalkers[i];controller.update(dt);
    const agent=controller.motion;if(agent===null)continue;
    const rig=fpsCityRigs[i],asset=rig.asset;
    if(asset!==null) {
      rig.applyManualPose();
      const walking=agent.state===FPS_ROUTE_WALK;
      const clip=asset.clips[walking?fpsCityWalkClips[i]:fpsCityIdleClips[i]];
      // Existing walk stride measured at this model scale: 2.309 world units.
      const time=walking?(agent.distance/2.309)*clip.duration:fpsCityLifeTime+i*0.23;
      sampleClipInto(rig,clip,time%clip.duration,1);
    }
  }
  for(let i=0;i<fpsCityDrivers.length;i++) {
    const agent=fpsCityDrivers[i];agent.step(dt);
    for(let part=0;part<4;part++) {
      const o=fpsCityMovingParts[i*4+part];o.stationary=0;
      o.transform.setPosition(agent.x,0,agent.z);o.transform.ry=agent.yaw;
    }
  }
  pbrScene.computeWorld();
}
fpsCityLifeStep(0);
fpsCityLoading("Cidade pronta",1);
println("City startup after script entry: "+((performance.now()-fpsCityStartup)/1000).toFixed(2)+" s; max construction slice: "+fpsCityLoadMax.toFixed(2)+" ms");
println("City pedestrian max slice: "+fpsCityPedestrianMax.toFixed(2)+" ms");

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
    pbrCamera[0]=1;pbrCamera[1]=6;pbrCamera[2]=-29;pbrCamera[3]=0.04;pbrCamera[4]=-0.025;
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
  const step=dt*(fpsPbrInput.modShift(pbrWin)?35:9)/len;
  const sy=Math.sin(pbrCamera[3]),cy=Math.cos(pbrCamera[3]);
  const sp=Math.sin(pbrCamera[4]),cp=Math.cos(pbrCamera[4]);
  pbrCamera[0]+=(forward*sy*cp+right*cy)*step;
  pbrCamera[1]+=(forward*sp+up)*step;
  pbrCamera[2]+=(forward*cy*cp-right*sy)*step;
}
setVsync(pbrWin, 1);
while(pump(pbrWin)&&isOpen(pbrWin)) {
  beginFrame(pbrWin);
  if(fpsPbrInput.key(pbrWin,2,0)){endFrame(pbrWin);break;}
  const fpsPbrTime=performance.now();
  const fpsCityDt=Math.min(0.05,Math.max(0,(fpsPbrTime-fpsPbrLastTime)/1000));
  fpsPbrMoveCamera(fpsCityDt);fpsCityLifeStep(fpsCityDt);
  fpsPbrLastTime=fpsPbrTime;
  const fpsPbrHeight=winHeight(pbrWin);
  if(fpsPbrHeight>0)pbrCamera[6]=winWidth(pbrWin)/fpsPbrHeight;
  setCamBuf(pbrWin,pbrCamera);frustumBeginBuf(pbrCamera);frustumParams(fParams);
  prepararDesenho(pbrCfg,fParams,-1,1);drawSceneObjects(pbrScene,pbrScene.objects.length,pbrWin,pbrCfg);
  drawText(pbrWin,{x:28,y:25,text:"RTS / GOLDEN HOUR",size:24,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:58,text:"20 pedestres / 8 carros | Rotas + estados: andar, esperar, virar | Camera livre",size:15,color:0xffd5d9dd});
  drawText(pbrWin,{x:28,y:82,text:pbrFpsText,size:18,color:0xfff5f1e8});
  drawText(pbrWin,{x:28,y:108,text:"WASD: mover | Mouse direito: olhar | Q/E: altura | Shift: acelerar | R: restaurar | Esc: sair",size:15,color:0xfff5f1e8});
  if(pbrFrame===8&&pbrCapture.length>0) {
    if(!captureScene(pbrWin,pbrCapture,1280,800))throw new Error("PBR capture failed");
    // Capture consumes the queued geometry; refill it for the visible frame.
    drawSceneObjects(pbrScene,pbrScene.objects.length,pbrWin,pbrCfg);
  }
  endFrame(pbrWin);pbrFrame++;
  const fpsCityRemaining=16.667-(performance.now()-fpsPbrTime);if(fpsCityRemaining>1)fpsCityTime.sleep_ms(Math.floor(fpsCityRemaining));
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
println("PASS pbr_city: "+pbrFrame+" frames");
