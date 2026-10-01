import { FpsWorldField } from "./world_streaming";
/** Clima e relevo contínuos em coordenadas globais, sem depender da ordem dos chunks. */
export class WorldBiomeField extends FpsWorldField {
  scale:number;heightScale:number;
  constructor(seed:number,scale:number,heightScale:number){super(seed);this.scale=scale;this.heightScale=heightScale;}
  temperature(x:number,z:number):number{return this.noise(x/this.scale+101,z/this.scale-73);}
  humidity(x:number,z:number):number{return this.noise(x/this.scale-211,z/this.scale+137);}
  // 0 planície, 1 floresta, 2 deserto, 3 tundra.
  biomeAt(x:number,z:number):number {
    const t=this.temperature(x,z),h=this.humidity(x,z);
    return t<.3?3:t>.6&&h<.45?2:h>.55?1:0;
  }
  height(x:number,z:number):number {
    const continental=this.noise(x/180+13,z/180-9),detail=this.noise(x/48-7,z/48+31);
    // Mistura contínua; o limiar do bioma não cria um degrau no relevo.
    return 5+continental*this.heightScale*(.7+.3*this.humidity(x,z))+(detail-.5)*4;
  }
  vegetationDensity(x:number,z:number):number {
    const t=this.temperature(x,z),h=this.humidity(x,z);
    return Math.max(.08,Math.min(1,h*1.5))*Math.max(.15,Math.min(1,t*3));
  }
  cave(x:number,y:number,z:number):boolean {
    // Campo volumétrico contínuo; amostras independentes do índice do chunk.
    const q=Math.floor(y/10),u=y/10-q,t=u*u*(3-2*u);
    const a=this.noise(x/18+q*19,z/18-q*23),b=this.noise(x/18+(q+1)*19,z/18-(q+1)*23);
    return a+(b-a)*t>.64;
  }
}
