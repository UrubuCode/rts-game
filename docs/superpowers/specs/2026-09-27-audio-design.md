# Áudio no modelo da Unity (AudioListener, AudioSource, AudioClip, AudioMixer) — desenho

Data: 2026-09-27. Pedido: sistema de áudio no modelo da Unity, seguindo o princípio de 2026-09-26: "o motor ganha só o que um script não consegue fazer; o resto são pacotes". Primeiro consumidor real: o rts-fps (tiro, impacto, passos, música).

Rascunho para aprovação.

## 1. Motivação e o modelo Unity

A Unity separa o áudio em quatro peças, e o desenho segue a mesma divisão:
- **`AudioListener`**: o "ouvido". Normalmente fica na câmera principal, e só um fica ativo por cena.
- **`AudioSource`**: o emissor, preso a um GameObject. Campos: `clip`, `loop`, `volume`, `pitch`, `spatialBlend` (0 = 2D, 1 = 3D), rolloff (log/linear), `minDistance`, `maxDistance`, `playOnAwake` e o grupo de saída do mixer. Métodos: `Play`, `Stop`, `Pause`, `PlayOneShot(clip)` e o estático `PlayClipAtPoint`.
- **`AudioClip`**: o asset de som, carregado de arquivo e compartilhado por todas as fontes que o usam.
- **`AudioMixer`**: grupos em árvore (Master → Música, Efeitos, Voz), cada um com volume, mudo e efeitos. É onde fica o "abaixar a música quando alguém fala" (ducking).

O jogo precisa disso para tocar um `.wav`, que hoje não dá: o motor só sintetiza bipes.

## 2. O que existe hoje e os limites

**No rts-game:**
- `src/engine/audio/audio.ts` é um mixer de 24 vozes de **oscilador** (seno, quadrada, ruído, com envelope), sobre o ring buffer de `rts:audio`. O `pumpAudio()` completa o ring até cerca de 100 ms (`TARGET_FRAMES` 4800, `MAX_PUMP` 2400), com um atalho de silêncio. Há vozes posicionais (`play*At`, `moveVoice`) e volume mestre.
- `src/engine/audio/spatial.ts` é matemática pura:
  - ouvinte `[x, y, z, yaw, pitch]` em estado de módulo (`setListener`);
  - atenuação `ref/d` cortada em `max`;
  - pan de potência constante pelo seno do azimute.
- `src/scripts/audiosource.ts`: o `AudioSource` atual escolhe timbre, frequência, duração e ganho, e toca por `play()` ou a cada N segundos. Usa o inspector legado (`fieldCount`…).
- `tests/test_audio3d.ts` confere os ganhos por número, sem placa de som. É o modelo de verificação que este desenho estende.
- Comando WS embutido `snd [freq dur vol]` (`commands/scene.ts`).

**Limites:**
1. **Não sai som nenhum.** `src/compat/audio.ts` diz o motivo: o runtime novo (`rts-uv-mundo`) não tem saída de áudio.
   - Nenhum `Cargo.toml` de `crates/` tem `cpal`, `rodio`, WASAPI ou similar. O `Cargo.toml` raiz diz, na nota que aposentou a feature `asio`: "Nothing in this engine provides audio yet".
   - Por isso `open_output` devolve 0, e os outros seis membros lançam erro.
   - Além disso, **ninguém chama mais `initAudio`/`pumpAudio`**: hoje só `commands/scene.ts` e `scripts/audiosource.ts` importam o mixer.
