import { Behavior } from "./behavior";
import { Scene } from "./scene";
import { GameObject } from "./gameobject";
import { NetworkObject } from "./network_object";
import { NetTransport } from "../net/transport";
import { NetTransporteUdp } from "../net/transport_udp";
import { NetServidor } from "../net/server";
import { NetCliente } from "../net/client";
import { NetReplicacaoServidor,NetReplicacaoCliente } from "../net/replication";
import { NetworkPrefabRegistry } from "../net/prefab_registry";
import { NetReader } from "../net/buffer";
import { NET_ESTADO_CONECTADO,NET_ESTADO_CONECTANDO,NET_MAX_TAM_INPUT } from "../net/config";
import type { InspectorUI } from "./inspector_ui";

/**
 * @componentCategory Rede
 * @componentDescription Servidor ou cliente UDP com replicação autoritativa de GameObjects.
 * @componentKeywords multiplayer network manager conexão servidor cliente
 */
export class NetworkManager extends Behavior {
  mode:string="server";address:string="127.0.0.1";port:number=27015;
  maxPlayers:number=16;tickRate:number=60;autoStart:boolean=false;
  /** @nonSerialized */
  prefabs:NetworkPrefabRegistry=new NetworkPrefabRegistry();
  /** @nonSerialized */
  onClientConnected:(id:number)=>void=()=>{};
  /** @nonSerialized */
  onClientDisconnected:(id:number)=>void=()=>{};
  /** @nonSerialized */
  onInput:(id:number,input:NetReader)=>void=()=>{};
  private server:NetServidor|null=null;private client:NetCliente|null=null;
  private serverReplica:NetReplicacaoServidor|null=null;private clientReplica:NetReplicacaoCliente|null=null;
  private transport:NetTransport|null=null;private target:Scene|null=null;
  private input:Uint8Array=new Uint8Array(NET_MAX_TAM_INPUT);private reader:NetReader=new NetReader(NET_MAX_TAM_INPUT);
  private elapsed:number=0;private accumulator:number=0;private sequence:number=0;private attempted:boolean=false;
  private status:string="Parado";private lastState:number=-1;
  onValidate(field:string):void {
    this.port=Number.isFinite(this.port)?Math.max(1,Math.min(65535,Math.floor(this.port))):27015;
    this.maxPlayers=Number.isFinite(this.maxPlayers)?Math.max(1,Math.min(64,Math.floor(this.maxPlayers))):16;
    this.tickRate=Number.isFinite(this.tickRate)?Math.max(10,Math.min(120,Math.floor(this.tickRate))):60;
  }
  startServerOn(transport:NetTransport,scene:Scene):void {
    this.stop();this.onValidate("");this.attempted=true;this.target=scene;this.transport=transport;
    this.server=new NetServidor(transport,this.maxPlayers,this.tickRate);this.serverReplica=new NetReplicacaoServidor(this.server);
    this.status="Servidor iniciado";
  }
  startClientOn(transport:NetTransport,peer:number,scene:Scene):void {
    this.stop();this.onValidate("");this.attempted=true;this.target=scene;this.transport=transport;
    this.client=new NetCliente(transport);this.clientReplica=new NetReplicacaoCliente(this.client,scene,this.prefabs);
    this.client.conectar(peer,0);this.status="Conectando...";
  }
  start():void {
    try{
      this.onValidate("");
      if(this.owner===null||this.owner.uiOwner===null)throw new Error("Adicione o gerenciador a uma cena");
      if(this.mode!=="server"&&this.mode!=="client")throw new Error("Modo deve ser server ou client");
      const scene=this.owner.uiOwner;
      this.stop();
      if(this.mode==="server")this.startServerOn(new NetTransporteUdp(this.port),scene);
      else{const udp=new NetTransporteUdp(0);this.openClient(udp,scene);}
    }catch(error){this.stop();this.status=String(error);this.attempted=true;}
  }
  private openClient(udp:NetTransporteUdp,scene:Scene):void {
    try{this.startClientOn(udp,udp.par(this.address,this.port),scene);}
    catch(error){udp.fechar();throw error;}
  }
  isServer():boolean{return this.server!==null;}
  isConnected():boolean{return this.client!==null&&this.client.estado===NET_ESTADO_CONECTADO;}
  localClientId():number{return this.client===null?-1:this.client.clienteId;}
  objectCount():number{return this.serverReplica!==null?this.serverReplica.objetos.length:this.clientReplica!==null?this.clientReplica.objetos.length:0;}
  ownedObject(id:number):NetworkObject|null {
    if(this.clientReplica!==null)return this.clientReplica.porDono(id);
    if(this.serverReplica!==null)for(let i=0;i<this.serverReplica.objetos.length;i++){const object=this.serverReplica.objetos[i];if(object.ownerId===id)return object;}
    return null;
  }
  spawn(go:GameObject,ownerId:number):number {
    if(this.serverReplica===null||this.target===null)throw new Error("Somente o servidor cria objetos de rede");
    if(!Number.isInteger(ownerId)||ownerId<0||ownerId>255)throw new Error("Invalid owner ID");
    let object:NetworkObject|null=null;
    for(let i=0;i<go.behaviors.length;i++)if(go.behaviors[i] instanceof NetworkObject)object=go.behaviors[i] as NetworkObject;
    if(object===null)throw new Error("GameObject precisa de NetworkObject");
    if(this.serverReplica.objetos.indexOf(object)>=0)throw new Error("Objeto já publicado");
    if(!Number.isInteger(object.prefabId)||object.prefabId<1||object.prefabId>65535)throw new Error("Invalid prefab ID");
    if(this.target.objects.indexOf(go)<0)this.target.add(go);
    object.ownerId=ownerId;object.mount();return this.serverReplica.spawn(object);
  }
  despawn(object:NetworkObject):void {
    if(this.serverReplica===null||this.target===null)return;
    if(this.serverReplica.objetos.indexOf(object)<0)return;
    this.serverReplica.despawn(object);
    if(object.go!==null){const i=this.target.objects.indexOf(object.go);if(i>=0)this.target.removeAt(i);}
  }
  sendInput(data:Uint8Array,length:number):void {
    if(this.client===null||!this.isConnected())return;
    if(!Number.isInteger(length)||length<1||length>NET_MAX_TAM_INPUT||length>data.length)throw new Error("Invalid input size");
    this.client.enviarInput(this.sequence,data,length);this.sequence=(this.sequence+1)&65535;
  }
  update(dt:number):void {
    if(this.enabled===0){if(this.transport!==null)this.stop();return;}
    if(this.autoStart&&!this.attempted)this.start();
    if(this.transport===null||!Number.isFinite(dt)||dt<=0)return;
    this.elapsed+=Math.min(.25,dt);this.accumulator=Math.min(this.accumulator+dt,4/this.tickRate);
    const step=1/this.tickRate;
    while(this.accumulator>=step){this.accumulator-=step;this.networkTick();}
  }
  private networkTick():void {
    const server=this.server,replica=this.serverReplica;
    if(server!==null&&replica!==null){
      server.receber(this.elapsed);server.verificarTempo(this.elapsed);
      let joined=server.proximoNovo();while(joined>=0){replica.aoConectar(joined);this.onClientConnected(joined);joined=server.proximoNovo();}
      let left=server.proximoSaido();while(left>=0){
        for(let i=replica.objetos.length-1;i>=0;i--)if(replica.objetos[i].ownerId===left)this.despawn(replica.objetos[i]);
        this.onClientDisconnected(left);left=server.proximoSaido();
      }
      for(let id=0;id<server.maxClientes;id++)if(server.conectado(id)){
        const n=server.proximoInput(id,this.input);if(n>0){this.reader.abrir(this.input,0,n);this.onInput(id,this.reader);}
      }
      server.tick++;if(server.tick%Math.max(1,Math.ceil(this.tickRate/30))===0)replica.enviarSnapshot(server.tick);
      server.enviar(this.elapsed);
    }
    const client=this.client;
    if(client!==null&&this.clientReplica!==null){
      client.passo(this.elapsed);this.clientReplica.processar();client.enviar(this.elapsed);
      if(client.estado!==this.lastState){this.lastState=client.estado;this.status=client.estado===NET_ESTADO_CONECTADO?"Conectado":"Aguardando conexão";}
      if(client.estado!==NET_ESTADO_CONECTADO&&client.estado!==NET_ESTADO_CONECTANDO){this.stop();this.status="Conexão encerrada ou recusada";}
    }
  }
  stop():void {
    const remote=this.clientReplica;this.clientReplica=null;
    if(remote!==null&&this.target!==null)for(let i=remote.objetos.length-1;i>=0;i--){const go=remote.objetos[i].go;if(go!==null){const index=this.target.objects.indexOf(go);if(index>=0)this.target.removeAt(index);}}
    if(this.client!==null)this.client.desconectar();
    if(this.server!==null)for(let i=0;i<this.server.maxClientes;i++)if(this.server.conectado(i))this.server.desconectar(i,true);
    const local=this.serverReplica;this.serverReplica=null;
    if(local!==null&&this.target!==null)for(let i=local.objetos.length-1;i>=0;i--){const object=local.objetos[i];object.netId=0;if(object.go!==null){const index=this.target.objects.indexOf(object.go);if(index>=0)this.target.removeAt(index);}}
    if(this.transport!==null)this.transport.fechar();
    this.transport=null;this.server=null;this.client=null;this.serverReplica=null;this.target=null;
    this.elapsed=0;this.accumulator=0;this.sequence=0;this.lastState=-1;this.status="Parado";this.attempted=true;
  }
  releaseResources():void{this.stop();}
  onInspectorGUI(ui:InspectorUI):void {
    ui.field("mode");ui.field("address");ui.field("port");ui.field("maxPlayers");ui.field("tickRate");ui.field("autoStart");
    ui.label("AutoStart conecta durante Play. Use server ou client.");
    ui.label(this.status);
  }
}
