import { Behavior } from "./behavior";
import { Spline } from "./spline";
import { HeightmapImage } from "./heightmap_image";
import { traceRiverMask } from "./river_mask";
import type { InspectorUI } from "./inspector_ui";
import type { Gizmos } from "./gizmos";
/**
 * @componentCategory Mundo
 * @componentDescription Converte mascara PNG branca sobre preto em spline de rio, com previa.
 * @componentKeywords rio mascara river spline trace imagem
 */
export class RiverMaskTool extends Behavior {
  /** @asset imagem */
  imagePath:string="";
  threshold:number=.5;
  sizeX:number=32;sizeZ:number=32;
  startHeight:number=0;endHeight:number=0;
  width:number=4;depth:number=2;speed:number=1;
  pointCount:number=24;
  reverse:boolean=false;
  private points:number[][]=[];
  private message:string="Rio branco sobre fundo preto. Gere a previa antes de aplicar.";
  private a=new Float64Array(3);private b=new Float64Array(3);
  onValidate(field:string):void{this.points=[];this.message="Configuracao alterada: gere a previa novamente.";}
  preview():void {
    this.points=[];
    if(!Number.isFinite(this.sizeX)||!Number.isFinite(this.sizeZ)||this.sizeX<=0||this.sizeZ<=0||this.sizeX>10000||this.sizeZ>10000||!Number.isFinite(this.startHeight)||!Number.isFinite(this.endHeight)||Math.abs(this.startHeight)>1000||Math.abs(this.endHeight)>1000||!Number.isInteger(this.pointCount)||this.pointCount<2||this.pointCount>64||!Number.isFinite(this.width)||this.width<.1||this.width>1000||!Number.isFinite(this.depth)||this.depth<.01||this.depth>100||!Number.isFinite(this.speed)||Math.abs(this.speed)>100)throw new Error("Dimensoes, alturas, pontos ou fluxo invalidos");
    const path=traceRiverMask(new HeightmapImage(this.imagePath),this.threshold),count=path.length/2;
    const lengths=new Float64Array(count);
    for(let i=1;i<count;i++){const dx=(path[i*2]-path[(i-1)*2])*this.sizeX,dz=(path[i*2+1]-path[(i-1)*2+1])*this.sizeZ;lengths[i]=lengths[i-1]+Math.sqrt(dx*dx+dz*dz);}
    const points:number[][]=[];
    for(let i=0;i<this.pointCount;i++){
      const fraction=i/(this.pointCount-1),distance=(this.reverse?1-fraction:fraction)*lengths[count-1];
      let j=1;while(j<count-1&&lengths[j]<distance)j++;
      const alpha=(distance-lengths[j-1])/Math.max(.000001,lengths[j]-lengths[j-1]);
      const u=path[(j-1)*2]+(path[j*2]-path[(j-1)*2])*alpha,v=path[(j-1)*2+1]+(path[j*2+1]-path[(j-1)*2+1])*alpha;
      points.push([(u-.5)*this.sizeX,this.startHeight+(this.endHeight-this.startHeight)*fraction,(v-.5)*this.sizeZ,this.width,this.depth,this.speed]);
    }
    this.points=points;this.message="Previa pronta. Aplicar substitui os pontos da Spline; Desfazer disponivel.";
  }
  ready():boolean{return this.points.length>=2;}
  previewData():string{return JSON.stringify(this.points);}
  target():Spline {
    let spline:Spline|null=null;
    if(this.owner!==null)for(let i=0;i<this.owner.behaviors.length;i++){const b=this.owner.behaviors[i];if(b instanceof Spline){if(spline!==null)throw new Error("Spline ambigua");spline=b;}}
    if(spline===null)throw new Error("Adicione Spline ao mesmo objeto");return spline;
  }
  apply():void {
    if(!this.ready())throw new Error("Gere a previa primeiro");
    const spline=this.target();spline.points=this.previewData();spline.closed=false;spline.onValidate("points");
    this.message="Spline aplicada. Edite os pontos ou use WaterBody para escavar o terreno.";
  }
  private action(ui:InspectorUI,apply:boolean):void {
    try{if(apply){this.target();if(!this.ready())throw new Error("Gere a previa primeiro");ui.alterar();this.apply();}else this.preview();}
    catch(error){this.message=String(error);}
  }
  onInspectorGUI(ui:InspectorUI):void {
    ui.field("imagePath");ui.field("threshold");ui.field("sizeX");ui.field("sizeZ");ui.field("startHeight");ui.field("endHeight");ui.field("width");ui.field("depth");ui.field("speed");ui.field("pointCount");ui.field("reverse");
    if(ui.button("Prever rio da mascara"))this.action(ui,false);
    if(ui.button("Aplicar spline do rio"))this.action(ui,true);
    ui.label(this.message);
  }
  onDrawGizmosSelected(g:Gizmos):void {
    g.color(0xffcc55);
    for(let i=1;i<this.points.length;i++){
      const p=this.points[i-1],q=this.points[i];this.a[0]=p[0]+this.host.wx;this.a[1]=p[1]+this.host.wy+.1;this.a[2]=p[2]+this.host.wz;
      this.b[0]=q[0]+this.host.wx;this.b[1]=q[1]+this.host.wy+.1;this.b[2]=q[2]+this.host.wz;g.line(this.a,this.b);
    }
  }
}
