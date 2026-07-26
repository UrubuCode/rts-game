// Engine RTS — SIMULADOR DE LÍQUIDO (SPH: Smoothed Particle Hydrodynamics).
//
// Cada partícula é um GameObject; o líquido emerge das forças entre vizinhos:
//   • DENSIDADE — quantos vizinhos há por perto (kernel poly6)
//   • PRESSÃO   — partículas comprimidas se empurram (kernel spiky)
//   • VISCOSIDADE — vizinhos tendem a igualar velocidade (é o que faz "escorrer"
//     em vez de quicar como bolinhas)
//
// É um SISTEMA, não um Behavior por partícula: as forças dependem dos VIZINHOS,
// e um Behavior só enxerga o próprio transform. O sistema roda uma vez por
// frame sobre o conjunto — e reusa o mesmo hash espacial da colisão, sem o qual
// achar vizinhos seria O(n²).
//
// Uso (ver tools/fluid_demo.ts):
//   const sim = new Fluid(); sim.addFrom(scene, primeiroIdx, ultimoIdx);
//   ... por frame: sim.step(dt, scene);

import math from "rts:math";

import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { Scene } from "../engine/core/scene";

/// Raio de influência: além disto uma partícula não sente a outra. Define a
/// escala do líquido — e o tamanho da célula do hash de vizinhança.
///
/// Prefixo FL_ OBRIGATÓRIO: um nome de topo COLIDE em silêncio entre módulos
/// neste runtime, e o antigo `const H` daqui batia com o `let H` (ALTURA DA
/// JANELA) do fluid_demo. A demo escrevia ~950 nesse slot todo frame; dentro do
/// kernel, `diff = H - r` virava ~949 em vez de ~1 — força gigante em TODO par,
/// grampeada no teto de aceleração, para sempre. Era a fonte final da agitação:
/// o líquido convergia perfeito em QUALQUER teste headless (sem janela, sem
/// `H`) e nunca na demo com render.
const FL_H: f64 = 1.1;
const FL_H2: f64 = FL_H * FL_H;

/// Densidade de repouso: acima dela a pressão é positiva e as partículas se
/// EMPURRAM. (A pressão negativa é grampeada em zero — ver `computeDensity`.)
///
/// Medido neste kernel: uma partícula isolada tem densidade 2.51 (conta a si
/// mesma), duas encostadas ~4.5, e o miolo de um bloco denso 8.74.
///
/// O valor tem de ficar perto do PAR, não do bloco. Calibrado em 6.5, duas
/// partículas em rota de colisão nunca alcançavam o repouso: a pressão ficava
/// zero, não havia repulsão nenhuma e elas SE ATRAVESSAVAM. Verificado com um
/// "canhão" — duas partículas disparadas uma contra a outra a 8 u/s passavam
/// direto uma pela outra. A 4.5 elas se repelem e caem, que é o correto.
const REST_DENSITY: f64 = 4.5;
/// Rigidez: quanto a pressão reage à compressão. Alto demais explode a
/// simulação em dt grande; baixo demais deixa o líquido "esponjoso".
///
/// O valor é grande porque a força de pressão divide por ρ² (forma simétrica,
/// ver `computeForces`): com ρ ≈ 6.5, isso é uma divisão por ~42. Medido a
/// 500 frames: 22 deixa o líquido achatado no piso (topo 0.8), 1200 sustenta
/// 2 camadas (topo 2.01) e 2000 já reagita (KE 244 contra 105).
const STIFFNESS: f64 = 1200.0;
/// Viscosidade: o que diferencia água (baixa) de mel (alta). É ela que faz o
/// líquido ESCORRER em vez de as partículas quicarem como bolinhas soltas.
///
/// Escala com STIFFNESS — as duas forças competem, e subir uma sem a outra
/// deixa o líquido agitado.
///
/// O valor subiu de 15 quando o termo virou simétrico (`/(di*dj)` em vez de
/// `/dj`): com densidade típica ~4.5, o divisor cresceu ~4.5x, então a
/// constante acompanha para manter a mesma viscosidade efetiva.
const VISCOSITY: f64 = 68.0;
const GRAVITY: f64 = 0.0 - 22.0;
/// Amortecimento no contato com parede/chão (0 = gruda, 1 = quica).
const WALL_DAMP: f64 = 0.35;
/// Teto de velocidade: um passe explícito pode divergir se uma partícula
/// receber muita força num frame; o clamp mantém a simulação estável.
const MAX_SPEED: f64 = 26.0;
/// Teto da aceleração de pressão+viscosidade por partícula (ver `computeForces`).
/// Em múltiplos da gravidade: 40x22 = 880, forte o bastante para separar
/// partículas em rota de colisão e longe do pico numérico de 200 mil.
const MAX_ACCEL: f64 = 300.0;
/// Teto da pressão por partícula (ver `computeDensity`).
const MAX_PRESSURE: f64 = 3000.0;
/// Velocidade (ao quadrado) abaixo da qual a partícula para de vez (ver
/// `integrate`). 0.05 = 0.22 u/s.
///
/// O valor caiu de 1.0 depois que a pressão negativa passou a ser grampeada:
/// aquele limiar existia para MASCARAR a agitação que a atração ilimitada
/// causava. Com a causa corrigida, ele passou a congelar o líquido no ar — o
/// topo parava em 3.81 em vez de assentar em 2.09.
const SLEEP_SPEED2: f64 = 0.05;
/// Duração de um sub-passo e quantos cabem num frame. O produto é o tempo
/// MÁXIMO de simulação que um frame avança — o teto evita a ESPIRAL DA MORTE:
/// um frame lento gera dt grande, que pede mais sub-passos, que deixam o frame
/// ainda mais lento. Sem ele a demo caía de 17 para 2 fps e não se recuperava.
/// Passando do teto a simulação roda em câmera lenta em vez de travar.
const SUBSTEP: f64 = 0.020;
const MAX_SUBSTEPS: f64 = 1.0;

