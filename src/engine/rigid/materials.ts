// ═══════════════════════════════════════════════════════════════════════════
// DO QUE OS CORPOS SÃO FEITOS — a região de materiais do buffer `world`.
//
// Os dois backends externos leem daqui, e o solver em Rust lê a MESMA região no
// mesmo formato (`crates/rts-physics/src/solver/material.rs`). Este arquivo é o
// único lugar onde os offsets existem: dois lugares seria a forma de a GPU e o
// Rust discordarem sobre qual número é o atrito.
//
// ── O QUE ISTO CONSERTA ────────────────────────────────────────────────────
//
// Gravidade, quique, arrasto, atrito e o chão implícito eram CONSTANTES dentro
// do kernel. O inspector mostrava os campos do `Rigidbody` e do
// `PhysicsMaterial`, o solver da CPU os obedecia, e os dois backends rápidos os
// ignoravam em silêncio — a mesma cena caía diferente conforme o backend, que é
// a espécie de divergência que este projeto trata como bug de física.
//
// E a pior delas não era um campo: um objeto dinâmico SEM `Rigidbody` não cai na
// CPU (ninguém o integra) e caía na GPU (o kernel integrava todo mundo). Agora a
// gravidade é do CORPO, e um corpo sem integrador recebe zero.
//
// ── ONDE A REGIÃO MORA, E POR QUE NÃO É UM QUINTO BUFFER ───────────────────
//
// Porque a GPU não pode ter um: com uma JANELA aberta o device dá quatro storage
// buffers por estágio, e o kernel de colisão já liga os quatro. A mesma razão
// que pôs o grid na cauda do `world` (ver `gpurigid.ts`).
//
// ── NÃO ESCRITO = O QUE O SOLVER FAZIA ANTES, e isso é uma decisão ─────────
//
// A região NASCE com as constantes de ontem (`matFillDefaults`, chamado na
// alocação), e não com zeros. Um chamador que nunca escreve material nenhum —
// a suíte de paridade, os benches, o demo do castelo — continua vendo a física
// que via antes dela, e é o que mantém a paridade medida `RUST × GPU = 0`
// significando alguma coisa.
//
// A primeira versão disto tentou decidir pelo COMPRIMENTO do buffer, e estava
// errada por um motivo que os testes disseram na hora: o buffer é alocado com a
// região SEMPRE, então o comprimento nunca denuncia ausência — o que faltava
// era escrita, e o que se lia era zero. Gravidade zero, e `test_gpurigid` e a
// paridade das formas falharam juntos com os corpos parados no ar. O lado Rust
// ainda checa o comprimento, e lá a checagem é certa: quem monta um `world` à
// mão (o bench, os testes do crate) para no bloco de estáticos.
// ═══════════════════════════════════════════════════════════════════════════

import { GameObject } from "../core/gameobject";
import { Transform } from "../core/transform";

/// Tetos do bloco de estáticos — o mesmo dos dois backends e do lado Rust.
export const MAT_MAX_STATICS = 256;
/// Onde a região começa, em índices de f32: depois do cabeçalho e da CAPACIDADE
/// inteira de estáticos, não depois dos estáticos em uso. Offset fixo de
/// propósito: escrever um material não pode depender de quantos estáticos a cena
/// tem neste frame.
export const MAT_AT = 4 + MAT_MAX_STATICS * 8;
/// Um estático: restituição, atrito, dois livres.
export const MAT_STATIC_REC = 4;
/// Um corpo: gravidade, restituição, arrasto, atrito, chão, três livres.
export const MAT_BODY_REC = 8;
/// Quantos f32 a região inteira ocupa para `n` corpos.
export function matBytesFor(n: number): number {
  return MAT_MAX_STATICS * MAT_STATIC_REC + n * MAT_BODY_REC;
}

/// Abaixo disto o chão implícito está DESLIGADO. O mesmo sentinela que o
/// `Rigidbody.floorY` usa, e o mesmo do lado Rust.
export const MAT_NO_FLOOR: f64 = 0.0 - 1.0e8;

/// A gravidade, o quique e o atrito que os solvers tinham quando eram
/// constantes. São o que a região vale enquanto ninguém a escreve.
const MAT_DEF_G: f64 = 9.8;
const MAT_DEF_FRICTION: f64 = 0.35;

export const BODY_STATIC = 0;
export const BODY_KINEMATIC = 1;
export const BODY_DYNAMIC = 2;

