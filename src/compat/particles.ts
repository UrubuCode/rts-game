// `rts:egui` — fallback de `drawParticles` (Task 1, repo `rts`, PR ainda em
// andamento em `feat/particulas-nativo`).
//
// A primitiva pode faltar em binários mais antigos do `rts.exe`. Sem ela a
// SIMULAÇÃO continua normalmente (o pool de partículas não depende de
// desenho, ver `engine/particles/*`); só o desenho é pulado, com um aviso
// ÚNICO no log — o mesmo padrão de `compat/gpu.ts`/`compat/rigid.ts`
// (`typeof fn === "function"` sobre um `import * as`), não o de `nativo` do
// `compat/audio.ts` (chamada direta com try/catch): um `import { x } from
// "rts:egui"` de um membro ausente não lança (o bundler devolve `undefined`),
// então a detecção não precisa invocar o nativo nenhuma vez — só olhar o tipo.
import * as egui from "rts:egui";
import { logWarn } from "@engine/core/logger";

const AVISO_SEM_NATIVO: string = "Partículas: drawParticles ausente neste binário do rts; simulação continua, sem desenho.";
let avisou: number = 0;
/// -1 = ainda não checado, 0 = ausente, 1 = presente. Checado uma vez (não por
/// quadro) — "Custo por quadro" proíbe `try/catch` em caminho por quadro, e
/// aqui nem `try/catch` é preciso: só `typeof`.
let disponivel: number = -1;

function calcularDisponivel(): number {
  return typeof (egui as any).drawParticles === "function" ? 1 : 0;
}

/// 1 se o binário atual do rts expõe `drawParticles` (Task 1). Resultado
/// calculado uma vez e reaproveitado — nunca refeito por quadro.
export function temDrawParticles(): boolean {
  if (disponivel < 0) disponivel = calcularDisponivel();
  return disponivel !== 0;
}

/// Caminho por quadro: SEM `try/catch` aqui — a checagem de presença já foi
/// feita (e fica em cache) em `temDrawParticles`. `buf` tem `PART_FLOATS` (9)
/// floats por partícula (layout da Task 1); devolve o número de partículas
/// desenhadas (0 = recusado ou nativo ausente).
export function drawParticlesSeguro(win: number, buf: Float32Array, n: number, modo: number): number {
  if (!temDrawParticles()) {
    if (avisou === 0) { logWarn(AVISO_SEM_NATIVO); avisou = 1; }
    return 0;
  }
  return (egui as any).drawParticles(win, buf, n, modo);
}

// ── Variante com textura (Task 1, relatório): `drawParticlesTex` ──────────
//
// A ABI nativa (`rts-core::entry::native::Native`) só tem 3 slots além de
// `win`; `buf/tex/n/modo` (4 valores) não cabem posicionalmente, então o
// nativo real é `drawParticlesTex(win, { buf, tex, n, modo })` — um objeto de
// opções, no molde de `drawMesh`. Só ISSO já daria 2 parâmetros no wrapper
// (win, spec), mas monta o objeto por chamada seria alocação por quadro (o
// mesmo problema que "Custo por quadro" proíbe). Em vez disso: `setParticleTex`
// é o setter (estado do próximo desenho, como `pincel`/`estiloTexto`) que só
// grava `tex` num objeto de opções ÚNICO e reaproveitado por módulo;
// `drawParticlesTexSeguro` mantém 4 parâmetros escalares/array (win, buf, n,
// modo) e só MUTA os campos desse mesmo objeto antes de chamar o nativo —
// nunca cria um objeto novo por chamada.
const AVISO_SEM_NATIVO_TEX: string = "Partículas: drawParticlesTex ausente neste binário do rts; simulação continua, sem desenho com textura.";
let avisouTex: number = 0;
let disponivelTex: number = -1;
/// Objeto de opções ÚNICO, reaproveitado entre quadros (mutado em
/// `drawParticlesTexSeguro`/`setParticleTex`, nunca recriado).
const specTex: { buf: Float32Array; tex: number; n: number; modo: number } = { buf: new Float32Array(0), tex: 0, n: 0, modo: 0 };

function calcularDisponivelTex(): number {
  return typeof (egui as any).drawParticlesTex === "function" ? 1 : 0;
}

/// 1 se o binário atual do rts expõe `drawParticlesTex` (Task 1). Calculado
/// uma vez e reaproveitado — nunca refeito por quadro.
export function temDrawParticlesTex(): boolean {
  if (disponivelTex < 0) disponivelTex = calcularDisponivelTex();
  return disponivelTex !== 0;
}

/// Estado do próximo `drawParticlesTexSeguro` (o `tex` não cabe nos 4
/// parâmetros do wrapper — ver comentário acima). Vale para as chamadas
/// seguintes até o próximo `setParticleTex(win, 0)`. 2 parâmetros.
export function setParticleTex(win: number, tex: number): void {
  specTex.tex = tex;
}

/// Caminho por quadro: SEM `try/catch` aqui (mesmo padrão de
/// `drawParticlesSeguro`). `buf` tem `PART_FLOATS` (9) floats por partícula;
/// devolve o número de partículas desenhadas (0 = recusado ou nativo
/// ausente). `tex` vem de `setParticleTex`, já gravado em `specTex` — esta
/// função só ajusta `buf/n/modo` no MESMO objeto, sem alocar.
export function drawParticlesTexSeguro(win: number, buf: Float32Array, n: number, modo: number): number {
  if (!temDrawParticlesTex()) {
    if (avisouTex === 0) { logWarn(AVISO_SEM_NATIVO_TEX); avisouTex = 1; }
    return 0;
  }
  specTex.buf = buf; specTex.n = n; specTex.modo = modo;
  return (egui as any).drawParticlesTex(win, specTex);
}
