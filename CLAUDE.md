# Convenções do rts-fps

FPS multiplayer de exemplo sobre o motor **rts-game** (TypeScript) executado
pelo runtime **rts** compilado localmente em `../rts`. Serve para jogar e para
testar o motor em condições reais.

## Como rodar

Tudo a partir da raiz do `rts-fps`:

- Jogo: `../rts/target/release/examples/ui_fixture.exe src/client.ts`
- Um teste sem janela: `../rts/target/release/rts.exe run tests/<arquivo>.ts`
- Suíte: todos os `tests/fps-*.ts` e `tests/net-*.ts` (inclui `fps-animacao`); `fps-quadro-gc` é a sonda de alocação (rodar com `RTS_GC_DEBUG=1`).
- Se o runtime estiver desatualizado: `cargo build --release -p rts-host --example ui_fixture --features ui` em `../rts`. No PowerShell 5.1, não rode o `run.ps1` do rts-game com a saída redirecionada: o stderr de progresso do `cargo` aborta o script.

## Motor

- O `rts-game` é **submódulo** em `engine/`, travado num commit do `master`. Os aliases (`@engine`, `@compat`, `@editor`, `@scripts`) em `tsconfig.json` apontam para `./engine/src/...`.
- **Nunca** aponte para `../rts-game` diretamente: aquele checkout costuma ter trabalho em andamento de outros agentes, e os testes daqui oscilam.
- Atualizar o motor: `git -C engine pull origin master`, rodar a suíte inteira e commitar o novo ponteiro do submódulo. Mudanças no motor vão por PR no `rts-game`, não por edição dentro de `engine/`.
- O rts-game é um motor **genérico**, não só de RTS. Não justifique limitações pelo gênero do jogo.

## Regras de código

- **Prefixo `fps`/`FPS_`/`Fps` em todo nome de topo** (funções, `let`, `const`, classes, interfaces). Neste runtime, nomes de topo de módulos diferentes colidem.
- **Imports do motor sempre pelos aliases**, nunca por `../engine/src/...`. Carregar o mesmo módulo por dois caminhos duplica o estado global (o índice espacial é estado de módulo).
- **`src/shared/` não conhece janela**: nada de `rts:egui`, `rts:input`, `@engine/render/*` ou `@compat/app.ts`. É o código que o servidor (entrega 2) vai rodar. Os testes sem janela garantem isso: importar esses módulos falha no `rts.exe run`.
- **Sem ciclos de import:** só o `world.ts` orquestra; `player`, `weapons`, `bots`, `map` e `consultas` recebem o que precisam por parâmetro.
- **Determinismo:** sem `Math.random` nem relógio em `src/shared/`. A aleatoriedade vem de LCGs semeados (`s = (s * 1664525 + 1013904223) | 0`). Mesma semente + mesmos inputs = mesmo estado (há teste).
- **O cliente só produz `FpsPlayerInput`.** Só `fpsSimulatePlayer`/`FpsWorld.passo` mudam o estado. Bordas de tecla (apertou neste frame) passam por `fpsAcumularBorda` até um tick consumi-las.
- **Sem alocação por tick** nos caminhos quentes: buffers de hits, pools de granadas e anel de efeitos são criados uma vez.
- **Constantes com nome** em `src/shared/config.ts`; medidas e cores do HUD num bloco nomeado no topo de `src/hud.ts`.
- **Custo por quadro (regra do motor):** no cliente, função chamada por quadro tem no máximo 4 parâmetros (5+ alocam por chamada no RTS); desenho 3D por `drawGPUBuf`/`drawGPUMeshBuf`/`drawGPUMeshQBuf` com um `Float64Array` reaproveitado, câmera por `fpsCamera` + `fpsPrepararCamera`; HUD por `@compat/draw2d.ts` com rótulos em cache (sem montar string por quadro); `try/catch` fora de funções por quadro. Sonda: `RTS_GC_DEBUG=1 rts.exe run tests/fps-quadro-gc.ts` → 0 coletas por fase. Quadro sem vsync: `RTS_VSYNC=0` + `prof on`/`prof frames` na porta de controle.

