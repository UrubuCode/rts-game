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
test('a documentação de áudio cobre componentes, mixer, verificação e migração', () => {
  const doc = read('docs/components.md');
  const secao = doc.slice(doc.indexOf('## Áudio'));
  assert.ok(doc.includes('## Áudio'), 'seção de áudio');
  for (const termo of ['AudioListener', 'AudioSource', 'spatialBlend', 'assets/audio/mixer.json', 'audio nivel', 'audio list', 'AUDIO_NULO', '.ogg', 'playClipAtPoint', 'Audio.setListenerPose'])
    assert.ok(secao.includes(termo), 'a seção de áudio cita ' + termo);
  assert.ok(doc.includes('"type": "audiosource"') || doc.includes('{type:"audiosource"'), 'migração do formato antigo');
  const regras = read('CLAUDE.md');
  assert.ok(regras.includes('## Áudio') && regras.includes('audio nivel'), 'regra do CLAUDE.md');
});
test('a skill do agente RTS puxa comandos/componentes do runtime (contexto.py), sem lista hardcoded no SKILL.md', () => {
  const skill = read('.claude/skills/rts-engine-control/SKILL.md');
  assert.match(skill, /!`python "\$\{CLAUDE_SKILL_DIR\}\/contexto\.py"`/,
    'SKILL.md injeta o contexto ao vivo com !`python "${CLAUDE_SKILL_DIR}/contexto.py"`');
  assert.ok(fs.existsSync(new URL('../.claude/skills/rts-engine-control/contexto.py', import.meta.url)),
    'contexto.py existe ao lado do SKILL.md');
  const nomes = [...read('src/editor/control/builtin_commands.ts').matchAll(/c\("([a-z]+)"/g)].map(m => m[1]);
  const PERMITIDOS = ['contexto', 'doc', 'help', 'shot'];
  // Ignora blocos ``` (exemplos de shell/ws_client.py) e olha só trechos `entre crases simples`.
  const semBlocos = skill.replace(/```[\s\S]*?```/g, '');
  const primeirosTokens = [...semBlocos.matchAll(/`([^`\n]+)`/g)].map(m => m[1].trim().split(/\s+/)[0]);
  for (const tok of primeirosTokens) {
    assert.ok(!nomes.includes(tok) || PERMITIDOS.includes(tok),
      'SKILL.md cita o comando `' + tok + '` num trecho de código: a lista/sintaxe deveria vir só de `contexto`/`doc` (bootstrap permitido: ' + PERMITIDOS.join(', ') + ')');
  }
});

test('todo ícone de source.json está em UI_ICONS.names (senão icon_images lança "Icone desconhecido")', () => {
  const ids = Object.keys(JSON.parse(read('assets/editor/icons/source.json')).icons);
  const m = read('src/editor/ui_config.ts').match(/names: \[(.*?)\],/);
  assert.ok(m, 'UI_ICONS.names');
  const nomes = m[1].split(',').map(s => s.trim().replace(/"/g, ''));
  for (const id of ids) assert.ok(nomes.includes(id), 'UI_ICONS.names inclui ' + id);
});
