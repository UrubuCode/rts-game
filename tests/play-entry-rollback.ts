import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { scene, S } from "../src/editor/control/session";
import { playMode } from "../src/editor/play_mode";
import { history } from "../src/editor/undo";
function check(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
class Tracker extends Behavior {calls:number=0;fail:boolean=false;releaseResources():void {this.calls++;if(this.fail)throw new Error("secondary dispose");}}
const spawned=new GameObject("Spawned"),spawnTrack=new Tracker();spawned.addBehavior(spawnTrack);
class BrokenMount extends Behavior {mount():void {scene.add(spawned);scene.name="Changed";scene.ambiente.exposicao=99;S.selected=9;S.gameCamera=null;S.lightAmb=99;throw new Error("primary mount");}}
class Source extends GameObject {
  fail:boolean=false;last:GameObject|null=null;tracker:Tracker|null=null;
  cloneShallow():GameObject {const copy=super.cloneShallow();const tracker=new Tracker();tracker.fail=this.fail;copy.addBehavior(tracker);if(this.fail)copy.addBehavior(new BrokenMount());this.last=copy;this.tracker=tracker;return copy;}
}
const a=new Source("A"),b=new Source("B"),c=new Source("C");b.fail=true;scene.add(a);scene.add(b);scene.add(c);
scene.name="Original";scene.ambiente.exposicao=.7;S.selected=1;S.selection=[0,1];S.gameCamera=a;S.lightAmb=.3;
history.u=["undo"];history.r=["redo"];const undo=history.u,redo=history.r;
let message="";try{playMode.play();}catch(error){message=error.message;}
check(message==="primary mount","erro primario preservado");
check(scene.count()===3&&scene.objects[0]===a&&scene.objects[1]===b&&scene.objects[2]===c,"objetos originais restaurados");
check(a.tracker!==null&&a.tracker.calls===1&&b.tracker!==null&&b.tracker.calls===1&&c.tracker!==null&&c.tracker.calls===1&&spawnTrack.calls===1,"limpa copias montadas, nao montadas e spawn");
check(a.last!==null&&a.last.uiOwner===null&&spawned.uiOwner===null,"copias desanexadas");
check(scene.name==="Original"&&scene.ambiente.exposicao===.7&&S.lightAmb===.3,"ambiente restaurado");
check(S.selected===1&&S.selection.length===2&&S.gameCamera===a,"selecao e camera restauradas");
check(S.simulating===0&&S.playing===0&&history.u===undo&&history.r===redo&&playMode.originals.length===0,"estado e historico restaurados");
b.fail=false;check(playMode.play(),"Play funciona apos rollback");playMode.stop();check(scene.objects[0]===a,"Stop restaura autoria");scene.clear();
console.log("play-entry-rollback OK");
