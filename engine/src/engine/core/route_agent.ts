import { Behavior } from "./behavior";
import { RoutePath } from "./route_path";
import { RouteMotion } from "./route_motion";
/**
 * @componentCategory IA e Navegacao
 * @componentDescription Segue o RoutePath do mesmo objeto: espera, vira e anda.
 * @componentKeywords agente rota npc estados patrulha
 */
export class RouteAgent extends Behavior {
  speed:number=1.3;
  startNode:number=0;
  seed:number=1;
  turnSpeed:number=2.4;
  /** @nonSerialized */
  motion:RouteMotion|null=null;
  private path:RoutePath|null=null;
  private revision:number=-1;
  typeName():string{return "RouteAgent";}
  mount():void {this.resetRoute();}
  resetRoute():void {
    this.motion=null;this.path=null;
    if(this.owner===null)return;
    for(let i=0;i<this.owner.behaviors.length;i++){
      const b=this.owner.behaviors[i];if(b instanceof RoutePath){this.path=b;break;}
    }
    const path=this.path;if(path===null||path.nodes.length===0)return;
    this.onValidate("");path.anchor();
    const start=Math.max(0,Math.min(path.nodes.length-1,this.startNode));
    this.motion=new RouteMotion(path.nodes,start,this.speed,this.seed);this.motion.turnSpeed=this.turnSpeed;this.revision=path.revision;
  }
  onValidate(field:string):void {
    this.speed=Number.isFinite(this.speed)?Math.max(0,Math.min(100,this.speed)):1.3;
    this.startNode=Number.isFinite(this.startNode)?Math.max(0,Math.floor(this.startNode)):0;
    this.seed=Number.isFinite(this.seed)?this.seed|0:1;
    this.turnSpeed=Number.isFinite(this.turnSpeed)?Math.max(0.1,Math.min(20,this.turnSpeed)):2.4;
  }
  update(dt:number):void {
    if(this.enabled===0)return;
    if(this.motion===null||this.path===null||this.revision!==this.path.revision)this.resetRoute();
    const motion=this.motion,path=this.path;if(motion===null||path===null||path.enabled===0)return;
    motion.speed=this.speed;motion.turnSpeed=this.turnSpeed;motion.step(dt);
    this.host.px=path.originX+motion.x;this.host.pz=path.originZ+motion.z;this.host.ry=motion.yaw;
  }
}
