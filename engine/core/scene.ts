// Engine RTS — Scene: a lista de GameObjects + o laço de update polimórfico.
// O render pass roda separado (main.ts) lendo os objetos desta cena.

import { GameObject, COL_BOX } from "./gameobject";
import { Transform } from "./transform";
import { Behavior, KIND_CAMERA } from "./behavior";
import math from "rts:math";

export class Scene {
  name: string;
  objects: GameObject[];
  // Buffers REAPROVEITADOS entre frames pelo broad-phase da colisão e pelo
  // computeWorld. Alocar por frame no laço mais quente do motor gerava
  // pressão de GC; estes são limpos (length=0 / clear) em vez de recriados.
  cIdx: number[];                    // índices dos colidíveis DINÂMICOS
  /// Colidíveis ESTÁTICOS, FORA do grid. Um chão de 90 de largura dimensionava
  /// a célula (2× o maior raio = 180): TODOS os corpos caíam na mesma célula e
  /// a colisão virava O(n²) — a fortaleza de 392 blocos rodava a ~6 fps. A
  /// célula agora é dimensionada só pelos dinâmicos, e cada móvel testa os
  /// estáticos por lista direta (eles são poucos: chão, paredes, rampas).
  sIdx: number[];
  /// Dinâmicos GRANDES (raio > BIG_R), também fora do grid — pelo mesmo motivo
  /// dos estáticos: um telhado de 5 de largura dimensionava a célula em 5 e
  /// cada varredura de 9 células visitava ~100 vizinhos em vez de ~6. Grandes
  /// são poucos (telhados, balas) e testam contra tudo por lista direta.
  bIdx: number[];
  // ── HASH ESPACIAL em ARRAYS (não `Map`) ──────────────────────────────────
  // Era `Map<number, number[]>` e a colisão custava 350 ms/frame com 400 móveis.
  // A causa é que `Map` NÃO é um hash neste runtime: é uma lista de associação
  // com varredura LINEAR. Medido em mapa de 1000 entradas, 100 mil `get` da
  // MESMA chave: 0,29 s se ela foi a primeira inserida, 25,35 s se foi a
  // última — 86x pela posição. Ou seja, o grid ficava QUADRÁTICO no número de
  // células ocupadas. Ver UrubuCode/rts#1998.
  // Lista encadeada: `gHead[célula]` é o primeiro item da célula e `gNext[k]` o
  // seguinte, -1 termina. Nenhum `set`, nenhuma alocação por frame.
  gHead: number[];   // bucket → primeiro item (-1 = célula vazia)
  gNext: number[];   // item k de cIdx → próximo na mesma célula (-1 = fim)
  gCell: number[];   // item k de cIdx → bucket em que foi inserido
  gUsed: number;     // quantos itens a última passada inseriu (para limpar)
  /// NÃO TENTE de novo (ambas medidas e revertidas): pular a REMONTAGEM do grid
  /// quando ninguém trocou de célula piora. Com um passe de verificação próprio,
  /// 2,16 s -> 2,71 s (o passe custa mais que a remontagem que evita). Derivando
  /// o sinal do próprio passe de resolução, o caso parado melhora (2,16 ->
  /// 1,79 s) mas os outros pioram muito (50/500 andando: 3,73 -> 3,77 s;
  /// 500/500: 12,3 -> 13,1 s), porque UM objeto que se mova já suja o grid
  /// inteiro. A remontagem é O(n) com constante baixa; não vale proteger.
  ///
  /// Última posição em que cada colisor foi RESOLVIDO. Um objeto que não saiu
  /// do lugar desde o frame passado já está separado de tudo — reconsultar as
  /// 9 células dele é trabalho jogado fora. Num RTS a maioria das unidades está
  /// parada a qualquer instante (esperando ordem, em formação, minerando), então
  /// isto tira a colisão do caminho quente em vez de só deixá-la mais barata.
  lastX: f64[]; lastY: f64[]; lastZ: f64[];
  done: number[];                    // flags de "já computado" do computeWorld
  /// 1 = a lista de colisores (`cIdx`) precisa ser reconstruída. A coleta
  /// varre a cena inteira lendo um campo por objeto, e num cenário de RTS a
  /// composição quase nunca muda entre frames — só quando alguém entra, sai,
  /// é reparenteado ou troca de mesh. Marcar sujo custa nada; revarrer custa
  /// ~1 ms com 500 objetos.
  colDirty: number;
  colMaxR: f64;      // maior raio entre os colisores (cacheado com cIdx)
  colMovers: number; // quantos colisores podem se mover (cacheado com cIdx)
  /// Array PARALELO a `objects` com os transforms. Chegar ao transform por
  /// `objects[i].transform` paga um acesso a campo (~2 µs) por objeto, todo
  /// frame; lê-lo de um array direto custa ~4x menos. Mantido em sincronia por
  /// `add`/`removeAt`/`moveSubtree` — as três únicas mutações da lista.
  trs: Transform[];

  constructor(name: string) {
    this.name = name;
    this.objects = [];
    this.cIdx = [];
    this.sIdx = [];
    this.bIdx = [];
    this.gHead = [];
    this.gNext = [];
    this.gCell = [];
    this.gUsed = 0;
    this.lastX = [];
    this.lastY = [];
    this.lastZ = [];
    this.done = [];
    this.trs = [];
    this.colDirty = 1;
    this.colMaxR = 0.0001;
    this.colMovers = 0;
  }

  add(go: GameObject): GameObject {
    go.refreshCollide();   // mantém o cache de colisão em dia (ver collideFlag)
    this.objects.push(go);
    this.trs.push(go.transform);   // espelho paralelo (ver `trs`)
    this.colDirty = 1;
    go.mount();
    return go;
  }

  update(dt: f64): void {
    updateAll(this.objects, dt);   // função livre tipada (ver computeWorldInto)
  }

  count(): number {
    return this.objects.length;
  }

  /// Esvazia a cena (pra carregar outra por cima).
  clear(): void {
    this.objects = [];
    this.trs = [];
    this.colDirty = 1;
  }

