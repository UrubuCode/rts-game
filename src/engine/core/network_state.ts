import { Behavior } from "./behavior";
import { NetWriter,NetReader } from "../net/buffer";
/** Estado replicável de tamanho fixo. A ordem deve ser igual nos dois peers. */
export abstract class NetworkState extends Behavior {
  writeState(writer:NetWriter):void{}
  readState(reader:NetReader):void{}
  /** @deprecated Use writeState. */
  netEscrever(writer:NetWriter):void{this.writeState(writer);}
  /** @deprecated Use readState. */
  netLer(reader:NetReader):void{this.readState(reader);}
}
