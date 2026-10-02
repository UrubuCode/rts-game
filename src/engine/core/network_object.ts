import { Behavior } from "./behavior";
import { NetworkState } from "./network_state";
import type { GameObject } from "./gameobject";
import { NetWriter,NetReader } from "../net/buffer";
/**
 * @componentCategory Rede
 * @componentDescription Identidade de rede; estados irmãos são replicados pelo servidor.
 * @componentKeywords multiplayer network object identidade dono
 */
export class NetworkObject extends Behavior {
  prefabId:number=1;
  /** @nonSerialized */
  netId:number=0;
  /** @nonSerialized */
  ownerId:number=255;
  /** @nonSerialized */
  go:GameObject|null=null;
  private states:NetworkState[]=[];
  constructor(prefabId?:number,ownerId?:number){super();if(prefabId!==undefined)this.prefabId=prefabId;if(ownerId!==undefined)this.ownerId=ownerId;}
  mount():void {
    if(this.owner!==null)this.go=this.owner;
    if(this.go!==null)for(let i=0;i<this.go.behaviors.length;i++){
      const b=this.go.behaviors[i];if(b instanceof NetworkState)this.addState(b);
    }
  }
  addState(state:NetworkState):NetworkObject {if(this.states.indexOf(state)<0)this.states.push(state);return this;}
  writeState(w:NetWriter):void {w.u8(this.go===null?0:this.go.active);for(let i=0;i<this.states.length;i++)this.states[i].netEscrever(w);}
  readState(r:NetReader):void {
    const active=r.u8();for(let i=0;i<this.states.length&&!r.erro;i++)this.states[i].netLer(r);
    if(this.go!==null&&!r.erro)this.go.active=active===0?0:1;
  }
  /** @deprecated Compatibilidade com o protocolo v1. */
  get tipo():number{return this.prefabId;}
  set tipo(value:number){this.prefabId=value;}
  get dono():number{return this.ownerId;}
  set dono(value:number){this.ownerId=value;}
  adicionar(state:NetworkState):NetworkObject{return this.addState(state);}
  escreverEstado(w:NetWriter):void{this.writeState(w);}
  lerEstado(r:NetReader):void{this.readState(r);}
}
