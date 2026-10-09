# Demonstração de animação: aceno

Cena: `scenes/wave-demo.json`. Modelo: `assets/models/kenney/character-wave-demo.glb`.

O clipe **Wave** foi criado por código: 11 keyframes de rotação em cada um de
três ossos (`arm-right`, `head`, `torso`), com 3,8 segundos e retorno ao repouso.
O modelo de origem é o personagem Kenney, CC0; a licença permanece em
`assets/models/kenney/LICENCA-Kenney-CC0.txt`.

Não é um clipe pronto do pacote: `tools/create-wave-demo.ts` escreve os canais
glTF, mantendo as malhas e as texturas originais. Execute com Node 22:

```powershell
node tools/create-wave-demo.ts
$env:RTS_SCENE = 'scenes/wave-demo.json'
$env:RTS_CTRL_PORT = '7791'
& $env:RTS_COMPILER run main.ts
```

`RTS_COMPILER` deve apontar para um RTS com UI/áudio. O release
`v0.0-202609271753` foi usado nos testes sem janela; a demonstração visual usou
o `ui_fixture.exe` já instalado da worktree `rts-uv-mundo`.

Com a cena aberta, selecione **WaveDemo**. O Inspector mostra **Esqueleto**,
seus ossos e o clipe **Wave**. Role o painel para ver os controles de prévia.
O botão **Rodar** executa o `AnimationPlayer` na cópia da cena.

Controle direto pela engine:

```powershell
python tools/ws_client.py --port 7791 'anims WaveDemo' 'bones WaveDemo'
python tools/ws_client.py --port 7791 'anim WaveDemo preview play'
python tools/ws_client.py --port 7791 'anim WaveDemo preview pause' 'anim WaveDemo preview seek 1.2'
python tools/ws_client.py --port 7791 'errors' 'assets errors'
```

Validação numérica:

```powershell
node tools/rts-run.mjs tests/test_wave_demo.ts
```

Confere duração, rotação do braço na chave de 0,9 s, mudança durante o aceno,
pausa, retomada, loop e preservação da pose manual serializada.

Para produzir uma prévia GIF com os quadros reais do editor:

```powershell
python tools/capture-wave-demo.py --port 7791
```

Requer `websockets` e `Pillow`. O resultado é `build/wave-demo.gif`: 32 capturas
da viewport, feitas com `anim ... preview seek` e `shot`. É uma sequência de
poses amostradas, não uma medição de FPS nem uma gravação em tempo real.

O teste visual reportou zero exceções/assets com falha. A comparação de duas
poses via `shot diff` detectou 5,654% de pixels diferentes com tolerância 10.

## Limite encontrado

O editor consegue posar ossos e pré-visualizar animações existentes. Ainda não
tem gravação de keyframes, edição de curvas ou criação de clipes próprios pela
UI; o nível 3 foi explicitamente adiado na spec de ossos de 2026-09-25.
O Inspector do Animator edita parâmetros em execução; não cria o grafo de
estados/transições. Esses são dois fluxos de autoria diferentes.

Próximo incremento recomendado: uma janela **Animation** com seleção de osso,
playhead, inserir/substituir/apagar keyframe, preview, salvar como asset separado
e Desfazer/Refazer. O aceite deve recriar este mesmo aceno inteiramente pela UI,
reabrir o projeto e reproduzir o clipe no jogo, sem modificar o GLB de origem.
O grafo visual do Animator pode vir depois.
