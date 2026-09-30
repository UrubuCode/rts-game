import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slash = value => value.replaceAll('\\', '/');
const quote = value => JSON.stringify(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))
    .flatMap(entry => entry.isSymbolicLink() ? [] : entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) :
      entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path.join(dir, entry.name)] : []);
}
function tags(node) {
  return new Map(ts.getJSDocTags(node).map(tag => [tag.tagName.text,
    typeof tag.comment === 'string' ? tag.comment.trim() : tag.comment?.map(part => part.text).join('').trim() ?? '']));
}
const hasModifier = (node, kind) => node.modifiers?.some(mod => mod.kind === kind) ?? false;
const hasMethod = (nodes, name) => nodes.some(node => node.members.some(member =>
  ts.isMethodDeclaration(member) && member.name.getText() === name));
const humanize = name => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

export const ROOTS = ['src/engine/core', 'src/scripts', 'assets/scripts', 'assets/pacotes'];
/// `@asset <kind>` num campo string: o Inspector automático desenha um
/// ObjectField (caixa+seletor+arraste) em vez de uma caixa de texto, filtrado
/// pelas extensões do tipo (ver ASSET_KINDS em src/editor/ui_config.ts).
export const ASSET_KINDS = ['audio', 'imagem', 'modelo', 'prefab', 'cena', 'script'];
export const MENU_ROOTS = ['Criar', 'Janela'];
/// `/** @editorOnly */` no comentário de abertura do arquivo: o arquivo fica fora do jogo exportado.
export function isEditorOnly(source) {
  return (ts.getLeadingCommentRanges(source.text, 0) ?? []).some(r => /@editorOnly\b/.test(source.text.slice(r.pos, r.end)));
}