// Constantes dos kernels SPH (2D-ish normalizado — ajustado à mão para a escala
// desta demo, não à teoria 3D exata).
const POLY6: f64 = 4.0 / (3.14159265358979 * 0.9);
const SPIKY: f64 = 10.0 / (3.14159265358979 * 0.55);

/// Um corpo de líquido: partículas com posição, velocidade, densidade e pressão.
/// Arrays PARALELOS (não um array de objetos) — é o layout que o motor percorre
/// mais rápido, e os laços internos são os mais quentes do simulador.
export class Fluid {
  trs: Transform[];      // transform de cada partícula (escreve a posição)
  vx: f64[]; vy: f64[]; vz: f64[];
  dens: f64[]; pres: f64[];
  fx: f64[]; fy: f64[]; fz: f64[];
  n: number;

  // limites da caixa que contém o líquido
  minX: f64; maxX: f64; minY: f64; minZ: f64; maxZ: f64;

  // ── HASH ESPACIAL em ARRAYS (não `Map`) ──────────────────────────────────
  // O `Map` daqui custava o simulador inteiro, mas NÃO por ser "lento": neste
  // runtime ele não é um hash, e sim uma lista de associação com varredura
  // LINEAR — o lookup é O(n) no número de entradas. Medido: 100 mil `get` da
  // mesma chave num mapa de 1000 custam 0,29 s se ela é a primeira e 25,35 s se
  // é a última. Um hash espacial vira quadrático assim. Ver UrubuCode/rts#1998.
  //
  // Lista encadeada clássica: `head[célula]` é a primeira partícula daquela
  // célula e `next[i]` a seguinte, com -1 terminando. Sem alocação por frame.
  head: number[];        // hash da célula → primeira partícula (-1 = vazia)
  next: number[];        // partícula → próxima na mesma célula (-1 = fim)
  cellOf: number[];      // partícula → hash da sua célula
  // Vizinhos JÁ filtrados por raio, achatados: os de `i` ficam em
  // nbr[i*MAX_NBR .. i*MAX_NBR+nbrCnt[i]]. A densidade monta, as forças reusam.
  nbr: number[];
  nbrCnt: number[];

