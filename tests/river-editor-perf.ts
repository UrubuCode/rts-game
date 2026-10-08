import { Behavior } from "@engine/core/behavior";
import { Inspector } from "@editor/inspector";
import { InspectorGUIEditor } from "@editor/inspector_gui";
import { Gizmos,gizmosBegin } from "@engine/core/gizmos";
class Fields extends Behavior {
  reads:number=0;
  fieldCount():number{return 2;}
  fieldName(i:number):string{this.reads++;return i===0?"first":"second";}
}
class Panel extends Inspector {
  shown:boolean=true;
  last:number=-1;
  visible(y:number,h:number):boolean{return this.shown;}
  fieldRow(c:Behavior,key:string,index:number,y:number):void{this.last=index;}
  label(key:string,y:number,text:string):void{this.last=-2;}
}
function check(ok:boolean,text:string):void{if(!ok)throw new Error(text);}
const panel=new Panel(null),ui=new InspectorGUIEditor(panel),a=new Fields(),b=new Fields();
ui.begin(a,"component",0);ui.field("second");check(panel.last===1,"indice correto");
const reads=a.reads;
ui.begin(a,"component",0);ui.field("second");check(a.reads===reads,"campo retido");
ui.begin(b,"component",0);ui.field("first");check(panel.last===0&&b.reads>0,"troca de componente");
ui.begin(b,"component",0);ui.field("second");check(panel.last===1,"troca de campo");
panel.shown=false;const before=b.reads;
ui.begin(b,"component",0);ui.field("missing");check(b.reads===before&&ui.usos===1&&ui.y>0,"fora da rolagem preserva layout");
panel.shown=true;ui.begin(a,"component",0);ui.field("second");
const g=new Gizmos(),pose=new Float64Array([0,0,0,0,0,1,800,600]),point=new Float64Array([0,0,10]);
gizmosBegin(g,pose);g.pointHandle(point,4);
check(g.nSeg===4&&g.seg[0]===396&&g.seg[1]===300,"marcador em pixels");
point[2]=-10;g.pointHandle(point,4);check(g.nSeg===4,"ponto atras da camera oculto");point[2]=10;
println("RIVER_EDITOR_GC_BEGIN");
for(let i=0;i<200000;i++){
  ui.begin(a,"component",0);ui.field("second");
  g.nSeg=0;g.pointHandle(point,4);
}
println("RIVER_EDITOR_GC_END");
check(a.reads===reads+2,"cache nao repete reflexao");
println("river-editor-perf OK");
