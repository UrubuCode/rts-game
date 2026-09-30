// Personagens animados do cliente: um Skeleton (ossos rígidos do .glb Kenney)
// e um Animator (assets/animators/fps-personagem.controller.json) por jogador.
//
// Só no cliente e fora da cena: cada vaga tem um GameObject PRÓPRIO, que não
// entra em `scene` (o Animator acha o Skeleton pelo dono; a cena do jogo só
// tem a caixa de colisão). O cliente preenche por quadro, por vaga, os arrays
// `x/y/z` (pés), `yaw`, `vel` (velocidade horizontal), `vivo`, `disparos`
// (contador de tiros) e `visivel`, e chama `passo(n, dt)` e `desenharTodos`.
//
// Passo sincronizado com o chão (decisão 9 do plano): a mistura
// idle/walk/sprint é escolhida pela velocidade (limiares do controlador) e o
// Animator anda com dt × taxa, taxa = velocidade / velocidade natural da
// passada. A velocidade natural de cada clipe é MEDIDA do próprio clipe ao
// carregar: quanto o pé de apoio (o que anda para trás em relação ao corpo)
// se desloca por ciclo, dividido pela duração. Assim o pé plantado fica parado
// no chão em qualquer velocidade. Parado (vel < FPS_VEL_PARADO): idle, taxa 1.
//
// A taxa vale para o Animator inteiro (o motor não tem velocidade por camada):
// a camada do braço também anda na taxa, então o recuo do tiro acelera junto
// (~1,36× a 6 u/s, a velocidade do jogo; até 1,5× a 8 u/s). Morto: velocidade
// 0, taxa 1. Controlador que não carregou (`erro` != ""): as vagas não animam
// e o personagem fica na pose de repouso.
//
// Custo por quadro: zero alocação; métodos com no máximo 4 parâmetros; setters
// do Animator por índice (`*At`), resolvidos uma vez.
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { Animator } from "@engine/core/animator";
import { sampleClipInto } from "@engine/core/animation_player";
import { loadAnimatorController, STATE_BLEND } from "@engine/core/animator_controller";
import {
  drawGPUBuf, drawGPUMeshQBuf, inFrustumFast,
  DRAW_FLOATS, D_X, D_Y, D_Z, D_RX, D_RY, D_SX, D_SY, D_SZ, D_COR, D_EMISSIVO, D_TEX, D_TILE, D_QX, D_QY, D_QZ, D_QW,
} from "@engine/render/gpu3d";
import { fpsModelos, FPS_ESCALA_ARMA_MAO, FPS_GIRO_ARMA } from "./modelos";

export const FPS_CONTROLADOR_PERSONAGEM = "assets/animators/fps-personagem.controller.json";
const FPS_MODELOS_PERSONAGEM = [
  "assets/kenney/personagens/character-a.glb",
  "assets/kenney/personagens/character-b.glb",
  "assets/kenney/personagens/character-c.glb",
  "assets/kenney/personagens/character-d.glb",
];
/// Os personagens Kenney têm 2,7 u de altura com os pés em y = 0; o corpo do jogador tem 1,8 u.
export const FPS_ESCALA_PERSONAGEM: f64 = 1.8 / 2.7;
const FPS_OSSO_PERNA_E = "leg-left";
const FPS_OSSO_PERNA_D = "leg-right";
const FPS_OSSO_BRACO_ARMA = "arm-right";
const FPS_CLIPE_SEGURANDO = "holding-right";
/// Abaixo disso (u/s) o jogador está parado: idle, taxa 1.
export const FPS_VEL_PARADO: f64 = 0.3;
/// Limites da taxa de reprodução (evita pernas frenéticas perto do idle).
const FPS_TAXA_MIN: f64 = 0.25;
const FPS_TAXA_MAX: f64 = 3.0;
/// Amostras por ciclo na medição da passada.
const FPS_AMOSTRAS_PASSADA = 240;
/// Resolução (u/s) da tabela de velocidade natural da mistura.
const FPS_PASSO_TABELA: f64 = 0.25;
/// Mão direita no referencial do osso `arm-right` (unidades do modelo): o
/// braço desce por -Y a partir do ombro.
const FPS_MAO_X: f64 = 0.0;
const FPS_MAO_Y: f64 = -0.55;
const FPS_MAO_Z: f64 = 0.1;
/// Esfera de culling do personagem: centro acima dos pés e raio (mundo).
const FPS_CULL_ALTURA: f64 = 0.9;
const FPS_CULL_RAIO: f64 = 1.4;
/// Caixa desenhada se o .glb não carregar (mesma do corpo de colisão).
const FPS_CAIXA_LARGURA: f64 = 0.8;
const FPS_CAIXA_ALTURA: f64 = 1.8;
const FPS_CAIXA_COR = 0xC87840;
const FPS_MALHA_CUBO = 1;

