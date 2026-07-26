// ═══════════════════════════════════════════════════════════════════════════
// FLUIDO NA GPU — módulo do motor (SPH em WGSL via rts:gpu).
//
// A física inteira (densidade, pressão, viscosidade, integração e COLISÃO com
// o mundo) roda na GPU; o TS sobe o estado uma vez, sincroniza os colisores da
// cena quando ela muda e lê só as posições de volta, uma vez por frame.
//
// COLISÃO COM O MUNDO: os mesmos colisores do solver CPU (`GameObject.colShape
// === COL_BOX`, meia-extensão = t.sx*0.5, posição mundial wx/wy/wz) são
// enviados como AABBs para o kernel — a água escorre pelos MESMOS blocos que
// os corpos rígidos empilham. Fronteira assimétrica de propósito: o mundo
// empurra a água; a água (por enquanto) não empurra o mundo.
//
// RELÓGIO PRÓPRIO (estilo FixedUpdate): `gfStep` primeiro LÊ o resultado do
// frame anterior (a GPU teve o frame inteiro para terminar — a leitura é quase
// grátis) e depois SUBMETE os sub-passos deste frame sem esperar. 1 frame de
// latência; o jogo nunca trava esperando a física.
//
// Lições do fluido CPU (scripts/fluid.ts) carregadas para cá:
//   - sub-passo FIXO (dt real de um frame lento vira explosão);
//   - pressão SIMÉTRICA (assimetria cria energia do nada);
//   - REST calibrada na grade do spawn (rest errada = atração ou explosão);
//   - paredes ABSORVEM (refletir devolve energia e o líquido nunca assenta);
//   - near-pressure de Clavet (só pressão deixa partícula entrar em partícula).
//
// Sem GPU (`gfAvailable() === 0`) nada aqui pode ser usado — o jogo decide o
// fallback (fluido CPU ou nada). Nenhuma função quebra: viram no-op.
// ═══════════════════════════════════════════════════════════════════════════
import gpu from "rts:gpu";
import buffer from "rts:buffer";

import { Scene } from "../core/scene";
import { GameObject, COL_BOX } from "../core/gameobject";
import { Transform } from "../core/transform";

/// Máximo de AABBs enviados ao kernel (12 KB de buffer; a fortaleza usa ~400).
export const GF_MAX_COLLIDERS = 768;
/// Raio de kernel SPH. As demais constantes derivam dele nos shaders.
const GF_H = "0.45";
/// Sub-passo fixo da física (lição do CPU: NUNCA integrar com dt real).
export const GF_DT: f64 = 1.0 / 240.0;
/// "Caroço duro" da partícula na colisão com o mundo.
const GF_RADIUS: f64 = 0.16;

// A DENSIDADE vive no `w` do vec4 de posição — não num buffer próprio. Não é
// estética: com uma JANELA aberta o device nasce com limites downlevel (máx. 4
// storage buffers por estágio) e o kernel de força precisa de pos+vel+params+
// cols. O quinto buffer não cabe; o w da posição estava sobrando.
let gfN = 0;
let gfPipeDens: i64 = 0;
let gfPipeForce: i64 = 0;
let gfGPos: i64 = 0;
let gfGVel: i64 = 0;
let gfGParams: i64 = 0;
let gfGCols: i64 = 0;
let gfPosBuf: i64 = 0;      // espelho CPU das posições (leitura pós-readback)
let gfVelBuf: i64 = 0;
let gfParamsBuf: i64 = 0;
let gfColsBuf: i64 = 0;
let gfGroups = 0;
let gfRest: f64 = 0.0;
let gfColCount = 0;

export function gfAvailable(): number { return gpu.available(); }

/// Posição da partícula `i` (válida após um `gfStep`).
export function gfX(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4) * 4); }
export function gfY(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4 + 1) * 4); }
export function gfZ(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4 + 2) * 4); }
export function gfCount(): number { return gfN; }
/// `w` ASSINADO da partícula `i`: |w| = densidade; w < 0 = CERCADA nas 6
/// direções (invisível de qualquer ângulo — o render pode cortar com
/// segurança; ver o kernel de densidade).
export function gfDens(i: number): f64 { return buffer.read_f32(gfPosBuf, (i * 4 + 3) * 4); }
/// 1 se a partícula está cercada (pode ser cortada do desenho em QUALQUER
/// ângulo de câmera); 0 se faz parte da casca visível.
export function gfHidden(i: number): number {
  return buffer.read_f32(gfPosBuf, (i * 4 + 3) * 4) < 0.0 ? 1 : 0;
}
/// Densidade de repouso calibrada no spawn (referência para o corte de casca).
export function gfRestDensity(): f64 { return gfRest; }

