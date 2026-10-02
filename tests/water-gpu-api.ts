import { openWindow,pump,isOpen,beginFrame,endFrame,close } from "rts:egui";
import gpu from "@compat/gpu";
import { initMeshes,drawWaterGPU,setCamBuf } from "@engine/render/gpu3d";
const win=openWindow("Teste água GPU",320,240,0);initMeshes(win);
const buffer=gpu.buffer(16);if(buffer<=0)throw new Error("GPU necessária");
gpu.write(buffer,new Float32Array([0,0,0,1]));
setCamBuf(win,new Float64Array([0,1,-4,0,-.15,1,1.33,.1,50,0,5]));
if(drawWaterGPU(win,buffer,2,.3)!==0)throw new Error("Contagem excedeu buffer");
if(drawWaterGPU(win,buffer,1,-1)!==0)throw new Error("Escala inválida aceita");
let frames=0;
while(frames<3&&pump(win)&&isOpen(win)){
  beginFrame(win);if(drawWaterGPU(win,buffer,1,.3)!==1)throw new Error("Desenho GPU recusado");endFrame(win);frames++;
}
gpu.bufferFree(buffer);close(win);if(frames!==3)throw new Error("Teste interrompido");
println("[PASSOU] water-gpu-api: buffer compute desenhado sem readback");
