import { Behavior } from "./behavior";
import { RouteNode } from "./route_motion";
import type { Gizmos } from "./gizmos";

/**
 * @componentCategory IA e Navegacao
 * @componentDescription Pontos XZ locais, conexoes e pausas de uma rota.
 * @componentKeywords rota waypoint caminho patrulha
 */
export class RoutePath extends Behavior {
  /** @nonSerialized */
  nodes:RouteNode[]=[new RouteNode(0,0,[1],0),new RouteNode(0,8,[0],1)];
  /** @nonSerialized */
  revision:number=0;
  /** @nonSerialized */
  originX:number=0;
  /** @nonSerialized */
  originZ:number=0;
  private anchored:boolean=false;
  private a:Float64Array=new Float64Array(3);
  private b:Float64Array=new Float64Array(3);
  typeName():string{return "RoutePath";}
  anchor():void {if(!this.anchored){this.originX=this.host.px;this.originZ=this.host.pz;this.anchored=true;}}
  fieldCount():number{return 1+this.nodes.length*4;}
  fieldType(i:number):string{return i>0&&(i-1)%4===3?"string":"number";}
  fieldLabel(i:number):string {
    if(i===0)return "Quantidade de pontos";
    const k=(i-1)%4;return "P"+Math.floor((i-1)/4)+(k===0?" X":k===1?" Z":k===2?" Pausa (s)":" Destinos (indices)");
  }
  fieldName(i:number):string{return this.fieldLabel(i);}
  fieldGet(i:number):number {
    if(i===0)return this.nodes.length;const n=this.nodes[Math.floor((i-1)/4)];
    const k=(i-1)%4;return k===0?n.x:k===1?n.z:n.wait;
  }
  fieldSet(i:number,v:number):void {
    if(!Number.isFinite(v))return;
    if(i===0){
      const count=Math.max(1,Math.min(128,Math.floor(v)));
      while(this.nodes.length<count)this.nodes.push(new RouteNode(0,this.nodes.length*4,[],0));
      this.nodes.length=count;
      for(let j=0;j<count;j++){const links=this.nodes[j].next;for(let k=links.length-1;k>=0;k--)if(links[k]>=count)links.splice(k,1);}
    }else{const n=this.nodes[Math.floor((i-1)/4)],k=(i-1)%4;if(k===0)n.x=v;else if(k===1)n.z=v;else if(k===2)n.wait=Math.max(0,v);}
    this.revision++;
  }
  fieldStringGet(i:number):string {return this.nodes[Math.floor((i-1)/4)].next.join(",");}
  fieldStringSet(i:number,v:string):void {
    const links:number[]=[];const words=v.trim().length===0?[]:v.split(",");
    for(let j=0;j<words.length;j++){
      const n=Number(words[j].trim());
      if(words[j].trim().length===0||!Number.isInteger(n)||n<0||n>=this.nodes.length)throw new Error("Destino de rota invalido");
      if(links.indexOf(n)<0)links.push(n);
    }
    this.nodes[Math.floor((i-1)/4)].next=links;this.revision++;
  }
  toData():any {
    const points:any[]=[];for(let i=0;i<this.nodes.length;i++){const n=this.nodes[i];points.push({x:n.x,z:n.z,next:n.next.slice(),wait:n.wait});}
    return {type:"routePath",points:points};
  }
  static fromData(data:any):RoutePath {
    const path=new RoutePath();
    if(!Array.isArray(data.points)||data.points.length<1||data.points.length>128)throw new Error("Rota deve ter 1 a 128 pontos");
    path.nodes=[];
    for(let i=0;i<data.points.length;i++){
      const n=data.points[i];
      if(!Number.isFinite(n.x)||!Number.isFinite(n.z)||!Number.isFinite(n.wait)||n.wait<0||!Array.isArray(n.next))throw new Error("Ponto de rota invalido");
      path.nodes.push(new RouteNode(n.x,n.z,[],n.wait));
    }
    for(let i=0;i<data.points.length;i++)path.fieldStringSet(4+i*4,data.points[i].next.join(","));
    return path;
  }
  onDrawGizmosSelected(g:Gizmos):void {
    const ox=this.anchored?this.originX:this.host.wx,oz=this.anchored?this.originZ:this.host.wz;
    g.color(0x55d5b0);this.a[1]=this.host.wy+0.15;this.b[1]=this.a[1];
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i];this.a[0]=ox+n.x;this.a[2]=oz+n.z;g.wireSphere(this.a,0.16);
      for(let j=0;j<n.next.length;j++){const dest=this.nodes[n.next[j]];this.b[0]=ox+dest.x;this.b[2]=oz+dest.z;g.line(this.a,this.b);}
    }
  }
}
