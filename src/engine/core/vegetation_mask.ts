/** Máscara autoral esparsa: círculos de densidade, em coordenadas locais do mundo. */
export class VegetationMask {
  private strokes:number[]=[];
  constructor(data:string){
    if(data.length===0)return;
    if(data.length>50000)throw new Error("Máscara de vegetação muito grande");
    const values=JSON.parse(data);
    if(!Array.isArray(values)||values.length%4!==0||values.length>1024)throw new Error("Máscara de vegetação inválida");
    for(let i=0;i<values.length;i++){
      if(!Number.isFinite(values[i])||Math.abs(values[i])>10000000)throw new Error("Valor inválido na máscara");
      if(i%4===2&&(values[i]<=0||values[i]>2048))throw new Error("Raio inválido");
      if(i%4===3&&Math.abs(values[i])>1)throw new Error("Força inválida");
      this.strokes.push(values[i]);
    }
  }
  paint(x:number,z:number,radius:number,strength:number):void {
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(radius)||!Number.isFinite(strength)||Math.abs(x)>10000000||Math.abs(z)>10000000||radius<=0||radius>2048||Math.abs(strength)>1)throw new Error("Pincel inválido");
    if(this.strokes.length>=1024)throw new Error("Limite de 256 pinceladas atingido");
    this.strokes.push(x,z,radius,strength);
  }
  sample(x:number,z:number):number {
    let density=1;
    for(let i=0;i<this.strokes.length;i+=4){
      const dx=x-this.strokes[i],dz=z-this.strokes[i+1],t=1-Math.sqrt(dx*dx+dz*dz)/this.strokes[i+2];
      if(t>0)density=Math.max(0,Math.min(1,density+this.strokes[i+3]*t*t*(3-2*t)));
    }
    return density;
  }
  serialize():string{return JSON.stringify(this.strokes);}
}