/// Deslocamento do pé de apoio por ciclo da mistura "clipe `a` em peso 1,
/// depois clipe `b` em peso `w`" (a mesma do Animator: `samplePairInto` =
/// essas duas amostras), em unidades do MODELO; os dois na mesma fase
/// normalizada. `sk` tem o asset carregado e o host na origem, yaw 0, escala
/// 1. O pé é a ponta da perna (ver `fpsPeZ`). A cada amostra, o pé que anda
/// para trás (-Z: o personagem olha para +Z) é o de apoio; a soma do quanto
/// ele recua num ciclo é o quanto o corpo avança nesse ciclo.
export function fpsPassadaDaMistura(sk: Skeleton, a: number, b: number, w: f64): f64 {
  const asset = sk.asset;
  if (asset === null || a < 0 || b < 0) return 0.0;
  const pe = sk.boneIndex(FPS_OSSO_PERNA_E);
  const pd = sk.boneIndex(FPS_OSSO_PERNA_D);
  if (pe < 0 || pd < 0) return 0.0;
  const ca = asset.clips[a]; const cb = asset.clips[b];
  let zeAnt: f64 = 0.0; let zdAnt: f64 = 0.0;
  let recuo: f64 = 0.0;
  let k = 0;
  while (k <= FPS_AMOSTRAS_PASSADA) {
    const fase = k / FPS_AMOSTRAS_PASSADA;
    sk.applyManualPose();
    sampleClipInto(sk, ca, fase * ca.duration, 1.0);
    if (w > 0.0) sampleClipInto(sk, cb, fase * cb.duration, w);
    sk.compose();
    const ze = fpsPeZ(sk, pe);
    const zd = fpsPeZ(sk, pd);
    if (k > 0) {
      const dmin = Math.min(ze - zeAnt, zd - zdAnt);
      if (dmin < 0.0) recuo = recuo - dmin;
    }
    zeAnt = ze; zdAnt = zd;
    k = k + 1;
  }
  return recuo;
}

/// Z (mundo) da ponta da perna `b` na pose composta de `sk`: rot(osso) ·
/// (0, -L, 0) × escala, com L = altura do osso da perna em repouso (quadril ao chão).
export function fpsPeZ(sk: Skeleton, b: number): f64 {
  const a = sk.asset!;
  const r = b * 4;
  const x = sk.worldR[r]; const y = sk.worldR[r + 1]; const z = sk.worldR[r + 2]; const w = sk.worldR[r + 3];
  const vy = 0.0 - a.restT[b * 3 + 1] * sk.worldS[b * 3 + 1];
  // quatRotate aberto, só a componente z: t = 2 (q × v); z' = w·tz - y·tx
  const tx = 2.0 * (0.0 - z * vy);
  const tz = 2.0 * (x * vy);
  return sk.worldT[b * 3 + 2] + w * tz - y * tx;
}

