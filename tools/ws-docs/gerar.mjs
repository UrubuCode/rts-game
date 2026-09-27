// Gera docs/ws-comandos.md a partir do manifesto da porta de controle (`doc
// json`: builtin_commands.ts + comandos de pacote). Não edite o .md à mão.
//   npm run docs:ws          # regenera
//   npm run docs:ws:check    # falha se o .md não corresponde ao manifesto
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findCompiler } from '../rts-compiler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const destino = path.join(root, 'docs', 'ws-comandos.md');
const MARCA = 'MANIFESTO ';

function lerManifesto() {
  const r = spawnSync(findCompiler(root), ['run', 'tools/ws-docs/manifesto.ts'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  const linha = (r.stdout ?? '').split(/\r?\n/).find(l => l.startsWith(MARCA));
  if (r.status !== 0 || !linha) throw new Error('manifesto.ts falhou (codigo ' + r.status + '):\n' + (r.stdout ?? '') + (r.stderr ?? ''));
  return JSON.parse(linha.slice(MARCA.length));
}

// Barra vertical dentro de uma célula de tabela Markdown precisa de `\|`.
const celula = s => String(s).replace(/\|/g, '\\|');

function markdown(m) {
  const out = [];
  out.push('# Porta de controle do editor: comandos');
  out.push('');
  out.push('<!-- GERADO por `npm run docs:ws` a partir de `doc json` (src/editor/control/builtin_commands.ts + comandos de pacote). Não edite à mão. -->');
  out.push('');
  out.push('Conexão: `ws://127.0.0.1:7777` (só loopback). Cliente: `python tools/ws_client.py` (ver `docs/skills/rts-engine-control/SKILL.md`).');
  out.push('');
  out.push('Protocolo: ' + m.protocol + '.');
  out.push('');
  out.push('Colunas: **Desfazer** = `dispatch` (o despacho tira um snapshot antes), `proprio` (o comando tira só nos subcomandos que mudam a cena) ou `nenhum`; **async** = a resposta vem depois (a conexão espera por ela antes da linha seguinte; não cabe num `batch`).');
  out.push('');
  out.push(`${m.commands.length} comandos.`);
  const grupos = [...m.groups, ...new Set(m.commands.map(c => c.group).filter(g => !m.groups.includes(g)))];
  for (const g of grupos) {
    const cmds = m.commands.filter(c => c.group === g);
    if (cmds.length === 0) continue;
    out.push('');
    out.push(`## ${g}`);
    out.push('');
    out.push('| Sintaxe | O que faz | Exemplo | Desfazer | async |');
    out.push('|---|---|---|---|---|');
    for (const c of cmds) {
      for (const u of c.usages) {
        out.push(`| \`${celula(u.syntax)}\` | ${celula(u.help)} | \`${celula(u.example)}\` | ${c.undo} | ${c.async ? 'sim' : ''} |`);
      }
    }
  }
  out.push('');
  return out.join('\n');
}

const texto = markdown(lerManifesto());
if (process.argv.includes('--check')) {
  const atual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8').replace(/\r\n/g, '\n') : '';
  if (atual !== texto) { console.error('[docs:ws] docs/ws-comandos.md desatualizado: rode npm run docs:ws'); process.exit(1); }
  console.log('[docs:ws] ok: docs/ws-comandos.md corresponde ao manifesto');
} else {
  fs.writeFileSync(destino, texto);
  console.log('[docs:ws] ' + path.relative(root, destino) + ' gerado');
}
