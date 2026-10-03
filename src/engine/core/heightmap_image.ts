import { decodePNG, DecodedImage } from "../render/png";
import fs from "@compat/fs";

/** Mapa linear de dados: sem conversao sRGB. PNG 8-bit, ate 1024 por eixo. */
export class HeightmapImage {
  private image:DecodedImage;
  constructor(path:string){
    if(!path.toLowerCase().endsWith(".png"))throw new Error("Heightmap: use PNG de 8 bits, sem interlace.");
    this.image=decodePNG(fs.read_all(path),1024);
  }
  private pixel(x:number,y:number):number {
    const p=this.image.pixels,i=(y*this.image.width+x)*4;
    // RGB tambem aceito: luminancia; transparencia representa intensidade zero.
    return (p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722)/255*(p[i+3]/255);
  }
  sample(u:number,v:number):number {
    const x=Math.max(0,Math.min(1,u))*(this.image.width-1),y=Math.max(0,Math.min(1,v))*(this.image.height-1);
    const a=Math.floor(x),b=Math.floor(y),c=Math.min(a+1,this.image.width-1),d=Math.min(b+1,this.image.height-1),fx=x-a,fy=y-b;
    return this.pixel(a,b)*(1-fx)*(1-fy)+this.pixel(c,b)*fx*(1-fy)+this.pixel(a,d)*(1-fx)*fy+this.pixel(c,d)*fx*fy;
  }
}