export class FpsAnimacao {
  // ── por vaga (o cliente preenche por quadro) ──
  x: Float64Array = new Float64Array(0);
  y: Float64Array = new Float64Array(0);
  z: Float64Array = new Float64Array(0);
  yaw: Float64Array = new Float64Array(0);
  /// Velocidade horizontal (u/s).
  vel: Float64Array = new Float64Array(0);
  vivo: Uint8Array = new Uint8Array(0);
  /// Contador de tiros do jogador: subiu desde o quadro anterior = atirou.
  disparos: Int32Array = new Int32Array(0);
  /// 0 = a vaga não é desenhada nem animada neste quadro.
  visivel: Uint8Array = new Uint8Array(0);
  /// Taxa de reprodução aplicada no último passo (testes e depuração).
  taxa: Float64Array = new Float64Array(0);

  // ── por vaga (interno) ──
  sks: Skeleton[] = [];
  ans: Animator[] = [];
  private disparosVistos: Int32Array = new Int32Array(0);
  private ossoArma: Int32Array = new Int32Array(0);

  // ── passada medida (mundo): limiar do controlador, passada por ciclo e duração ──
  limiares: Float64Array = new Float64Array(0);
  passada: Float64Array = new Float64Array(0);
  duracao: Float64Array = new Float64Array(0);
  /// Velocidade natural (u/s) da mistura a cada FPS_PASSO_TABELA u/s, de 0 ao último limiar.
  tabelaNatural: Float64Array = new Float64Array(0);
  /// Rotação da arma no referencial do osso do braço (quaternion), medida na pose de segurar.
  private armaLocal: Float64Array = new Float64Array(4);

  private iVel: number = 0 - 1;
  private iMorto: number = 0 - 1;
  private iTiro: number = 0 - 1;
  private pos: Float64Array = new Float64Array(3);
  private d: Float64Array = new Float64Array(DRAW_FLOATS);
  erro: string = "";

  /// Caminho do controlador (padrão: FPS_CONTROLADOR_PERSONAGEM; outro só em testes).
  private controlador: string;

  constructor(controladorArg?: string) {
    this.controlador = controladorArg !== undefined ? controladorArg : FPS_CONTROLADOR_PERSONAGEM;
    this.medir();
  }

  /// Sobe para a GPU as peças e texturas de todos os modelos de personagem, uma
  /// vez, na carga. Sem isso a subida acontece no primeiro quadro em que cada
  /// modelo entra na tela (~0,5 s de engasgo medido no meio da partida).
  subirModelos(win: number): void {
    let i = 0;
    while (i < FPS_MODELOS_PERSONAGEM.length) {
      const go = new GameObject("carga" + i);
      const sk = new Skeleton(FPS_MODELOS_PERSONAGEM[i]);
      go.addBehavior(sk);
      sk.ensureAsset(win);
      i = i + 1;
    }
  }

  /// Quantas vagas existem (animadas ou não).
  vagas(): number { return this.sks.length; }

  /// Garante `n` vagas (cria GameObject + Skeleton + Animator das novas). Só
  /// aloca quando `n` cresce; chamar todo quadro é barato.
  garantir(n: number): void {
    if (n <= this.sks.length) return;
    this.crescer(n);
  }

  private crescer(n: number): void {
    const cap = n;
    this.x = fpsCopiarF64(this.x, cap); this.y = fpsCopiarF64(this.y, cap); this.z = fpsCopiarF64(this.z, cap);
    this.yaw = fpsCopiarF64(this.yaw, cap); this.vel = fpsCopiarF64(this.vel, cap); this.taxa = fpsCopiarF64(this.taxa, cap);
    const vivo = new Uint8Array(cap); vivo.set(this.vivo); this.vivo = vivo;
    const vis = new Uint8Array(cap); vis.set(this.visivel); this.visivel = vis;
    const dis = new Int32Array(cap); dis.set(this.disparos); this.disparos = dis;
    const vis2 = new Int32Array(cap); vis2.set(this.disparosVistos); this.disparosVistos = vis2;
    const oa = new Int32Array(cap); oa.set(this.ossoArma); this.ossoArma = oa;
    let j = this.sks.length;
    while (j < n) {
      const go = new GameObject("personagem" + j);
      go.transform.sx = FPS_ESCALA_PERSONAGEM; go.transform.sy = FPS_ESCALA_PERSONAGEM; go.transform.sz = FPS_ESCALA_PERSONAGEM;
      const sk = new Skeleton(FPS_MODELOS_PERSONAGEM[j % FPS_MODELOS_PERSONAGEM.length]);
      go.addBehavior(sk);
      sk.ensureAsset(0);
      const an = new Animator();
      an.controller = this.controlador;
      go.addBehavior(an);
      an.mount();
      if (this.iVel < 0) {
        this.iVel = an.paramIndex("velocidade"); this.iMorto = an.paramIndex("morto"); this.iTiro = an.paramIndex("tiro");
      }
      if (this.erro === "" && an.errorText() !== "") this.erro = an.errorText();
      this.sks.push(sk); this.ans.push(an);
      this.ossoArma[j] = sk.boneIndex(FPS_OSSO_BRACO_ARMA);
      this.vivo[j] = 1;
      j = j + 1;
    }
  }