  constructor() {
    this.trs = [];
    this.vx = []; this.vy = []; this.vz = [];
    this.dens = []; this.pres = [];
    this.fx = []; this.fy = []; this.fz = [];
    this.n = 0;
    this.minX = 0.0 - 8.0; this.maxX = 8.0;
    this.minY = 0.6;
    this.minZ = 0.0 - 8.0; this.maxZ = 8.0;
    this.head = [];
    this.next = [];
    this.cellOf = [];
    this.nbr = [];
    this.nbrCnt = [];
  }

  /// Define a caixa que contém o líquido (paredes + chão).
  setBounds(minX: f64, maxX: f64, minY: f64, minZ: f64, maxZ: f64): void {
    this.minX = minX; this.maxX = maxX;
    this.minY = minY;
    this.minZ = minZ; this.maxZ = maxZ;
  }

  /// Registra como partículas os objetos de `from` a `to` (índices na cena).
  addFrom(scene: Scene, from: number, to: number): void {
    let i = from;
    while (i <= to && i < scene.objects.length) {
      const o: GameObject = scene.objects[i];
      this.trs.push(o.transform);
      this.vx.push(0.0); this.vy.push(0.0); this.vz.push(0.0);
      this.dens.push(0.0); this.pres.push(0.0);
      this.fx.push(0.0); this.fy.push(0.0); this.fz.push(0.0);
      this.next.push(0 - 1);
      this.cellOf.push(0);
      // reserva a fatia desta partícula na lista achatada de vizinhos
      this.nbrCnt.push(0);
      let q = 0;
      while (q < MAX_NBR) { this.nbr.push(0); q = q + 1; }
      this.n = this.n + 1;
      // a partícula é movida por ESTE sistema, não pela colisão da cena
      o.stationary = 1;
      o.refreshCollide();
      i = i + 1;
    }
  }

  /// Avança a simulação em `dt` segundos.
  step(dt: f64, scene: Scene): void {
    if (this.n < 2) return;
    // Um passo grande diverge (as forças são explícitas): fatia em sub-passos
    // de no máximo 8 ms. É o que mantém o líquido estável a 30 ou 144 fps.
    let rest = dt;
    if (rest > MAX_SUBSTEPS * SUBSTEP) rest = MAX_SUBSTEPS * SUBSTEP;
    while (rest > 0.0001) {
      let h = rest;
      if (h > SUBSTEP) h = SUBSTEP;
      this.substep(h);
      rest = rest - h;
    }
  }

  // Sondas de perfil: cada uma roda UMA fase do sub-passo isoladamente, para
  // medir onde o tempo vai sem adivinhar. Usadas por tools/, não pelo jogo.
  probeGrid(): void {
    while (this.head.length < HASH_CAP) this.head.push(0 - 1);
    buildFluidGrid(this.trs, this.head, this.next, this.cellOf, this.n);
  }
  probeDensity(): void {
    this.probeGrid();
    computeDensity(this.trs, this.dens, this.pres, this.head, this.next, this.n,
                   this.nbr, this.nbrCnt);
  }
  probeForces(): void {
    this.probeDensity();
    computeForces(this.trs, this.vx, this.vy, this.vz, this.dens, this.pres,
                  this.fx, this.fy, this.fz, this.nbr, this.nbrCnt, this.n);
  }

  substep(dt: f64): void {
    // A tabela de head só cresce; alocá-la por frame seria pressão de GC.
    // Nasce toda em -1, e daí em diante `buildFluidGrid` mantém essa invariante
    // limpando o que sujou — por isso ela nunca precisa ser varrida de novo.
    while (this.head.length < HASH_CAP) this.head.push(0 - 1);
    buildFluidGrid(this.trs, this.head, this.next, this.cellOf, this.n);
    computeDensity(this.trs, this.dens, this.pres, this.head, this.next, this.n,
                   this.nbr, this.nbrCnt);
    computeForces(this.trs, this.vx, this.vy, this.vz, this.dens, this.pres,
                  this.fx, this.fy, this.fz, this.nbr, this.nbrCnt, this.n);
    integrate(this.trs, this.vx, this.vy, this.vz, this.fx, this.fy, this.fz,
              this.dens, this.n, dt,
              this.minX, this.maxX, this.minY, this.minZ, this.maxZ);
  }
}

