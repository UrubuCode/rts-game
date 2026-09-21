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
import rigid from "@compat/rigid.ts";

import { Scene } from "../core/scene";
import { GameObject } from "../core/gameobject";
import { Transform } from "../core/transform";
import { shapeOf, halfXOf, halfYOf, halfZOf, centerWorldX, centerWorldY, centerWorldZ } from "../core/collider";
import { MAT_AT, MAT_MAX_STATICS, MAT_STATIC_REC, MAT_BODY_REC, matBytesFor, matFillDefaults,
         matWriteBody, matWriteStatic } from "./materials";

/// O mesmo teto do `gpurigid`: o `world` carrega até isto de estáticos.
export const CR_MAX_STATICS = MAT_MAX_STATICS;
export const CR_DT: f64 = 1.0 / 60.0;

let crN = 0;
let crPos: Float32Array = new Float32Array(4);
let crVel: Float32Array = new Float32Array(4);
let crExt: Float32Array = new Float32Array(4);
/// `world` = cabeçalho + estáticos + a REGIÃO DE MATERIAIS (ver `materials.ts`).
/// Cresce com a contagem de corpos, em `crInit`.
let crWorld: Float32Array = new Float32Array(MAT_AT + matBytesFor(0));
/// Meia-extensão MÁXIMA vista: é ela que dimensiona a célula do grid.
let crMaxHalf: f64 = 0.0;
let crStatics = 0;

/// 0 = ainda não sondado, 1 = respondeu, 2 = recusou.
let crSondado = 0;

/// O solver nativo está ali E RESPONDE?
///
/// Devolvia `1` fixo, e isso era uma afirmação e não uma medida. O solver é a
/// feature `physics` do `rts-host` e usa rayon, que é thread de SO — não existe
/// em wasm. Um `1` constante faz o decisor escolher um backend que pode não
/// estar presente.
///
/// A sondagem é um passo real sobre UM corpo: `rigid.step` devolve quantos
/// corpos moveu e `0` é a recusa documentada da superfície, então um `1` aqui
/// prova a travessia inteira — módulo carregado, buffers aceitos, solver rodou.
/// Cacheada: a resposta não muda durante o processo.
///
/// LIMITE DECLARADO: se o módulo `rts:rigid` não existir no build, o programa
/// falha no CARREGAMENTO (o import de `@compat/rigid.ts` é de topo), não aqui.
/// Isso é erro de configuração de build e aparece como tal.
export function crAvailable(): number {
  if (crSondado !== 0) return crSondado === 1 ? 1 : 0;
  const pos = new Float32Array(4);
  const vel = new Float32Array(4);
  const ext = new Float32Array(4);
  // um corpo em queda livre, sem estáticos, um sub-passo
  ext[3] = 1.0;                      // invMass
  const world = new Float32Array(MAT_AT + matBytesFor(1));
  world[0] = CR_DT;
  world[2] = 1.0;                    // tamanho de célula
  world[3] = 1.0;                    // sub-passos
  matFillDefaults(world, MAT_AT, 1);
  const moveu = rigid.step(pos, vel, ext, world);
  crSondado = moveu > 0 ? 1 : 2;
  return crSondado === 1 ? 1 : 0;
}
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
  // A região de materiais tem um registro POR CORPO, e o lado Rust só a lê
  // inteira: um `world` curto demais responde os defaults legados para todo
  // mundo, em vez de dar material a uns e não a outros.
  crWorld = new Float32Array(MAT_AT + matBytesFor(n));
  matFillDefaults(crWorld, MAT_AT, n);
  crMaxHalf = 0.0;
  crStatics = 0;
  return 1;
}

/// Define o estado de um corpo. `mass<=0` = INFINITA (inverso 0): o corpo
/// colide e empurra, e nada o empurra de volta. É o que o `Transform.mass` do
/// jogo já significava e o que o layout do buffer sempre disse ("0 is
/// immovable"); aqui `mass<=0` virava inverso 1, então um corpo declarado
/// imóvel era o mais leve da cena. Nenhum chamador passava 0 — a suíte e os
/// benches passam 1, 4 e 32 — então o que muda é o significado de um valor que
/// ninguém usava, e não a física de quem já usava.
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
  crExt[i * 4 + 3] = mass > 0.0 ? 1.0 / mass : 0.0;
  const baseMat = MAT_AT + MAT_MAX_STATICS * MAT_STATIC_REC + i * MAT_BODY_REC;
  if (baseMat + 5 < crWorld.length) {
    crWorld[baseMat + 5] = mass <= 0.0 ? 1.0 : 2.0;
  }
  if (hx > crMaxHalf) crMaxHalf = hx;
  if (hy > crMaxHalf) crMaxHalf = hy;
  if (hz > crMaxHalf) crMaxHalf = hz;
}

