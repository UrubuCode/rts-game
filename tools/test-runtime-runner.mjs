import { projectRoot } from './generate-components.mjs';
import { findCompiler } from './rts-compiler.mjs';
import { checkedProcess } from './checked-process.mjs';
try {
  const compiler=findCompiler(projectRoot);
  for(const [file,expectedOk,diagnostic] of [
    ['pass',true,'PASS runner fixture'],
    ['throw',false,'RUNNER_EXPECTED_SYNC_FAILURE'],
    ['await-reject',false,'RUNNER_EXPECTED_AWAIT_FAILURE'],
    ['detached-reject',false,'RUNNER_EXPECTED_DETACHED_FAILURE'],
  ]) {
    const result=checkedProcess(compiler,['run','tests/fixtures/runner/'+file+'.ts'],{cwd:projectRoot,marker:'PASS runner fixture',timeoutMs:30000});
    if(result.ok!==expectedOk||!(result.stdout+result.stderr).includes(diagnostic)||result.reason==='process-error'||result.reason==='timeout')
      throw new Error(file+': resultado inesperado '+JSON.stringify(result));
    console.log(JSON.stringify({fixture:file,ok:true,observedReason:result.reason,nativeExitCode:result.exitCode}));
  }
  console.log('PASS runtime runner: sucesso e tres falhas reais');
} catch(error) {console.error(error.message);process.exitCode=1;}