// ── Funções LIVRES de parâmetros tipados ────────────────────────────────────
// Dentro de um método os locais perdem as provas de tipo e cada acesso a campo
// cai no caminho dinâmico (~3x mais lento). Estes são os laços mais quentes do
// motor inteiro — O(n × vizinhos) por sub-passo.

/// Chave da célula de uma posição. Célula = FL_H, então dois vizinhos a menos de FL_H
/// estão sempre em células adjacentes e checar as 27 vizinhas basta.
function cellKey(x: f64, y: f64, z: f64): number {
  const gx = ffloor(x / FL_H);
  const gy = ffloor(y / FL_H);
  const gz = ffloor(z / FL_H);
  return gx * 73856093 + gy * 19349663 + gz * 83492791;
}
/// Tamanho da tabela de hash espacial (potência de 2 para o AND ser barato).
/// Generoso o bastante para milhares de partículas sem colisão excessiva.
const HASH_CAP = 8192;
/// Teto de vizinhos guardados por partícula (ver computeDensity).
///
/// 40, não 16: o truncamento QUEBRA PARES. Se a lista de A enche antes de
/// registrar B, mas B registra A, a interação vira de mão única — força sem
/// reação, momento criado do nada. As partículas presas nos cantos estavam
/// exatamente saturadas em viz=16. Com 40 o truncamento só ocorre em
/// configurações degeneradas, que o teto de pressão já contém.
const MAX_NBR = 40;
const HASH_MASK = 8191;

/// Bucket de uma célula: hash da tripla (gx,gy,gz) dobrado na tabela.
function bucketOf(gx: number, gy: number, gz: number): number {
  const k = gx * 73856093 + gy * 19349663 + gz * 83492791;
  return (k & HASH_MASK);
}

/// Chave a partir de coordenadas JÁ em células — sem divisão nem floor.
/// O laço de vizinhança chamava `cellKey` 27x por partícula (3 divisões + 3
/// floors cada), duas vezes por sub-passo. Calcular a célula BASE uma vez e
/// somar os offsets elimina 54 conversões por partícula por passo.
function keyOf(gx: number, gy: number, gz: number): number {
  return gx * 73856093 + gy * 19349663 + gz * 83492791;
}
function ffloor(v: f64): number {
  const t = v | 0;
  if (v < 0.0 && (t * 1.0) !== v) return t - 1;
  return t;
}

function buildFluidGrid(trs: Transform[], head: number[], next: number[],
                        cellOf: number[], n: number): void {
  // Limpa APENAS os buckets que a passada anterior usou — no máximo `n`, não
  // HASH_CAP. Varrer as 8192 entradas custava mais que a simulação inteira:
  // com 126 partículas eram 65 escritas de limpeza para cada uma de trabalho
  // útil, um custo FIXO que não caía nem reduzindo o líquido.
  let c = 0;
  while (c < n) { head[cellOf[c]] = 0 - 1; c = c + 1; }
  let i = 0;
  while (i < n) {
    const t: Transform = trs[i];
    const b = bucketOf(ffloor(t.px / FL_H), ffloor(t.py / FL_H), ffloor(t.pz / FL_H));
    cellOf[i] = b;
    next[i] = head[b];   // encadeia na frente da lista do bucket
    head[b] = i;
    i = i + 1;
  }
}

