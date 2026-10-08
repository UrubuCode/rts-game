import { Material } from "../src/engine/core/material";
import { resolvePbrMaterial } from "../src/engine/render/pbr_material";
import { ResourceCache, ResourceScope, resourceCache, resourcePath, resourceStatistics, deferResourceDisposal, flushResourceDisposals } from "../src/engine/core/resources";
function check(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
const cache=new ResourceCache<any>("test");let loads=0;let disposed=0;
function load():any {loads++;return {id:loads};}
function dispose(value:any):void {disposed++;}
const a=cache.acquire("shared",load,dispose),b=cache.acquire("shared",load,dispose);
check(a.value===b.value&&loads===1,"um recurso para dois consumidores");
a.release();a.release();check(disposed===0,"soltar um consumidor preserva o outro");
b.release();check(disposed===1&&!cache.has("shared"),"ultimo consumidor libera uma vez");
const copyCache=new ResourceCache<any>("copy-test");
const retained=copyCache.acquire("copy",()=>({id:1}));
const retainedCopy=retained.retain(); retained.release();
check(retainedCopy.value.id>0&&copyCache.stats().references===1,"copia retida tem referencia independente");
let retainFailed=false;try{retained.retain();}catch{retainFailed=true;}
check(retainFailed,"referencia liberada nao pode ser ressuscitada");
retainedCopy.release(); check(copyCache.stats().entries===0,"ultima copia descarta entrada");
const c=cache.acquire("retained",load,dispose);cache.set("retained",c.value);c.release();
check(disposed===1,"cache retido preserva recurso");cache.evict("retained");check(disposed===2,"evict libera recurso ocioso");
const d=cache.acquire("scope",load,dispose);cache.set("scope",d.value);cache.clear();check(disposed===2,"clear preserva referencias ativas");
const scope=new ResourceScope();scope.keep(d);scope.release();scope.release();check(disposed===3,"scope libera uma vez");
let failed=false;try{cache.acquire("failure",()=>{throw new Error("expected");});}catch{failed=true;}
check(failed&&!cache.has("failure"),"falha nao envenena cache");
const retry=cache.acquire("failure",load,dispose);retry.release();
const failingScope=new ResourceScope();let cleaned=false;
failingScope.keep(cache.acquire("good-cleanup",()=>1,()=>{cleaned=true;}));
failingScope.keep(cache.acquire("bad-cleanup",()=>2,()=>{throw new Error("dispose");}));
let cleanupFailed=false;try{failingScope.release();}catch{cleanupFailed=true;}
check(cleanupFailed&&cleaned,"descarte com falha nao interrompe demais referencias");
const clearing=new ResourceCache<number>("clear-failure");let cleared=0;
const badPinned=clearing.acquire("bad",()=>1,()=>{throw null;});clearing.set("bad",1);badPinned.release();
const goodPinned=clearing.acquire("good",()=>2,()=>{cleared++;});clearing.set("good",2);goodPinned.release();
let sawNull=false;try{clearing.clear();}catch(error){sawNull=error===null;}
check(sawNull&&cleared===1&&clearing.stats().entries===0,"clear completa descarte e preserva throw null");
const nullScope=new ResourceScope();nullScope.keep(clearing.acquire("null",()=>3,()=>{throw null;}));
sawNull=false;try{nullScope.release();}catch(error){sawNull=error===null;}
check(sawNull&&clearing.stats().entries===0,"scope propaga throw null");nullScope.release();
let deferredGood=0;deferResourceDisposal(8,()=>{throw null;});deferResourceDisposal(8,()=>{deferredGood++;});
deferResourceDisposal(9,()=>{deferredGood++;});sawNull=false;
try{flushResourceDisposals(8);}catch(error){sawNull=error===null;}
check(sawNull&&deferredGood===1,"flush completa janela mesmo com throw null");
flushResourceDisposals(9);check(deferredGood===2,"outra janela preservada");
const shared=resourceCache<number>("registry-test");shared.set("key",7);
check(resourceCache<number>("registry-test").get("key")===7,"registro global compartilha namespaces");
check(resourcePath("assets/../assets/test.png")===resourcePath("./assets/test.png"),"caminhos equivalentes");
check(resourcePath("data:image/png;base64,AA")==="data:image/png;base64,AA","URI preservada");
check(resourceStatistics().length>0,"estatisticas disponiveis");
let deferred=0;
deferResourceDisposal(5,()=>{deferred++;});flushResourceDisposals(6);check(deferred===0,"descarta na janela correta");flushResourceDisposals(5);check(deferred===1,"descarte apos envio do quadro");
const material=new Material();material.gpuWindow=1;material.gpuMaterial=7;
material.gpuLast[1]=material.roughness;material.gpuLast[2]=material.normalScale;material.gpuLast[3]=material.occlusionStrength;
console.log("RESOURCE_GC_BEGIN");
for(let i=0;i<200000;i++){if(shared.get("key")!==7||resolvePbrMaterial(1,material)!==7)throw new Error("cache hit");flushResourceDisposals(1);}
console.log("RESOURCE_GC_END");
console.log("resources OK");
