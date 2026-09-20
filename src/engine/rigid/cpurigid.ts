// ═══════════════════════════════════════════════════════════════════════════
// RÍGIDOS NA CPU PARALELA — o terceiro backend, em Rust, por `rts:rigid`.
//
// A MESMA física do kernel WGSL de `gpurigid.ts`, no MESMO modelo gather: cada
// corpo lê os vizinhos e escreve só a si mesmo. Não é uma segunda formulação —
// o solver do outro lado é uma tradução linha a linha daquele kernel, feita
// contra ele, e as constantes (slop 0,04, 85% no estático, 30% no par, teto de
// 0,25 por passo, sono 0,45 u/s por 10 passos, teto de 48 u/s, estacionamento
// em -18, quarentena de NaN) vieram de lá.
//
// ── POR QUE ESTE ARQUIVO É TÃO FINO ────────────────────────────────────────
//
// Porque o LAYOUT DOS BUFFERS é o do `gpurigid.ts`, sem uma alteração. Isso foi
// condição de desenho do lado Rust e não coincidência:
//
//   pos: vec4 (xyz centro, w = contador de sono; w >= 10 dorme)
//   vel: vec4 (xyz, w = FORMA — 0 esfera, 1 caixa)
//   ext: vec4 (xyz meia-extensão, w = invMass; 0 = infinita/cinemático)
//   world: [0] params (dt, nEstaticos, tamCélula, SUB-PASSOS); estáticos
//
// O único campo que o motor acrescentou é o `world[3]`, que no kernel é `-`.
// Então os mesmos bytes descrevem a mesma cena para os dois backends, e não há
// conversão entre eles — que seria mais um lugar onde discordar.
//
// A diferença que sobra, e ela é DELIBERADA e está documentada no lado Rust:
// aqui os vizinhos vêm de um SNAPSHOT tirado no topo do sub-passo, enquanto na
// GPU uma thread lê `pos[j]` enquanto outra o escreve. Jacobi verdadeiro contra
// Jacobi-com-corrida. Isso torna este backend determinístico — bit a bit igual
// independente de quantas threads rodaram — e pode fazer as duas trajetórias
// divergirem em contato denso. É o que `tools/claude-test-paridade-formas.ts`
// mede.
//
// ── ONDE ESTE BACKEND GANHA ────────────────────────────────────────────────
//
// É o fallback da máquina sem placa. Medido em release, cena densa de 2000
// corpos, 2 sub-passos, máquina ociosa: 2,30 ms numa thread e 0,42 ms em 16,
// contra 159,6 ms do solver TypeScript da `Scene` na mesma cena.
// ═══════════════════════════════════════════════════════════════════════════
import rigid from "../../compat/rigid.ts";

import { Scene } from "../core/scene";
import { GameObject } from "../core/gameobject";
import { Transform } from "../core/transform";
import { shapeOf, halfXOf, halfYOf, halfZOf } from "../core/collider";

/// O mesmo teto do `gpurigid`: o `world` carrega até isto de estáticos.
export const CR_MAX_STATICS = 256;
export const CR_DT: f64 = 1.0 / 60.0;

let crN = 0;
let crPos: Float32Array = new Float32Array(4);
let crVel: Float32Array = new Float32Array(4);
let crExt: Float32Array = new Float32Array(4);
let crWorld: Float32Array = new Float32Array(4 + CR_MAX_STATICS * 8);
/// Meia-extensão MÁXIMA vista: é ela que dimensiona a célula do grid.
let crMaxHalf: f64 = 0.0;
let crStatics = 0;

/// Este backend existe sempre — não depende de placa, que é o ponto dele.
/// Presente para que um chamador escrito contra `rbAvailable` não precise de
/// uma forma diferente.
export function crAvailable(): number { return 1; }
export function crCount(): number { return crN; }
export function crThreads(): number { return rigid.threads(); }

export function crX(i: number): f64 { return crPos[i * 4]; }
export function crY(i: number): f64 { return crPos[i * 4 + 1]; }
export function crZ(i: number): f64 { return crPos[i * 4 + 2]; }
/// Contador de sono (>= 10 = dormindo) — telemetria, como o `rbSleep`.
export function crSleep(i: number): f64 { return crPos[i * 4 + 3]; }
export function crVelX(i: number): f64 { return crVel[i * 4]; }
export function crVelY(i: number): f64 { return crVel[i * 4 + 1]; }
export function crVelZ(i: number): f64 { return crVel[i * 4 + 2]; }

/// Aloca os buffers para `n` corpos. Devolve 1 — a assinatura acompanha
/// `rbInit`, que pode falhar por não haver GPU; aqui não há como falhar.
export function crInit(n: number): number {
  crN = n;
  crPos = new Float32Array(n * 4);
  crVel = new Float32Array(n * 4);
  crExt = new Float32Array(n * 4);
  crMaxHalf = 0.0;
  crStatics = 0;
  return 1;
}

