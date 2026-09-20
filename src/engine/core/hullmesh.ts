// ═══════════════════════════════════════════════════════════════════════════
// A CASCA DE UMA MALHA DO MOTOR — o que faz um colisor acompanhar a geometria
// sem ninguém digitar um vértice.
//
// `hull.ts` gera uma casca convexa de uma lista de vértices, e `hullreg.ts` a
// guarda sob um id. O que faltava entre os dois e o mundo era isto: dado o
// `meshKind` que um objeto já tem, qual é a casca dele.
//
// ── OS VÉRTICES SÃO OS DO RENDERIZADOR, COPIADOS COM A RAZÃO ───────────────
//
// Vêm de `engine/render/gpu3d.ts`, das listas `cc`, `pc` e `oc` que constroem os
// buffers de desenho. São COPIADOS e não importados, e isso é uma duplicação
// deliberada com um teste que a vigia (`claude-test-hullmesh.ts`).
//
// O motivo de não importar: `gpu3d.ts` monta os vértices dentro de `initMeshes`,
// numa variável local, depois de uma janela existir — importá-lo daqui traria a
// dependência de GPU para dentro do núcleo de física, que roda headless. O
// motivo de haver um teste: duas listas de números que precisam concordar são
// exatamente o tipo de duplicação que o `reuse-check` chama de fatal, e a única
// defesa honesta é uma asserção que quebra quando uma delas muda.
//
// A ESFERA NÃO ESTÁ AQUI, e é decisão. A casca convexa de uma esfera facetada
// tem tantos planos quanto facetas — `hull.ts` mediu 362 vértices e 32 planos
// para a esfera LAT16×LON24, e simplificou. Uma esfera já colide exatamente como
// esfera pelo caminho primitivo, que é mais barato e mais correto do que
// aproximá-la por 32 planos. Pedir a casca de uma esfera devolve 0, e o chamador
// cai para a forma primitiva.
// ═══════════════════════════════════════════════════════════════════════════

import { hullFromMesh } from "./hull";
import { hullRegisterGeo } from "./hullreg";

/// Cubo unitário — `cc` de `gpu3d.ts`.
const V_CUBO: f64[] = [
  0.0 - 0.5, 0.0 - 0.5, 0.0 - 0.5,   0.5, 0.0 - 0.5, 0.0 - 0.5,
  0.0 - 0.5,       0.5, 0.0 - 0.5,   0.5,       0.5, 0.0 - 0.5,
  0.0 - 0.5, 0.0 - 0.5,       0.5,   0.5, 0.0 - 0.5,       0.5,
  0.0 - 0.5,       0.5,       0.5,   0.5,       0.5,       0.5,
];

/// Pirâmide de base quadrada — `pc` de `gpu3d.ts`. O ápice está em y = 0,6 e a
/// base em −0,5, que é por que ela NÃO cabe na caixa unitária: é exatamente essa
/// discordância que torna a pirâmide a demonstração do colisor de casca.
const V_PIRAMIDE: f64[] = [
  0.0 - 0.5, 0.0 - 0.5, 0.0 - 0.5,
        0.5, 0.0 - 0.5, 0.0 - 0.5,
        0.5, 0.0 - 0.5,       0.5,
  0.0 - 0.5, 0.0 - 0.5,       0.5,
        0.0,       0.6,       0.0,
];

/// Octaedro — `oc` de `gpu3d.ts`.
const V_OCTAEDRO: f64[] = [
        0.6, 0.0, 0.0,   0.0 - 0.6, 0.0, 0.0,
        0.0, 0.6, 0.0,   0.0, 0.0 - 0.6, 0.0,
        0.0, 0.0, 0.6,   0.0, 0.0, 0.0 - 0.6,
];

/// A casca de cada `meshKind`, gerada na primeira vez que alguém pergunta.
///
/// Índice = `meshKind`, valor = `hullId`. `0` significa "não há casca para esta
/// malha", e cobre os dois casos honestamente: a malha ainda não foi pedida, e a
/// malha não tem casca (a esfera). A diferença entre os dois não importa a
/// ninguém — as duas respostas são "use a forma primitiva".
const porMalha: number[] = [];

/// O `hullId` da casca de `meshKind`, gerando-a se for a primeira vez.
///
/// Uma casca por MALHA e não por objeto: mil cubos compartilham uma casca e
/// diferem só na transformação. É o mesmo motivo de `Collider` guardar um id em
/// vez dos planos.
export function hullForMesh(meshKind: number): number {
  while (porMalha.length <= meshKind) porMalha.push(0);
  if (porMalha[meshKind] !== 0) return porMalha[meshKind];

  let verts: f64[] = [];
  if (meshKind === 1) verts = V_CUBO;
  else if (meshKind === 2) verts = V_PIRAMIDE;
  else if (meshKind === 3) verts = V_OCTAEDRO;
  // 4 é a esfera, e ela não tem casca aqui de propósito — ver o cabeçalho.
  else return 0;

  const id = hullRegisterGeo(hullFromMesh(verts, 3));
  porMalha[meshKind] = id;
  return id;
}

/// Esquece as cascas geradas. Para um teste que precise de ids previsíveis, e
/// pelo mesmo motivo do `hullResetRegistry` que ele acompanha: sem isto, dois
/// testes no mesmo processo veriam ids diferentes conforme a ordem.
export function hullMeshReset(): void { porMalha.length = 0; }

/// Os vértices que este módulo usa, para o teste que vigia a duplicação poder
/// compará-los com os do renderizador sem que eles precisem ser públicos lá.
export function hullMeshVerts(meshKind: number): f64[] {
  if (meshKind === 1) return V_CUBO;
  if (meshKind === 2) return V_PIRAMIDE;
  if (meshKind === 3) return V_OCTAEDRO;
  return [];
}