2. **Não toca arquivo.** Não há decodificador no runtime: nenhum crate usa `symphonia`, `hound`, `lewton`, `minimp3` ou `claxon`. Também não há decodificador em TS.
3. **Pan só esquerda/direita, pelo ângulo horizontal.** Frente e trás soam iguais, o pitch do ouvinte é ignorado, e o ganho salta na fronteira do bloco. Essa última é uma dívida anotada no fim de `spatial.ts`.
4. **Rolloff global** (`setRolloff`), não por fonte. Não há mistura 2D/3D nem curva linear.
5. **Não há grupos**, só o volume mestre. Também não há pausa por grupo.
6. **O ouvinte é uma função**, não um componente: quem tem a câmera precisa empurrar a pose a cada quadro.
7. **`mixInto` tem 15 parâmetros.** Está na lista de exceções de `tools/check-params.mjs` como "PENDÊNCIA", porque os arrays passados por parâmetro foram a otimização medida (260 → 20 ns por acesso). Custo medido: 1,75 ms por bloco de 800 amostras com 24 vozes, e 44 % disso é o acumulador (duas leituras e duas escritas nativas por amostra por voz).
8. **Em pressão de vozes, o som novo é descartado.** Não há prioridade nem voz virtual, então um laço fora do alcance ocupa uma voz.

## 3. Motor (mínimo)

O motor ganha o que um script não consegue fazer: **o dispositivo** e **um núcleo de mixagem nativo**. O primeiro é impossível em TS. O segundo cabe em TS, mas a 20 ns por acesso o custo passa do orçamento com 32 vozes de clipe (§3.8). Decodificar WAV, a cache de clipes, as vozes, a espacialização e o mixer são política, e ficam em TS no rts-game.

### 3.1 Runtime (repo rts, PR à parte)

- **Saída `rts:audio`** com os sete membros que `compat/audio.ts` já declara: `open_output(rate, ch, flags)`, `sample_rate`, `channels`, `master_volume`, `queued_frames`, `write(dev, buf, samples)` e `close`. O backend é `cpal` (WASAPI, CoreAudio e ALSA), com a thread de áudio drenando o ring. O custo é a dependência e o tamanho do binário; o linker já prevê o COM/dispositivo em `system_linker.rs`.
- **Dispositivo nulo explícito:** `flags = 1` abre uma saída que consome em tempo real e descarta as amostras. Serve para testes e CI sem placa de som. Não é o "mixer para o nada" que `compat/audio.ts` recusa, porque quem pede é o chamador, e `audio listener`/`audio list` informam `nulo`.
- **Primitivo `mix_add(dst, src, desc: Float64Array)`**: soma um bloco de `src` (um clipe `Float32Array`, mono ou estéreo) em `dst` (o bloco de saída intercalado). `desc` leva:
  - posição inicial fracionária e passo (pitch × razão de taxas, com interpolação linear);
  - ganhos L/R iniciais e finais (rampa por amostra, o que resolve o salto na fronteira do bloco);
  - coeficiente e estado do passa-baixa de um polo;
  - o laço (início e fim) e o número de quadros.

  Ele devolve a posição final no próprio `desc`. São três parâmetros e nenhuma alocação. O primitivo é genérico (um kernel de DSP) e não sabe o que é voz, grupo ou ouvinte.
- **Seguimento: OGG/Vorbis** como `audio.decode_ogg(bytes) → Float32Array` via `lewton` (Rust puro, sem C). Custo:
  - dependência e binário maiores (estimativa: algumas centenas de KB);
  - decodificação inteira no carregamento: cerca de 10–30 ms por minuto de áudio (estimativa, a medir) e memória descomprimida igual à do WAV.

  Só vale pelo tamanho em disco, que é cerca de 10× menor. Música longa é o caso de uso, mas o streaming fica fora deste desenho (§8). A fase 1 entrega só WAV.

### 3.2 Decodificador WAV (TS, `src/engine/audio/wav.ts`)

Segue o molde de `render/png.ts`: bytes vindos de `readFileSync`, validação com mensagem e um limite de tamanho.
- **Leitura do arquivo:** RIFF/WAVE; chunk `fmt ` com PCM (1), IEEE float (3) ou `WAVE_FORMAT_EXTENSIBLE` (0xFFFE, pelo subformato); chunk `data`. Chunks desconhecidos (`LIST`, `fact`…) são pulados, respeitando o byte de alinhamento.
- **Formatos aceitos:** PCM de 8 bits (sem sinal), 16 e 24 bits, int32 e float32, em mono ou estéreo.
- **Recusados com mensagem:** mais de 2 canais, ADPCM, µ-law e arquivo truncado. Isso é melhor que tocar ruído.
- **Resample na carga** para a taxa do dispositivo (48 kHz quando mudo), com interpolação linear. Na redução de taxa isso gera algum aliasing; um filtro de 4 taps fica para a fase 2 se alguém ouvir o problema. Depois da carga, o `pitch` é o único resample por voz.
- **Saída:** `Float32Array` intercalado em [−1, 1].