  // Mede, uma vez, a passada de cada clipe da mistura de locomoção e a pose
  // da arma na mão (com um esqueleto próprio: host na origem, escala 1).
  private medir(): void {
    const c = loadAnimatorController(this.controlador);
    if (c.error !== "") { this.erro = c.error; return; }
    let s = 0;
    while (s < c.stateNames.length && c.stateKind[s] !== STATE_BLEND) s = s + 1;
    if (s >= c.stateNames.length) { this.erro = "controlador sem estado de mistura"; return; }
    const ini = c.stateBlendStart[s];
    const n = c.stateBlendCount[s];
    const go = new GameObject("medida");
    const sk = new Skeleton(FPS_MODELOS_PERSONAGEM[0]);
    go.addBehavior(sk);
    sk.ensureAsset(0);
    const a = sk.asset;
    if (a === null) { this.erro = "modelo nao carregou: " + FPS_MODELOS_PERSONAGEM[0]; return; }
    this.limiares = new Float64Array(n); this.passada = new Float64Array(n); this.duracao = new Float64Array(n);
    const clipes = new Int32Array(n);
    let i = 0;
    while (i < n) {
      const ci = a.clipIndex(c.blendClipName[ini + i]);
      clipes[i] = ci;
      this.limiares[i] = c.blendThreshold[ini + i];
      this.duracao[i] = ci >= 0 ? a.clips[ci].duration : 1.0;
      this.passada[i] = fpsPassadaDaMistura(sk, ci, ci, 0.0) * FPS_ESCALA_PERSONAGEM;
      i = i + 1;
    }
    // tabela: a mistura real (vizinhos + peso, como o Animator) medida a cada
    // FPS_PASSO_TABELA u/s — o ângulo misturado não é linear no peso, então
    // interpolar só as passadas dos clipes puros erra ~15% perto do idle
    const vMax = this.limiares[n - 1];
    const nt = Math.floor(vMax / FPS_PASSO_TABELA) + 1;
    this.tabelaNatural = new Float64Array(nt);
    let k = 0;
    while (k < nt) {
      const v = k * FPS_PASSO_TABELA;
      let ia = n - 1; let ib = n - 1; let w: f64 = 0.0;
      if (v <= this.limiares[0]) { ia = 0; ib = 0; }
      else if (v < vMax) {
        let s2 = 0;
        while (s2 < n - 2 && v >= this.limiares[s2 + 1]) s2 = s2 + 1;
        ia = s2; ib = s2 + 1;
        w = (v - this.limiares[s2]) / (this.limiares[s2 + 1] - this.limiares[s2]);
      }
      const dur = this.duracao[ia] + (this.duracao[ib] - this.duracao[ia]) * w;
      const d = fpsPassadaDaMistura(sk, clipes[ia], clipes[ib], w) * FPS_ESCALA_PERSONAGEM;
      this.tabelaNatural[k] = dur > 0.0 ? d / dur : 0.0;
      k = k + 1;
    }
    // arma: na pose de segurar, deve ficar só com o giro do cano (yaw do corpo = 0)
    const ci = a.clipIndex(FPS_CLIPE_SEGURANDO);
    const b = sk.boneIndex(FPS_OSSO_BRACO_ARMA);
    if (ci >= 0 && b >= 0) {
      sk.applyManualPose();
      sampleClipInto(sk, a.clips[ci], 0.0, 1.0);
      sk.compose();
      // armaLocal = conj(braço) ⊗ giro em Y
      const bx = 0.0 - sk.worldR[b * 4]; const by = 0.0 - sk.worldR[b * 4 + 1];
      const bz = 0.0 - sk.worldR[b * 4 + 2]; const bw = sk.worldR[b * 4 + 3];
      const gy = Math.sin(FPS_GIRO_ARMA * 0.5); const gw = Math.cos(FPS_GIRO_ARMA * 0.5);
      this.armaLocal[0] = bw * 0.0 + bx * gw + by * 0.0 - bz * gy;
      this.armaLocal[1] = bw * gy - bx * 0.0 + by * gw + bz * 0.0;
      this.armaLocal[2] = bw * 0.0 + bx * gy - by * 0.0 + bz * gw;
      this.armaLocal[3] = bw * gw - bx * 0.0 - by * gy - bz * 0.0;
    } else {
      this.armaLocal[3] = 1.0;
    }
  }

