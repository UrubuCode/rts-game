// Engine RTS — Scene: a lista de GameObjects + o laço de update polimórfico.
// O render pass roda separado (main.ts) lendo os objetos desta cena.

import { GameObject, COL_BOX } from "./gameobject";
import { Transform } from "./transform";
import { Behavior, KIND_CAMERA } from "./behavior";
import { shapeOf, halfLocalX, halfLocalY, halfLocalZ } from "./collider";
import math from "../../compat/math.ts";

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

    // Poucos dinâmicos: laço direto (todos × todos + grandes + estáticos).
    if (m < 24) { collideRangeInto(this.objects, this.trs, this.cIdx, m, this.sIdx, this.bIdx); return; }

    // ── 2) monta o grid ──────────────────────────────────────────────────────
    // Célula = 2× o maior raio: assim dois objetos que se tocam NUNCA estão a
    // mais de uma célula de distância, e checar os 9 vizinhos basta.
    const cell: f64 = maxR * 2.0;
    const inv: f64 = 1.0 / cell;
    while (this.gHead.length < CGRID_CAP) this.gHead.push(0 - 1);
    while (this.gNext.length < m) { this.gNext.push(0 - 1); this.gCell.push(0); }
    // 1e30 = "nunca resolvido": força a primeira passada a olhar todo mundo
    while (this.lastX.length < this.objects.length) { this.lastX.push(1e30); this.lastY.push(1e30); this.lastZ.push(1e30); }
    // a REMONTAGEM vive numa função livre tipada: dentro do método, os acessos
    // a campo do laço caíam no caminho dinâmico — 5,8 ms POR FRAME com a cena
    // inteira dormindo (o custo fixo que impedia os 60 fps no repouso)
    buildSceneGrid(this.trs, this.cIdx, m, this.gHead, this.gNext, this.gCell, this.gUsed, inv);
    this.gUsed = m;

    // ── 3) resolve ───────────────────────────────────────────────────────────
    // O CORPO vive numa FUNÇÃO LIVRE de parâmetros tipados, pelo mesmo motivo
    // do `computeWorld` (ver `computeWorldInto`): dentro de um método os locais
    // perdem as provas de tipo e cada `this.objects[i].transform.px` cai no
    // caminho dinâmico de propriedade. Este é o laço mais quente do motor.
    resolveInto(this.objects, this.trs, this.cIdx, m,
                this.gHead, this.gNext, this.lastX, this.lastY, this.lastZ, inv,
                this.sIdx, this.bIdx, 1);
    // SEGUNDA iteração, SEM a reatividade: uma pilha alta empurra o bloco de
    // baixo para dentro do chão mais do que UMA resolução devolve — o de baixo
    // afundava 0.34 em regime e, espremido o bastante, era CUSPIDO pelo fundo
    // (medido: bloco a y=-6 com vy=-10). A segunda passada redistribui as
    // correções de baixo para cima. Corpos dormindo continuam fora.
    resolveInto(this.objects, this.trs, this.cIdx, m,
                this.gHead, this.gNext, this.lastX, this.lastY, this.lastZ, inv,
                this.sIdx, this.bIdx, 0);
  }

}

