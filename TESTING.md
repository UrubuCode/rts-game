# Testando a engine sem janela — porta de controle

O rasterizador escreve num framebuffer comum, então a engine roda **headless**
(sem GUI). `harness.ts` é uma **porta de controle**: lê comandos linha-a-linha do
stdin, executa e responde no stdout (acks, estado, preview ASCII do frame). É
determinística (dt fixo de 16 ms), então uma IA ou script dirige e verifica sem
screenshot nem leitor de imagem.

## Uso

```bash
printf 'spawn box 0 1.5 0 1.2\nspin 0 1.0 0.3\nstep 30\nstate\nframe\nquit\n' \
  | ./rts.exe run harness.ts
```

Cada linha é um comando; a engine responde na hora. EOF (pipe fechado) ou `quit`
encerra.

## Protocolo

| Comando | Efeito |
|---|---|
| `spawn <name> <x> <y> <z> [scale]` | cria um cubo GameObject |
| `move <i> <x> <y> <z>` | posição do objeto i |
| `rot <i> <rx> <ry>` | rotação (rad) |
| `scale <i> <s>` | escala uniforme |
| `spin <i> <spdY> [spdX]` | anexa script Spinner |
| `bob <i> <amp> <freq>` | anexa script Bobber (baseY = y atual) |
| `select <i>` | seleciona (destaque dourado no render) |
| `cam <x> <y> <z> <yaw> <pitch>` | posiciona a câmera |
| `play` / `pause` | liga/desliga o update dos scripts |
| `step [n]` | avança n ticks de update (dt=16 ms) |
| `frame [cols] [rows]` | rasteriza + imprime preview ASCII (default 64×26) |
| `state` | imprime estado (objetos + câmera) |
| `lit` | nº de pixels desenhados (sanity: >0 = algo renderizou) |
| `save <path>` | salva PPM P3 160×96 do frame atual |
| `quit` / `exit` | encerra |

## Exemplo de saída

```
[ok] spawn #0 box
[ok] step 20 -> frame 20
[state] frame=20 playing=1 objetos=2 selecionado=0
  [0] box  pos(0,1.5,0)  rot(0.1,0.32)  scale 1.2  mesh 1
  CAM pos(0,3,-10)  yaw 0  pitch 0.18
+----------------------...
|              ++-  ::::=   ...
```

## Por que isto (e não um socket TCP)

stdin/stdout dá um canal de controle **scriptável e determinístico** que qualquer
ferramenta (Bash, uma IA) dirige por pipe, sem lidar com portas/handshake não
bloqueante dentro do loop de frame. O mesmo `harness.ts` serve de base pra um
backend de socket depois (o `net` namespace existe), se um controle *ao vivo*
(assíncrono, com eventos empurrados) for necessário.

## Verificação rápida (smoke test)

```bash
printf 'spawn a 0 1 0\nstep 5\nlit\nquit\n' | ./rts.exe run harness.ts | grep '\[lit\]'
# espera: [lit] <N> pixels desenhados ...  com N > 0
```