/// Densidade por partícula (kernel poly6 sobre os vizinhos) e a pressão que ela
/// gera. Pressão negativa (abaixo da densidade de repouso) faz o líquido se
/// manter coeso em vez de virar poeira.
/// Além da densidade, GRAVA a lista de vizinhos de cada partícula em
/// `nbr`/`nbrCnt` (achatada: os vizinhos de `i` ocupam `nbr[i*MAX_NBR ...]`).
/// As forças reusam essa lista em vez de refazer a travessia das 27 células —
/// era o dobro de trabalho para chegar exatamente ao mesmo conjunto.
/// Vizinhos além de MAX_NBR são descartados: a esta densidade o kernel já
/// saturou, e o teto evita alocação dinâmica no laço mais quente do motor.
function computeDensity(trs: Transform[], dens: f64[], pres: f64[],
                        head: number[], next: number[], n: number,
                        nbr: number[], nbrCnt: number[]): void {
  let i = 0;
  while (i < n) {
    const ti: Transform = trs[i];
    const px = ti.px; const py = ti.py; const pz = ti.pz;
    // célula BASE calculada UMA vez; as 26 vizinhas saem por soma de offset
    const bx = ffloor(px / FL_H); const by = ffloor(py / FL_H); const bz = ffloor(pz / FL_H);
    let rho: f64 = 0.0;
    const base = i * MAX_NBR;
    let cnt = 0;
    let dz = 0 - 1;
    while (dz <= 1) {
      let dy = 0 - 1;
      while (dy <= 1) {
        let dx = 0 - 1;
        while (dx <= 1) {
          let j = head[bucketOf(bx + dx, by + dy, bz + dz)];
          while (j >= 0) {
            const tj: Transform = trs[j];
            const ex = tj.px - px; const ey = tj.py - py; const ez = tj.pz - pz;
            const r2 = ex * ex + ey * ey + ez * ez;
            if (r2 < FL_H2) {
              const w = FL_H2 - r2;
              rho = rho + POLY6 * w * w * w;
              if (cnt < MAX_NBR) { nbr[base + cnt] = j; cnt = cnt + 1; }
            }
            j = next[j];
          }
          dx = dx + 1;
        }
        dy = dy + 1;
      }
      dz = dz + 1;
    }
    nbrCnt[i] = cnt;
    dens[i] = rho;
    // A pressão NEGATIVA (atração, quando a densidade está abaixo do repouso) é
    // GRAMPEADA em zero. É o padrão em SPH de jogo, e a razão é estrutural:
    //
    // uma partícula nas bordas do fluido tem poucos vizinhos, então sua
    // densidade fica muito abaixo de REST — e a pressão negativa cresce sem
    // limite com esse déficit. Medido com o valor anterior: DUAS partículas
    // isoladas a 0.62 uma da outra geravam força 938, contra gravidade 22.
    // 43x a gravidade, e a configuração explodia sozinha do repouso.
    //
    // Sem atração o líquido não forma gotas no ar, mas ESCOA e empilha
    // corretamente — que é o que esta demo mostra. Coesão de superfície é um
    // termo próprio (tensão superficial), não um efeito colateral de pressão
    // negativa ilimitada.
    let pr = STIFFNESS * (rho - REST_DENSITY);
    if (pr < 0.0) pr = 0.0;
    // TETO DE PRESSÃO. Partículas empilhadas no mesmo canto do tanque chegavam
    // a densidade 40 (o repouso é 4.5) e pressão 43 MIL — medido na demo ao
    // vivo. Essa pressão vira força enorme nas vizinhas, que saem voando, caem
    // e reempilham: é a energia que "aparecia do nada" e mantinha o líquido
    // reativo por tempo indefinido.
    //
    // O teto não altera o líquido normal (a pressão de trabalho fica na casa
    // das centenas); ele só corta o caso degenerado do acúmulo em canto.
    if (pr > MAX_PRESSURE) pr = MAX_PRESSURE;
    pres[i] = pr;
    i = i + 1;
  }
}