  /// Move a subárvore do objeto `dragIdx` (ele + descendentes) para antes do
  /// índice `beforeIdx`, com novo pai `newParentIdx` (-1 = raiz). Reordena o array
  /// e remapeia todos os índices de parent por REFERÊNCIA (estável). É o backend do
  /// drag-drop com slots de inserção do editor. No-op se criar ciclo.
  moveSubtree(dragIdx: number, beforeIdx: number, newParentIdx: number): void {
    const n = this.objects.length;
    if (dragIdx < 0 || dragIdx >= n) return;
    // flags: quem está na subárvore do arrastado (ele + descendentes)
    const inSub: number[] = [];
    let i = 0;
    while (i < n) {
      let a = i; let sub = 0; let g = 0;
      while (a >= 0 && g < 128) {
        if (a === dragIdx) { sub = 1; a = 0 - 1; } else { a = this.objects[a].parent; }
        g = g + 1;
      }
      inSub.push(sub);
      i = i + 1;
    }
    // ciclo: novo pai não pode estar na subárvore
    if (newParentIdx >= 0 && newParentIdx < n && inSub[newParentIdx] === 1) return;
    // ref do pai de cada objeto (sentinela = ele mesmo quando raiz)
    const pref: GameObject[] = [];
    const hasP: number[] = [];
    i = 0;
    while (i < n) {
      const o = this.objects[i];
      if (o.parent >= 0 && o.parent < n) { pref.push(this.objects[o.parent]); hasP.push(1); }
      else { pref.push(o); hasP.push(0); }
      i = i + 1;
    }
    const dragged = this.objects[dragIdx];
    let npRef = dragged; let npHas = 0;
    if (newParentIdx >= 0 && newParentIdx < n) { npRef = this.objects[newParentIdx]; npHas = 1; }
    // posição de inserção entre os NÃO-movendo
    let insertPos = 0;
    i = 0;
    while (i < beforeIdx && i < n) { if (inSub[i] === 0) insertPos = insertPos + 1; i = i + 1; }
    // monta nova ordem
    const order: GameObject[] = [];
    const opref: GameObject[] = [];
    const ohasP: number[] = [];
    let restCount = 0;
    let inserted = 0;
    let k = 0;
    while (k < n) {
      if (inserted === 0 && restCount === insertPos) {
        let b = 0;
        while (b < n) {
          if (inSub[b] === 1) {
            order.push(this.objects[b]);
            if (this.objects[b] === dragged) { opref.push(npRef); ohasP.push(npHas); }
            else { opref.push(pref[b]); ohasP.push(hasP[b]); }
          }
          b = b + 1;
        }
        inserted = 1;
      }
      if (inSub[k] === 0) {
        order.push(this.objects[k]); opref.push(pref[k]); ohasP.push(hasP[k]);
        restCount = restCount + 1;
      }
      k = k + 1;
    }
    if (inserted === 0) {
      let b = 0;
      while (b < n) {
        if (inSub[b] === 1) {
          order.push(this.objects[b]);
          if (this.objects[b] === dragged) { opref.push(npRef); ohasP.push(npHas); }
          else { opref.push(pref[b]); ohasP.push(hasP[b]); }
        }
        b = b + 1;
      }
    }
    // aplica + remapeia parent por referência
    this.objects = order;
    // o espelho de transforms segue a NOVA ordem (ver `trs`)
    this.trs.length = 0;
    let ti = 0;
    while (ti < order.length) { this.trs.push(order[ti].transform); ti = ti + 1; }
    this.colDirty = 1;
    let j = 0;
    while (j < order.length) {
      const o = order[j];
      if (ohasP[j] === 0) { o.parent = 0 - 1; o.refreshCollide(); }
      else {
        let pj = 0; let found = 0 - 1;
        while (pj < order.length) {
          if (order[pj] === opref[j]) { found = pj; pj = order.length; } else pj = pj + 1;
        }
        o.parent = found;
        o.refreshCollide();
      }
      j = j + 1;
    }
  }

  /// Remove o objeto no índice `i`, corrigindo os índices de parent dos demais
  /// (quem apontava pra i vira raiz; quem apontava depois de i decrementa).
  removeAt(i: number): void {
    const n = this.objects.length;
    if (i < 0 || i >= n) return;
    // Compacta IN-PLACE (antes alocava um array novo a cada remoção — num RTS,
    // destruir dezenas de unidades por segundo virava dezenas de realocações da
    // cena inteira). Um passe: corrige os parents e desloca os que vêm depois.
    let k = 0;
    let w = 0;
    while (k < n) {
      const o = this.objects[k];
      if (o.parent === i) { o.parent = 0 - 1; o.refreshCollide(); }   // filho do removido vira raiz
      else if (o.parent > i) o.parent = o.parent - 1; // índices acima deslocam (raiz-ness não muda)
      if (k !== i) { this.objects[w] = o; this.trs[w] = o.transform; w = w + 1; }
      k = k + 1;
    }
    this.objects.length = w;
    this.trs.length = w;
    this.colDirty = 1;
  }

  /// Índice do objeto ATIVO que carrega a câmera principal (-1 = nenhuma).
  /// O runtime do jogo renderiza por ela; se houver várias, vence a primeira
  /// marcada como `isMain`, senão a primeira câmera encontrada.
  mainCameraIdx(): number {
    let fallback = 0 - 1;
    let i = 0;
    while (i < this.objects.length) {
      const o = this.objects[i];
      if (o.active !== 0) {
        const ci = o.componentIdx(KIND_CAMERA);
        if (ci >= 0) {
          const c = o.behaviors[ci];
          if (c.enabled !== 0) {
            if (c.camIsMain() !== 0) return i;
            if (fallback < 0) fallback = i;
          }
        }
      }
      i = i + 1;
    }
    return fallback;
  }

  /// Computa a posição de MUNDO (wx,wy,wz) de cada objeto a partir do local
  /// (px,py,pz) e do pai: raiz → mundo = local; filho → mundo do pai + offset
  /// local ROTACIONADO pelo yaw (ry) do pai (o filho orbita quando o pai gira).
  /// Assume pai com índice MENOR que o filho (pais adicionados antes). Chame a
  /// cada frame antes do render.
  computeWorld(): void {
    // Buffer de flags REUTILIZADO (antes era um array novo por frame — GC no
    // caminho mais quente). Só cresce quando a cena cresce.
    const n = this.objects.length;
    while (this.done.length < n) this.done.push(0);
    // O CORPO vive numa FUNÇÃO LIVRE de parâmetros tipados. Dentro de um método
    // o compilador perde as provas de tipo dos locais, e cada `o.transform.px`
    // vira uma leitura DINÂMICA de propriedade. Medido com 500 objetos × 300
    // frames: 3,8 s como método contra 1,1 s como função livre — 3,3x, com a
    // lógica idêntica.
    computeWorldInto(this.objects, this.trs, this.done);
  }

