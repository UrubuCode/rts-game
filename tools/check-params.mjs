// Checagem estática de parâmetros (rts#2760 e Task 10.5).
//
// 1. Nenhuma função/método com 5+ parâmetros pode ter VALOR PADRÃO: no RTS esse
//    perfil custa ~0,5 µs e uma ALOCAÇÃO por chamada, mesmo recebendo todos os
//    argumentos (4 params: 26 ns; sem padrão: 2,5 ns; opcional `?`: 2,6 ns).
//    Em vez de `x: T = v`, use `xArg?: T` e resolva na 1ª linha do corpo:
//      const x: T = xArg !== undefined ? xArg : v;
//
// 2. Nenhuma função/método com 5+ parâmetros, com ou sem padrão, fora da lista de
//    EXCEÇÕES abaixo. Medido na Task 10.5: com 5+ parâmetros escalares a chamada
//    aloca um bloco por chamada (app.box/text/line: 6-7 coletas em 200k
//    chamadas; a mesma chamada com 4 parâmetros, 0). No caminho por quadro isso
//    virava ~400-700 objetos de lixo por quadro e pausas de GC de 8-48 ms. Use
//    ≤ 4 parâmetros: vetores/retângulos num Float64Array do chamador, estado do
//    próximo desenho num setter (`pincel`, `at`, `area`/`mouse`), ou o objeto
//    que já carrega os dados. Sondas de alocação: 200k iterações com
//    RTS_GC_DEBUG=1 (tests/claude-test-frame-gc.ts).
//
//   node tools/check-params.mjs          # falha (exit 1) listando os casos
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const alvos = ['src', 'assets/scripts', 'assets/pacotes', 'main.ts', 'game.ts'].map(d => path.join(root, d));

// Funções com 5+ parâmetros que ficam, cada uma FORA do caminho por quadro do
// editor e do jogo padrão (ou em subsistemas opcionais ainda não migrados), com
// o motivo. Chave: caminho relativo com "/"; valor: nome → justificativa.
const EXCECOES = {
  'src/compat/app.ts': { createAppAt: 'abre a janela uma vez' },
  'src/compat/render.ts': { image: 'shim antigo usado só pelo harness TCP (fora de serviço); o editor usa @compat/draw2d' },
  'src/editor/thumbs.ts': {
    rasterPart: 'gera a miniatura uma vez por asset (cache por caminho)', proj_y: 'idem', proj_z: 'idem', thumbTri: 'idem',
  },
  'src/engine/audio/audio.ts': {
    playToneAt: 'API de script por evento (tom posicional de antes)', playSquareAt: 'API de script por evento', playNoiseAt: 'API de script por evento',
  },
  'src/engine/core/animator_controller.ts': { fillTransition: 'ao carregar o controlador (JSON)' },
  'src/engine/core/hull.ts': {
    addFaceInto: 'construção da casca convexa ao carregar o collider', growHull: 'idem', distinctPoints: 'idem', hullContains: 'idem',
  },
  'src/engine/core/logger.ts': { constructor: 'LogEntry: um por mensagem de log (evento), não por quadro' },
  'src/engine/core/scene.ts': { createGameObject: 'criação pelo editor/menu (clique), não por quadro' },
  'src/engine/core/spatial_queries.ts': Object.fromEntries([
    'raycastNonAlloc', 'overlapSphereNonAlloc', 'overlapBoxNonAlloc', 'rebuildDynamicsInto', 'raycastObject',
    'raycastStaticGridDDA', 'raycastDynamicsDDA', 'raycast', 'overlapSphereObject', 'testOverlapSphereObject',
    'overlapSphereInto', 'overlapSphereDynamicsInto', 'overlapSphere', 'overlapBoxObject', 'testOverlapBoxObject',
    'overlapBoxInto', 'overlapBoxDynamicsInto', 'overlapBox',
  ].map(n => [n, 'PENDÊNCIA (follow-up Task 10.5): API pública de consultas (Physics.Raycast/Overlap estilo Unity) e seus kernels, por quadro quando um script consulta; migrar muda a assinatura dos scripts — não é exceção permanente (rts#2760)'])),
  'src/engine/fluid/cpufluid.ts': {
    cfSetState: 'fluido (demo opcional) — setup', cfSpawnBlock: 'fluido — setup',
    densityPass: 'PENDÊNCIA (follow-up Task 10.5): por quadro quando há fluido (demo opcional, fora do editor/jogo padrão) — migrar, não é exceção permanente', forcePass: 'PENDÊNCIA: idem densityPass',
  },
  'src/engine/fluid/fluid.ts': { flSpawnBlock: 'fluido — setup' },
  'src/engine/fluid/gpufluid.ts': { gfSpawnBlock: 'fluido — setup', gfSetState: 'fluido — setup' },
  'src/engine/render/draw.ts': { drawCube: 'rasterizador por software legado (harness)', drawGrid: 'idem', drawSeg: 'idem' },
  'src/engine/render/gltf_anim.ts': { quatFromMat3: 'ao carregar o glTF', buildParts: 'idem', readChannel: 'idem', readClips: 'importação das animações, apenas ao carregar o glTF' },
  'src/engine/render/loading_screen.ts': { rect: 'monta geometria retida somente na criação ou mudança de tamanho da janela', text: 'monta rótulos retidos somente na criação ou mudança de tamanho da janela' },
  'src/engine/render/gpu3d.ts': {
    pushV: 'monta as malhas primitivas uma vez (initMeshes)', uploadTexture: 'uma vez por textura',
    drawGPUMesh: 'invólucro antigo para demos/harness; o motor usa drawGPUMeshBuf', drawGPU: 'idem (drawGPUBuf)',
    setCam: 'invólucro antigo para demos; o motor usa setCamBuf', setLgt: 'idem (setLgtBuf)', setShadow: 'idem (setShadowBuf)',
    inFrustum: 'comando WS de diagnóstico', frustumBegin: 'invólucro antigo; o motor usa frustumBeginBuf',
  },
  'src/engine/render/mesh.ts': { drawMeshSolid: 'rasterizador por software legado' },
  'src/engine/render/model.ts': {
    emitFace: 'ao carregar/gerar malha', emitTri: 'idem', pushCorner: 'idem', buildPrimitive: 'idem', sphTri: 'idem', pushRaw: 'idem',
  },
  'src/engine/render/proc_textures.ts': { procPor: 'gera a textura procedural uma vez' },
  'src/engine/render/raster.ts': { fillTri: 'rasterizador por software legado', drawCubeSolid: 'idem', drawFloor: 'idem', projFloorTri: 'idem' },
  'src/engine/rigid/cpurigid.ts': { crSetBody: 'sincronização de corpo no backend Rust (quando a cena muda), não o passo' },
  'src/engine/rigid/gpurigid.ts': { rbSetBody: 'sincronização de corpo no backend GPU (quando a cena muda)' },
  'src/engine/rigid/materials.ts': { matWriteBody: 'escreve o material do corpo na sincronização', matWriteStatic: 'idem' },
  'src/engine/ui/uipanel.ts': { constructor: 'UIPanel construído uma vez' },
  'src/engine/testkit/dump.ts': {
    asciiFrame: 'ferramenta de teste', asciiFrameStr: 'idem', dumpObject: 'idem', dumpCamera: 'idem', savePPM: 'idem',
  },
  'src/scripts/fluid.ts': {
    setBounds: 'script de fluido (demo opcional)', buildFluidGrid: 'idem', computeDensity: 'idem', computeForces: 'idem', integrate: 'idem',
  },
  'main.ts': { ctxCreate: 'menu Criar (clique)' },
};

