import { openWindow,pump,isOpen,beginFrame,endFrame,close,drawText,setExposure,captureScene } from "rts:egui";
import process from "node:process";
import { Scene } from "@engine/core/scene";
import { ProceduralWorld } from "@engine/core/procedural_world";
import input from "@compat/input.ts";
import { initMeshes,setCamBuf,setLightsBuf,setSkyBuf,setVsync,frustumBeginBuf,frustumParams,winWidth,winHeight } from "@engine/render/gpu3d";
import { drawSceneObjects,prepararDesenho,DS_FLOATS,fParams } from "@engine/render/scenedraw";

const win=openWindow("RTS | ProceduralWorld como componente",1280,800,0);initMeshes(win);setVsync(win,1);
const scene=new Scene(),object=scene.createGameObject("Mundo procedural"),world=new ProceduralWorld();
world.chunkRadius=1;world.seed=Number(process.env.RTS_CITY_SEED||"42");object.addBehavior(world);scene.computeWorld();
if(process.env.RTS_WORLD_GENERATOR==="voxel"){world.generator="voxel";world.biomes=true;world.chunkRadius=2;}
const camera=new Float64Array([4,38,-42,0,-.13,1.05,1.6,.15,390,0,5]),cfg=new Float64Array(DS_FLOATS);
if(world.generator==="voxel"){camera[0]=20;camera[1]=52;camera[2]=-20;camera[3]=.35;camera[4]=-.65;}
setLightsBuf(win,new Float64Array([0,0,0,0,-.25,-.23,-1,1,.7,.46,3,0,0,0,1,0]),1);
setSkyBuf(win,new Float64Array([1,.14,.23,.39,.94,.5,.28,.1,.13,.16,-.25,-.23,-1,.029,0,1,0,2,1,1,1,.4]));setExposure(win,1.05);
const limit=Number(process.env.RTS_PBR_FRAMES||"0"),capture=process.env.RTS_PBR_CAPTURE||"";
let last=performance.now(),readyFrames=0,phase=0;
const deadline=last+120000;
const help={x:22,y:20,text:"ProceduralWorld no GameObject | WASD + mouse direito | Q/E altura | Esc fecha",size:18,color:0xffffffff};
while(pump(win)&&isOpen(win)){
  if(input.key(win,2,0))break;
  const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;
  if(limit>0&&now>deadline)throw new Error("Component load timed out");
  if(limit===0){
  if(input.mouseDown(win,1)){camera[3]+=input.mouseDeltaX(win)*.004;camera[4]=Math.max(-1.4,Math.min(1.4,camera[4]-input.mouseDeltaY(win)*.004));}
  const speed=dt*35,sy=Math.sin(camera[3]),cy=Math.cos(camera[3]);
  if(input.key(win,122,0)){camera[0]+=sy*speed;camera[2]+=cy*speed;}
  if(input.key(win,118,0)){camera[0]-=sy*speed;camera[2]-=cy*speed;}
  if(input.key(win,100,0)){camera[0]-=cy*speed;camera[2]+=sy*speed;}
  if(input.key(win,103,0)){camera[0]+=cy*speed;camera[2]-=sy*speed;}
  if(input.key(win,104,0))camera[1]+=speed;
  if(input.key(win,116,0))camera[1]-=speed;
  }
  camera[6]=winWidth(win)/Math.max(1,winHeight(win));
  beginFrame(win);setCamBuf(win,camera);frustumBeginBuf(camera);frustumParams(fParams);prepararDesenho(cfg,fParams,-1,1);
  drawSceneObjects(scene,scene.objects.length,win,cfg);
  drawText(win,help);
  if(world.loadError().length>0)throw new Error(world.loadError());
  if(world.isReady())readyFrames++;
  if(readyFrames===8&&capture.length>0){println("Component camera "+camera[0]+","+camera[1]+","+camera[2]);captureScene(win,capture,1280,800);}
  endFrame(win);
  if(limit>0&&readyFrames>=limit){
    if(phase===0){
      if(world.resourceBytes()<=0)throw new Error("No component mesh resources");
      if(world.generator==="voxel")world.regenerate();
      else{world.brushX=32;world.brushZ=32;world.paintVegetation(-1);}
      if(world.resourceBytes()!==0)throw new Error("Painting leaked resources");
      phase=1;readyFrames=0;
    }else break;
  }
}
scene.clear();scene.clear();
if(world.resourceBytes()!==0)throw new Error("Scene cleanup leaked resources");
close(win);
if(limit>0){if(phase!==1||readyFrames<limit)throw new Error("Component test interrupted");println("PASS component GPU: "+world.generator+", scene renderer, worker, rebuild, scene clear and repeated cleanup");}