  /// Velocidade natural (u/s) da mistura de locomoção em `v` (tabela medida
  /// ao carregar, interpolada; acima do último limiar a mistura é o último clipe).
  velocidadeNatural(v: f64): f64 {
    const tab = this.tabelaNatural;
    const n = tab.length;
    if (n === 0) return 0.0;
    const x = v / FPS_PASSO_TABELA;
    if (x <= 0.0) return tab[0];
    if (x >= n - 1) return tab[n - 1];
    const i = Math.floor(x);
    return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
  }

  /// Taxa de reprodução para andar a `v` u/s com o pé de apoio parado no chão.
  taxaDoPasso(v: f64): f64 {
    if (v < FPS_VEL_PARADO) return 1.0;
    const nat = this.velocidadeNatural(v);
    if (nat <= 0.0) return 1.0;
    let taxa = v / nat;
    if (taxa < FPS_TAXA_MIN) taxa = FPS_TAXA_MIN;
    if (taxa > FPS_TAXA_MAX) taxa = FPS_TAXA_MAX;
    return taxa;
  }

  /// Avança as vagas visíveis `0..n-1` em `dt` segundos.
  passo(n: number, dt: f64): void {
    // controlador não carregou: sem parâmetros para escrever (nada de setFloatAt(-1))
    if (this.iVel < 0 || this.iMorto < 0 || this.iTiro < 0) return;
    const lim = n < this.sks.length ? n : this.sks.length;
    let j = 0;
    while (j < lim) {
      if (this.visivel[j] !== 0) this.passoVaga(j, dt);
      j = j + 1;
    }
  }

  private passoVaga(j: number, dt: f64): void {
    const an = this.ans[j];
    const vivo = this.vivo[j] !== 0;
    an.setBoolAt(this.iMorto, !vivo);
    const tiros = this.disparos[j];
    if (tiros !== this.disparosVistos[j]) {
      if (vivo && tiros > this.disparosVistos[j]) an.setTriggerAt(this.iTiro);
      this.disparosVistos[j] = tiros;
    }
    const v: f64 = vivo ? this.vel[j] : 0.0;
    an.setFloatAt(this.iVel, v < FPS_VEL_PARADO ? 0.0 : v);
    const taxa = this.taxaDoPasso(v);
    this.taxa[j] = taxa;
    an.update(dt * taxa);
  }

  /// Desenha as vagas visíveis `0..n-1` dentro do frustum (já preparado pela
  /// câmera do quadro). Devolve quantas desenhou.
  desenharTodos(win: number, n: number): number {
    const lim = n < this.sks.length ? n : this.sks.length;
    let desenhados = 0;
    let j = 0;
    while (j < lim) {
      if (this.visivel[j] !== 0 && inFrustumFast(this.x[j], this.y[j] + FPS_CULL_ALTURA, this.z[j], FPS_CULL_RAIO) !== 0) {
        this.desenhar(win, j);
        desenhados = desenhados + 1;
      }
      j = j + 1;
    }
    return desenhados;
  }

