# FPS entrega 1 (núcleo local): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** um FPS jogável localmente contra bots, sobre o motor rts-game, com a simulação separada da janela para a entrega 2 (servidor UDP) reaproveitá-la.

**Architecture:** tudo o que é jogo fica em `src/shared/` (sem janela e sem GPU) e é orquestrado por `FpsWorld.passo(inputs)` num tick fixo de 60 Hz. O jogador é cinemático: `fpsSimulatePlayer` o move e resolve colisão com `overlapSphereNonAlloc`/`raycastNonAlloc` do índice espacial. `src/client.ts` só lê teclado e mouse, monta um `FpsPlayerInput`, chama o mundo e desenha.

**Tech Stack:** TypeScript sobre o runtime `rts` (Cranelift). Consultas de `src/engine/core/spatial_queries.ts`, cena de `src/engine/core/scene.ts`, render de `src/engine/render/gpu3d.ts`, janela de `@compat/app.ts`.

**Spec:** `docs/entrega1-design.md`

## Global Constraints

- **Diretório de trabalho:** a raiz do repositório `rts-fps`. Todos os comandos rodam a partir dela.
- **Rodar um teste sem janela:** `../rts/target/release/rts.exe run tests/<arquivo>.ts`
- **Rodar o cliente:** `../rts/target/release/examples/ui_fixture.exe src/client.ts`
- **Prefixo obrigatório** `fps`/`FPS_`/`Fps` em **todo** nome de topo dos módulos do jogo (funções, `let`, `const`, classes e interfaces). Neste runtime, nomes de topo de módulos diferentes colidem (`examples/physics_demo.ts:34`).
- **Imports do motor sempre pelos aliases** `@engine/...` e `@compat/...`, nunca `../src/...`, inclusive nos testes do jogo. Assim o mesmo módulo nunca é carregado por dois caminhos (o índice espacial é estado global do módulo).
- **Sem ciclos de import:** `weapons.ts`, `bots.ts`, `player.ts`, `map.ts` e `consultas.ts` não importam `world.ts`.
- **Nada em `src/shared/`** importa `rts:egui`, `rts:input`, `@engine/render/*` ou `@compat/app.ts`. Os testes sem janela provam a regra: `rts.exe run` não tem esses módulos e falharia ao importá-los.
- **Sem `Math.random`** em `shared/`: a aleatoriedade vem de LCGs semeados (`s = (s * 1664525 + 1013904223) | 0`).
- **Sem alocação por tick** nos caminhos quentes: buffers de hits e arrays de efeitos são criados uma vez.
- **Constantes com nome** em `shared/config.ts`. As medidas de layout do HUD ficam num bloco nomeado no topo de `client.ts`.
- **Semântica das consultas (medida em 2026-09-23):** a normal de `overlapSphereNonAlloc` aponta **da esfera para dentro do objeto** (sair é `pos -= normal × profundidade`); a normal do raycast é a da superfície, apontando para fora. Caixa com escala `s` tem meia-extensão `s/2`. O filtro é simétrico: `(mascaraDaConsulta & camadaDoAlvo) != 0` **e** `(mascaraDoAlvo & camadaDaConsulta) != 0`.
- **Teclas** (códigos neutros do `rts-egui`): letras `A..Z` = `100..125`, `F1..F12` = `140..151`, `Esc` = 2, espaço = 3. Botão esquerdo do mouse = 0.
- **Commits:** um por tarefa, terminando com as linhas de atribuição da sessão.

## Review Focus

1. **Remover um bot enquanto a granada dele ainda voa:** a granada explode sem erro e sem creditar abate a um índice inexistente. Teste na Tarefa 6.
2. **Todos os pontos de renascimento ocupados** (muitos jogadores num mapa pequeno): ninguém fica preso morto e nada quebra. Teste na Tarefa 6.
3. **Janela minimizada ou redimensionada para quase zero:** o aspecto da câmera não divide por zero. Guarda na Tarefa 7 (`fpsW`/`fpsH` só atualizam acima de 200 px).
4. **Frame muito longo** (janela arrastada, depurador): o acumulador não entra em espiral e o jogo não "acelera" depois. Guarda na Tarefa 7 (dt limitado a 0,25 s e no máximo 4 ticks por frame, com o excesso descartado).
5. **Olhar reto para baixo e atirar:** o tiro nunca acerta o próprio atirador. Teste na Tarefa 4 (inclui pitch de −π/2).

---

### Tarefa 1: configuração, camadas, consultas e mapa

**Files:**
- Create: `src/shared/config.ts`
- Create: `src/shared/layers.ts`
- Create: `src/shared/consultas.ts`
- Create: `src/shared/map.ts`
- Test: `tests/fps-map.ts`

**Interfaces:**
- Produces:
  - constantes `FPS_*` (lista completa em `config.ts`);
  - `FPS_CAMADA_MAPA = 2`, `FPS_CAMADA_JOGADOR = 4`, `FPS_CAMADA_GRANADA = 8`;
  - `fpsStats: { raios: number; esferas: number; ms: f64 }`, `fpsZerarStats(): void`;
  - `fpsRaio(ox, oy, oz, dx, dy, dz, maxD: f64, out: RaycastHit, mascara: number, sc: Scene): boolean`;
  - `fpsEsfera(cx, cy, cz, r: f64, out: OverlapHit[], max: number, mascara: number, sc: Scene): number`;
  - `interface FpsMapa { objetos: number; spawnX: f64[]; spawnZ: f64[] }`;
  - `fpsGerarMapa(sc: Scene, semente: number, escala: f64): FpsMapa`;
  - `fpsMapaCaixa(sc: Scene, nome: string, x, y, z, sx, sy, sz: f64, r, g, b: number): void`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/fps-map.ts`:

```ts
// Testes do gerador de mapa do FPS (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { setSpatialScene, spatialRebuildIndex, createOverlapHit, OverlapHit } from "@engine/core/spatial_queries";
import { fpsGerarMapa } from "../src/shared/map";
import { fpsEsfera } from "../src/shared/consultas";
import { FPS_CAMADA_MAPA } from "../src/shared/layers";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function assinatura(sc: Scene): number {
  let h = 17;
  let i = 0;
  while (i < sc.objects.length) {
    const t = sc.objects[i].transform;
    h = ((h * 31) + Math.round(t.px * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.py * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.pz * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.sx * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.sy * 1000.0)) | 0;
    h = ((h * 31) + Math.round(t.sz * 1000.0)) | 0;
    i = i + 1;
  }
  return h;
}

io.print("=== fps-map ===");
const a = new Scene("mapa_a");
const ma = fpsGerarMapa(a, 123, 1.0);
const b = new Scene("mapa_b");
fpsGerarMapa(b, 123, 1.0);
const c = new Scene("mapa_c");
fpsGerarMapa(c, 124, 1.0);

check("mesma semente gera o mesmo mapa", a.objects.length === b.objects.length && assinatura(a) === assinatura(b));
check("semente diferente gera outro mapa", assinatura(a) !== assinatura(c));
check("contagem perto de 3.000 estáticos", ma.objetos >= 2900 && ma.objetos <= 3100 && ma.objetos === a.objects.length,
      "objetos=" + ma.objetos + " cena=" + a.objects.length);
check("64 pontos de renascimento", ma.spawnX.length === 64 && ma.spawnZ.length === 64);

let estaticos = 0;
let i = 0;
while (i < a.objects.length) { if (a.objects[i].stationary !== 0 && a.objects[i].layer === FPS_CAMADA_MAPA) estaticos = estaticos + 1; i = i + 1; }
check("todo objeto do mapa é estático na camada MAPA", estaticos === a.objects.length);

a.computeWorld();
setSpatialScene(a);
spatialRebuildIndex(a);
const hits: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];
let ocupados = 0;
i = 0;
while (i < ma.spawnX.length) {
  if (fpsEsfera(ma.spawnX[i], 1.0, ma.spawnZ[i], 0.5, hits, 4, FPS_CAMADA_MAPA, a) > 0) ocupados = ocupados + 1;
  i = i + 1;
}
check("pontos de renascimento livres de geometria", ocupados === 0, "ocupados=" + ocupados);

const meio = new Scene("mapa_meio");
check("escala 0,5 gera menos objetos", fpsGerarMapa(meio, 123, 0.5).objetos < ma.objetos);
const vazio = new Scene("mapa_vazio");
const mv = fpsGerarMapa(vazio, 123, 0.0);
check("escala 0 gera só chão e 4 bordas, com os mesmos 64 renascimentos", mv.objetos === 5 && mv.spawnX.length === 64,
      "objetos=" + mv.objetos);

