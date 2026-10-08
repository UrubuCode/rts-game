import { Behavior } from "./behavior";
import type { InspectorUI } from "./inspector_ui";
import type { Gizmos } from "./gizmos";
const POINT_HANDLE_RADIUS:number=4;
/**
 * @componentCategory Mundo
 * @componentDescription Curva editável reutilizável para rios, estradas e rotas.
 * @componentKeywords spline curva pontos caminho rio
 */
export class Spline extends Behavior {
  closed:boolean=false;
  /** @hideInInspector */
  points:string="[[-12,0,-10,6,2,2],[0,0,0,8,3,2],[12,0,10,6,2,2]]";
  /** @nonSerialized
   * @showInInspector */
  editPoints:boolean=true;
  /** @nonSerialized
   * @showInInspector */
  pointIndex:number=0;
  /** @nonSerialized
   * @showInInspector */
  pointX:number=-12;
  /** @nonSerialized
   * @showInInspector */
  pointY:number=0;
  /** @nonSerialized
   * @showInInspector */
  pointZ:number=-10;
  /** @nonSerialized
   * @showInInspector */
  pointWidth:number=6;
  /** @nonSerialized
   * @showInInspector */
  pointDepth:number=2;
  /** @nonSerialized
   * @showInInspector */
  pointSpeed:number=2;
  private values:number[][]=[];
  private version:number=0;
  private message:string="";
  private a:Float64Array=new Float64Array(6);
  private b:Float64Array=new Float64Array(6);
  constructor(){super();this.readPoints();}
  mount():void{this.readPoints();}
  revision():number{return this.version;}
  count():number{return this.values.length;}
  error():string{return this.message;}
  private readPoints():void {
    try {
      const data=JSON.parse(this.points);
      if(!Array.isArray(data)||data.length<2||data.length>64)throw new Error("Use de 2 a 64 pontos.");
      for(let i=0;i<data.length;i++){
        const p=data[i];if(!Array.isArray(p)||p.length!==6)throw new Error("Ponto: x, y, z, largura, profundidade, velocidade.");
        for(let j=0;j<6;j++)if(!Number.isFinite(p[j])||Math.abs(p[j])>10000)throw new Error("Coordenada invalida.");
        if(p[3]<.1||p[3]>1000||p[4]<.01||p[4]>100||Math.abs(p[5])>100)throw new Error("Dimensoes ou velocidade invalidas.");
      }
      this.values=data;this.message="";this.version++;this.selectPoint(this.pointIndex);this.updateBounds();
    }catch(e){this.message="Curva invalida: verifique os pontos.";}
  }
  onValidate(field:string):void {
    if(field==="pointIndex"){this.selectPoint(this.pointIndex);return;}
    if(field.indexOf("point")===0&&field!=="points"){
      this.a[0]=this.pointX;this.a[1]=this.pointY;this.a[2]=this.pointZ;this.a[3]=this.pointWidth;this.a[4]=this.pointDepth;this.a[5]=this.pointSpeed;
      if(!this.setPoint(this.pointIndex,this.a))this.selectPoint(this.pointIndex);return;
    }
    if(field!=="editPoints")this.readPoints();
  }
  selectPoint(index:number):void {
    this.pointIndex=Math.max(0,Math.min(this.values.length-1,Number.isFinite(index)?Math.floor(index):0));
    const p=this.values[this.pointIndex];if(p===undefined)return;
    this.pointX=p[0];this.pointY=p[1];this.pointZ=p[2];this.pointWidth=p[3];this.pointDepth=p[4];this.pointSpeed=p[5];
  }
  point(index:number,out:Float64Array):void {const p=this.values[Math.max(0,Math.min(this.values.length-1,index|0))];for(let j=0;j<6;j++)out[j]=p[j];}
  setPoint(index:number,p:Float64Array):boolean {
    if(!Number.isInteger(index)||index<0||index>=this.values.length||p.length<6)return false;
    for(let j=0;j<6;j++)if(!Number.isFinite(p[j])||Math.abs(p[j])>10000)return false;
    if(p[3]<.1||p[3]>1000||p[4]<.01||p[4]>100||Math.abs(p[5])>100)return false;
    for(let j=0;j<6;j++)this.values[index][j]=p[j];this.publish();return true;
  }
  private publish():void{this.points=JSON.stringify(this.values);this.version++;this.message="";this.selectPoint(this.pointIndex);this.updateBounds();}
  private updateBounds():void {
    let radius=1;for(let i=0;i<this.values.length;i++){const p=this.values[i];radius=Math.max(radius,Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2])+p[3]);}
    if(this.owner!==null)this.owner.boundRadius=radius*1.5;
  }
  insertPoint():void {
    if(this.count()>=64)return;
    const i=this.pointIndex,p=this.values[i],q=this.values[(i+1)%this.count()];
    const next=p.slice();
    if(i<this.count()-1||this.closed)for(let j=0;j<6;j++)next[j]=(p[j]+q[j])*.5;
    else{next[0]+=5;next[2]+=5;}
    this.values.splice(i+1,0,next);this.pointIndex=i+1;this.publish();
  }
  removePoint():void {if(this.count()<=(this.closed?3:2))return;this.values.splice(this.pointIndex,1);this.publish();}
  /** Catmull-Rom em posição; largura, profundidade e velocidade interpoladas sem overshoot. */
  sample(t:number,out:Float64Array):void {
    const n=this.count(),segments=this.closed?n:n-1,u=Math.max(0,Math.min(1,t))*segments,i=Math.min(segments-1,Math.floor(u)),f=u-i;
    const a=this.values[this.closed?(i+n-1)%n:Math.max(0,i-1)],b=this.values[i],c=this.values[(i+1)%n],d=this.values[this.closed?(i+2)%n:Math.min(n-1,i+2)];
    for(let j=0;j<3;j++)out[j]=.5*((2*b[j])+(-a[j]+c[j])*f+(2*a[j]-5*b[j]+4*c[j]-d[j])*f*f+(-a[j]+3*b[j]-3*c[j]+d[j])*f*f*f);
    for(let j=3;j<6;j++)out[j]=b[j]+(c[j]-b[j])*f;
  }
  onInspectorGUI(ui:InspectorUI):void {
    ui.label("Pontos locais / arraste na vista em XZ");ui.field("closed");ui.field("editPoints");ui.field("pointIndex");
    ui.field("pointX");ui.field("pointY");ui.field("pointZ");ui.field("pointWidth");ui.field("pointDepth");ui.field("pointSpeed");
    if(ui.button("Inserir ponto depois")){ui.alterar();this.insertPoint();}
    if(ui.button("Remover ponto")){ui.alterar();this.removePoint();}
    if(this.message!=="")ui.label(this.message);
  }
  onDrawGizmosSelected(g:Gizmos):void {
    const steps=(this.closed?this.count():this.count()-1)*8;
    g.color(0x33ccff);this.sample(0,this.a);this.toWorld(this.a);
    for(let i=1;i<=steps;i++){this.sample(i/steps,this.b);this.toWorld(this.b);g.line(this.a,this.b);for(let j=0;j<3;j++)this.a[j]=this.b[j];}
    for(let i=0;i<this.count();i++){this.point(i,this.a);this.toWorld(this.a);g.color(i===this.pointIndex?0xffcc33:0x33ccff);g.pointHandle(this.a,POINT_HANDLE_RADIUS);}
  }
  toWorld(p:Float64Array):void{p[0]+=this.host.wx;p[1]+=this.host.wy;p[2]+=this.host.wz;}
}