function createProject(root) {
  const files = ROOTS.map(dir => path.join(root, dir)).flatMap(filesUnder);
  const configPath = path.join(root, 'tsconfig.json');
  const configResult = fs.existsSync(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile) : { config: {} };
  if (configResult.error) throw new Error(ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n'));
  const converted = ts.convertCompilerOptionsFromJson(configResult.config.compilerOptions ?? {}, root);
  if (converted.errors.length) throw new Error(converted.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const options = converted.options;
  const program = ts.createProgram(files, { ...options, noLib: true, noEmit: true, target: ts.ScriptTarget.ESNext });
  const checker = program.getTypeChecker();
  const diagnostics = program.getSyntacticDiagnostics();
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  function fail(node, message) {
    const source = node.getSourceFile();
    const pos = source.getLineAndCharacterOfPosition(node.getStart());
    throw new Error(`${slash(path.relative(root, source.fileName))}:${pos.line + 1}: ${message}`);
  }
  return { files, program, checker, fail };
}

export function discoverComponents(root = projectRoot, project = createProject(root)) {
  const { files, program, checker, fail } = project;
  const baseFile = slash(path.resolve(root, 'src/engine/core/behavior.ts'));
  function parent(node) {
    const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    if (!heritage) return null;
    let symbol = checker.getSymbolAtLocation(heritage.expression);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations?.find(ts.isClassDeclaration) ?? null;
  }
  function ancestry(node) {
    const chain = []; const seen = new Set();
    while (node && !seen.has(node)) {
      if (node.name?.text === 'Behavior' && slash(path.resolve(node.getSourceFile().fileName)) === baseFile) return chain;
      seen.add(node); chain.unshift(node); node = parent(node);
    }
    return null;
  }
  function fieldType(member) {
    const annotation = member.type?.getText();
    if (['number', 'f64', 'f32', 'i32', 'i64', 'u32', 'u64'].includes(annotation)) return 'number';
    if (annotation === 'boolean' || annotation === 'string') return annotation;
    const type = checker.getTypeAtLocation(member);
    if (type.flags & ts.TypeFlags.NumberLike) return 'number';
    if (type.flags & ts.TypeFlags.BooleanLike) return 'boolean';
    if (type.flags & ts.TypeFlags.StringLike) return 'string';
    return null;
  }
  const result = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    for (const node of source.statements) {
      if (!ts.isClassDeclaration(node) || !node.name || !hasModifier(node, ts.SyntaxKind.ExportKeyword)) continue;
      const chain = ancestry(node);
      const metadata = tags(node);
      if (chain === null && node.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ExtendsKeyword &&
          clause.types.some(type => type.expression.getText() === 'Behavior'))) fail(node, 'Nao foi possivel resolver Behavior. Confira o import da classe base.');
      if (!chain?.length || metadata.has('componentIgnore') || hasModifier(node, ts.SyntaxKind.AbstractKeyword)) continue;
      if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) fail(node, 'Use uma classe exportada com nome, nao export default.');
      const constructor = [...chain].reverse().flatMap(item => item.members.filter(ts.isConstructorDeclaration))[0];
      if (constructor?.parameters.some(param => !param.initializer && !param.questionToken && !param.dotDotDotToken)) {
        fail(constructor, 'Componente precisa poder ser criado sem argumentos. Defina valores padrao no construtor.');
      }
      const customInspector = hasMethod(chain, 'fieldCount');
      const customSerialization = hasMethod(chain, 'toData');
      const gizmos = hasMethod(chain, 'onDrawGizmos') || hasMethod(chain, 'onDrawGizmosSelected');
      const factory = metadata.get('componentFactory');
      if (factory && !node.members.some(member => ts.isMethodDeclaration(member) &&
          member.name.getText() === factory && hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
          member.parameters.every(param => param.initializer || param.questionToken))) fail(node, '@componentFactory precisa indicar um metodo static sem argumentos obrigatorios.');
      const fields = new Map();
      if (!customInspector || !customSerialization) {
        for (const owner of chain) {
          const members = owner.members.flatMap(member => ts.isConstructorDeclaration(member) ?
            member.parameters.filter(param => ts.isParameterPropertyDeclaration(param, member)) : [member]);
          for (const member of members) {
            if (!ts.isPropertyDeclaration(member) && !ts.isParameter(member)) continue;
            const fieldTags = tags(member);
            const excluded = hasModifier(member, ts.SyntaxKind.StaticKeyword) || hasModifier(member, ts.SyntaxKind.ReadonlyKeyword) || fieldTags.has('nonSerialized');
            const hidden = hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword) || ts.isPrivateIdentifier(member.name);
            if (excluded || (hidden && !fieldTags.has('serializeField'))) continue;
            if (!ts.isIdentifier(member.name)) fail(member, 'Campos serializados precisam de nome simples; #private nao pode ser exposto.');
            if (member.questionToken) fail(member, 'Campo serializado opcional nao e suportado; forneca um valor padrao.');
            const kind = fieldType(member);
            if (!kind) fail(member, `Tipo nao suportado em ${member.name.text}. Use number/boolean/string, ou private/@nonSerialized.`);
            let range = null;
            if (fieldTags.has('range')) {
              range = fieldTags.get('range').split(/\s+/).map(Number);
              if (kind !== 'number' || range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1]) fail(member, '@range requer minimo e maximo numericos validos.');
            }
            let asset = null;
            if (fieldTags.has('asset')) {
              asset = fieldTags.get('asset').trim();
              if (kind !== 'string') fail(member, '@asset so vale em campo string.');
              if (!ASSET_KINDS.includes(asset)) fail(member, `@asset "${asset}" invalido. Use um de: ${ASSET_KINDS.join(', ')}.`);
            }
            fields.set(member.name.text, { name: member.name.text, kind, range, asset,
              label: fieldTags.get('label') || humanize(member.name.text),
              visible: !fieldTags.has('hideInInspector'),
            });
          }
        }
      }
      const relative = slash(path.relative(root, file));
      result.push({ name: node.name.text, source: relative, depth: chain.length,
        id: metadata.get('componentId') || `script:${relative}#${node.name.text}`,
        category: metadata.get('componentCategory') || 'Scripts',
        description: metadata.get('componentDescription') || `Componente definido em ${relative}.`,
        keywords: metadata.get('componentKeywords') || '',
        factory, customInspector, customSerialization, gizmos, fields: [...fields.values()],
        editorOnly: isEditorOnly(source),
      });
    }
  }
  const names = new Set(); const ids = new Set();
  for (const entry of result) {
    if (names.has(entry.name) || ids.has(entry.id)) throw new Error(`Componente duplicado: ${entry.name} (${entry.source}). Use nomes e IDs unicos.`);
    names.add(entry.name); ids.add(entry.id);
  }
  return result.sort((a, b) => compare(a.category, b.category) || compare(a.name, b.name));
}