/// Preenche a região INTEIRA com os valores de ontem.
///
/// Chamado na alocação, e é o que torna a região segura de existir: um chamador
/// que nunca escreve material nenhum — a suíte de paridade, os benches, o demo
/// do castelo — continua vendo exatamente a física que via antes dela. Zero
/// seria gravidade DESLIGADA, e uma cena que não cai é o modo mais caro de
/// descobrir que um campo novo nasceu vazio.
///
/// O atrito default é 0,35 e não zero porque é o valor com que as duas
/// constantes de atrito dos solvers foram aferidas: `friction_loss` divide por
/// ele, então 0,35 contra 0,35 devolve a constante intacta.
export function matFillDefaults(w: Float32Array, at: number, n: number): void {
  let k = 0;
  while (k < MAT_MAX_STATICS) {
    const base = at + k * MAT_STATIC_REC;
    w[base] = 0.0;
    w[base + 1] = MAT_DEF_FRICTION;
    k = k + 1;
  }
  const bodies = at + MAT_MAX_STATICS * MAT_STATIC_REC;
  k = 0;
  while (k < n) {
    const base = bodies + k * MAT_BODY_REC;
    w[base] = MAT_DEF_G;
    w[base + 1] = 0.0;
    w[base + 2] = 0.0;
    w[base + 3] = MAT_DEF_FRICTION;
    w[base + 4] = 0.0 - 1.0e30;
    w[base + 5] = 2.0; // dynamic por default
    k = k + 1;
  }
}

/// Escreve o material do corpo `k` em `w`. `at` é onde a REGIÃO começa (índice
/// de f32), que difere entre os backends — na GPU ela mora depois do grid.
///
/// Os números vêm de dois lugares e isso é o desenho, não acaso: quique e atrito
/// moram no `Transform` porque é lá que o `PhysicsMaterial` os publica e é o que
/// o solver da CPU lê por par; gravidade, arrasto e chão moram no integrador,
/// porque um corpo sem integrador não tem nenhum dos três.
export function matWriteBody(w: Float32Array, at: number, k: number,
                             o: GameObject, t: Transform): void {
  const base = at + MAT_MAX_STATICS * MAT_STATIC_REC + k * MAT_BODY_REC;
  // O integrador responde por gravidade/arrasto/chão; sem um, o corpo não cai —
  // que é exatamente o que ele faz no caminho da CPU.
  const bs = o.behaviors;
  let g: f64 = 0.0;
  let drag: f64 = 0.0;
  let floor: f64 = 0.0 - 1.0e30;
  let i = 0;
  while (i < bs.length) {
    const b = bs[i];
    if (b.enabled !== 0 && b.bodyIntegrates() !== 0) {
      // MAGNITUDE: o `Rigidbody` guarda a gravidade como aceleração NEGATIVA
      // ("-9.8"), e os dois solvers subtraem. Passar o sinal junto faria o corpo
      // subir — o tipo de erro que roda e parece um bug de câmera.
      const gg = b.bodyGravity();
      g = gg < 0.0 ? 0.0 - gg : gg;
      drag = b.bodyDrag();
      floor = b.bodyFloor();
      i = bs.length;
    } else {
      i = i + 1;
    }
  }
  w[base] = g;
  w[base + 1] = t.restitution;
  w[base + 2] = drag;
  w[base + 3] = t.friction;
  // O chão do integrador é a altura do APOIO; o solver põe o CENTRO do corpo, e
  // a diferença é a meia-altura. O `Rigidbody` da CPU faz a mesma soma
  // (`floorY + t.sy*0.5`) — aqui ela acontece uma vez por sincronização em vez
  // de uma vez por frame.
  w[base + 4] = floor > MAT_NO_FLOOR ? floor + t.sy * 0.5 : floor;
  // Tipo de corpo: 0 = static, 1 = kinematic, 2 = dynamic
  let tipo: f64 = 2.0;
  if (o.stationary !== 0) tipo = 0.0;
  else if (t.mass <= 0.0) tipo = 1.0;
  w[base + 5] = tipo;
  w[base + 6] = 0.0;
  w[base + 7] = 0.0;
}

/// Escreve o material do estático `k` em `w` (ver `matWriteBody` sobre `at`).
export function matWriteStatic(w: Float32Array, at: number, k: number, t: Transform): void {
  const base = at + k * MAT_STATIC_REC;
  w[base] = t.restitution;
  w[base + 1] = t.friction;
  w[base + 2] = 0.0;
  w[base + 3] = 0.0;
}
