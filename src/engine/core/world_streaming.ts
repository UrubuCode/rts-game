export const FPS_WORLD_CHUNK=128;
/** Stateless samples: generation order and unloading never change the world. */
export class FpsWorldField {
  seed:number;
  constructor(seed:number){this.seed=seed>>>0;}
  random(x:number,z:number):number {
    let h=(Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^this.seed)|0;
    h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;
  }
  noise(x:number,z:number):number {
    const ix=Math.floor(x),iz=Math.floor(z);let fx=x-ix,fz=z-iz;
    fx=fx*fx*(3-2*fx);fz=fz*fz*(3-2*fz);
    const a=this.random(ix,iz),b=this.random(ix+1,iz),c=this.random(ix,iz+1),d=this.random(ix+1,iz+1);
    return a+(b-a)*fx+(c-a)*fz+(a-b-c+d)*fx*fz;
  }
  height(x:number,z:number):number {
    const broad=this.noise(x/230+13,z/230-9);
    const detail=this.noise(x/65-7,z/65+31);
    let fade=Math.min(1,Math.max(0,(Math.sqrt(x*x+z*z)-90)/130));fade=fade*fade*(3-2*fade);
    const mountain=Math.max(0,broad-.38)*230*(.8+detail*.4)*fade;
    let h=3+mountain;
    // A continuous river with sloping banks; water remains at a common level.
    const riverX=230+Math.sin(z*.004)*70;
    let bank=Math.max(0,Math.min(1,(Math.abs(x-riverX)-9)/24));bank=bank*bank*(3-2*bank);
    h=-3+(h+3)*bank;return h;
  }
  vertexHeight(cx:number,cz:number,ix:number,iz:number):number {
    return this.height(cx*FPS_WORLD_CHUNK+ix*8,cz*FPS_WORLD_CHUNK+iz*8);
  }
}
/** Reused coordinate arrays, rebuilt only on chunk boundary crossings. */
export class FpsChunkWindow {
  cx:number=2147483647;cz:number=2147483647;radius:number;
  chunkSize:number=128;
  x:number[]=[];z:number[]=[];
  constructor(radius:number,chunkSize?:number){if(!Number.isFinite(radius))throw new Error("Invalid chunk radius");this.radius=Math.max(1,Math.min(4,Math.floor(radius)));if(chunkSize!==undefined)this.chunkSize=chunkSize;if(!Number.isFinite(this.chunkSize)||this.chunkSize<=0)throw new Error("Invalid chunk size");}
  move(x:number,z:number):boolean {
    const cx=Math.floor(x/this.chunkSize),cz=Math.floor(z/this.chunkSize);
    if(cx===this.cx&&cz===this.cz)return false;
    this.cx=cx;this.cz=cz;this.x.length=0;this.z.length=0;
    for(let r=0;r<=this.radius;r++)for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
      this.x.push(cx+dx);this.z.push(cz+dz);
    }
    return true;
  }
  contains(x:number,z:number):boolean{return Math.abs(x-this.cx)<=this.radius&&Math.abs(z-this.cz)<=this.radius;}
}
