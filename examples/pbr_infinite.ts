import { openWindow,pump,isOpen,beginFrame,endFrame,close,drawText,captureScene,setExposure } from "rts:egui";
import process from "node:process";
import fpsInput from "@compat/input.ts";
import fpsTime from "@compat/time.ts";
import { FpsWorldStream } from "@engine/render/world_stream_render";
import { FpsWorldPlayer } from "@engine/core/world_player";
import { LoadingScreen as FpsLoadingScreen } from "@engine/render/loading_screen";
import { initMeshes,setCamBuf,setLightsBuf,setSkyBuf,setShadowBuf,setFogBuf,winWidth,winHeight,setVsync,drawGPUMeshBuf,meshIdFor,DRAW_FLOATS } from "@engine/render/gpu3d";

const fpsWin=openWindow("RTS | Horizonte / Mundo procedural",1280,800,0);
const fpsLoadUI=new FpsLoadingScreen();fpsLoadUI.subtitle="Entre ruas, rios e montanhas. Um mundo para explorar.";
// Let the OS present the loading screen before graphics initialization.
if(pump(fpsWin)&&isOpen(fpsWin)){beginFrame(fpsWin);fpsLoadUI.draw(fpsWin,"Preparando o horizonte",0);endFrame(fpsWin);}
initMeshes(fpsWin);
const fpsSeed=Number(process.env.RTS_CITY_SEED||"42");
const fpsCacheTest=process.env.RTS_WORLD_TEST==="cache";
const fpsWorld=new FpsWorldStream(fpsWin,fpsSeed,fpsCacheTest?1:2);
const fpsCamera=new Float64Array([4,38,-42,0,-.13,1.05,1.6,.15,390,0,5]);
let fpsWorldX=4,fpsWorldZ=-42;
const fpsSun=new Float64Array([0,0,0,0,-.25,-.23,-1,1,.7,.46,3,0,0,0,1,0]);
const fpsSky=new Float64Array([1,.14,.23,.39,.94,.5,.28,.1,.13,.16,-.25,-.23,-1,.029,0,1,0,2,1,1,1,.4]);
setLightsBuf(fpsWin,fpsSun,1);setSkyBuf(fpsWin,fpsSky);setExposure(fpsWin,1.05);
const fpsShadow=new Float64Array([-.25,-.23,-1,0,0,0,220]);setShadowBuf(fpsWin,fpsShadow);
setFogBuf(fpsWin,new Float64Array([.48,.37,.3,.002]));setVsync(fpsWin,1);
fpsWorld.move(fpsWorldX,fpsWorldZ);
let fpsStarted=false,fpsLast=performance.now(),fpsSample=fpsLast,fpsFrames=0,fpsReadyFrames=0,fpsCount=0;
let fpsStatus="",fpsRate="",fpsPhase=0,fpsPhaseFrames=0;
let fpsCachedReference:any=null,fpsCachedMesh=0,fpsGenerationBeforeReturn=0;
const fpsFrameSamples=new Float64Array(4096);let fpsSampleCount=0;
const fpsLimit=Number(process.env.RTS_PBR_FRAMES||"0"),fpsCapture=process.env.RTS_PBR_CAPTURE||"";
const fpsTest=process.env.RTS_WORLD_TEST==="1"||fpsCacheTest,fpsDeadline=performance.now()+120000;
const fpsPlayer=new FpsWorldPlayer(fpsWorld.field);
fpsPlayer.collision=fpsWorld.collision;
let fpsReportedLoadError=false;
let fpsFly=fpsTest;
if(!fpsFly)fpsCamera[4]=-.28;
const fpsPlayerDraw=new Float64Array(DRAW_FLOATS);
const fpsPlayerParts=[0,1.25,0,.7,.85,.38,0xf1b747, 0,1.98,0,.46,.46,.46,0xd4a17a, -.49,1.22,0,.23,.78,.25,0xf1b747, .49,1.22,0,.23,.78,.25,0xf1b747, -.2,.43,0,.27,.85,.3,0x344e71, .2,.43,0,.27,.85,.3,0x344e71];
function fpsDrawPlayer(ox:number,oz:number):void {
  const d=fpsPlayerDraw,sy=Math.sin(fpsPlayer.yaw),cy=Math.cos(fpsPlayer.yaw);
  d[4]=fpsPlayer.yaw;d[9]=0;d[16]=0;
  for(let part=0;part<6;part++){
    const i=part*7,x=fpsPlayerParts[i],z=fpsPlayerParts[i+2];
    d[0]=fpsPlayer.x-ox+x*cy+z*sy;d[1]=fpsPlayer.y+fpsPlayerParts[i+1];d[2]=fpsPlayer.z-oz-x*sy+z*cy;
    d[3]=part>=2?Math.sin(fpsPlayer.distance*2.7+(part%2)*Math.PI)*.35:0;
    d[5]=fpsPlayerParts[i+3];d[6]=fpsPlayerParts[i+4];d[7]=fpsPlayerParts[i+5];d[8]=fpsPlayerParts[i+6];drawGPUMeshBuf(fpsWin,meshIdFor(1),d);
  }
}
const fpsHud={x:26,y:22,text:"HORIZONTE / MUNDO PROCEDURAL",size:22,color:0xffeddbff};
const fpsInfo={x:26,y:53,text:"",size:15,color:0xeee3d8ff};
const fpsControls={x:26,y:79,text:"WASD andar • Mouse direito olhar • Shift correr • Espaço pular • F câmera livre • Esc sair",size:14,color:0xe3d8d2ff};
function fpsMove(dt:number):void {
  if(fpsInput.key(fpsWin,105,1)){
    fpsFly=!fpsFly;
    if(fpsFly){fpsCamera[1]=fpsPlayer.y+6;}
    else{fpsWorldX=fpsPlayer.x;fpsWorldZ=fpsPlayer.z;fpsCamera[4]=-.28;}
    fpsControls.text=fpsFly?"CÂMERA LIVRE • WASD mover • Mouse direito olhar • Q/E altura • Shift acelerar • F jogador • Esc sair":"JOGADOR • WASD andar • Mouse direito olhar • Shift correr • Espaço pular • F câmera livre • Esc sair";
  }
  if(fpsInput.key(fpsWin,117,0)){fpsWorldX=4;fpsWorldZ=-42;fpsPlayer.x=4;fpsPlayer.z=-42;fpsCamera[1]=38;fpsCamera[3]=0;fpsCamera[4]=-.28;return;}
  if(fpsInput.mouseDown(fpsWin,1)){fpsCamera[3]+=fpsInput.mouseDeltaX(fpsWin)*.004;fpsCamera[4]=Math.max(-1.4,Math.min(1.4,fpsCamera[4]-fpsInput.mouseDeltaY(fpsWin)*.004));}
  let forward=0,right=0,up=0;
  if(fpsInput.key(fpsWin,122,0))forward++;if(fpsInput.key(fpsWin,118,0))forward--;
  if(fpsInput.key(fpsWin,103,0))right++;if(fpsInput.key(fpsWin,100,0))right--;
  if(fpsInput.key(fpsWin,104,0))up++;if(fpsInput.key(fpsWin,116,0))up--;
  if(!fpsFly){
    fpsPlayer.running=fpsInput.modShift(fpsWin);
    if(fpsInput.key(fpsWin,3,1))fpsPlayer.jump();
    fpsPlayer.step(forward,right,fpsCamera[3],dt);fpsWorldX=fpsPlayer.x;fpsWorldZ=fpsPlayer.z;return;
  }
  const len=Math.sqrt(forward*forward+right*right+up*up);if(len===0)return;
  const speed=(fpsInput.modShift(fpsWin)?95:24)*dt/len,yaw=fpsCamera[3];
  fpsWorldX+=(forward*Math.sin(yaw)+right*Math.cos(yaw))*speed;
  fpsWorldZ+=(forward*Math.cos(yaw)-right*Math.sin(yaw))*speed;
  fpsCamera[1]=Math.max(2,fpsCamera[1]+up*speed);
}
while(pump(fpsWin)&&isOpen(fpsWin)){
  beginFrame(fpsWin);if(fpsInput.key(fpsWin,2,0)){endFrame(fpsWin);break;}
  const now=performance.now(),dt=Math.min(.05,Math.max(0,(now-fpsLast)/1000));fpsLast=now;
  if(fpsStarted&&!fpsTest)fpsMove(dt);
  fpsWorld.move(fpsWorldX,fpsWorldZ);fpsWorld.tick();
  if(fpsWorld.error.length>0&&!fpsReportedLoadError){println("World load error: "+fpsWorld.error);fpsReportedLoadError=true;if(fpsTest)throw new Error(fpsWorld.error);}
  if(!fpsStarted){
    fpsLoadUI.draw(fpsWin,fpsWorld.error.length>0?"Falha ao carregar a região. Esc para sair.":"Formando relevo, rios e bairros",Math.min(1,fpsWorld.progress*fpsWorld.window.x.length/9));
    if(fpsWorld.chunks.length>=9){fpsStarted=true;println("World playable: seed="+fpsSeed+", chunks="+fpsWorld.chunks.length+", max tick="+fpsWorld.maxStepMs.toFixed(2)+" ms");}
  }else{
    // Floating origin: only small local coordinates are converted to GPU floats.
    const ox=fpsWorld.window.cx*128,oz=fpsWorld.window.cz*128;
    fpsCamera[0]=fpsWorldX-ox;fpsCamera[2]=fpsWorldZ-oz;
    fpsCamera[1]=Math.max(fpsCamera[1],fpsWorld.field.height(fpsWorldX,fpsWorldZ)+3);
    if(!fpsFly){
      const yaw=fpsCamera[3],pitch=fpsCamera[4];
      fpsCamera[0]-=Math.sin(yaw)*Math.cos(pitch)*7;fpsCamera[2]-=Math.cos(yaw)*Math.cos(pitch)*7;
      fpsCamera[1]=Math.max(fpsPlayer.y+1.4-Math.sin(pitch)*7,fpsWorld.field.height(fpsCamera[0]+ox,fpsCamera[2]+oz)+.8);
    }
    const height=winHeight(fpsWin);if(height>0)fpsCamera[6]=winWidth(fpsWin)/height;
    setCamBuf(fpsWin,fpsCamera);fpsShadow[3]=fpsCamera[0];fpsShadow[4]=20;fpsShadow[5]=fpsCamera[2];setShadowBuf(fpsWin,fpsShadow);
    fpsWorld.draw(ox,oz,fpsCamera);if(!fpsTest)fpsDrawPlayer(ox,oz);fpsReadyFrames++;
    fpsHud.text="HORIZONTE / MUNDO PROCEDURAL";drawText(fpsWin,fpsHud);
    fpsInfo.text=fpsStatus;drawText(fpsWin,fpsInfo);drawText(fpsWin,fpsControls);
    if(fpsReadyFrames===8&&fpsCapture.length>0){if(!captureScene(fpsWin,fpsCapture,1280,800))throw new Error("World capture failed");fpsWorld.draw(ox,oz,fpsCamera);if(!fpsTest)fpsDrawPlayer(ox,oz);}
    if(fpsCacheTest&&fpsWorld.ready){
      fpsCamera[3]+=.12;fpsPhaseFrames++;
      if(fpsPhase===0&&fpsPhaseFrames===1){fpsCachedReference=fpsWorld.chunks[0];fpsCachedMesh=fpsCachedReference.ids[0];}
      if(fpsPhase===0&&fpsWorld.generated!==9)throw new Error("Camera rotation regenerated chunks");
      if(fpsPhaseFrames===60){
        if(fpsPhase===0){fpsWorldX+=128;fpsPhase=1;}
        else if(fpsPhase===1){fpsGenerationBeforeReturn=fpsWorld.generated;fpsWorldX-=128;fpsPhase=2;}
        else{
          if(fpsWorld.generated!==fpsGenerationBeforeReturn||fpsWorld.cacheHits<3)throw new Error("Return rebuilt cached chunks");
          if(fpsCachedReference.ids[0]!==fpsCachedMesh)throw new Error("Cached GPU mesh was replaced");
          let found=false;for(let i=0;i<fpsWorld.chunks.length;i++)if(fpsWorld.chunks[i]===fpsCachedReference)found=true;
          if(!found)throw new Error("Cached chunk identity was lost");
          println("PASS world cache GPU: camera rotation generated zero chunks; return reused "+fpsWorld.cacheHits+" chunks and preserved mesh handles");fpsPhase=4;
        }
        fpsPhaseFrames=0;
      }
    }else if(fpsTest&&fpsWorld.ready){
      fpsPhaseFrames++;
      if(fpsPhaseFrames===10){
        println("World phase "+fpsPhase+": resident="+fpsWorld.chunks.length+", generated="+fpsWorld.generated+", unloaded="+fpsWorld.unloaded);
        if(fpsWorld.chunks.length!==25)throw new Error("Unbounded resident chunks");
        fpsPhaseFrames=0;fpsPhase++;
        if(fpsPhase===1){fpsWorldX=520;fpsWorldZ=280;fpsCamera[1]=110;}
        else if(fpsPhase===2){fpsWorldX=-520;fpsWorldZ=-280;}
        else if(fpsPhase===3){fpsWorldX=4;fpsWorldZ=-42;}
      }
    }
  }
  endFrame(fpsWin);fpsFrames++;fpsCount++;
  const fpsRemaining=16.667-(performance.now()-now);if(fpsRemaining>1)fpsTime.sleep_ms(Math.floor(fpsRemaining));
  if(fpsStarted&&fpsReadyFrames>3&&fpsReadyFrames!==8){fpsFrameSamples[fpsSampleCount%4096]=performance.now()-now;fpsSampleCount++;}
  if(now-fpsSample>=1000){
    fpsRate=(fpsCount*1000/(now-fpsSample)).toFixed(1)+" FPS";
    fpsStatus=fpsRate+" | ativos "+fpsWorld.chunks.length+" | cache "+fpsWorld.cache.count+" | gerados "+fpsWorld.generated+" | GPU "+(fpsWorld.budget.bytes/1048576).toFixed(1)+" MiB | visíveis "+fpsWorld.visibleChunks+" | draws "+fpsWorld.drawCalls+(fpsWorld.error.length>0?" • falha na carga":fpsWorld.ready?"":" • carregando arredores");
    fpsSample=now;fpsCount=0;
  }
  if(fpsTest&&performance.now()>fpsDeadline)throw new Error("World streaming test timeout");
  if(fpsTest&&fpsPhase===4)break;
  if(!fpsTest&&fpsLimit>0&&fpsReadyFrames>=fpsLimit)break;
}
println("World stopped: generated="+fpsWorld.generated+", unloaded="+fpsWorld.unloaded+", max tick="+fpsWorld.maxStepMs.toFixed(2)+" ms");
println("World resources: peak mesh buffers="+(fpsWorld.budget.peakBytes/1048576).toFixed(2)+" MiB; visible="+fpsWorld.visibleChunks+", culled="+fpsWorld.culledChunks+", draws="+fpsWorld.drawCalls);
fpsWorld.dispose();close(fpsWin);
fpsWorld.dispose(); // Idempotent shutdown must not release the same handle twice.
if(fpsWorld.budget.bytes!==0||fpsWorld.budget.meshes!==0||fpsWorld.collision.count!==0)throw new Error("World resources leaked on shutdown");
if(fpsSampleCount>0){
  const samples:number[]=[];for(let i=0;i<Math.min(4096,fpsSampleCount);i++)samples.push(fpsFrameSamples[i]);
  samples.sort((a:number,b:number)=>a-b);
  println("World frame time: p95="+samples[Math.floor((samples.length-1)*.95)].toFixed(2)+" ms; max="+samples[samples.length-1].toFixed(2)+" ms; samples="+samples.length);
}
if(fpsTest){
  if(fpsPhase!==4||isOpen(fpsWin)||fpsWorld.chunks.length!==0||fpsWorld.cache.count!==0)throw new Error("Incomplete world streaming test");
  println(fpsCacheTest?"PASS world GPU cache: rotation, return, mesh reuse, disposal":"PASS world GPU streaming: travel, negative coordinates, eviction, regeneration, disposal");
}
