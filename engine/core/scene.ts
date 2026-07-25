// Engine RTS — Scene: a lista de GameObjects + o laço de update polimórfico.
// O render pass roda separado (main.ts) lendo os objetos desta cena.

import { GameObject } from "./gameobject";
import { Transform } from "./transform";
import { KIND_CAMERA } from "./behavior";
import math from "rts:math";

export class Scene {
  name: string;
  objects: GameObject[];
  // Buffers REAPROVEITADOS entre frames pelo broad-phase da colisão e pelo
  // computeWorld. Alocar por frame no laço mais quente do motor gerava
  // pressão de GC; estes são limpos (length=0 / clear) em vez de recriados.
  cIdx: number[];                    // índices dos objetos colidíveis
  grid: Map<number, number[]>;       // hash espacial XZ -> bucket de índices
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
    this.grid = new Map<number, number[]>();
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
      collectColliders(objs, this.trs, this.cIdx);
      this.colMaxR = ccMaxR;
      this.colMovers = ccMovers;
      this.colDirty = 0;
    }
    const maxR: f64 = this.colMaxR;
    const movers = this.colMovers;
    const m = this.cIdx.length;
    if (m < 2) return;
    // NADA se move → nenhum par pode ser resolvido. Sai antes de montar o grid.
    // Um cenário de RTS é quase todo cenário estático (prédios, terreno), e sem
    // esta saída pagávamos o hash + varredura de vizinhança de tudo, todo frame,
    // pra no fim descartar cada par dentro do solveOne.
    if (movers === 0) return;

    // Poucos objetos: o overhead do grid não compensa — laço direto é mais rápido.
    if (m < 24) { this.collideRange(this.cIdx, 0, m, this.cIdx, 0, m, 1); return; }

    // ── 2) monta o grid ──────────────────────────────────────────────────────
    // Célula = 2× o maior raio: assim dois objetos que se tocam NUNCA estão a
    // mais de uma célula de distância, e checar os 9 vizinhos basta.
    const cell: f64 = maxR * 2.0;
    const inv: f64 = 1.0 / cell;
    // hash das colunas: chave = (gx, gz) empacotados. Sem Map de tupla no motor,
    // usa-se um bucket por chave inteira via Map<number, number[]>.
    this.grid.clear();
    let k = 0;
    while (k < m) {
      const oi = this.cIdx[k];
      const t = this.objects[oi].transform;
      const gx = mfloor(t.px * inv);
      const gz = mfloor(t.pz * inv);
      const key = gx * 73856093 + gz * 19349663;   // hash espacial clássico
      const b = this.grid.get(key);
      if (b === undefined) { const nb: number[] = [oi]; this.grid.set(key, nb); }
      else b.push(oi);
      k = k + 1;
    }

    // ── 3) resolve: cada objeto contra a própria célula + as 8 vizinhas ───────
    // Para não testar o mesmo par duas vezes, só olha metade da vizinhança
    // (dx,dz em {(0,0),(1,0),(-1,1),(0,1),(1,1)}): as outras 4 são cobertas
    // quando a célula vizinha for a "dona" do par.
    // Itera só quem PODE se mover: um par estático-estático nunca gera empurrão,
    // então consultar o grid a partir de um estático é trabalho jogado fora.
    // Como um móvel sempre consulta a vizinhança inteira (não meia), todo par
    // móvel-estático e móvel-móvel continua sendo visto.
    k = 0;
    while (k < m) {
      const oi = this.cIdx[k];
      const ob = this.objects[oi];
      if (ob.stationary !== 0) { k = k + 1; continue; }
      const t = ob.transform;
      const gx = mfloor(t.px * inv);
      const gz = mfloor(t.pz * inv);
      // célula própria: pula a si mesmo (o par duplo móvel-móvel é inofensivo —
      // a segunda resolução vê os corpos já separados e sai no teste de esfera)
      const self = this.grid.get(gx * 73856093 + gz * 19349663);
      if (self !== undefined) this.collideSelf(oi, self);
      // vizinhança COMPLETA (8 células)
      let dz = 0 - 1;
      while (dz <= 1) {
        let dx = 0 - 1;
        while (dx <= 1) {
          if (dx !== 0 || dz !== 0) this.collideNeighbor(oi, gx + dx, gz + dz, inv);
          dx = dx + 1;
        }
        dz = dz + 1;
      }
      k = k + 1;
    }
  }

  // testa `oi` contra a própria célula, pulando ele mesmo.
  collideSelf(oi: number, bucket: number[]): void {
    let q = 0;
    while (q < bucket.length) {
      const other = bucket[q];
      if (other !== oi) this.solveOne(oi, other);
      q = q + 1;
    }
  }

  // testa `oi` contra todos os objetos de uma célula vizinha (se existir).
  collideNeighbor(oi: number, gx: number, gz: number, inv: f64): void {
    const b = this.grid.get(gx * 73856093 + gz * 19349663);
    if (b === undefined) return;
    this.collidePair(oi, b, 0);
  }

  // testa `oi` contra bucket[from..] resolvendo cada sobreposição.
  collidePair(oi: number, bucket: number[], from: number): void {
    let q = from;
    while (q < bucket.length) {
      this.solveOne(oi, bucket[q]);
      q = q + 1;
    }
  }

  // laço direto A×B (usado quando há poucos objetos pro grid valer a pena).
  collideRange(la: number[], a0: number, a1: number, lb: number[], b0: number, b1: number, tri: number): void {
    let i = a0;
    while (i < a1) {
      let j = tri !== 0 ? i + 1 : b0;
      while (j < b1) { this.solveOne(la[i], lb[j]); j = j + 1; }
      i = i + 1;
    }
  }

  /// Resolve UM par: se as esferas se sobrepõem, separa e amortece a queda.
  /// Trabalha em coordenada LOCAL quando ambos são raiz (o caso comum) — que é
  /// o que o resto do motor espera do passe posicional.
  solveOne(ia: number, ib: number): void {
    const a = this.objects[ia];
    const b = this.objects[ib];
    if (a.stationary !== 0 && b.stationary !== 0) return;   // nada a mover
    const ta = a.transform;
    const tb = b.transform;
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
    const nx: f64 = dx / d;
    const ny: f64 = dy / d;
    const nz: f64 = dz / d;
    const overlap: f64 = rs - d;
    let pushA: f64 = overlap * 0.5;
    let pushB: f64 = overlap * 0.5;
    if (a.stationary !== 0) { pushA = 0.0; pushB = overlap; }
    else if (b.stationary !== 0) { pushA = overlap; pushB = 0.0; }
    ta.px = ta.px - nx * pushA;
    ta.py = ta.py - ny * pushA;
    ta.pz = ta.pz - nz * pushA;
    tb.px = tb.px + nx * pushB;
    tb.py = tb.py + ny * pushB;
    tb.pz = tb.pz + nz * pushB;
    // contato vertical → zera a velocidade que empurra pra dentro
    if (ny > 0.5) {
      if (tb.vy < 0.0) tb.vy = 0.0;
      if (ta.vy > 0.0) ta.vy = 0.0;
    } else if (ny < 0.0 - 0.5) {
      if (ta.vy < 0.0) ta.vy = 0.0;
      if (tb.vy > 0.0) tb.vy = 0.0;
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
function updateAll(objs: GameObject[], dt: f64): void {
  const n = objs.length;
  let i = 0;
  while (i < n) {
    const o = objs[i];
    if (o.active !== 0) o.update(dt);
    i = i + 1;
  }
}

// Saídas de `collectColliders` (evita alocar um array de retorno por frame).
let ccMaxR: f64 = 0.0001;
let ccMovers = 0;

function collectColliders(objs: GameObject[], trs: Transform[], out: number[]): void {
  const n = objs.length;
  let maxR: f64 = 0.0001;
  let movers = 0;
  let i = 0;
  while (i < n) {
    const o = objs[i];
    // `collideFlag` combina as três condições (mesh, customMesh, raiz) num só
    // campo: cada acesso a campo custa ~2 µs, e ler três por objeto sobre a
    // cena inteira, todo frame, era metade do custo da física.
    if (o.collideFlag !== 0) {
      out.push(i);
      if (o.stationary === 0) movers = movers + 1;
      const t: Transform = trs[i];   // espelho paralelo (ver `trs`)
      const r: f64 = radiusOf(t);
      if (r > maxR) maxR = r;
    }
    i = i + 1;
  }
  ccMaxR = maxR;
  ccMovers = movers;
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
