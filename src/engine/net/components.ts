// Fachada compatível com o módulo de rede original do FPS.
export { NetworkObject } from "../core/network_object";
export { NetworkTransform } from "../core/network_transform";
import { NetworkState } from "../core/network_state";
/** @deprecated Estenda NetworkState e implemente writeState/readState. */
export class NetComponente extends NetworkState {}