/// Cria os pipelines e buffers para `n` partículas. 1 ok, 0 sem GPU/erro.
export function gfInit(n: number): number {
  if (gpu.available() === 0) return 0;
  gfN = n;
  gfGroups = ((n + 63) / 64) | 0;

  const densSrc = `
@group(0) @binding(0) var<storage, read_write> pos: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&pos);
  if (id.x >= n) { return; }
  let h = ${GF_H};
  let h2 = h * h;
  let p = pos[id.x].xyz;
  var d: f32 = 0.0;
  // COBERTURA: uma particula so e invisivel (de QUALQUER angulo) se tem
  // vizinho proximo nos 8 OCTANTES ao redor. So 6 direcoes axiais deixava
  // frestas diagonais visiveis em angulo rasante (medido na tela). O veredito
  // viaja no SINAL do w: w < 0 => cercada; |w| = densidade.
  var cover: u32 = 0u;
  for (var j: u32 = 0u; j < n; j = j + 1u) {
    let dv = p - pos[j].xyz;
    let r2 = dot(dv, dv);
    if (r2 < h2) { let w = h2 - r2; d = d + w * w * w; }
    // 0.3025 = 0.55^2 — MENOR que o raio que o teste verifica (0.65): o
    // veredito e calculado ANTES da integracao e vale por 1 frame; a margem
    // engole o deslocamento maximo por frame (~0.12) sem virar buraco.
    if (j != id.x && r2 < 0.3025) {
      let nb = pos[j].xyz - p;
      // octante SOLIDO: componente > 0.13 (maior que o drift de 1 frame) nao
      // troca de sinal ate a verificacao/desenho — sem isso, vizinho em cima
      // do plano do eixo flipava de octante e abria fresta.
      if (abs(nb.x) > 0.13 && abs(nb.y) > 0.13 && abs(nb.z) > 0.13) {
        let bx = select(0u, 1u, nb.x > 0.0);
        let by = select(0u, 1u, nb.y > 0.0);
        let bz = select(0u, 1u, nb.z > 0.0);
        cover = cover | (1u << (bx | (by << 1u) | (bz << 2u)));
      }
    }
  }
  let cercada = cover == 255u;
  pos[id.x].w = select(d, -d, cercada);
}
`;
  // params: [0]=dt [1]=rest [2]=colCount [3]=raio da particula
  // cols:  pares de vec4 — [k*2]=centro, [k*2+1]=meia-extensao
  const forceSrc = `
@group(0) @binding(0) var<storage, read_write> pos: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> vel: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> params: array<f32>;
@group(0) @binding(3) var<storage, read> cols: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&pos);
  if (id.x >= n) { return; }
  let h = ${GF_H};
  let h2 = h * h;
  let dt = params[0];
  let rest = params[1];
  let stiff = 90.0;
  let visc = 4.0;
  let hHalf = h * 0.55;
  let p = pos[id.x].xyz;
  let v = vel[id.x].xyz;
  let wi = pos[id.x].w;      // w ASSINADO (sinal = cercada; ver kernel de densidade)
  let di = abs(wi);
  let pi = stiff * max(di - rest, 0.0);
  var f = vec3<f32>(0.0, -9.8, 0.0);
  for (var j: u32 = 0u; j < n; j = j + 1u) {
    if (j == id.x) { continue; }
    let dv = p - pos[j].xyz;
    let r2 = dot(dv, dv);
    if (r2 < h2 && r2 > 0.000001) {
      let r = sqrt(r2);
      let dj = max(abs(pos[j].w), 0.0001);
      let pj = stiff * max(dj - rest, 0.0);
      // pressao SIMETRICA + viscosidade (mesmas equacoes do fluido CPU)
      let push = (pi + pj) * 0.5 * (h - r) * (h - r) / dj;
      f = f + dv * (push / r);
      f = f + (vel[j].xyz - v) * (visc * (h - r) / dj);
      // near-pressure (Clavet): o carogo duro entre particulas
      if (r < hHalf) {
        let q = 1.0 - r / hHalf;
        f = f + dv * (55.0 * q * q / r);
      }
    }
  }
  var nv = v + f * dt;
  let sp = length(nv);
  if (sp > 14.0) { nv = nv * (14.0 / sp); }
  var np = p + nv * dt;
  // ── COLISAO COM O MUNDO: os AABBs da cena (mesma semantica do solver CPU) ──
  let m = u32(params[2]);
  let pr = params[3];
  for (var k: u32 = 0u; k < m; k = k + 1u) {
    let cc = cols[k * 2u].xyz;
    let hh = cols[k * 2u + 1u].xyz;
    let cp = clamp(np, cc - hh, cc + hh);
    let dc = np - cp;
    let d2 = dot(dc, dc);
    if (d2 < pr * pr) {
      if (d2 > 0.000001) {
        // fora da caixa mas encostando: empurra pela normal do ponto mais proximo
        let d = sqrt(d2);
        let nrm = dc / d;
        np = cp + nrm * pr;
        let vn = dot(nv, nrm);
        // absorve (reflete so 20%): parede que devolve energia nunca assenta
        if (vn < 0.0) { nv = nv - nrm * (vn * 1.2); }
      } else {
        // centro DENTRO da caixa: sai pela face mais rasa
        let q = (hh + vec3<f32>(pr, pr, pr)) - abs(np - cc);
        if (q.x < q.y && q.x < q.z) {
          let sx = select(-1.0, 1.0, np.x >= cc.x);
          np.x = cc.x + sx * (hh.x + pr); nv.x = nv.x * -0.2;
        } else if (q.y < q.z) {
          let sy = select(-1.0, 1.0, np.y >= cc.y);
          np.y = cc.y + sy * (hh.y + pr); nv.y = nv.y * -0.2;
        } else {
          let sz = select(-1.0, 1.0, np.z >= cc.z);
          np.z = cc.z + sz * (hh.z + pr); nv.z = nv.z * -0.2;
        }
      }
    }
  }
  // rede de seguranca: nada cai do mundo
  if (np.y < -20.0) { np.y = -20.0; nv.y = 0.0; }
  pos[id.x] = vec4<f32>(np, wi);   // preserva o SINAL (veredito de cobertura)
  vel[id.x] = vec4<f32>(nv, 0.0);
}
`;
  gfPipeDens = gpu.shader(densSrc);
  gfPipeForce = gpu.shader(forceSrc);
  if (gfPipeDens === 0 || gfPipeForce === 0) return 0;

  gfGPos = gpu.buffer(n * 4 * 4);
  gfGVel = gpu.buffer(n * 4 * 4);
  gfGParams = gpu.buffer(4 * 4);
  gfGCols = gpu.buffer(GF_MAX_COLLIDERS * 8 * 4);
  gfPosBuf = buffer.alloc(n * 4 * 4);
  gfVelBuf = buffer.alloc(n * 4 * 4);
  gfParamsBuf = buffer.alloc(4 * 4);
  gfColsBuf = buffer.alloc(GF_MAX_COLLIDERS * 8 * 4);

  gpu.bind_buffer(gfPipeDens, 0, gfGPos);
  gpu.bind_buffer(gfPipeForce, 0, gfGPos);
  gpu.bind_buffer(gfPipeForce, 1, gfGVel);
  gpu.bind_buffer(gfPipeForce, 2, gfGParams);
  gpu.bind_buffer(gfPipeForce, 3, gfGCols);
  return 1;
}