### 3.3 `AudioClip` (asset)

- `AudioClip.load(caminho)` usa uma cache por caminho: o mesmo arquivo é decodificado uma vez só, e o erro de decodificação vai para o Console uma vez.
- Campos: `nome`, `canais`, `taxa`, `quadros`, `duracao` e `amostras: Float32Array`.
- `AudioClip.fromSamples(nome, amostras, canais)` é para som procedural. Os tons de hoje passam a ser clipes gerados uma vez (`toneClip(freq, dur, forma)`), então há um caminho de mixagem só.
- **Memória:** 1 minuto em estéreo a 48 kHz ocupa 23 MB. O Inspector mostra o tamanho do clipe, e música longa é o motivo do OGG e do streaming (§8).
- No build, os `.wav` referenciados vão junto, pelo mesmo caminho das texturas de Material.

### 3.4 Vozes

- **Estado:** um único `Float64Array` com `VOZ_FLOATS` por voz, em vez de 14 arrays paralelos:
  - clipe, posição, passo, laço;
  - ganho atual e ganho-alvo L/R;
  - estado do passa-baixa;
  - grupo, fonte e flags (ativa, pausada, virtual, one-shot).
- **Limite:** `MAX_VOICES` passa a 32.
- **`mixInto(buf, frames, vozes)`**: são 3 parâmetros, e o `Float64Array` chega por parâmetro, que é o acesso barato. O laço por voz monta o `desc` e chama `mix_add`.
- **Aceite:** a exceção de `check-params.mjs` sai, com medição antes e depois na mesma sessão.
- **Voz virtual:** uma fonte além de `maxDistance`, ou num grupo mudo, continua avançando a posição sem mixar. O custo é o de uma soma. Assim, um laço que volta ao alcance retoma do ponto certo, sem ocupar o mixer.
- **Pressão de vozes:** na fase 1, o som novo é descartado, como hoje, mas uma voz virtual cede o lugar primeiro. Na fase 2 entra `prioridade` (0–256), no modelo da Unity.

### 3.5 `AudioListener` (`src/engine/core/audio_listener.ts`, `KIND_AUDIO` = 8)

- Pose `[x, y, z, yaw, pitch]` e velocidade (derivada da pose entre quadros), lidas do Transform.
- A `Scene` guarda em cache as fontes e os ouvintes do `KIND_AUDIO`, como faz com as luzes.
- **Um ativo por cena:** o primeiro ativo e habilitado. Se houver outro, o Console avisa uma vez, como a Unity faz.
- **Fallback:** sem `AudioListener`, vale `Camera.main()`. Sem câmera, vale a pose que o jogo empurra com `Audio.setListenerPose(pose)`. É o caso do rts-fps, que desenha pela própria pose.
- `setListener` em `spatial.ts` passa a receber 8 floats (a pose mais a velocidade).

### 3.6 `AudioSource` ampliado (`src/scripts/audiosource.ts`)

**Campos públicos**, todos com Inspector automático (o `fieldCount` legado sai):
- `clip` (caminho), `volume`, `pitch`, `loop`, `playOnAwake`, `mudo`;
- `spatialBlend` (0–1), `rolloff` ("log" ou "linear"), `minDistance`, `maxDistance`;
- `grupo` (nome do grupo do mixer, "" = Master) e `doppler` (0–1).
- Os campos de oscilador de hoje (`tipo`, `freq`, `dur`, `every`) ficam para o `clip` vazio.

**Construtor e formato salvo:** o construtor passa a ter zero argumentos. O formato antigo (`kind/freq/dur/gain/every`) é lido e convertido, com `gain` virando `volume`.

**API:**
- `play()`, `stop()`, `pause()`, `unPause()`, `isPlaying()`, `time`;
- `playOneShot(clip, escala)`: uma voz nova, com a pose da fonte, que não interrompe a voz principal;
- `AudioSource.playClipAtPoint(clip, pos: Float64Array, volume)`.

