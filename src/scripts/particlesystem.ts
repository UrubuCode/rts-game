// ParticleSystem no modelo da Unity — spec docs/superpowers/specs/2026-09-27-particulas-design.md §4.
// Desenha-se como o Skeleton (KIND_RENDERER + drawsSelf): sem KIND novo, sem
// cache novo em Scene. Simula em update(dt), o hook por-frame comum a todo
// Behavior.
import { Behavior, KIND_RENDERER } from "@engine/core/behavior";
import type { InspectorUI } from "@engine/core/inspector_ui";
import { PoolParticulas, criarPool, emitirN, atualizarVidas } from "@engine/particles/sim";
import { avaliarGradiente, avaliarCurva, aplicarVelocidade } from "@engine/particles/curvas";
import { drawParticlesSeguro, drawParticlesTexSeguro, setParticleTex } from "@compat/particles";
import { emJogo } from "@engine/core/modo_jogo";
import { clockDelta } from "@engine/core/clock";
import { frustumParams, inFrustumFast } from "@engine/render/gpu3d";
import { DESC_FLOATS, D_FORMA, D_RAIO, D_ANGULO, D_CAIXA_X, D_CAIXA_Y, D_CAIXA_Z,
         D_VEL_MIN, D_VEL_MAX, D_TAM_MIN, D_TAM_MAX, D_VIDA_MIN, D_VIDA_MAX, D_ROT0, D_COR_R, D_COR_G, D_COR_B,
         P_X, P_Y, P_Z, P_VX, P_VY, P_VZ, P_IDADE, P_VIDA, P_TAM0, P_ROT, P_COR_R, P_COR_G, P_COR_B, P_COR_A, P_FLOATS } from "@engine/particles/desc";

/// Layout do buffer de instância que `drawParticlesSeguro`/`drawParticlesTexSeguro`
/// esperam (Task 1): 9 f32 por partícula — x,y,z,tamanho,rotação,r,g,b,a.
const PART_INSTANCIA_FLOATS: number = 9;

/// Teto do passo de simulação por quadro, em segundos. Mesmo espírito do
/// `DT_MAX` de `engine/core/clock.ts` (0,25 s): um frame que demorou muito
/// (janela minimizada, ponto de parada, GC longo) não deve emitir nem
/// envelhecer um sistema de partículas de uma vez só — sem este teto,
/// `rateOverTime` alto emitiria milhares de partículas de um salto e
/// `atualizarVidas`/`aplicarVelocidade` avançariam a vida/velocidade num
/// passo enorme. `dtArg` é limitado a isto (e a >=0) antes de qualquer uso.
const PS_DT_MAX_PASSO: f64 = 0.25;

/// Passo fixo do `prewarm` (1/30 s) — bem abaixo de `PS_DT_MAX_PASSO`, então
/// nunca é clampado; simula `duration` segundos em passos pequenos e
/// regulares antes do primeiro quadro visível.
const PS_PREWARM_PASSO: f64 = 1.0 / 30.0;

/// Até 4 bursts fixos (Emission) — nada de array dinâmico no caminho por
/// quadro, mesmo espírito de `MAX_GRUPOS` no mixer de áudio.
const MAX_BURSTS: number = 4;

/// Até 4 chaves no gradiente de cor e na curva de tamanho (Task 8, Inspector
/// customizado + serialização — ruling P3). `CHAVE_GRADIENTE_FLOATS`/
/// `CHAVE_CURVA_FLOATS` são a largura de UMA chave em cada array plano
/// (tempo + RGBA, tempo + valor).
const MAX_CHAVES: number = 4;
const CHAVE_GRADIENTE_FLOATS: number = 5;
const CHAVE_CURVA_FLOATS: number = 2;

/// Baldes de `ordenarPorDistancia` (Task 11): resolução do bucket sort
/// back-to-front — 256 faixas de distância² cobrem qualquer emissor real sem
/// banding perceptível (o mesmo compromisso de um z-buffer raso), e o custo
/// de zerar/varrer os dois arrays de baldes (O(baldes), não O(n)) fica
/// irrisório mesmo a n pequeno.
const PS_SORT_BALDES: number = 256;

/// Injeção do editor (Task 9): `assets/pacotes/particulas/particulas_editor.ts`
/// chama isto uma vez, na carga do pacote, pra o núcleo não importar
/// `@editor/api` (evitaria o ciclo `scripts → editor` que o CLAUDE.md proíbe).
/// `id` é o `GameObject.id` do dono; devolve 1 = objeto selecionado no editor.
let consultaSelecao: ((id: number) => boolean) | null = null;
export function definirConsultaSelecao(fn: (id: number) => boolean): void { consultaSelecao = fn; }

/**
 * @componentCategory Efeitos
 * @componentDescription Emissor de partículas no modelo da Unity (Shuriken): forma, taxa/burst, curvas sobre o tempo de vida.
 * @componentKeywords particula particle fogo fumaca faisca chuva efeito vfx
 */
export class ParticleSystem extends Behavior {
  // ── Main ──────────────────────────────────────────────────────────────
  duration: number = 5.0;
  loop: boolean = true;
  playOnAwake: boolean = true;
  prewarm: boolean = false;
  maxParticles: number = 1000;
  gravityModifier: number = 0.0;
  /// "world" (padrão): a posição de render do dono é somada a cada quadro
  /// (a partícula acompanha o objeto). "local": usa a posição relativa já
  /// simulada, sem somar de novo (pensada para um emissor que não deveria
  /// arrastar as partículas já nascidas ao se mover — não implementa o
  /// "bake" contínuo por rotação do transform completo da Unity, fora de
  /// escopo desta entrega).
  simulationSpace: string = "world";
  rateOverTime: number = 10.0;
  startLifetimeMin: number = 1.0; startLifetimeMax: number = 1.0;
  startSpeedMin: number = 1.0; startSpeedMax: number = 1.0;
  startSizeMin: number = 0.1; startSizeMax: number = 0.1;
  startRotation: number = 0.0;
  startColorR: number = 1.0; startColorG: number = 1.0; startColorB: number = 1.0;
  // ── Shape ─────────────────────────────────────────────────────────────
  forma: number = 0; raio: number = 1.0; anguloCone: number = 25.0;
  caixaX: number = 1.0; caixaY: number = 1.0; caixaZ: number = 1.0;
  // ── Over lifetime (vento constante + arrasto) ────────────────────────
  ventoX: number = 0.0; ventoY: number = 0.0; ventoZ: number = 0.0; arrasto: number = 0.0;
  // ── Renderer ──────────────────────────────────────────────────────────
  modo: number = 0; sort: number = 0;
  /// Id de textura (0 = sem textura, disco procedural; Task 1 `drawParticlesTex`).
  textura: number = 0;