if (falhas === 0) io.print("[PASSOU] fps-map"); else io.print("[FALHOU] fps-map: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/fps-map.ts`
Expected: FAIL: erro de módulo não encontrado para `../src/shared/map`.

- [ ] **Step 3: Implementar `config.ts`**

`src/shared/config.ts`:

```ts
// Constantes do FPS (entrega 1). Prefixo FPS_ em tudo: neste runtime, nomes
// de topo de módulos diferentes colidem (ver examples/physics_demo.ts).

// ── tempo ──────────────────────────────────────────────────────────────────
export const FPS_TICK_DT: f64 = 1.0 / 60.0;
export const FPS_MAX_TICKS_POR_FRAME = 4;

// ── mapa ───────────────────────────────────────────────────────────────────
export const FPS_SEMENTE_PADRAO = 20260923;
export const FPS_TAM_CHAO: f64 = 400.0;
export const FPS_BLOCO: f64 = 40.0;               // lado de um quarteirão, rua incluída
export const FPS_MEIO_QUARTEIRAO: f64 = 17.0;     // meia-largura da área construível
export const FPS_BLOCOS_POR_LADO = 9;
export const FPS_ALTURA_BORDA: f64 = 20.0;
export const FPS_CAIXOTES_POR_BLOCO: f64 = 20.0;  // multiplicado pela escala
export const FPS_DEGRAU_ALTURA: f64 = 0.3;
export const FPS_DEGRAUS = 10;

// ── jogador ────────────────────────────────────────────────────────────────
export const FPS_RAIO_CORPO: f64 = 0.4;
export const FPS_ALTURA_CORPO: f64 = 1.8;
export const FPS_MEIA_LARGURA_CAIXA: f64 = 0.4;   // caixa atingível: 0,8 × 1,8 × 0,8
export const FPS_ALTURA_OLHO: f64 = 1.6;
export const FPS_VEL_ANDAR: f64 = 6.0;
export const FPS_ACEL_AR: f64 = 3.0;              // 1/s: convergência da velocidade no ar
export const FPS_VEL_PULO: f64 = 5.5;
export const FPS_GRAVIDADE: f64 = 18.0;
export const FPS_VEL_QUEDA_MAX: f64 = 20.0;       // 0,33 u/tick < raio do corpo
export const FPS_ITER_SEPARACAO = 3;
export const FPS_MAX_HITS_CORPO = 8;
export const FPS_ALTURA_DEGRAU: f64 = 0.45;
export const FPS_DIST_CHAO: f64 = 0.1;
export const FPS_PITCH_MAX: f64 = 1.45;
export const FPS_Y_MORTE: f64 = -50.0;
export const FPS_VIDA_MAX: f64 = 100.0;
export const FPS_TEMPO_RENASCER: f64 = 3.0;
export const FPS_RAIO_RENASCER_LIVRE: f64 = 3.0;

// ── fuzil ──────────────────────────────────────────────────────────────────
export const FPS_CADENCIA: f64 = 10.0;            // tiros por segundo
export const FPS_PENTE = 30;
export const FPS_TEMPO_RECARGA: f64 = 1.5;
export const FPS_ALCANCE: f64 = 300.0;
export const FPS_DANO: f64 = 25.0;
export const FPS_FRACAO_CABECA: f64 = 0.7;
export const FPS_MULT_CABECA: f64 = 2.0;

// ── granada ────────────────────────────────────────────────────────────────
export const FPS_GRANADAS_POR_JOGADOR = 2;
export const FPS_TEMPO_GRANADA: f64 = 3.0;
export const FPS_VEL_GRANADA: f64 = 14.0;
export const FPS_IMPULSO_CIMA_GRANADA: f64 = 3.0;
export const FPS_RAIO_GRANADA: f64 = 0.15;
export const FPS_QUIQUE: f64 = 0.5;
export const FPS_PAVIO: f64 = 2.5;
export const FPS_RAIO_EXPLOSAO: f64 = 6.0;
export const FPS_DANO_GRANADA: f64 = 100.0;
export const FPS_EMPURRAO_GRANADA: f64 = 8.0;
export const FPS_EMPURRAO_CIMA_GRANADA: f64 = 4.0;
export const FPS_POOL_GRANADAS = 32;

// ── bots ───────────────────────────────────────────────────────────────────
export const FPS_BOTS_PADRAO = 12;
export const FPS_VISAO_BOT: f64 = 60.0;
export const FPS_TICKS_ENTRE_VISADAS = 12;        // 60 Hz / 5 visadas por segundo
export const FPS_ERRO_MIRA_BOT: f64 = 0.04;       // rad
export const FPS_TEMPO_PARADO_BOT: f64 = 2.0;
export const FPS_DIST_CHEGOU_BOT: f64 = 3.0;

// ── efeitos visuais (registros, fora da cena) ──────────────────────────────
export const FPS_POOL_EFEITOS = 256;
export const FPS_EFEITO_MARCA = 1;
export const FPS_EFEITO_TRACADOR = 2;
export const FPS_EFEITO_EXPLOSAO = 3;
export const FPS_VIDA_MARCA: f64 = 4.0;
export const FPS_VIDA_TRACADOR: f64 = 0.08;
export const FPS_VIDA_EXPLOSAO: f64 = 0.4;
```

- [ ] **Step 4: Implementar `layers.ts` e `consultas.ts`**

`src/shared/layers.ts`:

```ts
// Bits de camada do FPS. Filtro do índice: (mascaraDaConsulta & camadaDoAlvo)
// != 0 E (mascaraDoAlvo & camadaDaConsulta) != 0. Os objetos do jogo mantêm a
// máscara padrão (tudo), então quem escolhe é a máscara da consulta.
export const FPS_CAMADA_MAPA = 2;
export const FPS_CAMADA_JOGADOR = 4;
export const FPS_CAMADA_GRANADA = 8;
```

`src/shared/consultas.ts`:

```ts
// Invólucros das consultas espaciais: contam chamadas e tempo para o painel F3.
import { Scene } from "@engine/core/scene";
import { raycastNonAlloc, overlapSphereNonAlloc, RaycastHit, OverlapHit } from "@engine/core/spatial_queries";
import { FPS_CAMADA_JOGADOR } from "./layers";

export interface FpsStatsConsultas {
  raios: number;
  esferas: number;
  ms: f64;
}

export const fpsStats: FpsStatsConsultas = { raios: 0, esferas: 0, ms: 0.0 };

export function fpsZerarStats(): void {
  fpsStats.raios = 0;
  fpsStats.esferas = 0;
  fpsStats.ms = 0.0;
}

export function fpsRaio(ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, maxD: f64,
                        out: RaycastHit, mascara: number, sc: Scene): boolean {
  const t0 = performance.now();
  const r = raycastNonAlloc(ox, oy, oz, dx, dy, dz, maxD, out, mascara, FPS_CAMADA_JOGADOR, false, sc);
  fpsStats.ms = fpsStats.ms + (performance.now() - t0);
  fpsStats.raios = fpsStats.raios + 1;
  return r;
}

export function fpsEsfera(cx: f64, cy: f64, cz: f64, r: f64, out: OverlapHit[], max: number,
                          mascara: number, sc: Scene): number {
  const t0 = performance.now();
  const n = overlapSphereNonAlloc(cx, cy, cz, r, out, max, mascara, FPS_CAMADA_JOGADOR, false, sc);
  fpsStats.ms = fpsStats.ms + (performance.now() - t0);
  fpsStats.esferas = fpsStats.esferas + 1;
  return n;
}
```

- [ ] **Step 5: Implementar `map.ts`**

`src/shared/map.ts`:

```ts
// Gerador determinístico do mapa: mesma semente, mesma lista de objetos na
// mesma ordem. Servidor e clientes (entrega 2) geram o mapa localmente.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import {
  FPS_TAM_CHAO, FPS_BLOCO, FPS_MEIO_QUARTEIRAO, FPS_BLOCOS_POR_LADO, FPS_ALTURA_BORDA,
  FPS_CAIXOTES_POR_BLOCO, FPS_DEGRAU_ALTURA, FPS_DEGRAUS,
} from "./config";
import { FPS_CAMADA_MAPA } from "./layers";

export interface FpsMapa {
  objetos: number;
  spawnX: f64[];
  spawnZ: f64[];
}

let fpsMapaSemente = 1;
let fpsMapaContagem = 0;

function fpsMapaRnd(): f64 {
  fpsMapaSemente = ((fpsMapaSemente * 1664525 + 1013904223) | 0);
  return (fpsMapaSemente >>> 0) / 4294967296.0;
}

function fpsMapaFaixa(a: f64, b: f64): f64 {
  return a + (b - a) * fpsMapaRnd();
}

/// Uma caixa estática do mapa, apoiada onde o chamador mandar (x, y, z = centro).
export function fpsMapaCaixa(sc: Scene, nome: string, x: f64, y: f64, z: f64,
                             sx: f64, sy: f64, sz: f64, r: number, g: number, b: number): void {
  const o = new GameObject(nome);
  o.stationary = 1;
  o.setMesh(1, r, g, b);
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx;
  o.transform.sy = sy;
  o.transform.sz = sz;
  o.layer = FPS_CAMADA_MAPA;
  sc.add(o);
  fpsMapaContagem = fpsMapaContagem + 1;
}

function fpsMapaQuarteirao(sc: Scene, cx: f64, cz: f64, temEscada: boolean, nCaixotes: number): void {
  // prédio central
  const hx = fpsMapaFaixa(4.0, 10.0);
  const hz = fpsMapaFaixa(4.0, 10.0);
  const alt = fpsMapaFaixa(6.0, 40.0);
  fpsMapaCaixa(sc, "predio", cx, alt * 0.5, cz, hx * 2.0, alt, hz * 2.0, 150, 150, 160);

  // oito pilares num anel
  let k = 0;
  while (k < 8) {
    const ang = k * Math.PI * 0.25;
    fpsMapaCaixa(sc, "pilar", cx + Math.cos(ang) * 14.0, 3.0, cz + Math.sin(ang) * 14.0, 0.6, 6.0, 0.6, 120, 110, 100);
    k = k + 1;
  }

  // quatro muros baixos
  fpsMapaCaixa(sc, "muro", cx + 15.0, 0.6, cz, 0.4, 1.2, 6.0, 110, 120, 110);
  fpsMapaCaixa(sc, "muro", cx - 15.0, 0.6, cz, 0.4, 1.2, 6.0, 110, 120, 110);
  fpsMapaCaixa(sc, "muro", cx, 0.6, cz + 15.0, 6.0, 1.2, 0.4, 110, 120, 110);
  fpsMapaCaixa(sc, "muro", cx, 0.6, cz - 15.0, 6.0, 1.2, 0.4, 110, 120, 110);

  // escada de degraus até uma plataforma, na faixa z = cz + 13..16
  if (temEscada) {
    let d = 0;
    while (d < FPS_DEGRAUS) {
      const h = (d + 1) * FPS_DEGRAU_ALTURA;
      fpsMapaCaixa(sc, "degrau", cx - 16.5 + d, h * 0.5, cz + 14.5, 1.0, h, 3.0, 170, 150, 110);
      d = d + 1;
    }
    const topo = FPS_DEGRAUS * FPS_DEGRAU_ALTURA;
    fpsMapaCaixa(sc, "plataforma", cx - 4.0, topo * 0.5, cz + 14.5, 6.0, topo, 6.0, 170, 150, 110);
  }

  // caixotes espalhados fora do prédio (e fora da faixa da escada)
  let c = 0;
  while (c < nCaixotes) {
    let x = cx;
    let z = cz;
    let tentativa = 0;
    while (tentativa < 10) {
      x = cx + fpsMapaFaixa(-FPS_MEIO_QUARTEIRAO, FPS_MEIO_QUARTEIRAO);
      z = cz + fpsMapaFaixa(-FPS_MEIO_QUARTEIRAO, FPS_MEIO_QUARTEIRAO);
      const dentroPredio = Math.abs(x - cx) < hx + 1.5 && Math.abs(z - cz) < hz + 1.5;
      const naEscada = temEscada && z - cz > 11.0;
      if (!dentroPredio && !naEscada) tentativa = 10;
      else tentativa = tentativa + 1;
    }
    const s = fpsMapaFaixa(0.8, 2.0);
    fpsMapaCaixa(sc, "caixote", x, s * 0.5, z, s, s, s, 140, 100, 60);
    c = c + 1;
  }
}

/// Gera o mapa em `sc`. `escala` multiplica os caixotes; `escala <= 0` gera só
/// chão, bordas e renascimentos (o mapa vazio dos testes).
export function fpsGerarMapa(sc: Scene, semente: number, escala: f64): FpsMapa {
  fpsMapaSemente = semente | 0;
  fpsMapaContagem = 0;
  const meia = FPS_TAM_CHAO * 0.5;
  const hb = FPS_ALTURA_BORDA * 0.5;

  fpsMapaCaixa(sc, "chao", 0.0, -0.5, 0.0, FPS_TAM_CHAO, 1.0, FPS_TAM_CHAO, 70, 80, 70);
  fpsMapaCaixa(sc, "borda", 0.0, hb, meia + 1.0, FPS_TAM_CHAO + 4.0, FPS_ALTURA_BORDA, 2.0, 90, 90, 100);
  fpsMapaCaixa(sc, "borda", 0.0, hb, -meia - 1.0, FPS_TAM_CHAO + 4.0, FPS_ALTURA_BORDA, 2.0, 90, 90, 100);
  fpsMapaCaixa(sc, "borda", meia + 1.0, hb, 0.0, 2.0, FPS_ALTURA_BORDA, FPS_TAM_CHAO + 4.0, 90, 90, 100);
  fpsMapaCaixa(sc, "borda", -meia - 1.0, hb, 0.0, 2.0, FPS_ALTURA_BORDA, FPS_TAM_CHAO + 4.0, 90, 90, 100);

  const metade = (FPS_BLOCOS_POR_LADO - 1) / 2;
  if (escala > 0.0) {
    const nCaixotes = Math.round(FPS_CAIXOTES_POR_BLOCO * escala) | 0;
    let bi = 0;
    while (bi < FPS_BLOCOS_POR_LADO) {
      let bj = 0;
      while (bj < FPS_BLOCOS_POR_LADO) {
        const temEscada = ((bi + bj) % 3) === 0;
        fpsMapaQuarteirao(sc, (bi - metade) * FPS_BLOCO, (bj - metade) * FPS_BLOCO, temEscada, nCaixotes);
        bj = bj + 1;
      }
      bi = bi + 1;
    }
  }

  // renascimentos nos cruzamentos das ruas (8 × 8 = 64)
  const spawnX: f64[] = [];
  const spawnZ: f64[] = [];
  let i = 0;
  while (i < FPS_BLOCOS_POR_LADO - 1) {
    let j = 0;
    while (j < FPS_BLOCOS_POR_LADO - 1) {
      spawnX.push((i - metade) * FPS_BLOCO + FPS_BLOCO * 0.5);
      spawnZ.push((j - metade) * FPS_BLOCO + FPS_BLOCO * 0.5);
      j = j + 1;
    }
    i = i + 1;
  }
  return { objetos: fpsMapaContagem, spawnX: spawnX, spawnZ: spawnZ };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/fps-map.ts`
Expected: 8 `[OK]` e `[PASSOU] fps-map`. Contagem esperada com escala 1: 5 + 81 × 33 + 27 × 11 = **2.975**.

- [ ] **Step 7: Commit**

```bash
git add src/shared/config.ts src/shared/layers.ts src/shared/consultas.ts src/shared/map.ts tests/fps-map.ts
git commit -m "feat(fps): configuração, camadas, consultas e gerador de mapa determinístico"
```

---

### Tarefa 2: entrada e movimento do jogador

**Files:**
- Create: `src/shared/input.ts`
- Create: `src/shared/player.ts`
- Test: `tests/fps-player.ts`

**Interfaces:**
- Consumes (Tarefa 1): constantes `FPS_*`, `FPS_CAMADA_MAPA`, `fpsRaio`, `fpsEsfera`, `fpsMapaCaixa`.
- Produces:
  - `interface FpsPlayerInput { seq: number; frente: number; lado: number; pulo: boolean; yaw: f64; pitch: f64; atirar: boolean; recarregar: boolean; granada: boolean }`;
  - `fpsInputVazio(): FpsPlayerInput`;
  - `interface FpsPlayerState { id; x; y; z; vx; vy; vz; yaw; pitch: f64; noChao: boolean; vida: f64; vivo: boolean; tempoRenascer: f64; municao: number; tempoRecarga: f64; cadenciaRestante: f64; granadasVivas: number; tempoGranada: f64; abates: number; mortes: number; ultimoInputSeq: number }`. A posição `(x, y, z)` é a **sola do pé**.
  - `fpsNovoJogador(id: number, x: f64, y: f64, z: f64): FpsPlayerState`;
  - `fpsSimulatePlayer(p: FpsPlayerState, inp: FpsPlayerInput, dt: f64, sc: Scene): void`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/fps-player.ts`:

```ts
// Testes do movimento do jogador do FPS (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { setSpatialScene, spatialRebuildIndex } from "@engine/core/spatial_queries";
import { fpsMapaCaixa } from "../src/shared/map";
import { fpsInputVazio, FpsPlayerInput } from "../src/shared/input";
import { fpsNovoJogador, fpsSimulatePlayer, FpsPlayerState } from "../src/shared/player";
import { FPS_TICK_DT, FPS_RAIO_CORPO } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function cenaComChao(nome: string): Scene {
  const sc = new Scene(nome);
  fpsMapaCaixa(sc, "chao", 0.0, -0.5, 0.0, 100.0, 1.0, 100.0, 80, 80, 80);
  return sc;
}

function preparar(sc: Scene): void {
  sc.computeWorld();
  setSpatialScene(sc);
  spatialRebuildIndex(sc);
}

function rodar(p: FpsPlayerState, inp: FpsPlayerInput, ticks: number, sc: Scene): void {
  let t = 0;
  while (t < ticks) { fpsSimulatePlayer(p, inp, FPS_TICK_DT, sc); t = t + 1; }
}

io.print("=== fps-player ===");

// 1. cai e para no chão
{
  const sc = cenaComChao("cair");
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 3.0, 0.0);
  rodar(p, fpsInputVazio(), 120, sc);
  check("cai e para no chão", Math.abs(p.y) < 0.02 && p.noChao, "y=" + p.y + " noChao=" + p.noChao);
}

// 2. queda rápida não atravessa o chão
{
  const sc = cenaComChao("queda");
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 60.0, 0.0);
  rodar(p, fpsInputVazio(), 400, sc);
  check("queda de 60 u não atravessa o chão", Math.abs(p.y) < 0.02, "y=" + p.y);
}

// 3. andar contra parede não atravessa
{
  const sc = cenaComChao("parede");
  fpsMapaCaixa(sc, "parede", 5.0, 2.0, 0.0, 1.0, 4.0, 10.0, 100, 100, 100);
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.5;   // olhando para +X
  rodar(p, inp, 300, sc);
  check("andar 5 s contra parede não atravessa", p.x <= 4.5 - FPS_RAIO_CORPO + 0.02, "x=" + p.x);
}

// 4. desliza ao longo da parede
{
  const sc = cenaComChao("desliza");
  fpsMapaCaixa(sc, "parede", 5.0, 2.0, 0.0, 1.0, 4.0, 60.0, 100, 100, 100);   // longa: o jogador não chega à ponta
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.25;  // diagonal +X +Z
  rodar(p, inp, 300, sc);
  check("desliza pela parede em vez de travar", p.z > 5.0 && p.x <= 4.5 - FPS_RAIO_CORPO + 0.02, "x=" + p.x + " z=" + p.z);
}

// 5. sobe degrau de 0,3
{
  const sc = cenaComChao("degrau_baixo");
  fpsMapaCaixa(sc, "degrau", 12.0, 0.15, 0.0, 20.0, 0.3, 4.0, 100, 100, 100);  // de x=2 a x=22
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  rodar(p, fpsInputVazio(), 30, sc);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.5;
  rodar(p, inp, 90, sc);
  check("sobe degrau de 0,3", Math.abs(p.y - 0.3) < 0.05 && p.x > 3.0, "x=" + p.x + " y=" + p.y);
}

// 6. não sobe degrau de 0,6
{
  const sc = cenaComChao("degrau_alto");
  fpsMapaCaixa(sc, "degrau", 12.0, 0.3, 0.0, 20.0, 0.6, 4.0, 100, 100, 100);   // de x=2 a x=22
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  rodar(p, fpsInputVazio(), 30, sc);
  const inp = fpsInputVazio();
  inp.frente = 1; inp.yaw = Math.PI * 0.5;
  rodar(p, inp, 90, sc);
  check("não sobe degrau de 0,6", p.y < 0.05 && p.x < 2.0, "x=" + p.x + " y=" + p.y);
}

// 7. pulo só no chão
{
  const sc = cenaComChao("pulo");
  preparar(sc);
  const p = fpsNovoJogador(0, 0.0, 0.0, 0.0);
  rodar(p, fpsInputVazio(), 30, sc);
  const pula = fpsInputVazio();
  pula.pulo = true;
  fpsSimulatePlayer(p, pula, FPS_TICK_DT, sc);
  rodar(p, fpsInputVazio(), 9, sc);
  const vyAntes = p.vy;
  fpsSimulatePlayer(p, pula, FPS_TICK_DT, sc);   // pulo no ar não pode dar impulso
  check("pulo sai do chão", p.y > 0.3, "y=" + p.y);
  check("pulo no ar não dá novo impulso", p.vy < vyAntes, "vyAntes=" + vyAntes + " vy=" + p.vy);
}

