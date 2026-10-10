import { SceneLoadOperation } from "@engine/core/scene_loading";
import { GameObject } from "@engine/core/gameobject";
import fs from "@compat/fs.ts";
import time from "@compat/time.ts";
function fpsLoadCheck(ok:boolean,msg:string):void{if(!ok)throw new Error(msg);}
function fpsLoadFactory(data:any):GameObject{return new GameObject(data.name);}
const fpsObjects:any[]=[];for(let i=0;i<80;i++)fpsObjects.push({name:"object-"+i,pos:[0,0,0],rot:[0,0],color:[255,255,255],mesh:1,parent:-1});
fs.write("build/async-scene-test.json",JSON.stringify({name:"Async test",objects:fpsObjects}));
const fpsLoad=new SceneLoadOperation("build/async-scene-test.json",fpsLoadFactory);
let fpsTicks=0,fpsProgress=0;const fpsDeadline=Date.now()+30000;
while(!fpsLoad.done&&Date.now()<fpsDeadline){fpsLoad.tick(2);fpsLoadCheck(fpsLoad.progress>=fpsProgress,"progress regressed");fpsProgress=fpsLoad.progress;fpsTicks++;time.sleep_ms(1);}
fpsLoadCheck(fpsLoad.state==="ready","load failed: "+fpsLoad.error);
fpsLoadCheck(fpsLoad.result!==null&&fpsLoad.result.objects.length===80,"partial scene published");
fpsLoadCheck(fpsTicks>2&&fpsLoad.progress===1,"load did not yield across frames");
const fpsBad=new SceneLoadOperation("build/does-not-exist-scene.json",fpsLoadFactory);
while(!fpsBad.done&&Date.now()<fpsDeadline){fpsBad.tick(2);time.sleep_ms(1);}
fpsLoadCheck(fpsBad.state==="failed"&&fpsBad.result===null,"missing file did not fail safely");
const fpsCancelled=new SceneLoadOperation("build/async-scene-test.json",fpsLoadFactory);fpsCancelled.cancel();
for(let i=0;i<10;i++){fpsCancelled.tick(2);time.sleep_ms(1);}
fpsLoadCheck(fpsCancelled.state==="cancelled"&&fpsCancelled.result===null,"cancelled load published scene");
const fpsFailure=new SceneLoadOperation("build/async-scene-test.json",(data:any)=>{throw new Error("factory failure");return new GameObject("unreachable");});
while(!fpsFailure.done&&Date.now()<fpsDeadline){fpsFailure.tick(2);time.sleep_ms(1);}
fpsLoadCheck(fpsFailure.state==="failed"&&fpsFailure.result===null,"factory failure published partial scene");
fs.write("build/async-cycle-test.json",JSON.stringify({objects:[{name:"a",parent:1},{name:"b",parent:0}]}));
const fpsCycle=new SceneLoadOperation("build/async-cycle-test.json",fpsLoadFactory);
while(!fpsCycle.done&&Date.now()<fpsDeadline){fpsCycle.tick(2);time.sleep_ms(1);}
fpsLoadCheck(fpsCycle.state==="failed"&&fpsCycle.result===null,"cyclic hierarchy accepted");
// Cadeia LONGA e válida: o filho aponta para o seguinte, e o último é raiz.
// A validação antiga subia a cadeia inteira por objeto — quadrático, e numa
// cena desse tamanho ela nunca chegava a mandar o cabeçalho. O teste mede só
// a VALIDAÇÃO: assim que o cabeçalho chega (estado sai de "reading") ela
// passou, e a operação é cancelada antes de construir objeto nenhum.
const FPS_CHAIN=100000;
const fpsChainObjects=[];
for(let i=0;i<FPS_CHAIN;i++)fpsChainObjects.push({name:"n"+i,parent:i===FPS_CHAIN-1?-1:i+1});
fs.write("build/async-chain-test.json",JSON.stringify({objects:fpsChainObjects}));
const fpsChain=new SceneLoadOperation("build/async-chain-test.json",fpsLoadFactory);
const fpsChainStart=Date.now();
const FPS_CHAIN_BUDGET_MS=20000;
while(fpsChain.state==="reading"&&!fpsChain.done&&Date.now()-fpsChainStart<FPS_CHAIN_BUDGET_MS){
  fpsChain.tick(2);time.sleep_ms(1);
}
const fpsChainMs=Date.now()-fpsChainStart;
fpsLoadCheck(fpsChain.state!=="reading"&&!fpsChain.done,
  "validacao da cadeia de "+FPS_CHAIN+" nao terminou em "+fpsChainMs+" ms (estado "+fpsChain.state+")");
fpsLoadCheck(fpsChain.total===FPS_CHAIN,"cabecalho da cadeia veio com total errado: "+fpsChain.total);
fpsChain.cancel();
println("PASS scene-loading cadeia: "+FPS_CHAIN+" objetos validados em "+fpsChainMs+" ms");
println("PASS scene-loading: worker load, monotonic progress, frame yielding, error and cancellation; ticks="+fpsTicks);
