import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { scene, S } from "../src/editor/control/session";
import { playMode } from "../src/editor/play_mode";
import { history } from "../src/editor/undo";
function check(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
class Failing extends Behavior { releaseResources():void {throw new Error("stop cleanup failure");} }
class Good extends Behavior {calls:number=0;releaseResources():void {this.calls++;}}
const original=new GameObject("Authoring");scene.add(original);scene.name="Original scene";
S.selected=0;S.selection=[0];history.u=["original undo"];history.r=["original redo"];
const savedUndo=history.u,savedRedo=history.r;
check(playMode.play(),"Play inicia");
const simulation=scene.objects[0];const good=new Good();simulation.addBehavior(new Failing());simulation.addBehavior(good);
const extra=new GameObject("Spawned"),extraGood=new Good();extra.addBehavior(extraGood);scene.add(extra);
scene.name="Simulation scene";S.selected=1;S.selection=[1];
let message="";try{playMode.stop();}catch(error){message=error.message;}
check(message==="stop cleanup failure","erro de descarte propagado");
check(good.calls===1&&extraGood.calls===1,"todos os componentes descartados");
check(scene.count()===1&&scene.objects[0]===original&&scene.name==="Original scene","autoria restaurada");
check(S.simulating===0&&S.playing===0&&S.selected===0&&S.selection[0]===0,"estado e selecao restaurados");
check(history.u===savedUndo&&history.r===savedRedo,"historico restaurado");
check(playMode.originals.length===0&&simulation.sceneIndex===-1,"copias desanexadas");
playMode.stop();check(playMode.play(),"novo Play apos erro");playMode.stop();
check(scene.objects[0]===original,"novo ciclo preserva autoria");scene.clear();
console.log("play-stop-cleanup-failure OK");
