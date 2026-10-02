import { NetFabrica } from "./replication";
import { NetworkObject } from "../core/network_object";
import { NetworkTransform } from "../core/network_transform";
import { GameObject } from "../core/gameobject";
/** Fábricas locais: o peer recebe IDs, nunca caminhos de arquivos ou código. */
export class NetworkPrefabRegistry extends NetFabrica {
  private factories:Map<number,()=>GameObject>=new Map();
  constructor(){super();this.register(1,()=>{
    const go=new GameObject("Network player");go.setMesh(1,80,170,235);go.transform.sx=.6;go.transform.sy=1.8;go.transform.sz=.6;
    go.addBehavior(new NetworkObject());go.addBehavior(new NetworkTransform());return go;
  });}
  register(id:number,factory:()=>GameObject):void {
    if(!Number.isInteger(id)||id<1||id>65535)throw new Error("Invalid network prefab ID");
    this.factories.set(id,factory);
  }
  criar(id:number,netId:number,ownerId:number):NetworkObject|null {
    const factory=this.factories.get(id);if(factory===undefined)return null;
    const go=factory();let object:NetworkObject|null=null;
    for(let i=0;i<go.behaviors.length;i++)if(go.behaviors[i] instanceof NetworkObject)object=go.behaviors[i] as NetworkObject;
    if(object===null)return null;
    object.prefabId=id;object.netId=netId;object.ownerId=ownerId;object.go=go;object.mount();return object;
  }
}