**Ganhos por voz**, calculados uma vez por bloco:
- 3D: atenuação por fonte (log = `min/d`, linear = `(max − d)/(max − min)`, zero além de `max`) × pan;
- 2D: (1, 1);
- mistura: `L = (1 − b)·1 + b·L3D`, e o mesmo para R;
- ganho final: × `volume` × (volumes da cadeia do grupo).

**Ciclo do Play:** fora do Play, as fontes não tocam; só a prévia do editor toca (§4). Ao entrar no Play, as fontes com `playOnAwake` tocam no `start`. Ao parar o Play, tudo é interrompido.

### 3.7 Mixer

- **Grupos com nome livre:** o padrão é Master → Música, Efeitos, Voz. Cada grupo tem `volume`, `mudo`, `pausa` e o grupo pai.
- **Onde fica:** num arquivo de projeto `assets/audio/mixer.json`, porque o mixer vale para todas as cenas, como o asset da Unity. Sem arquivo, valem os quatro grupos padrão.
- **Cálculo:** o ganho efetivo por grupo é calculado uma vez por quadro, quando o mixer muda (controlado por um contador de versão), e não por voz.
- **API:** `Mixer.setVolume(grupo, v)`, `mute`, `pause`, `grupoIndex(nome)`. O índice fica resolvido na fonte, sem comparar string por quadro.
- **Ducking (fase 2):** o grupo A abaixa para X enquanto o grupo B tem voz audível, com ataque e soltura por bloco. Custa uma comparação por grupo por quadro.

### 3.8 Espacialização e custos

| Item | Como | Custo estimado | Fase |
|---|---|---|---|
| Pan por ângulo + atenuação | como hoje, por bloco | ~0,2 µs/voz/quadro (medido) | 1 |
| Rampa de ganho no bloco | dentro do `mix_add` | ~1 ns/amostra | 1 |
| Passa-baixa atrás/longe | um polo; corte de 22 kHz (frente) a ~5 kHz (atrás), caindo com a distância | coeficiente por bloco; ~2 ns/amostra nativo | 1 (resolve frente = trás) |
| Elevação | o pitch do ouvinte entra no vetor lateral | desprezível | 1 |
| Doppler | `passo × (c + v_ouv·u)/(c − v_fonte·u)`, com c = 343 e limite de 0,5 a 2 | ~0,1 µs/voz/quadro | 2 |
| Oclusão | `raycastNonAlloc` ouvinte→fonte, 4 vozes por quadro em rodízio; bloqueio = ganho × 0,5 e corte em 1,5 kHz | ~poucos µs por raio (a medir no `SpatialIndex`) | 2 |

**Orçamento:**
- **Meta:** 32 vozes de clipe em blocos de 800 amostras em ≤ 0,5 ms por quadro. A estimativa é de ~5 ns/amostra/voz nativo, ou seja, ~0,13 ms mais 32 chamadas de FFI.
- **Comparação:** o mixer atual em TS gasta 1,75 ms com 24 osciladores.
- **Regras:** zero alocação e zero string por quadro, `try/catch` só em funções de carga, e ≤ 4 parâmetros em todo o caminho do pump.

## 4. Editor: pacote `assets/pacotes/audio/`

Tudo com `@editorOnly`, usando só `@editor/api`, como `pacotes/luz`.

- **Gizmo (`registerGizmo("AudioSource", …)`):**
  - ícone de alto-falante (`assets/editor/icons`), clicável;
  - selecionado: esferas de `minDistance` e `maxDistance`, na cor do gizmo; em 2D puro (`spatialBlend` 0), só o ícone.
  - O `AudioListener` ganha um ícone de ouvido.
- **Menus (`@menuItem`):**
  - `Criar/Áudio/Fonte` cria um objeto com `AudioSource` via `scene.createGameObject`, no ponto de `Editor.spawnPoint`;
  - `Criar/Áudio/Ouvinte` avisa se já existe ouvinte ativo;
  - `Janela/Mixer`.
