import { NetworkManager } from "@engine/core/network_manager";
import { GameObject } from "@engine/core/gameobject";
import { NetworkObject } from "@engine/core/network_object";
import { NetworkTransform } from "@engine/core/network_transform";

// Exemplo de regra autoritativa reutilizado pelos testes. O cliente envia
// direção (0=parado, 1=direita, 2=esquerda), nunca posição ou ID do jogador.
export function configureMovement(server:NetworkManager):void {
  server.onClientConnected=(id:number)=>{
    const player=new GameObject("Player "+id);
    player.setMesh(1,80,170,235);player.transform.sx=.6;player.transform.sy=1.8;player.transform.sz=.6;
    player.addBehavior(new NetworkObject());player.addBehavior(new NetworkTransform());
    server.spawn(player,id);
  };
  server.onInput=(id,input)=>{
    if(input.resta()!==1)return;
    const direction=input.u8();
    if(input.erro||direction>2)return;
    const object=server.ownedObject(id);
    if(object===null||object.go===null)return;
    const transform=object.go.transform;
    const dx=direction===1?1:direction===2?-1:0;
    transform.setPosition(transform.px+dx*3/server.tickRate,transform.py,transform.pz);
  };
}
