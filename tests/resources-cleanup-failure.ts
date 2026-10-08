import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { Scene } from "@engine/core/scene";
import { resourceCache } from "@engine/core/resources";
function check(ok:boolean,msg:string):void {if(!ok)throw new Error(msg);}
class Failing extends Behavior { releaseResources():void {throw new Error("cleanup failure");} }
class Good extends Behavior { calls:number=0;releaseResources():void {this.calls++;} }
const cache=resourceCache<any>("cleanup-test");let released=0;
const o=new GameObject("Broken"),first=new Failing(),good=new Good();o.addBehavior(first);o.addBehavior(good);
o.setModelResource(cache.acquire("model",()=>[{meshId:123}],()=>{released++;}),"test",0);
let failed=false;try{o.releaseResources();}catch(e){failed=true;}
check(failed&&good.calls===1&&released===1&&o.customMesh===0,"falha de componente nao prende outros recursos");
failed=false;try{o.removeBehavior(0);}catch(e){failed=true;}
check(failed&&first.owner===null&&o.behaviors.length===1&&o.behaviors[0]===good,"componente com falha e desanexado");
const scene=new Scene("cleanup"),a=new GameObject("A"),b=new GameObject("B"),ba=new Good(),bb=new Good();
a.addBehavior(new Failing());a.addBehavior(ba);b.addBehavior(bb);scene.add(a);scene.add(b);
failed=false;try{scene.clear();}catch(e){failed=true;}
check(failed&&ba.calls===1&&bb.calls===1,"limpa todos os objetos");
check(scene.count()===0&&scene.trs.length===0&&a.uiOwner===null&&b.uiOwner===null&&a.sceneIndex===-1,"cena e donos consistentes");scene.clear();
scene.add(a,false);scene.add(b,false);b.parent=0;failed=false;try{scene.removeAt(0);}catch(e){failed=true;}
check(failed&&scene.count()===1&&scene.objects[0]===b&&b.parent===-1&&a.uiOwner===null,"removeAt conclui bookkeeping antes de falhar");scene.clear();
console.log("resources-cleanup-failure OK");
