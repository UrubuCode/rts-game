import time from "@compat/time.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { NetworkManager } from "@engine/core/network_manager";
import { NetworkObject } from "@engine/core/network_object";
import { NetRedeMemoria } from "../src/engine/net/transport";
import { NetTransporteUdp } from "../src/engine/net/transport_udp";
import { configureMovement } from "../examples/network_movement";

function check(name:string,ok:boolean):void{if(!ok)throw new Error(name);println("[OK] "+name);}
class ReleaseProbe extends Behavior {count:number=0;releaseResources():void{this.count++;}}
function attach(scene:Scene,manager:NetworkManager):void {
  const go=new GameObject("Network session");go.addBehavior(manager);scene.add(go);
}
function runScenario(udp:boolean):void {
  const world=new Scene("server"),aScene=new Scene("a"),bScene=new Scene("b");
  const server=new NetworkManager(),a=new NetworkManager(),b=new NetworkManager();
  attach(world,server);attach(aScene,a);attach(bScene,b);configureMovement(server);
  const network=new NetRedeMemoria(.15,2,317);
  const memoryServer=network.criarPonta();
  let socket:NetTransporteUdp|null=null;
  if(udp){
    socket=new NetTransporteUdp(0);server.startServerOn(socket,world);
    const client=new NetTransporteUdp(0);a.startClientOn(client,client.par("127.0.0.1",socket.portaLocal),aScene);
  }else{server.startServerOn(memoryServer,world);a.startClientOn(network.criarPonta(),memoryServer.endereco,aScene);}
  const right=new Uint8Array([1]),left=new Uint8Array([2]),idle=new Uint8Array([0]),invalid=new Uint8Array([255]);
  for(let tick=0;tick<900;tick++){
    if(tick===250){
      if(udp){const client=new NetTransporteUdp(0);b.startClientOn(client,client.par("127.0.0.1",socket!.portaLocal),bScene);}
      else b.startClientOn(network.criarPonta(),memoryServer.endereco,bScene);
    }
    a.sendInput(tick<650?right:idle,1);b.sendInput(tick<650?left:idle,1);
    aScene.update(1/60);bScene.update(1/60);network.avancar();world.update(1/60);network.avancar();
    if(udp)time.sleep_ms(1);
  }
  check("dois clientes conectados "+udp,a.isConnected()&&b.isConnected());
  check("IDs distintos",a.localClientId()!==b.localClientId());
  check("entrada tardia recebe os dois objetos",server.objectCount()===2&&a.objectCount()===2&&b.objectCount()===2);
  const first=server.ownedObject(a.localClientId())!,second=server.ownedObject(b.localClientId())!;
  const x=first.go!.transform.px;
  check("movimento autoritativo separado e limitado",x>5&&x<=32.5&&second.go!.transform.px< -5&&second.go!.transform.px>=-20);
  check("ambos convergem para servidor",Math.abs(a.ownedObject(a.localClientId())!.go!.transform.px-x)<.001&&Math.abs(b.ownedObject(a.localClientId())!.go!.transform.px-x)<.001);
  for(let tick=0;tick<90;tick++){
    a.sendInput(invalid,1);aScene.update(1/60);bScene.update(1/60);network.avancar();world.update(1/60);network.avancar();if(udp)time.sleep_ms(1);
  }
  check("comando inválido não move",Math.abs(first.go!.transform.px-x)<.001);
  const unrelated=new GameObject("local");const identity=new NetworkObject();unrelated.addBehavior(identity);world.add(unrelated);
  server.despawn(identity);check("despawn ignora objeto não publicado",world.objects.indexOf(unrelated)>=0);
  a.stop();a.stop();
  for(let tick=0;tick<360;tick++){bScene.update(1/60);network.avancar();world.update(1/60);network.avancar();if(udp)time.sleep_ms(1);}
  check("desconexão remove jogador no servidor e outro cliente",server.objectCount()===1&&b.objectCount()===1&&a.objectCount()===0);
  const probe=new ReleaseProbe(),tail=new GameObject("resource");tail.addBehavior(probe);bScene.add(tail);
  bScene.clear();check("limpeza de cena não pula recursos ao remover réplicas",probe.count===1&&bScene.objects.length===0&&!b.isConnected());
  world.clear();aScene.clear();server.stop();b.stop();
}
runScenario(false);runScenario(true);
println("[PASSOU] network-manager memória com perda/atraso e UDP localhost");
