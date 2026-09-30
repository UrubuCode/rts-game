// O mundo do FPS: dono da cena, dos jogadores e do tick fixo. É a única peça
// que o cliente (e, na entrega 2, o servidor) chama.
import { Scene } from "@engine/core/scene";
import { FPS_CADENCIA_BOT } from "./config";
import { GameObject } from "@engine/core/gameobject";
import {
  setSpatialScene, getSpatialScene, spatialRebuildIndex,
  createRaycastHit, createOverlapHit, RaycastHit, OverlapHit,
} from "@engine/core/spatial_queries";
import {
  FPS_TICK_DT, FPS_ALTURA_CORPO, FPS_MEIA_LARGURA_CAIXA, FPS_Y_MORTE, FPS_VIDA_MAX,
  FPS_TEMPO_RENASCER, FPS_RAIO_RENASCER_LIVRE, FPS_PENTE, FPS_POOL_EFEITOS,
  FPS_ALCANCE, FPS_DANO, FPS_MULT_CABECA, FPS_CADENCIA, FPS_TEMPO_RECARGA, FPS_ERRO_MIRA_BOT,
  FPS_EFEITO_MARCA, FPS_EFEITO_TRACADOR, FPS_VIDA_MARCA, FPS_VIDA_TRACADOR,
  FPS_ALTURA_OLHO, FPS_POOL_GRANADAS, FPS_RAIO_GRANADA, FPS_PAVIO, FPS_GRANADAS_POR_JOGADOR, FPS_TEMPO_GRANADA,
  FPS_VEL_GRANADA, FPS_IMPULSO_CIMA_GRANADA, FPS_RAIO_EXPLOSAO, FPS_DANO_GRANADA, FPS_EMPURRAO_GRANADA,
  FPS_EMPURRAO_CIMA_GRANADA, FPS_EFEITO_EXPLOSAO, FPS_VIDA_EXPLOSAO,
} from "./config";
import { FPS_CAMADA_JOGADOR, FPS_CAMADA_GRANADA } from "./layers";
import { FpsPlayerInput, fpsInputVazio } from "./input";
import { FpsPlayerState, fpsNovoJogador, fpsSimulatePlayer } from "./player";
import { FpsMapa, fpsGerarMapa } from "./map";
import { fpsStats, fpsZerarStats, fpsEsfera } from "./consultas";
import { fpsTiro, fpsEhCabeca, fpsMoverGranada, fpsDanoExplosao } from "./weapons";
import { FpsBotState, fpsNovoBot, fpsBotInput } from "./bots";

export class FpsWorld {
  scene: Scene;
  mapa: FpsMapa;
  jogadores: FpsPlayerState[];
  corpos: GameObject[];
  ehBot: boolean[];
  bots: FpsBotState[];
  ocupado: boolean[];
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
  raioTiro: f64[];
  tirosDisparados: number;
  grAtiva: boolean[];
  grX: f64[]; grY: f64[]; grZ: f64[];
  grVx: f64[]; grVy: f64[]; grVz: f64[];
  grTempo: f64[];
  grDono: number[];
  grCorpo: GameObject[];
  grPos: f64[];
  grVel: f64[];

  constructor(sc: Scene, semente: number, escala: f64) {
    this.scene = sc;
    this.semente = semente | 0;
    this.mapa = fpsGerarMapa(sc, semente, escala);
    this.jogadores = [];
    this.corpos = [];
    this.ehBot = [];
    this.bots = [];
    this.ocupado = [];
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
    this.raioTiro = [0.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    this.tirosDisparados = 0;
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
    this.bots.push(fpsNovoBot(i));
    this.inputsTick.push(this.inputNulo);
    this.ocupado.push(true);
    this.renascer(i);
    this.sincronizarCorpos();
    return i;
  }

  removerUltimoBot(): boolean {
    const i = this.jogadores.length - 1;
    if (i < 0 || !this.ehBot[i]) return false;
    // granadas no ar perdem o dono: o índice i pode ser reaproveitado por outro bot
    let k = 0;
    while (k < FPS_POOL_GRANADAS) { if (this.grDono[k] === i) this.grDono[k] = -1; k = k + 1; }
    const idx = this.scene.objects.indexOf(this.corpos[i]);
    if (idx >= 0) this.scene.removeAt(idx);
    this.jogadores.pop();
    this.corpos.pop();
    this.ehBot.pop();
    this.bots.pop();
    this.inputsTick.pop();
    this.ocupado.pop();
    this.sincronizarCorpos();
    return true;
  }

  /// Tira o jogador i do jogo (cliente que saiu): fica morto e sem renascer
  /// até alguém ocupar a vaga.
  liberarJogador(i: number): void {
    this.ocupado[i] = false;
    const p = this.jogadores[i];
    p.vivo = false;
    p.vida = 0.0;
    p.tempoRenascer = 0.0;
    this.corpos[i].active = 0;
    let k = 0;
    while (k < FPS_POOL_GRANADAS) { if (this.grDono[k] === i) this.grDono[k] = -1; k = k + 1; }
    this.sincronizarCorpos();
  }

  /// Reaproveita a primeira vaga livre (ou cria um jogador) e o faz nascer.
  ocuparJogador(ehBot: boolean): number {
    let i = 0;
    while (i < this.jogadores.length) {
      if (!this.ocupado[i]) {
        this.ocupado[i] = true;
        this.ehBot[i] = ehBot;
        this.bots[i] = fpsNovoBot(i);
        const p = this.jogadores[i];
        p.abates = 0;
        p.mortes = 0;
        p.granadasVivas = 0;
        p.tempoGranada = 0.0;
        this.renascer(i);
        this.sincronizarCorpos();
        return i;
      }
      i = i + 1;
    }
    return this.adicionarJogador(ehBot);
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
    p.disparos = p.disparos + 1;
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
        p.cadenciaRestante = p.cadenciaRestante + 1.0 / (this.ehBot[i] ? FPS_CADENCIA_BOT : FPS_CADENCIA);
        if (p.municao === 0) p.tempoRecarga = FPS_TEMPO_RECARGA;   // última bala: recarrega sozinho
      } else {
        p.tempoRecarga = FPS_TEMPO_RECARGA;
      }
    }
    if (p.tempoGranada > 0.0) p.tempoGranada = p.tempoGranada - dt;
    if (inp.granada && p.tempoGranada <= 0.0 && p.granadasVivas < FPS_GRANADAS_POR_JOGADOR) this.lancarGranada(i);
  }

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

  inputDe(i: number, inputs: FpsPlayerInput[]): FpsPlayerInput {
    if (this.ehBot[i]) {
      return fpsBotInput(this.bots[i], i, this.jogadores, this.mapa.spawnX, this.mapa.spawnZ,
                         this.tickAtual, this.scene, this.raio);
    }
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
    let k = 0;
    while (k < FPS_POOL_GRANADAS) {
      if (this.grAtiva[k]) this.grCorpo[k].transform.setPosition(this.grX[k], this.grY[k], this.grZ[k]);
      k = k + 1;
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

    // o índice precisa ver as posições DESTE tick antes dos tiros: senão a
    // caixa do atirador fica onde estava e engole o próprio tiro ao recuar
    this.sincronizarCorpos();

    // 2. armas e granadas
    i = 0;
    while (i < n) {
      this.processarArmas(i, this.inputsTick[i]);
      i = i + 1;
    }
    this.atualizarGranadas();

    // 3. renascimentos
    i = 0;
    while (i < n) {
      const p = this.jogadores[i];
      if (!p.vivo && this.ocupado[i]) {
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
