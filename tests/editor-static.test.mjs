import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('BUILTIN_COMMANDS lists exactly the dispatch switch cases', () => {
  const cases = [...read('src/editor/control/dispatch.ts').matchAll(/case "([a-z]+)":/g)].map(m => m[1]).sort();
  const listed = [...read('src/editor/control/builtin_commands.ts').matchAll(/"([a-z]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(listed, cases);
});
test('the game build swaps the component registry by exact alias', () => {
  const cfg = JSON.parse(read('tools/game-build/tsconfig.json'));
  assert.equal(cfg.extends, '../../tsconfig.json');
  assert.deepEqual(cfg.compilerOptions.paths['@engine/generated/components'], ['../../src/engine/generated/components_game.ts']);
  assert.match(read('tools/editor-build.mjs'), /tools\/game-build\/entry\.ts/);
  assert.doesNotMatch(read('src/editor/sceneio.ts'), /\.\.\/engine\/generated\/components/);
  assert.doesNotMatch(read('game.ts'), /editor_extensions/);
});
