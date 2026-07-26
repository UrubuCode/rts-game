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
      collectColliders(objs, this.trs, this.cIdx, this.sIdx);
      this.colMaxR = ccMaxR;
      this.colDirty = 0;
    }
    const maxR: f64 = this.colMaxR;
    const m = this.cIdx.length;
    // NADA dinâmico → nenhum par pode se resolver (estático × estático nunca
    // gera empurrão). É a saída que faz um cenário de RTS parado custar zero.
    if (m === 0) return;

    // Poucos dinâmicos: laço direto (todos × todos + estáticos) sem grid.
    if (m < 24) { collideRangeInto(this.objects, this.trs, this.cIdx, m, this.sIdx); return; }

    // ── 2) monta o grid ──────────────────────────────────────────────────────
    // Célula = 2× o maior raio: assim dois objetos que se tocam NUNCA estão a
    // mais de uma célula de distância, e checar os 9 vizinhos basta.
    const cell: f64 = maxR * 2.0;
    const inv: f64 = 1.0 / cell;
    // hash das colunas: chave = (gx, gz) dobrada na tabela por AND.
    while (this.gHead.length < CGRID_CAP) this.gHead.push(0 - 1);
    while (this.gNext.length < m) { this.gNext.push(0 - 1); this.gCell.push(0); }
    // 1e30 = "nunca resolvido": força a primeira passada a olhar todo mundo
    while (this.lastX.length < this.objects.length) { this.lastX.push(1e30); this.lastY.push(1e30); this.lastZ.push(1e30); }
    // limpa APENAS os buckets que a passada anterior sujou (no máximo m),
    // mantendo a invariante "gHead é todo -1 na entrada"
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
      this.gNext[k] = this.gHead[b];   // encadeia na frente do bucket
      this.gHead[b] = k;
      k = k + 1;
    }
    this.gUsed = m;

    // ── 3) resolve ───────────────────────────────────────────────────────────
    // O CORPO vive numa FUNÇÃO LIVRE de parâmetros tipados, pelo mesmo motivo
    // do `computeWorld` (ver `computeWorldInto`): dentro de um método os locais
    // perdem as provas de tipo e cada `this.objects[i].transform.px` cai no
    // caminho dinâmico de propriedade. Este é o laço mais quente do motor.
    resolveInto(this.objects, this.trs, this.cIdx, m,
                this.gHead, this.gNext, this.lastX, this.lastY, this.lastZ, inv,
                this.sIdx, 1);
    // SEGUNDA iteração, SEM a reatividade: uma pilha alta empurra o bloco de
    // baixo para dentro do chão mais do que UMA resolução devolve — o de baixo
    // afundava 0.34 em regime e, espremido o bastante, era CUSPIDO pelo fundo
    // (medido: bloco a y=-6 com vy=-10). A segunda passada redistribui as
    // correções de baixo para cima. Corpos dormindo continuam fora.
    resolveInto(this.objects, this.trs, this.cIdx, m,
                this.gHead, this.gNext, this.lastX, this.lastY, this.lastZ, inv,
                this.sIdx, 0);
  }

}

/// Passe de resolução da colisão como FUNÇÃO LIVRE de parâmetros TIPADOS —
/// mesmo motivo do `computeWorldInto`: dentro de um método `this.objects[i]`
/// e `.transform.px` caem no caminho dinâmico de propriedade. Aqui o compilador
/// conhece os shapes e lê cada campo por offset constante.
function resolveInto(objs: GameObject[], trs: Transform[], cIdx: number[], m: number,
                     gHead: number[], gNext: number[],
                     lastX: f64[], lastY: f64[], lastZ: f64[], inv: f64,
                     sIdx: number[], reactive: number): void {
  const ns = sIdx.length;
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
        const b = (((gx + dx) * 73856093 + (gz + dz) * 19349663) & CGRID_MASK);
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
    k = k + 1;
  }

  if (reactive === 0) return;   // contabilidade do sono só na passada reativa

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
                          sIdx: number[]): void {
  const ns = sIdx.length;
  let i = 0;
  while (i < m) {
    let j = i + 1;
    while (j < m) { solvePair(objs, trs, cIdx[i], cIdx[j]); j = j + 1; }
    let q = 0;
    while (q < ns) { solvePair(objs, trs, cIdx[i], sIdx[q]); q = q + 1; }
    i = i + 1;
  }
}

/// Resolve UM par: se as esferas se sobrepõem, separa e amortece a queda.
/// Trabalha em coordenada LOCAL quando ambos são raiz (o caso comum) — que é
/// o que o resto do motor espera do passe posicional.
/// Livre e tipada (ver `resolveInto`): é chamada uma vez por par candidato,
/// então o caminho dinâmico de propriedade aqui custaria mais que todo o resto.
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

  const boxA = a.colShape === COL_BOX ? 1 : 0;
  const boxB = b.colShape === COL_BOX ? 1 : 0;

  if (boxA !== 0 && boxB !== 0) {
    // ── CAIXA × CAIXA (AABB) ──────────────────────────────────────────────
    // Sobreposição por eixo; se algum for <= 0 não há contato. A normal é o
    // eixo de MENOR penetração — é o que faz um cubo caindo num chão largo ser
    // empurrado para CIMA (menor penetração em Y) e não para o lado.
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
    const ra: f64 = radiusOf(ta);
    const rb: f64 = radiusOf(tb);
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
  // FOLGA POSICIONAL (slop): penetração de até 0.02 não é corrigida, e o resto
  // só a 85%. Corrigir 100% fazia a pilha RESPIRAR — cada resolução devolvia o
  // bloco ao contato exato, a gravidade re-afundava, e o vaivém (o "tremor")
  // nunca convergia. Com a folga, o bloco assenta DENTRO da banda e para.
  let corr: f64 = (overlap - 0.02) * 0.85;
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
                          outStatic: number[]): void {
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
      if (r > maxR) maxR = r;
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
