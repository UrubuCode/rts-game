// Route graph + finite state machine, independent of rendering/window.
export const ROUTE_WAIT=0;
export const ROUTE_TURN=1;
export const ROUTE_WALK=2;
export class RouteNode {
  x:number;z:number;next:number[];wait:number;
  constructor(x:number,z:number,next:number[],wait:number){this.x=x;this.z=z;this.next=next;this.wait=wait;}
}
export class RouteMotion {
  nodes:RouteNode[];node:number;target:number;previous:number=-1;
  x:number;z:number;yaw:number=0;speed:number;state:number=ROUTE_WAIT;
  remaining:number;seed:number;distance:number=0;turnSpeed:number=2.4;
  constructor(nodes:RouteNode[],start:number,speed:number,seed:number){
    this.nodes=nodes;this.node=start;this.target=start;this.speed=speed;this.seed=seed;
    this.x=nodes[start].x;this.z=nodes[start].z;this.remaining=nodes[start].wait;
  }
  step(dt:number):void {
    if(!(dt>0)||!Number.isFinite(dt))return;
    let budget=dt;
    for(let transition=0;transition<32&&budget>0;transition++) {
      if(this.state===ROUTE_WAIT){
        const spent=Math.min(budget,this.remaining);this.remaining-=spent;budget-=spent;
        if(this.remaining>0)return;
        const links=this.nodes[this.node].next;if(links.length===0)return;
        this.seed=(this.seed*1664525+1013904223)|0;
        let pick=(this.seed>>>0)%links.length;
        if(links.length>1&&links[pick]===this.previous)pick=(pick+1)%links.length;
        this.target=links[pick];this.state=ROUTE_TURN;
      } else if(this.state===ROUTE_TURN){
        const dest=this.nodes[this.target];const desired=Math.atan2(dest.x-this.x,dest.z-this.z);
        let delta=desired-this.yaw;
        while(delta>Math.PI)delta-=Math.PI*2;while(delta<-Math.PI)delta+=Math.PI*2;
        const duration=Math.abs(delta)/this.turnSpeed;
        if(duration>budget){this.yaw+=(delta<0?-1:1)*this.turnSpeed*budget;return;}
        this.yaw=desired;budget-=duration;this.state=ROUTE_WALK;
      } else {
        if(this.speed<=0)return;
        const dest=this.nodes[this.target],dx=dest.x-this.x,dz=dest.z-this.z;
        const length=Math.sqrt(dx*dx+dz*dz),travel=Math.min(length,this.speed*budget);
        if(length>0){this.x+=dx/length*travel;this.z+=dz/length*travel;}
        this.distance+=travel;budget-=travel/this.speed;
        if(travel<length)return;
        this.x=dest.x;this.z=dest.z;this.previous=this.node;this.node=this.target;
        this.remaining=dest.wait;this.state=ROUTE_WAIT;
      }
    }
  }
}
