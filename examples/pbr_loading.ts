import { openWindow,pump,isOpen,beginFrame,endFrame,close,drawText,drawRect } from "rts:egui";
import process from "node:process";
import input from "@compat/input.ts";
import { loadSceneAsync } from "@editor/sceneio";
import { LoadingScreen } from "@engine/render/loading_screen";
import { initMeshes,setCamBuf,setLgtBuf,frustumBeginBuf,frustumParams,winWidth,winHeight } from "@engine/render/gpu3d";
import { drawSceneObjects,prepararDesenho,DS_FLOATS,fParams } from "@engine/render/scenedraw";

const fpsLoadingWin=openWindow("RTS | Carregamento assincrono",1280,800,0);
const fpsLoadingUI=new LoadingScreen();
initMeshes(fpsLoadingWin);
const fpsLoadCamera=new Float64Array([65,80,-65,-0.5,-0.5,1.05,1.6,0.1,400,0,5]);
const fpsLoadCfg=new Float64Array(DS_FLOATS);
setLgtBuf(fpsLoadingWin,new Float64Array([-20,50,-20,0.3]));
const fpsLoadingStart=performance.now();
const fpsSceneLoading=loadSceneAsync("assets/pbr/loading-city.scene.json");
const fpsLoadingFrameLimit=Number(process.env.RTS_PBR_FRAMES||"0");
let fpsLoadingFrames=0,fpsLoadingReadyFrames=0;
let fpsLoadingLabel="Preparando worker...";
let fpsLoadingLastLabel=0;
while(pump(fpsLoadingWin)&&isOpen(fpsLoadingWin)){
  beginFrame(fpsLoadingWin);
  if(input.key(fpsLoadingWin,2,0)){endFrame(fpsLoadingWin);break;}
  fpsSceneLoading.tick(3);
  if(fpsSceneLoading.result!==null){
    const sc=fpsSceneLoading.result;
    const h=winHeight(fpsLoadingWin);if(h>0)fpsLoadCamera[6]=winWidth(fpsLoadingWin)/h;
    setCamBuf(fpsLoadingWin,fpsLoadCamera);frustumBeginBuf(fpsLoadCamera);frustumParams(fParams);
    prepararDesenho(fpsLoadCfg,fParams,-1,1);drawSceneObjects(sc,sc.objects.length,fpsLoadingWin,fpsLoadCfg);
    fpsLoadingReadyFrames++;
  }
  const elapsed=performance.now()-fpsLoadingStart;
  if(elapsed-fpsLoadingLastLabel>100||fpsSceneLoading.done){
    fpsLoadingLastLabel=elapsed;
    fpsLoadingLabel=fpsSceneLoading.state==="reading"?"Preparando a cidade":fpsSceneLoading.state==="creating"?"Construindo quarteirões":fpsSceneLoading.state==="activating"?"Dando vida à cidade":"Cidade pronta";
    if(fpsSceneLoading.error.length>0)fpsLoadingLabel="Não foi possível carregar a cidade. Esc para sair.";
  }
  if(fpsSceneLoading.result===null)fpsLoadingUI.draw(fpsLoadingWin,fpsLoadingLabel,fpsSceneLoading.progress);
  endFrame(fpsLoadingWin);fpsLoadingFrames++;
  if(fpsLoadingFrameLimit>0&&(fpsLoadingReadyFrames>=10||fpsLoadingFrames>=fpsLoadingFrameLimit))break;
}
fpsSceneLoading.cancel();close(fpsLoadingWin);
println("Loader: "+fpsSceneLoading.state+", frames="+fpsLoadingFrames+", max tick="+fpsSceneLoading.maxStepMs.toFixed(2)+" ms, elapsed="+((performance.now()-fpsLoadingStart)/1000).toFixed(2)+" s");
if(fpsLoadingFrameLimit>0&&fpsSceneLoading.state!=="ready")throw new Error("Scene loading did not complete: "+fpsSceneLoading.error);
