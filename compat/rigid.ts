// `rts:rigid` — o solver de corpos rígidos PARALELO do motor, em Rust.
//
// O shim mais fino possível, pelo mesmo motivo do `gpu.ts`: a superfície já
// existe no motor e o que faltava era ser CHAMADA. Dois membros, sem
// renomeação — o motor já os expõe em camelCase.
//
//   step(pos, vel, ext, world) -> número de corpos movidos, 0 = recusa
//   threads()                  -> quantas threads um passo é espalhado
//
// Quem usa isto é `engine/rigid/cpurigid.ts`, que é o terceiro backend ao lado
// do kernel WGSL de `gpurigid.ts`. O layout dos quatro buffers é o MESMO do
// kernel — foi condição de desenho do lado Rust — então os dois leem a mesma
// descrição de corpo e a paridade tem chance de significar algo.

import { step, threads } from "rts:rigid";

export default {
  step,
  threads,
};
