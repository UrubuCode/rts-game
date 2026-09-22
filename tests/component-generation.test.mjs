import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverComponents, renderComponents, generateComponents } from '../tools/generate-components.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rts-component-test-'));
  function write(relative, source) {
    const target = path.resolve(root, relative);
    assert.ok(target.startsWith(root + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
  }
  write('src/engine/core/behavior.ts', 'export class Behavior {}');
  t.after(() => {
    assert.ok(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('rts-component-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, write };
}
const importBase = 'import { Behavior } from "../../src/engine/core/behavior";\n';

test('public primitives, private/protected, markers, static, readonly, methods and inferred types', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/Test.ts', importBase + `
    export class Test extends Behavior {
      public speed: number = 2;
      moving = true;
      label = "Player";
      private runtime: number = 0;
      protected internal: string = "";
      static count: number = 0;
      readonly fixed: number = 1;
      #secret: number = 3;
      get derived() { return 4; }
      /** @serializeField */
      private exposed: number = 5;
      /** @hideInInspector */
      public savedHidden: string = "kept";
      /** @nonSerialized */
      cache: object = {};
      /** @label Potencia
       * @range 0 10 */
      power: f64 = 2;
    }
  `);
  const [entry] = discoverComponents(root);
  assert.deepEqual(entry.fields.map(f => f.name), ['speed', 'moving', 'label', 'exposed', 'savedHidden', 'power']);
  assert.deepEqual(entry.fields.slice(0, 3).map(f => f.kind), ['number', 'boolean', 'string']);
  assert.equal(entry.fields[4].visible, false);
  assert.deepEqual(entry.fields[5].range, [0, 10]);
  assert.equal(entry.fields[5].label, 'Potencia');
});

test('inheritance, imported aliases, constructors with defaults and derived dispatch first', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/Base.ts', importBase + `export abstract class Base extends Behavior {
    public inherited: number = 1;
  }`);
  write('assets/scripts/Derived.ts', `import { Base as Parent } from './Base';
    export class Derived extends Parent { constructor(public caption: string = 'New') { super(); } }
    export class Child extends Derived { public amount: number = 2; }
  `);
  const entries = discoverComponents(root);
  assert.deepEqual(entries.map(e => e.name), ['Child', 'Derived']);
  assert.deepEqual(entries[0].fields.map(f => f.name), ['inherited', 'caption', 'amount']);
  const generated = renderComponents(entries)['src/engine/generated/components.ts'];
  assert.ok(generated.indexOf('component instanceof Component0') < generated.indexOf('component instanceof Component1'));
});

test('adding, editing and removing scripts regenerates catalog deterministically', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/Foo.ts', importBase + 'export class Foo extends Behavior { value: number = 1; }');
  generateComponents(root); generateComponents(root, true);
  write('assets/scripts/Foo.ts', importBase + 'export class Foo extends Behavior { value: number = 1; text: string = ""; }');
  assert.throws(() => generateComponents(root, true), /desatualizado/);
  generateComponents(root); generateComponents(root, true);
  fs.unlinkSync(path.join(root, 'assets/scripts/Foo.ts'));
  assert.throws(() => generateComponents(root, true), /desatualizado/);
  assert.deepEqual(generateComponents(root), []);
});

test('unrelated classes and ignored/abstract components never enter registry', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/Other.ts', importBase + `
    export class Utility { value = 1; }
    /** @componentIgnore */
    export class Internal extends Behavior { constructor(required: number) { super(); } }
    class NotExported extends Behavior {}
    export abstract class Abstract extends Behavior {}
  `);
  assert.deepEqual(discoverComponents(root), []);
});

test('duplicate names, required arguments and unsupported public fields fail explicitly', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/A.ts', importBase + 'export class A extends Behavior { values: number[] = []; }');
  assert.throws(() => discoverComponents(root), /Tipo nao suportado/);
  write('assets/scripts/A.ts', importBase + 'export class A extends Behavior { constructor(required: number) { super(); } }');
  assert.throws(() => discoverComponents(root), /valores padrao/);
  write('assets/scripts/A.ts', importBase + 'export class A extends Behavior {}');
  write('assets/scripts/B.ts', importBase + 'export class A extends Behavior {}');
  assert.throws(() => discoverComponents(root), /duplicado/);
});

test('bad range and private #field exposure produce actionable errors', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/A.ts', importBase + `export class A extends Behavior {
    /** @range 20 1 */
    speed: number = 2;
  }`);
  assert.throws(() => discoverComponents(root), /@range/);
  write('assets/scripts/A.ts', importBase + `export class A extends Behavior {
    /** @serializeField */
    #value: number = 2;
  }`);
  assert.throws(() => discoverComponents(root), /#private/);
});

test('generation parses source without executing module side effects', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/Safe.ts', importBase + `throw new Error('DO NOT EXECUTE');
    /** @componentId stable.player
     * @componentCategory Gameplay */
    export class Safe extends Behavior { health: number = 100; }
  `);
  const [entry] = discoverComponents(root);
  assert.equal(entry.id, 'stable.player'); assert.equal(entry.category, 'Gameplay');
});

test('unresolved Behavior imports and invalid project configuration fail instead of dropping scripts', t => {
  const { root, write } = fixture(t);
  write('assets/scripts/Bad.ts', `import { Behavior } from './missing'; export class Bad extends Behavior {}`);
  assert.throws(() => discoverComponents(root), /resolver Behavior/);
  write('tsconfig.json', '{ invalid JSON');
  assert.throws(() => discoverComponents(root));
});
