import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedProcess } from '../tools/checked-process.mjs';
const execute = (source, options = {}) => checkedProcess(process.execPath, ['-e', source], { timeoutMs: 5000, ...options });
test('sucesso exige marcador quando solicitado e preserva saída', () => {
  const r=execute("console.log('PASS exemplo: 2')",{marker:'PASS exemplo:'});
  assert.equal(r.ok,true);assert.equal(r.exitCode,0);assert.match(r.stdout,/PASS/);assert.ok(r.durationMs>=0);
});
test('marcador ausente ou somente no stderr não aprova', () => {
  assert.equal(execute("console.log('terminou')",{marker:'PASS'}).reason,'missing-marker');
  assert.equal(execute("console.error('PASS')",{marker:'PASS'}).reason,'missing-marker');
});
test('rejeição RTS com código zero é falha, mesmo após marcador', () => {
  const r=execute("console.log('PASS');console.error('rts: unhandled promise rejection: Error: erro')",{marker:'PASS'});
  assert.equal(r.exitCode,0);assert.equal(r.ok,false);assert.equal(r.reason,'runtime-error');
});
test('exceção fatal no stdout também é falha', () => {
  assert.equal(execute("console.log('rts: uncaught exception (tag 1): erro')").reason,'runtime-error');
});
test('menção explicativa a rejeição não é diagnóstico nativo', () => {
  assert.equal(execute("console.log('teste cobre unhandled promise rejection')").ok,true);
});
test('código de erro, exceção síncrona e assíncrona falham', () => {
  for(const code of ["process.exit(7)","throw new Error('erro')","Promise.resolve().then(()=>{throw new Error('erro')})"])
    assert.equal(execute(code).reason,'exit-code');
});
test('timeout encerra execução sem aceitar marcador prévio', () => {
  const r=execute("console.log('PASS');setInterval(()=>{},1000)",{marker:'PASS',timeoutMs:300});
  assert.equal(r.ok,false);assert.equal(r.reason,'timeout');
});
test('processo inexistente e excesso de saída falham', () => {
  assert.equal(checkedProcess('rts-executable-that-does-not-exist',[]).reason,'process-error');
  assert.equal(execute("console.log('x'.repeat(100000))",{maxBuffer:1024}).reason,'process-error');
});
test('configuração inválida é recusada antes de iniciar', () => {
  for(const timeoutMs of [0,-1,NaN,Infinity,1.5])assert.throws(()=>execute('',{timeoutMs}));
  assert.throws(()=>execute('',{marker:''}));
});
