// ParticleSystem no modelo da Unity — spec docs/superpowers/specs/2026-09-27-particulas-design.md §4.
// Desenha-se como o Skeleton (KIND_RENDERER + drawsSelf): sem KIND novo, sem
// cache novo em Scene. Simula em update(dt), o hook por-frame comum a todo
// Behavior.
import { Behavior, KIND_RENDERER } from "@engine/core/behavior";
import { PoolParticulas, criarPool, emitirN, atualizarVidas } from "@engine/particles/sim";
import { avaliarGradiente, avaliarCurva, aplicarVelocidade } from "@engine/particles/curvas";
import { drawParticlesSeguro, drawParticlesTexSeguro, setParticleTex } from "@compat/particles";
import { emJogo } from "@engine/core/modo_jogo";
import { frustumParams } from "@engine/render/gpu3d";
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
  private gradiente: Float64Array = new Float64Array([0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0]);
  private nChavesGradiente: number = 2;
  private curvaTamanho: Float64Array = new Float64Array([0.0, 1.0, 1.0, 1.0]);
  private nChavesTamanho: number = 2;

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

  /// Preenche o buffer de instância e desenha. 3 parâmetros (win, pos do
  /// dono, tint — a assinatura fixa de drawsSelf; simulationSpace="world" soma
  /// `pos` a cada quadro, "local" usa a posição relativa já simulada).
  drawSelf(win: number, pos: Float64Array, tint: number): number {
    const pool = this.pool;
    if (pool === null || pool.vivas === 0) return 0;
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
    // comutativo — soma pura, a ordem não muda o resultado). Ordenação por
    // inserção sobre um índice (O(n²), mas só custa algo quando `sort=1`,
    // opt-in e default 0; um `Array.sort`/`TypedArray.sort` com comparador
    // teria custo/alocação não comprovados neste runtime — ver o comentário
    // acima do campo `distBuf`).
    const buf = (this.sort !== 0 && this.modo === 0 && n > 1) ? this.ordenarPorDistancia(out, n) : out;
    if (this.textura > 0) { setParticleTex(this.textura); return drawParticlesTexSeguro(win, buf, n, this.modo); }
    return drawParticlesSeguro(win, buf, n, this.modo);
  }

  /// Reordena as `n` primeiras partículas de `buf` (formato de instância, 9
  /// floats cada) da mais distante para a mais próxima da câmera
  /// (back-to-front, pintor's algorithm) e devolve a cópia ordenada — nunca
  /// muta `buf` (que é `saidaBuf`, reaproveitado pelo próximo `drawSelf`).
  /// 2 parâmetros (buf, n; câmera/buffers auxiliares ficam em campos).
  private ordenarPorDistancia(buf: Float32Array, n: number): Float32Array {
    if (this.distBuf.length < n) this.distBuf = new Float64Array(n);
    if (this.ordemBuf.length < n) this.ordemBuf = new Int32Array(n);
    if (this.saidaOrdenadaBuf.length < buf.length) this.saidaOrdenadaBuf = new Float32Array(buf.length);
    frustumParams(this.camBuf);
    const camX = this.camBuf[0]; const camY = this.camBuf[1]; const camZ = this.camBuf[2];
    const dist = this.distBuf; const ordem = this.ordemBuf;
    let i = 0;
    while (i < n) {
      const o = i * PART_INSTANCIA_FLOATS;
      const dx = buf[o] - camX; const dy = buf[o + 1] - camY; const dz = buf[o + 2] - camZ;
      dist[i] = dx * dx + dy * dy + dz * dz;
      ordem[i] = i;
      i = i + 1;
    }
    // Inserção, decrescente por distância (farthest primeiro): estável, sem
    // alocar, e barato o bastante pros N típicos de um emissor (centenas a
    // poucos milhares) — não é o algoritmo pra 10k+ com sort=1 todo quadro.
    let a = 1;
    while (a < n) {
      const chaveIdx = ordem[a]; const chaveDist = dist[chaveIdx];
      let b = a - 1;
      while (b >= 0 && dist[ordem[b]] < chaveDist) { ordem[b + 1] = ordem[b]; b = b - 1; }
      ordem[b + 1] = chaveIdx;
      a = a + 1;
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
}