  /// Bursts (Emission): até MAX_BURSTS pares (tempo desde o início do ciclo,
  /// quantidade), num Float64Array fixo. Preenchidos por `setBurst`, lidos
  /// pelo Inspector customizado — não é campo automático (não é
  /// number/boolean/string simples).
  private bursts: Float64Array = new Float64Array(MAX_BURSTS * 2);
  private nBursts: number = 0;
  /// 1 = este burst já disparou na volta atual do loop; zerado em `play()`
  /// e a cada wrap do loop (garante "1x por ciclo", carried item (a)).
  private burstDisparado: Uint8Array = new Uint8Array(MAX_BURSTS);

  /// Gradiente de cor (2-4 chaves RGBA) e curva de tamanho (2-4 chaves)
  /// sobre o tempo de vida normalizado — Inspector customizado (spec §4.3).
  /// Arrays já alocados para MAX_CHAVES (as chaves além de `nChaves*` são
  /// lixo não usado por `avaliarGradiente`/`avaliarCurva`, que só leem até
  /// `nChaves`); `setChaveGradiente`/`setChaveTamanho` são o único jeito de
  /// escrever aqui (Task 8: campo privado, não é number/boolean/string
  /// simples — não entra na reflexão automática, precisa de `toData()`
  /// próprio, ver ruling P3 no fim do arquivo).
  private gradiente: Float64Array = new Float64Array([
    0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  ]);
  private nChavesGradiente: number = 2;
  private curvaTamanho: Float64Array = new Float64Array([0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
  private nChavesTamanho: number = 2;

  /// Cabeçalhos do Inspector cacheados por contagem (ver `rotuloBursts`
  /// etc., no fim do arquivo) — nada de string nova por quadro.
  private rotBurstsDe: number = 0 - 1; private rotBurstsCache: string = "";
  private rotGradDe: number = 0 - 1; private rotGradCache: string = "";
  private rotTamDe: number = 0 - 1; private rotTamCache: string = "";

  private pool: PoolParticulas | null = null;
  private descBuf: Float64Array = new Float64Array(DESC_FLOATS);
  private saidaBuf: Float32Array = new Float32Array(0);
  /// Buffers reaproveitados por quadro — nenhuma alocação em update()/drawSelf().
  private ventoBuf: Float64Array = new Float64Array(3);
  private corBuf: Float64Array = new Float64Array(4);
  /// `sort` (back-to-front, só modo alfa): distância² à câmera por partícula
  /// desenhada, índice de ordenação e a cópia final reordenada do buffer de
  /// instância — os três crescem junto com `saidaBuf` (nunca encolhem),
  /// mesmo padrão de `bufT`/`bufC` de `scenedraw.ts`. `camBuf` é o mesmo
  /// formato de `frustumParams` (`scenedraw.ts:fParams`): 9 números, só os
  /// 3 primeiros (posição da câmera) importam aqui.
  private distBuf: Float64Array = new Float64Array(0);
  private ordemBuf: Int32Array = new Int32Array(0);
  private saidaOrdenadaBuf: Float32Array = new Float32Array(0);
  private camBuf: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  /// Balde (bucket sort) de `ordenarPorDistancia` (Task 11 — a inserção O(n²)
  /// original estourava o orçamento de 1 ms a 10k partículas por ~3000x, ver
  /// o comentário acima do método): `itemBalde` cresce com `n`, como
  /// `ordemBuf`; `baldeContagem`/`baldeOffset` têm tamanho FIXO
  /// (`PS_SORT_BALDES`), zerados a cada chamada (custo O(baldes), irrisório
  /// perto de O(n)) — nunca realocados.
  private itemBalde: Int32Array = new Int32Array(0);
  private baldeContagem: Int32Array = new Int32Array(PS_SORT_BALDES);
  private baldeOffset: Int32Array = new Int32Array(PS_SORT_BALDES);
  /// Saída reaproveitada de `bboxAtual()` (Task 10): [minx,miny,minz,maxx,maxy,maxz].
  /// Não é caminho por quadro (só o comando WS `particulas <obj> info` chama),
  /// então tem sua própria passada leve sobre o pool em vez de acumular durante
  /// `drawSelf` (que pode nunca ter rodado no quadro, fora do frustum ou win=0).
  private bboxBuf: Float64Array = new Float64Array(6);
  private acumulado: number = 0.0;
  private tocando: number = 0;
  private pausado: number = 0;
  /// Estado da SIMULAÇÃO (tempo dentro do ciclo atual), não configuração —
  /// nunca gravado na cena (spec §5: "nunca grava o estado simulado"), só
  /// lido pelo comando WS/inspetor/teste. Público (não `private`) porque o
  /// teste/Inspector precisam ler; `@nonSerialized` é o que impede a
  /// gravação, não a visibilidade do campo.
  /** @nonSerialized */
  time: number = 0.0;
  /// Task 9: setado pelo `PlayMode` ao copiar o objeto pro Play (hoje
  /// `scene.update()`/`updateAll` só roda dentro do Play, chamado por
  /// `sim_step.ts` — então isto é uma segunda trava, não a única: mesmo que
  /// algum caminho futuro chame `update()` fora do Play, `emPlay` continua
  /// protegendo). Estado de execução, nunca gravado na cena — mesmo motivo
  /// de `time` acima.
  /** @nonSerialized */
  emPlay: boolean = false;
  get particleCount(): number { return this.pool === null ? 0 : this.pool.vivas; }

  /// Bbox local (sem somar a posição do dono) das partículas vivas — usado
  /// pelo comando WS `particulas <obj> info` (Task 10) para a IA verificar o
  /// efeito sem a janela. Sem partícula viva, devolve tudo 0. Buffer
  /// reaproveitado (`bboxBuf`), sem alocar por chamada.
  bboxAtual(): Float64Array {
    const b = this.bboxBuf;
    const pool = this.pool;
    if (pool === null || pool.vivas === 0) {
      b[0] = 0.0; b[1] = 0.0; b[2] = 0.0; b[3] = 0.0; b[4] = 0.0; b[5] = 0.0;
      return b;
    }
    let minX: f64 = 1e30; let minY: f64 = 1e30; let minZ: f64 = 1e30;
    let maxX: f64 = -1e30; let maxY: f64 = -1e30; let maxZ: f64 = -1e30;
    let slot = 0;
    while (slot < pool.max) {
      const k = slot * P_FLOATS;
      if (pool.dados[k + P_VIDA] >= 0.0) {
        const x = pool.dados[k + P_X]; const y = pool.dados[k + P_Y]; const z = pool.dados[k + P_Z];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      slot = slot + 1;
    }
    b[0] = minX; b[1] = minY; b[2] = minZ; b[3] = maxX; b[4] = maxY; b[5] = maxZ;
    return b;
  }

  typeName(): string { return "ParticleSystem"; }
  kind(): number { return KIND_RENDERER; }
  drawsSelf(): number { return 1; }

  private garantirPool(): PoolParticulas {
    if (this.pool === null || this.pool.max !== this.maxParticles) this.pool = criarPool(this.maxParticles);
    return this.pool as PoolParticulas;
  }
  private montarDesc(): void {
    const d = this.descBuf;
    d[D_FORMA] = this.forma; d[D_RAIO] = this.raio; d[D_ANGULO] = this.anguloCone;
    d[D_CAIXA_X] = this.caixaX; d[D_CAIXA_Y] = this.caixaY; d[D_CAIXA_Z] = this.caixaZ;
    d[D_VEL_MIN] = this.startSpeedMin; d[D_VEL_MAX] = this.startSpeedMax;
    d[D_TAM_MIN] = this.startSizeMin; d[D_TAM_MAX] = this.startSizeMax;
    d[D_VIDA_MIN] = this.startLifetimeMin; d[D_VIDA_MAX] = this.startLifetimeMax;
    d[D_ROT0] = this.startRotation;
    d[D_COR_R] = this.startColorR; d[D_COR_G] = this.startColorG; d[D_COR_B] = this.startColorB;
  }

  /// Define um dos até MAX_BURSTS disparos (tempo em segundos desde o início
  /// do ciclo, quantidade de partículas). `indice` fora de [0,MAX_BURSTS) é
  /// ignorado. Chamadas preenchem `nBursts` sequencialmente a partir do
  /// maior índice já definido — o Inspector customizado preenche em ordem.
  setBurst(indice: number, tempo: number, quantidade: number): void {
    if (indice < 0 || indice >= MAX_BURSTS) return;
    this.bursts[indice * 2] = tempo; this.bursts[indice * 2 + 1] = quantidade;
    if (indice + 1 > this.nBursts) this.nBursts = indice + 1;
  }
  burstCount(): number { return this.nBursts; }
  burstTime(indice: number): f64 { return indice >= 0 && indice < this.nBursts ? this.bursts[indice * 2] : 0.0; }
  burstAmount(indice: number): f64 { return indice >= 0 && indice < this.nBursts ? this.bursts[indice * 2 + 1] : 0.0; }

  // ── Gradiente de cor / curva de tamanho (Task 8: Inspector customizado) ──
  //
  // `valores` chega como Float64Array (não escalares soltos: uma chave de
  // gradiente é tempo+4 componentes de cor, 5 números — acima do limite de 4
  // parâmetros por função do RTS, regra "Custo por quadro" do CLAUDE.md,
  // mesma solução do `desc` de emissão). `indice` fora de [0, MAX_CHAVES) é
  // ignorado (devolve false); preencher um índice >= nChaves* estende a
  // contagem. Depois de gravar, reordena por tempo crescente (inserção,
  // igual a `KeyframeAnimator.key`) — uma chave nova ou uma chave existente
  // com o tempo movido sempre acaba na posição certa.
  nChavesGradienteCount(): number { return this.nChavesGradiente; }
  chaveGradienteTempo(indice: number): f64 { return indice >= 0 && indice < this.nChavesGradiente ? this.gradiente[indice * CHAVE_GRADIENTE_FLOATS] : 0.0; }
  /// Escreve RGBA da chave `indice` em `out` (4 posições); no-op se fora de alcance.
  chaveGradienteCor(indice: number, out: Float64Array): void {
    if (indice < 0 || indice >= this.nChavesGradiente) return;
    const k = indice * CHAVE_GRADIENTE_FLOATS;
    out[0] = this.gradiente[k + 1]; out[1] = this.gradiente[k + 2]; out[2] = this.gradiente[k + 3]; out[3] = this.gradiente[k + 4];
  }
  /// `valores`: [tempo, r, g, b, a]. Devolve false se `indice` estiver fora de [0, MAX_CHAVES).
  setChaveGradiente(indice: number, valores: Float64Array): boolean {
    if (indice < 0 || indice >= MAX_CHAVES) return false;
    const k = indice * CHAVE_GRADIENTE_FLOATS;
    this.gradiente[k] = valores[0]; this.gradiente[k + 1] = valores[1]; this.gradiente[k + 2] = valores[2];
    this.gradiente[k + 3] = valores[3]; this.gradiente[k + 4] = valores[4];
    if (indice + 1 > this.nChavesGradiente) this.nChavesGradiente = indice + 1;
    this.ordenarChavesGradiente();
    return true;
  }
  private ordenarChavesGradiente(): void {
    let a = 1;
    while (a < this.nChavesGradiente) {
      let b = a;
      while (b > 0 && this.gradiente[(b - 1) * CHAVE_GRADIENTE_FLOATS] > this.gradiente[b * CHAVE_GRADIENTE_FLOATS]) {
        let f = 0;
        while (f < CHAVE_GRADIENTE_FLOATS) {
          const tmp = this.gradiente[(b - 1) * CHAVE_GRADIENTE_FLOATS + f];
          this.gradiente[(b - 1) * CHAVE_GRADIENTE_FLOATS + f] = this.gradiente[b * CHAVE_GRADIENTE_FLOATS + f];
          this.gradiente[b * CHAVE_GRADIENTE_FLOATS + f] = tmp;
          f = f + 1;
        }
        b = b - 1;
      }
      a = a + 1;
    }
  }
  nChavesTamanhoCount(): number { return this.nChavesTamanho; }
  chaveTamanhoTempo(indice: number): f64 { return indice >= 0 && indice < this.nChavesTamanho ? this.curvaTamanho[indice * CHAVE_CURVA_FLOATS] : 0.0; }
  chaveTamanhoValor(indice: number): f64 { return indice >= 0 && indice < this.nChavesTamanho ? this.curvaTamanho[indice * CHAVE_CURVA_FLOATS + 1] : 0.0; }
  /// `valores`: [tempo, valor]. Devolve false se `indice` estiver fora de [0, MAX_CHAVES).
  setChaveTamanho(indice: number, valores: Float64Array): boolean {
    if (indice < 0 || indice >= MAX_CHAVES) return false;
    const k = indice * CHAVE_CURVA_FLOATS;
    this.curvaTamanho[k] = valores[0]; this.curvaTamanho[k + 1] = valores[1];
    if (indice + 1 > this.nChavesTamanho) this.nChavesTamanho = indice + 1;
    this.ordenarChavesTamanho();
    return true;
  }
  private ordenarChavesTamanho(): void {
    let a = 1;
    while (a < this.nChavesTamanho) {
      let b = a;
      while (b > 0 && this.curvaTamanho[(b - 1) * CHAVE_CURVA_FLOATS] > this.curvaTamanho[b * CHAVE_CURVA_FLOATS]) {
        let f = 0;
        while (f < CHAVE_CURVA_FLOATS) {
          const tmp = this.curvaTamanho[(b - 1) * CHAVE_CURVA_FLOATS + f];
          this.curvaTamanho[(b - 1) * CHAVE_CURVA_FLOATS + f] = this.curvaTamanho[b * CHAVE_CURVA_FLOATS + f];
          this.curvaTamanho[b * CHAVE_CURVA_FLOATS + f] = tmp;
          f = f + 1;
        }
        b = b - 1;
      }
      a = a + 1;
    }
  }

  /// `prewarm`: simula `duration` segundos ANTES do primeiro quadro visível
  /// (a fogueira já ardendo, não começando do zero) — passos fixos de
  /// `PS_PREWARM_PASSO` (1/30 s, bem abaixo do teto de dt), cada um
  /// chamando `update()` de verdade (mesma emissão/burst/vida/vento que um
  /// quadro normal teria feito, só que antes do primeiro desenho). Não
  /// aloca: `update()` já é zero-alocação (sonda de GC cobre este caminho).
  /// `guard` é a mesma rede de segurança contra `duration` degenerado que
  /// `update()` usa para o wrap do loop.
  play(): void {
    this.tocando = 1; this.pausado = 0; this.time = 0.0; this.acumulado = 0.0;
    let i = 0; while (i < MAX_BURSTS) { this.burstDisparado[i] = 0; i = i + 1; }
    if (this.prewarm && this.duration > 0.0) {
      let restante = this.duration;
      let guard = 0;
      while (restante > 0.0 && guard < 100000) {
        const passo = PS_PREWARM_PASSO < restante ? PS_PREWARM_PASSO : restante;
        this.update(passo);
        restante = restante - passo;
        guard = guard + 1;
      }
    }
  }
  stop(clear: boolean): void { this.tocando = 0; if (clear) this.clear(); }
  pause(): void { this.pausado = 1; }
  unPause(): void { this.pausado = 0; }
  isPlaying(): boolean { return this.tocando !== 0 && this.pausado === 0; }
  emit(n: number): void { this.montarDesc(); emitirN(this.garantirPool(), this.descBuf, n); }

  /// Zera o pool NA HORA: marca todo slot como livre (`P_VIDA = -1`, o mesmo
  /// marcador de `sim.ts`) e reconstrói a pilha de livres cheia. Só zerar
  /// `vivas`/`nLivres` sem marcar `P_VIDA=-1` deixaria slots "meio-vivos":
  /// a próxima `atualizarVidas`/`aplicarVelocidade` ainda os processaria (elas
  /// varrem por `P_VIDA>=0`, não por `vivas`) e tentaria reciclá-los de novo,
  /// duplicando entradas na pilha de livres — o "sem partícula sobrando no
  /// original" do ciclo Play/Stop depende de zerar por completo aqui.
  clear(): void {
    const p = this.garantirPool();
    let i = 0;
    while (i < p.max) { p.dados[i * P_FLOATS + P_VIDA] = 0.0 - 1.0; p.livres[i] = p.max - 1 - i; i = i + 1; }
    p.vivas = 0; p.nLivres = p.max;
  }

  /// `playOnAwake` só vale DENTRO do Play/jogo (`emJogo()`) — carregar a
  /// cena no editor ou arrastar o componente num objeto não deve começar a
  /// simular sozinho (spec §5, "nunca simula fora do Play sem seleção" — a
  /// prévia de edição selecionada é um caminho separado, do pacote de
  /// editor, que chama `play()` explicitamente).
  mount(): void { if (this.playOnAwake && emJogo() !== 0) this.play(); }

  /// Avança um trecho da simulação que não cruza a borda do ciclo
  /// (`duration`): emissão por taxa (acumulador fracionário, resto
  /// preservado entre chamadas — carried item (b)) + bursts cujo tempo cai
  /// em `[tempoAntes, tempoAntes+passo)`. Cada burst dispara no máximo 1x por
  /// ciclo (`burstDisparado`), mesmo que `passo` seja grande o bastante pra
  /// pular por cima do instante do burst num só quadro — carried item (a).
  /// 2 parâmetros (pool e passo; desc/bursts/acumulado ficam em campos).
  private avancarCiclo(pool: PoolParticulas, passo: f64): void {
    const tempoAntes = this.time;
    this.time = this.time + passo;
    this.acumulado = this.acumulado + passo * this.rateOverTime;
    const inteiras = Math.floor(this.acumulado);
    if (inteiras > 0.0) { emitirN(pool, this.descBuf, inteiras); this.acumulado = this.acumulado - inteiras; }
    let i = 0;
    while (i < this.nBursts) {
      const bt = this.bursts[i * 2];
      if (this.burstDisparado[i] === 0 && bt >= tempoAntes && bt < this.time) {
        emitirN(pool, this.descBuf, this.bursts[i * 2 + 1]);
        this.burstDisparado[i] = 1;
      }
      i = i + 1;
    }
  }

  /// Simulação: emissão por taxa/burst, envelhecimento, vento/arrasto,
  /// integração de posição. 1 parâmetro (`dtArg`; pool/desc/buffers ficam em
  /// campos, reaproveitados — nenhuma alocação aqui, carried item de
  /// "Custo por quadro").
  ///
  /// `dtArg` é limitado a `PS_DT_MAX_PASSO` (e a >=0) antes de qualquer uso —
  /// carried item (c): um hitch de 2 s não emite nem envelhece um passo de
  /// 2 s de uma vez.
  update(dtArg: f64): void {
    // Task 9: fora do Play, só simula se o editor disser que este objeto
    // está selecionado (prévia de edição) — economiza CPU com o efeito
    // parado/oculto, como a Unity. `emJogo()!==0` cobre o Play de verdade
    // (jogo exportado E o Play do editor — `PlayMode.play()` chama
    // `audioEntrarJogo()`/`entrarJogo()`, o mesmo flag que `mount()` já usa
    // acima para `playOnAwake`): a cópia do Play não depende de ninguém
    // setar `emPlay` nela. `emPlay` continua existindo pra quem quiser
    // simular incondicionalmente sem esse flag global (e é o que o teste
    // isolado usa pra exercitar o caminho "dentro do Play" sem depender de
    // `entrarJogo()`). `consultaSelecao === null` (nenhum pacote de editor
    // carregado: teste isolado, jogo exportado sem o pacote) não bloqueia
    // nada, pro comportamento de antes desta task continuar valendo nesses
    // casos.
    if (!this.emPlay && emJogo() === 0 && consultaSelecao !== null) {
      const dono = this.owner === null ? 0 - 1 : this.owner.id;
      if (!consultaSelecao(dono)) return;
    }
    if (this.pausado !== 0) return;
    const dt: f64 = dtArg > PS_DT_MAX_PASSO ? PS_DT_MAX_PASSO : (dtArg < 0.0 ? 0.0 : dtArg);
    const pool = this.garantirPool();
    if (this.tocando !== 0) {
      this.montarDesc();
      if (this.loop && this.duration > 0.0) {
        // Sub-passos que não cruzam a borda do ciclo: bursts e o wrap ficam
        // corretos mesmo se `dt` (já limitado) ainda for maior que
        // `duration` (loop bem curto). `guard` é só uma rede de segurança
        // contra configuração degenerada (duration ínfimo por erro de
        // arredondamento) — nunca disparado em uso normal.
        let restante = dt;
        let guard = 0;
        while (restante > 1e-12 && guard < 64) {
          guard = guard + 1;
          let paraFim = this.duration - this.time;
          if (paraFim < 0.0) paraFim = 0.0;
          const passo = paraFim < restante ? paraFim : restante;
          this.avancarCiclo(pool, passo);
          restante = restante - passo;
          if (this.time >= this.duration - 1e-9) {
            this.time = 0.0;
            let i = 0; while (i < MAX_BURSTS) { this.burstDisparado[i] = 0; i = i + 1; }
          }
        }
      } else {
        this.avancarCiclo(pool, dt);
        if (!this.loop && this.time >= this.duration) this.tocando = 0;
      }
    }
    atualizarVidas(pool, dt);
    const vento = this.ventoBuf;
    vento[0] = this.ventoX; vento[1] = this.ventoY - this.gravityModifier; vento[2] = this.ventoZ;
    aplicarVelocidade(pool, vento, this.arrasto, dt);
    let slot = 0;
    while (slot < pool.max) {
      const k = slot * P_FLOATS;
      if (pool.dados[k + P_VIDA] >= 0.0) {
        pool.dados[k + P_X] = pool.dados[k + P_X] + pool.dados[k + P_VX] * dt;
        pool.dados[k + P_Y] = pool.dados[k + P_Y] + pool.dados[k + P_VY] * dt;
        pool.dados[k + P_Z] = pool.dados[k + P_Z] + pool.dados[k + P_VZ] * dt;
      }
      slot = slot + 1;
    }
  }

  /// Raio que envolve as partículas vivas, usado só pelo corte de `drawSelf`
  /// (Task 6): o maior entre o raio/caixa do FORMATO do emissor (onde as
  /// partículas NASCEM) e o alcance máximo que uma já viva pode ter percorrido
  /// (`startSpeedMax * startLifetimeMax`, o pior caso sem vento/arrasto —
  /// margem, não medida exata). Recomputado a cada `drawSelf` (barato, sem
  /// buffer próprio) em vez de cacheado, porque os campos que o formam mudam
  /// pelo Inspector fora de `montarDesc()`.
  private limiteRaio(): f64 {
    let base = this.raio;
    if (this.caixaX > base) base = this.caixaX;
    if (this.caixaY > base) base = this.caixaY;
    if (this.caixaZ > base) base = this.caixaZ;
    const speed = this.startSpeedMax > 0.0 ? this.startSpeedMax : 0.0;
    const vida = this.startLifetimeMax > 0.0 ? this.startLifetimeMax : 0.0;
    return base + speed * vida;
  }

  /// Preenche o buffer de instância e desenha. 3 parâmetros (win, pos do
  /// dono, tint — a assinatura fixa de drawsSelf; simulationSpace="world" soma
  /// `pos` a cada quadro, "local" usa a posição relativa já simulada).
  drawSelf(win: number, pos: Float64Array, tint: number): number {
    const pool = this.pool;
    if (pool === null || pool.vivas === 0) return 0;
    // Corte por frustum ANTES de montar o buffer de instância — barato (uma
    // esfera contra o frustum já preparado pelo laço de render) e não toca em
    // `saidaBuf` nem chama o desenho nativo quando o emissor está fora. A
    // simulação (`update`) continua de qualquer forma: é outro método, chamado
    // à parte pelo laço de scripts — cortar o DESENHO nunca "perde" posição.
    if (inFrustumFast(pos[0], pos[1], pos[2], this.limiteRaio()) === 0) return 0;
    if (this.saidaBuf.length < pool.max * PART_INSTANCIA_FLOATS) this.saidaBuf = new Float32Array(pool.max * PART_INSTANCIA_FLOATS);
    const out = this.saidaBuf; const cor = this.corBuf;
    const somaPos = this.simulationSpace !== "local";
    let n = 0; let slot = 0;
    while (slot < pool.max) {
      const k = slot * P_FLOATS;
      if (pool.dados[k + P_VIDA] >= 0.0) {
        // vida<=0 (sorteada em 0, min=max=0): sem isto, idade/vida seria
        // Infinity/NaN — trata como "no fim da vida" (t=1), coerente com o
        // marcador de `sim.ts` (nasce e morre no mesmo quadro).
        const vidaK = pool.dados[k + P_VIDA];
        const t = vidaK > 0.0 ? pool.dados[k + P_IDADE] / vidaK : 1.0;
        avaliarGradiente(this.gradiente, this.nChavesGradiente, t, cor);
        const escala = avaliarCurva(this.curvaTamanho, this.nChavesTamanho, t);
        const o = n * PART_INSTANCIA_FLOATS;
        out[o] = (somaPos ? pos[0] : 0.0) + pool.dados[k + P_X];
        out[o + 1] = (somaPos ? pos[1] : 0.0) + pool.dados[k + P_Y];
        out[o + 2] = (somaPos ? pos[2] : 0.0) + pool.dados[k + P_Z];
        out[o + 3] = pool.dados[k + P_TAM0] * escala; out[o + 4] = pool.dados[k + P_ROT];
        out[o + 5] = cor[0]; out[o + 6] = cor[1]; out[o + 7] = cor[2]; out[o + 8] = cor[3];
        n = n + 1;
      }
      slot = slot + 1;
    }
    if (n === 0) return 0;
    // `sort` (back-to-front): só faz sentido no modo alfa (o aditivo é
    // comutativo — soma pura, a ordem não muda o resultado). Bucket sort
    // sobre um índice (Task 11: O(n + PS_SORT_BALDES), sem alocar — a
    // primeira versão era uma inserção O(n²) que media ~3,25 s/quadro a 10k
    // partículas, ~3250x o orçamento de 1 ms; ver o comentário do método).
    const buf = (this.sort !== 0 && this.modo === 0 && n > 1) ? this.ordenarPorDistancia(out, n) : out;
    if (this.textura > 0) { setParticleTex(this.textura); return drawParticlesTexSeguro(win, buf, n, this.modo); }
    return drawParticlesSeguro(win, buf, n, this.modo);
  }

  /// Reordena as `n` primeiras partículas de `buf` (formato de instância, 9
  /// floats cada) da mais distante para a mais próxima da câmera
  /// (back-to-front, pintor's algorithm) e devolve a cópia ordenada — nunca
  /// muta `buf` (que é `saidaBuf`, reaproveitado pelo próximo `drawSelf`).
  /// 2 parâmetros (buf, n; câmera/buffers auxiliares ficam em campos).
  ///
  /// Bucket sort por distância² quantizada em `PS_SORT_BALDES` faixas
  /// (Task 11 — a versão original era uma inserção O(n²): estável e correta
  /// para os N pequenos com que foi validada, mas ~3,25 s/quadro a 10 000
  /// partículas vivas, ~3250x o orçamento de 1 ms do bench; um bucket sort é
  /// O(n + PS_SORT_BALDES), sem alocar, e não depende de N — só perde exatidão
  /// DENTRO de um balde (duas partículas na mesma faixa de distância podem
  /// desenhar em qualquer ordem entre si), imperceptível com 256 faixas.
  private ordenarPorDistancia(buf: Float32Array, n: number): Float32Array {
    if (this.distBuf.length < n) this.distBuf = new Float64Array(n);
    if (this.ordemBuf.length < n) this.ordemBuf = new Int32Array(n);
    if (this.itemBalde.length < n) this.itemBalde = new Int32Array(n);
    if (this.saidaOrdenadaBuf.length < buf.length) this.saidaOrdenadaBuf = new Float32Array(buf.length);
    frustumParams(this.camBuf);
    const camX = this.camBuf[0]; const camY = this.camBuf[1]; const camZ = this.camBuf[2];
    const dist = this.distBuf;
    let minD: f64 = 1e30; let maxD: f64 = -1e30;
    let i = 0;
    while (i < n) {
      const o = i * PART_INSTANCIA_FLOATS;
      const dx = buf[o] - camX; const dy = buf[o + 1] - camY; const dz = buf[o + 2] - camZ;
      const d = dx * dx + dy * dy + dz * dz;
      dist[i] = d;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
      i = i + 1;
    }
    // Quantiza cada distância em [0, PS_SORT_BALDES) (0 = mais perto). Faixa
    // degenerada (todas as partículas à mesma distância, ou n<=1 já tratado
    // pelo chamador): `inv=0` joga tudo no balde 0, sem dividir por zero.
    const faixa = maxD - minD;
    const inv: f64 = faixa > 1e-12 ? (PS_SORT_BALDES - 1) / faixa : 0.0;
    const balde = this.itemBalde;
    const contagem = this.baldeContagem;
    let c = 0;
    while (c < PS_SORT_BALDES) { contagem[c] = 0; c = c + 1; }
    i = 0;
    while (i < n) {
      let b = ((dist[i] - minD) * inv) | 0;
      if (b < 0) b = 0; else if (b >= PS_SORT_BALDES) b = PS_SORT_BALDES - 1;
      balde[i] = b;
      contagem[b] = contagem[b] + 1;
      i = i + 1;
    }
    // Contagem cumulativa em ordem DECRESCENTE de balde (o mais distante,
    // PS_SORT_BALDES-1, ocupa as primeiras posições de `ordem` — farthest
    // primeiro, o mesmo sentido do pintor's algorithm de antes).
    const offset = this.baldeOffset;
    let acc = 0;
    let b2 = PS_SORT_BALDES - 1;
    while (b2 >= 0) { offset[b2] = acc; acc = acc + contagem[b2]; b2 = b2 - 1; }
    const ordem = this.ordemBuf;
    i = 0;
    while (i < n) {
      const b = balde[i];
      ordem[offset[b]] = i;
      offset[b] = offset[b] + 1;
      i = i + 1;
    }
    const saida = this.saidaOrdenadaBuf;
    let k = 0;
    while (k < n) {
      const src = ordem[k] * PART_INSTANCIA_FLOATS; const dst = k * PART_INSTANCIA_FLOATS;
      let f = 0;
      while (f < PART_INSTANCIA_FLOATS) { saida[dst + f] = buf[src + f]; f = f + 1; }
      k = k + 1;
    }
    return saida;
  }

  // ── Serialização (ruling P3 do lote B) ───────────────────────────────
  //
  // `bursts`/`gradiente`/`curvaTamanho` são campos PRIVADOS com dados não
  // escalares (arrays), então a reflexão automática do gerador
  // (tools/generate-components.mjs) não os alcança — ela só serializa
  // number/boolean/string públicos. Overrideando `toData()` aqui, o
  // gerador detecta `customSerialization` e passa a devolver os campos
  // escalares automáticos por `legacyFields()`/`componentFields` (o mesmo
  // mecanismo do `spin.sy`/`AudioSource` legado — CLAUDE.md "Salvar,
  // duplicar e Rodar devem usar componentToData"); só os arrays custom
  // ficam por nossa conta aqui. Salva só até `nChaves*`/`nBursts` (o resto
  // do array fixo é lixo não usado por `avaliarGradiente`/`avaliarCurva`).
  // `time`/`tocando`/`pausado`/`acumulado`/`burstDisparado` (estado de
  // SIMULAÇÃO) nunca aparecem aqui — nem os automáticos (are `@nonSerialized`
  // ou privados) nem os manuais.
  toData(): any {
    const bursts: number[] = [];
    let bi = 0;
    while (bi < this.nBursts * 2) { bursts.push(this.bursts[bi]); bi = bi + 1; }
    const gradiente: number[] = [];
    let gi = 0;
    while (gi < this.nChavesGradiente * CHAVE_GRADIENTE_FLOATS) { gradiente.push(this.gradiente[gi]); gi = gi + 1; }
    const curvaTamanho: number[] = [];
    let ci = 0;
    while (ci < this.nChavesTamanho * CHAVE_CURVA_FLOATS) { curvaTamanho.push(this.curvaTamanho[ci]); ci = ci + 1; }
    return { type: "particleSystem", bursts: bursts, gradiente: gradiente, curvaTamanho: curvaTamanho };
  }

  /// Recria a partir do descritor de `toData()` + `componentFields`
  /// (restaurados por `restoreLegacyFields`, chamado por `recreateBehavior`
  /// logo depois desta fábrica — spec: round-trip salvar/carregar, cópia do
  /// Play e duplicar, todos por `componentToData`/`recreateBehavior`).
  static fromData(sd: any): ParticleSystem {
    const p = new ParticleSystem();
    const bursts = sd.bursts;
    if (Array.isArray(bursts)) {
      let bi = 0;
      while (bi < bursts.length && bi < MAX_BURSTS * 2) { p.bursts[bi] = bursts[bi]; bi = bi + 1; }
      p.nBursts = Math.min(MAX_BURSTS, Math.floor(bursts.length / 2));
    }
    const gradiente = sd.gradiente;
    if (Array.isArray(gradiente)) {
      let gi = 0;
      while (gi < gradiente.length && gi < MAX_CHAVES * CHAVE_GRADIENTE_FLOATS) { p.gradiente[gi] = gradiente[gi]; gi = gi + 1; }
      p.nChavesGradiente = Math.min(MAX_CHAVES, Math.floor(gradiente.length / CHAVE_GRADIENTE_FLOATS));
    }
    const curvaTamanho = sd.curvaTamanho;
    if (Array.isArray(curvaTamanho)) {
      let ci = 0;
      while (ci < curvaTamanho.length && ci < MAX_CHAVES * CHAVE_CURVA_FLOATS) { p.curvaTamanho[ci] = curvaTamanho[ci]; ci = ci + 1; }
      p.nChavesTamanho = Math.min(MAX_CHAVES, Math.floor(curvaTamanho.length / CHAVE_CURVA_FLOATS));
    }
    return p;
  }

  // ── Inspector customizado (Task 8) ────────────────────────────────────
  //
  // Campos escalares automáticos via `ui.field(nome)` (mesmo controle que a
  // lista automática desenharia, só que agrupados/condicionados); os três
  // arrays (bursts, gradiente, curva de tamanho) com um editor próprio —
  // slider de tempo + cor/valor por chave, "+ chave"/"+ burst" até MAX_CHAVES/
  // MAX_BURSTS. `tmp*` são rascunhos de módulo (Float64Array), reaproveitados
  // entre chamadas — nenhuma alocação por frame de Inspector aberto.
  onInspectorGUI(ui: InspectorUI): void {
    ui.label("Main");
    ui.field("duration"); ui.field("loop"); ui.field("playOnAwake"); ui.field("prewarm");
    ui.field("maxParticles"); ui.field("gravityModifier"); ui.field("simulationSpace");
    ui.field("rateOverTime");
    ui.field("startLifetimeMin"); ui.field("startLifetimeMax");
    ui.field("startSpeedMin"); ui.field("startSpeedMax");
    ui.field("startSizeMin"); ui.field("startSizeMax");
    ui.field("startRotation");
    ui.field("startColorR"); ui.field("startColorG"); ui.field("startColorB");

    ui.label("Shape (0 ponto, 1 esfera, 2 cone, 3 caixa)");
    ui.field("forma");
    if (this.forma === 1) ui.field("raio");
    else if (this.forma === 2) { ui.field("raio"); ui.field("anguloCone"); }
    else if (this.forma === 3) { ui.field("caixaX"); ui.field("caixaY"); ui.field("caixaZ"); }

    ui.label("Over lifetime");
    ui.field("ventoX"); ui.field("ventoY"); ui.field("ventoZ"); ui.field("arrasto");

    ui.label("Renderer (0 alfa, 1 aditivo)");
    ui.field("modo"); ui.field("sort"); ui.field("textura");

    ui.label(this.rotuloBursts());
    let bi = 0;
    while (bi < this.nBursts) {
      const t = ui.slider(ROT_BURST_TEMPO[bi], this.burstTime(bi), 0.0, this.duration > 0.0 ? this.duration : 1.0);
      const q = ui.slider(ROT_BURST_QTD[bi], this.burstAmount(bi), 0.0, this.maxParticles);
      if (t !== this.burstTime(bi) || q !== this.burstAmount(bi)) this.setBurst(bi, t, q);
      bi = bi + 1;
    }
    if (this.nBursts < MAX_BURSTS && ui.button(ROT_MAIS_BURST)) this.setBurst(this.nBursts, 0.0, 10.0);

    ui.label(this.rotuloGradiente());
    let gi = 0;
    while (gi < this.nChavesGradiente) {
      psTmpGradiente[0] = this.chaveGradienteTempo(gi);
      this.chaveGradienteCor(gi, psTmpCor);
      psTmpGradiente[1] = psTmpCor[0]; psTmpGradiente[2] = psTmpCor[1]; psTmpGradiente[3] = psTmpCor[2]; psTmpGradiente[4] = psTmpCor[3];
      const t = ui.slider(ROT_COR_TEMPO[gi], psTmpGradiente[0], 0.0, 1.0);
      const rgb = (Math.round(psTmpCor[0] * 255) << 16) | (Math.round(psTmpCor[1] * 255) << 8) | Math.round(psTmpCor[2] * 255);
      const novoRgb = ui.color(ROT_COR[gi], rgb);
      const a = ui.slider(ROT_COR_ALFA[gi], psTmpGradiente[4], 0.0, 1.0);
      if (t !== psTmpGradiente[0] || novoRgb !== rgb || a !== psTmpGradiente[4]) {
        psTmpGradiente[0] = t;
        psTmpGradiente[1] = ((novoRgb >> 16) & 0xFF) / 255.0; psTmpGradiente[2] = ((novoRgb >> 8) & 0xFF) / 255.0; psTmpGradiente[3] = (novoRgb & 0xFF) / 255.0;
        psTmpGradiente[4] = a;
        this.setChaveGradiente(gi, psTmpGradiente);
      }
      gi = gi + 1;
    }
    if (this.nChavesGradiente < MAX_CHAVES && ui.button(ROT_MAIS_COR)) {
      psTmpGradiente[0] = 1.0; psTmpGradiente[1] = 1.0; psTmpGradiente[2] = 1.0; psTmpGradiente[3] = 1.0; psTmpGradiente[4] = 1.0;
      this.setChaveGradiente(this.nChavesGradiente, psTmpGradiente);
    }

    ui.label(this.rotuloTamanho());
    let ci = 0;
    while (ci < this.nChavesTamanho) {
      psTmpCurva[0] = this.chaveTamanhoTempo(ci); psTmpCurva[1] = this.chaveTamanhoValor(ci);
      const t = ui.slider(ROT_TAM_TEMPO[ci], psTmpCurva[0], 0.0, 1.0);
      const v = ui.slider(ROT_TAM_VALOR[ci], psTmpCurva[1], 0.0, 4.0);
      if (t !== psTmpCurva[0] || v !== psTmpCurva[1]) { psTmpCurva[0] = t; psTmpCurva[1] = v; this.setChaveTamanho(ci, psTmpCurva); }
      ci = ci + 1;
    }
    if (this.nChavesTamanho < MAX_CHAVES && ui.button(ROT_MAIS_TAMANHO)) {
      psTmpCurva[0] = 1.0; psTmpCurva[1] = 1.0;
      this.setChaveTamanho(this.nChavesTamanho, psTmpCurva);
    }

    // ── Prévia de edição (Task 9) ────────────────────────────────────────
    // Fora do Play, `onInspectorGUI` roda uma vez por quadro de editor
    // enquanto ESTE componente está selecionado com o Inspector aberto (o
    // mesmo gancho, `inspector.ts`) — o ponto certo pra avançar a prévia sem
    // precisar de um laço próprio em `main.ts` nem de import de `@editor/api`
    // aqui. Dentro do Play, `scene.update()` já roda este `update()` pelo
    // caminho normal (`sim_step.ts`); chamar de novo aqui duplicaria a
    // simulação, por isso o `emJogo()===0`. O corte por seleção de verdade
    // ainda é o de dentro de `update()` (`consultaSelecao`) — chamar aqui é
    // só o "quem avança o relógio".
    if (emJogo() === 0) this.update(clockDelta());
    ui.label("Prévia");
    if (ui.button(this.isPlaying() ? "Pausar" : "Continuar")) { if (this.isPlaying()) this.pause(); else this.unPause(); }
    if (ui.button("Reiniciar")) { this.clear(); this.play(); }
  }

  /// Cabeçalhos "N/MAX ..." refeitos só quando a contagem muda (nada de
  /// string por quadro de Inspector aberto — CLAUDE.md "Custo por quadro"),
  /// mesmo padrão de `AudioSource.rotuloInfo`/`MixerInspector.rotulos`.
  private rotuloBursts(): string {
    if (this.rotBurstsDe !== this.nBursts) { this.rotBurstsDe = this.nBursts; this.rotBurstsCache = "Bursts (" + this.nBursts + "/" + MAX_BURSTS + ")"; }
    return this.rotBurstsCache;
  }
  private rotuloGradiente(): string {
    if (this.rotGradDe !== this.nChavesGradiente) { this.rotGradDe = this.nChavesGradiente; this.rotGradCache = "Gradiente de cor (" + this.nChavesGradiente + "/" + MAX_CHAVES + " chaves)"; }
    return this.rotGradCache;
  }
  private rotuloTamanho(): string {
    if (this.rotTamDe !== this.nChavesTamanho) { this.rotTamDe = this.nChavesTamanho; this.rotTamCache = "Curva de tamanho (" + this.nChavesTamanho + "/" + MAX_CHAVES + " chaves)"; }
    return this.rotTamCache;
  }
}

/// Rótulos do Inspector (`onInspectorGUI`): os por-índice são MÓDULO (só
/// dependem de `i`, iguais em toda instância — construídos uma vez, nunca
/// por quadro); os cabeçalhos "N/MAX" são cacheados por instância acima
/// (dependem da contagem). Nenhuma alocação de string por quadro de
/// Inspector aberto — CLAUDE.md "Não monte strings por quadro", mesmo
/// padrão de `MixerInspector.rotulos`.
const ROT_BURST_TEMPO: string[] = []; const ROT_BURST_QTD: string[] = [];
const ROT_COR_TEMPO: string[] = []; const ROT_COR: string[] = []; const ROT_COR_ALFA: string[] = [];
const ROT_TAM_TEMPO: string[] = []; const ROT_TAM_VALOR: string[] = [];
{
  let i = 0;
  while (i < MAX_BURSTS) { ROT_BURST_TEMPO.push("Burst " + i + " — tempo"); ROT_BURST_QTD.push("Burst " + i + " — quantidade"); i = i + 1; }
  i = 0;
  while (i < MAX_CHAVES) {
    ROT_COR_TEMPO.push("Cor " + i + " — tempo"); ROT_COR.push("Cor " + i); ROT_COR_ALFA.push("Cor " + i + " — alfa");
    ROT_TAM_TEMPO.push("Tamanho " + i + " — tempo"); ROT_TAM_VALOR.push("Tamanho " + i + " — escala");
    i = i + 1;
  }
}
const ROT_MAIS_BURST: string = "+ burst";
const ROT_MAIS_COR: string = "+ chave de cor";
const ROT_MAIS_TAMANHO: string = "+ chave de tamanho";

/// Rascunhos de módulo do Inspector (`onInspectorGUI`): nenhuma alocação por
/// quadro de Inspector aberto, mesmo padrão de `asPedido`/`asPos` do
/// AudioSource.
const psTmpGradiente = new Float64Array(CHAVE_GRADIENTE_FLOATS);
const psTmpCor = new Float64Array(4);
const psTmpCurva = new Float64Array(CHAVE_CURVA_FLOATS);
