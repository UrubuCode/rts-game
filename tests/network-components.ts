import { createComponent,componentToData } from "@engine/components";
import { recreateBehavior } from "@editor/sceneio";
import { scene } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
import { NetworkManager } from "@engine/core/network_manager";
import { NetworkObject } from "@engine/core/network_object";
import { NetworkTransform } from "@engine/core/network_transform";
import { NetReader,NetWriter,NetFila } from "../src/engine/net/buffer";
import { NetCabecalho,writeHeader,netEscreverCabecalho } from "../src/engine/net/protocol";
import { NET_VERSAO_PROTOCOLO,NET_PKT_DADOS } from "../src/engine/net/config";

function check(ok:boolean,name:string):void{if(!ok)throw new Error(name);println("[OK] "+name);}
const manager=createComponent("NetworkManager") as NetworkManager;
manager.port=29001;manager.maxPlayers=8;
const copy=recreateBehavior(componentToData(manager)) as NetworkManager;
check(copy instanceof NetworkManager&&copy.port===29001&&copy.maxPlayers===8&&!copy.isServer(),"configuração persiste sem sessão");
const object=createComponent("NetworkObject") as NetworkObject;
object.netId=70;object.ownerId=5;object.prefabId=9;
const objectCopy=recreateBehavior(componentToData(object)) as NetworkObject;
check(objectCopy.prefabId===9&&objectCopy.netId===0&&objectCopy.ownerId===255,"IDs de sessão não são serializados");
scene.clear();const go=scene.createGameObject("Session");go.addBehavior(manager);
check(playMode.play(),"Play aceita componente");playMode.stop();
check(scene.objects[0]===go&&!manager.isServer(),"Stop restaura autoria sem conexão");scene.clear();
const r=new NetReader(32),w=new NetWriter(32),legacy=new NetWriter(32);
const header=new NetCabecalho();header.versao=NET_VERSAO_PROTOCOLO;header.tipo=NET_PKT_DADOS;header.seq=65535;header.ack=1;header.ackBits=9;header.ackValido=true;
writeHeader(w,header);netEscreverCabecalho(legacy,NET_PKT_DADOS,65535,1,9,true);
let same=w.pos===legacy.pos;for(let i=0;i<w.pos;i++)if(w.buf[i]!==legacy.buf[i])same=false;
check(same,"cabeçalho novo mantém formato v1");
r.abrir(new Uint8Array(2),0,3);check(r.erro,"reader rejeita origem curta");
const transform=new NetworkTransform();transform.host.setPosition(5,6,7);
w.reiniciar();w.f32(NaN);w.f32(1);w.f32(2);w.angulo(0);r.abrir(w.buf,0,w.pos);transform.readState(r);
check(r.erro&&transform.host.px===5&&transform.host.py===6,"transform inválido não altera posição");
const queue=new NetFila(),bytes=new Uint8Array(4),dst=new Uint8Array(4);
for(let i=0;i<1100;i++)queue.por(0,bytes,0,4);
check(queue.tamanho()===1024&&queue.dropped===76,"fila limitada");
for(let i=0;i<4000;i++){queue.tirar(dst);queue.por(0,bytes,0,4);}
check(queue.dados.length<1600,"prefixo consumido é liberado mesmo sob tráfego contínuo");
println("[PASSOU] network-components");
