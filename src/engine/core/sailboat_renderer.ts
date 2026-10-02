import { Behavior,KIND_RENDERER } from "./behavior";
import { SailboatController } from "./sailboat_controller";
import { meshUpload,meshFree } from "rts:egui";
import { drawGPUMeshQBuf,meshIdFor,DRAW_FLOATS } from "../render/gpu3d";
import { quatFromYawPitchInto,quatMulInto,quatRotateInto } from "../render/quat";
class BoatMesh {
  vertices:number[]=[];indices:number[]=[];
  triangle(a:number[],b:number[],c:number[]):void {
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.max(.00001,Math.sqrt(nx*nx+ny*ny+nz*nz));
    const base=this.vertices.length/8;
    this.vertices.push(a[0],a[1],a[2],nx/l,ny/l,nz/l,0,0,b[0],b[1],b[2],nx/l,ny/l,nz/l,1,0,c[0],c[1],c[2],nx/l,ny/l,nz/l,0,1);this.indices.push(base,base+1,base+2);
  }
  quad(a:number[],b:number[],c:number[],d:number[]):void{this.triangle(a,b,c);this.triangle(a,c,d);}
}
/**
 * @componentCategory Renderização
 * @componentDescription Veleiro procedural com casco, convés, mastro e vela; acompanha pitch e roll.
 * @componentKeywords barco navio sailboat vela
 */
export class SailboatRenderer extends Behavior {
  private window:number=0;
  private hull:number=0;
  private deck:number=0;
  private sailMesh:number=0;
  private controller:SailboatController|null=null;
  private draw:Float64Array=new Float64Array(DRAW_FLOATS);
  private rotation:Float64Array=new Float64Array(4);
  private roll:Float64Array=new Float64Array(4);
  private local:Float64Array=new Float64Array(3);
  private world:Float64Array=new Float64Array(3);
  private origin:Float64Array=new Float64Array(3);
  kind():number{return KIND_RENDERER;}
  drawsSelf():number{return 1;}
  rBoundRadius():number{return 15;}
  mount():void{if(this.owner!==null){this.owner.boundRadius=15;for(let i=0;i<this.owner.behaviors.length;i++){const b=this.owner.behaviors[i];if(b instanceof SailboatController)this.controller=b;}}}
  private initialize(win:number):void {
    this.releaseResources();this.window=win;const hull=new BoatMesh(),deck=new BoatMesh(),sail=new BoatMesh();
    const ring=[[-1.1,-4.5],[-1.9,-3],[-2,1],[-1.5,3],[0,5],[1.5,3],[2,1],[1.9,-3],[1.1,-4.5]];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      hull.quad([a[0],.3,a[1]],[a[0]*.55,-1.25,a[1]*.85],[b[0]*.55,-1.25,b[1]*.85],[b[0],.3,b[1]]);
      hull.triangle([0,-1.25,0],[a[0]*.55,-1.25,a[1]*.85],[b[0]*.55,-1.25,b[1]*.85]);
      deck.triangle([0,.32,0],[a[0],.32,a[1]],[b[0],.32,b[1]]);
    }
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      const x0=(col/8-.5)*5.5,x1=((col+1)/8-.5)*5.5,y0=3+row/8*4.8,y1=3+(row+1)/8*4.8;
      const z0=.4+Math.sin(col/8*Math.PI)*.8,z1=.4+Math.sin((col+1)/8*Math.PI)*.8;
      sail.quad([x0,y0,z0],[x1,y0,z1],[x1,y1,z1],[x0,y1,z0]);
    }
    this.hull=meshUpload(win,new Float32Array(hull.vertices),new Uint32Array(hull.indices));this.deck=meshUpload(win,new Float32Array(deck.vertices),new Uint32Array(deck.indices));this.sailMesh=meshUpload(win,new Float32Array(sail.vertices),new Uint32Array(sail.indices));
  }
  private pose(x:number,y:number,z:number):void {
    this.local[0]=x;this.local[1]=y;this.local[2]=z;quatRotateInto(this.world,this.rotation,this.local);
    const d=this.draw;d[0]=this.origin[0]+this.world[0];d[1]=this.origin[1]+this.world[1];d[2]=this.origin[2]+this.world[2];
  }
  private part(mesh:number,size:Float64Array,color:number):void {
    const d=this.draw;d[5]=size[0];d[6]=size[1];d[7]=size[2];d[8]=color;drawGPUMeshQBuf(this.window,mesh,d);
  }
  private size:Float64Array=new Float64Array(3);
  private scale(x:number,y:number,z:number):void{this.size[0]=x;this.size[1]=y;this.size[2]=z;}
  drawSelf(win:number,pos:Float64Array,tint:number):number {
    if(this.hull===0||this.window!==win)this.initialize(win);
    const t=this.host,d=this.draw;this.origin[0]=pos[0];this.origin[1]=pos[1];this.origin[2]=pos[2];quatFromYawPitchInto(this.rotation,t.ry,t.rx);
    this.roll[0]=0;this.roll[1]=0;this.roll[2]=Math.sin(t.rz*.5);this.roll[3]=Math.cos(t.rz*.5);quatMulInto(this.rotation,this.rotation,this.roll);
    for(let i=0;i<4;i++)d[12+i]=this.rotation[i];d[10]=0;d[11]=0;d[16]=0;
    this.pose(0,0,0);this.scale(1,1,1);this.part(this.hull,this.size,tint>=0?tint:0x513123);this.part(this.deck,this.size,0xb99059);
    this.pose(0,4.4,.4);this.scale(.22,8.8,.22);this.part(meshIdFor(1),this.size,0x583f29);
    this.pose(0,7.8,.4);this.scale(5.9,.18,.18);this.part(meshIdFor(1),this.size,0x654628);
    const deployed=this.controller===null?1:this.controller.sailAmount();
    this.pose(0,7.8*(1-Math.max(.06,deployed)),0);this.scale(1,Math.max(.06,deployed),1);this.part(this.sailMesh,this.size,0xeee0b8);
    for(let side=-1;side<=1;side+=2){
      this.pose(side*1.85,.9,-.4);this.scale(.13,.13,6);this.part(meshIdFor(1),this.size,0x52351f);
      for(let i=0;i<4;i++){this.pose(side*1.85,.6,-2.8+i*1.5);this.scale(.1,.65,.1);this.part(meshIdFor(1),this.size,0x52351f);}
    }
    this.pose(0,.65,-3.3);this.scale(2.2,.55,1.4);this.part(meshIdFor(1),this.size,0x795133);
    this.pose(0,1.5,-2.5);this.scale(.12,1.2,.12);this.part(meshIdFor(1),this.size,0x453321);
    return 1;
  }
  releaseResources():void{if(this.hull>0)meshFree(this.window,this.hull);if(this.deck>0)meshFree(this.window,this.deck);if(this.sailMesh>0)meshFree(this.window,this.sailMesh);this.hull=0;this.deck=0;this.sailMesh=0;this.window=0;}
}