/// A FORMA: `COL_SPHERE` (0) ou `COL_BOX` (1). Chame DEPOIS de `crSetBody`,
/// que reescreve o campo com o default — mesma ordem que o `rbSetShape` exige.
export function crSetShape(i: number, shape: number): void {
  crVel[i * 4 + 3] = shape === 0 ? 0.0 : 1.0;
}

/// O MATERIAL do corpo `i`: gravidade, quique, arrasto, atrito e chão. Sai do
/// integrador e do `Transform` — ver `materials.ts`, que é onde a regra mora.
export function crSetMaterial(i: number, o: GameObject, t: Transform): void {
  matWriteBody(crWorld, MAT_AT, i, o, t);
}

/// Escreve velocidade e ACORDA o corpo, como o `rbSetVel`.
export function crSetVel(i: number, vx: f64, vy: f64, vz: f64): void {
  crVel[i * 4] = vx;
  crVel[i * 4 + 1] = vy;
  crVel[i * 4 + 2] = vz;
  crPos[i * 4 + 3] = 0.0;
}

/// Reposiciona UM corpo (teleporte: gizmo do editor, script): escreve o centro,
/// ZERA a velocidade e acorda. A velocidade vai a zero porque quem arrasta um
/// corpo não quer soltá-lo com a queda acumulada enquanto ele era segurado.
export function crSetPos(i: number, x: f64, y: f64, z: f64): void {
  crPos[i * 4] = x;
  crPos[i * 4 + 1] = y;
  crPos[i * 4 + 2] = z;
  crSetVel(i, 0.0, 0.0, 0.0);
}

/// O `dt` de CADA sub-passo. O solver integra o `dt` inteiro por sub-passo —
/// `crStep(2)` com o default avança 2/60 s — então quem quer que uma chamada
/// valha UM passo fixo escreve aqui `passo / subPassos`. O default fica em
/// `CR_DT` porque os testes de paridade foram medidos com ele.
let crDt: f64 = CR_DT;
export function crSetDt(dt: f64): void { crDt = dt > 0.0 ? dt : CR_DT; }

/// Escreve os params no `world`.
///
/// O TAMANHO DA CÉLULA sai daqui e é a mesma regra do `rbWriteWorld`: dois
/// corpos só se tocam se os centros distarem menos que `hi + hj` em cada eixo,
/// então uma célula de lado >= 2×maiorMeiaExtensão faz a varredura de 27 ser
/// EXATA e não uma aproximação. O motor recusa cair para outra coisa — ele lê
/// este campo e não deriva um próprio, justamente para que não existam duas
/// respostas para o tamanho da célula neste projeto.
function crWriteWorld(substeps: number): void {
  crWorld[0] = crDt;
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
/// Estáticos passam por `collider.ts` (meia-extensão e centro de mundo com offset),
/// alinhados nos três backends (CPU, GPU e Rust).
export function crSyncStatics(sc: Scene): void {
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const n = objs.length;
  let m = 0;
  let i = 0;
  while (i < n && m < CR_MAX_STATICS) {
    const o: GameObject = objs[i];
    // `collideFlag` (mesh + raiz): o mesmo critério da `collectColliders` da CPU.
    //
    // A FORMA não filtra mais: só caixa entrava, e um chão ou uma pedra
    // marcados como esfera simplesmente não existiam para este backend — tudo
    // os atravessava, sem nada dizer por quê. Casca (2) continua fora, e essa
    // exclusão é declarada: `rigidNeedsFallback` manda a cena inteira para a
    // CPU antes de chegar aqui.
    if (o.collideFlag !== 0 && o.active !== 0 && o.stationary !== 0 && shapeOf(o) < 2) {
      const t: Transform = trs[i];
      const base = 4 + m * 8;
      crWorld[base] = centerWorldX(o, t);
      crWorld[base + 1] = centerWorldY(o, t);
      crWorld[base + 2] = centerWorldZ(o, t);
      // A REDONDEZA do estático, no `w` do centro: 1 = esfera de raio
      // `min(meia-extensão)`, 0 = caixa. Invertido em relação à forma de um
      // CORPO de propósito — todo escritor anterior a este campo deixava 0 ali
      // e queria dizer caixa, então 0 tem de continuar sendo caixa.
      crWorld[base + 3] = shapeOf(o) === 0 ? 1.0 : 0.0;
      crWorld[base + 4] = halfXOf(o, t);
      crWorld[base + 5] = halfYOf(o, t);
      crWorld[base + 6] = halfZOf(o, t);
      crWorld[base + 7] = 0.0;
      matWriteStatic(crWorld, MAT_AT, m, t);
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