/// Define o estado de um corpo. `mass<=0` = 1, como no `rbSetBody`.
export function crSetBody(i: number, x: f64, y: f64, z: f64,
                          hx: f64, hy: f64, hz: f64, mass: f64): void {
  crPos[i * 4] = x;
  crPos[i * 4 + 1] = y;
  crPos[i * 4 + 2] = z;
  crPos[i * 4 + 3] = 0.0;
  crVel[i * 4] = 0.0;
  crVel[i * 4 + 1] = 0.0;
  crVel[i * 4 + 2] = 0.0;
  // CAIXA por default, exatamente como o `rbSetBody`: quem já chamava aquele
  // continua vendo a física de ontem, e quem tem esfera chama `crSetShape`.
  crVel[i * 4 + 3] = 1.0;
  crExt[i * 4] = hx;
  crExt[i * 4 + 1] = hy;
  crExt[i * 4 + 2] = hz;
  crExt[i * 4 + 3] = mass > 0.0 ? 1.0 / mass : 1.0;
  if (hx > crMaxHalf) crMaxHalf = hx;
  if (hy > crMaxHalf) crMaxHalf = hy;
  if (hz > crMaxHalf) crMaxHalf = hz;
}

/// A FORMA: `COL_SPHERE` (0) ou `COL_BOX` (1). Chame DEPOIS de `crSetBody`,
/// que reescreve o campo com o default — mesma ordem que o `rbSetShape` exige.
export function crSetShape(i: number, shape: number): void {
  crVel[i * 4 + 3] = shape === 0 ? 0.0 : 1.0;
}

/// Escreve velocidade e ACORDA o corpo, como o `rbSetVel`.
export function crSetVel(i: number, vx: f64, vy: f64, vz: f64): void {
  crVel[i * 4] = vx;
  crVel[i * 4 + 1] = vy;
  crVel[i * 4 + 2] = vz;
  crPos[i * 4 + 3] = 0.0;
}

/// Escreve os params no `world`.
///
/// O TAMANHO DA CÉLULA sai daqui e é a mesma regra do `rbWriteWorld`: dois
/// corpos só se tocam se os centros distarem menos que `hi + hj` em cada eixo,
/// então uma célula de lado >= 2×maiorMeiaExtensão faz a varredura de 27 ser
/// EXATA e não uma aproximação. O motor recusa cair para outra coisa — ele lê
/// este campo e não deriva um próprio, justamente para que não existam duas
/// respostas para o tamanho da célula neste projeto.
function crWriteWorld(substeps: number): void {
  crWorld[0] = CR_DT;
  crWorld[1] = crStatics * 1.0;
  crWorld[2] = crMaxHalf > 0.0 ? crMaxHalf * 2.0 : 1.0;
  crWorld[3] = substeps * 1.0;
}

/// Compat com o `rbUpload`: aqui os espelhos SÃO o estado, então não há o que
/// subir. Existe para que um chamador escrito contra o backend GPU rode sem
/// mudança — e escreve os params, que é a metade do `rbUpload` que importa
/// nos dois.
export function crUpload(): void {
  crWriteWorld(1);
}

/// Envia os ESTÁTICOS da cena.
///
/// A forma e a meia-extensão vêm de `collider.ts`, que é a fonte que o
/// `pbSync` do decisor já lê para os corpos dinâmicos — a regra existe uma vez
/// e os backends a leem, que é a condição para terminarem no mesmo lugar.
///
/// DIVERGÊNCIA CONHECIDA, dita aqui em vez de descoberta: o `rbSyncStatics` do
/// backend GPU NÃO passa por `collider.ts` — ele lê `o.colShape` e `t.sx*0.5`
/// direto. Para um estático sem component `Collider` os dois dão o mesmo
/// número (o default `hx=0,5` foi escolhido para isso), e é por isso que o
/// teste de paridade não vê diferença. Para um estático COM component, veriam.
export function crSyncStatics(sc: Scene): void {
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const n = objs.length;
  let m = 0;
  let i = 0;
  while (i < n && m < CR_MAX_STATICS) {
    const o: GameObject = objs[i];
    if (o.active !== 0 && o.stationary !== 0 && shapeOf(o) === 1) {
      const t: Transform = trs[i];
      const base = 4 + m * 8;
      crWorld[base] = t.wx;
      crWorld[base + 1] = t.wy;
      crWorld[base + 2] = t.wz;
      crWorld[base + 3] = 0.0;
      crWorld[base + 4] = halfXOf(o, t);
      crWorld[base + 5] = halfYOf(o, t);
      crWorld[base + 6] = halfZOf(o, t);
      crWorld[base + 7] = 0.0;
      m = m + 1;
    }
    i = i + 1;
  }
  crStatics = m;
  crWriteWorld(1);
}

/// UM frame: `substeps` sub-passos, síncrono.
///
/// Não há a assimetria pull/kick do backend GPU e não há por quê: não existe
/// round-trip para esconder. A chamada volta com os espelhos já escritos, que
/// é o que torna este backend o mais simples dos três de usar.
export function crStep(substeps: number): number {
  if (crN === 0) return 0;
  crWriteWorld(substeps);
  return rigid.step(crPos, crVel, crExt, crWorld);
}