  /// Colisão esfera-esfera entre objetos (raio = escala*0.5). Sobreposição:
  /// empurra o par pra fora (metade cada) e amortece a velocidade vertical no
  /// contato — assim corpos com Rigidbody empilham/espalham em vez de atravessar.
  /// Chame depois de update(dt). Passe posicional (simples e estável).
  ///
  /// BROAD-PHASE por GRID espacial (hash uniforme no plano XZ): antes era um
  /// duplo laço O(n²) — 200 objetos = 20.000 pares/frame, o que media ~1,1 s
  /// POR FRAME e limitava a cena a algumas dezenas de unidades. Agora cada
  /// objeto só é testado contra as 9 células vizinhas, o que é ~O(n) enquanto
  /// a densidade for razoável.
  resolveCollisions(): void {
    const n = this.objects.length;
    if (n < 2) return;

    // ── 1) coleta os candidatos (quem de fato colide) e o maior raio ──────────
    // Reaproveita os arrays entre frames: alocar 4 arrays por frame gerava
    // pressão de GC no laço mais quente do motor.
    // Só objetos RAIZ colidem: o passe é posicional e escreve em px/py/pz, que
    // num filho é offset RELATIVO ao pai — empurrar um filho comparando sua
    // coordenada local com a de outro objeto move a peça errada. (Antes isso
    // acontecia silenciosamente com qualquer hierarquia, e um modelo
    // multi-submesh solto na cena já cria uma.)
    const objs: GameObject[] = this.objects;   // hoisted + tipado (ver computeWorld)
    // A coleta roda TODO frame sobre a cena inteira, então vive numa função
    // livre tipada pelo mesmo motivo do computeWorld: dentro do método os
    // acessos a campo caem no caminho dinâmico.
    // Os "retornos" saem por vars de módulo em vez de um array novo por frame:
    // alocar no laço mais quente do motor gerava pressão de GC à toa.
    // Só revarre quando a COMPOSIÇÃO da cena mudou (add/remove/reparent/mesh).
    // Entre frames a lista é a mesma, e revarrer 500 objetos custava ~1 ms.
    if (this.colDirty !== 0) {
      this.cIdx.length = 0;
      this.sIdx.length = 0;
      this.bIdx.length = 0;
      collectColliders(objs, this.trs, this.cIdx, this.sIdx, this.bIdx);
      this.colMaxR = ccMaxR;
      this.colDirty = 0;
    }
    const maxR: f64 = this.colMaxR;
    const m = this.cIdx.length;
    // NADA dinâmico → nenhum par pode se resolver (estático × estático nunca
    // gera empurrão). É a saída que faz um cenário de RTS parado custar zero.
    if (m === 0 && this.bIdx.length === 0) return;

    // prepara buffers por-objeto
    const nAll = this.objects.length;
    while (this.lastX.length < nAll) { this.lastX.push(1e30); this.lastY.push(1e30); this.lastZ.push(1e30); }
    while (ctSwept.length < nAll) ctSwept.push(0);
    ctCount = 0;

    if (m >= 24) {
      // ── 2) monta o grid (só dinâmicos PEQUENOS; ver sIdx/bIdx) ────────────
      const cell: f64 = maxR * 2.0;
      const inv: f64 = 1.0 / cell;
      while (this.gHead.length < CGRID_CAP) this.gHead.push(0 - 1);
      while (this.gNext.length < m) { this.gNext.push(0 - 1); this.gCell.push(0); }
      let k = 0;
      while (k < this.gUsed) { this.gHead[this.gCell[k]] = 0 - 1; k = k + 1; }
      k = 0;
      while (k < m) {
        const oi = this.cIdx[k];
        const t = this.trs[oi];
        const gx = mfloor(t.px * inv);
        const gz = mfloor(t.pz * inv);
        const b = ((gx * 73856093 + gz * 19349663) & CGRID_MASK);
        this.gCell[k] = b;
        this.gNext[k] = this.gHead[b];
        this.gHead[b] = k;
        k = k + 1;
      }
      this.gUsed = m;
      // ── 3) COLETA os contatos (uma entrada por par) ───────────────────────
      collectContacts(this.objects, this.trs, this.cIdx, m,
                      this.gHead, this.gNext, this.lastX, this.lastY, this.lastZ,
                      inv, this.sIdx, this.bIdx);
    } else {
      collectRange(this.objects, this.trs, this.cIdx, m, this.sIdx, this.bIdx);
    }

    // ── 4) resolve: N iterações de VELOCIDADE + M de POSIÇÃO ────────────────
    if (ctCount > 0) {
      // buffers por PARÂMETRO anotado: lidos como gcell de módulo, cada acesso
      // no laço de iteração caía no caminho dinâmico (medido: 3x mais lento)
      solveVelocity(this.trs, ctA, ctB, ctNX, ctNY, ctNZ, ctIMA, ctIMB,
                    ctE, ctVN0, ctJN, ctMU, ctCount);
      solvePosition(this.trs, ctA, ctB, ctNX, ctNY, ctNZ, ctOV, ctD0,
                    ctIMA, ctIMB, ctCount);
      warmStore(ctA, ctB, ctJN, ctCount);
    }
    // ── 5) sono (critério de velocidade pós-solve) ──────────────────────────
    sleepPass(this.trs, this.cIdx, m, this.bIdx);
  }
}

