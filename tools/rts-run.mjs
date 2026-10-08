// Roda RTS com detecção de falhas, timeout e marcador opcional de conclusão.
import { projectRoot } from './generate-components.mjs';
import { findCompiler } from './rts-compiler.mjs';
import { checkedProcess } from './checked-process.mjs';
try {
  const [entry, ...args] = process.argv.slice(2);
  if (!entry) throw new Error('uso: node tools/rts-run.mjs <arquivo.ts> [--expect marcador] [--timeout ms] [--json]');
  const options = { cwd: projectRoot };
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expect' && i + 1 < args.length) options.marker = args[++i];
    else if (args[i] === '--timeout' && i + 1 < args.length) options.timeoutMs = Number(args[++i]);
    else if (args[i] === '--json') json = true;
    else throw new Error('Argumento invalido: ' + args[i]);
  }
  const result = checkedProcess(findCompiler(projectRoot), ['run', entry], options);
  if (json) console.log(JSON.stringify({ entry, ...result }));
  else {
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    if (!result.ok) console.error('[rts-run] ' + result.reason + ': ' + result.error);
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
