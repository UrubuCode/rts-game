---
name: rts-engine-control
description: Dirigir e observar o editor do rts-game pela porta de controle WebSocket (ws://127.0.0.1:7777) — inspecionar a cena, editar com Desfazer, ver a janela, simular mouse/teclado, controlar o tempo do Play, diagnosticar, rodar build e testes. A lista de comandos, componentes, menus, pacotes e o estado da cena é sempre lida AO VIVO do próprio motor (nunca hardcoded aqui). Use quando pedirem para testar, dirigir, inspecionar ou validar uma mudança no editor/motor RTS.
allowed-tools: Bash(python ${CLAUDE_SKILL_DIR}/contexto.py *)
---

# Dirigir o editor do rts-game

O editor abre uma porta WebSocket de controle. Por ela o agente dirige **a
mesma cena que o humano vê**: cada linha enviada é um comando, cada comando
uma resposta.

Esta skill não guarda uma lista de comandos/componentes/menus — o motor muda
(novos pacotes, componentes, comandos), e uma lista escrita aqui ficaria
desatualizada no dia seguinte. Em vez disso, o bloco abaixo é gerado AGORA,
toda vez que a skill é chamada, direto do runtime (ou do código-fonte, se o
editor estiver fechado):

## Contexto ao vivo

!`python "${CLAUDE_SKILL_DIR}/contexto.py"`

Isto já traz comandos, componentes (com campos), menus, pacotes carregados,
sondas de sistema (áudio, partículas, input) e o estado da cena atuais. Pra
mais detalhe sem repetir a chamada acima:

- `contexto <secao>` — só uma seção (`comandos`, `componentes`, `menus`,
  `pacotes`, `sistemas` ou `cena`), quando o resumo ficou grande demais.
- `contexto componentes <Nome>` — ficha completa de UM componente (campos,
  tipos, opções de enum).
- `contexto json` — tudo em JSON, pra processar em vez de ler.
- `doc <comando>` — todos os usos e exemplos de UM comando específico; `doc
  json` dá o manifesto completo. `help` dá a lista curta por grupo.

Rode qualquer um destes como qualquer outro comando (seção "2. Conectar"
abaixo). O que segue daqui pra baixo é só o que NÃO dá pra descobrir
perguntando ao motor: como subir o editor, como conectar, e as regras de
convivência com o humano.

## 1. Subir o editor

Da raiz do repositório (ou da worktree):

```sh
tasklist | findstr ui_fixture          # já há um editor? não mate processos que você não abriu
RTS_VSYNC=0 <rts>/target/release/examples/ui_fixture.exe main.ts > editor.log 2>&1 &
```

- `<rts>` é o checkout do runtime (ex.: `../rts-uv-mundo`). O `rts.exe` copiado na raiz costuma estar defasado.
- A porta está pronta quando o log mostra `[controle] ws://127.0.0.1:7777 pronto` (~5–15 s). `indisponivel` = a porta está ocupada (outro editor).
- `RTS_CTRL_PORT=7790` escolhe outra porta (dois editores, testes em paralelo); o cliente e o `contexto.py` usam `--port 7790` (ou a env `RTS_CTRL_PORT`).
- `RTS_VSYNC=0` tira a espera do monitor (quadros mais rápidos, respostas mais rápidas). `RTS_SCENE=<cena.json>` abre uma cena específica.
- Feche só o editor que você abriu (pelo PID que você anotou).

Testes sem janela: `<rts>/target/release/rts.exe run tests/<arquivo>.ts`.

## 2. Conectar

```sh
python tools/ws_client.py "state" "describe Cubo"           # um comando por argumento
python tools/ws_client.py --json "describe Cubo json"       # {"cmd","ok","tag","text","data"} por linha
python tools/ws_client.py --file comandos.txt               # um comando por linha, UTF-8
echo "find cubo" | python tools/ws_client.py --stdin
python tools/ws_client.py --timeout 120 "build"              # comandos async longos: aumente o prazo
```

Código de saída: 0 tudo ok; 1 se alguma resposta é `[erro]` ou não chegou; 2 sem conexão.
Respostas: `[ok] ...`, `[erro] <motivo>` ou `[<etiqueta>] ...` (várias linhas às vezes).
Um comando **assíncrono** (marcado `async` no `contexto`/`doc`) responde
depois; a conexão espera essa resposta antes de rodar a linha seguinte.

## 3. O laço de trabalho

1. **Orientar-se**: `contexto` (ou `contexto cena`/`contexto componentes` etc.) pra ver o que existe AGORA.
2. **Descrever**: consulte um objeto/campo específico (veja os comandos do grupo "consulta" no `contexto`).
3. **Mudar**: aplique a mudança (grupos "objetos"/"transform"/"componentes"/"hierarquia" no `contexto`), ou a UI de verdade pela simulação de entrada (grupo "entrada").
4. **Ver**: `shot build/shots/depois.png` (janela inteira) ou `shot x.png jogo` (só a vista de Cena/Jogo).
5. **Comparar**: `shot diff antes.png depois.png [tolerancia]` → percentual de pixels diferentes e a caixa que os contém. Uma mudança visual esperada deve dar > 0; uma refatoração, 0.
6. **Conferir**: repita a consulta do passo 2; confira erros/log (grupo "consulta" no `contexto`).

Leia o PNG capturado (a ferramenta de leitura de imagem mostra o arquivo) para julgar o resultado visual.

## 4. Endereçar objetos

`<obj>` (em qualquer comando que peça um objeto) aceita índice (`3`), `#3`,
nome exato (`Cubo`), nome com espaço entre aspas (`"Luz Pontual"`) e caminho
`Pai/Filho`. Nome ambíguo dá `[erro]` com a lista. **Índices mudam** depois de
operações que reordenam a hierarquia ou desfazem/refazem — prefira nomes ou
re-consulte a hierarquia. Um objeto chamado "7" é `"7"`.

## 5. Desfazer e lote

Comandos que mudam a cena entram automaticamente no Desfazer — o `contexto`/
`doc` mostra, por comando, como (`dispatch`, `proprio` ou `nenhum`). Um
`[erro]` nunca deixa a cena pela metade: o comando é desfeito. Vários
comandos podem virar UMA entrada de Desfazer (lote, grupo "play" no
`contexto`): no primeiro `[erro]` do lote, tudo dentro dele é desfeito. Não
cabem num lote os comandos de desfazer/refazer nem os de tempo/simulação
(Play/Pause/Resume/Stop/Step), nem os assíncronos.

## 6. Simular entrada (a UI real)

Coordenadas em pixels **lógicos** da janela. Enquanto a simulação está
ligada, o mouse e o teclado **físicos são ignorados** — ela desliga sozinha
depois de ociosa (veja o tempo exato no grupo "entrada" do `contexto`/`doc`).
Um campo de texto soma ao que já tem (selecione tudo antes de digitar por
cima). O menu Criar abre com um clique no rótulo e o item com outro clique
(`shot` mostra onde está).

## 7. Controlar o tempo

Semente do gerador aleatório, Play/Pause/Resume/Stop, passos fixos e escala
de tempo vivem no grupo "play" (`contexto comandos` ou `doc <nome>` pros
detalhes). Pra um teste reproduzível: fixe a semente, entre no Play, avance N
passos fixos, consulte o estado, depois pare.

## 8. Diagnóstico, build e testes

Erros/exceções, log, profiling e GC estão no grupo "consulta"/"sistema" do
`contexto`. Build dispara o build do jogo (snapshot separado, não muda a
cena editada) e responde quando termina. Rodar os testes de `tests/*.ts` está
no grupo "sistema" também — um processo por arquivo, passou/falhou por
arquivo.

## 9. Etiqueta do motor híbrido (agente + humano)

- **Nunca mate um processo que você não abriu** — anote o PID do editor que
  você subiu e feche só esse.
- **Não brigue com o mouse/teclado do humano**: a simulação de entrada toma o
  controle enquanto ativa; não a deixe ligada sem necessidade, e prefira
  comandos diretos de edição quando não precisar simular a UI de verdade.
- `shot` **captura só a janela do próprio editor** (pelo PID), mesmo coberta;
  minimizada não dá. Nunca use uma captura de tela inteira — ela pegaria
  outras janelas do humano.
- **Verifique por número, não por impressão**: prefira consultar
  estado/campos e comparar `shot diff` a "achar que deu certo". Depois de
  mudar comandos da porta de controle, regenere a documentação (script
  `docs:ws` do projeto) e rode os testes estáticos/headless.
- **Áudio**: a IA não ouve pelo ar. Quando a sonda de escuta por loopback
  estiver disponível (o `contexto`/`sistemas` diz), confirme o som por ela em
  vez de perguntar ao humano; sem ela, verifique por número (níveis, mixer).
- Salvar e build ficam bloqueados durante o Play; um segundo editor na mesma
  porta sobe sem controle.
- **Partículas**: `playOnAwake` só dispara dentro do Play; fora dele, só o
  objeto selecionado simula (prévia de edição), nunca salva na cena.
  Confirme o efeito pelos números do estado (vivas, bbox, t), não por
  impressão visual.

## 10. Pegadinhas

- **Acentos**: `ws_client.py` fala UTF-8; se o shell estragar o argumento, use `--file`/`--stdin`.
- **Porta**: uma por editor; escolha outra com `RTS_CTRL_PORT` para rodar em paralelo.
- Salvar a cena pela porta muda o documento aberto e dispara o gancho de salvar; para ler a cena sem salvar, use a consulta de cena em JSON (grupo "cena" no `contexto`/`doc`).