- **Inspector (`onInspectorGUI`) do `AudioSource`:**
  - os campos automáticos (`ui.field`);
  - os botões **Tocar** e **Parar**, que funcionam fora do Play como prévia 2D pela voz de prévia, sem alterar a cena nem o Desfazer;
  - a linha de informação do clipe: taxa, canais, duração e memória.
  - Isso exige que o laço do editor chame `pumpAudio()` a cada quadro, o que hoje não acontece.
- **Painel do mixer:** `Janela/Mixer` seleciona um objeto oculto "Mixer" da UIScene, como o `ambiente/`. O `onInspectorGUI` dele desenha, por grupo, um slider de volume, mudo, pausa e um medidor de pico do último bloco. Salva em `assets/audio/mixer.json`, com Desfazer.
- Medidas e cores ficam no `ui_config.ts`.

## 5. WebSocket

Um comando `audio` por `registerCommand` no pacote (o nome não colide com os embutidos; `snd` continua):
- `audio play <obj> [clip]`: toca a fonte, ou um clipe nela. Responde com a voz e os ganhos iniciais.
- `audio stop [<obj>|tudo]`.
- `audio list`: uma linha por voz ativa, com:
  - voz, fonte, clipe, grupo;
  - posição/duração, pitch efetivo;
  - distância, `gL` e `gR`, corte do passa-baixa;
  - estado (virtual/pausada).
- `audio mixer [<grupo> <volume> | <grupo> mudo|pausa]`: sem argumentos, lista os grupos com o ganho efetivo.
- `audio listener`: pose, velocidade e origem (componente, `Camera.main`, pose empurrada ou editor), e o dispositivo (taxa, canais, `nulo`/real/mudo).
- `audio clip <caminho>`: decodifica e mostra taxa, canais, duração, pico e RMS.
- `audio nivel`: pico e RMS L/R do último bloco mixado.

**Verificar sem ouvir:** como faz o `test_audio3d`, a IA confere números.
- `audio list` mostra que uma fonte à direita tem `gL ≈ 0`.
- `audio nivel` mostra que o bloco não está em silêncio nem saturado.
- `audio mixer` mostra que um grupo mudo zera as vozes.

Com o dispositivo nulo, tudo isso funciona sem placa de som.

## 6. Testes

**Sem janela, por número** (`tests/test_audio_*.ts`, saída `[PASSOU]`):
- **WAV:** a fixture é gerada pelo próprio teste, com uma senoide conhecida escrita em PCM 8, 16 e 24 bits, int32 e float, mono e estéreo, em 22 050, 44 100 e 48 000 Hz. Confere amostras, duração e canais; chunk `LIST` no meio; arquivo truncado recusado com mensagem.
- **Resample:** 44,1 kHz para 48 kHz mantém a frequência (cruzamentos por zero) e a duração.
- **Laço:** a posição dá a volta sem descontinuidade no ponto de laço.
- **Pitch:** 2,0 dobra a frequência e reduz a duração à metade.
- **Ganhos L/R:** o `test_audio3d` passa a cobrir também o rolloff por fonte (log e linear), `spatialBlend` 0, 0,5 e 1, e a elevação.
- **Passa-baixa:** uma fonte atrás tem RMS menor em 10 kHz que à frente.
- **Rampa:** o salto de ganho no bloco é linear, sem degrau.
- **Grupos:** o ganho é o produto da cadeia; um grupo mudo leva a voz a virtual; a pausa congela a posição.
- **Doppler:** fonte se aproximando tem passo > 1, afastando tem passo < 1, com o limite respeitado.
- **Voz virtual:** retoma na posição certa.
- **Ciclo:** `playOnAwake` só no Play, e parar o Play interrompe tudo.
- **Ouvinte:** o fallback segue a ordem componente → `Camera.main` → pose empurrada.
- **Formato antigo:** um `AudioSource` salvo no formato antigo carrega.

**GC:** `tests/claude-test-audio-gc.ts`, com 200k pumps e 32 vozes (laço, pitch, 3D e grupos) no dispositivo nulo, e 0 coletas entre os marcadores.