const header = '// GERADO por tools/generate-components.mjs. Edite as classes .ts, nao este arquivo.\n';
/// Um registro (fábrica + reflexão) para `entries`; `marker` diz qual ("editor" ou "jogo").
function renderRegistry(entries, marker) {
  const alias = new Map(entries.map((e, i) => [e, 'Component' + i]));
  const imports = entries.map(entry => {
    const relative = slash(path.posix.relative('src/engine/generated', entry.source)).replace(/\.ts$/, '');
    return `import { ${entry.name} as ${alias.get(entry)} } from ${quote(relative.startsWith('.') ? relative : './' + relative)};`;
  });
  // Filhos antes dos pais: instanceof tambem reconhece uma subclasse.
  const ordered = [...entries].sort((a, b) => b.depth - a.depth);
  function method(name, args, type, fallback, bodyFor) {
    return `  ${name}(component: any${args}): ${type} {\n` + ordered.map(entry => {
      const body = bodyFor(entry);
      return `    if (component instanceof ${alias.get(entry)}) {\n${body || `      return ${fallback};`}\n    }\n`;
    }).join('') + `${type === 'void' ? '' : `    return ${fallback};\n`}  }\n`;
  }
  const visible = entry => entry.customInspector ? [] : entry.fields.filter(field => field.visible);
  const lookup = (fields, value, fallback) => fields.map((field, index) => `      if (index === ${index}) return ${value(field)};`).join('\n') + `\n      return ${fallback};`;
  const access = field => `component[${quote(field.name)}]`;
  const coerce = (field, value) => field.kind === 'boolean' ? `${value} !== 0` : field.range ? `Math.max(${field.range[0]}, Math.min(${field.range[1]}, ${value}))` : value;
  function restoreFields(entry, source) {
    return entry.fields.map(field => {
      const prop = `${source}[${quote(field.name)}]`;
      const valid = field.kind === 'number' ? `${prop} === ${prop} && ${prop} > -1e30 && ${prop} < 1e30` : 'true';
      const value = field.range ? `Math.max(${field.range[0]}, Math.min(${field.range[1]}, ${prop}))` : prop;
      return `      if (typeof ${prop} === ${quote(field.kind)} && ${valid}) component[${quote(field.name)}] = ${value};`;
    }).join('\n');
  }
  let provider = 'class GeneratedReflection extends ComponentReflection {\n';
  provider += '  create(name: string): any { return createRegisteredComponent(name); }\n';
  provider += method('name', '', 'string', '"Script"', entry => `      return ${quote(entry.name)};`);
  provider += method('fieldCount', '', 'number', '0', entry => `      return ${visible(entry).length};`);
  provider += method('fieldLabel', ', index: number', 'string', '""', entry => lookup(visible(entry), field => quote(field.label), '""'));
  provider += method('fieldName', ', index: number', 'string', '""', entry => lookup(visible(entry), field => quote(field.name), '""'));
  provider += method('fieldType', ', index: number', 'string', '"number"', entry => lookup(visible(entry), field => quote(field.kind), '"number"'));
  provider += method('fieldHint', ', index: number', 'string', '""', entry => lookup(visible(entry), field => quote(field.asset ? 'asset:' + field.asset : ''), '""'));
  // Kind CRU do `@asset` (sem o prefixo "asset:"), separado de `fieldHint` pra
  // o Inspector (caminho por quadro) nunca precisar de `.slice()` em cima do
  // hint pra achar o tipo — string nova por quadro, proibido pelo CLAUDE.md.
  // Ambos os métodos devolvem o MESMO literal gerado (sem alocação nos dois).
  provider += method('fieldAssetKind', ', index: number', 'string', '""', entry => lookup(visible(entry), field => quote(field.asset || ''), '""'));
  provider += method('fieldGet', ', index: number', 'f64', '0', entry => lookup(visible(entry), field => field.kind === 'string' ? '0' : field.kind === 'boolean' ? `(${access(field)} ? 1 : 0)` : access(field), '0'));
  provider += method('fieldStringGet', ', index: number', 'string', '""', entry => lookup(visible(entry), field => field.kind === 'string' ? access(field) : '""', '""'));
  for (const stringMode of [false, true]) {
    provider += method(stringMode ? 'fieldStringSet' : 'fieldSet', `, index: number, value: ${stringMode ? 'string' : 'f64'}`, 'void', '', entry =>
      visible(entry).map((field, index) => (field.kind === 'string') !== stringMode ? '' :
        `      if (index === ${index}) { ${stringMode ? '' : 'if (value !== value || value <= -1e30 || value >= 1e30) return; '}${access(field)} = ${coerce(field, 'value')}; component.onValidate(${quote(field.name)}); return; }`).join('\n') + '\n      return;');
  }
  provider += method('serialize', '', 'any', 'null', entry => entry.customSerialization ? '      return null;' :
    `      return { type: ${quote(entry.id)}, fields: { ${entry.fields.map(field => `${quote(field.name)}: ${access(field)}`).join(', ')} } };`);
  provider += method('legacyFields', '', 'any', 'null', entry => entry.customSerialization && !entry.customInspector ?
    `      return { ${entry.fields.map(field => `${quote(field.name)}: ${access(field)}`).join(', ')} };` : '      return null;');
  provider += method('restoreLegacyFields', ', fields: any', 'void', '', entry => entry.customSerialization && !entry.customInspector ?
    `      if (fields === null || fields === undefined) return;\n${restoreFields(entry, 'fields')}\n      return;` : '      return;');
  provider += method('drawsGizmos', '', 'boolean', 'false', entry => '      return ' + (entry.gizmos ? 'true' : 'false') + ';');
  provider += '}\ncomponentMetadata.provider = new GeneratedReflection();\n';
  const create = 'export function createRegisteredComponent(name: string): Behavior {\n' + entries.map(entry =>
    `  if (name === ${quote(entry.name)}) return ${entry.factory ? `${alias.get(entry)}.${entry.factory}()` : `new ${alias.get(entry)}()`};`).join('\n') + '\n  throw new Error("Componente nao registrado: " + name);\n}\n';
  const restore = 'export function restoreRegisteredComponent(data: any): any {\n' + entries.filter(entry => !entry.customSerialization).map(entry => {
    const assignments = restoreFields(entry, 'data.fields');
    return `  if (data.type === ${quote(entry.id)}) {\n    const component = new ${alias.get(entry)}();\n    if (data.fields === undefined || data.fields === null) return component;\n${assignments}\n    return component;\n  }`;
  }).join('\n') + '\n  return null;\n}\n';
  return header + 'import { Behavior } from "../core/behavior";\nimport { ComponentReflection, componentMetadata } from "../core/component_metadata";\n' + imports.join('\n') + '\n' + provider + create + restore +
    'export const REGISTRO = ' + quote(marker) + ';\n';
}

