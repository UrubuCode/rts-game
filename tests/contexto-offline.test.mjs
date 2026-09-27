// Testa .claude/skills/rts-engine-control/contexto.py no CAMINHO OFFLINE (sem
// editor escutando): roda o script de verdade (node --test, sem pytest no
// projeto) contra uma porta que ninguém abre, e confere que ele lista
// comandos e componentes lidos do CÓDIGO-FONTE (docs/ws-comandos.md e
// src/engine/generated/component_catalog.ts), não uma lista hardcoded.
//
//   node --test tests/contexto-offline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, '.claude', 'skills', 'rts-engine-control', 'contexto.py');
const PORTA_LIVRE = 18333; // ninguém escuta aqui: força o caminho offline

function rodar(args, cwd) {
  const r = spawnSync('python', [script, '--port', String(PORTA_LIVRE), '--timeout', '0.2', ...args],
    { cwd: cwd ?? root, encoding: 'utf8', windowsHide: true, timeout: 90_000, env: { ...process.env, RTS_COMPILER: '' } });
  if (r.error) throw r.error;
  return r.stdout;
}

test('sem editor escutando, cai no caminho offline (não trava, não conecta)', () => {
  const out = rodar([]);
  assert.match(out, /editor fechado/, 'avisa que é o contexto do código-fonte: ' + out.slice(0, 200));
});

test('offline: lista comandos que existem em docs/ws-comandos.md (não hardcoded no script)', () => {
  const out = rodar(['comandos']);
  const doc = fs.readFileSync(path.join(root, 'docs', 'ws-comandos.md'), 'utf8');
  for (const nome of ['spawn', 'setfield', 'contexto', 'describe']) {
    assert.ok(doc.includes('`' + nome), nome + ' está em docs/ws-comandos.md (senão o teste não prova nada)');
    assert.ok(out.includes(nome), 'contexto.py offline lista ' + nome + ': ' + out.slice(0, 300));
  }
  assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /"spawn"|'spawn'/, 'contexto.py não tem o nome de um comando escrito à mão');
});

test('offline: lista componentes do catálogo gerado (não hardcoded no script)', () => {
  const out = rodar(['componentes']);
  const catalogo = JSON.parse(
    fs.readFileSync(path.join(root, 'src', 'engine', 'generated', 'component_catalog.ts'), 'utf8')
      .match(/COMPONENT_CATALOG\s*=\s*(\[[\s\S]*?\n\]);/)[1]
  );
  assert.ok(catalogo.length > 5, 'o catálogo gerado tem componentes de verdade');
  for (const c of catalogo.slice(0, 5)) assert.ok(out.includes(c.name), 'contexto.py offline lista ' + c.name);
  assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /"Spinner"|'Spinner'|"AudioSource"|'AudioSource'/,
    'contexto.py não tem nome de componente escrito à mão');
});

test('offline: lista os itens de menu gerados', () => {
  const out = rodar(['menus']);
  const menus = JSON.parse(
    fs.readFileSync(path.join(root, 'src', 'engine', 'generated', 'editor_extensions.ts'), 'utf8')
      .match(/MENU_ITEMS:\s*string\[\]\s*=\s*(\[[^\]]*\]);/)[1]
  );
  for (const m of menus) assert.ok(out.includes(m), 'contexto.py offline lista o item de menu ' + m);
});

test('offline: lista as pastas de assets/pacotes lidas do disco agora', () => {
  const out = rodar(['pacotes']);
  const pastas = fs.readdirSync(path.join(root, 'assets', 'pacotes')).filter(nm =>
    fs.statSync(path.join(root, 'assets', 'pacotes', nm)).isDirectory());
  for (const p of pastas) assert.ok(out.includes(p), 'contexto.py offline lista o pacote ' + p);
});

test('funciona de qualquer cwd (caminhos relativos ao __file__, não ao diretório atual)', () => {
  const fora = path.dirname(root); // um nível acima do worktree: cwd bem diferente do projeto
  const out = rodar(['pacotes'], fora);
  assert.match(out, /\[pacotes\]/, 'roda de ' + fora + ': ' + out.slice(0, 200));
});
