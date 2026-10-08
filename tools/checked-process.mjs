import { spawnSync } from 'node:child_process';

// Contrato comum: código zero sozinho não prova que a execução passou.
export function checkedProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180000;
  const maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs deve ser inteiro positivo');
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0) throw new Error('maxBuffer deve ser inteiro positivo');
  if (options.marker !== undefined && (typeof options.marker !== 'string' || !options.marker.trim())) throw new Error('Marcador vazio ou invalido');
  const start = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd, env: options.env, encoding: 'utf8', windowsHide: true,
    timeout: timeoutMs, maxBuffer, killSignal: 'SIGKILL',
  });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  const output = stdout + '\n' + stderr;
  const failure = output.split(/\r?\n/).find(line => /^rts: (unhandled promise rejection|uncaught exception)/i.test(line.trim()));
  let reason = '';
  if (result.error) reason = result.error.code === 'ETIMEDOUT' ? 'timeout' : 'process-error';
  else if (result.signal) reason = 'signal';
  else if (result.status !== 0) reason = 'exit-code';
  else if (failure) reason = 'runtime-error';
  else if (options.marker !== undefined && !stdout.split(/\r?\n/).some(line => line.startsWith(options.marker))) reason = 'missing-marker';
  return { ok: reason === '', reason, exitCode: result.status, signal: result.signal ?? null,
    error: result.error?.message ?? failure ?? '', durationMs: performance.now() - start, stdout, stderr };
}