export function renderComponents(entries) {
  const catalog = header + 'export const COMPONENT_CATALOG = ' + JSON.stringify(entries.map(({ name, category, description, keywords, source }) =>
    ({ name, category, description, keywords, source })), null, 2) + ';\n';
  return { 'src/engine/generated/component_catalog.ts': catalog,
    'src/engine/generated/components.ts': renderRegistry(entries, 'editor'),
    'src/engine/generated/components_game.ts': renderRegistry(entries.filter(e => !e.editorOnly), 'jogo') };
}

const fromGenerated = source => {
  const r = slash(path.posix.relative('src/engine/generated', source)).replace(/\.ts$/, '');
  return r.startsWith('.') ? r : './' + r;
};
/// Valor de `@menuItem` no bloco JSDoc (`/** ... */`) logo antes do membro, ou null.
/// Lido do texto porque a API de JSDoc do TS ignora o bloco na mesma linha do
/// codigo anterior. So vale como TAG: no inicio de uma linha do bloco (depois do
/// `*`) ou logo apos o `/**`; mencao no meio de uma frase e comentario `//` nao contam.
function menuTag(member) {
  const text = member.getSourceFile().text;
  // "trailing" = comentarios ainda na linha anterior ao membro; "leading" = os das linhas seguintes.
  const blocos = [...(ts.getTrailingCommentRanges(text, member.pos) ?? []), ...(ts.getLeadingCommentRanges(text, member.pos) ?? [])]
    .map(r => text.slice(r.pos, r.end)).filter(c => c.startsWith('/**'));
  if (blocos.length === 0) return null;
  const tag = /(?:^\/\*\*|\n)[ \t]*\*?[ \t]*@menuItem\b[ \t]*([^\r\n*]*)/.exec(blocos[blocos.length - 1]);
  return tag ? tag[1].trim() : null;
}
/// Arquivos `@editorOnly` (componentes ou não): só o editor os importa.
export function discoverEditorExtensions(root = projectRoot, project = createProject(root)) {
  const { files, program, fail } = project;
  const editorFiles = files.filter(f => isEditorOnly(program.getSourceFile(f))).map(f => slash(path.relative(root, f))).sort(compare);
  // `/** @menuItem Criar/Luz/Pontual */` num metodo static sem argumentos obrigatorios.
  const menuItems = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    for (const node of source.statements) {
      if (!ts.isClassDeclaration(node) || !node.name || !hasModifier(node, ts.SyntaxKind.ExportKeyword)) continue;
      for (const member of node.members) {
        const caminho = menuTag(member);
        if (caminho === null) continue;
        if (!ts.isMethodDeclaration(member)) fail(member, '@menuItem so vale em um metodo static.');
        if (!hasModifier(member, ts.SyntaxKind.StaticKeyword)) fail(member, '@menuItem precisa de um metodo static.');
        if (!member.parameters.every(p => p.initializer || p.questionToken)) fail(member, '@menuItem precisa de um metodo static sem argumentos obrigatorios.');
        const partes = caminho.split('/');
        if (partes.length < 2 || partes.some(p => p.trim().length === 0) || !MENU_ROOTS.includes(partes[0])) fail(member, `@menuItem "${caminho}": comece com Criar ou Janela e nomeie o item (Criar/Luz/Pontual).`);
        if (menuItems.some(i => i.caminho === caminho)) fail(member, `@menuItem "${caminho}" repetido.`);
        menuItems.push({ caminho, source: slash(path.relative(root, file)), classe: node.name.text, metodo: member.name.getText() });
      }
    }
  }
  menuItems.sort((a, b) => compare(a.caminho, b.caminho));
  return { editorFiles, menuItems };
}
export function renderEditorExtensions(ext) {
  const header = '// GERADO por tools/generate-components.mjs. Só o editor (main.ts) importa este arquivo.\n';
  let text = header + ext.editorFiles.map(f => 'import ' + quote(fromGenerated(f)) + ';').join('\n') + '\n';
  // Uma importacao por classe com @menuItem; o indice segue a ordem de MENU_ITEMS.
  const chave = i => i.source + '#' + i.classe;
  const classes = [...new Map(ext.menuItems.map(i => [chave(i), i])).values()];
  const alias = new Map(classes.map((i, k) => [chave(i), 'Menu' + k]));
  text += classes.map(i => `import { ${i.classe} as ${alias.get(chave(i))} } from ${quote(fromGenerated(i.source))};\n`).join('');
  text += 'export const MENU_ITEMS: string[] = ' + JSON.stringify(ext.menuItems.map(i => i.caminho)) + ';\n';
  text += 'export function runMenuItem(index: number): void {\n' +
    ext.menuItems.map((i, k) => `  if (index === ${k}) { ${alias.get(chave(i))}.${i.metodo}(); return; }\n`).join('') +
    '  throw new Error("Item de menu inexistente: " + index);\n}\n';
  return { 'src/engine/generated/editor_extensions.ts': text };
}

export function generateComponents(root = projectRoot, check = false) {
  const project = createProject(root);   // um programa TS só para as duas descobertas
  const entries = discoverComponents(root, project);
  const outputs = { ...renderComponents(entries), ...renderEditorExtensions(discoverEditorExtensions(root, project)) };
  for (const [relative, contents] of Object.entries(outputs)) {
    const output = path.join(root, relative);
    const previous = fs.existsSync(output) ? fs.readFileSync(output, 'utf8').replaceAll('\r\n', '\n') : '';
    if (previous === contents) continue;
    if (check) throw new Error(`${relative} desatualizado. Execute npm run components e versione os arquivos gerados.`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, contents, 'utf8');
  }
  return entries;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`[components] ${generateComponents(projectRoot, process.argv.includes('--check')).length} classes descobertas`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
