import { FpsWorldField } from "./world_streaming";
const FPS_WORLD_BASIS=[0,0,1,1,0,0,0,1,0,0,0,-1,-1,0,0,0,1,0,1,0,0,0,0,-1,0,1,0,-1,0,0,0,0,1,0,1,0,0,1,0,1,0,0,0,0,-1,0,-1,0,1,0,0,0,0,1];
class FpsWorldGeometry {
  v:number[]=[];i:number[]=[];
  box(p:number[],s:number[]):void {
    const b=FPS_WORLD_BASIS;
    for(let f=0;f<6;f++){
      const a=f*9,n=this.v.length/8;
      for(let c=0;c<4;c++){
        const u=c===0||c===3?-1:1,t=c<2?-1:1;
        this.v.push(p[0]+(b[a]+b[a+3]*u+b[a+6]*t)*s[0]/2,p[1]+(b[a+1]+b[a+4]*u+b[a+7]*t)*s[1]/2,p[2]+(b[a+2]+b[a+5]*u+b[a+8]*t)*s[2]/2,b[a],b[a+1],b[a+2],u<0?0:1,t<0?0:1);
      }
      this.i.push(n,n+1,n+2,n,n+2,n+3);
    }
  }
}
class FpsWorldChunk {x:number;z:number;constructor(x:number,z:number){this.x=x;this.z=z;}}
/** One terrain row, lot, or GPU upload per step; no all-at-once chunk work. */
export class FpsWorldChunkJob {
  chunk:FpsWorldChunk;phase:number=0;done:boolean=false;
  geometry:FpsWorldGeometry[]=[];
  colliders:number[]=[];
  private field:FpsWorldField;
  private p:number[]=[0,0,0];private s:number[]=[0,0,0];
  private column:number=0;private lotPart:number=0;
  private lotHigh:number=0;private lotWidth:number=0;private lotHeight:number=0;private lotUrban:boolean=false;
  constructor(field:FpsWorldField,x:number,z:number){this.field=field;this.chunk=new FpsWorldChunk(x,z);for(let i=0;i<12;i++)this.geometry.push(new FpsWorldGeometry());}
  private box(kind:number,p:number[],s:number[]):void{this.geometry[kind].box(p,s);}
  private size(w:number,h:number,d:number):void{this.s[0]=w;this.s[1]=h;this.s[2]=d;}
  private block(kind:number,x:number,y:number,z:number):void{
    this.p[0]=x;this.p[1]=y;this.p[2]=z;this.box(kind,this.p,this.s);
  }
  private ground(x:number,z:number):number{return this.field.height(this.chunk.x*128+x,this.chunk.z*128+z);}
  private vertex(g:FpsWorldGeometry,x:number,z:number,road:number):void {
    const wx=this.chunk.x*128+x,wz=this.chunk.z*128+z,field=this.field;
    let y=field.height(wx,wz),nx=field.height(wx-1,wz)-field.height(wx+1,wz),nz=field.height(wx,wz-1)-field.height(wx,wz+1);
    if(road===1)y=Math.max(1,y)+.08;
    if(road===2){y=0;nx=0;nz=0;}
    const len=Math.sqrt(nx*nx+4+nz*nz);g.v.push(x,y,z,nx/len,2/len,nz/len,x/16,z/16);
  }
  private quad(kind:number,x:number,z:number,size:number):void{
    const road=kind===10?2:kind===2||kind===3?1:0;
    const g=this.geometry[kind],n=g.v.length/8;
    this.vertex(g,x,z,road);this.vertex(g,x,z+size,road);this.vertex(g,x+size,z,road);this.vertex(g,x+size,z+size,road);
    g.i.push(n,n+1,n+2,n+2,n+1,n+3);
  }
  private lot(index:number):boolean {
    const x=32+(index%3)*32,z=32+Math.floor(index/3)*32;
    const wx=this.chunk.x*128+x,wz=this.chunk.z*128+z;
    const choice=this.field.random(wx,wz),h=this.ground(x,z);
    const a=this.ground(x-10,z-10),b=this.ground(x+10,z-10),c=this.ground(x-10,z+10),d=this.ground(x+10,z+10);
    const low=Math.min(a,b,c,d),high=Math.max(a,b,c,d);
    if(this.lotPart===0){
      this.lotUrban=low>1&&high<9&&high-low<1.5&&choice>.15;
      this.lotHigh=high;this.lotWidth=17+choice*5;this.lotHeight=9+Math.floor(this.field.random(wx+1,wz)*10)*3;
    }
    if(this.lotUrban){
      const height=this.lotHeight,w=this.lotWidth;
      const kind=choice>.55?4:5;
      if(this.lotPart===0){
        this.colliders.push(x-w/2,high,z-w/2,x+w/2,high+height,z+w/2);
        this.size(27,.2,27);this.block(3,x,high+.05,z);
        this.size(w,height,w);this.block(kind,x,high+height/2,z);
        this.size(w+.7,.4,w+.7);this.block(3,x,high+height+.2,z);
      }else if(this.lotPart<=height){
        const floor=Math.floor((this.lotPart-1)/3),col=(this.lotPart-1)%3;
        const offset=-w*.32+col*w*.32,y=high+2+floor*3;
        const glass=(floor+col+index)%5===0?7:6;
        this.size(2,1.7,.08);this.block(glass,x+offset,y,z-w/2-.04);
        this.block(glass,x+offset,y,z+w/2+.04);
        this.size(.08,1.7,2);this.block(glass,x-w/2-.04,y,z+offset);
        this.block(glass,x+w/2+.04,y,z+offset);
      }else{this.size(3,1,3);this.block(9,x+w*.25,high+height+.7,z);this.lotPart=0;return true;}
    }else if(h>1&&h<92){
      if(this.lotPart<5){
        const i=this.lotPart;
        const tx=x-10+this.field.random(wx+i*3,wz+1)*20,tz=z-10+this.field.random(wx+1,wz+i*7)*20;
        const ty=this.ground(tx,tz),th=5+this.field.random(wx+i,wz+3)*5;
        if(ty>=1){
          this.colliders.push(tx-.325,ty,tz-.325,tx+.325,ty+th*.8,tz+.325);
          this.size(.65,th*.8,.65);this.block(9,tx,ty+th*.4,tz);
          this.size(th*.65,th*.55,th*.65);this.block(8,tx,ty+th*.65,tz);
          this.size(th*.4,th*.4,th*.4);this.block(8,tx,ty+th*.95,tz);
          this.size(th*.65,th*.8,th*.65);this.block(11,tx,ty+th*.75,tz);
        }
      }else{this.lotPart=0;return true;}
    }else{this.lotPart=0;return true;}
    this.lotPart++;return false;
  }
  step():void {
    if(this.done)return;
    if(this.phase<16){
      const row=this.phase;
      for(let col=this.column;col<this.column+4;col++){
        const h=this.ground(col*8+4,row*8+4),kind=h>48?1:0;
        this.quad(kind,col*8,row*8,8);
        if(col===0||row===0)this.quad(2,col*8,row*8,8);
        else if(col===1||row===1||col===15||row===15){if(h<10&&h>1)this.quad(3,col*8,row*8,8);}
      }
      this.column+=4;if(this.column<16)return;this.column=0;
    }else if(this.phase<25){if(!this.lot(this.phase-16))return;}
    else if(this.phase===25)this.quad(10,0,0,128);
    this.phase++;if(this.phase===26)this.done=true;
  }
}