**Bench:** `bench/claude-bench-audio.ts`, com 8, 16, 24 e 32 vozes, antes e depois do `mix_add`, na mesma sessão. O portão é a meta do §3.8.

**Regressão:** `check:params` (a exceção de `mixInto` sai), os scripts de componentes e as suítes do editor.

**Com janela e dispositivo real (manual):** prévia no Inspector, fonte 3D girando em volta da câmera e o painel do mixer.

## 7. Migração do rts-fps

O rts-fps hoje não tem som; `docs/entrega1-design.md` o deixou fora de escopo porque o motor não tinha saída de áudio.
- **Onde fica o som:** só no cliente. `src/shared/` e o servidor continuam sem áudio.
- **Gatilho:** o pool de efeitos (`adicionarEfeito`: marca, traçador, explosão). O cliente compara o pool a cada quadro e toca o som de cada efeito novo, com funções de ≤ 4 parâmetros e sem alocação.
- **Tiro:** `playOneShot("tiro.wav")`. O tiro próprio usa `spatialBlend` 0,3 (na cara do jogador); o dos outros é 3D, na origem do traçador; grupo Efeitos; pitch com variação de ±3 %.
- **Impacto:** `playClipAtPoint("impacto.wav", ponto da marca)`. A explosão usa `explosao.wav` com `maxDistance` maior.
- **Passos:** um acumulador de distância percorrida com `noChao`; a cada ~2,2 u, alterna entre `passo1` e `passo2` com pitch de 0,95 a 1,05. O passo dos outros é 3D, com um raio pequeno.
- **Música:** um `AudioSource` 2D em laço no grupo Música, com volume no menu de opções.
- **Ouvinte:** o rts-fps desenha pela pose `FPS_CAM_*`, sem componente `Camera`, então chama `Audio.setListenerPose` a cada quadro.
- **Assets:** clipes CC0 em `assets/audio/`. Até eles chegarem, clipes procedurais (`fromSamples`) exercitam o caminho.
- **Motor:** atualizar o submódulo `engine/`.

## 8. Fora deste desenho

- Reverb por zona e efeitos de insert no mixer (eco, compressor).
- HRTF: descartada com número em `spatial.ts` (~4,1 ms por voz).
- Streaming de música longa: decodificar em blocos durante o jogo. Hoje o clipe inteiro fica na memória.
- Gravação de microfone e chat de voz.
- MP3, FLAC e mais de 2 canais de entrada. A saída 5.1 continua com a média nos canais extras, como hoje.
- Áudio em rede: cada cliente toca a partir dos próprios eventos.

## 9. Ordem de entrega

1. **rts:** saída `rts:audio` (cpal) com os 7 membros, dispositivo nulo e `mix_add`, com testes no repo rts.
2. **rts-game, núcleo:**
   - `compat/audio.ts` passa a apontar para os membros reais;
   - `pumpAudio` no `game.ts` e no laço do editor;
   - vozes em `Float64Array` e `mixInto` com ≤ 4 parâmetros, com a sonda de GC e o bench antes e depois;
   - `wav.ts`, `AudioClip` e as vozes de clipe (laço, pitch, rampa).
3. **Componentes:** `AudioListener` (`KIND_AUDIO`), `AudioSource` ampliado com o formato antigo, mixer com grupos, rolloff por fonte e blend, passa-baixa e elevação, com os testes do §6.
4. **Pacote `audio/`:** gizmos, menus, Inspector com prévia, `Janela/Mixer` e o comando `audio`.
5. **rts-fps:** tiro, impacto, passos e música.
6. **Fase 2:** Doppler, oclusão por raycast, ducking, prioridade de voz, OGG/Vorbis no rts e filtro de resample de 4 taps.


## Decisão do usuário (2026-09-27)

Aprovado com um ajuste: **OGG/Vorbis entra na fase 1**, no mesmo PR do runtime que traz a saída de som (cpal), via `lewton` ou `symphonia` (que também cobre MP3 como opcional). WAV continua decodificado em TypeScript. Motivo: os pacotes de som de jogo vêm em WAV e OGG, e o runtime vai ganhar um PR de áudio de qualquer forma.