if (falhas === 0) io.print("[PASSOU] fps-player"); else io.print("[FALHOU] fps-player: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/fps-player.ts`
Expected: FAIL: módulo `../src/shared/input` não encontrado.

- [ ] **Step 3: Implementar `input.ts`**

`src/shared/input.ts`:

```ts
// Entrada de um jogador num tick. É a ÚNICA coisa que o cliente manda para a
// simulação (e, na entrega 2, para o servidor).
export interface FpsPlayerInput {
  seq: number;
  frente: number;     // -1, 0 ou 1
  lado: number;       // -1 (esquerda), 0 ou 1 (direita)
  pulo: boolean;
  yaw: f64;           // rad; frente = (sin yaw, cos yaw)
  pitch: f64;         // rad; positivo olha para cima
  atirar: boolean;
  recarregar: boolean;
  granada: boolean;
}

export function fpsInputVazio(): FpsPlayerInput {
  return {
    seq: 0, frente: 0, lado: 0, pulo: false, yaw: 0.0, pitch: 0.0,
    atirar: false, recarregar: false, granada: false,
  };
}
```

- [ ] **Step 4: Implementar `player.ts`**

`src/shared/player.ts`:

```ts
// Movimento cinemático do jogador: só números entram e saem, e a colisão vem
// das consultas do índice espacial (máscara MAPA). Determinístico: o mesmo
// input produz o mesmo estado no cliente e no servidor.
import { Scene } from "@engine/core/scene";
import { createRaycastHit, createOverlapHit, OverlapHit } from "@engine/core/spatial_queries";
import {
  FPS_RAIO_CORPO, FPS_ALTURA_CORPO, FPS_VEL_ANDAR, FPS_ACEL_AR, FPS_VEL_PULO, FPS_GRAVIDADE,
  FPS_VEL_QUEDA_MAX, FPS_ITER_SEPARACAO, FPS_MAX_HITS_CORPO, FPS_ALTURA_DEGRAU, FPS_DIST_CHAO,
  FPS_PITCH_MAX, FPS_VIDA_MAX, FPS_PENTE,
} from "./config";
import { FPS_CAMADA_MAPA } from "./layers";
import { FpsPlayerInput } from "./input";
import { fpsRaio, fpsEsfera } from "./consultas";

export interface FpsPlayerState {
  id: number;
  x: f64; y: f64; z: f64;          // sola do pé
  vx: f64; vy: f64; vz: f64;
  yaw: f64; pitch: f64;
  noChao: boolean;
  vida: f64;
  vivo: boolean;
  tempoRenascer: f64;
  municao: number;
  tempoRecarga: f64;
  cadenciaRestante: f64;
  granadasVivas: number;
  tempoGranada: f64;
  abates: number;
  mortes: number;
  ultimoInputSeq: number;
}

export function fpsNovoJogador(id: number, x: f64, y: f64, z: f64): FpsPlayerState {
  return {
    id: id, x: x, y: y, z: z, vx: 0.0, vy: 0.0, vz: 0.0, yaw: 0.0, pitch: 0.0,
    noChao: false, vida: FPS_VIDA_MAX, vivo: true, tempoRenascer: 0.0,
    municao: FPS_PENTE, tempoRecarga: 0.0, cadenciaRestante: 0.0,
    granadasVivas: 0, tempoGranada: 0.0, abates: 0, mortes: 0, ultimoInputSeq: 0,
  };
}

const fpsPlayerHits: OverlapHit[] = [];
let fpsPlayerK = 0;
while (fpsPlayerK < FPS_MAX_HITS_CORPO) { fpsPlayerHits.push(createOverlapHit()); fpsPlayerK = fpsPlayerK + 1; }
const fpsPlayerRaio = createRaycastHit();

const FPS_EMPURRAO_CHAO = 1;   // alguma separação empurrou para cima (apoio)
const FPS_EMPURRAO_TETO = 2;   // alguma separação empurrou para baixo (teto)

/// Tira as duas esferas do corpo de dentro do mapa. Devolve os bits acima.
function fpsSeparar(p: FpsPlayerState, sc: Scene): number {
  let flags = 0;
  let it = 0;
  while (it < FPS_ITER_SEPARACAO) {
    let mexeu = false;
    let e = 0;
    while (e < 2) {
      const cy = e === 0 ? p.y + FPS_RAIO_CORPO : p.y + FPS_ALTURA_CORPO - FPS_RAIO_CORPO;
      const n = fpsEsfera(p.x, cy, p.z, FPS_RAIO_CORPO, fpsPlayerHits, FPS_MAX_HITS_CORPO, FPS_CAMADA_MAPA, sc);
      const lim = n < FPS_MAX_HITS_CORPO ? n : FPS_MAX_HITS_CORPO;
      let i = 0;
      while (i < lim) {
        const h = fpsPlayerHits[i];
        // a normal aponta da esfera para dentro do objeto: sair é o sentido oposto
        p.x = p.x - h.normal[0] * h.depth;
        p.y = p.y - h.normal[1] * h.depth;
        p.z = p.z - h.normal[2] * h.depth;
        if (0.0 - h.normal[1] > 0.7) flags = flags | FPS_EMPURRAO_CHAO;
        if (h.normal[1] > 0.7) flags = flags | FPS_EMPURRAO_TETO;
        mexeu = true;
        i = i + 1;
      }
      e = e + 1;
    }
    if (mexeu) it = it + 1; else it = FPS_ITER_SEPARACAO;
  }
  return flags;
}

/// O deslocamento horizontal foi barrado: tenta subir um degrau de até
/// FPS_ALTURA_DEGRAU. Devolve true se subiu.
function fpsTentarDegrau(p: FpsPlayerState, x0: f64, y0: f64, z0: f64, dx: f64, dz: f64, sc: Scene): boolean {
  const len = Math.sqrt(dx * dx + dz * dz);
  const ux = dx / len;
  const uz = dz / len;
  const sx = x0 + ux * (FPS_RAIO_CORPO + 0.1);
  const sz = z0 + uz * (FPS_RAIO_CORPO + 0.1);
  const topo = y0 + FPS_ALTURA_DEGRAU + 0.05;
  if (!fpsRaio(sx, topo, sz, 0.0, -1.0, 0.0, FPS_ALTURA_DEGRAU + 0.05, fpsPlayerRaio, FPS_CAMADA_MAPA, sc)) return false;
  const pisoY = fpsPlayerRaio.point[1];
  const subida = pisoY - y0;
  if (subida < 0.01 || subida > FPS_ALTURA_DEGRAU) return false;
  const bx = p.x; const by = p.y; const bz = p.z;
  p.x = x0 + dx;
  p.z = z0 + dz;
  p.y = pisoY + 0.001;
  fpsSeparar(p, sc);
  const ax = p.x - x0; const az = p.z - z0;
  if (ax * ax + az * az < (dx * dx + dz * dz) * 0.25) {
    p.x = bx; p.y = by; p.z = bz;
    return false;
  }
  return true;
}

function fpsChecarChao(p: FpsPlayerState, estavaNoChao: boolean, apoiado: boolean, sc: Scene): void {
  if (p.vy > 0.0 && !apoiado) { p.noChao = false; return; }
  const gruda = estavaNoChao && p.vy <= 0.0;
  const alcance = gruda ? FPS_ALTURA_DEGRAU + 0.05 : FPS_DIST_CHAO + 0.05;
  if (fpsRaio(p.x, p.y + 0.05, p.z, 0.0, -1.0, 0.0, alcance, fpsPlayerRaio, FPS_CAMADA_MAPA, sc)) {
    const vao = p.y - fpsPlayerRaio.point[1];
    if (vao <= FPS_DIST_CHAO || (gruda && vao <= FPS_ALTURA_DEGRAU)) {
      p.y = fpsPlayerRaio.point[1];
      if (p.vy < 0.0) p.vy = 0.0;
      p.noChao = true;
      return;
    }
  }
  p.noChao = apoiado;
}

export function fpsSimulatePlayer(p: FpsPlayerState, inp: FpsPlayerInput, dt: f64, sc: Scene): void {
  p.ultimoInputSeq = inp.seq;
  p.yaw = inp.yaw;
  let pitch = inp.pitch;
  if (pitch > FPS_PITCH_MAX) pitch = FPS_PITCH_MAX;
  if (pitch < 0.0 - FPS_PITCH_MAX) pitch = 0.0 - FPS_PITCH_MAX;
  p.pitch = pitch;
  if (!p.vivo) return;

  // 1. intenção: frente = (sin yaw, cos yaw), direita = (cos yaw, -sin yaw)
  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  let wx = sy * inp.frente + cy * inp.lado;
  let wz = cy * inp.frente - sy * inp.lado;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 1.0) { wx = wx / wl; wz = wz / wl; }
  const alvoVx = wx * FPS_VEL_ANDAR;
  const alvoVz = wz * FPS_VEL_ANDAR;
  if (p.noChao) {
    p.vx = alvoVx;
    p.vz = alvoVz;
  } else {
    let k = FPS_ACEL_AR * dt;
    if (k > 1.0) k = 1.0;
    p.vx = p.vx + (alvoVx - p.vx) * k;
    p.vz = p.vz + (alvoVz - p.vz) * k;
  }

  // 2. pulo e gravidade
  const estavaNoChao = p.noChao;
  if (inp.pulo && p.noChao) { p.vy = FPS_VEL_PULO; p.noChao = false; }
  p.vy = p.vy - FPS_GRAVIDADE * dt;
  if (p.vy < 0.0 - FPS_VEL_QUEDA_MAX) p.vy = 0.0 - FPS_VEL_QUEDA_MAX;

  // 3. mover e deslizar
  const x0 = p.x; const y0 = p.y; const z0 = p.z;
  const dx = p.vx * dt;
  const dz = p.vz * dt;
  p.x = p.x + dx;
  p.y = p.y + p.vy * dt;
  p.z = p.z + dz;
  let flags = fpsSeparar(p, sc);

  // 4. degrau
  const desejado2 = dx * dx + dz * dz;
  // progresso NA DIREÇÃO desejada: na quina de um degrau a separação empurra
  // para trás, e um recuo tem módulo grande mas progresso negativo
  const progresso = (p.x - x0) * dx + (p.z - z0) * dz;
  if (estavaNoChao && desejado2 > 0.00000001 && progresso < desejado2 * 0.25) {
    if (fpsTentarDegrau(p, x0, y0, z0, dx, dz, sc)) flags = flags | FPS_EMPURRAO_CHAO;
  }
  if ((flags & FPS_EMPURRAO_CHAO) !== 0 && p.vy < 0.0) p.vy = 0.0;
  if ((flags & FPS_EMPURRAO_TETO) !== 0 && p.vy > 0.0) p.vy = 0.0;

  // 5. chão
  fpsChecarChao(p, estavaNoChao, (flags & FPS_EMPURRAO_CHAO) !== 0, sc);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/fps-player.ts`
Expected: 8 `[OK]` e `[PASSOU] fps-player`.

Se o teste do degrau de 0,6 falhar com `y` perto de 0,6, a esfera dos pés está sendo empurrada para cima pela quina (risco da spec §12). A correção é, em `fpsSeparar`, ignorar para a esfera dos pés as normais com `|normal.y| < 0.7` cujo impacto fique acima de `p.y + FPS_ALTURA_DEGRAU`. Não afrouxe o teste.

- [ ] **Step 6: Commit**

```bash
git add src/shared/input.ts src/shared/player.ts tests/fps-player.ts
git commit -m "feat(fps): entrada e movimento cinemático do jogador com degraus"
```

---

### Tarefa 3: `FpsWorld`: tick, corpos, morte e renascimento

**Files:**
- Create: `src/shared/world.ts`
- Test: `tests/fps-world.ts`

**Interfaces:**
- Consumes: Tarefas 1 e 2.
- Produces: `class FpsWorld` com:
  - campos `scene: Scene`, `mapa: FpsMapa`, `jogadores: FpsPlayerState[]`, `corpos: GameObject[]`, `ehBot: boolean[]`, `inputsTick: FpsPlayerInput[]`, `tickAtual: number`, `hits: OverlapHit[]` (16), `raio: RaycastHit`;
  - estatísticas do último tick `ultRaios`, `ultEsferas`, `ultMsConsultas`, `ultMsTick`;
  - anel de efeitos `efTipo: number[]`, `efX0`, `efY0`, `efZ0`, `efX1`, `efY1`, `efZ1`, `efVida: f64[]`, `efProximo: number`;
  - métodos `constructor(sc: Scene, semente: number, escala: f64)`, `rnd(): f64`, `adicionarJogador(ehBot: boolean): number`, `removerUltimoBot(): boolean`, `indicePorCorpo(bodyId: number): number`, `renascer(i: number): void`, `matar(i: number, autor: number): void`, `aplicarDano(alvo: number, dano: f64, autor: number): void`, `adicionarEfeito(tipo: number, x0, y0, z0, x1, y1, z1, vida: f64): void`, `inputDe(i: number, inputs: FpsPlayerInput[]): FpsPlayerInput`, `sincronizarCorpos(): void`, `passo(inputs: FpsPlayerInput[]): void`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/fps-world.ts`:

```ts
// Testes do FpsWorld: jogadores, morte, renascimento e determinismo (humanos).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsInputVazio, FpsPlayerInput } from "../src/shared/input";
import { FPS_ALTURA_CORPO, FPS_TEMPO_RENASCER, FPS_TICK_DT } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function ehSpawn(w: FpsWorld, x: f64, z: f64): boolean {
  let i = 0;
  while (i < w.mapa.spawnX.length) {
    if (Math.abs(w.mapa.spawnX[i] - x) < 0.01 && Math.abs(w.mapa.spawnZ[i] - z) < 0.01) return true;
    i = i + 1;
  }
  return false;
}

function digital(w: FpsWorld): string {
  let s = "";
  let i = 0;
  while (i < w.jogadores.length) {
    const p = w.jogadores[i];
    s = s + p.x.toFixed(6) + "," + p.y.toFixed(6) + "," + p.z.toFixed(6) + "," + p.vida + "," + p.mortes + ";";
    i = i + 1;
  }
  return s;
}

function roteiro(w: FpsWorld, ticks: number): void {
  const inputs: FpsPlayerInput[] = [fpsInputVazio(), fpsInputVazio(), fpsInputVazio()];
  let semente = 42;
  let t = 0;
  while (t < ticks) {
    let k = 0;
    while (k < inputs.length) {
      semente = ((semente * 1664525 + 1013904223) | 0);
      const r = (semente >>> 0) / 4294967296.0;
      inputs[k].seq = t;
      inputs[k].frente = r < 0.7 ? 1 : 0;
      inputs[k].lado = r < 0.2 ? -1 : (r > 0.8 ? 1 : 0);
      inputs[k].pulo = r > 0.95;
      inputs[k].yaw = inputs[k].yaw + (r - 0.5) * 0.1;
      k = k + 1;
    }
    w.passo(inputs);
    t = t + 1;
  }
}

io.print("=== fps-world ===");

// 1. jogadores nascem em pontos de renascimento distintos
{
  const w = new FpsWorld(new Scene("w1"), 7, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(false);
  const a = w.jogadores[0]; const b = w.jogadores[1];
  check("jogadores nascem vivos em pontos de renascimento",
        a.vivo && b.vivo && ehSpawn(w, a.x, a.z) && ehSpawn(w, b.x, b.z));
  check("pontos de renascimento distintos", Math.abs(a.x - b.x) + Math.abs(a.z - b.z) > 1.0);
  w.passo([]);
  const c = w.corpos[0];
  check("o corpo acompanha o jogador", Math.abs(c.transform.wy - (a.y + FPS_ALTURA_CORPO * 0.5)) < 0.001,
        "wy=" + c.transform.wy + " y=" + a.y);
}

// 2. cair abaixo de Y_MORTE mata; renasce após FPS_TEMPO_RENASCER
{
  const w = new FpsWorld(new Scene("w2"), 8, 0.0);
  w.adicionarJogador(false);
  const p = w.jogadores[0];
  p.y = -60.0;
  w.passo([]);
  check("abaixo de Y_MORTE morre", !p.vivo && p.mortes === 1 && w.corpos[0].active === 0);
  const ticks = Math.ceil(FPS_TEMPO_RENASCER / FPS_TICK_DT) + 1;
  let t = 0;
  while (t < ticks) { w.passo([]); t = t + 1; }
  check("renasce depois do tempo", p.vivo && w.corpos[0].active === 1 && ehSpawn(w, p.x, p.z) && p.vida === 100.0);
}

// 3. remover bot tira o corpo da cena
{
  const w = new FpsWorld(new Scene("w3"), 9, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(true);
  const antes = w.scene.objects.length;
  check("remover o último bot", w.removerUltimoBot() && w.scene.objects.length === antes - 1 && w.jogadores.length === 1);
  check("não remove humano", !w.removerUltimoBot() && w.jogadores.length === 1);
}

// 4. determinismo com humanos roteirizados
{
  const w1 = new FpsWorld(new Scene("d1"), 11, 0.3);
  w1.adicionarJogador(false); w1.adicionarJogador(false); w1.adicionarJogador(false);
  roteiro(w1, 600);
  const w2 = new FpsWorld(new Scene("d2"), 11, 0.3);
  w2.adicionarJogador(false); w2.adicionarJogador(false); w2.adicionarJogador(false);
  roteiro(w2, 600);
  const d1 = digital(w1); const d2 = digital(w2);
  check("mesma semente e mesmos inputs dão o mesmo estado (600 ticks)", d1 === d2, d1 + " | " + d2);
}

if (falhas === 0) io.print("[PASSOU] fps-world"); else io.print("[FALHOU] fps-world: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/fps-world.ts`
Expected: FAIL: módulo `../src/shared/world` não encontrado.

- [ ] **Step 3: Implementar `world.ts`**

`src/shared/world.ts`:

```ts
// O mundo do FPS: dono da cena, dos jogadores e do tick fixo. É a única peça
// que o cliente (e, na entrega 2, o servidor) chama.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import {
  setSpatialScene, getSpatialScene, spatialRebuildIndex,
  createRaycastHit, createOverlapHit, RaycastHit, OverlapHit,
} from "@engine/core/spatial_queries";
import {
  FPS_TICK_DT, FPS_ALTURA_CORPO, FPS_MEIA_LARGURA_CAIXA, FPS_Y_MORTE, FPS_VIDA_MAX,
  FPS_TEMPO_RENASCER, FPS_RAIO_RENASCER_LIVRE, FPS_PENTE, FPS_POOL_EFEITOS,
} from "./config";
import { FPS_CAMADA_JOGADOR } from "./layers";
import { FpsPlayerInput, fpsInputVazio } from "./input";
import { FpsPlayerState, fpsNovoJogador, fpsSimulatePlayer } from "./player";
import { FpsMapa, fpsGerarMapa } from "./map";
import { fpsStats, fpsZerarStats, fpsEsfera } from "./consultas";

export class FpsWorld {
  scene: Scene;
  mapa: FpsMapa;
  jogadores: FpsPlayerState[];
  corpos: GameObject[];
  ehBot: boolean[];
  inputsTick: FpsPlayerInput[];
  inputNulo: FpsPlayerInput;
  tickAtual: number;
  semente: number;
  hits: OverlapHit[];
  raio: RaycastHit;
  ultRaios: number;
  ultEsferas: number;
  ultMsConsultas: f64;
  ultMsTick: f64;
  efTipo: number[];
  efX0: f64[]; efY0: f64[]; efZ0: f64[];
  efX1: f64[]; efY1: f64[]; efZ1: f64[];
  efVida: f64[];
  efProximo: number;

  constructor(sc: Scene, semente: number, escala: f64) {
    this.scene = sc;
    this.semente = semente | 0;
    this.mapa = fpsGerarMapa(sc, semente, escala);
    this.jogadores = [];
    this.corpos = [];
    this.ehBot = [];
    this.inputsTick = [];
    this.inputNulo = fpsInputVazio();
    this.tickAtual = 0;
    this.hits = [];
    let k = 0;
    while (k < 16) { this.hits.push(createOverlapHit()); k = k + 1; }
    this.raio = createRaycastHit();
    this.ultRaios = 0;
    this.ultEsferas = 0;
    this.ultMsConsultas = 0.0;
    this.ultMsTick = 0.0;
    this.efTipo = []; this.efX0 = []; this.efY0 = []; this.efZ0 = [];
    this.efX1 = []; this.efY1 = []; this.efZ1 = []; this.efVida = [];
    k = 0;
    while (k < FPS_POOL_EFEITOS) {
      this.efTipo.push(0); this.efX0.push(0.0); this.efY0.push(0.0); this.efZ0.push(0.0);
      this.efX1.push(0.0); this.efY1.push(0.0); this.efZ1.push(0.0); this.efVida.push(0.0);
      k = k + 1;
    }
    this.efProximo = 0;
    sc.computeWorld();
    setSpatialScene(sc);
    spatialRebuildIndex(sc);
  }

  rnd(): f64 {
    this.semente = ((this.semente * 1664525 + 1013904223) | 0);
    return (this.semente >>> 0) / 4294967296.0;
  }

  adicionarJogador(ehBot: boolean): number {
    const i = this.jogadores.length;
    const p = fpsNovoJogador(i, 0.0, 0.0, 0.0);
    const corpo = new GameObject("jogador" + i);
    if (ehBot) corpo.setMesh(1, 200, 70, 60); else corpo.setMesh(1, 60, 140, 220);
    corpo.transform.sx = FPS_MEIA_LARGURA_CAIXA * 2.0;
    corpo.transform.sy = FPS_ALTURA_CORPO;
    corpo.transform.sz = FPS_MEIA_LARGURA_CAIXA * 2.0;
    corpo.layer = FPS_CAMADA_JOGADOR;
    this.scene.add(corpo);
    this.jogadores.push(p);
    this.corpos.push(corpo);
    this.ehBot.push(ehBot);
    this.inputsTick.push(this.inputNulo);
    this.renascer(i);
    this.sincronizarCorpos();
    return i;
  }

  removerUltimoBot(): boolean {
    const i = this.jogadores.length - 1;
    if (i < 0 || !this.ehBot[i]) return false;
    const idx = this.scene.objects.indexOf(this.corpos[i]);
    if (idx >= 0) this.scene.removeAt(idx);
    this.jogadores.pop();
    this.corpos.pop();
    this.ehBot.pop();
    this.inputsTick.pop();
    this.sincronizarCorpos();
    return true;
  }

  indicePorCorpo(bodyId: number): number {
    let i = 0;
    while (i < this.corpos.length) {
      if (this.corpos[i].id === bodyId) return i;
      i = i + 1;
    }
    return -1;
  }

  renascer(i: number): void {
    const p = this.jogadores[i];
    const n = this.mapa.spawnX.length;
    const inicio = Math.floor(this.rnd() * n) % n;
    let escolhido = inicio;
    let k = 0;
    while (k < n) {
      const idx = (inicio + k) % n;
      const ocupados = fpsEsfera(this.mapa.spawnX[idx], 1.0, this.mapa.spawnZ[idx], FPS_RAIO_RENASCER_LIVRE,
                                 this.hits, 16, FPS_CAMADA_JOGADOR, this.scene);
      if (ocupados === 0) { escolhido = idx; k = n; } else { k = k + 1; }
    }
    p.x = this.mapa.spawnX[escolhido];
    p.y = 0.0;
    p.z = this.mapa.spawnZ[escolhido];
    p.vx = 0.0; p.vy = 0.0; p.vz = 0.0;
    p.yaw = this.rnd() * Math.PI * 2.0;
    p.pitch = 0.0;
    p.noChao = false;
    p.vida = FPS_VIDA_MAX;
    p.vivo = true;
    p.tempoRenascer = 0.0;
    p.municao = FPS_PENTE;
    p.tempoRecarga = 0.0;
    p.cadenciaRestante = 0.0;
    this.corpos[i].active = 1;
  }

  matar(i: number, autor: number): void {
    const p = this.jogadores[i];
    if (!p.vivo) return;
    p.vivo = false;
    p.vida = 0.0;
    p.tempoRenascer = FPS_TEMPO_RENASCER;
    p.mortes = p.mortes + 1;
    if (autor >= 0 && autor !== i && autor < this.jogadores.length) {
      this.jogadores[autor].abates = this.jogadores[autor].abates + 1;
    }
    this.corpos[i].active = 0;
  }

  aplicarDano(alvo: number, dano: f64, autor: number): void {
    const p = this.jogadores[alvo];
    if (!p.vivo) return;
    p.vida = p.vida - dano;
    if (p.vida <= 0.0) this.matar(alvo, autor);
  }

  adicionarEfeito(tipo: number, x0: f64, y0: f64, z0: f64, x1: f64, y1: f64, z1: f64, vida: f64): void {
    const e = this.efProximo;
    this.efTipo[e] = tipo;
    this.efX0[e] = x0; this.efY0[e] = y0; this.efZ0[e] = z0;
    this.efX1[e] = x1; this.efY1[e] = y1; this.efZ1[e] = z1;
    this.efVida[e] = vida;
    this.efProximo = (e + 1) % FPS_POOL_EFEITOS;
  }

  inputDe(i: number, inputs: FpsPlayerInput[]): FpsPlayerInput {
    return i < inputs.length ? inputs[i] : this.inputNulo;
  }

  /// Copia o estado para os GameObjects e reconstrói o índice. Precisa ser
  /// explícito: o índice só se refaz sozinho quando o contador de passos da
  /// física muda, e o jogo não usa esse contador.
  sincronizarCorpos(): void {
    if (getSpatialScene() !== this.scene) setSpatialScene(this.scene);
    let i = 0;
    while (i < this.jogadores.length) {
      const p = this.jogadores[i];
      const corpo = this.corpos[i];
      corpo.transform.setPosition(p.x, p.y + FPS_ALTURA_CORPO * 0.5, p.z);
      corpo.active = p.vivo ? 1 : 0;
      i = i + 1;
    }
    this.scene.computeWorld();
    spatialRebuildIndex(this.scene);
  }

  passo(inputs: FpsPlayerInput[]): void {
    const t0 = performance.now();
    fpsZerarStats();
    if (getSpatialScene() !== this.scene) { setSpatialScene(this.scene); spatialRebuildIndex(this.scene); }
    this.tickAtual = this.tickAtual + 1;
    const n = this.jogadores.length;

    // 1. movimento
    let i = 0;
    while (i < n) {
      const inp = this.inputDe(i, inputs);
      this.inputsTick[i] = inp;
      fpsSimulatePlayer(this.jogadores[i], inp, FPS_TICK_DT, this.scene);
      if (this.jogadores[i].vivo && this.jogadores[i].y < FPS_Y_MORTE) this.matar(i, -1);
      i = i + 1;
    }

    // 2. armas e granadas

    // 3. renascimentos
    i = 0;
    while (i < n) {
      const p = this.jogadores[i];
      if (!p.vivo) {
        p.tempoRenascer = p.tempoRenascer - FPS_TICK_DT;
        if (p.tempoRenascer <= 0.0) this.renascer(i);
      }
      i = i + 1;
    }

    // 4. efeitos envelhecem
    let e = 0;
    while (e < FPS_POOL_EFEITOS) {
      if (this.efVida[e] > 0.0) this.efVida[e] = this.efVida[e] - FPS_TICK_DT;
      e = e + 1;
    }

    // 5. corpos e índice
    this.sincronizarCorpos();
    this.ultRaios = fpsStats.raios;
    this.ultEsferas = fpsStats.esferas;
    this.ultMsConsultas = fpsStats.ms;
    this.ultMsTick = performance.now() - t0;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/fps-world.ts`
Expected: 8 `[OK]` e `[PASSOU] fps-world`. Rode também `tests/fps-map.ts` e `tests/fps-player.ts`: continuam verdes.

- [ ] **Step 5: Commit**

```bash
git add src/shared/world.ts tests/fps-world.ts
git commit -m "feat(fps): FpsWorld com tick fixo, corpos, morte e renascimento"
```

---

### Tarefa 4: fuzil hitscan

**Files:**
- Create: `src/shared/weapons.ts`
- Modify: `src/shared/world.ts` (novo campo, dois métodos novos e o passo 2)
- Test: `tests/fps-weapons.ts`

**Interfaces:**
- Consumes: `FpsWorld` (Tarefa 3), `fpsRaio`, `FpsPlayerState`.
- Produces:
  - `fpsSaidaDaCaixa(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz: f64): f64`;
  - `fpsTiro(p: FpsPlayerState, yaw: f64, pitch: f64, sc: Scene, out: RaycastHit, raioTiro: f64[]): boolean`, onde `raioTiro` = `[ox, oy, oz, dx, dy, dz]`;
  - `fpsEhCabeca(alvo: FpsPlayerState, yImpacto: f64): boolean`;
  - `FpsWorld.disparar(i: number, erro: f64): number`: devolve o índice do jogador atingido, `-1` se acertou o mapa, `-2` se não acertou nada;
  - `FpsWorld.processarArmas(i: number, inp: FpsPlayerInput): void`;
  - `FpsWorld.tirosDisparados: number`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/fps-weapons.ts`:

```ts
// Testes das armas do FPS (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsMapaCaixa } from "../src/shared/map";
import { fpsInputVazio } from "../src/shared/input";
import { FPS_ALTURA_OLHO, FPS_PENTE, FPS_TEMPO_RECARGA, FPS_TICK_DT } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

/// Mundo vazio com atirador (0) em (0,0,0) e alvo (1) em (10,0,0).
function duelo(nome: string, comParede: boolean): FpsWorld {
  const w = new FpsWorld(new Scene(nome), 5, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(false);
  if (comParede) fpsMapaCaixa(w.scene, "parede", 5.0, 2.0, 0.0, 0.5, 4.0, 4.0, 100, 100, 100);
  const a = w.jogadores[0]; const b = w.jogadores[1];
  a.x = 0.0; a.y = 0.0; a.z = 0.0;
  b.x = 10.0; b.y = 0.0; b.z = 0.0;
  w.sincronizarCorpos();
  return w;
}

function mirar(w: FpsWorld, i: number, alvoY: f64): void {
  const p = w.jogadores[i];
  p.yaw = Math.PI * 0.5;
  p.pitch = Math.atan2(alvoY - (p.y + FPS_ALTURA_OLHO), 10.0);
}

io.print("=== fps-weapons ===");

// 1. o tiro nunca acerta o próprio atirador, em nenhuma direção
{
  const w = duelo("auto", false);
  const a = w.jogadores[0];
  let acertouASiMesmo = 0;
  const pitches: f64[] = [-Math.PI * 0.5, -1.4, -0.7, 0.0, 0.7, 1.4];
  let pi = 0;
  while (pi < pitches.length) {
    let k = 0;
    while (k < 8) {
      a.yaw = k * Math.PI * 0.25;
      a.pitch = pitches[pi];
      if (w.disparar(0, 0.0) === 0) acertouASiMesmo = acertouASiMesmo + 1;
      k = k + 1;
    }
    pi = pi + 1;
  }
  check("tiro nunca acerta o próprio atirador (48 direções, inclusive reto para baixo)",
        acertouASiMesmo === 0 && a.vida === 100.0, "vezes=" + acertouASiMesmo);
}

// 2. acerta o corpo: dano normal
{
  const w = duelo("corpo", false);
  mirar(w, 0, 0.9);
  const r = w.disparar(0, 0.0);
  check("tiro no corpo acerta e tira 25", r === 1 && w.jogadores[1].vida === 75.0, "r=" + r + " vida=" + w.jogadores[1].vida);
}

// 3. cabeça dobra o dano
{
  const w = duelo("cabeca", false);
  mirar(w, 0, 1.7);
  const r = w.disparar(0, 0.0);
  check("tiro na cabeça tira 50", r === 1 && w.jogadores[1].vida === 50.0, "r=" + r + " vida=" + w.jogadores[1].vida);
}

// 4. parede bloqueia
{
  const w = duelo("parede", true);
  mirar(w, 0, 0.9);
  const r = w.disparar(0, 0.0);
  check("parede bloqueia o tiro", r === -1 && w.jogadores[1].vida === 100.0, "r=" + r);
}

// 5. cadência, pente e recarga automática
{
  const w = duelo("cadencia", false);
  const a = w.jogadores[0];
  a.yaw = 0.0; a.pitch = 0.0;   // atira para +Z, longe do alvo
  const inp = fpsInputVazio();
  inp.atirar = true;
  let t = 0;
  while (t < 60) { w.processarArmas(0, inp); t = t + 1; }
  const gastos = FPS_PENTE - a.municao;
  check("cadência de ~10 tiros por segundo", gastos >= 9 && gastos <= 11, "tiros=" + gastos);
  while (a.municao > 0) { w.processarArmas(0, inp); t = t + 1; }
  const ticksRecarga = Math.ceil(FPS_TEMPO_RECARGA / FPS_TICK_DT) + 2;
  let r = 0;
  while (r < ticksRecarga) { w.processarArmas(0, fpsInputVazio()); r = r + 1; }
  check("pente vazio recarrega sozinho", a.municao === FPS_PENTE, "municao=" + a.municao);
}

if (falhas === 0) io.print("[PASSOU] fps-weapons"); else io.print("[FALHOU] fps-weapons: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/fps-weapons.ts`
Expected: FAIL: `w.disparar is not a function` (ou erro equivalente de método inexistente).

- [ ] **Step 3: Implementar `weapons.ts`**

`src/shared/weapons.ts`:

```ts
// Armas do FPS. Funções puras: calculam e devolvem; quem aplica dano e
// efeitos é o FpsWorld (sem import de world.ts, para não haver ciclo).
import { Scene } from "@engine/core/scene";
import { RaycastHit } from "@engine/core/spatial_queries";
import {
  FPS_ALTURA_OLHO, FPS_ALTURA_CORPO, FPS_MEIA_LARGURA_CAIXA, FPS_ALCANCE, FPS_FRACAO_CABECA,
} from "./config";
import { FPS_CAMADA_MAPA, FPS_CAMADA_JOGADOR } from "./layers";
import { FpsPlayerState } from "./player";
import { fpsRaio } from "./consultas";

/// Distância, ao longo do raio, até ele SAIR da caixa (origem dentro dela).
export function fpsSaidaDaCaixa(ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64,
                                cx: f64, cy: f64, cz: f64, hx: f64, hy: f64, hz: f64): f64 {
  let t = 1e30;
  if (dx > 0.000000001) { const tx = (cx + hx - ox) / dx; if (tx < t) t = tx; }
  else if (dx < -0.000000001) { const tx = (cx - hx - ox) / dx; if (tx < t) t = tx; }
  if (dy > 0.000000001) { const ty = (cy + hy - oy) / dy; if (ty < t) t = ty; }
  else if (dy < -0.000000001) { const ty = (cy - hy - oy) / dy; if (ty < t) t = ty; }
  if (dz > 0.000000001) { const tz = (cz + hz - oz) / dz; if (tz < t) t = tz; }
  else if (dz < -0.000000001) { const tz = (cz - hz - oz) / dz; if (tz < t) t = tz; }
  if (t < 0.0) t = 0.0;
  return t;
}

/// Raycast do tiro. O olho está DENTRO da própria caixa, e um raio que começa
/// dentro de um corpo acerta esse corpo a distância 0; então o raio parte do
/// ponto em que sai da caixa do atirador. `raioTiro` recebe [ox, oy, oz, dx, dy, dz].
export function fpsTiro(p: FpsPlayerState, yaw: f64, pitch: f64, sc: Scene, out: RaycastHit, raioTiro: f64[]): boolean {
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = Math.cos(yaw) * cp;
  const ex = p.x; const ey = p.y + FPS_ALTURA_OLHO; const ez = p.z;
  const tSai = fpsSaidaDaCaixa(ex, ey, ez, dx, dy, dz,
                               p.x, p.y + FPS_ALTURA_CORPO * 0.5, p.z,
                               FPS_MEIA_LARGURA_CAIXA, FPS_ALTURA_CORPO * 0.5, FPS_MEIA_LARGURA_CAIXA) + 0.001;
  raioTiro[0] = ex + dx * tSai;
  raioTiro[1] = ey + dy * tSai;
  raioTiro[2] = ez + dz * tSai;
  raioTiro[3] = dx; raioTiro[4] = dy; raioTiro[5] = dz;
  return fpsRaio(raioTiro[0], raioTiro[1], raioTiro[2], dx, dy, dz, FPS_ALCANCE - tSai, out,
                 FPS_CAMADA_MAPA | FPS_CAMADA_JOGADOR, sc);
}

export function fpsEhCabeca(alvo: FpsPlayerState, yImpacto: f64): boolean {
  return yImpacto >= alvo.y + FPS_FRACAO_CABECA * FPS_ALTURA_CORPO;
}
```

- [ ] **Step 4: Integrar em `world.ts`**

1. Acrescente ao import de `./config`: `FPS_ALCANCE, FPS_DANO, FPS_MULT_CABECA, FPS_CADENCIA, FPS_TEMPO_RECARGA, FPS_ERRO_MIRA_BOT, FPS_EFEITO_MARCA, FPS_EFEITO_TRACADOR, FPS_VIDA_MARCA, FPS_VIDA_TRACADOR`.
2. Acrescente o import: `import { fpsTiro, fpsEhCabeca } from "./weapons";`
3. Acrescente os campos, logo depois de `efProximo: number;`:

```ts
  raioTiro: f64[];
  tirosDisparados: number;
```

4. No construtor, logo depois de `this.efProximo = 0;`:

```ts
    this.raioTiro = [0.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    this.tirosDisparados = 0;
```

5. Acrescente os métodos, logo antes de `inputDe(`:

```ts
  /// Um tiro do jogador i. Devolve o índice atingido, -1 (mapa) ou -2 (nada).
  disparar(i: number, erro: f64): number {
    const p = this.jogadores[i];
    let yaw = p.yaw;
    let pitch = p.pitch;
    if (erro > 0.0) {
      yaw = yaw + (this.rnd() * 2.0 - 1.0) * erro;
      pitch = pitch + (this.rnd() * 2.0 - 1.0) * erro;
    }
    this.tirosDisparados = this.tirosDisparados + 1;
    const r = this.raioTiro;
    if (!fpsTiro(p, yaw, pitch, this.scene, this.raio, r)) {
      this.adicionarEfeito(FPS_EFEITO_TRACADOR, r[0], r[1], r[2],
                           r[0] + r[3] * FPS_ALCANCE, r[1] + r[4] * FPS_ALCANCE, r[2] + r[5] * FPS_ALCANCE,
                           FPS_VIDA_TRACADOR);
      return -2;
    }
    const hp = this.raio.point;
    this.adicionarEfeito(FPS_EFEITO_TRACADOR, r[0], r[1], r[2], hp[0], hp[1], hp[2], FPS_VIDA_TRACADOR);
    const j = this.indicePorCorpo(this.raio.bodyId);
    if (j >= 0 && j !== i) {
      const dano = fpsEhCabeca(this.jogadores[j], hp[1]) ? FPS_DANO * FPS_MULT_CABECA : FPS_DANO;
      this.aplicarDano(j, dano, i);
      return j;
    }
    this.adicionarEfeito(FPS_EFEITO_MARCA, hp[0], hp[1], hp[2], hp[0], hp[1], hp[2], FPS_VIDA_MARCA);
    return -1;
  }

  processarArmas(i: number, inp: FpsPlayerInput): void {
    const p = this.jogadores[i];
    if (!p.vivo) return;
    const dt = FPS_TICK_DT;
    if (p.tempoRecarga > 0.0) {
      p.tempoRecarga = p.tempoRecarga - dt;
      if (p.tempoRecarga <= 0.0) { p.tempoRecarga = 0.0; p.municao = FPS_PENTE; }
    }
    if (p.cadenciaRestante > 0.0) p.cadenciaRestante = p.cadenciaRestante - dt;
    if (inp.recarregar && p.tempoRecarga <= 0.0 && p.municao < FPS_PENTE) p.tempoRecarga = FPS_TEMPO_RECARGA;
    if (inp.atirar && p.tempoRecarga <= 0.0 && p.cadenciaRestante <= 0.000000001) {
      if (p.municao > 0) {
        this.disparar(i, this.ehBot[i] ? FPS_ERRO_MIRA_BOT : 0.0);
        p.municao = p.municao - 1;
        p.cadenciaRestante = p.cadenciaRestante + 1.0 / FPS_CADENCIA;
        if (p.municao === 0) p.tempoRecarga = FPS_TEMPO_RECARGA;   // última bala: recarrega sozinho
      } else {
        p.tempoRecarga = FPS_TEMPO_RECARGA;
      }
    }
  }
```

6. Em `passo`, troque a linha `    // 2. armas e granadas` por:

```ts
    // 2. armas e granadas
    i = 0;
    while (i < n) {
      this.processarArmas(i, this.inputsTick[i]);
      i = i + 1;
    }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/fps-weapons.ts`
Expected: 6 `[OK]` e `[PASSOU] fps-weapons`. Rode também `tests/fps-world.ts`: continua verde.

- [ ] **Step 6: Commit**

```bash
git add src/shared/weapons.ts src/shared/world.ts tests/fps-weapons.ts
git commit -m "feat(fps): fuzil hitscan com saída da própria caixa, cabeça e recarga"
```

---

### Tarefa 5: granadas e pool

**Files:**
- Modify: `src/shared/weapons.ts` (duas funções novas)
- Modify: `src/shared/world.ts` (pool de granadas e explosão)
- Test: `tests/fps-weapons.ts` (novos casos)

**Interfaces:**
- Consumes: Tarefas 3 e 4.
- Produces:
  - `fpsMoverGranada(pos: f64[], vel: f64[], dt: f64, sc: Scene, out: RaycastHit): void`;
  - `fpsDanoExplosao(gx, gy, gz: f64, alvo: FpsPlayerState, sc: Scene, out: RaycastHit): f64`;
  - em `FpsWorld`: arrays `grAtiva: boolean[]`, `grX`, `grY`, `grZ`, `grVx`, `grVy`, `grVz`, `grTempo: f64[]`, `grDono: number[]`, `grCorpo: GameObject[]`; métodos `criarGranada(x, y, z, vx, vy, vz: f64, dono: number): number` (-1 se o pool esgotou), `lancarGranada(i: number): number`, `atualizarGranadas(): void`, `explodir(k: number): void`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/fps-weapons.ts`, acrescente antes da linha final `if (falhas === 0) ...`:

```ts
// ── granadas ───────────────────────────────────────────────────────────────

function trio(nome: string, comParede: boolean): FpsWorld {
  const w = new FpsWorld(new Scene(nome), 6, 0.0);
  w.adicionarJogador(false); w.adicionarJogador(false); w.adicionarJogador(false);
  if (comParede) fpsMapaCaixa(w.scene, "parede", 1.0, 1.5, 0.0, 0.3, 3.0, 3.0, 100, 100, 100);
  const a = w.jogadores[0]; const b = w.jogadores[1]; const c = w.jogadores[2];
  a.x = 2.0; a.y = 0.0; a.z = 0.0;
  b.x = 4.0; b.y = 0.0; b.z = 0.0;
  c.x = 100.0; c.y = 0.0; c.z = 100.0;
  w.sincronizarCorpos();
  return w;
}

// 6. dano decrescente com a distância
{
  const w = trio("explosao", false);
  const k = w.criarGranada(0.0, 0.3, 0.0, 0.0, 0.0, 0.0, -1);
  w.grTempo[k] = FPS_TICK_DT * 0.5;
  w.passo([]);
  const va = w.jogadores[0].vida; const vb = w.jogadores[1].vida; const vc = w.jogadores[2].vida;
  check("granada: dano decrescente com a distância", va < vb && vb < 100.0 && vc === 100.0,
        "a=" + va + " b=" + vb + " c=" + vc);
  check("granada: explodiu e voltou ao pool", !w.grAtiva[k] && w.grCorpo[k].active === 0);
}

// 7. parede protege
{
  const w = trio("protegido", true);
  const k = w.criarGranada(0.0, 0.3, 0.0, 0.0, 0.0, 0.0, -1);
  w.grTempo[k] = FPS_TICK_DT * 0.5;
  w.passo([]);
  check("granada: parede protege quem está atrás", w.jogadores[0].vida === 100.0 && w.jogadores[1].vida === 100.0,
        "a=" + w.jogadores[0].vida + " b=" + w.jogadores[1].vida);
}

// 8. quica no chão e não atravessa
{
  const w = trio("quique", false);
  const k = w.criarGranada(-20.0, 5.0, 0.0, 3.0, -10.0, 0.0, -1);
  let menorY = 1e30;
  let t = 0;
  while (t < 120) {
    w.grTempo[k] = 10.0;
    w.passo([]);
    if (w.grY[k] < menorY) menorY = w.grY[k];
    t = t + 1;
  }
  check("granada quica e não atravessa o chão", menorY >= 0.13 && w.grY[k] < 0.5, "menorY=" + menorY + " y=" + w.grY[k]);
}

// 9. pool limitado, sem crescer a cena
{
  const w = trio("pool", false);
  const antes = w.scene.objects.length;
  let recusadas = 0;
  let g = 0;
  while (g < 40) { if (w.criarGranada(-50.0, 1.0, -50.0, 0.0, 0.0, 0.0, -1) < 0) recusadas = recusadas + 1; g = g + 1; }
  check("pool de granadas limitado e sem crescer a cena", recusadas === 8 && w.scene.objects.length === antes,
        "recusadas=" + recusadas);
}

// 10. limite por jogador e tempo entre granadas
{
  const w = trio("limite", false);
  const inp = fpsInputVazio();
  inp.granada = true;
  let t = 0;
  while (t < 10) { w.processarArmas(0, inp); t = t + 1; }
  check("uma granada por vez dentro do tempo de recarga", w.jogadores[0].granadasVivas === 1);
  while (t < 10 + 200) { w.processarArmas(0, inp); t = t + 1; }
  check("nunca mais que duas vivas", w.jogadores[0].granadasVivas === 2);
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/fps-weapons.ts`
Expected: FAIL: `w.criarGranada is not a function`.

- [ ] **Step 3: Implementar em `weapons.ts`**

Acrescente ao import de `./config`: `FPS_GRAVIDADE, FPS_RAIO_GRANADA, FPS_QUIQUE, FPS_RAIO_EXPLOSAO, FPS_DANO_GRANADA`. Acrescente ao fim do arquivo:

```ts
/// Um tick de granada: gravidade e quique contra o mapa (raycast no trecho).
export function fpsMoverGranada(pos: f64[], vel: f64[], dt: f64, sc: Scene, out: RaycastHit): void {
  vel[1] = vel[1] - FPS_GRAVIDADE * dt;
  const v = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
  if (v < 0.000001) return;
  const ux = vel[0] / v; const uy = vel[1] / v; const uz = vel[2] / v;
  const trecho = v * dt;
  if (fpsRaio(pos[0], pos[1], pos[2], ux, uy, uz, trecho + FPS_RAIO_GRANADA, out, FPS_CAMADA_MAPA, sc)) {
    const n0 = out.normal[0]; const n1 = out.normal[1]; const n2 = out.normal[2];
    // reposiciona pela NORMAL: em quique rasante, recuar ao longo do raio
    // deixaria o centro mais perto da superfície que o raio da granada
    pos[0] = out.point[0] + n0 * FPS_RAIO_GRANADA;
    pos[1] = out.point[1] + n1 * FPS_RAIO_GRANADA;
    pos[2] = out.point[2] + n2 * FPS_RAIO_GRANADA;
    const vn = vel[0] * n0 + vel[1] * n1 + vel[2] * n2;
    vel[0] = (vel[0] - 2.0 * vn * n0) * FPS_QUIQUE;
    vel[1] = (vel[1] - 2.0 * vn * n1) * FPS_QUIQUE;
    vel[2] = (vel[2] - 2.0 * vn * n2) * FPS_QUIQUE;
  } else {
    pos[0] = pos[0] + vel[0] * dt;
    pos[1] = pos[1] + vel[1] * dt;
    pos[2] = pos[2] + vel[2] * dt;
  }
}

/// Dano de uma explosão em (gx, gy, gz) sobre o alvo; 0 se estiver fora do
/// raio ou se houver mapa no caminho até o centro do corpo.
export function fpsDanoExplosao(gx: f64, gy: f64, gz: f64, alvo: FpsPlayerState, sc: Scene, out: RaycastHit): f64 {
  const dx = alvo.x - gx;
  const dy = alvo.y + FPS_ALTURA_CORPO * 0.5 - gy;
  const dz = alvo.z - gz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d >= FPS_RAIO_EXPLOSAO) return 0.0;
  if (d > 0.000001 && fpsRaio(gx, gy, gz, dx / d, dy / d, dz / d, d, out, FPS_CAMADA_MAPA, sc)) return 0.0;
  return FPS_DANO_GRANADA * (1.0 - d / FPS_RAIO_EXPLOSAO);
}
```

- [ ] **Step 4: Integrar em `world.ts`**

1. Acrescente ao import de `./config`: `FPS_ALTURA_OLHO, FPS_POOL_GRANADAS, FPS_RAIO_GRANADA, FPS_PAVIO, FPS_GRANADAS_POR_JOGADOR, FPS_TEMPO_GRANADA, FPS_VEL_GRANADA, FPS_IMPULSO_CIMA_GRANADA, FPS_RAIO_EXPLOSAO, FPS_DANO_GRANADA, FPS_EMPURRAO_GRANADA, FPS_EMPURRAO_CIMA_GRANADA, FPS_EFEITO_EXPLOSAO, FPS_VIDA_EXPLOSAO`.
2. Acrescente `FPS_CAMADA_GRANADA` ao import de `./layers`, e troque o import de `./weapons` por `import { fpsTiro, fpsEhCabeca, fpsMoverGranada, fpsDanoExplosao } from "./weapons";`.
3. Campos novos, logo depois de `tirosDisparados: number;`:

```ts
  grAtiva: boolean[];
  grX: f64[]; grY: f64[]; grZ: f64[];
  grVx: f64[]; grVy: f64[]; grVz: f64[];
  grTempo: f64[];
  grDono: number[];
  grCorpo: GameObject[];
  grPos: f64[];
  grVel: f64[];
```

4. No construtor, logo depois de `this.tirosDisparados = 0;` e **antes** de `sc.computeWorld();`:

```ts
    this.grAtiva = []; this.grX = []; this.grY = []; this.grZ = [];
    this.grVx = []; this.grVy = []; this.grVz = []; this.grTempo = []; this.grDono = [];
    this.grCorpo = [];
    this.grPos = [0.0, 0.0, 0.0];
    this.grVel = [0.0, 0.0, 0.0];
    k = 0;
    while (k < FPS_POOL_GRANADAS) {
      this.grAtiva.push(false);
      this.grX.push(0.0); this.grY.push(0.0); this.grZ.push(0.0);
      this.grVx.push(0.0); this.grVy.push(0.0); this.grVz.push(0.0);
      this.grTempo.push(0.0); this.grDono.push(-1);
      const g = new GameObject("granada" + k);
      g.setMesh(4, 50, 55, 40);
      g.transform.setScale(FPS_RAIO_GRANADA * 2.0);
      g.layer = FPS_CAMADA_GRANADA;
      g.active = 0;
      sc.add(g);
      this.grCorpo.push(g);
      k = k + 1;
    }
```

5. Métodos novos, logo antes de `inputDe(`:

```ts
  criarGranada(x: f64, y: f64, z: f64, vx: f64, vy: f64, vz: f64, dono: number): number {
    let k = 0;
    while (k < FPS_POOL_GRANADAS) {
      if (!this.grAtiva[k]) {
        this.grAtiva[k] = true;
        this.grX[k] = x; this.grY[k] = y; this.grZ[k] = z;
        this.grVx[k] = vx; this.grVy[k] = vy; this.grVz[k] = vz;
        this.grTempo[k] = FPS_PAVIO;
        this.grDono[k] = dono;
        this.grCorpo[k].active = 1;
        if (dono >= 0 && dono < this.jogadores.length) {
          this.jogadores[dono].granadasVivas = this.jogadores[dono].granadasVivas + 1;
        }
        return k;
      }
      k = k + 1;
    }
    return -1;
  }

  lancarGranada(i: number): number {
    const p = this.jogadores[i];
    const cp = Math.cos(p.pitch);
    const dx = Math.sin(p.yaw) * cp;
    const dy = Math.sin(p.pitch);
    const dz = Math.cos(p.yaw) * cp;
    p.tempoGranada = FPS_TEMPO_GRANADA;
    return this.criarGranada(p.x + dx * 0.6, p.y + FPS_ALTURA_OLHO, p.z + dz * 0.6,
                             dx * FPS_VEL_GRANADA, dy * FPS_VEL_GRANADA + FPS_IMPULSO_CIMA_GRANADA,
                             dz * FPS_VEL_GRANADA, i);
  }

  atualizarGranadas(): void {
    let k = 0;
    while (k < FPS_POOL_GRANADAS) {
      if (this.grAtiva[k]) {
        const pos = this.grPos; const vel = this.grVel;
        pos[0] = this.grX[k]; pos[1] = this.grY[k]; pos[2] = this.grZ[k];
        vel[0] = this.grVx[k]; vel[1] = this.grVy[k]; vel[2] = this.grVz[k];
        fpsMoverGranada(pos, vel, FPS_TICK_DT, this.scene, this.raio);
        this.grX[k] = pos[0]; this.grY[k] = pos[1]; this.grZ[k] = pos[2];
        this.grVx[k] = vel[0]; this.grVy[k] = vel[1]; this.grVz[k] = vel[2];
        this.grTempo[k] = this.grTempo[k] - FPS_TICK_DT;
        if (this.grTempo[k] <= 0.0) this.explodir(k);
      }
      k = k + 1;
    }
  }

  explodir(k: number): void {
    const x = this.grX[k]; const y = this.grY[k]; const z = this.grZ[k];
    const dono = this.grDono[k];
    const autor = dono < this.jogadores.length ? dono : -1;
    const n = fpsEsfera(x, y, z, FPS_RAIO_EXPLOSAO, this.hits, 16, FPS_CAMADA_JOGADOR, this.scene);
    const lim = n < 16 ? n : 16;
    let h = 0;
    while (h < lim) {
      const j = this.indicePorCorpo(this.hits[h].bodyId);
      if (j >= 0 && this.jogadores[j].vivo) {
        const p = this.jogadores[j];
        const dano = fpsDanoExplosao(x, y, z, p, this.scene, this.raio);
        if (dano > 0.0) {
          const fr = dano / FPS_DANO_GRANADA;
          let hx = p.x - x; let hz = p.z - z;
          const hl = Math.sqrt(hx * hx + hz * hz);
          if (hl > 0.000001) { hx = hx / hl; hz = hz / hl; } else { hx = 0.0; hz = 0.0; }
          p.vx = p.vx + hx * FPS_EMPURRAO_GRANADA * fr;
          p.vz = p.vz + hz * FPS_EMPURRAO_GRANADA * fr;
          p.vy = p.vy + FPS_EMPURRAO_CIMA_GRANADA * fr;
          p.noChao = false;
          this.aplicarDano(j, dano, autor);
        }
      }
      h = h + 1;
    }
    this.adicionarEfeito(FPS_EFEITO_EXPLOSAO, x, y, z, x, y, z, FPS_VIDA_EXPLOSAO);
    this.grAtiva[k] = false;
    this.grCorpo[k].active = 0;
    if (autor >= 0 && this.jogadores[autor].granadasVivas > 0) {
      this.jogadores[autor].granadasVivas = this.jogadores[autor].granadasVivas - 1;
    }
  }
```

6. Em `processarArmas`, acrescente antes do `}` final do método:

```ts
    if (p.tempoGranada > 0.0) p.tempoGranada = p.tempoGranada - dt;
    if (inp.granada && p.tempoGranada <= 0.0 && p.granadasVivas < FPS_GRANADAS_POR_JOGADOR) this.lancarGranada(i);
```

7. Em `passo`, logo depois do laço de `processarArmas` (passo 2), acrescente:

```ts
    this.atualizarGranadas();
```

8. Em `sincronizarCorpos`, logo antes de `this.scene.computeWorld();`:

```ts
    let k = 0;
    while (k < FPS_POOL_GRANADAS) {
      if (this.grAtiva[k]) this.grCorpo[k].transform.setPosition(this.grX[k], this.grY[k], this.grZ[k]);
      k = k + 1;
    }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/fps-weapons.ts`
Expected: 13 `[OK]` e `[PASSOU] fps-weapons`. Rode também `fps-world.ts`, `fps-player.ts` e `fps-map.ts`: continuam verdes.

- [ ] **Step 6: Commit**

```bash
git add src/shared/weapons.ts src/shared/world.ts tests/fps-weapons.ts
git commit -m "feat(fps): granadas com quique, explosão por overlap e linha de visada, em pool"
```

---

### Tarefa 6: bots, determinismo e teste de resistência

**Files:**
- Create: `src/shared/bots.ts`
- Modify: `src/shared/world.ts` (estado dos bots e `inputDe`)
- Test: `tests/fps-determinismo.ts`
- Test: `tests/fps-resistencia.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 5.
- Produces:
  - `interface FpsBotState { estado: number; alvo: number; destino: number; tempoParado: f64; refX: f64; refZ: f64; semente: number; ladoTempo: f64; ladoSinal: number; input: FpsPlayerInput }`;
  - `FPS_BOT_PATRULHA = 0`, `FPS_BOT_ATIRAR = 1`;
  - `fpsNovoBot(indice: number): FpsBotState`;
  - `fpsBotInput(b: FpsBotState, eu: number, jog: FpsPlayerState[], spawnX: f64[], spawnZ: f64[], tick: number, sc: Scene, out: RaycastHit): FpsPlayerInput`;
  - `FpsWorld.bots: FpsBotState[]`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/fps-determinismo.ts`:

```ts
// Determinismo com bots e casos de borda do mundo (entrega 1).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { fpsInputVazio, FpsPlayerInput } from "../src/shared/input";
import { FPS_TICK_DT } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function digital(w: FpsWorld): string {
  let s = "";
  let i = 0;
  while (i < w.jogadores.length) {
    const p = w.jogadores[i];
    s = s + p.x.toFixed(6) + "," + p.y.toFixed(6) + "," + p.z.toFixed(6) + "," + p.vida.toFixed(3) + "," +
        p.abates + "," + p.mortes + "," + p.municao + ";";
    i = i + 1;
  }
  return s;
}

function partida(nome: string): FpsWorld {
  const w = new FpsWorld(new Scene(nome), 31, 0.3);
  w.adicionarJogador(false);
  let b = 0;
  while (b < 8) { w.adicionarJogador(true); b = b + 1; }
  w.x0 = []; w.z0 = [];
  let j0 = 0;
  while (j0 < w.jogadores.length) { w.x0.push(w.jogadores[j0].x); w.z0.push(w.jogadores[j0].z); j0 = j0 + 1; }
  const inputs: FpsPlayerInput[] = [fpsInputVazio()];
  let t = 0;
  while (t < 600) {
    inputs[0].seq = t;
    inputs[0].frente = (t % 120) < 60 ? 1 : 0;
    inputs[0].yaw = t * 0.01;
    inputs[0].atirar = (t % 30) === 0;
    w.passo(inputs);
    t = t + 1;
  }
  return w;
}

io.print("=== fps-determinismo ===");

{
  const a = partida("det_a");
  const b = partida("det_b");
  check("com 8 bots: mesma semente e mesmos inputs dão o mesmo estado", digital(a) === digital(b));
  let andou = 0.0;
  let i = 1;
  while (i < a.jogadores.length) {
    andou = andou + Math.abs(a.jogadores[i].x - a.x0[i]) + Math.abs(a.jogadores[i].z - a.z0[i]);
    i = i + 1;
  }
  check("bots se movem", andou > 10.0, "soma=" + andou);
}

// remover um bot com granada no ar não quebra nem credita abate inexistente
{
  const w = new FpsWorld(new Scene("granada_orfa"), 32, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(true);
  const k = w.lancarGranada(1);
  w.removerUltimoBot();
  w.grTempo[k] = FPS_TICK_DT * 0.5;
  w.passo([]);
  check("granada de bot removido explode sem erro", !w.grAtiva[k] && w.jogadores.length === 1 && w.jogadores[0].abates === 0);
}

// todos os renascimentos ocupados: ninguém fica preso morto
{
  const w = new FpsWorld(new Scene("lotado"), 33, 0.0);
  let j = 0;
  while (j < 70) { w.adicionarJogador(false); j = j + 1; }   // humanos parados: bots se matariam amontoados
  let t = 0;
  while (t < 30) { w.passo([]); t = t + 1; }
  let vivos = 0;
  j = 0;
  while (j < w.jogadores.length) { if (w.jogadores[j].vivo) vivos = vivos + 1; j = j + 1; }
  check("70 jogadores para 64 renascimentos: todos nascem", vivos === 70, "vivos=" + vivos);
}

if (falhas === 0) io.print("[PASSOU] fps-determinismo"); else io.print("[FALHOU] fps-determinismo: " + falhas + " falha(s)");
```

`tests/fps-resistencia.ts`:

```ts
// Resistência: 12 bots, 60 s de simulação no mapa completo. Verifica NaN,
// jogador dentro da geometria e o tempo por tick (spec §2: <= 4 ms).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { createOverlapHit, OverlapHit } from "@engine/core/spatial_queries";
import { FpsWorld } from "../src/shared/world";
import { fpsEsfera } from "../src/shared/consultas";
import { FPS_CAMADA_MAPA } from "../src/shared/layers";
import { FPS_SEMENTE_PADRAO, FPS_BOTS_PADRAO, FPS_RAIO_CORPO, FPS_ALTURA_CORPO, FPS_ALTURA_DEGRAU } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

io.print("=== fps-resistencia ===");
const w = new FpsWorld(new Scene("resistencia"), FPS_SEMENTE_PADRAO, 1.0);
let b = 0;
while (b < FPS_BOTS_PADRAO) { w.adicionarJogador(true); b = b + 1; }
io.print("  estaticos=" + w.mapa.objetos + " objetos na cena=" + w.scene.objects.length);

const hits: OverlapHit[] = [];
let q = 0;
while (q < 8) { hits.push(createOverlapHit()); q = q + 1; }

const TICKS = 3600;
const tempos: f64[] = [];
let nans = 0;
let piorProfundidade = 0.0;
let piorDegrau = 0.0;
let t = 0;
while (t < TICKS) {
  w.passo([]);
  tempos.push(w.ultMsTick);
  let i = 0;
  while (i < w.jogadores.length) {
    const p = w.jogadores[i];
    if (p.x !== p.x || p.y !== p.y || p.z !== p.z || p.vx !== p.vx || p.vy !== p.vy || p.vz !== p.vz) nans = nans + 1;
    if (p.vivo) {
      let e = 0;
      while (e < 2) {
        const cy = e === 0 ? p.y + FPS_RAIO_CORPO : p.y + FPS_ALTURA_CORPO - FPS_RAIO_CORPO;
        const n = fpsEsfera(p.x, cy, p.z, FPS_RAIO_CORPO, hits, 8, FPS_CAMADA_MAPA, w.scene);
        const lim = n < 8 ? n : 8;
        let h = 0;
        while (h < lim) {
          // quina de degrau sob os pés (normal para baixo, contato na faixa do
          // degrau) é a subida de escada em andamento, não jogador preso
          const contatoY = cy + hits[h].normal[1] * FPS_RAIO_CORPO;
          const subindoDegrau = e === 0 && hits[h].normal[1] < -0.2 && contatoY < p.y + FPS_ALTURA_DEGRAU;
          if (subindoDegrau) { if (hits[h].depth > piorDegrau) piorDegrau = hits[h].depth; }
          else if (hits[h].depth > piorProfundidade) piorProfundidade = hits[h].depth;
          h = h + 1;
        }
        e = e + 1;
      }
    }
    i = i + 1;
  }
  t = t + 1;
}

tempos.sort((x: f64, y: f64) => x - y);
const mediana = tempos[(tempos.length / 2) | 0];
const p99 = tempos[Math.min(tempos.length - 1, (tempos.length * 0.99) | 0)];
io.print("  tick: mediana=" + mediana.toFixed(3) + " ms  p99=" + p99.toFixed(3) + " ms  tiros=" + w.tirosDisparados + "  quina de degrau (informativo)=" + piorDegrau.toFixed(3));

check("sem NaN em 3.600 ticks", nans === 0, "nans=" + nans);
check("nenhum jogador dentro da geometria (profundidade <= 0,05)", piorProfundidade <= 0.05, "pior=" + piorProfundidade);
check("bots atiraram", w.tirosDisparados > 0);
check("tick mediano <= 4 ms", mediana <= 4.0, "mediana=" + mediana);

if (falhas === 0) io.print("[PASSOU] fps-resistencia"); else io.print("[FALHOU] fps-resistencia: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/fps-determinismo.ts`
Expected: FAIL em "bots se movem" (bots ainda recebem o input nulo e ficam parados).

- [ ] **Step 3: Implementar `bots.ts`**

`src/shared/bots.ts`:

```ts
// IA dos bots: produz um FpsPlayerInput por tick, pelo mesmo caminho dos
// humanos. Não importa world.ts; recebe por parâmetro o que precisa.
import { Scene } from "@engine/core/scene";
import { RaycastHit } from "@engine/core/spatial_queries";
import {
  FPS_TICK_DT, FPS_ALTURA_OLHO, FPS_ALTURA_CORPO, FPS_VISAO_BOT, FPS_TICKS_ENTRE_VISADAS,
  FPS_TEMPO_PARADO_BOT, FPS_DIST_CHEGOU_BOT,
} from "./config";
import { FPS_CAMADA_MAPA } from "./layers";
import { FpsPlayerInput, fpsInputVazio } from "./input";
import { FpsPlayerState } from "./player";
import { fpsRaio } from "./consultas";

export const FPS_BOT_PATRULHA = 0;
export const FPS_BOT_ATIRAR = 1;

export interface FpsBotState {
  estado: number;
  alvo: number;
  destino: number;
  tempoParado: f64;
  refX: f64;
  refZ: f64;
  semente: number;
  ladoTempo: f64;
  ladoSinal: number;
  input: FpsPlayerInput;
}

export function fpsNovoBot(indice: number): FpsBotState {
  return {
    estado: FPS_BOT_PATRULHA, alvo: -1, destino: -1, tempoParado: 0.0, refX: 0.0, refZ: 0.0,
    semente: 1000 + indice * 7919, ladoTempo: 0.0, ladoSinal: 1, input: fpsInputVazio(),
  };
}

function fpsBotRnd(b: FpsBotState): f64 {
  b.semente = ((b.semente * 1664525 + 1013904223) | 0);
  return (b.semente >>> 0) / 4294967296.0;
}

/// Jogador vivo mais próximo, dentro de FPS_VISAO_BOT, com linha de visada livre.
function fpsBotProcurarAlvo(eu: number, jog: FpsPlayerState[], sc: Scene, out: RaycastHit): number {
  const p = jog[eu];
  const ex = p.x; const ey = p.y + FPS_ALTURA_OLHO; const ez = p.z;
  let melhor = -1;
  let melhorD2 = FPS_VISAO_BOT * FPS_VISAO_BOT;
  let j = 0;
  while (j < jog.length) {
    const q = jog[j];
    if (j !== eu && q.vivo) {
      const dx = q.x - ex; const dy = q.y + FPS_ALTURA_CORPO * 0.5 - ey; const dz = q.z - ez;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < melhorD2 && d2 > 0.000001) {
        const d = Math.sqrt(d2);
        if (!fpsRaio(ex, ey, ez, dx / d, dy / d, dz / d, d, out, FPS_CAMADA_MAPA, sc)) {
          melhor = j;
          melhorD2 = d2;
        }
      }
    }
    j = j + 1;
  }
  return melhor;
}

export function fpsBotInput(b: FpsBotState, eu: number, jog: FpsPlayerState[], spawnX: f64[], spawnZ: f64[],
                            tick: number, sc: Scene, out: RaycastHit): FpsPlayerInput {
  const inp = b.input;
  const p = jog[eu];
  inp.seq = tick;
  inp.frente = 0; inp.lado = 0;
  inp.pulo = false; inp.atirar = false; inp.recarregar = false; inp.granada = false;
  inp.yaw = p.yaw; inp.pitch = p.pitch;
  if (!p.vivo) {
    b.estado = FPS_BOT_PATRULHA; b.alvo = -1; b.destino = -1;
    return inp;
  }

  // visada escalonada: o bot i só procura nos ticks i, i+12, i+24...
  if ((tick % FPS_TICKS_ENTRE_VISADAS) === (eu % FPS_TICKS_ENTRE_VISADAS)) {
    b.alvo = fpsBotProcurarAlvo(eu, jog, sc, out);
    b.estado = b.alvo >= 0 ? FPS_BOT_ATIRAR : FPS_BOT_PATRULHA;
  }

  if (b.estado === FPS_BOT_ATIRAR && b.alvo >= 0 && b.alvo < jog.length && jog[b.alvo].vivo) {
    const q = jog[b.alvo];
    const dx = q.x - p.x;
    const dy = q.y + FPS_ALTURA_CORPO * 0.5 - (p.y + FPS_ALTURA_OLHO);
    const dz = q.z - p.z;
    inp.yaw = Math.atan2(dx, dz);
    inp.pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    inp.atirar = true;
    b.ladoTempo = b.ladoTempo - FPS_TICK_DT;
    if (b.ladoTempo <= 0.0) {
      b.ladoTempo = 0.5 + fpsBotRnd(b);
      b.ladoSinal = fpsBotRnd(b) < 0.5 ? -1 : 1;
    }
    inp.lado = b.ladoSinal;
    if (p.municao === 0) inp.recarregar = true;
    return inp;
  }

  // patrulha entre pontos de renascimento
  if (b.destino < 0) {
    b.destino = Math.floor(fpsBotRnd(b) * spawnX.length) % spawnX.length;
    b.tempoParado = 0.0;
    b.refX = p.x; b.refZ = p.z;
  }
  const tx = spawnX[b.destino] - p.x;
  const tz = spawnZ[b.destino] - p.z;
  if (tx * tx + tz * tz < FPS_DIST_CHEGOU_BOT * FPS_DIST_CHEGOU_BOT) {
    b.destino = -1;
    return inp;
  }
  inp.yaw = Math.atan2(tx, tz);
  inp.pitch = 0.0;
  inp.frente = 1;
  b.tempoParado = b.tempoParado + FPS_TICK_DT;
  if (b.tempoParado >= FPS_TEMPO_PARADO_BOT) {
    const mx = p.x - b.refX; const mz = p.z - b.refZ;
    if (mx * mx + mz * mz < 1.0) { b.destino = -1; inp.pulo = true; }
    b.tempoParado = 0.0;
    b.refX = p.x; b.refZ = p.z;
  }
  return inp;
}
```

- [ ] **Step 4: Integrar em `world.ts`**

1. Import: `import { FpsBotState, fpsNovoBot, fpsBotInput } from "./bots";`
2. Campo novo, logo depois de `ehBot: boolean[];`: `  bots: FpsBotState[];`
3. No construtor, logo depois de `this.ehBot = [];`: `    this.bots = [];`
4. Em `adicionarJogador`, logo depois de `this.ehBot.push(ehBot);`: `    this.bots.push(fpsNovoBot(i));`
5. Em `removerUltimoBot`, logo depois de `this.ehBot.pop();`: `    this.bots.pop();`
6. Troque o corpo de `inputDe` por:

```ts
  inputDe(i: number, inputs: FpsPlayerInput[]): FpsPlayerInput {
    if (this.ehBot[i]) {
      return fpsBotInput(this.bots[i], i, this.jogadores, this.mapa.spawnX, this.mapa.spawnZ,
                         this.tickAtual, this.scene, this.raio);
    }
    return i < inputs.length ? inputs[i] : this.inputNulo;
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/fps-determinismo.ts`
Expected: 4 `[OK]` e `[PASSOU] fps-determinismo`.

Run: `../rts/target/release/rts.exe run tests/fps-resistencia.ts`
Expected: 4 `[OK]` e `[PASSOU] fps-resistencia`, com a linha `tick: mediana=... p99=...` impressa.

Se a mediana passar de 4 ms, **não afrouxe a meta**: rode de novo com `fpsGerarMapa(..., 0.5)` para separar o custo do mapa do custo dos bots e registre os dois números no relatório da tarefa. A decisão sobre a escala padrão fica para a Tarefa 8.

Rode também os quatro testes anteriores: continuam verdes.

- [ ] **Step 6: Commit**

```bash
git add src/shared/bots.ts src/shared/world.ts tests/fps-determinismo.ts tests/fps-resistencia.ts
git commit -m "feat(fps): bots pelo mesmo caminho de input, determinismo e teste de resistência"
```

---

### Tarefa 7: cliente com janela

**Files:**
- Create: `src/client.ts`

**Interfaces:**
- Consumes: `FpsWorld` completo (Tarefas 3 a 6), `fpsInputVazio`, constantes `FPS_*`.
- Produces: o executável do jogo local.

- [ ] **Step 1: Implementar `client.ts`**

`src/client.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════════════
// FPS do rts-game: cliente com janela (entrega 1, local contra bots).
//
//   ../rts/target/release/examples/ui_fixture.exe src/client.ts
//
// Este arquivo só lê teclado e mouse, monta um FpsPlayerInput por frame,
// chama FpsWorld.passo em tick fixo e desenha. Toda regra de jogo está em
// src/shared/, que não conhece janela.
// ═══════════════════════════════════════════════════════════════════════════
import io from "@compat/io.ts";
import input from "rts:input";
import { mouseLock } from "rts:egui";
import { createAppAt } from "@compat/app.ts";
import { scene } from "@editor/control/session";
import { ctrlServe, ctrlPoll } from "@editor/control/server";
import { initMeshes, setCam, setLgt, setShadow, drawGPU, frustumBegin, inFrustumFast,
         winWidth, winHeight, setVsync } from "@engine/render/gpu3d";
import { Transform } from "@engine/core/transform";
import { GameObject } from "@engine/core/gameobject";
import { FpsWorld } from "./shared/world";
import { FpsPlayerInput, fpsInputVazio } from "./shared/input";
import {
  FPS_TICK_DT, FPS_MAX_TICKS_POR_FRAME, FPS_SEMENTE_PADRAO, FPS_BOTS_PADRAO, FPS_ALTURA_OLHO,
  FPS_PITCH_MAX, FPS_GRANADAS_POR_JOGADOR, FPS_POOL_EFEITOS, FPS_EFEITO_MARCA, FPS_EFEITO_TRACADOR,
  FPS_EFEITO_EXPLOSAO, FPS_VIDA_EXPLOSAO, FPS_RAIO_EXPLOSAO,
} from "./shared/config";

// ── teclas: códigos neutros do rts-egui (A..Z = 100..125, F1..F12 = 140..151) ──
const FPS_TECLA_A = 100;
const FPS_TECLA_D = 103;
const FPS_TECLA_G = 106;
const FPS_TECLA_M = 112;
const FPS_TECLA_N = 113;
const FPS_TECLA_R = 117;
const FPS_TECLA_S = 118;
const FPS_TECLA_W = 122;
const FPS_TECLA_ESC = 2;
const FPS_TECLA_ESPACO = 3;
const FPS_TECLA_F3 = 142;
const FPS_BOTAO_ESQ = 0;

// ── câmera, luz e sensibilidade ─────────────────────────────────────────────
const FPS_FOV: f64 = 1.2;
const FPS_SENS_MOUSE: f64 = 0.0025;
const FPS_ALTURA_CAMERA_MORTO: f64 = 4.0;
const FPS_LUZ_X: f64 = 60.0;
const FPS_LUZ_Y: f64 = 120.0;
const FPS_LUZ_Z: f64 = -40.0;
const FPS_LUZ_AMBIENTE: f64 = 0.35;
const FPS_SOMBRA_ALCANCE: f64 = 80.0;
const FPS_DT_MAX: f64 = 0.25;
const FPS_JANELA_MIN = 200;

// ── HUD (medidas e cores nomeadas) ──────────────────────────────────────────
const FPS_HUD_MARGEM = 14;
const FPS_HUD_LINHA = 20;
const FPS_HUD_LINHA_DEBUG = 16;
const FPS_HUD_TAM = 16;
const FPS_HUD_TAM_DEBUG = 13;
const FPS_HUD_TAM_MIRA = 20;
const FPS_HUD_MEIA_MIRA_X = 5;
const FPS_HUD_MEIA_MIRA_Y = 11;
const FPS_HUD_TOPO_DEBUG = 70;
const FPS_HUD_AVISO_DY = 40;
const FPS_HUD_AVISO_MEIA_LARGURA = 170;
const FPS_HUD_VIDA_BAIXA: f64 = 30.0;
const FPS_COR_TEXTO = 0xE8F0FFFF;
const FPS_COR_ALERTA = 0xFF6060FF;
const FPS_COR_DEBUG = 0x9FB4C8FF;
const FPS_COR_MIRA = 0xFFFFFFFF;
const FPS_COR_AJUDA = 0x708096FF;

// ── efeitos ─────────────────────────────────────────────────────────────────
const FPS_COR_MARCA = 0x202020;
const FPS_COR_TRACADOR = 0xFFE080;
const FPS_COR_EXPLOSAO = 0xFF8020;
const FPS_TAM_MARCA: f64 = 0.12;
const FPS_TAM_TRACADOR: f64 = 0.05;
const FPS_PONTOS_TRACADOR = 6;
const FPS_MALHA_CUBO = 1;
const FPS_MALHA_ESFERA = 4;

let fpsW = 1280;
let fpsH = 720;
const fpsApp = createAppAt("rts-game FPS", fpsW, fpsH, 60, 40);
const FPS_WIN = fpsApp._win;
initMeshes(FPS_WIN);
setVsync(FPS_WIN, 1);
ctrlServe(7777);

const fpsMundo = new FpsWorld(scene, FPS_SEMENTE_PADRAO, 1.0);
const FPS_HUMANO = fpsMundo.adicionarJogador(false);
let fpsB = 0;
while (fpsB < FPS_BOTS_PADRAO) { fpsMundo.adicionarJogador(true); fpsB = fpsB + 1; }
io.print("[fps] mapa com " + fpsMundo.mapa.objetos + " estaticos, " + FPS_BOTS_PADRAO + " bots. Clique para jogar.");

const fpsInputs: FpsPlayerInput[] = [fpsInputVazio()];
let fpsYaw: f64 = fpsMundo.jogadores[FPS_HUMANO].yaw;
let fpsPitch: f64 = 0.0;
let fpsTravado = 0;
let fpsDebug = 0;
let fpsSeq = 0;
let fpsAcumulador: f64 = 0.0;
let fpsUltimo: f64 = performance.now();
let fpsMsSimFrame: f64 = 0.0;
let fpsMsRender: f64 = 0.0;
let fpsDesenhados = 0;

function fpsLerEntrada(): void {
  if (fpsTravado === 0 && input.mouseClicked(FPS_WIN, FPS_BOTAO_ESQ)) {
    fpsTravado = 1;
    mouseLock(FPS_WIN, 1);
  } else if (fpsTravado !== 0 && fpsApp.keyPressed(FPS_TECLA_ESC) !== 0) {
    fpsTravado = 0;
    mouseLock(FPS_WIN, 0);
  }
  if (fpsTravado !== 0) {
    fpsYaw = fpsYaw + input.mouseDeltaX(FPS_WIN) * FPS_SENS_MOUSE;
    fpsPitch = fpsPitch - input.mouseDeltaY(FPS_WIN) * FPS_SENS_MOUSE;
    if (fpsPitch > FPS_PITCH_MAX) fpsPitch = FPS_PITCH_MAX;
    if (fpsPitch < 0.0 - FPS_PITCH_MAX) fpsPitch = 0.0 - FPS_PITCH_MAX;
  }
  const inp = fpsInputs[0];
  fpsSeq = fpsSeq + 1;
  inp.seq = fpsSeq;
  inp.frente = fpsApp.keyDown(FPS_TECLA_W) - fpsApp.keyDown(FPS_TECLA_S);
  inp.lado = fpsApp.keyDown(FPS_TECLA_D) - fpsApp.keyDown(FPS_TECLA_A);
  inp.pulo = fpsApp.keyDown(FPS_TECLA_ESPACO) !== 0;
  inp.yaw = fpsYaw;
  inp.pitch = fpsPitch;
  inp.atirar = fpsTravado !== 0 && input.mouseDown(FPS_WIN, FPS_BOTAO_ESQ);
  inp.recarregar = fpsApp.keyPressed(FPS_TECLA_R) !== 0;
  inp.granada = fpsApp.keyPressed(FPS_TECLA_G) !== 0;
  if (fpsApp.keyPressed(FPS_TECLA_F3) !== 0) fpsDebug = 1 - fpsDebug;
  if (fpsApp.keyPressed(FPS_TECLA_N) !== 0) fpsMundo.adicionarJogador(true);
  if (fpsApp.keyPressed(FPS_TECLA_M) !== 0) fpsMundo.removerUltimoBot();
}

function fpsSimular(): void {
  const agora = performance.now();
  let dt = (agora - fpsUltimo) / 1000.0;
  fpsUltimo = agora;
  if (dt > FPS_DT_MAX) dt = FPS_DT_MAX;
  fpsAcumulador = fpsAcumulador + dt;
  const t0 = performance.now();
  let ticks = 0;
  while (fpsAcumulador >= FPS_TICK_DT && ticks < FPS_MAX_TICKS_POR_FRAME) {
    fpsMundo.passo(fpsInputs);
    // bordas (tecla apertada neste frame) valem um tick só
    fpsInputs[0].granada = false;
    fpsInputs[0].recarregar = false;
    fpsAcumulador = fpsAcumulador - FPS_TICK_DT;
    ticks = ticks + 1;
  }
  if (ticks === FPS_MAX_TICKS_POR_FRAME) fpsAcumulador = 0.0;
  fpsMsSimFrame = performance.now() - t0;
}

function fpsDesenharEfeito(e: number): void {
  const m = fpsMundo;
  const tipo = m.efTipo[e];
  if (tipo === FPS_EFEITO_MARCA) {
    drawGPU(FPS_WIN, FPS_MALHA_CUBO, m.efX0[e], m.efY0[e], m.efZ0[e], 0.0, 0.0,
            FPS_TAM_MARCA, FPS_TAM_MARCA, FPS_TAM_MARCA, FPS_COR_MARCA, 0, 0);
  } else if (tipo === FPS_EFEITO_TRACADOR) {
    let k = 1;
    while (k <= FPS_PONTOS_TRACADOR) {
      const f = k / (FPS_PONTOS_TRACADOR + 1.0);
      drawGPU(FPS_WIN, FPS_MALHA_CUBO,
              m.efX0[e] + (m.efX1[e] - m.efX0[e]) * f,
              m.efY0[e] + (m.efY1[e] - m.efY0[e]) * f,
              m.efZ0[e] + (m.efZ1[e] - m.efZ0[e]) * f,
              0.0, 0.0, FPS_TAM_TRACADOR, FPS_TAM_TRACADOR, FPS_TAM_TRACADOR, FPS_COR_TRACADOR, 1, 0);
      k = k + 1;
    }
  } else if (tipo === FPS_EFEITO_EXPLOSAO) {
    const fr = m.efVida[e] / FPS_VIDA_EXPLOSAO;
    const d = FPS_RAIO_EXPLOSAO * 2.0 * (1.0 - fr * 0.5);
    drawGPU(FPS_WIN, FPS_MALHA_ESFERA, m.efX0[e], m.efY0[e], m.efZ0[e], 0.0, 0.0, d, d, d, FPS_COR_EXPLOSAO, 1, 0);
  }
}

function fpsDesenharMundo(): void {
  const eu = fpsMundo.jogadores[FPS_HUMANO];
  const camY = eu.vivo ? eu.y + FPS_ALTURA_OLHO : eu.y + FPS_ALTURA_CAMERA_MORTO;
  const aspecto = fpsW / fpsH;
  setCam(FPS_WIN, eu.x, camY, eu.z, fpsYaw, fpsPitch, FPS_FOV, aspecto);
  setLgt(FPS_WIN, FPS_LUZ_X, FPS_LUZ_Y, FPS_LUZ_Z, FPS_LUZ_AMBIENTE);
  setShadow(FPS_WIN, 0.0 - FPS_LUZ_X, 0.0 - FPS_LUZ_Y, 0.0 - FPS_LUZ_Z, 0.0, 1.0, 0.0, FPS_SOMBRA_ALCANCE);
  frustumBegin(eu.x, camY, eu.z, fpsYaw, fpsPitch, FPS_FOV, aspecto);
  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;
  const meuCorpo = fpsMundo.corpos[FPS_HUMANO];
  let desenhados = 0;
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    if (o.active !== 0 && o !== meuCorpo) {
      const t: Transform = trs[i];
      let rmax: f64 = t.sx;
      if (t.sy > rmax) rmax = t.sy;
      if (t.sz > rmax) rmax = t.sz;
      if (inFrustumFast(t.wx, t.wy, t.wz, rmax * 0.87) !== 0) {
        const col = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
        drawGPU(FPS_WIN, o.meshKind, t.wx, t.wy, t.wz, t.wrx, t.wry, t.sx, t.sy, t.sz, col, o.emissive, o.tex);
        desenhados = desenhados + 1;
      }
    }
    i = i + 1;
  }
  let e = 0;
  while (e < FPS_POOL_EFEITOS) {
    if (fpsMundo.efVida[e] > 0.0) fpsDesenharEfeito(e);
    e = e + 1;
  }
  fpsDesenhados = desenhados;
}

function fpsHud(): void {
  const eu = fpsMundo.jogadores[FPS_HUMANO];
  fpsApp.text(fpsW / 2 - FPS_HUD_MEIA_MIRA_X, fpsH / 2 - FPS_HUD_MEIA_MIRA_Y, "+", FPS_COR_MIRA, FPS_HUD_TAM_MIRA);
  let y = FPS_HUD_MARGEM;
  const recarga = eu.tempoRecarga > 0.0 ? " (recarregando)" : "";
  fpsApp.text(FPS_HUD_MARGEM, y,
              "vida " + Math.round(eu.vida) + "   municao " + eu.municao + recarga +
              "   granadas " + (FPS_GRANADAS_POR_JOGADOR - eu.granadasVivas),
              eu.vida < FPS_HUD_VIDA_BAIXA ? FPS_COR_ALERTA : FPS_COR_TEXTO, FPS_HUD_TAM);
  y = y + FPS_HUD_LINHA;
  fpsApp.text(FPS_HUD_MARGEM, y, "abates " + eu.abates + "   mortes " + eu.mortes +
              "   bots " + (fpsMundo.jogadores.length - 1), FPS_COR_TEXTO, FPS_HUD_TAM);
  if (!eu.vivo) {
    fpsApp.text(fpsW / 2 - FPS_HUD_AVISO_MEIA_LARGURA, fpsH / 2 + FPS_HUD_AVISO_DY,
                "voce morreu, renascendo em " + Math.max(0.0, eu.tempoRenascer).toFixed(1) + " s",
                FPS_COR_ALERTA, FPS_HUD_TAM);
  } else if (fpsTravado === 0) {
    fpsApp.text(fpsW / 2 - FPS_HUD_AVISO_MEIA_LARGURA, fpsH / 2 + FPS_HUD_AVISO_DY,
                "clique para jogar (Esc solta o mouse)", FPS_COR_TEXTO, FPS_HUD_TAM);
  }
  fpsApp.text(FPS_HUD_MARGEM, fpsH - FPS_HUD_MARGEM - FPS_HUD_TAM,
              "WASD anda | espaco pula | clique atira | R recarrega | G granada | N/M bot +/- | F3 depuracao",
              FPS_COR_AJUDA, FPS_HUD_TAM_DEBUG);
  if (fpsDebug !== 0) {
    const m = fpsMundo;
    const consultas = m.ultRaios + m.ultEsferas;
    const usPorConsulta = consultas > 0 ? (m.ultMsConsultas * 1000.0 / consultas) : 0.0;
    let yd = FPS_HUD_TOPO_DEBUG;
    fpsApp.text(FPS_HUD_MARGEM, yd, "fps " + Math.floor(fpsApp.fps()) + "   sim/frame " + fpsMsSimFrame.toFixed(2) +
                " ms   ultimo tick " + m.ultMsTick.toFixed(2) + " ms   render " + fpsMsRender.toFixed(2) + " ms",
                FPS_COR_DEBUG, FPS_HUD_TAM_DEBUG);
    yd = yd + FPS_HUD_LINHA_DEBUG;
    fpsApp.text(FPS_HUD_MARGEM, yd, "consultas/tick: raios " + m.ultRaios + "  esferas " + m.ultEsferas +
                "  (" + usPorConsulta.toFixed(1) + " us cada)", FPS_COR_DEBUG, FPS_HUD_TAM_DEBUG);
    yd = yd + FPS_HUD_LINHA_DEBUG;
    fpsApp.text(FPS_HUD_MARGEM, yd, "estaticos " + m.mapa.objetos + "   objetos " + scene.objects.length +
                "   desenhados " + fpsDesenhados + "   tiros " + m.tirosDisparados,
                FPS_COR_DEBUG, FPS_HUD_TAM_DEBUG);
  }
}

function fpsQuadro(): void {
  const nw = winWidth(FPS_WIN);
  const nh = winHeight(FPS_WIN);
  if (nw > FPS_JANELA_MIN) fpsW = nw;
  if (nh > FPS_JANELA_MIN) fpsH = nh;
  fpsLerEntrada();
  fpsSimular();
  ctrlPoll(fpsW, fpsH);
  const t1 = performance.now();
  fpsDesenharMundo();
  fpsMsRender = performance.now() - t1;
  fpsHud();
  fpsApp.endFrame();
}

while (fpsApp.running()) {
  if (!fpsApp.beginFrame()) break;
  fpsQuadro();
}
io.print("[fps] encerrado");
fpsApp.close();
```

- [ ] **Step 2: Compilar e abrir**

Run: `../rts/target/release/examples/ui_fixture.exe src/client.ts`
Expected no terminal: `[fps] mapa com 2975 estaticos, 12 bots. Clique para jogar.`, seguido de `[controle] ws://127.0.0.1:7777 pronto`. A janela abre na cidade.

- [ ] **Step 3: Verificar pela porta de controle**

Com o cliente aberto, em outro terminal:

Run: `python tools/ws_client.py "state"`
Expected: JSON com a contagem de objetos da cena (≈ 3.020: 2.975 do mapa + 13 jogadores + 32 granadas do pool).

- [ ] **Step 4: Verificação manual (humano)**

Na janela: clique para travar o mouse e confira cada item.
- olhar ao redor com o mouse e andar com WASD;
- pular com espaço e subir uma escada de degraus;
- atirar num bot: ele perde vida e morre em 4 tiros no corpo;
- `G` lança granada, que quica e explode;
- `F3` mostra o painel de depuração;
- `N` e `M` mudam a contagem de bots;
- `Esc` solta o mouse;
- morrer mostra a contagem de renascimento.

Anote a linha do `F3` (fps, ms por tick, ms de render) para a Tarefa 8.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts
git commit -m "feat(fps): cliente com janela, câmera em primeira pessoa, HUD e painel F3"
```

---

### Tarefa 8: medição, README e fechamento

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rodar a suíte inteira e guardar a saída**

```bash
for t in fps-map fps-player fps-world fps-weapons fps-determinismo fps-resistencia; do ../rts/target/release/rts.exe run tests/$t.ts 2>&1 | tail -3; done
```

Expected: `[PASSOU]` nos seis. Copie a linha `tick: mediana=... p99=...` do `fps-resistencia`.

- [ ] **Step 2: Confirmar que os testes do motor seguem verdes**

```bash
for t in claude-test-consultas claude-test-ressync claude-test-sceneio-roundtrip; do ../rts/target/release/rts.exe run tests/$t.ts 2>&1 | tail -1; done
```

Expected: `[PASSOU]` nos três. O jogo não toca no motor; isto confirma.

- [ ] **Step 3: Atualizar o README**

Em `README.md`:
- troque a linha `> Status: **desenho**...` por `> Status: **entrega 1 pronta** (jogo local contra bots). Próximo: entrega 2 (servidor UDP).`;
- troque a seção "Estrutura prevista" por uma seção "Como rodar", com:
  - os comandos do cliente e dos testes (os mesmos das Global Constraints);
  - a lista de controles;
  - uma tabela "Medido em <data>" com a saída **colada** do `fps-resistencia` (mediana e p99 do tick, estáticos) e a linha do `F3` anotada na Tarefa 7 (fps, render ms).

Se alguma meta da spec §2 não fechou, escreva **quanto falta e por quê**, conforme `docs/licoes-revisao.md`, lição 1.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(fps): entrega 1 pronta, com medições e instruções"
```