function* files(p) {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isFile()) { if (p.endsWith('.ts')) yield p; return; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) { if (e.name !== 'generated') yield* files(q); }
    else if (e.name.endsWith('.ts')) yield q;
  }
}

function splitParams(ps) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of ps) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Declarações: `function f(...)`, métodos `f(...)` / `constructor(...)`, com ou
// sem tipo de retorno, seguidos de `{`; e arrow functions `(…) =>`.
const sig = /(?:^|[\s;{}])(?:export\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*\(((?:[^()]|\([^()]*\))*)\)\s*(?::\s*[^;={]+?)?\{/g;
const arrow = /(\w+)\s*=\s*\(((?:[^()]|\([^()]*\))*)\)\s*(?::\s*[^;={]+?)?=>/g;
const NAO = ['if', 'while', 'for', 'switch', 'catch', 'return', 'function', 'else', 'do', 'new', 'typeof'];
const comPadrao = [];
const semExcecao = [];
const usadas = new Set();
for (const alvo of alvos) {
  for (const f of files(alvo)) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    for (const re of [sig, arrow]) {
      for (const m of src.matchAll(re)) {
        if (NAO.includes(m[1])) continue;
        const params = splitParams(m[2]).map(p => p.trim()).filter(p => p.length > 0);
        if (params.length < 5) continue;
        // tipos-parâmetro de chamada (ex.: `foo(a, b, c, d, e) {` num literal) só contam se têm anotação ou são nomes simples
        const line = src.slice(0, m.index).split('\n').length;
        const defaults = params.filter(p => /[^=!<>]=[^=>]/.test(p) && !p.includes('=>'));
        if (defaults.length > 0) comPadrao.push(`${rel}:${line} ${m[1]}(${params.length} params, padrão em: ${defaults.map(d => d.split(':')[0].trim()).join(', ')})`);
        const exc = EXCECOES[rel] && EXCECOES[rel][m[1]];
        if (exc) { usadas.add(rel + '#' + m[1]); continue; }
        semExcecao.push(`${rel}:${line} ${m[1]}(${params.length} params)`);
      }
    }
  }
}
let falhou = false;
if (comPadrao.length > 0) {
  console.error('[check-params] funções com 5+ parâmetros e valor padrão (custo ~0,5 µs + alocação por chamada no RTS):');
  for (const b of comPadrao) console.error('  ' + b);
  console.error('Troque `x: T = v` por `xArg?: T` e resolva no corpo.');
  falhou = true;
}
if (semExcecao.length > 0) {
  console.error('[check-params] funções com 5+ parâmetros (alocam por chamada no RTS; no caminho por quadro use ≤ 4):');
  for (const b of semExcecao) console.error('  ' + b);
  console.error('Passe vetores/retângulos num Float64Array, ou o estado do próximo desenho por um setter;');
  console.error('se a função não roda por quadro, acrescente-a a EXCECOES em tools/check-params.mjs com o motivo.');
  falhou = true;
}
const sobrando = [];
for (const [rel, fns] of Object.entries(EXCECOES)) for (const n of Object.keys(fns)) if (!usadas.has(rel + '#' + n)) sobrando.push(rel + '#' + n);
if (sobrando.length > 0) {
  console.error('[check-params] exceções que não casam mais com nenhuma função (remova de EXCECOES):');
  for (const s of sobrando) console.error('  ' + s);
  falhou = true;
}
if (falhou) process.exitCode = 1;
else console.log(`[check-params] ok: nenhuma função com 5+ parâmetros e padrão; 5+ parâmetros só nas ${usadas.size} exceções justificadas`);
