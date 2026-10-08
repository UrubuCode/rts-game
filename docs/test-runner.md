# Execução verificada de testes RTS

O código de saída nativo pode ser zero após uma rejeição não observada. O runner agora também reconhece diagnósticos RTS de exceção/rejeição. A correção no runtime nativo continua pendente; executar o rts.exe diretamente ainda pode apresentar esse defeito.

Comandos:

    node tools/rts-run.mjs tests/resources-world-lifecycle.ts --expect "resources-world-lifecycle OK:" --timeout 180000
    node tools/rts-run.mjs tests/resources-cleanup-failure.ts --expect "resources-cleanup-failure OK" --json
    npm run test:runner
    npm run test:runtime-runner
    npm run test:world

O marcador é um prefixo de linha no stdout. Use um marcador exclusivo no fim de cada teste; ele é obrigatório para declarar término esperado nas suítes, mas opcional no comando genérico. Imprimir o marcador não vence uma falha posterior.

Timeout padrão: 180000 ms. O limite pode ser aumentado por --timeout, com inteiro positivo. A saída é capturada até o fim, limitada a 8 MiB; excesso é falha e não sucesso com log truncado. O processo direto é encerrado no timeout. Isto não é um supervisor geral de árvores de processos: testes que criam subprocessos precisam encerrá-los e terão suporte específico em etapa futura.

--json emite entry, ok, reason, exitCode, signal, error, durationMs, stdout e stderr. O próprio runner termina em 0/1 conforme ok. exitCode é o status original do processo nativo e pode ser 0 mesmo com ok=false. Erros de argumentos/preparação do compilador anteriores à execução são impressos em stderr com status 1.

Razões: timeout, process-error (inclui falha ao iniciar e limite de saída), signal, exit-code, runtime-error e missing-marker. Um diagnóstico só é reconhecido como nativo quando a linha começa por rts: unhandled promise rejection ou rts: uncaught exception; uma menção explicativa no texto de um teste não é suficiente.

Fixtures com erro intencional ficam em tests/fixtures/runner. Não devem ser rodadas como testes positivos independentes. tools/test-runtime-runner.mjs confirma que elas falham pelo motivo esperado usando o runtime fixado. O CI executa esse contrato depois da preparação nativa.

Esse mecanismo não prova correção de um teste que esqueceu asserts ou trabalhos assíncronos; a suíte deve esperar as operações que pretende validar. Tampouco substitui a correção nativa nem a futura matriz completa de testes de produção.