  /// Personagem da vaga `j` na pose do Animator, com a arma no osso do braço.
  desenhar(win: number, j: number): void {
    const sk = this.sks[j];
    sk.host.wry = this.yaw[j];
    const p = this.pos;
    p[0] = this.x[j]; p[1] = this.y[j]; p[2] = this.z[j];
    if (sk.drawSelf(win, p, 0 - 1) === 0) { this.desenharCaixa(win, j); return; }
    const b = this.ossoArma[j];
    if (b >= 0 && fpsModelos.pronto && fpsModelos.armas.length > 0) this.desenharArma(win, j);
  }

  // Arma presa ao osso do braço: posição = osso + rot(osso)·(mão × escala),
  // rotação = rot(osso) ⊗ armaLocal.
  private desenharArma(win: number, j: number): void {
    const sk = this.sks[j];
    const b = this.ossoArma[j];
    const t3 = b * 3; const r4 = b * 4;
    const qx = sk.worldR[r4]; const qy = sk.worldR[r4 + 1]; const qz = sk.worldR[r4 + 2]; const qw = sk.worldR[r4 + 3];
    const vx = FPS_MAO_X * sk.worldS[t3]; const vy = FPS_MAO_Y * sk.worldS[t3 + 1]; const vz = FPS_MAO_Z * sk.worldS[t3 + 2];
    const tx = 2.0 * (qy * vz - qz * vy); const ty = 2.0 * (qz * vx - qx * vz); const tz = 2.0 * (qx * vy - qy * vx);
    const d = this.d;
    d[D_X] = sk.worldT[t3] + vx + qw * tx + (qy * tz - qz * ty);
    d[D_Y] = sk.worldT[t3 + 1] + vy + qw * ty + (qz * tx - qx * tz);
    d[D_Z] = sk.worldT[t3 + 2] + vz + qw * tz + (qx * ty - qy * tx);
    const l = this.armaLocal;
    const lx = l[0]; const ly = l[1]; const lz = l[2]; const lw = l[3];
    d[D_QX] = qw * lx + qx * lw + qy * lz - qz * ly;
    d[D_QY] = qw * ly - qx * lz + qy * lw + qz * lx;
    d[D_QZ] = qw * lz + qx * ly - qy * lx + qz * lw;
    d[D_QW] = qw * lw - qx * lx - qy * ly - qz * lz;
    d[D_SX] = FPS_ESCALA_ARMA_MAO; d[D_SY] = FPS_ESCALA_ARMA_MAO; d[D_SZ] = FPS_ESCALA_ARMA_MAO;
    d[D_EMISSIVO] = 0;
    const m = fpsModelos.armas[j % fpsModelos.armas.length];
    let i = 0;
    while (i < m.malhas.length) {
      d[D_COR] = m.cores[i]; d[D_TEX] = m.texturas[i];
      drawGPUMeshQBuf(win, m.malhas[i], d);
      i = i + 1;
    }
  }

  // Sem modelo: a caixa do corpo.
  private desenharCaixa(win: number, j: number): void {
    const d = this.d;
    d[D_X] = this.x[j]; d[D_Y] = this.y[j] + FPS_CAIXA_ALTURA * 0.5; d[D_Z] = this.z[j];
    d[D_RX] = 0.0; d[D_RY] = this.yaw[j];
    d[D_SX] = FPS_CAIXA_LARGURA; d[D_SY] = FPS_CAIXA_ALTURA; d[D_SZ] = FPS_CAIXA_LARGURA;
    d[D_COR] = FPS_CAIXA_COR; d[D_EMISSIVO] = 0; d[D_TEX] = 0; d[D_TILE] = 0.0;
    d[D_QX] = 0.0; d[D_QY] = 0.0; d[D_QZ] = 0.0; d[D_QW] = 0.0;
    drawGPUBuf(win, FPS_MALHA_CUBO, d);
  }
}

function fpsCopiarF64(a: Float64Array, cap: number): Float64Array {
  const r = new Float64Array(cap);
  r.set(a);
  return r;
}