/// Passe de resolução da colisão como FUNÇÃO LIVRE de parâmetros TIPADOS —
/// mesmo motivo do `computeWorldInto`: dentro de um método `this.objects[i]`
/// e `.transform.px` caem no caminho dinâmico de propriedade. Aqui o compilador
/// conhece os shapes e lê cada campo por offset constante.
function resolveInto(objs: GameObject[], trs: Transform[], cIdx: number[], m: number,
                     gHead: number[], gNext: number[],
                     lastX: f64[], lastY: f64[], lastZ: f64[], inv: f64,
                     sIdx: number[], bIdx: number[], reactive: number): void {
  // O `const` de MÓDULO lido para um LOCAL, uma vez. É a mesma regra que este
  // arquivo já aplica aos arrays de voz e ao `trs`, e ela vale para constantes
  // também: `CGRID_MASK` era lido do escopo de módulo NOVE vezes por objeto por
  // passada (o 3×3), duas passadas por frame.
  //
  // MEDIDO (release, `tools/claude-bench-fisica-partes.ts`, A/B alternado de 4
  // rodadas em worktree isolado, 2026-08-10), `resolveCollisions`:
  //
  //     500 corpos:  7,48 / 7,85 / 7,35 / 7,57  →  4,52 / 4,62 / 4,72 / 4,77
  //     1000 corpos: 15,75 / 15,82 / 15,12 / 15,47 → 9,05 / 10,03 / 9,58 / 9,68
  //
  // ~39% nas duas escalas, por duas linhas. Alternado porque a máquina deriva
  // 20% entre execuções distantes: um "antes" medido meia hora antes mede o
  // vizinho compilando, não o código.
  //
  // COMO ESTE CUSTO FOI ENCONTRADO, porque a primeira leitura estava errada. A
  // ablação (`tools/claude-probe-colisao.ts`) apontou o `& CGRID_MASK` como o
  // degrau: 0,43 ms sem ele, 1,87 com. A conclusão óbvia — "o `&` é caro" — é
  // FALSA, e três medições a mataram: nove ANDs sobre operandos pequenos custam
  // o mesmo (não é estouro de i32), nove comandos separados custam o mesmo (não
  // é a forma da expressão) e UM único AND custa 0,017 ms (não escala com a
  // conta). O que o `&` tinha de especial era o OPERANDO: `CGRID_MASK` mora no
  // módulo. Trocá-lo por um local mantém o AND e o custo some.
  //
  // O corolário vale para o arquivo inteiro: uma constante de módulo num laço
  // quente é uma LEITURA, não um imediato. Se aparecer outra, este é o padrão.
  const mask = CGRID_MASK;
  const ns = sIdx.length;
  const nb = bIdx.length;
  let k = 0;
  while (k < m) {
    const oi = cIdx[k];
    const ob: GameObject = objs[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = trs[oi];
    // na passada EXTRA (reactive=0), corpo dormindo fica fora — o resto resolve
    if (reactive === 0 && t.asleep !== 0) { k = k + 1; continue; }
    // COLISÃO REATIVA: quem não saiu do lugar já foi separado no frame em que
    // se mexeu, e nada pode ter vindo até ele sem que ESSE alguém se movesse —
    // e quem se move varre a vizinhança COMPLETA, então vê o par pelo seu lado.
    // O grid é 2D (XZ), mas o teste de "se moveu" tem de olhar os TRÊS eixos:
    // um corpo em QUEDA LIVRE só muda Y, e ignorá-lo fazia dele um objeto
    // "parado" que atravessava o chão sem nunca ser testado.
    // (Só na passada reativa: a extra resolve incondicionalmente.)
    const px = t.px; const py = t.py; const pz = t.pz;
    let bigMove = 0;
    if (reactive !== 0) {
      const dxm = px - lastX[oi];
      const dym = py - lastY[oi];
      const dzm = pz - lastZ[oi];
      const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
      if (moved2 < MOVE_EPS2) { k = k + 1; continue; }
      lastX[oi] = px; lastY[oi] = py; lastZ[oi] = pz;
      // movimento GRANDE (não o micro-assentamento): este corpo pode estar
      // saindo de sob alguém — os dormentes da vizinhança precisam acordar e
      // reavaliar o próprio apoio (senão o telhado flutua quando a torre sai)
      if (moved2 > 0.0004) bigMove = 1;
    }
    const gx = mfloor(px * inv);
    const gz = mfloor(pz * inv);
    // a célula própria + as 8 vizinhas (vizinhança COMPLETA, ver acima)
    let dz = 0 - 1;
    while (dz <= 1) {
      let dx = 0 - 1;
      while (dx <= 1) {
        const b = (((gx + dx) * 73856093 + (gz + dz) * 19349663) & mask);
        let q = gHead[b];
        while (q >= 0) {
          const other = cIdx[q];
          if (other !== oi) {
            // despertar por PARTIDA: um corpo em movimento real acorda os
            // dormentes próximos — é o evento "meu apoio pode ter sumido"
            if (bigMove !== 0) {
              const to: Transform = trs[other];
              if (to.asleep !== 0) { to.asleep = 0; to.quiet = 0; }
            }
            // NOTA: o par É resolvido dos dois lados (A varre B e B varre A).
            // Deduplicar foi tentado e PIOROU (8.9 s -> 13.2 s na demolição):
            // a repetição funciona como iteração extra do solver, e sem ela a
            // pilha converge mais devagar e fica mais tempo acordada.
            solvePair(objs, trs, oi, other);
          }
          q = gNext[q];
        }
        dx = dx + 1;
      }
      dz = dz + 1;
    }
    // estáticos: lista DIRETA (chão, paredes — poucos e grandes demais pro grid)
    let sq = 0;
    while (sq < ns) {
      solvePair(objs, trs, oi, sIdx[sq]);
      sq = sq + 1;
    }
    // dinâmicos GRANDES: também por lista (um telhado dormindo em cima da
    // torre precisa ser visto pelo bloco que se move sob ele)
    sq = 0;
    while (sq < nb) {
      solvePair(objs, trs, oi, bIdx[sq]);
      sq = sq + 1;
    }
    k = k + 1;
  }

  // ── GRANDES como MOVERS: contra tudo, por lista (são poucos) ─────────────
  let bi = 0;
  while (bi < nb) {
    const oi = bIdx[bi];
    const ob: GameObject = objs[oi];
    if (ob.stationary !== 0) { bi = bi + 1; continue; }
    const t: Transform = trs[oi];
    if (reactive === 0 && t.asleep !== 0) { bi = bi + 1; continue; }
    if (reactive !== 0) {
      const dxm = t.px - lastX[oi];
      const dym = t.py - lastY[oi];
      const dzm = t.pz - lastZ[oi];
      if (dxm * dxm + dym * dym + dzm * dzm < MOVE_EPS2) { bi = bi + 1; continue; }
      lastX[oi] = t.px; lastY[oi] = t.py; lastZ[oi] = t.pz;
    }
    let q = 0;
    while (q < m) { solvePair(objs, trs, oi, cIdx[q]); q = q + 1; }
    q = 0;
    while (q < nb) {
      const oth = bIdx[q];
      if (oth !== oi) solvePair(objs, trs, oi, oth);
      q = q + 1;
    }
    q = 0;
    while (q < ns) { solvePair(objs, trs, oi, sIdx[q]); q = q + 1; }
    bi = bi + 1;
  }

  if (reactive === 0) return;   // contabilidade do sono só na passada reativa

  let sb = 0;
  while (sb < nb) {
    const t: Transform = trs[bIdx[sb]];
    if (t.asleep === 0) {
      const sp2 = t.vx * t.vx + t.vy * t.vy + t.vz * t.vz;
      if (sp2 < SLEEP_SPEED2R) {
        t.quiet = t.quiet + 1;
        if (t.quiet >= SLEEP_FRAMES) { t.asleep = 1; t.quiet = 0; }
      } else {
        t.quiet = 0;
      }
    }
    sb = sb + 1;
  }

  // ── SLEEPING (pós-passe, critério de VELOCIDADE) ─────────────────────────
  // O critério era posição-por-frame e falhava em cascata: com fps baixo o dt
  // cresce, a penetração da gravidade por frame cresce junto, ninguém fica
  // "quase parado" e ninguém dorme — que mantém o fps baixo. A VELOCIDADE
  // pós-resolução não depende do dt: o contato de apoio zera o vy do corpo
  // apoiado, então corpo em repouso mede ~0 aqui em qualquer framerate.
  k = 0;
  while (k < m) {
    const t: Transform = trs[cIdx[k]];
    if (t.asleep !== 0) {
      // dormindo é PERMANENTE: só acorda por contato de verdade (solvePair) ou
      // por um vizinho que SAI de perto (ver o despertar por partida, acima).
      // A revalidação periódica que existia aqui era a fonte do tremor: cada
      // bloco dormindo acordava a cada ~2 s, afundava um passo de gravidade e
      // era devolvido — dezenas de blocos "respirando" sem ação por perto.
    } else {
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

/// Laço direto A×B (usado quando há poucos objetos pro grid valer a pena).
function collideRangeInto(objs: GameObject[], trs: Transform[], cIdx: number[], m: number,
                          sIdx: number[], bIdx: number[]): void {
  const ns = sIdx.length;
  const nb = bIdx.length;
  let i = 0;
  while (i < m) {
    let j = i + 1;
    while (j < m) { solvePair(objs, trs, cIdx[i], cIdx[j]); j = j + 1; }
    let q = 0;
    while (q < ns) { solvePair(objs, trs, cIdx[i], sIdx[q]); q = q + 1; }
    q = 0;
    while (q < nb) { solvePair(objs, trs, cIdx[i], bIdx[q]); q = q + 1; }
    i = i + 1;
  }
  // grandes entre si e contra estáticos
  i = 0;
  while (i < nb) {
    let j = i + 1;
    while (j < nb) { solvePair(objs, trs, bIdx[i], bIdx[j]); j = j + 1; }
    let q = 0;
    while (q < ns) { solvePair(objs, trs, bIdx[i], sIdx[q]); q = q + 1; }
    i = i + 1;
  }
}

/// Resolve UM par: se as esferas se sobrepõem, separa e amortece a queda.
/// Trabalha em coordenada LOCAL quando ambos são raiz (o caso comum) — que é
/// o que o resto do motor espera do passe posicional.
/// Livre e tipada (ver `resolveInto`): é chamada uma vez por par candidato,
/// então o caminho dinâmico de propriedade aqui custaria mais que todo o resto.
/// O raio da esfera que cabe DENTRO da forma — a menor das três meias-extensões.
///
/// A mesma regra do `radiusOfCol` de `collider.ts` e do `raio()` do kernel, aqui
/// sobre três `f64` já escalados em vez de sobre o objeto. Um terceiro
/// significado de "raio" é o que faria os dois backends discordarem, então o que
/// muda é de ONDE vêm os números, nunca a conta.
function minOf3(x: f64, y: f64, z: f64): f64 {
  let m: f64 = x;
  if (y < m) m = y;
  if (z < m) m = z;
  return m;
}

function solvePair(objs: GameObject[], trs: Transform[], ia: number, ib: number): void {
  const a: GameObject = objs[ia];
  const b: GameObject = objs[ib];
  if (a.stationary !== 0 && b.stationary !== 0) return;   // nada a mover
  const ta: Transform = trs[ia];
  const tb: Transform = trs[ib];

  // Normal do contato e profundidade da sobreposição. Como sai depende das
  // FORMAS: caixa-caixa é AABB (eixo de menor penetração), caixa-esfera projeta
  // o centro na caixa, esfera-esfera é a distância entre centros.
  let nx: f64 = 0.0; let ny: f64 = 0.0; let nz: f64 = 0.0;
  let overlap: f64 = 0.0;

  // A forma vem do component `Collider` quando há um, e dos campos legados
  // quando não há. As oito leituras deste arquivo e de `physics_backend`
  // passam por `collider.ts` para que a forma tenha UM significado nos dois
  // backends — ver o cabeçalho de leitura lá.
  // Da TABELA, não do component: `collectColliders` resolveu isto uma vez por
  // varredura. Ler o component aqui é O(pares) e custou +43% a 2000 corpos.
  const boxA = csShape[ia] === COL_BOX ? 1 : 0;
  const boxB = csShape[ib] === COL_BOX ? 1 : 0;

  if (boxA !== 0 && boxB !== 0) {
    // ── CAIXA × CAIXA (AABB) ──────────────────────────────────────────────
    // Sobreposição por eixo; se algum for <= 0 não há contato. A normal é o
    // eixo de MENOR penetração — é o que faz um cubo caindo num chão largo ser
    // empurrado para CIMA (menor penetração em Y) e não para o lado.
    const ex = csHX[ia] * ta.sx + csHX[ib] * tb.sx;
    const dx = tb.px - ta.px;
    const ox = ex - (dx < 0.0 ? 0.0 - dx : dx);
    if (ox <= 0.0) return;
    const ey = csHY[ia] * ta.sy + csHY[ib] * tb.sy;
    const dy = tb.py - ta.py;
    const oy = ey - (dy < 0.0 ? 0.0 - dy : dy);
    if (oy <= 0.0) return;
    const ez = csHZ[ia] * ta.sz + csHZ[ib] * tb.sz;
    const dz = tb.pz - ta.pz;
    const oz = ez - (dz < 0.0 ? 0.0 - dz : dz);
    if (oz <= 0.0) return;
    if (oy <= ox && oy <= oz) {
      overlap = oy; ny = dy < 0.0 ? 0.0 - 1.0 : 1.0;
    } else if (ox <= oz) {
      overlap = ox; nx = dx < 0.0 ? 0.0 - 1.0 : 1.0;
    } else {
      overlap = oz; nz = dz < 0.0 ? 0.0 - 1.0 : 1.0;
    }
  } else if (boxA !== 0 || boxB !== 0) {
    // ── CAIXA × ESFERA ────────────────────────────────────────────────────
    // Ponto da caixa mais próximo do centro da esfera; se a distância até ele
    // for menor que o raio, há contato e a normal aponta do ponto ao centro.
    // `bt`/`st` são caixa e esfera; `sgn` devolve a normal na convenção
    // "de A para B" no fim.
    const bt: Transform = boxA !== 0 ? ta : tb;
    const st: Transform = boxA !== 0 ? tb : ta;
    // O OBJETO tem de andar junto com o transform: a meia-extensão agora vem do
    // component, e ler a do objeto errado é uma troca que nenhum teste de
    // esfera-contra-esfera pegaria.
    // Os ÍNDICES têm de trocar junto com os transforms: a meia-extensão vem da
    // tabela por índice, e ler a do corpo errado é a troca que nenhum teste de
    // esfera-contra-esfera pegaria.
    const bi = boxA !== 0 ? ia : ib;
    const si = boxA !== 0 ? ib : ia;
    const sgn: f64 = boxA !== 0 ? 1.0 : 0.0 - 1.0;
    const r: f64 = minOf3(csHX[si] * st.sx, csHY[si] * st.sy, csHZ[si] * st.sz);
    const hx = csHX[bi] * bt.sx; const hy = csHY[bi] * bt.sy; const hz = csHZ[bi] * bt.sz;
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
      // centro DENTRO da caixa: empurra pela face mais próxima (menor folga)
      const gx = hx - (qx < 0.0 ? 0.0 - qx : qx);
      const gy = hy - (qy < 0.0 ? 0.0 - qy : qy);
      const gz = hz - (qz < 0.0 ? 0.0 - qz : qz);
      if (gy <= gx && gy <= gz) { overlap = gy + r; ny = (qy < 0.0 ? 0.0 - 1.0 : 1.0) * sgn; }
      else if (gx <= gz) { overlap = gx + r; nx = (qx < 0.0 ? 0.0 - 1.0 : 1.0) * sgn; }
      else { overlap = gz + r; nz = (qz < 0.0 ? 0.0 - 1.0 : 1.0) * sgn; }
    }
  } else {
    // ── ESFERA × ESFERA ───────────────────────────────────────────────────
    const ra: f64 = minOf3(csHX[ia] * ta.sx, csHY[ia] * ta.sy, csHZ[ia] * ta.sz);
    const rb: f64 = minOf3(csHX[ib] * tb.sx, csHY[ib] * tb.sy, csHZ[ib] * tb.sz);
    const rs: f64 = ra + rb;
    const dx: f64 = tb.px - ta.px;
    // descarte barato por eixo antes da distância (evita 2 mult + sqrt)
    if (dx > rs || dx < 0.0 - rs) return;
    const dz: f64 = tb.pz - ta.pz;
    if (dz > rs || dz < 0.0 - rs) return;
    const dy: f64 = tb.py - ta.py;
    if (dy > rs || dy < 0.0 - rs) return;
    const d2: f64 = dx * dx + dy * dy + dz * dz;
    if (d2 >= rs * rs || d2 <= 0.0001) return;
    const d: f64 = math.sqrt(d2);
    nx = dx / d; ny = dy / d; nz = dz / d;
    overlap = rs - d;
  }

  // ── separação (comum às três formas) ──────────────────────────────────────
  // FOLGA POSICIONAL (slop): penetração de até 0.04 não é corrigida, e o resto
  // só a 85%. Corrigir 100% fazia a pilha RESPIRAR — cada resolução devolvia o
  // bloco ao contato exato, a gravidade re-afundava, e o vaivém (o "tremor")
  // nunca convergia. Com a folga, o bloco assenta DENTRO da banda e para.
  //
  // 0.04 medido contra 0.01 e 0.02 na demolição de 400 blocos: 8.8 / 9.1 /
  // 7.1 s — e só com 0.04 a cena inteira DORME (401/401 contra 351). Folga
  // maior = menos churn posicional = convergência mais rápida. O custo é
  // penetração visual de ~3% do tamanho do bloco, invisível.
  let corr: f64 = (overlap - 0.04) * 0.85;
  if (corr < 0.0) corr = 0.0;
  let pushA: f64 = corr * 0.5;
  let pushB: f64 = corr * 0.5;
  if (a.stationary !== 0) { pushA = 0.0; pushB = corr; }
  else if (b.stationary !== 0) { pushA = corr; pushB = 0.0; }
  ta.px = ta.px - nx * pushA;
  ta.py = ta.py - ny * pushA;
  ta.pz = ta.pz - nz * pushA;
  tb.px = tb.px + nx * pushB;
  tb.py = tb.py + ny * pushB;
  tb.pz = tb.pz + nz * pushB;
  // ── RESPOSTA DE IMPULSO ───────────────────────────────────────────────────
  // A separação acima resolve a INTERPENETRAÇÃO; isto resolve a VELOCIDADE.
  // Sem ele dois corpos que se chocam apenas paravam — não havia troca de
  // momento, então nada ricocheteava, deslizava ou empurrava.
  //
  // Impulso de corpo rígido clássico: j = -(1+e)·v_rel·n / (1/mA + 1/mB).
  // Massa 0 = INFINITA (chão, parede): entra como inverso 0, então o corpo não
  // é movido e o outro leva o impulso inteiro.
  const imA: f64 = a.stationary !== 0 || ta.mass <= 0.0 ? 0.0 : 1.0 / ta.mass;
  const imB: f64 = b.stationary !== 0 || tb.mass <= 0.0 ? 0.0 : 1.0 / tb.mass;
  const imSum: f64 = imA + imB;
  if (imSum > 0.0) {
    // velocidade RELATIVA de B em relação a A, projetada na normal
    const rvx = tb.vx - ta.vx;
    const rvy = tb.vy - ta.vy;
    const rvz = tb.vz - ta.vz;
    const vn = rvx * nx + rvy * ny + rvz * nz;
    // vn > 0 = já se afastando: resolver de novo os grudaria
    if (vn < 0.0) {
      // ACORDA os dois num contato de VERDADE (rápido ou fundo). Contatos de
      // repouso — a gravidade afundando 2 mm no apoio — não acordam ninguém,
      // senão pilha nenhuma dormiria nunca.
      if (vn < 0.0 - 0.8 || overlap > 0.06) {
        ta.asleep = 0; ta.quiet = 0;
        tb.asleep = 0; tb.quiet = 0;
      }
      // MÉDIA, não mínimo. Com mínimo, uma bola de borracha (0.9) num chão de
      // concreto (0.1) daria 0.1 e não quicaria — o material do chão apagava o
      // da bola. A média é o que engines usam e preserva a intenção dos dois.
      let e: f64 = (ta.restitution + tb.restitution) * 0.5;
      // CORTE DE RESTITUIÇÃO (o "chacoalho"): contato mais lento que 1 u/s não
      // quica. Sem isto, o micro-ciclo de repouso — gravidade afunda, impulso
      // devolve COM QUIQUE — realimentava para sempre: 392 blocos empilhados
      // tremiam sem terem sofrido nada. É o mesmo padrão de toda engine
      // (restitution velocity threshold).
      if (vn > 0.0 - 1.0) e = 0.0;
      const j: f64 = (0.0 - (1.0 + e)) * vn / imSum;
      // ── CONTATO DE APOIO (vn lento + normal vertical): SEM impulso normal.
      // O impulso num contato de repouso reinjetava velocidade no corpo de
      // BAIXO (a reação de segurar o de cima) e criava CICLOS-LIMITE: numa
      // coluna de 3, o miolo congelava em vy=-0.63 eterno, trocando velocidade
      // com os vizinhos, e o sono nunca engatava. No repouso, o de cima HERDA a
      // velocidade vertical do apoio — o zero do chão propaga para cima e a
      // coluna converge em poucos frames. Impacto de verdade (vn rápido) segue
      // no impulso clássico. O `j` ainda é calculado: é o teto do atrito.
      const resting = (vn > 0.0 - 1.0 && (ny > 0.5 || ny < 0.0 - 0.5)) ? 1 : 0;
      if (resting !== 0) {
        if (ny > 0.5) tb.vy = ta.vy;        // b está em cima de a
        else ta.vy = tb.vy;                 // a está em cima de b
      } else {
        ta.vx = ta.vx - nx * j * imA;
        ta.vy = ta.vy - ny * j * imA;
        ta.vz = ta.vz - nz * j * imA;
        tb.vx = tb.vx + nx * j * imB;
        tb.vy = tb.vy + ny * j * imB;
        tb.vz = tb.vz + nz * j * imB;
      }

      // ATRITO: freia a componente TANGENCIAL (o que sobra depois de tirar a
      // normal). É o que faz um corpo parar de deslizar sobre o chão em vez de
      // patinar para sempre.
      // MÉDIA GEOMÉTRICA (o padrão em engines): gelo (0.05) contra borracha
      // (0.9) dá 0.21 — escorregadio, dominado pelo gelo, mas não zero. A
      // média aritmética daria 0.47, que "sente" como asfalto.
      const f: f64 = math.sqrt(ta.friction * tb.friction);
      if (f > 0.0) {
        const tvx = rvx - nx * vn;
        const tvy = rvy - ny * vn;
        const tvz = rvz - nz * vn;
        const tl2 = tvx * tvx + tvy * tvy + tvz * tvz;
        if (tl2 > 0.000001) {
          const tl = math.sqrt(tl2);
          // impulso tangencial limitado por Coulomb (jt <= f * j)
          let jt: f64 = tl / imSum;
          const cap: f64 = f * j;
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
  }
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
const SLEEP_SPEED2R: f64 = 0.2;   // 0.45 u/s — medido: dorme antes sem congelar visivel
const SLEEP_FRAMES = 10;
/// Raio acima do qual um dinâmico sai do grid para a lista `bIdx`.
const BIG_R: f64 = 1.0;
const CGRID_CAP = 8192;
const CGRID_MASK = 8191;

/// Remontagem do grid da colisão como FUNÇÃO LIVRE tipada (ver o chamador).
function buildSceneGrid(trs: Transform[], cIdx: number[], m: number,
                        gHead: number[], gNext: number[], gCell: number[],
                        gUsedPrev: number, inv: f64): void {
  // local, não o `const` de módulo — ver a nota longa em `resolveInto`
  const mask = CGRID_MASK;
  // limpa APENAS os buckets que a passada anterior sujou (no máximo m)
  let k = 0;
  while (k < gUsedPrev) { gHead[gCell[k]] = 0 - 1; k = k + 1; }
  k = 0;
  while (k < m) {
    const oi = cIdx[k];
    const t: Transform = trs[oi];
    const gx = mfloor(t.px * inv);
    const gz = mfloor(t.pz * inv);
    const b = ((gx * 73856093 + gz * 19349663) & mask);
    gCell[k] = b;
    gNext[k] = gHead[b];   // encadeia na frente do bucket
    gHead[b] = k;
    k = k + 1;
  }
}

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
/// O selo do frame corrente de `computeWorldInto`. Cresce a cada chamada, e um
/// `done[i]` com selo antigo significa "não resolvido neste frame" sem que
/// ninguém precise escrever n zeros.
///
/// `f64` e não inteiro de propósito: um jogo a 240 fps leva 700 mil anos para
/// esgotar a precisão exata de um double em inteiros, então o envolvimento que
/// faria dois frames distintos compartilharem selo não é um caso — e um
/// contador que envolve daria um filho com a pose de um frame antigo, que é o
/// mesmo defeito que a versão sem carimbo teve.
let cwSelo: f64 = 0.0;

function computeWorldInto(objs: GameObject[], trs: Transform[], done: number[]): void {
  const n = objs.length;
  // O `done` guarda um CARIMBO DE FRAME e não um 0/1, e é isso que dispensa a
  // passada que o zerava. "Resolvido" passa a ser `done[i] === selo`, com um
  // selo novo a cada chamada: o valor do frame anterior nunca coincide, então
  // ele se invalida sozinho sem ninguém escrever n zeros.
  //
  // A primeira tentativa disto NÃO usou carimbo — apenas passou a escrever
  // `done[i] = 0` no ramo pendente, com o argumento de que os três ramos cobrem
  // todo i. O argumento estava certo sobre a ESCRITA e errado sobre a LEITURA:
  // `done[par]` é lido para um par que ainda não foi visitado neste frame, e via
  // o 1 do frame anterior — o filho então compunha com a pose do pai de um frame
  // atrás. `tools/test_scene.ts` pegou na hora ("filho resolvido na passada
  // extra: esperado ~12, veio 2"), que é exatamente o caso que a passada de
  // zerar existia para tornar distinguível.
  //
  // Medido: `computeWorld` custa 14,20 ms a 8000 objetos numa cena onde NADA se
  // move, e metade disso é a VISITA. Uma passada O(n) cujo único trabalho é
  // preparar outra passada O(n) é a parte da visita que sai sem nenhuma decisão
  // de política — 14,20 para 12,98 ms, medido.
  cwSelo = cwSelo + 1;
  const selo = cwSelo;

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
      done[i] = selo;
    } else if (done[par] === selo) {
      applyParentTo(o, objs[par]);
      done[i] = selo;
    } else {
      // Explícito, e é o que dispensa a passada de zerar: um pendente tem de
      // dizer que é pendente NESTE frame, senão herdaria o 1 do frame anterior
      // e as passadas extras o pulariam — um filho ficaria com a pose do pai de
      // um frame atrás, que é um erro visual e não uma otimização.
      // Nada a escrever: um carimbo velho JÁ significa "não resolvido neste
      // frame". Era aqui que a versão sem carimbo escrevia 0 e não bastava.
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
      if (done[i] !== selo) {
        const o = objs[i];
        if (done[o.parent] === selo) { applyParentTo(o, objs[o.parent]); done[i] = selo; }
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

// ── a forma, resolvida UMA vez por varredura ───────────────────────────────
//
// Indexadas pelo índice do objeto, preenchidas por `collectColliders`. Existem
// porque resolver a forma DENTRO de `solvePair` custou +43% a 2000 corpos
// caindo (30,5 ms contra 21,3, três medições cada, máquina ociosa): o par é
// pago O(pares) e a resolução é O(n), então ela não pertence ao par.
//
// LOCAIS e não de mundo, e essa é a parte que importa: a varredura só re-roda
// quando a COMPOSIÇÃO da cena muda, então um valor já multiplicado pela escala
// ficaria obsoleto ao redimensionar um objeto sem adicionar nada. A
// meia-extensão local é campo do component e só muda quando alguém edita o
// colisor; a escala entra no par, onde é lida do transform vivo.
const csShape: number[] = [];
const csHX: f64[] = [];
const csHY: f64[] = [];
const csHZ: f64[] = [];

function collectColliders(objs: GameObject[], trs: Transform[], out: number[],
                          outStatic: number[], outBig: number[]): void {
  const n = objs.length;
  // As tabelas crescem DENSAS, com um `push` por índice, e nunca por atribuição
  // num índice de array vazio: um array com buracos sai do caminho de elementos
  // e cada leitura passa a custar uma consulta de propriedade. É um detalhe de
  // representação, e é o tipo de coisa que só aparece medindo — a versão
  // esparsa disto não recuperou nada dos +43% que existia para corrigir.
  while (csShape.length < n) {
    csShape.push(0); csHX.push(0.5); csHY.push(0.5); csHZ.push(0.5);
  }
  let maxR: f64 = 0.0001;
  let i = 0;
  while (i < n) {
    const o = objs[i];
    // `collideFlag` combina as três condições (mesh, customMesh, raiz) num só
    // campo: cada acesso a campo custa ~2 µs, e ler três por objeto sobre a
    // cena inteira, todo frame, era metade do custo da física.
    if (o.collideFlag !== 0) {
      // Antes do desvio do estático: um estático COLIDE (só não se move), e
      // pular a resolução dele aqui deixaria `solvePair` sem a forma do chão.
      csShape[i] = shapeOf(o);
      csHX[i] = halfLocalX(o); csHY[i] = halfLocalY(o); csHZ[i] = halfLocalZ(o);
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
      const hx = csHX[i] * t.sx; const hy = csHY[i] * t.sy; const hz = csHZ[i] * t.sz;
      let r: f64 = hx;
      if (csShape[i] === COL_BOX) {
        if (hz > r) r = hz;
      } else {
        // a esfera que cabe DENTRO: a menor das três
        if (hy < r) r = hy;
        if (hz < r) r = hz;
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