## Consultas espaciais (medido)

- A normal de `overlapSphereNonAlloc` aponta **da esfera para dentro do objeto**: sair é `pos -= normal × profundidade`. A normal do raycast é a da superfície, apontando para fora.
- Caixa com escala `s` tem meia-extensão `s/2`.
- Filtro simétrico: `(mascaraDaConsulta & camadaDoAlvo) != 0` **e** `(mascaraDoAlvo & camadaDaConsulta) != 0`. Camadas do jogo em `src/shared/layers.ts`.
- O índice só se reconstrói sozinho quando o contador de passos da física muda, e o jogo não usa esse contador. O `FpsWorld` chama `sincronizarCorpos()` (posição + `computeWorld` + `spatialRebuildIndex`) depois do movimento **e antes dos tiros**, e de novo no fim do tick.
- Um raio que começa dentro de um corpo acerta esse corpo a distância 0; por isso o tiro parte da saída da própria caixa (`fpsSaidaDaCaixa`).

## Personagens animados

- `src/animacao.ts` (`FpsAnimacao`): um `Skeleton` + `Animator` por jogador, em GameObjects próprios **fora da cena** (a cena só tem a caixa de colisão; o render pula os corpos "jogador*"/"remoto*"). Controlador: `assets/animators/fps-personagem.controller.json` (mesmo formato do motor; limiares 0/4/8 u/s e volta de Morto para Locomocao ao renascer).
- O cliente preenche por quadro `x/y/z` (pés), `yaw`, `vel`, `vivo`, `disparos` e `visivel` e chama `passo(n, dt)`/`desenharTodos(win, n)`. Arma presa ao osso `arm-right`.
- Passo sincronizado com o chão: a taxa do Animator = velocidade / velocidade natural da mistura, medida do próprio clipe ao carregar (recuo do pé de apoio por ciclo). Mudou o clipe ou a escala? O `fps-animacao` mede o escorregar do pé (< 3%).

## Entrada

Códigos de tecla do `rts-egui`: letras `A..Z` = `100..125`, dígitos `0..9` = `130..139`, `F1..F12` = `140..151`, `Esc` = 2, espaço = 3. Botão esquerdo do mouse = 0. Mouse travado: `mouseLock(win, 1)` + `input.mouseDeltaX/Y`.

## Rede (entrega 2)

- UDP via `node:dgram`, com protocolo **binário**.
- O `message` do dgram deste motor entrega `Uint8Array` (não `Buffer`): `msg.toString()` devolve `"49,50,51"`. Leia os bytes.
- Eventos só chegam dentro de `send`/`bind`/`connect`/`close` do dgram e de `time.sleep_ms` (`address()` **não** entrega — lido em `rts-node/src/dgram/socket.rs` e medido na janela). `NetTransporteUdp.bombear()` manda um datagrama vazio à própria porta por isso; bombeie **uma vez por tick/frame**.
- Sem handler de `'error'` no socket, mandar UDP para uma porta fechada derruba o processo (Windows). `NetTransporteUdp` conta em `erros`.

## Como trabalhar

- **TDD:** o teste é escrito e visto falhar antes da implementação. Um teste que passa antes de o código existir é um achado sobre o teste.
- **Números vêm da saída do comando**, rodado neste commit, e são colados no relatório. Meta não atingida se escreve com quanto falta e por quê. Toda medição de desempenho traz o resultado da consulta (hits, id, distância). A/B de desempenho é alternado (A, B, A, B). Veja `docs/licoes-revisao.md`.
- **Mudou física, colisão ou consultas?** Rode o `fps-resistencia`: ele pegou bugs que os testes unitários não pegavam (jogador preso numa fresta, degraus).
- Ao mexer no cliente, verifique também abrindo a janela.
