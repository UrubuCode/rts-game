import { createAppAt } from "@compat/app";
import { initMeshes } from "@engine/render/gpu3d";
import { Skeleton } from "@engine/core/skeleton";
import { resourceCache } from "@engine/core/resources";
import { acquireSkeletonAsset, loadSkeletonAsset, clearSkeletonCache } from "@engine/render/gltf_anim";
import { scene, S } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
function check(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
const path="assets/models/kenney/character-a.glb";
const cache=resourceCache<any>("skeletons");
const a=new Skeleton(path),b=new Skeleton("./"+path);
a.ensureAsset(0);b.ensureAsset(0);
check(a.asset===b.asset&&cache.stats().references===2&&cache.stats().pinned===0,"asset CPU compartilhado por caminho normalizado");
const originalCpu=b.asset!;a.poseT[0]+=7;const pose=a.poseT[0];
check(a.poseT!==b.poseT&&a.poseT[0]!==b.poseT[0],"poses por instancia");
const app=createAppAt("Skeleton resources test",480,240,120,90),win=app._win;initMeshes(win);S.win=win;
a.ensureAsset(win);
check(a.asset!==originalCpu&&a.asset!.uploadedWin===win&&a.asset!.partMesh[0]>0,"componente adota asset GPU");
check(b.asset===originalCpu&&b.asset!.partMesh[0]===0,"upload nao modifica consumidor CPU");
check(a.poseT[0]===pose,"upload preserva pose de trabalho");
b.ensureAsset(win);check(a.asset===b.asset&&cache.stats().entries===1&&cache.stats().references===2,"ultimo consumidor CPU transfere referencia");
const loads=cache.loads;for(let i=0;i<10;i++)b.ensureAsset(win);
check(cache.loads===loads&&cache.stats().references===2,"alias nao reconstroi asset por quadro");
a.releaseResources();check(cache.stats().references===1&&b.asset!.partMesh[0]>0,"outro personagem preservado");
b.ensureAsset(0);check(b.asset!.uploadedWin===win,"consulta CPU nao rebaixa asset da janela");
const go=scene.createGameObject("Character");go.addBehavior(b);
for(let i=0;i<3;i++){
 check(playMode.play(),"Play inicia");const copy=scene.objects[0].behaviors[0] as Skeleton;copy.ensureAsset(win);
 check(copy.asset===b.asset&&copy.poseT!==b.poseT&&cache.stats().references===2,"Play compartilha asset com pose independente");
 scene.removeAt(0);playMode.stop();check(scene.objects[0]===go&&cache.stats().references===1,"autoria sobrevive a remocao no Play");
}
go.removeBehavior(0);check(cache.stats().entries===0&&b.asset===null&&b.poseT.length===0,"ultima remocao solta asset e buffers");
if(app.beginFrame())app.endFrame();scene.clear();
let failed=false;let checkpoints=0;try{acquireSkeletonAsset(win,path,()=>{checkpoints++;if(checkpoints===3)throw new Error("cancelled");});}catch{failed=true;}
check(failed&&cache.stats().entries===0,"falha parcial nao publica asset");
if(app.beginFrame())app.endFrame();const retry=acquireSkeletonAsset(win,path);check(retry.value.partMesh[0]>0,"retry depois de falha");retry.release();
const legacy=loadSkeletonAsset(win,path);const consumer=acquireSkeletonAsset(win,path);clearSkeletonCache();
check(legacy===consumer.value&&cache.stats().references===1,"clear preserva referencias legadas ativas");consumer.release();
if(app.beginFrame())app.endFrame();
a.modelPath=path;a.ensureAsset(0);a.modelPath="";a.ensureAsset(0);check(a.asset===null&&cache.stats().entries===0,"trocar caminho diretamente solta asset anterior");
app.close();console.log("resources-skeleton-lifecycle OK");
