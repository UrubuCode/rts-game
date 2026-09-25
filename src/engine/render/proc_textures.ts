// Texturas PROCEDURAIS: pixels RGBA8 gerados em TypeScript, sem arquivo e sem
// decodificador de imagem (o runtime novo não tem `rts:imgdec`; `loadTexture`
// lança). Determinísticas (LCG semeado), geradas uma vez e enviadas à GPU por
// `uploadTexture` com chave — o cache de `gpu3d.ts` devolve o mesmo id depois.
//
// Pensadas para `tile` > 0 no `drawGPU`: o shader amostra em coordenada de
// mundo, então uma textura cobre `1 / tile` unidades e REPETE. Por isso as
// bordas casam (padrões periódicos no tamanho da imagem).
//
// Custo: 128×128 = 16 384 pixels por textura, uma vez por janela.

import { uploadTexture } from "@engine/render/gpu3d";

export const PROC_TEX_SIZE = 128;

export const PROC_CONCRETO = "concreto";
export const PROC_TIJOLO = "tijolo";
export const PROC_ASFALTO = "asfalto";
export const PROC_METAL = "metal";
export const PROC_MADEIRA = "madeira";
export const PROC_PISO = "piso";

export const PROC_NOMES: string[] = [PROC_CONCRETO, PROC_TIJOLO, PROC_ASFALTO, PROC_METAL, PROC_MADEIRA, PROC_PISO];

let procSemente = 1;
function procRnd(): f64 {
  procSemente = ((procSemente * 1664525 + 1013904223) | 0);
  return (procSemente >>> 0) / 4294967296.0;
}