// ═══ SOLVER DE IMPULSO SEQUENCIAL ════════════════════════════════════════════
// O solver antigo resolvia cada par NA HORA (posição+impulso de uma vez), e
// pilhas densas só convergiam graças à repetição acidental do par (A varre B e
// B varre A — medido: remover a repetição piorava 8,9 s para 13,2 s). Este é o
// desenho que as engines usam: coletar contatos UMA vez, iterar velocidade
// sobre a lista com IMPULSO ACUMULADO (clamp em zero no acumulado), e corrigir
// posição em passes próprios recomputando a penetração ao longo da normal.
//
// Buffers de MÓDULO (não campos da Scene): as funções livres os alcançam sem
// listas de 20 parâmetros. Prefixo ct — nomes de topo colidem entre módulos.
let ctA: number[] = [];
let ctB: number[] = [];
let ctNX: f64[] = []; let ctNY: f64[] = []; let ctNZ: f64[] = [];
let ctOV: f64[] = [];    // penetração na coleta
let ctD0: f64[] = [];    // (pB-pA)·n na coleta — p/ recomputar penetração barato
let ctIMA: f64[] = []; let ctIMB: f64[] = [];
let ctE: f64[] = [];     // restituição do par (0 se contato lento)
let ctMU: f64[] = [];
let ctVN0: f64[] = [];   // velocidade normal de aproximação na coleta
let ctJN: f64[] = [];    // impulso normal acumulado
let ctCount = 0;
let ctSwept: number[] = [];
// ── WARM START ──────────────────────────────────────────────────────────────
// Cache do impulso normal ACUMULADO por PAR, entre frames. Sem ele, as fileiras
// de baixo de uma pilha nunca convergiam: 8 iterações partindo de zero não
// cancelam o peso da coluna inteira, e o residual (~0.29) impedia o sono.
// Semear com o impulso do frame anterior (pré-aplicado às velocidades) é o que
// faz pilhas ficarem rígidas com poucas iterações — o padrão de toda engine.
// Hash aberto simples: colisão de bucket só perde o warm start daquele par.
let wsPair: f64[] = [];
let wsJN: f64[] = [];
const WS_MASK = 65535;

/// Iterações. Velocidade converge rápido com acumulação; posição usa a folga.
const CT_VEL_ITERS = 8;
const CT_POS_ITERS = 2;

/// Registra um contato entre `ia` e `ib` se houver sobreposição. Toda a
/// geometria (caixa vs caixa, caixa vs esfera, esfera vs esfera) vive aqui.
function collectPair(objs: GameObject[], trs: Transform[], ia: number, ib: number): void {
  const a: GameObject = objs[ia];
  const b: GameObject = objs[ib];
  if (a.stationary !== 0 && b.stationary !== 0) return;
  const ta: Transform = trs[ia];
  const tb: Transform = trs[ib];

  let nx: f64 = 0.0; let ny: f64 = 0.0; let nz: f64 = 0.0;
  let overlap: f64 = 0.0;
  const boxA = a.colShape === COL_BOX ? 1 : 0;
  const boxB = b.colShape === COL_BOX ? 1 : 0;

  if (boxA !== 0 && boxB !== 0) {
    const ex = (ta.sx + tb.sx) * 0.5;
    const dx = tb.px - ta.px;
    const ox = ex - (dx < 0.0 ? 0.0 - dx : dx);
    if (ox <= 0.0) return;
    const ey = (ta.sy + tb.sy) * 0.5;
    const dy = tb.py - ta.py;
    const oy = ey - (dy < 0.0 ? 0.0 - dy : dy);
    if (oy <= 0.0) return;
    const ez = (ta.sz + tb.sz) * 0.5;
    const dz = tb.pz - ta.pz;
    const oz = ez - (dz < 0.0 ? 0.0 - dz : dz);
    if (oz <= 0.0) return;
    if (oy <= ox && oy <= oz) { overlap = oy; ny = dy < 0.0 ? 0.0 - 1.0 : 1.0; }
    else if (ox <= oz) { overlap = ox; nx = dx < 0.0 ? 0.0 - 1.0 : 1.0; }
    else { overlap = oz; nz = dz < 0.0 ? 0.0 - 1.0 : 1.0; }
  } else if (boxA !== 0 || boxB !== 0) {
    const bt: Transform = boxA !== 0 ? ta : tb;
    const st: Transform = boxA !== 0 ? tb : ta;
    const sgn: f64 = boxA !== 0 ? 1.0 : 0.0 - 1.0;
    const r: f64 = radiusOf(st);
    const hx = bt.sx * 0.5; const hy = bt.sy * 0.5; const hz = bt.sz * 0.5;
    let qx = st.px - bt.px; if (qx > hx) qx = hx; if (qx < 0.0 - hx) qx = 0.0 - hx;
    let qy = st.py - bt.py; if (qy > hy) qy = hy; if (qy < 0.0 - hy) qy = 0.0 - hy;
    let qz = st.pz - bt.pz; if (qz > hz) qz = hz; if (qz < 0.0 - hz) qz = 0.0 - hz;
    const vx = st.px - (bt.px + qx);
    const vy = st.py - (bt.py + qy);
    const vz = st.pz - (bt.pz + qz);
    const d2 = vx * vx + vy * vy + vz * vz;
    if (d2 >= r * r) return;
    if (d2 > 0.000001) {
      const d = math.sqrt(d2);
      overlap = r - d;
      nx = (vx / d) * sgn; ny = (vy / d) * sgn; nz = (vz / d) * sgn;
    } else {
      const gx = hx - (qx < 0.0 ? 0.0 - qx : qx);
      const gy = hy - (qy < 0.0 ? 0.0 - qy : qy);
      const gz = hz - (qz < 0.0 ? 0.0 - qz : qz);
      if (gy <= gx && gy <= gz) { overlap = gy + r; ny = (qy < 0.0 ? 0.0 - 1.0 : 1.0) * sgn; }
      else if (gx <= gz) { overlap = gx + r; nx = (qx < 0.0 ? 0.0 - 1.0 : 1.0) * sgn; }
      else { overlap = gz + r; nz = (qz < 0.0 ? 0.0 - 1.0 : 1.0) * sgn; }
    }
  } else {
    const ra: f64 = radiusOf(ta);
    const rb: f64 = radiusOf(tb);
    const rs: f64 = ra + rb;
    const dx: f64 = tb.px - ta.px;
    if (dx > rs || dx < 0.0 - rs) return;
    const dz: f64 = tb.pz - ta.pz;
    if (dz > rs || dz < 0.0 - rs) return;
    const dy: f64 = tb.py - ta.py;
    if (dy > rs || dy < 0.0 - rs) return;
    const d2: f64 = dx * dx + dy * dy + dz * dz;
    if (d2 >= rs * rs) return;
    if (d2 <= 0.000001) {
      // sobreposição exata: separa por convenção determinística
      nx = ia < ib ? 1.0 : 0.0 - 1.0; ny = 0.0; nz = 0.0;
      overlap = rs;
    } else {
      const d = math.sqrt(d2);
      nx = dx / d; ny = dy / d; nz = dz / d;
      overlap = rs - d;
    }
  }

  const imA: f64 = a.stationary !== 0 || ta.mass <= 0.0 ? 0.0 : 1.0 / ta.mass;
  const imB: f64 = b.stationary !== 0 || tb.mass <= 0.0 ? 0.0 : 1.0 / tb.mass;
  if (imA + imB <= 0.0) return;

  const vn0: f64 = (tb.vx - ta.vx) * nx + (tb.vy - ta.vy) * ny + (tb.vz - ta.vz) * nz;
  // ACORDA num contato de verdade: RÁPIDO (vn) ou intrusão FUNDA. O limiar de
  // profundidade fica ACIMA da penetração de equilíbrio de uma pilha (slop
  // 0.04 + fluência sob pressão ≈ 0.06-0.08): com 0.06 aqui, o próprio contato
  // de repouso das fileiras de baixo re-acordava os blocos a cada coleta e o
  // sono nunca fechava — eram os 20 insones da demolição.
  if (vn0 < 0.0 - 0.8 || overlap > 0.15) {
    ta.asleep = 0; ta.quiet = 0;
    tb.asleep = 0; tb.quiet = 0;
  }
  // restituição: média do par, CORTADA em contato lento (o anti-chacoalho)
  let e: f64 = (ta.restitution + tb.restitution) * 0.5;
  if (vn0 > 0.0 - 1.0) e = 0.0;

  const c = ctCount;
  while (ctA.length <= c) {
    ctA.push(0); ctB.push(0);
    ctNX.push(0.0); ctNY.push(0.0); ctNZ.push(0.0);
    ctOV.push(0.0); ctD0.push(0.0);
    ctIMA.push(0.0); ctIMB.push(0.0);
    ctE.push(0.0); ctMU.push(0.0); ctVN0.push(0.0);
    ctJN.push(0.0);
  }
  ctA[c] = ia; ctB[c] = ib;
  ctNX[c] = nx; ctNY[c] = ny; ctNZ[c] = nz;
  ctOV[c] = overlap;
  ctD0[c] = (tb.px - ta.px) * nx + (tb.py - ta.py) * ny + (tb.pz - ta.pz) * nz;
  ctIMA[c] = imA; ctIMB[c] = imB;
  ctE[c] = e;
  ctMU[c] = math.sqrt(ta.friction * tb.friction);
  ctVN0[c] = vn0;
  // WARM START: se este PAR tinha contato no frame passado, parte do impulso
  // acumulado dele (pré-aplicado às velocidades). É o que segura o peso de uma
  // coluna sem precisar de dezenas de iterações.
  while (wsPair.length <= WS_MASK) { wsPair.push(0.0 - 1.0); wsJN.push(0.0); }
  const pairId: f64 = ia < ib ? ia * 131072.0 + ib : ib * 131072.0 + ia;
  let h = ((ia < ib ? ia * 92821 + ib : ib * 92821 + ia)) & WS_MASK;
  let jw: f64 = 0.0;
  if (wsPair[h] === pairId) jw = wsJN[h];
  else {
    // sondagem dupla: uma colisão de bucket fazia o par perder o warm start em
    // frames alternados — o pico residual resetava o sono das fileiras de baixo
    const h2 = (h + 1) & WS_MASK;
    if (wsPair[h2] === pairId) { jw = wsJN[h2]; h = h2; }
  }
  // AMORTECIDO (0.9) e só em contato CARREGADO (overlap além do slop): o warm
  // start integral pré-aplicado em contato raso dava overshoot — torres com
  // vãos de 0.05 LANÇAVAM blocos para cima (medido: vy=+2.98 a y=14) enquanto
  // o muro mais folgado assentava bem.
  jw = jw * 0.9;
  if (overlap < 0.04) jw = 0.0;
  if (jw > 0.0) {
    ta.vx = ta.vx - nx * jw * imA;
    ta.vy = ta.vy - ny * jw * imA;
    ta.vz = ta.vz - nz * jw * imA;
    tb.vx = tb.vx + nx * jw * imB;
    tb.vy = tb.vy + ny * jw * imB;
    tb.vz = tb.vz + nz * jw * imB;
  }
  ctJN[c] = jw;
  ctCount = c + 1;
}

