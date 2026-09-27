import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('BUILTIN_COMMANDS lists exactly the dispatch switch cases', () => {
  const cases = [...read('src/editor/control/dispatch.ts').matchAll(/case "([a-z]+)":/g)].map(m => m[1]).sort();
  const listed = [...read('src/editor/control/builtin_commands.ts').matchAll(/c\("([a-z]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(listed, cases);
});
test('the control manifest documents every builtin (help/doc/doc json are generated from it)', () => {
  const src = read('src/editor/control/builtin_commands.ts');
  const grupos = [...src.match(/GRUPOS_COMANDO: string\[\] = \[([^\]]*)\]/)[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]);
  const entradas = [...src.matchAll(/c\("([a-z]+)", "([a-z]+)", (MUTA_NAO|MUTA_SIM|MUTA_PROPRIO), \[([\s\S]*?)\]\)/g)];
  const cases = [...read('src/editor/control/dispatch.ts').matchAll(/case "([a-z]+)":/g)].map(m => m[1]).sort();
  assert.deepEqual(entradas.map(e => e[1]).sort(), cases, 'every switch case has a manifest entry (and vice versa)');
  for (const [, nome, grupo, , corpo] of entradas) {
    assert.ok(grupos.includes(grupo), nome + ': group ' + grupo + ' is declared');
    const usos = [...corpo.matchAll(/"([^"]*)"/g)].map(m => m[1]);
    assert.ok(usos.length > 0, nome + ': has usages');
    for (const uso of usos) {
      assert.ok(uso.startsWith(nome + ' ') || uso.startsWith(nome + ' ::'), nome + ': usage starts with the name: ' + uso);
      assert.equal(uso.split(' :: ').length, 3, nome + ': "syntax :: help :: example": ' + uso);
    }
  }
  assert.doesNotMatch(read('src/editor/control/commands/doc.ts'), /"[a-z]+ [^"]* :: [^"]* :: /, 'doc.ts has no hand-written usage lines');
  assert.doesNotMatch(read('src/editor/control/dispatch.ts'), /c === "spawn"/, 'isMutating reads the manifest');
  assert.doesNotMatch(read('src/editor/control/commands/query.ts'), /cmdHelp/, 'help is generated in doc.ts');
});
test('the game build swaps the component registry by exact alias', () => {
  const cfg = JSON.parse(read('tools/game-build/tsconfig.json'));
  assert.equal(cfg.extends, '../../tsconfig.json');
  assert.deepEqual(cfg.compilerOptions.paths['@engine/generated/components'], ['../../src/engine/generated/components_game.ts']);
  assert.match(read('tools/editor-build.mjs'), /tools\/game-build\/entry\.ts/);
  assert.doesNotMatch(read('src/editor/sceneio.ts'), /\.\.\/engine\/generated\/components/);
  assert.doesNotMatch(read('game.ts'), /editor_extensions/);
});
test('CI builds the game through the swapped registry and checks it', () => {
  const ci = read('.github/workflows/build-executable.yml');
  assert.match(ci, /compile --no-compiler tools\/game-build\/entry\.ts/);
  assert.doesNotMatch(ci, /compile --no-compiler game\.ts/);
  assert.match(ci, /npm run check:game-build/);
  assert.match(read('package.json'), /"check:game-build": "node tools\/rts-run\.mjs tools\/game-build\/check-registro\.ts"/);
});
