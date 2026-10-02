import { NetworkState } from "./network_state";
import { NetWriter,NetReader } from "../net/buffer";
import { Transform } from "./transform";
/**
 * @componentCategory Rede
 * @componentDescription Replica posição e yaw do GameObject a partir do servidor.
 * @componentKeywords multiplayer network transform rede posição
 */
export class NetworkTransform extends NetworkState {
  constructor(transform?:Transform){super();if(transform!==undefined)this.attach(transform);}
  writeState(w:NetWriter):void {w.f32(this.host.px);w.f32(this.host.py);w.f32(this.host.pz);w.angulo(this.host.ry);}
  readState(r:NetReader):void {
    const x=r.f32(),y=r.f32(),z=r.f32(),yaw=r.angulo();
    if(r.erro||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||!Number.isFinite(yaw)){r.erro=true;return;}
    this.host.setPosition(x,y,z);this.host.ry=yaw;
  }
}
