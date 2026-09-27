---
name: rts-engine-control
description: Dirigir e observar o editor do rts-game pela porta de controle WebSocket (ws://127.0.0.1:7777) — inspecionar a cena (describe, scene json), editar com Desfazer (setfield, rot, batch), ver a janela (shot, shot diff), simular mouse e teclado (input), controlar o tempo do Play (pause, step, timescale, seed), diagnosticar (errors, log, prof frames) e rodar build e testes. Use quando pedirem para testar, dirigir, inspecionar ou validar uma mudança no editor/motor RTS.
---

# Dirigir o editor do rts-game

O editor abre uma porta WebSocket de controle. Por ela o agente dirige **a mesma
cena que o humano vê**: cada linha é um comando, cada comando uma resposta. A
lista completa, gerada do manifesto, está em `docs/ws-comandos.md`; o próprio
editor a devolve em JSON com `doc json` — consulte-o quando não souber a sintaxe.

## 1. Subir o editor

Da raiz do repositório (ou da worktree):

```sh
tasklist | findstr ui_fixture          # já há um editor? não mate processos que você não abriu
RTS_VSYNC=0 <rts>/target/release/examples/ui_fixture.exe main.ts > editor.log 2>&1 &
```

- `<rts>` é o checkout do runtime (ex.: `../rts-uv-mundo`). O `rts.exe` copiado na raiz costuma estar defasado.
- A porta está pronta quando o log mostra `[controle] ws://127.0.0.1:7777 pronto` (~5–15 s). `indisponivel` = a porta está ocupada (outro editor).
- `RTS_CTRL_PORT=7790` escolhe outra porta (dois editores, testes em paralelo); o cliente usa `--port 7790`.
- `RTS_VSYNC=0` tira a espera do monitor (quadros mais rápidos, respostas `input`/`step` mais rápidas). `RTS_SCENE=<cena.json>` abre uma cena específica.
- Feche só o editor que você abriu (pelo PID que você anotou).

Testes sem janela: `<rts>/target/release/rts.exe run tests/<arquivo>.ts` (ou `testes <padrão>` pela própria porta).

## 2. Conectar

```sh
python tools/ws_client.py "state" "describe Cubo"           # um comando por argumento
python tools/ws_client.py --json "describe Cubo json"       # {"cmd","ok","tag","text","data"} por linha
python tools/ws_client.py --file comandos.txt               # um comando por linha, UTF-8
echo "find cubo" | python tools/ws_client.py --stdin
python tools/ws_client.py --timeout 120 "build"             # comandos async longos: aumente o prazo
```

Código de saída: 0 tudo ok; 1 se alguma resposta é `[erro]` ou não chegou; 2 sem conexão.
Respostas: `[ok] ...`, `[erro] <motivo>` ou `[<etiqueta>] ...` (várias linhas às vezes).
Comandos **async** (`shot`, `input`, `build`, `run tests`/`testes`) respondem
depois; a conexão espera essa resposta antes de rodar a linha seguinte, então
`input click` seguido de `shot` captura o resultado do clique.

## 3. O laço de trabalho

1. **Descrever**: `state`, `tree`, `find <trecho>`, `describe <obj> [json]`, `scene json [obj]`, `getfield`, `luzes`, `cameras`.
2. **Mudar**: `setfield <obj> <Comp> <campo> <valor>`, `move`/`rot`/`scl`, `addcomp`, `menu Criar/...`, ou a UI de verdade com `input`.
3. **Ver**: `shot build/shots/depois.png` (janela inteira) ou `shot x.png jogo` (só a vista de Cena/Jogo).
4. **Comparar**: `shot diff antes.png depois.png [tolerancia]` → percentual de pixels diferentes e a caixa que os contém. Uma mudança visual esperada deve dar > 0; uma refatoração, 0.
5. **Conferir**: `describe`/`getfield` de novo, `errors`, `log tail 20`.

Leia o PNG capturado (a ferramenta de leitura de imagem mostra o arquivo) para julgar o resultado visual.

## 4. Endereçar objetos

`<obj>` aceita índice (`3`), `#3`, nome exato (`Cubo`), nome com espaço entre aspas
(`"Luz Pontual"`) e caminho `Pai/Filho`. Nome ambíguo dá `[erro]` com a lista.
**Índices mudam** depois de `delete`, `parent`, `movetree`, `undo` — prefira nomes
ou re-consulte `tree`. Um objeto chamado "7" é `"7"`.

## 5. Desfazer e lote

- Comandos que mudam a cena entram no Desfazer (`doc json` diz como: `undo` = `dispatch`, `proprio` ou `nenhum`). `undo`/`redo` pela porta.
- Um `[erro]` nunca deixa a cena pela metade: o comando é desfeito.
- **Lote**: `batch begin` … `batch end` (ou `txn`) = uma entrada de Desfazer. No primeiro `[erro]` o lote inteiro volta, a resposta diz a linha, e as linhas seguintes são recusadas até o `end`. `batch cancel` desfaz e fecha. Uma mensagem cuja primeira linha é só `batch` é um lote inteiro. Não cabem num lote: `undo`, `redo`, `play`, `stop`, `resume`, `step` e os async.

## 6. Simular entrada (a UI real)

Coordenadas em pixels **lógicos** da janela (`res` dá o tamanho; `pickat x y` diz o objeto sob o pixel; o `shot` de janela tem o mesmo tamanho a 100% de escala).

```
input click 420 395                 # seleciona o que está sob o pixel (move, aperta, solta: 3 quadros)
input drag 500 397 600 397 20       # arrasta a seta X do gizmo Move em 20 quadros
input mouse 300 200 down right      # segura o botão direito até o up
input key w down / input key w up   # segura W (voo do editor ou, com `gameview jogo`, os scripts do jogo)
input key ctrl down; input key a press; input key ctrl up   # Ctrl+A num campo de texto
input text #FF0000                  # digita no campo com foco (resto da linha)
input key enter press               # confirma
input wheel -3
input off                           # volta à entrada real
```

- Enquanto a simulação está ligada, o mouse e o teclado **físicos são ignorados**; ela desliga com `input off` ou após 30 s ociosa sem nada segurado.
- `input key` não gera texto: para digitar use `input text`. Um campo de texto soma ao que já tem — selecione tudo (Ctrl+A) antes.
- O menu Criar abre com `input click` no rótulo e o item com outro clique (`shot` mostra onde está).

## 7. Controlar o tempo

```
seed 42        # gerador aleatório central (@engine/core/aleatorio) — mesma semente, mesmo resultado
play
step 10        # pausa (se rodando) e avança exatamente 10 passos fixos (1/60 s); responde passos e tempo
pause / resume # congela e retoma sem sair do Play
timescale 0.5  # metade dos passos por segundo (0 = parado)
stop           # descarta a simulação e restaura a cena de edição
```

Para um teste reproduzível: `seed`, `play`, `step N`, `describe`/`state`, `stop`.

## 8. Diagnóstico, build e testes

- `errors` — última exceção (origem, mensagem, **pilha**) e componentes cujo gizmo/onInspectorGUI foi desligado por falha. `errors clear`.
- `log tail [n]`, `log erro`, `log clear`; `assets errors` (texturas/modelos/céu que não carregaram).
- `prof frames [n]` — min/mediana/p99/max e quadros > 10 ms (trabalho e intervalo); `prof` = tabela por seção; `gc` = memória (as coletas só com `RTS_GC_DEBUG=1` no stderr).
- `build` — o build do botão; responde ao terminar com a pasta, o exe e o log. `build status`.
- `run tests [padrão]` / `testes [padrão]` — `tests/*.ts` (padrão `test_*`), um processo por arquivo, passou/falhou por arquivo.

## 9. Pegadinhas

- **Acentos**: `ws_client.py` fala UTF-8 (`menu Criar/Câmera` funciona); se o shell estragar o argumento, use `--file`/`--stdin`.
- **Porta**: uma por editor; um segundo editor na mesma porta sobe sem controle (`indisponivel` no log).
- **Nunca mate processos que você não abriu**; anote o PID do editor que subiu.
- **`shot` captura só a janela do próprio editor** (pelo PID, com PrintWindow), mesmo coberta; minimizada não dá. Não use capturas de tela inteira.
- `savescene` muda o documento aberto e dispara o gancho de salvar; para ler a cena use `scene json`.
- Salvar e build ficam bloqueados durante o Play.
- Depois de mudar comandos: `npm run docs:ws` (e `docs:ws:check`).
