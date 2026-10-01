/** Published static chunk bounds. Gameplay sees exactly the chunks it can render. */
export class FpsWorldCollision {
  private chunks:any[]=[];
  get count():number{return this.chunks.length;}
  add(x:number,z:number,boxes:number[]):void {this.remove(x,z);this.chunks.push({x:x,z:z,boxes:boxes});}
  remove(x:number,z:number):void{for(let i=this.chunks.length-1;i>=0;i--)if(this.chunks[i].x===x&&this.chunks[i].z===z)this.chunks.splice(i,1);}
  canOccupy(x:number,y:number,z:number):boolean {
    let resident=false;const cx=Math.floor(x/128),cz=Math.floor(z/128),radius=.36;
    for(let i=0;i<this.chunks.length;i++){
      const c=this.chunks[i];if(c.x===cx&&c.z===cz)resident=true;
      if(Math.abs(c.x-cx)>1||Math.abs(c.z-cz)>1)continue;
      const px=x-c.x*128,pz=z-c.z*128,b=c.boxes;
      for(let k=0;k<b.length;k+=6)if(px+radius>b[k]&&px-radius<b[k+3]&&pz+radius>b[k+2]&&pz-radius<b[k+5]&&y+2.2>b[k+1]&&y<b[k+4])return false;
    }
    return resident;
  }
  clear():void{this.chunks.length=0;}
}
