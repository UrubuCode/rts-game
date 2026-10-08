---
name: rts-engine-merge
description: Preparar e executar a integração de branches e worktrees da RTS Game Engine, verificando runtime nativo, componentes gerados, testes e assets. Usar para pedidos de merge ou preparação de integração desta engine.
---

# Integração da RTS Game Engine

Entregar uma integração verificável no destino pedido, preservando as alterações locais e a compatibilidade entre a engine TypeScript e o runtime nativo. Criar ou consultar esta skill não autoriza merge, commit ou push por si só; respeitar o escopo e as autorizações já dados na conversa.

## Encontrar a origem e o destino

- Ler AGENTS.md, quando existir, e CLAUDE.md aplicáveis ao worktree que será integrado.
- Inspecionar git worktree list --porcelain, git status --short --branch, git remote -v e git branch -vv. Usar cwd explícito em cada comando: o diretório externo e o worktree interno podem estar em branches diferentes.
- Como pista inicial, o trabalho de realismo e fundação estava em build/realism-main, branch integrate/realism-foundation. Confirmar no Git; esses nomes não são uma configuração permanente.
- Descobrir a branch padrão pelo remoto e pelas referências disponíveis. Este projeto usa origin/master no fluxo de realismo; não inventar uma branch main. Se o destino pedido divergir do destino existente e a conversa não resolver, pedir apenas essa definição.
- Inspecionar commits divergentes, diff, diff --cached e arquivos não rastreados. Distinguir mudanças desta tarefa, alterações alheias e dependências necessárias. Um merge só transporta commits: arquivos locais pendentes precisam de revisão e commit dentro do escopo autorizado.
- Atualizar as referências remotas quando houver acesso e permissão. Se isso falhar, identificar que a comparação usa referências locais possivelmente antigas; não afirmar que a branch está atualizada.

## Preparar uma mudança completa

Consultar docs/engine-foundation-plan.md e docs/engine-roadmap.md quando a integração envolver a fundação. Manter itens parciais como parciais, mesmo quando a compilação passa.

Revisar os grupos acoplados antes de selecionar arquivos para commit:

- Componentes, serialização, cenas e src/engine/generated. Gerar o catálogo por tools/generate-components.mjs; nunca resolver conflito editando manualmente o catálogo gerado.
- Engine, patches/render-pbr-runtime.patch e runtime.lock.json. A API TypeScript e o compilador preparado precisam corresponder ao mesmo contrato.
- Importadores, assets e manifestos de origem/licença. Assets grandes podem ser intencionais; conferir tamanho individual e referências nas cenas. Excluir builds e caches regeneráveis conforme .gitignore, sem excluir fontes necessárias apenas por serem grandes.
- Scripts de teste, fixtures, package.json e CI. Não integrar uma chamada de runner sem seu módulo auxiliar ou suas fixtures.

O runtime preparado em build/runtime é saída derivada e deve permanecer imutável. Usar os scripts oficiais de preparação e verificação; não editar a fonte preparada, trocar por um compilador arbitrário ou alterar hashes para fazer uma validação passar. Ao atualizar o patch nativo, inspecionar também arquivos não rastreados no checkout nativo: git diff HEAD sozinho não os inclui e pode perder implementações inteiras.

## Validar o conteúdo que será integrado

Executar os comandos a partir da raiz do worktree selecionado. Conferir primeiro package.json e docs/test-runner.md, pois a matriz pode evoluir.

Base atual de verificações:

~~~text
node --test tests/checked-process.test.mjs tests/component-generation.test.mjs tests/runtime-contract.test.mjs
node tools/generate-components.mjs --check
node tools/check-params.mjs
node tools/check-runtime.mjs
node tools/test-runtime-runner.mjs
~~~

Se houver mudanças em componentes, gerar o catálogo antes da checagem e revisar a saída. Adicionar os testes dos subsistemas alterados; exemplos incluem recursos, água adaptativa e tools/test-world.mjs. Para testes RTS, usar tools/rts-run.mjs com --expect e o marcador real do teste, além de timeout apropriado. O runtime pode registrar uma rejeição não tratada e ainda devolver código zero; não aceitar apenas exit code como evidência de sucesso.

Para integração com mudanças na engine/runtime, compilar editor e jogo por tools/rts-build.mjs usando os entrypoints definidos em package.json e nomes de saída livres em build. Não sobrescrever um executável em uso. Compilar não comprova interação visual, desempenho nem paridade editor/jogo.

Se o diff alterar caminhos por quadro, cumprir as sondas de GC e comparação de desempenho exigidas em CLAUDE.md. Verificar git diff --check e o diff staged antes de criar o commit. Registrar separadamente testes aprovados, falhas anteriores reproduzidas e verificações indisponíveis; nunca resumir isso como “todos os testes passaram”.

## Integrar e publicar no escopo autorizado

Com origem, destino e conteúdo definidos, fazer o commit necessário e integrar em um worktree limpo do destino. Se o destino estiver ocupado por alterações locais, preservar esse trabalho e usar um worktree separado quando permitido. Não executar stash, reset ou clean como preparação automática.

Escolher fast-forward quando possível e compatível com o fluxo pedido; caso contrário, realizar o merge preservando o histórico. Não fazer rebase de histórico publicado nem force push como solução automática. Resolver conflitos de código segundo os contratos dos dois lados e regenerar arquivos derivados. Se houver ambiguidade funcional real, explicar o conflito e solicitar a decisão necessária.

Após a integração, verificar novamente o conteúdo combinado: repetir os testes afetados por conflitos ou alterações vindas do destino, além dos checks de componentes/runtime relevantes. Reusar resultados anteriores apenas quando o conteúdo testado for o mesmo. Confirmar o HEAD final e que o commit da origem é ancestral do destino.

Fazer push somente quando autorizado, indicando remoto e branch de destino explicitamente. Se o remoto avançar ou rejeitar o push, atualizar e reavaliar a integração; não forçar. Conferir a referência remota após sucesso. Informar o hash integrado, destino, validação e se houve publicação.

Se uma operação falhar por permissão de escrita em .git, index.lock ou refs, interromper as mutações Git. Continuar apenas a preparação permitida e informar o comando bloqueado e a causa. Não apagar locks indiscriminadamente, mudar permissões ou usar outro gitdir/API para contornar a restrição. Pedir autorização já concedida novamente não resolve uma restrição do ambiente.
