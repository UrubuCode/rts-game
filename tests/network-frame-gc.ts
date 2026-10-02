import { NetworkManager } from "@engine/core/network_manager";
import { NetworkTransform } from "@engine/core/network_transform";
import { NetWriter } from "../src/engine/net/buffer";
import { NetTransport } from "../src/engine/net/transport";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
const manager=new NetworkManager(),transform=new NetworkTransform(),writer=new NetWriter(32);
const scene=new Scene("idle"),go=new GameObject("network");go.addBehavior(manager);scene.add(go);
manager.startServerOn(new NetTransport(),scene);
for(let i=0;i<1000;i++){scene.update(1/60);writer.reiniciar();transform.writeState(writer);}
println("NETWORK_GC_BEGIN");
for(let i=0;i<200000;i++){scene.update(1/60);writer.reiniciar();transform.writeState(writer);}
println("NETWORK_GC_END");manager.stop();