/// Grava o impulso acumulado de cada contato no cache de warm start.
function warmStore(cA: number[], cB: number[], cJN: f64[], n: number): void {
  let c = 0;
  while (c < n) {
    const ia = cA[c];
    const ib = cB[c];
    const pairId: f64 = ia < ib ? ia * 131072.0 + ib : ib * 131072.0 + ia;
    let h = ((ia < ib ? ia * 92821 + ib : ib * 92821 + ia)) & WS_MASK;
    // não despeja outro par vivo se o slot vizinho estiver livre/for meu
    if (wsPair[h] !== pairId && wsPair[h] >= 0.0) {
      const h2 = (h + 1) & WS_MASK;
      if (wsPair[h2] === pairId || wsPair[h2] < 0.0) h = h2;
    }
    wsPair[h] = pairId;
    wsJN[h] = cJN[c];
    c = c + 1;
  }
}

/// Varre a vizinhança e COLETA contatos (a estrutura do antigo resolveInto,
/// com a reatividade e o despertar por partida preservados).
function collectContacts(objs: GameObject[], trs: Transform[], cIdx: number[], m: number,
                         gHead: number[], gNext: number[],
                         lastX: f64[], lastY: f64[], lastZ: f64[], inv: f64,
                         sIdx: number[], bIdx: number[]): void {
  const ns = sIdx.length;
  const nb = bIdx.length;
  let cw = 0;
  while (cw < m) { ctSwept[cIdx[cw]] = 0; cw = cw + 1; }
  cw = 0;
  while (cw < nb) { ctSwept[bIdx[cw]] = 0; cw = cw + 1; }

  let k = 0;
  while (k < m) {
    const oi = cIdx[k];
    const ob: GameObject = objs[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = trs[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lastX[oi];
    const dym = py - lastY[oi];
    const dzm = pz - lastZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < MOVE_EPS2) { k = k + 1; continue; }
    lastX[oi] = px; lastY[oi] = py; lastZ[oi] = pz;
    let bigMove = 0;
    if (moved2 > 0.0004) bigMove = 1;
    const gx = mfloor(px * inv);
    const gz = mfloor(pz * inv);
    let dz = 0 - 1;
    while (dz <= 1) {
      let dx = 0 - 1;
      while (dx <= 1) {
        const b = (((gx + dx) * 73856093 + (gz + dz) * 19349663) & CGRID_MASK);
        let q = gHead[b];
        while (q >= 0) {
          const other = cIdx[q];
          if (other !== oi) {
            if (bigMove !== 0) {
              const to: Transform = trs[other];
              if (to.asleep !== 0) { to.asleep = 0; to.quiet = 0; }
            }
            // DEDUPE: se `other` já varreu, o par já foi coletado do lado dele.
            // (No solver imediato a dedupe PIORAVA — a repetição era iteração
            // grátis. Aqui as iterações são explícitas, e cada par deve entrar
            // UMA vez na lista.)
            if (ctSwept[other] === 0) collectPair(objs, trs, oi, other);
          }
          q = gNext[q];
        }
        dx = dx + 1;
      }
      dz = dz + 1;
    }
    let sq = 0;
    while (sq < ns) { collectPair(objs, trs, oi, sIdx[sq]); sq = sq + 1; }
    sq = 0;
    while (sq < nb) {
      if (ctSwept[bIdx[sq]] === 0) collectPair(objs, trs, oi, bIdx[sq]);
      sq = sq + 1;
    }
    ctSwept[oi] = 1;
    k = k + 1;
  }

  // GRANDES como movers
  let bi = 0;
  while (bi < nb) {
    const oi = bIdx[bi];
    const ob: GameObject = objs[oi];
    if (ob.stationary !== 0) { bi = bi + 1; continue; }
    const t: Transform = trs[oi];
    const dxm = t.px - lastX[oi];
    const dym = t.py - lastY[oi];
    const dzm = t.pz - lastZ[oi];
    if (dxm * dxm + dym * dym + dzm * dzm < MOVE_EPS2) { bi = bi + 1; continue; }
    lastX[oi] = t.px; lastY[oi] = t.py; lastZ[oi] = t.pz;
    let q = 0;
    while (q < m) {
      if (ctSwept[cIdx[q]] === 0) collectPair(objs, trs, oi, cIdx[q]);
      q = q + 1;
    }
    q = 0;
    while (q < nb) {
      const oth = bIdx[q];
      if (oth !== oi && ctSwept[oth] === 0) collectPair(objs, trs, oi, oth);
      q = q + 1;
    }
    q = 0;
    while (q < ns) { collectPair(objs, trs, oi, sIdx[q]); q = q + 1; }
    ctSwept[oi] = 1;
    bi = bi + 1;
  }
}

/// Caminho de POUCOS dinâmicos: coleta todos os pares, sem grid.
function collectRange(objs: GameObject[], trs: Transform[], cIdx: number[], m: number,
                      sIdx: number[], bIdx: number[]): void {
  const ns = sIdx.length;
  const nb = bIdx.length;
  let i = 0;
  while (i < m) {
    let j = i + 1;
    while (j < m) { collectPair(objs, trs, cIdx[i], cIdx[j]); j = j + 1; }
    let q = 0;
    while (q < ns) { collectPair(objs, trs, cIdx[i], sIdx[q]); q = q + 1; }
    q = 0;
    while (q < nb) { collectPair(objs, trs, cIdx[i], bIdx[q]); q = q + 1; }
    i = i + 1;
  }
  i = 0;
  while (i < nb) {
    let j = i + 1;
    while (j < nb) { collectPair(objs, trs, bIdx[i], bIdx[j]); j = j + 1; }
    let q = 0;
    while (q < ns) { collectPair(objs, trs, bIdx[i], sIdx[q]); q = q + 1; }
    i = i + 1;
  }
}

/// Iterações de VELOCIDADE: impulso normal ACUMULADO com clamp em zero (o clamp
/// no acumulado — não no incremento — permite uma iteração DESFAZER excesso da
/// anterior sem grudar os corpos; é o coração do impulso sequencial). Atrito só
/// na última iteração, limitado por Coulomb sobre o impulso normal acumulado.
function solveVelocity(trs: Transform[], cA: number[], cB: number[],
                       cNX: f64[], cNY: f64[], cNZ: f64[],
                       cIMA: f64[], cIMB: f64[], cE: f64[], cVN0: f64[],
                       cJN: f64[], cMU: f64[], n: number): void {
  let it = 0;
  while (it < CT_VEL_ITERS) {
    const last = it === CT_VEL_ITERS - 1 ? 1 : 0;
    let c = 0;
    while (c < n) {
      const ta: Transform = trs[cA[c]];
      const tb: Transform = trs[cB[c]];
      const nx = cNX[c]; const ny = cNY[c]; const nz = cNZ[c];
      const imA = cIMA[c]; const imB = cIMB[c];
      const imSum = imA + imB;
      const rvx = tb.vx - ta.vx;
      const rvy = tb.vy - ta.vy;
      const rvz = tb.vz - ta.vz;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      // alvo: anular a aproximação (e devolver e·vn0 se o contato foi rápido)
      const target: f64 = cE[c] > 0.0 ? (0.0 - cE[c]) * cVN0[c] : 0.0;
      let j: f64 = (target - vn) / imSum;
      const acc = cJN[c];
      let newAcc = acc + j;
      if (newAcc < 0.0) newAcc = 0.0;
      j = newAcc - acc;
      cJN[c] = newAcc;
      if (j !== 0.0) {
        ta.vx = ta.vx - nx * j * imA;
        ta.vy = ta.vy - ny * j * imA;
        ta.vz = ta.vz - nz * j * imA;
        tb.vx = tb.vx + nx * j * imB;
        tb.vy = tb.vy + ny * j * imB;
        tb.vz = tb.vz + nz * j * imB;
      }
      if (last !== 0) {
        const mu = cMU[c];
        if (mu > 0.0 && cJN[c] > 0.0) {
          const r2x = tb.vx - ta.vx;
          const r2y = tb.vy - ta.vy;
          const r2z = tb.vz - ta.vz;
          const vn2 = r2x * nx + r2y * ny + r2z * nz;
          const tvx = r2x - nx * vn2;
          const tvy = r2y - ny * vn2;
          const tvz = r2z - nz * vn2;
          const tl2 = tvx * tvx + tvy * tvy + tvz * tvz;
          if (tl2 > 0.000001) {
            const tl = math.sqrt(tl2);
            let jt: f64 = tl / imSum;
            const cap: f64 = mu * cJN[c];
            if (jt > cap) jt = cap;
            const ux = tvx / tl; const uy = tvy / tl; const uz = tvz / tl;
            ta.vx = ta.vx + ux * jt * imA;
            ta.vy = ta.vy + uy * jt * imA;
            ta.vz = ta.vz + uz * jt * imA;
            tb.vx = tb.vx - ux * jt * imB;
            tb.vy = tb.vy - uy * jt * imB;
            tb.vz = tb.vz - uz * jt * imB;
          }
        }
      }
      c = c + 1;
    }
    it = it + 1;
  }
}

/// Iterações de POSIÇÃO: recomputa a penetração ao longo da normal ORIGINAL
/// pelo deslocamento do par desde a coleta — um dot product, barato. Aplica a
/// FOLGA (slop 0.04) e corrige 85%, repartido pelo inverso da massa.
function solvePosition(trs: Transform[], cA: number[], cB: number[],
                       cNX: f64[], cNY: f64[], cNZ: f64[],
                       cOV: f64[], cD0: f64[],
                       cIMA: f64[], cIMB: f64[], n: number): void {
  let it = 0;
  while (it < CT_POS_ITERS) {
    let c = 0;
    while (c < n) {
      const ta: Transform = trs[cA[c]];
      const tb: Transform = trs[cB[c]];
      const nx = cNX[c]; const ny = cNY[c]; const nz = cNZ[c];
      const dNow = (tb.px - ta.px) * nx + (tb.py - ta.py) * ny + (tb.pz - ta.pz) * nz;
      const pen = cOV[c] - (dNow - cD0[c]);
      if (pen > 0.04) {
        const imA = cIMA[c]; const imB = cIMB[c];
        const imSum = imA + imB;
        const corr = (pen - 0.04) * 0.85;
        const shA = corr * (imA / imSum);
        const shB = corr * (imB / imSum);
        ta.px = ta.px - nx * shA;
        ta.py = ta.py - ny * shA;
        ta.pz = ta.pz - nz * shA;
        tb.px = tb.px + nx * shB;
        tb.py = tb.py + ny * shB;
        tb.pz = tb.pz + nz * shB;
      }
      c = c + 1;
    }
    it = it + 1;
  }
}

/// Sono por VELOCIDADE pós-solve (mesmo critério do solver anterior).
function sleepPass(trs: Transform[], cIdx: number[], m: number, bIdx: number[]): void {
  let k = 0;
  while (k < m) {
    const t: Transform = trs[cIdx[k]];
    if (t.asleep === 0) {
      const sp2 = t.vx * t.vx + t.vy * t.vy + t.vz * t.vz;
      if (sp2 < SLEEP_SPEED2R) {
        t.quiet = t.quiet + 1;
        if (t.quiet >= SLEEP_FRAMES) { t.asleep = 1; t.quiet = 0; }
      } else {
        t.quiet = 0;
      }
    }
    k = k + 1;
  }
  k = 0;
  while (k < bIdx.length) {
    const t: Transform = trs[bIdx[k]];
    if (t.asleep === 0) {
      const sp2 = t.vx * t.vx + t.vy * t.vy + t.vz * t.vz;
      if (sp2 < SLEEP_SPEED2R) {
        t.quiet = t.quiet + 1;
        if (t.quiet >= SLEEP_FRAMES) { t.asleep = 1; t.quiet = 0; }
      } else {
        t.quiet = 0;
      }
    }
    k = k + 1;
  }
}

/// Raio da esfera de colisão de um transform: METADE DA MENOR escala.
///
/// A colisão é esfera-esfera, mas os objetos são caixas. Usar só `sx` fazia um
/// chão de 60×0.4×60 virar uma esfera de RAIO 30 — ele engolia a cena inteira,
/// empurrava tudo para cima e, de quebra, dimensionava a célula do grid em 60
/// unidades (todos os objetos numa célula só, matando o broad-phase).
///
/// A menor escala é a aproximação conservadora: a esfera cabe DENTRO da caixa,
/// então nunca há empurrão fantasma. Um objeto achatado colide como um disco
/// fino — imperfeito para um chão, mas correto no sentido de não inventar
/// contato onde não há. (Colisor de CAIXA é a evolução natural daqui.)
function radiusOf(t: Transform): f64 {
  let m: f64 = t.sx;
  if (t.sy < m) m = t.sy;
  if (t.sz < m) m = t.sz;
  return m * 0.5;
}

// floor pra inteiro que funciona com negativos (o `|0` trunca em direção a zero,
// o que faria as células -0.5 e +0.5 caírem na mesma faixa).
/// Tamanho da tabela do hash espacial da colisão (potência de 2: o AND é
/// barato). Nome com prefixo CGRID porque um `const` de topo COLIDE em silêncio
/// entre módulos neste runtime — já nos custou um bug caro.
/// Movimento mínimo (ao quadrado) para um objeto reconsultar a vizinhança.
/// Bem abaixo de um passo de unidade, mas acima do jitter de ponto flutuante.
const MOVE_EPS2: f64 = 0.000001;
/// Sleeping: velocidade (ao quadrado) abaixo da qual o corpo conta como quieto
/// (0.3 u/s), quantos frames quietos até dormir, e de quantos em quantos frames
/// um adormecido REVALIDA o apoio (ver o pós-passe em `resolveInto`).
const SLEEP_SPEED2R: f64 = 0.09;
const SLEEP_FRAMES = 10;
/// Raio acima do qual um dinâmico sai do grid para a lista `bIdx`.
const BIG_R: f64 = 1.0;
const CGRID_CAP = 8192;
const CGRID_MASK = 8191;

function mfloor(v: f64): number {
  const t = v | 0;
  if (v < 0.0 && (t * 1.0) !== v) return t - 1;
  return t;
}

/// Corpo do `Scene.computeWorld` como FUNÇÃO LIVRE de parâmetros TIPADOS.
///
/// Por que fora da classe: dentro de um método os locais perdem as provas de
/// tipo e `o.transform.px` cai no caminho dinâmico de propriedade. Com os
/// parâmetros anotados o compilador conhece o shape e lê cada campo por offset
/// constante. Mesma lógica, 3,3x mais rápido (500 objetos × 300 frames:
/// 3,8 s → 1,1 s).
function computeWorldInto(objs: GameObject[], trs: Transform[], done: number[]): void {
  const n = objs.length;
  let k = 0;
  while (k < n) { done[k] = 0; k = k + 1; }

  // FAST PATH: a esmagadora maioria dos objetos é RAIZ (parent < 0) e a cena
  // costuma estar em ordem pai→filho, então uma passada resolve tudo. Só o que
  // sobrar (pai com índice maior, reparent recente) cai no laço geral abaixo.
  // Uma raiz cujo transform local não mudou já tem a pose de mundo correta
  // (mundo = local), então reescrevê-la seria trabalho jogado fora.
  let left = 0;
  let i = 0;
  while (i < n) {
    const o = objs[i];
    const t: Transform = trs[i];   // espelho paralelo: evita o hop `o.transform`
    const par = o.parent;
    if (par < 0 || par >= n) {
      if (t.wx !== t.px || t.wy !== t.py || t.wz !== t.pz || t.wrx !== t.rx || t.wry !== t.ry) {
        t.wx = t.px; t.wy = t.py; t.wz = t.pz;
        t.wrx = t.rx; t.wry = t.ry;
      }
      done[i] = 1;
    } else if (done[par] === 1) {
      applyParentTo(o, objs[par]);
      done[i] = 1;
    } else {
      left = 1;
    }
    i = i + 1;
  }
  if (left === 0) return;   // caso comum: acabou numa passada

  // Passadas extras só para os pendentes (hierarquia fora de ordem).
  let pass = 0;
  while (pass <= n) {
    left = 0;
    i = 0;
    while (i < n) {
      if (done[i] === 0) {
        const o = objs[i];
        if (done[o.parent] === 1) { applyParentTo(o, objs[o.parent]); done[i] = 1; }
        else left = 1;
      }
      i = i + 1;
    }
    if (left === 0) return;
    pass = pass + 1;
  }
}

/// Preenche `out` com os índices dos objetos COLIDÍVEIS (mesh + raiz) e devolve
/// `[maiorRaio, quantosSeMovem]`. Função livre de parâmetros tipados pelo mesmo
/// motivo de `computeWorldInto` — roda todo frame sobre a cena inteira.
/// Roda o `update` de cada objeto ativo. Função livre de parâmetros tipados
/// pelo mesmo motivo de `computeWorldInto`.
/// Roda os scripts de todos os objetos ativos.
///
/// Itera os `behaviors` AQUI em vez de chamar `o.update(dt)`: aquele era um
/// nível extra de despacho por objeto, por frame, e o corpo dele é justamente
/// este laço. Medido com 500 objetos de 1 script: o trabalho real do script
/// custa 0,16 s e o despacho custava 2,14 s — 93% era overhead.
/// `b.update(dt)` continua virtual, e tem de ser: é o ponto de extensão do
/// motor (cada script tem o seu). O que sai é o nível REDUNDANTE acima dele.
function updateAll(objs: GameObject[], dt: f64): void {
  const n = objs.length;
  let i = 0;
  while (i < n) {
    const o: GameObject = objs[i];
    if (o.active !== 0) {
      const bs: Behavior[] = o.behaviors;
      const nb = bs.length;
      // a maioria dos objetos de cena não tem script: sai antes de tudo
      if (nb !== 0) {
        let j = 0;
        while (j < nb) {
          const b: Behavior = bs[j];
          if (b.enabled !== 0) b.update(dt);
          j = j + 1;
        }
      }
    }
    i = i + 1;
  }
}

// Saídas de `collectColliders` (evita alocar um array de retorno por frame).
let ccMaxR: f64 = 0.0001;

function collectColliders(objs: GameObject[], trs: Transform[], out: number[],
                          outStatic: number[], outBig: number[]): void {
  const n = objs.length;
  let maxR: f64 = 0.0001;
  let i = 0;
  while (i < n) {
    const o = objs[i];
    // `collideFlag` combina as três condições (mesh, customMesh, raiz) num só
    // campo: cada acesso a campo custa ~2 µs, e ler três por objeto sobre a
    // cena inteira, todo frame, era metade do custo da física.
    if (o.collideFlag !== 0) {
      // ESTÁTICO sai do grid, para a lista direta (ver `sIdx`): um chão de 90
      // de largura dimensionava a célula em 180 e punha a cena inteira num
      // único bucket — colisão O(n²), fortaleza de 392 blocos a ~6 fps.
      if (o.stationary !== 0) {
        outStatic.push(i);
        i = i + 1;
        continue;
      }
      out.push(i);
      const t: Transform = trs[i];   // espelho paralelo (ver `trs`)
      // O grid dimensiona a célula por ESTE raio (só dos DINÂMICOS agora), e
      // ele tem de cobrir o volume real do colisor. Para uma CAIXA isso é a
      // maior meia-extensão em X/Z (o grid é 2D em XZ), não `radiusOf` — que
      // devolve a metade da MENOR escala e faria uma laje achatada reportar um
      // raio minúsculo, com célula pequena demais para achá-la na vizinhança.
      let r: f64 = radiusOf(t);
      if (o.colShape === COL_BOX) {
        r = t.sx * 0.5;
        const hz = t.sz * 0.5;
        if (hz > r) r = hz;
      }
      // GRANDE sai do grid (ver `bIdx`): ele dimensionaria a célula para todos
      if (r > BIG_R) {
        out.length = out.length - 1;   // desfaz o push: vai para a outra lista
        outBig.push(i);
      } else if (r > maxR) {
        maxR = r;
      }
    }
    i = i + 1;
  }
  ccMaxR = maxR;
}

/// Compõe o transform de mundo do filho a partir do pai (offset local
/// rotacionado pelo YAW do pai). Só chama cos/sin quando o pai está de fato
/// rotacionado — yaw 0 é o caso dominante e virava 2 chamadas trigonométricas
/// por objeto. Função livre pelo mesmo motivo de `computeWorldInto`.
function applyParentTo(o: GameObject, p: GameObject): void {
  const t: Transform = o.transform;
  const pt: Transform = p.transform;
  const pyaw: f64 = pt.wry;
  if (pyaw === 0.0) {
    t.wx = pt.wx + t.px;
    t.wy = pt.wy + t.py;
    t.wz = pt.wz + t.pz;
  } else {
    const c: f64 = math.cos(pyaw);
    const sn: f64 = math.sin(pyaw);
    const lx: f64 = t.px;
    const lz: f64 = t.pz;
    t.wx = pt.wx + (lx * c + lz * sn);
    t.wy = pt.wy + t.py;
    t.wz = pt.wz + (0.0 - lx * sn + lz * c);
  }
  t.wrx = pt.wrx + t.rx;
  t.wry = pt.wry + t.ry;
}