/// Força de pressão (empurra do denso pro raro) + viscosidade (iguala
/// velocidades) + gravidade.
function computeForces(trs: Transform[], vx: f64[], vy: f64[], vz: f64[],
                       dens: f64[], pres: f64[], fx: f64[], fy: f64[], fz: f64[],
                       nbr: number[], nbrCnt: number[], n: number): void {
  let i = 0;
  while (i < n) {
    const ti: Transform = trs[i];
    const px = ti.px; const py = ti.py; const pz = ti.pz;
    const pi = pres[i];
    const vix = vx[i]; const viy = vy[i]; const viz = vz[i];
    let ax: f64 = 0.0; let ay: f64 = 0.0; let az: f64 = 0.0;
    // percorre a lista JÁ montada pela densidade — todos dentro de FL_H
    const base = i * MAX_NBR;
    const cnt = nbrCnt[i];
    let k = 0;
    {
      {
        {
          while (k < cnt) {
            const j = nbr[base + k];
            {
              if (j !== i) {
                const tj: Transform = trs[j];
                const ex = px - tj.px; const ey = py - tj.py; const ez = pz - tj.pz;
                const r2 = ex * ex + ey * ey + ez * ez;
                // SOBREPOSIÇÃO EXATA: sem direção (`ex/r` é 0/0), o par ficava
                // INVISÍVEL um ao outro — e o clamp da parede FABRICA esse caso,
                // porque mapeia uma região inteira para o ponto exato do canto.
                // Medido na demo: duas partículas em pos idêntica, densidade 42,
                // v=0, irradiando pres=3000 em quem chegasse perto — uma fonte
                // perpétua de energia. O empurrão determinístico (i<j decide o
                // lado) separa o par; dali em diante a pressão normal age.
                if (r2 <= 0.000001) {
                  const dir: f64 = i < j ? 1.0 : 0.0 - 1.0;
                  ax = ax + dir * 60.0;
                  az = az + dir * 42.0;
                } else if (r2 < FL_H2) {
                  const r = math.sqrt(r2);
                  const dj = dens[j];
                  if (dj > 0.0001) {
                    // PRESSÃO: gradiente do kernel spiky, na direção oposta ao
                    // vizinho. A forma é SIMÉTRICA — `pi/ρi² + pj/ρj²` — e isso
                    // não é detalhe: dividindo só por `ρj` (o que estava aqui),
                    // a força de A sobre B difere da de B sobre A. O par viola a
                    // terceira lei de Newton e CRIA energia do nada.
                    //
                    // Medido com o bug: partindo de velocidade ZERO num líquido
                    // já assentado, a energia subia sozinha para 223 em 60
                    // frames — o líquido fervia sem ninguém tocar nele.
                    const diff = FL_H - r;
                    const di = dens[i];
                    const pterm = SPIKY * diff * diff * (pi / (di * di) + pres[j] / (dj * dj));
                    ax = ax + (ex / r) * pterm;
                    ay = ay + (ey / r) * pterm;
                    az = az + (ez / r) * pterm;
                    // VISCOSIDADE: puxa a velocidade na direção da do vizinho.
                    // Também SIMÉTRICA (`/(di*dj)`), pelo mesmo motivo da
                    // pressão: dividindo só por `dj`, a força de A sobre B
                    // difere da de B sobre A quando as densidades diferem — e
                    // num canto (densidade 40 contra 2.5) a diferença era 16x.
                    // Cada par assim CRIA momento, e a viscosidade, que deveria
                    // ser a força que ACALMA o líquido, era uma fonte de
                    // agitação exatamente onde ele mais precisava assentar.
                    const vterm = VISCOSITY * diff / (di * dj);
                    ax = ax + (vx[j] - vix) * vterm;
                    ay = ay + (vy[j] - viy) * vterm;
                    az = az + (vz[j] - viz) * vterm;
                  }
                }
              }
            }
            k = k + 1;
          }
        }
      }
    }
    // TETO DE ACELERAÇÃO. O termo direcional da força é `(ex/r)`, que DIVIDE
    // pela distância: duas partículas quase sobrepostas produzem uma força
    // enorme (medido: 200 mil, contra uma gravidade de 22). Uma única
    // quase-sobreposição virava um chute que lançava a partícula a y=190 — era
    // isso que "acelerava do nada" na demo, com todas as vizinhas em pres=0.
    //
    // Grampear a MAGNITUDE preserva a direção (as partículas ainda se separam,
    // que é o que o teste do canhão exige) e corta só o pico numérico.
    const a2 = ax * ax + ay * ay + az * az;
    if (a2 > MAX_ACCEL * MAX_ACCEL) {
      const s = MAX_ACCEL / math.sqrt(a2);
      ax = ax * s; ay = ay * s; az = az * s;
    }
    fx[i] = ax;
    fy[i] = ay + GRAVITY;
    fz[i] = az;
    i = i + 1;
  }
}

