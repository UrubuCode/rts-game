// Checagem estática: nenhuma função do motor pode ter 5+ parâmetros E valor
// padrão. No compilador do RTS esse perfil custa ~0,5 µs e uma ALOCAÇÃO por
// chamada, mesmo recebendo todos os argumentos (UrubuCode/rts#2760; 4 params:
// 26 ns; sem padrão: 2,5 ns; opcional `?`: 2,6 ns). Foi isso que deixou as
// consultas espaciais a ~100 µs e o FPS a 13-22 fps, e nenhum teste pegou
// porque os testes verificam a resposta, não o custo.
//
// Em vez de `x: T = v`, use `xArg?: T` e resolva na 1ª linha do corpo:
//   const x: T = xArg !== undefined ? xArg : v;
//
//   node tools/check-params.mjs          # falha (exit 1) listando os casos
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const dirs = ['src', 'assets/scripts'].map(d => path.join(root, d));

function* files(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'generated') yield* files(p); }
    else if (e.name.endsWith('.ts')) yield p;
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

const sig = /(?:export\s+)?(?:function\s+)?(\w+)\s*\(((?:[^()]|\([^()]*\))*)\)\s*:\s*[^;=]+?\{/g;
const bad = [];
for (const dir of dirs) {
  for (const f of files(dir)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(sig)) {
      if (['if', 'while', 'for', 'switch', 'catch', 'return'].includes(m[1])) continue;
      const params = splitParams(m[2]);
      if (params.length < 5) continue;
      const defaults = params.filter(p => /[^=!<>]=[^=>]/.test(p) && !p.includes('=>'));
      if (defaults.length === 0) continue;
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${path.relative(root, f)}:${line} ${m[1]}(${params.length} params, padrão em: ${defaults.map(d => d.split(':')[0].trim()).join(', ')})`);
    }
  }
}
if (bad.length > 0) {
  console.error('[check-params] funções com 5+ parâmetros e valor padrão (custo ~0,5 µs + alocação por chamada no RTS):');
  for (const b of bad) console.error('  ' + b);
  console.error('Troque `x: T = v` por `xArg?: T` e resolva no corpo. Ver tools/check-params.mjs.');
  process.exitCode = 1;
} else {
  console.log('[check-params] nenhuma função com 5+ parâmetros e valor padrão');
}
