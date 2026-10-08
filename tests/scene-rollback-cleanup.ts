import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { sceneFromJSON } from "../src/editor/sceneio";
function check(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
class Track extends Behavior {calls:number=0;fail:boolean=false;releaseResources():void {this.calls++;if(this.fail)throw new Error("secondary cleanup");}}
class MountFailure extends Behavior {target:Scene;spawn:GameObject;constructor(target:Scene,spawn:GameObject){super();this.target=target;this.spawn=spawn;}mount():void {this.target.add(this.spawn);throw new Error("primary mount");}}
class FaultScene extends Scene {
  created:GameObject[]=[]; trackers:Track[]=[]; spawn:GameObject=new GameObject("Spawned"); spawnTrack:Track=new Track(); inject:boolean=true;
  constructor(){super("Previous");this.spawn.addBehavior(this.spawnTrack);}
  add(go:GameObject,mount:boolean=true):GameObject {
    if(this.inject&&go.name.indexOf("New")===0){
      this.created.push(go);const tracker=new Track();tracker.fail=go.name==="New broken";this.trackers.push(tracker);go.addBehavior(tracker);
      if(tracker.fail)go.addBehavior(new MountFailure(this,this.spawn));
    }
    return super.add(go,mount);
  }
}
function descriptor(name:string):any{return {name,mesh:0,pos:[0,0,0],rot:[0,0,0],color:[1,1,1]};}
const target=new FaultScene(),original=new GameObject("Original"),originalTrack=new Track();original.addBehavior(originalTrack);target.add(original);target.computeWorld();
const payload=JSON.stringify({name:"Replacement",objects:[descriptor("New good"),descriptor("New broken"),descriptor("New unmounted")]});
let message="";try{sceneFromJSON(payload,target);}catch(error){message=error.message;}
check(message==="primary mount","erro primario preservado");
check(target.count()===1&&target.objects[0]===original&&target.trs[0]===original.transform,"originais restaurados");
check(target.name==="Previous"&&originalTrack.calls===0,"autoria preservada sem descarte");
check(target.trackers.length===2&&target.trackers[0].calls===1&&target.trackers[1].calls===1&&target.spawnTrack.calls===1,"limpeza continua e inclui objeto criado no mount");
check(target.created[0].uiOwner===null&&target.created[1].uiOwner===null&&target.spawn.uiOwner===null,"staging desanexado");
target.inject=false;sceneFromJSON(JSON.stringify({name:"Recovered",objects:[descriptor("New valid")]}),target);
check(target.name==="Recovered"&&target.count()===1&&originalTrack.calls===1,"nova carga apos rollback");target.clear();
const oldBad=new GameObject("Old bad"),oldGood=new GameObject("Old good"),badTrack=new Track(),goodTrack=new Track();badTrack.fail=true;oldBad.addBehavior(badTrack);oldGood.addBehavior(goodTrack);target.add(oldBad);target.add(oldGood);
message="";try{sceneFromJSON(JSON.stringify({name:"Committed",objects:[descriptor("Valid")]}),target);}catch(error){message=error.message;}
check(message==="secondary cleanup"&&badTrack.calls===1&&goodTrack.calls===1,"descarta todos os objetos antigos");
check(target.name==="Committed"&&target.count()===1&&target.objects[0].name==="Valid","metadados consistentes apos publicacao");target.clear();
console.log("scene-rollback-cleanup OK");