/// Integra (Euler semi-implícito), aplica o clamp de velocidade e resolve as
/// paredes da caixa.
function integrate(trs: Transform[], vx: f64[], vy: f64[], vz: f64[],
                   fx: f64[], fy: f64[], fz: f64[], dens: f64[], n: number, dt: f64,
                   minX: f64, maxX: f64, minY: f64, minZ: f64, maxZ: f64): void {
  let i = 0;
  while (i < n) {
    let ux = vx[i] + fx[i] * dt;
    let uy = vy[i] + fy[i] * dt;
    let uz = vz[i] + fz[i] * dt;
    // clamp de velocidade: sem isto uma força grande num frame diverge
    const sp2 = ux * ux + uy * uy + uz * uz;
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const sc = MAX_SPEED / math.sqrt(sp2);
      ux = ux * sc; uy = uy * sc; uz = uz * sc;
    }
    // REPOUSO: abaixo deste limiar a partícula é considerada PARADA e a
    // velocidade zera. Sem isto sobra um residual de ~0.3 u/s que não some
    // sozinho — a 47 fps são 0.3 unidades por segundo, METADE do espaçamento
    // entre partículas, e o líquido treme para sempre em vez de repousar.
    //
    // É a mesma ideia do "sleeping" de uma engine de física: abaixo de um piso
    // de movimento, parar de verdade em vez de integrar ruído numérico.
    //
    // O teste vem ANTES de calcular as novas posições — antes ele ficava entre
    // `ny` e `nz`, então ao dormir a partícula ainda andava o passo em X e Y
    // mas não em Z (e `sp2` era declarado duas vezes na mesma função).
    if (sp2 < SLEEP_SPEED2) { ux = 0.0; uy = 0.0; uz = 0.0; }
    const t: Transform = trs[i];
    let nx = t.px + ux * dt;
    let ny = t.py + uy * dt;
    let nz = t.pz + uz * dt;
    // ── PAREDES ───────────────────────────────────────────────────────────
    // A parede ABSORVE a componente normal em vez de REFLETI-LA. Refletir
    // (`u = -u * damp`, o que estava aqui) devolve a partícula para dentro com
    // energia; a pressão do líquido a empurra contra a parede de novo, e o
    // ciclo se repete — ela quica para sempre.
    //
    // Medido: após assentar, as 81 partículas encostadas na parede tinham
    // |v| = 0.193 e as 43 do fundo 0.217, enquanto as 43 do MEIO estavam em
    // ZERO. O líquido inteiro parecia agitado por causa das bordas.
    //
    // Um líquido real não quica na parede do copo: ele escorrega ao longo dela.
    // Zerar só a componente normal preserva o escorregamento tangencial.
    // A partícula é posta um pouco DENTRO da borda, não colada nela. Colar
    // (`nx = minX`) empilha várias no mesmo ponto exato: medido na demo, as dos
    // cantos chegavam a densidade 40 (o repouso é 4.5) e pressão 43 mil — a
    // energia que aparecia "do nada" e mantinha o líquido reativo. A margem
    // varia com o índice para que duas partículas nunca parem na MESMA posição,
    // que é o caso degenerado onde o kernel explode.
    // A componente normal é ZERADA (a parede não devolve energia), mas as
    // TANGENCIAIS são preservadas — é o que deixa a partícula escorregar ao
    // longo da parede em vez de TRAVAR nela.
    //
    // Travar era o problema: num canto, duas ou três normais eram zeradas ao
    // mesmo tempo e a partícula ficava presa no vértice exato. Outras chegavam
    // e paravam no MESMO ponto — medido na demo ao vivo, duas partículas em
    // pos(-2.6, 0.8, 2.2) idêntica, densidade 50 e 16 vizinhos. Esse aglomerado
    // degenerado é a fonte da energia que mantinha o líquido reativo.
    if (nx < minX) { nx = minX; if (ux < 0.0) ux = 0.0; }
    else if (nx > maxX) { nx = maxX; if (ux > 0.0) ux = 0.0; }
    if (nz < minZ) { nz = minZ; if (uz < 0.0) uz = 0.0; }
    else if (nz > maxZ) { nz = maxZ; if (uz > 0.0) uz = 0.0; }
    if (ny < minY) { ny = minY; if (uy < 0.0) uy = 0.0; }
    t.px = nx; t.py = ny; t.pz = nz;
    vx[i] = ux; vy[i] = uy; vz[i] = uz;
    i = i + 1;
  }
}
