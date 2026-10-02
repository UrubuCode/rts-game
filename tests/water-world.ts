import { openWindow,pump,isOpen,beginFrame,endFrame,close,captureScene } from "rts:egui";
import { WorldStream } from "@engine/render/world_stream_render";
import { initMeshes,setCamBuf } from "@engine/render/gpu3d";
function check(ok:boolean,name:string):void{if(!ok)throw new Error(name);println("[OK] "+name);}
const win=openWindow("RTS | Agua nos chunks",640,480,0);initMeshes(win);
const world=new WorldStream(win,42,1),camera=new Float64Array([230,22,-36,0,-.45,1,1.33,.1,350,0,5]);
world.move(230,0);const deadline=performance.now()+90000;
while(!world.ready&&performance.now()<deadline&&pump(win)&&isOpen(win)){
  beginFrame(win);world.tick();world.update(1/60);setCamBuf(win,camera);world.draw(0,0,camera);endFrame(win);
  if(world.error.length>0)throw new Error(world.error);
}
check(world.ready,"chunks carregados em background");
const before=world.waterHeightAt(230,0);check(Number.isFinite(before),"rio residente tem superfície consultável");
world.draw(0,0,camera);const enabledDraws=world.drawCalls;world.waterEnabled=false;world.draw(0,0,camera);
check(world.drawCalls<enabledDraws&&!Number.isFinite(world.waterHeightAt(230,0)),"desligar água remove passe e empuxo");world.waterEnabled=true;
beginFrame(win);setCamBuf(win,camera);world.draw(0,0,camera);check(captureScene(win,"build/water-world.ppm",640,480),"captura de rio");endFrame(win);
world.move(1024,1024);check(!Number.isFinite(world.waterHeightAt(230,0)),"chunk descarregado não aplica empuxo");
world.move(230,0);check(world.ready&&world.cacheHits>0,"retorno reutiliza chunks do cache");
check(Math.abs(before-world.waterHeightAt(230,0))<.000001,"cache não reinicia ondas");
world.draw(128,0);const internal:any=world.water;
check(internal.data[20]===128&&Math.abs(before-world.waterHeightAt(230,0))<.000001,"floating origin preserva fase física");
world.dispose();world.dispose();close(win);check(world.budget.bytes===0,"buffers liberados");
println("[PASSOU] water-world");