/// Ruído de valor periódico (repete a cada `per` células): suave o bastante
/// para parecer material, periódico para a textura casar ao repetir.
function procRuido(grade: f64[], per: number, x: f64, y: f64): f64 {
  const gx = x * per; const gy = y * per;
  const x0 = Math.floor(gx); const y0 = Math.floor(gy);
  const fx = gx - x0; const fy = gy - y0;
  const ix0 = ((x0 % per) + per) % per; const iy0 = ((y0 % per) + per) % per;
  const ix1 = (ix0 + 1) % per; const iy1 = (iy0 + 1) % per;
  const a = grade[iy0 * per + ix0]; const b = grade[iy0 * per + ix1];
  const c = grade[iy1 * per + ix0]; const d = grade[iy1 * per + ix1];
  const sx = fx * fx * (3.0 - 2.0 * fx); const sy = fy * fy * (3.0 - 2.0 * fy);
  const top = a + (b - a) * sx; const bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

function procGrade(per: number): f64[] {
  const g: f64[] = new Array(per * per).fill(0.0);
  let i = 0;
  while (i < per * per) { g[i] = procRnd(); i = i + 1; }
  return g;
}

function procPor(px: Uint8Array, i: number, r: f64, g: f64, b: f64): void {
  px[i] = procByte(r); px[i + 1] = procByte(g); px[i + 2] = procByte(b); px[i + 3] = 255;
}

function procByte(v: f64): number {
  const x = v < 0.0 ? 0.0 : (v > 255.0 ? 255.0 : v);
  return x | 0;
}

/// Pixels RGBA8 (`PROC_TEX_SIZE`²) do padrão `nome`. Pura: mesma entrada, mesmos
/// bytes. Padrões em tons claros: a cor do objeto multiplica a textura.
export function procTexturePixels(nome: string): Uint8Array {
  const n = PROC_TEX_SIZE;
  const px = new Uint8Array(n * n * 4);
  procSemente = 7919 + nome.length * 131 + nome.charCodeAt(0);
  const g8 = procGrade(8);
  const g32 = procGrade(32);
  let y = 0;
  while (y < n) {
    let x = 0;
    while (x < n) {
      const u = x / n; const v = y / n;
      const i = (y * n + x) * 4;
      const baixo = procRuido(g8, 8, u, v);
      const fino = procRuido(g32, 32, u, v);
      if (nome === PROC_TIJOLO) {
        // 4 fileiras de 2 tijolos, fileiras alternadas deslocadas meio tijolo
        const fil = Math.floor(v * 4.0);
        const uu = u * 2.0 + (fil % 2 === 1 ? 0.5 : 0.0);
        const fu = uu - Math.floor(uu);
        const fv = v * 4.0 - fil;
        const junta = fu < 0.04 || fu > 0.96 || fv < 0.07 || fv > 0.93;
        if (junta) procPor(px, i, 200 + fino * 30, 196 + fino * 30, 188 + fino * 30);
        else {
          const k = 0.8 + baixo * 0.25 + fino * 0.12;
          procPor(px, i, 235 * k, 170 * k, 140 * k);
        }
      } else if (nome === PROC_ASFALTO) {
        const k = 0.55 + fino * 0.35 + baixo * 0.1;
        const grao = procRnd() < 0.04 ? 40.0 : 0.0;
        procPor(px, i, 150 * k + grao, 150 * k + grao, 155 * k + grao);
      } else if (nome === PROC_METAL) {
        // chapas 2x2 com borda e rebites, riscos horizontais
        const fu = u * 2.0 - Math.floor(u * 2.0);
        const fv = v * 2.0 - Math.floor(v * 2.0);
        const borda = fu < 0.03 || fu > 0.97 || fv < 0.03 || fv > 0.97;
        const rx = fu - 0.08; const ry = fv - 0.08;
        const rebite = (rx * rx + ry * ry) < 0.0012;
        const risco = procRuido(g32, 32, u * 0.2, v) * 0.15;
        let k = 0.78 + baixo * 0.12 + risco;
        if (borda) k = 0.55;
        if (rebite) k = 1.05;
        procPor(px, i, 200 * k, 208 * k, 215 * k);
      } else if (nome === PROC_MADEIRA) {
        // tábuas verticais com veios
        const tab = Math.floor(u * 4.0);
        const fu = u * 4.0 - tab;
        const veio = Math.sin((v * 12.0 + baixo * 3.0 + tab * 1.7) * 6.283) * 0.5 + 0.5;
        let k = 0.75 + veio * 0.15 + fino * 0.1;
        if (fu < 0.04) k = 0.5;
        procPor(px, i, 225 * k, 175 * k, 120 * k);
      } else if (nome === PROC_PISO) {
        // ladrilhos 4x4
        const fu = u * 4.0 - Math.floor(u * 4.0);
        const fv = v * 4.0 - Math.floor(v * 4.0);
        const junta = fu < 0.05 || fv < 0.05;
        const k = junta ? 0.6 : 0.88 + fino * 0.1;
        procPor(px, i, 230 * k, 228 * k, 220 * k);
      } else {
        // concreto (padrão): manchas largas + grão fino + poros
        const poro = procRnd() < 0.015 ? 0.8 : 1.0;
        const k = (0.72 + baixo * 0.2 + fino * 0.1) * poro;
        procPor(px, i, 225 * k, 222 * k, 215 * k);
      }
      x = x + 1;
    }
    y = y + 1;
  }
  return px;
}

/// Id de GPU da textura `nome`, gerada e enviada na primeira chamada por janela
/// (o cache de `uploadTexture` responde as seguintes). Usar com `tile` > 0.
///
/// O cache é consultado ANTES de gerar: gerar custa ~16 ms, e quem resolve a
/// aparência por objeto chama isto milhares de vezes com poucos nomes.
export function procTexture(win: number, nome: string): number {
  const chave = win + ":" + nome;
  const hit = procCache.get(chave);
  if (hit !== undefined && hit > 0) return hit;
  const id = uploadTexture(win, procTexturePixels(nome), PROC_TEX_SIZE, PROC_TEX_SIZE, "proc:" + nome);
  if (id > 0) procCache.set(chave, id);
  return id;
}

const procCache = new Map<string, number>();
