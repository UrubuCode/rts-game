# Distribuição da IDE

Abra `Abrir-Editor.cmd` depois de extrair o pacote inteiro. Ele define a pasta
de trabalho do editor para que cenas e ferramentas sejam encontradas.

O pacote da IDE inclui `runtime/rts.exe`, `runtime/rts_runtime.lib` e o manifesto
de hashes da mesma revisão. Inclui também fontes da engine/projeto, ferramentas
de build e TypeScript usado para gerar o catálogo de componentes. O compilador
distribuído é descoberto relativamente à pasta do projeto, sem caminhos da
máquina que criou o pacote. `RTS_COMPILER`, se definido, é uma substituição
explícita e precisa satisfazer o mesmo contrato.

Nesta etapa, o botão Build ainda exige **Node.js no PATH** e ferramentas de
linkedição Windows disponíveis (MSVC Build Tools com C++ e Windows SDK).
O pacote ainda não é uma instalação autossuficiente da toolchain. Rust e Git
são necessários para reconstruir o runtime, não para cada exportação de jogo.

O editor usa um compilador externo. `--no-compiler` na compilação dos executáveis
desativa o compilador embutido para `eval`/`new Function`; isso não impede a IDE
de chamar `runtime/rts.exe` para construir um projeto.

O jogo exportado pelo botão Build contém `RTSGame.exe`, `RTSGame.rtsdata`, assets
e cenas. O jogador não precisa receber o compilador, fontes, Node ou ferramentas
de desenvolvimento. Preserve a estrutura de pastas da exportação.
