import { Behavior } from "./behavior";
import { Terrain } from "./terrain";
import { HeightmapImage } from "./heightmap_image";
import type { InspectorUI } from "./inspector_ui";
import type { Gizmos } from "./gizmos";
/**
 * @componentCategory Mundo
 * @componentDescription Importa relevo PNG ou aplica imagem como carimbo no Terrain do mesmo objeto.
 * @componentKeywords heightmap pincel imagem relevo terreno preto branco
 */
export class TerrainImageTool extends Behavior {
  /** @asset imagem */
  imagePath:string="";
  minHeight:number=0;
  maxHeight:number=20;
  centerX:number=0;
  centerZ:number=0;
  radius:number=4;
  strength:number=1;
  /** @nonSerialized */
  paintInViewport:boolean=false;
  private brush:HeightmapImage|null=null;
  private brushPath:string="";
  private dab=new Float64Array(4);
  private markerA=new Float64Array(3);
  private markerB=new Float64Array(3);
  private previewVisible:boolean=false;
  private previewX:number=0;private previewZ:number=0;
  private previewTerrain:Terrain|null=null;
  private message:string="PNG 8-bit: preto baixo, branco alto. Coordenadas locais XZ.";
  private terrain():Terrain {
    let found:Terrain|null=null;
    if(this.owner!==null)for(let i=0;i<this.owner.behaviors.length;i++){
      const b=this.owner.behaviors[i];if(b instanceof Terrain){if(found!==null)throw new Error("Terrain ambiguo");found=b;}
    }
    if(found===null)throw new Error("Adicione Terrain ao mesmo objeto");return found;
  }
  prepare(stamp:boolean):Float64Array {
    const terrain=this.terrain();
    if(!Number.isFinite(this.minHeight)||!Number.isFinite(this.maxHeight)||this.minHeight < -1000||this.maxHeight>1000||this.minHeight>this.maxHeight)throw new Error("Alturas invalidas: -1000 <= minimo <= maximo <= 1000");
    if(stamp&&(!Number.isFinite(this.centerX)||!Number.isFinite(this.centerZ)||!Number.isFinite(this.radius)||this.radius<=0||this.radius>2048||!Number.isFinite(this.strength)||Math.abs(this.strength)>100))throw new Error("Pincel invalido");
    const image=new HeightmapImage(this.imagePath),n=terrain.resolution,values=new Float64Array((n+1)*(n+1));
    for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
      const x=(col/n-.5)*terrain.size,z=(row/n-.5)*terrain.size;
      let h=0;
      if(stamp){
        h=terrain.heightAt(x,z);const u=(x-this.centerX)/(2*this.radius)+.5,v=(z-this.centerZ)/(2*this.radius)+.5;
        if(u>=0&&u<=1&&v>=0&&v<=1)h+=image.sample(u,v)*this.strength;
      }else h=this.minHeight+image.sample(col/n,row/n)*(this.maxHeight-this.minHeight);
      values[row*(n+1)+col]=Math.max(-1000,Math.min(1000,h));
    }
    return values;
  }
  apply(values:Float64Array):void{this.terrain().applyHeightmap(values);}
  prepareBrush():boolean {
    try {
      this.terrain();
      if(!Number.isFinite(this.radius)||this.radius<=0||this.radius>2048||!Number.isFinite(this.strength)||Math.abs(this.strength)>100)throw new Error("Raio ou intensidade invalida");
      if(this.brush===null||this.brushPath!==this.imagePath){this.brush=new HeightmapImage(this.imagePath);this.brushPath=this.imagePath;}
      this.message="Arraste no Terrain. Um gesto = um Desfazer. Intensidade negativa rebaixa.";return true;
    }catch(error){this.message=String(error);return false;}
  }
  brushReady():boolean{return this.brush!==null&&this.brushPath===this.imagePath;}
  dabAt(terrain:Terrain,x:number,z:number):void {
    if(this.brush===null)return;
    this.dab[0]=x;this.dab[1]=z;this.dab[2]=this.radius;this.dab[3]=this.strength;terrain.stampImage(this.brush,this.dab);
  }
  showPreview(terrain:Terrain,x:number,z:number):void{this.previewTerrain=terrain;this.previewX=x;this.previewZ=z;this.previewVisible=true;}
  hidePreview():void{this.previewVisible=false;}
  onValidate(field:string):void{if(field==="imagePath"){this.brush=null;this.brushPath="";}}
  onDrawGizmosSelected(g:Gizmos):void {
    const terrain=this.previewTerrain;
    if(!this.paintInViewport||!this.previewVisible||terrain===null)return;
    g.color(0x55dd88);
    for(let i=0;i<32;i++){
      const side=Math.floor(i/8),a=(i%8)/4-1,b=a+.25;
      const ax=this.previewX+(side===0?a:side===1?1:side===2?-a:-1)*this.radius,az=this.previewZ+(side===0?-1:side===1?a:side===2?1:-a)*this.radius;
      const bx=this.previewX+(side===0?b:side===1?1:side===2?-b:-1)*this.radius,bz=this.previewZ+(side===0?-1:side===1?b:side===2?1:-b)*this.radius;
      this.markerA[0]=this.host.wx+ax;this.markerA[1]=this.host.wy+terrain.heightAt(ax,az)+.1;this.markerA[2]=this.host.wz+az;
      this.markerB[0]=this.host.wx+bx;this.markerB[1]=this.host.wy+terrain.heightAt(bx,bz)+.1;this.markerB[2]=this.host.wz+bz;
      g.line(this.markerA,this.markerB);
    }
  }
  releaseResources():void{this.brush=null;this.brushPath="";this.previewVisible=false;this.previewTerrain=null;}
  private execute(ui:InspectorUI,stamp:boolean):void {
    try{const values=this.prepare(stamp);ui.alterar();this.apply(values);this.message="Relevo aplicado. Desfazer disponivel.";}
    catch(error){this.message=String(error);}
  }
  onInspectorGUI(ui:InspectorUI):void {
    ui.field("imagePath");ui.field("minHeight");ui.field("maxHeight");
    if(ui.button("Importar heightmap"))this.execute(ui,false);
    ui.field("centerX");ui.field("centerZ");ui.field("radius");ui.field("strength");
    if(ui.button("Carimbar pincel PNG"))this.execute(ui,true);
    if(ui.button(this.paintInViewport?"Desativar pintura na viewport":"Pintar na viewport"))this.paintInViewport=!this.paintInViewport;
    if(ui.button("Recarregar pincel")){this.brush=null;this.prepareBrush();}
    ui.label(this.message);
  }
}