/// Preenche um bloco de `cols × rows × layers` a partir de (x0,y0,z0), sobe o
/// estado e CALIBRA a densidade de repouso na própria grade (lição do CPU).
export function gfSpawnBlock(cols: number, rows: number, layers: number,
                             x0: f64, y0: f64, z0: f64, spacing: f64): void {
  if (gfPipeDens === 0) return;
  let i = 0;
  let c = 0;
  while (c < cols) {
    let r = 0;
    while (r < rows) {
      let l = 0;
      while (l < layers) {
        if (i < gfN) {
          buffer.write_f32(gfPosBuf, (i * 4) * 4, x0 + c * spacing);
          buffer.write_f32(gfPosBuf, (i * 4 + 1) * 4, y0 + r * spacing);
          buffer.write_f32(gfPosBuf, (i * 4 + 2) * 4, z0 + l * spacing);
          buffer.write_f32(gfPosBuf, (i * 4 + 3) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4 + 1) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4 + 2) * 4, 0.0);
          buffer.write_f32(gfVelBuf, (i * 4 + 3) * 4, 0.0);
        }
        i = i + 1;
        l = l + 1;
      }
      r = r + 1;
    }
    c = c + 1;
  }
  gpu.write(gfGPos, gfPosBuf, gfN * 4 * 4);
  gpu.write(gfGVel, gfVelBuf, gfN * 4 * 4);

  // REST = 85% da densidade média da grade inicial (1 passe + readback, 1x)
  if (gfRest === 0.0) {
    gpu.dispatch(gfPipeDens, gfGroups, 1, 1);
    gpu.read(gfGPos, gfPosBuf, gfN * 4 * 4);
    let acc: f64 = 0.0;
    let k = 0;
    while (k < gfN) {
      let d: f64 = buffer.read_f32(gfPosBuf, (k * 4 + 3) * 4);
      if (d < 0.0) d = 0.0 - d;      // w assinado: |w| e a densidade
      acc = acc + d;
      k = k + 1;
    }
    gfRest = (acc / gfN) * 0.85;
  }
  buffer.write_f32(gfParamsBuf, 0, GF_DT);
  buffer.write_f32(gfParamsBuf, 4, gfRest);
  buffer.write_f32(gfParamsBuf, 8, gfColCount * 1.0);
  buffer.write_f32(gfParamsBuf, 12, GF_RADIUS);
  gpu.write(gfGParams, gfParamsBuf, 16);
}

