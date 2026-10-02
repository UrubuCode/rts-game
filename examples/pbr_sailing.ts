import { openWindow,pump,isOpen,beginFrame,endFrame,close,drawText,captureScene,setExposure,setVsync } from "rts:egui";
import process from "node:process";
import input from "@compat/input.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { WaterSurface } from "@engine/core/water_surface";
import { SailboatController } from "@engine/core/sailboat_controller";
import { SailboatRenderer } from "@engine/core/sailboat_renderer";
import { initMeshes,setCamBuf,setLightsBuf,setLgtBuf,setShadowBuf,setSkyBuf,frustumBeginBuf,frustumParams,winWidth,winHeight } from "@engine/render/gpu3d";
import { drawSceneObjects,prepararDesenho,DS_FLOATS,fParams } from "@engine/render/scenedraw";
import { benchInit,benchFrameBegin,benchCpuEnd,benchFrameEnd } from "@engine/core/frame_bench";

const win=openWindow("RTS | Mar Aberto - veleiro jogavel",1280,800,0);initMeshes(win);benchInit();if(process.env.RTS_VSYNC==="0")setVsync(win,false);
const scene=new Scene("Mar Aberto"),cfg=new Float64Array(DS_FLOATS),camera=new Float64Array([0,10,-24,0,-.25,.95,1.6,.1,650,0,5]);
setSkyBuf(win,new Float64Array([1,.13,.28,.43,.91,.58,.32,.12,.16,.16,-.5,-.32,.4,.0015,0,1,0,2,1,1,1,.8]));
setLightsBuf(win,new Float64Array([0,0,0,0,-.5,-.6,.4,1,.75,.46,3,0,0,0,1,0]),1);
setLgtBuf(win,new Float64Array([-30,60,-20,.35]));setShadowBuf(win,new Float64Array([-.5,-.6,.4,0,1,1,32]));setExposure(win,1);
const ocean=new GameObject("Ocean"),water=new WaterSurface();water.width=800;water.length=800;water.waveAmplitude=.45;water.wavelength=24;water.waveSpeed=.8;water.resolution=128;water.red=.012;water.green=.14;water.blue=.18;water.foamWidth=.16;water.reflectionStrength=.65;ocean.addBehavior(water);scene.add(ocean);
function solid(name:string,pos:number[],size:number[],color:number):GameObject {
  const o=new GameObject(name);o.setMesh(1,(color>>16)&255,(color>>8)&255,color&255);o.transform.setPosition(pos[0],pos[1],pos[2]);o.transform.sx=size[0];o.transform.sy=size[1];o.transform.sz=size[2];scene.add(o);return o;
}
solid("Leito",[0,-25,0],[820,2,820],0x315b58);
const islands=new Float64Array([-65,85,24, 100,140,30, -125,220,36, 160,-60,28]);
for(let i=0;i<islands.length;i+=3){
  const x=islands[i],z=islands[i+1],r=islands[i+2];
  const sand=solid("Areia",[x,-2,z],[r*2,8,r*2],0xc6b47a);sand.meshKind=4;
  const grass=solid("Ilha",[x,0,z],[r*1.55,8,r*1.55],0x467954);grass.meshKind=4;
  for(let j=0;j<6;j++){
    const a=j*2.4,px=x+Math.sin(a)*r*.45,pz=z+Math.cos(a)*r*.45;
    solid("Palmeira",[px,6,pz],[.65,7,.65],0x785a37);
    for(let k=0;k<3;k++){const crown=solid("Copa",[px,9.2+k*.18,pz],[8,.35,1.7],0x28583a);crown.transform.ry=k*Math.PI/3;}
  }
}
solid("Farol",[-65,9,85],[4,14,4],0xe8d6b0);solid("Farol topo",[-65,17,85],[5,2,5],0xb34632);
for(let i=0;i<12;i++)solid("Pier",[-35,1.2,-15+i*1.2],[6,.3,1],0x8e704d);
for(let i=0;i<4;i++)for(let side=-1;side<=1;side+=2)solid("Pilar",[-35+side*2.6,-1,-14+i*4],[.3,5,.3],0x584431);
const boat=new GameObject("Veleiro"),controller=new SailboatController();boat.addBehavior(controller);const boatRenderer=new SailboatRenderer();boatRenderer.enabled=process.env.RTS_SAILING_RENDER_DISABLED==="1"?0:1;boat.addBehavior(boatRenderer);scene.add(boat);scene.computeWorld();
const route=new Float64Array([0,65,50,110,30,185,-40,200,-35,15]);const buoys:GameObject[]=[];
for(let i=0;i<route.length;i+=2){const b=solid("Boia",[route[i],1.3,route[i+1]],[1.5,2,1.5],0xe3b753);buoys.push(b);solid("Bandeira",[route[i],3,route[i+1]],[1.7,.9,.08],0xe9dcb5);}
let checkpoint=0,firstPerson=false,orbit=0,pitch=.22,anchorHeld=false,cameraHeld=false,resetHeld=false;
let previous=performance.now(),sampleTime=previous,frame=0,sampleFrames=0,hud="Preparando navegacao...",objective="Passe perto da primeira boia dourada, em frente.";
const frames=Number(process.env.RTS_PBR_FRAMES||"0"),capture=process.env.RTS_PBR_CAPTURE||"",auto=process.env.RTS_SAILING_AUTOPILOT==="1";
while(pump(win)&&isOpen(win)){
  benchFrameBegin();beginFrame(win);if(input.key(win,2,0)){endFrame(win);break;}
  const now=performance.now(),dt=Math.min(.05,Math.max(.001,(now-previous)/1000));previous=now;
  controller.setRudder((input.key(win,103,0)?1:0)-(input.key(win,100,0)?1:0));
  const sailDelta=(input.key(win,122,0)?1:0)-(input.key(win,118,0)?1:0);controller.setSail(controller.sailAmount()+sailDelta*dt*.45);
  if(auto)controller.setSail(1);
  const anchor=!!input.key(win,3,0),cam=!!input.key(win,102,0),reset=!!input.key(win,117,0);
  if(anchor&&!anchorHeld)controller.toggleAnchor();if(cam&&!cameraHeld){firstPerson=!firstPerson;orbit=0;}
  if(reset&&!resetHeld){controller.resetMotion();boat.transform.setPosition(0,.55,0);boat.transform.ry=0;checkpoint=0;objective="Rota reiniciada. Siga as boias douradas.";}
  anchorHeld=anchor;cameraHeld=cam;resetHeld=reset;
  if(input.mouseDown(win,1)){orbit+=input.mouseDeltaX(win)*.004;pitch=Math.max(-.1,Math.min(.65,pitch+input.mouseDeltaY(win)*.003));}
  const t=boat.transform,oldX=t.px,oldZ=t.pz;scene.update(dt);
  let blocked=Math.abs(t.px)>320||Math.abs(t.pz)>320;
  for(let i=0;i<islands.length;i+=3){const dx=t.px-islands[i],dz=t.pz-islands[i+1];if(dx*dx+dz*dz<(islands[i+2]+3)**2)blocked=true;}
  if(t.px>-42&&t.px<-28&&t.pz>-20&&t.pz<3)blocked=true;
  if(blocked){t.px=oldX;t.pz=oldZ;controller.stopMotion();objective="Agua rasa ou obstaculo. R reposiciona o veleiro.";}
  if(checkpoint<buoys.length){const dx=t.px-route[checkpoint*2],dz=t.pz-route[checkpoint*2+1];if(dx*dx+dz*dz<100){checkpoint++;objective=checkpoint===buoys.length?"Rota concluida! Explore o arquipelago ou pressione R.":"Boia alcançada! Siga para a proxima boia dourada.";}}
  scene.computeWorld();
  const heading=t.ry+orbit,distance=firstPerson?0:22;
  camera[0]=t.px-Math.sin(heading)*distance-Math.sin(t.ry)*(firstPerson?2.5:0);
  camera[1]=t.py+(firstPerson?2.6:7+pitch*12);camera[2]=t.pz-Math.cos(heading)*distance-Math.cos(t.ry)*(firstPerson?2.5:0);
  camera[3]=heading;camera[4]=firstPerson?-.04-pitch*.2:-.24-pitch*.35;
  if(winHeight(win)>0)camera[6]=winWidth(win)/winHeight(win);
  setCamBuf(win,camera);frustumBeginBuf(camera);frustumParams(fParams);prepararDesenho(cfg,fParams,-1,1);drawSceneObjects(scene,scene.objects.length,win,cfg);
  drawText(win,{x:28,y:24,text:"MAR ABERTO  /  PROTOTIPO DE NAVEGACAO",size:23,color:0xffffe4ae});
  drawText(win,{x:28,y:58,text:hud,size:17,color:0xffeff7f4});
  drawText(win,{x:28,y:86,text:objective,size:16,color:0xffffd987});
  drawText(win,{x:28,y:winHeight(win)-60,text:"W/S: abrir/recolher vela   A/D: leme   Espaco: ancora   C: camera de bordo",size:16,color:0xffeff7f4});
  drawText(win,{x:28,y:winHeight(win)-35,text:"Mouse direito: olhar   R: reiniciar   Esc ou X: sair",size:15,color:0xffeff7f4});
  if(capture!==""&&frame===120){captureScene(win,capture,1280,800);drawSceneObjects(scene,scene.objects.length,win,cfg);}
  benchCpuEnd();endFrame(win);frame++;sampleFrames++;if(benchFrameEnd()!==0)break;
  if(now-sampleTime>.3){hud="Vela "+Math.round(controller.sailAmount()*100)+"%  |  "+controller.forwardSpeed().toFixed(1)+" m/s  |  "+(controller.isAnchored()?"ANCORA BAIXADA":"NAVEGANDO")+"  |  Boias "+checkpoint+"/"+buoys.length+"  |  "+Math.round(sampleFrames*1000/(now-sampleTime))+" FPS";sampleFrames=0;sampleTime=now;}
  if(frames>0&&frame>=frames)break;
}
scene.clear();close(win);println("PASS sailing: "+frame+" frames");
