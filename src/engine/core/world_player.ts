import { FpsWorldField } from "./world_streaming";
import { FpsWorldCollision } from "./world_collision";
/** Terrain controller with substepped horizontal sliding against streamed bounds. */
export class FpsWorldPlayer {
  x:number=4;y:number=3.08;z:number=-42;yaw:number=0;
  grounded:boolean=true;running:boolean=false;distance:number=0;
  private vertical:number=0;private field:FpsWorldField;
  collision:FpsWorldCollision|null=null;
  constructor(field:FpsWorldField){this.field=field;}
  jump():void{if(this.grounded){this.vertical=7;this.grounded=false;}}
  step(forward:number,right:number,yaw:number,dt:number):void {
    const length=Math.sqrt(forward*forward+right*right);
    if(length>0){
      const dx=(forward*Math.sin(yaw)+right*Math.cos(yaw))/length,dz=(forward*Math.cos(yaw)-right*Math.sin(yaw))/length;
      const speed=this.running?9:5,travel=speed*Math.max(0,Math.min(1,dt)),steps=Math.max(1,Math.ceil(travel/.18));
      const sx=dx*travel/steps,sz=dz*travel/steps;
      for(let i=0;i<steps;i++){
        const oldX=this.x,oldZ=this.z;
        if(this.collision===null||this.collision.canOccupy(this.x+sx,this.y,this.z))this.x+=sx;
        if(this.collision===null||this.collision.canOccupy(this.x,this.y,this.z+sz))this.z+=sz;
        this.distance+=Math.sqrt((this.x-oldX)*(this.x-oldX)+(this.z-oldZ)*(this.z-oldZ));
      }
      this.yaw=Math.atan2(dx,dz);
    }
    let ground=this.field.height(this.x,this.z);
    const lx=this.x-Math.floor(this.x/128)*128,lz=this.z-Math.floor(this.z/128)*128;
    if(lx<8||lz<8)ground=Math.max(1,ground)+.08;
    if(this.grounded)this.y=ground;
    else{this.vertical-=20*dt;this.y+=this.vertical*dt;if(this.y<=ground){this.y=ground;this.vertical=0;this.grounded=true;}}
  }
}