/// Envia os colisores BOX da cena para o kernel (mesma semântica do solver
/// CPU: meia-extensão = sx*0.5, posição mundial). Chamar após `computeWorld`
/// quando a cena muda — com tudo dormindo não precisa reenviar.
export function gfSyncColliders(sc: Scene): void {
  if (gfPipeForce === 0) return;
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const n = objs.length;
  let m = 0;
  let i = 0;
  while (i < n && m < GF_MAX_COLLIDERS) {
    const o: GameObject = objs[i];
    if (o.colShape === COL_BOX && o.active !== 0) {
      const t: Transform = trs[i];
      const base = m * 8;
      buffer.write_f32(gfColsBuf, (base) * 4, t.wx);
      buffer.write_f32(gfColsBuf, (base + 1) * 4, t.wy);
      buffer.write_f32(gfColsBuf, (base + 2) * 4, t.wz);
      buffer.write_f32(gfColsBuf, (base + 3) * 4, 0.0);
      buffer.write_f32(gfColsBuf, (base + 4) * 4, t.sx * 0.5);
      buffer.write_f32(gfColsBuf, (base + 5) * 4, t.sy * 0.5);
      buffer.write_f32(gfColsBuf, (base + 6) * 4, t.sz * 0.5);
      buffer.write_f32(gfColsBuf, (base + 7) * 4, 0.0);
      m = m + 1;
    }
    i = i + 1;
  }
  gfColCount = m;
  gpu.write(gfGCols, gfColsBuf, m * 8 * 4);
  buffer.write_f32(gfParamsBuf, 8, m * 1.0);
  gpu.write(gfGParams, gfParamsBuf, 16);
}

// ── HANDOFF (fachada engine/fluid/fluid.ts): ler/escrever o estado completo —
// é o que permite TROCAR de backend em pleno voo sem a água teleportar.

/// Sincroniza os DOIS espelhos CPU (posição E velocidade) com a GPU agora.
export function gfReadState(): void {
  if (gfPipeForce === 0) return;
  gpu.read(gfGPos, gfPosBuf, gfN * 4 * 4);
  gpu.read(gfGVel, gfVelBuf, gfN * 4 * 4);
}
export function gfVelX(i: number): f64 { return buffer.read_f32(gfVelBuf, (i * 4) * 4); }
export function gfVelY(i: number): f64 { return buffer.read_f32(gfVelBuf, (i * 4 + 1) * 4); }
export function gfVelZ(i: number): f64 { return buffer.read_f32(gfVelBuf, (i * 4 + 2) * 4); }

/// Escreve o estado de uma partícula nos espelhos (chamar `gfUploadState` ao
/// final para efetivar na GPU).
export function gfSetState(i: number, x: f64, y: f64, z: f64,
                           vx: f64, vy: f64, vz: f64): void {
  buffer.write_f32(gfPosBuf, (i * 4) * 4, x);
  buffer.write_f32(gfPosBuf, (i * 4 + 1) * 4, y);
  buffer.write_f32(gfPosBuf, (i * 4 + 2) * 4, z);
  buffer.write_f32(gfPosBuf, (i * 4 + 3) * 4, 0.0);
  buffer.write_f32(gfVelBuf, (i * 4) * 4, vx);
  buffer.write_f32(gfVelBuf, (i * 4 + 1) * 4, vy);
  buffer.write_f32(gfVelBuf, (i * 4 + 2) * 4, vz);
  buffer.write_f32(gfVelBuf, (i * 4 + 3) * 4, 0.0);
}
export function gfUploadState(): void {
  if (gfPipeForce === 0) return;
  gpu.write(gfGPos, gfPosBuf, gfN * 4 * 4);
  gpu.write(gfGVel, gfVelBuf, gfN * 4 * 4);
}
/// Fixa a densidade de repouso vinda do OUTRO backend (handoff) — sem isso a
/// água recalibraria num estado comprimido e mudaria de comportamento.
export function gfSetRest(v: f64): void {
  gfRest = v;
  buffer.write_f32(gfParamsBuf, 4, v);
  gpu.write(gfGParams, gfParamsBuf, 16);
}

/// Um frame de física: LÊ o resultado do frame anterior (pipelining — a GPU já
/// terminou) e submete `substeps` sub-passos novos sem esperar.
export function gfStep(substeps: number): void {
  if (gfPipeForce === 0) return;
  gpu.read(gfGPos, gfPosBuf, gfN * 4 * 4);
  let s = 0;
  while (s < substeps) {
    gpu.dispatch(gfPipeDens, gfGroups, 1, 1);
    gpu.dispatch(gfPipeForce, gfGroups, 1, 1);
    s = s + 1;
  }
}
