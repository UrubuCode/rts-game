# Componentes definidos por scripts

Crie um arquivo `.ts` em `assets/scripts/` (pode usar subpastas). Exporte uma
classe que estenda `Behavior`; nenhuma alteração no Inspector, catálogo ou
fábrica é necessária.

```ts
import { Behavior } from "@engine/core/behavior";

export class MinhaNave extends Behavior {
  public velocidade: number = 3;
  public mover: boolean = true;
  public nome: string = "Exploradora";
  private tempo: number = 0;

  update(dt: f64): void {
    this.tempo = this.tempo + dt;
    if (this.mover) this.host.px = this.host.px + this.velocidade * dt;
  }
}
```

Após recompilar, **MinhaNave** aparece em Adicionar componente. Os três campos
públicos aparecem como número, checkbox e texto. `tempo` não aparece nem é salvo.
Cada GameObject tem sua própria instância e valores; editar não modifica o `.ts`.
No painel Project, arraste o `.ts` para um GameObject na Hierarquia, para o
Inspector do objeto selecionado ou para um objeto visível na viewport.
O editor mostra o destino e a adição aceita Desfazer/Refazer. Soltar no vazio
não cria objetos. Scripts ainda não registrados exigem recompilação; arquivos
com várias classes pedem a escolha pelo botão Adicionar componente.

Em **Configurações > Editor de código**, selecione um editor detectado
(VS Code, Cursor, Antigravity, Windsurf, Sublime Text ou Notepad++) ou clique
em **Procurar...** para escolher outro `.exe`. A detecção consulta as pastas
habituais de instalação; instalações portáteis podem ser escolhidas manualmente.
Clique **Salvar** para persistir em `.rts-editor.local.json` (ignorado pelo Git).
Cancelar o seletor mantém o caminho; cancelar as preferências descarta a edição.
Dois cliques no script usam o editor salvo. **Padrão do Windows** usa a associação
de `.ts`, que pode ser um reprodutor de vídeo: escolha um editor explicitamente
para evitar isso. Não alteramos associações nem instalamos programas.
Após editar o código, recompile o editor.

Também é possível anexar pelo código:

```ts
import { createComponent } from "@engine/components";
const objeto = scene.createGameObject("Nave");
const componente = createComponent("MinhaNave");
objeto.addBehavior(componente);
componente.mount(); // objeto já pertence à cena
```

O registro cria a classe real, sem wrapper. `new MinhaNave()` também funciona
no editor/jogo inicializado: os campos são reconhecidos pelo provider gerado.

## Logs de scripts

Use a API familiar do Unity, ligada ao logger único da engine:

```ts
import { Debug } from "@engine/debug";

Debug.Log("Nave criada");
Debug.LogWarning("Sem alvo selecionado");
Debug.LogError("Falha ao carregar o mapa");
Debug.Log({ vida: 100, energia: 40 });
```

No editor, as mensagens aparecem no Console com tipo, ícone e contador. No
jogo separado, ficam no histórico em memória e no stdout; ainda não há arquivo
persistente nem transmissão para o editor. As funções `logInfo`, `logWarn` e
`logError` continuam compatíveis. A API não promete ainda o parâmetro `context`
GameObject nem captura automática de stack trace da classe Debug do Unity.

## Gerar e compilar

Na primeira vez, execute `npm ci`. Depois:

```powershell
npm run build:editor
npm run build:game
```

Se necessário, defina `RTS_COMPILER` com o caminho completo do `rts.exe`.
`run.ps1`, `tools/build.bat` e o workflow de executáveis também geram os metadados.
Para usar o CLI diretamente, rode `npm run components` antes de `rts run` ou
`rts compile`. Execute `npm run components:check` para detectar arquivos gerados
desatualizados. Os arquivos em `src/engine/generated/` são versionados.

**É descoberta no build, não hot reload.** Um executável já compilado não consegue
incorporar um `.ts` novo simplesmente copiando o arquivo para sua pasta.

## Marcações opcionais na própria classe

São comentários JSDoc, não decorators de runtime:

```ts
/**
 * @componentId gameplay.player
 * @componentCategory Gameplay
 * @componentDescription Controla a nave do jogador.
 * @componentKeywords nave jogador movimento
 */
export class MinhaNave extends Behavior {
  /** @label Velocidade máxima
   * @range 0 20 */
  public velocidade: number = 3;

  /** @serializeField */
  private vida: number = 100;

  /** @hideInInspector */
  public versao: number = 1;

  /** @nonSerialized */
  public cache: number = 0;
}
```

- Campos sem modificador são públicos no TypeScript e também são descobertos.
- Campos herdados são incluídos; a infraestrutura de `Behavior` é excluída.
- Static, readonly, métodos e getters não são campos editáveis.
- `@serializeField` expõe/serializa private ou protected; não suporta `#private`.
- `@hideInInspector` salva o campo, mas não o desenha. `@nonSerialized` exclui ambos.
- `onValidate(field: string)` pode atualizar dados derivados após a edição.
- Nomes de classes duplicados geram erro, em vez de selecionar a classe errada.
- O construtor precisa aceitar zero argumentos. Um preset especial pode ser um
  método estático sem argumentos, indicado por `@componentFactory nomeDoMetodo`.
- `@componentIgnore` exclui uma classe interna do seletor.
- Sem `@componentId`, a identidade salva é derivada do caminho e nome da classe.
  Defina um ID estável antes de renomear/mover um script usado por cenas.
- Scripts ausentes aparecem como tal no Inspector, preservam seus dados ao
  salvar e bloqueiam Rodar até serem recuperados ou removidos explicitamente.

## Luz, câmera e ambiente por script

`Light`, `Camera` e o bloco `scene.ambiente` são dados comuns da cena: um script
escreve os campos e o renderer recebe a mudança no quadro seguinte. Não há
`markDirty`: o motor compara o que empacotou com o último envio e só reenvia
quando algo mudou.

```ts
import { Behavior } from "@engine/core/behavior";
import { Light } from "@engine/core/light";
import { Camera } from "@engine/core/camera";
import { activeScene } from "@engine/core/active_scene";

export class Lanterna extends Behavior {
  // saídas reaproveitadas: nada de `new` por quadro
  private raio: Float64Array = new Float64Array(6);
  private tela: Float64Array = new Float64Array(3);

  mount(): void {
    const sc = activeScene();
    if (sc === null) return;
    const o = sc.createGameObject("Lanterna");
    o.transform.setPosition(0.0, 3.0, 0.0);
    const luz = new Light();
    luz.tipo = "spot";           // "direcional" | "pontual" | "spot"
    luz.cor = 0xFFE0A0;          // 0xRRGGBB
    luz.intensidade = 2.0;
    luz.alcance = 12.0;          // pontual e spot chegam a zero aqui
    luz.anguloSpot = 40.0;       // abertura TOTAL, em graus
    o.addBehavior(luz);
    // céu: "estrelas" | "procedural" | "cor" | "panorama" (ceu.textura = PNG equirretangular)
    sc.ambiente.ceu.modo = "procedural";
    sc.ambiente.neblina.densidade = 0.03;
    sc.ambiente.luzAmbiente.modo = "cor";   // "legado" (padrão) | "cor" | "ceu"
    sc.ambiente.luzAmbiente.intensidade = 0.1;
  }
  update(dt: f64): void {
    const cam = Camera.main();
    if (cam === null) return;
    cam.screenPointToRay(640.0, 360.0, this.raio);          // origem(3) + direção(3)
    if (cam.worldToScreenPoint(0.0, 0.0, 0.0, this.tela) === 1) {
      // a origem do mundo está à frente da câmera, em (tela[0], tela[1]) px
    }
  }
}
```

- A direção de uma direcional ou de um spot vem da rotação do GameObject
  (`transform.rx` é o pitch e `transform.ry`, o yaw). O disco do sol no céu
  procedural segue a direcional principal. É a indicada em `ambiente.sol`
  (nome do objeto); sem ela, a primeira direcional ativa com sombra; sem
  nenhuma com sombra, a primeira direcional ativa.
- Sombra: só a primeira direcional ativa com `sombra = true` usa o shadow map.
- Até 8 luzes por quadro: a direcional principal e, depois, as mais próximas da câmera.
- `Camera`:
  - `fov` em radianos (o Inspector mostra graus), `isMain`, `near`/`far`,
    `ortografica`/`tamanhoOrto`, `fundo` (`"ceu"`, `"cor"`, `"nada"`) com
    `corFundo`, o retângulo `viewportX/Y/W/H` (0..1) e `profundidade` (ordem de
    desenho);
  - `Camera.main()` e `Camera.all()` (este devolve um array reaproveitado: copie
    se for guardar);
  - raios por `viewportPointToRay(u, v, out)` e `screenPointToRay(x, y, out)`;
    projeção por `worldToScreenPoint(x, y, z, out)`.
- No JSON da cena, o ambiente fica no bloco `"ambiente"` (`ceu`, `neblina`,
  `luzAmbiente`, `sol`). Sem o bloco, a cena mantém o visual antigo.

### Pacotes de exemplo (`assets/pacotes/`)

Os três pacotes mostram como estender o motor sem tocar no editor:

| Pacote | Jogo | Editor (`@editorOnly`) |
|---|---|---|
| `luz/` | — (a `Light` é do motor) | `luz_editor.ts`: gizmo por tipo (`registerGizmo("Light", …)`), `Criar/Luz/*`, comandos `luz` e `luzes` |
| `camera/` | `CameraPrimeiraPessoa`, `CameraOrbita`, `CameraSeguir`, `CameraRTS` | `camera_editor.ts`: frustum, `Criar/Câmera`, comandos `camera` e `cameras` |
| `ambiente/` | `CicloDoDia` (gira o sol e interpola as cores do céu) | `ambiente_editor.ts`: `Janela/Ambiente`, comandos `ambiente` e `ambienteinfo` |

Os controles de câmera leem teclado e mouse por `@engine/core/entrada`. No
editor, essa entrada só fica ligada com a aba **Jogo** ativa e sem campo de
texto ou de número em edição. No jogo exportado, fica sempre ligada.

## Áudio

O motor toca WAV (PCM 8/16/24/32 bits e float 32, mono ou estéreo, decodificado em TypeScript) e OGG/Vorbis (decodificado pelo runtime), com 32 vozes, mixagem nativa (`rts:audio`, `mix_add`) e espacialização por fonte. Os clipes são reamostrados na carga para a taxa do dispositivo; limites: WAV até 256 MB, OGG até 10 minutos estéreo, mais de 2 canais é recusado com mensagem no Console.

- **`AudioListener`** (categoria Áudio): o ouvido, na pose do objeto. Só o primeiro ativo vale (o Console avisa uma vez se houver dois). Sem ele, vale `Camera.main`; sem câmera, a pose que o jogo empurra com `Audio.setListenerPose(pose)` (`[x, y, z, yaw, pitch]`); por último, a vista do editor.
- **`AudioSource`**: `modo` (`"arquivo"` toca `clip`; `"gerador"` toca o tom por `forma`/`freq`/`dur` — padrão `"arquivo"`; um `clip` guardado em modo gerador não é apagado, só não toca), `clip` (caminho `.wav`/`.ogg`), `volume`, `pitch`, `loop`, `playOnAwake`, `mudo`, `spatialBlend` (0 = 2D, 1 = 3D), `rolloff` (`log` = `min/d`, `linear`), `minDistance`, `maxDistance`, `grupo` (vazio = Master), `every` (repete a cada N s). O Inspector mostra os campos do modo atual (o campo `clip` só em Arquivo; `forma`/`freq`/`dur` só em Gerador). Cena salva sem `modo` migra ao carregar: `"arquivo"` se `clip` não vazio, senão `"gerador"`; o formato antigo (`type:"audiosource"`) sempre migra para `"gerador"`. Escolher um clipe (seletor, arraste ou atribuição direta de `clip` não vazio) liga `modo = "arquivo"` sozinho. Métodos: `play()`, `stop()`, `pause()`, `unPause()`, `isPlaying()`, `time`, `playOneShot(clip, escala)`, `AudioSource.playClipAtPoint(clip, pos, volume)`. Fora do Play nada toca sozinho; no Play e no jogo, `playOnAwake` toca ao entrar na cena, e parar o Play cala tudo.
- **Campo `clip` (ObjectField estilo Unity)**: caixa com ícone + `"<nome sem extensão> (AudioClip)"`/`"Nenhum (AudioClip)"`, botão `…` que abre "Selecionar AudioClip" (lista cacheada de `.wav`/`.ogg` sob `assets/`, recarregada quando o Project rescaneia ou `importar` copia um arquivo; busca por texto; "Nenhum" no topo; clique seleciona, duplo clique/Enter confirma, Esc fecha). Clique simples no campo "pinga" o arquivo no painel Project (abre a pasta e seleciona o tile). Aceita soltar um tile de áudio arrastado do Project (realce verde compatível/vermelho recusa enquanto paira); Delete/Backspace com o campo focado volta a "Nenhum". Tudo com Desfazer. `InspectorUI.objectField(nome, tipo, exts, icon)` é genérico (tipo + filtro de extensões); hoje só o `clip` do `AudioSource` usa.
- **Painel Project**: `.wav`/`.ogg` aparecem como tiles de áudio (cor/tag próprias); duplo clique toca/para uma prévia 2D, e a legenda do tile mostra a duração (cacheada por arquivo).
- **Importar arquivos**: `importFileToAssets` (`src/editor/import_assets.ts`) copia um arquivo de fora do projeto pra dentro de `assets/` (sufixo `" 1"`, `" 2"`... em colisão de nome; um arquivo já dentro de `assets/` não é copiado). Comando WS `importar <caminho> [pasta]` — sem `pasta`, áudio vai para `assets/audio` e o resto para a pasta aberta do Project.
- **3D**: pan de potência constante, atenuação por fonte, passa-baixa que cai de 22 kHz (frente) a 5 kHz (atrás) e com a distância (frente e trás soam diferentes), o pitch do ouvinte conta (fonte acima de quem olha para cima está à frente). Além de `maxDistance`, ou num grupo mudo, a voz fica **virtual**: a posição anda sem mixar e retoma no ponto certo.
- **Mixer**: `assets/audio/mixer.json` (arquivo de projeto, vale para todas as cenas; não entra no Desfazer da cena). Grupos com nome livre em árvore (padrão Master → Música, Efeitos, Voz), cada um com volume, mudo e pausa. `Janela/Mixer` edita e tem Salvar/Reverter; por script, `Mixer.setVolume("Música", 0.5)`, `Mixer.mute`, `Mixer.pause`, `Mixer.grupoIndex` (resolva o índice uma vez).
- **Sem componente**: `Audio.play(clip, pedido)` com um pedido de `novoPedido()` (`@engine/audio/vozes`), e `Audio.playClipAtPoint(clip, pos, volume)`.
- **Verificar sem ouvir** (WS): `audio list` (uma linha por voz: fonte, clipe, grupo, posição, pitch, distância, `gL`/`gR`, corte, estado), `audio nivel` (pico e RMS L/R do último bloco), `audio mixer`, `audio listener` (origem do ouvinte e o dispositivo `real`/`nulo`/`mudo`), `audio clip <caminho>`, `audio play <obj> [clip]`, `audio stop`, `audio escuta [ms] [sonda]` + `audio escuta resultado` (loopback pela saída real da placa, não bloqueia a janela; a sonda de 997 Hz separa o som do motor do de outros programas rodando na máquina). Nos testes sem janela, `initAudio(AUDIO_NULO)` abre um dispositivo que consome em tempo real e descarta; `mixarBloco(n)` mixa um bloco sem esperar o relógio.
- **Build**: tudo em `assets/` vai junto (`tools/editor-build.mjs:20`), inclusive os clipes e o `mixer.json`.

## Estender o editor por script

Tudo vem de `@editor/api`. No jogo exportado não há editor, e as chamadas viram
no-op, sem erro. Registre comandos, ganchos e desenhadores no carregamento do
módulo (fora de funções), para que existam antes do primeiro quadro.

**Comando da porta WS** (`ws://127.0.0.1:7777`):
- o nome não pode ter espaço nem repetir um comando embutido;
- `muta = true` põe o comando no Desfazer;
- uma resposta que não começa com `[` ganha `[ok] ` na frente;
- a ajuda no formato `"<args> :: descrição"` aparece no `help` e no `doc`.

```ts
import { Editor, registerCommand } from "@editor/api";
registerCommand("oi", "oi :: responde olá", false, (p: string[]) => "olá " + p.length);
```

**Ganchos**: `salvar`, `abrirCena`, `entrarPlay` e `sairPlay`.

```ts
Editor.on("salvar", (caminho: string) => { Editor.log("salvo em " + caminho); });
```

`Editor` também oferece `scene()`, `selection()`, `select(o)`,
`snapshot(rótulo)` (um passo de Desfazer), `log(msg)`, `viewPose(out)`,
`spawnPoint(out)` e `inspect(b, título)`.

**Gizmos, menu Criar e Inspector próprio** num componente:

```ts
import { Behavior } from "@engine/core/behavior";
import type { InspectorUI } from "@engine/core/inspector_ui";
import { Editor, Gizmos } from "@editor/api";

export class Farol extends Behavior {
  alcance: number = 5.0;
  private centro: Float64Array = new Float64Array(3);
  // Todo quadro no editor, para objetos visíveis; nunca roda no jogo.
  // onDrawGizmosSelected(g) é igual, mas só com o objeto selecionado.
  onDrawGizmos(g: Gizmos): void {
    this.centro[0] = this.host.wx; this.centro[1] = this.host.wy; this.centro[2] = this.host.wz;
    g.color(0xFFCC00);
    g.wireSphere(this.centro, this.alcance);
  }
  // Substitui a lista automática de campos. Sem nenhum controle, a lista automática volta.
  onInspectorGUI(ui: InspectorUI): void {
    ui.field("alcance");                       // o campo com o controle padrão
    if (ui.button("Dobrar alcance")) { ui.alterar(); this.alcance = this.alcance * 2.0; }
  }
  /** @menuItem Criar/Meu/Farol */
  static criar(): void {
    const sc = Editor.scene();
    if (sc !== null) { const o = sc.createGameObject("Farol"); o.addBehavior(new Farol()); Editor.select(o); }
  }
}
```

- `Gizmos`: `color(0xRRGGBB)`, `line(a, b)`, `wireSphere(c, r)`,
  `wireCone(ápice, dir, comprimento, ânguloGraus)` e `icon(nome, pos)`. Os
  pontos são `Float64Array(3)` do chamador. Clicar num ícone na vista de Cena
  seleciona o dono.
- `onInspectorGUI(ui)`: `field(nome)`, `label`, `button`, `toggle`, `slider`,
  `color` (#RRGGBB), `dropdown`, `alterar()` (Desfazer antes de o componente
  mudar a si mesmo) e `alinharComVista(o)`.
- `@menuItem Caminho/Do/Item` vale em métodos `static` sem argumentos, e só
  como tag JSDoc.
  - `Criar/…` entra no menu Criar global e no menu de contexto da Hierarquia,
    com Desfazer. Os dois menus leem o mesmo registro.
  - `Janela/…` entra no menu Janela.
  - Pela porta WS, `menu` lista os itens e `menu Criar/Meu/Farol` executa um.

**Gizmo para um tipo que você não pode editar** (por exemplo, `Light` e
`Camera`, que são do motor):

```ts
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { registerGizmo, Gizmos } from "@editor/api";

const ponto = new Float64Array(3);
function desenharMarcador(g: Gizmos, dono: GameObject, comp: Behavior): void {
  ponto[0] = dono.transform.wx; ponto[1] = dono.transform.wy; ponto[2] = dono.transform.wz;
  g.icon("luz-pontual", ponto);
}
registerGizmo("Marcador", desenharMarcador);   // pelo typeName do componente
```

**Código só do editor.** `/** @editorOnly */` no topo do arquivo tira o arquivo
do jogo exportado.
- O build do jogo entra por `tools/game-build/entry.ts`. O `tsconfig.json` dessa
  pasta troca o registro gerado pelo registro sem as classes `@editorOnly`.
- `npm run build:game` usa essa entrada. `npm run check:game-build` confere que
  o registro do jogo não tem nada do editor.
- Um arquivo `@editorOnly` pode importar `@editor/…`. Um arquivo que roda no
  jogo não deve.

**Onde pôr.** Scripts de gameplay ficam em `assets/scripts/`. Pacotes (jogo e
editor juntos) ficam em `assets/pacotes/<nome>/`. O gerador do catálogo
(`npm run components`) lê as duas pastas.

## Migração: API de desenho por quadro (Task 10.5)

No RTS, uma chamada com 5 ou mais parâmetros escalares aloca a cada chamada.
Só isso dava de 8 a 18 coletas de lixo a cada 1000 quadros no editor. Por isso,
as chamadas de desenho passaram a ter no máximo 4 parâmetros. Scripts de fora
do repositório, como o `rts-fps`, precisam destas trocas:

| Antes | Agora |
|---|---|
| `drawSelf(win, x, y, z, tint)` | `drawSelf(win, pos: Float64Array, tint)`, com `pos = [x, y, z]` |
| `app.box(x, y, w, h, fill, strokeW, stroke, radius)` / `render.rect(…)` | `pincel(fill, strokeW, stroke, radius)` e depois `caixa(x, y, w, h)` |
| `app.text(x, y, s, cor, tamanho)` / `render.text(…)` | `texto(x, y, s, estiloTexto(cor, tamanho))` |
| `app.line(x1, y1, x2, y2, w, cor)` / `render.line(…)` | `traco(w, cor)` e depois `linha(x1, y1, x2, y2)` |
| `render.image(…)` a cada quadro | `registrarImagem(pixels, w, h)` uma vez; por quadro, `imagemEm(x, y, w, h)` e `imagemId(id)` |
| `app.button(x, y, w, h, …)` / `app.textField(x, y, w, h, …)` | `app.at(x, y, w, h)` e depois `app.button(…)` / `app.textField(id, texto, hab)` |
| `app.clickable(id, x, y, w, h)` | `app.clickable(x, y, w, h)`, ou `app.at(…)` e `app.clickableAt(id)` |
| `EditorUI.control(nome, modo, x, y, w, h, …)` | `ui.at(x, y, w, h)` e depois `ui.control(nome, modo, rótulo, hab)` |
| `fpsApp.text(x, y, s, cor, tamanho)` e outras chamadas `<app>.text`/`box`/`line` num app próprio | `texto(x, y, s, estiloTexto(cor, tamanho))`, `pincel`+`caixa`, `traco`+`linha` de `@compat/draw2d.ts` (o app não desenha mais) |
| `drawGPUMeshQ(win, mesh, px, py, pz, q, sx, sy, sz, cor, emissivo, tex)` (removida) | `drawGPUMeshQBuf(win, mesh, d)`, com `d` de `DRAW_FLOATS` números: posição em `D_X..D_Z`, escala em `D_SX..D_SZ`, `D_COR`, `D_EMISSIVO`, `D_TEX` e o quaternion em `D_QX..D_QW` |
| `drawSceneObjects(objs, trs, n, sc, win, selected, alpha, cx, cy, cz, cyw, syw, cpt, spt, …)` | `prepararDesenho(cfg, fParams, selected, alpha)` e depois `drawSceneObjects(sc, n, win, cfg)`, com `cfg` de `DS_FLOATS` números (`@engine/render/scenedraw`) |
| `scene.mainCameraIdx()` (removida) | `Camera.main()` (`@engine/core/camera`): devolve o componente; o objeto é `Camera.main().owner` |
| `behavior.camIsMain()` (removida) | `Camera.main() === câmera`, ou o campo `isMain` do componente `Camera` |

- `pincel`, `caixa`, `texto`, `estiloTexto`, `traco`, `linha`, `imagemEm`,
  `imagemId` e `registrarImagem` vêm de `@compat/draw2d.ts`. Chame
  `janela2D(win)` uma vez para escolher a janela.
- Também mudaram:
  - `hullContactLocal` recebe a esfera num `Float64Array`;
  - `setListener` recebe a pose num `Float64Array`;
  - `hitRect` recebe o retângulo num `Float64Array`;
  - `pbDecideAuto` recebe o estado num `Float64Array`.
- Continuam existindo, mas alocam por chamada: `drawGPU`, `drawGPUMesh`,
  `setCam`, `frustumBegin`, `setLgt` e `setShadow`. Em código por quadro, use
  `drawGPUBuf`/`drawGPUMeshBuf` e `setCamBuf`/`frustumBeginBuf`.
- `npm run check:params` acusa funções com 5+ parâmetros que estejam fora da
  lista de exceções justificadas.

**Ordem de merge.** Este conjunto depende de nativos novos do motor (imagens
retidas `imageRegister`/`drawImageId`, `setVsync` booleano, luzes e céu da
cena 3D). O CI (`.github/workflows/build-executable.yml`) baixa o `rts.exe` do
**último release** do motor, então a ordem é: PR do `rts` → release do `rts`
→ merge deste branch. Mesclar antes do release quebra o build do CI.

## Compatibilidade e limites

Esta etapa suporta campos escalares `number/f64`, `boolean` e `string`. Arrays,
objetos aninhados e referências a assets/GameObjects ainda precisam de suporte
específico; campos públicos desses tipos produzem um diagnóstico no build.
O parser apenas analisa os arquivos, sem executar o código dos scripts.

Spinner, Bobber, Mover, Pulse, Orbit e Patrol usam campos gerados, preservando seus
formatos de cena antigos. Componentes com campos especiais (por exemplo, FOV da
Camera em graus, Material e Rigidbody) conservam os inspectores personalizados
`fieldCount/fieldGet/fieldSet`. Esses overrides são opcionais para scripts novos.

- **`AudioSource` antigo** (`{ "type": "audiosource", "kind": 0|1|2, "freq", "dur", "gain", "every" }`): carrega como o componente novo com `forma` = seno/quadrada/ruído, `volume = gain`, `clip` vazio e `playOnAwake` desligado (o antigo só tocava por `play()` ou `every`). Ao salvar, vai no formato gerado. `playTone`/`playSquare`/`playNoise` e os `*At` continuam, agora como clipes gerados uma vez.

O Inspector continua usando controles GameObject. O catálogo é apenas metadado;
o runtime instala um provider de reflexão gerado, inclusive para instâncias
criadas diretamente por scripts. Não há varredura do disco em cada frame.
Entrypoints próprios, fora do editor/game.ts, devem importar
`@engine/generated/components` uma vez no bootstrap. Scripts de componentes
importam somente `@engine/components` para criar outros componentes; importar o
arquivo gerado dentro do próprio script produziria um ciclo de módulos.

## Testes

```powershell
npm run test:components
npm run components:check
rts.exe run tests/test_component_reflection.ts
rts.exe run tests/test_editor_preferences.ts
rts.exe run tests/test_code_editor_selector.ts
rts.exe run tests/test_component_factory.ts
rts.exe run tests/test_component_picker.ts
rts.exe run tests/test_play_mode.ts
rts.exe run tests/test_editor_api.ts
rts.exe run tests/test_menu_items.ts
rts.exe run tests/test_inspector_gui.ts
rts.exe run tests/test_pacote_luz.ts
rts.exe run tests/test_pacote_camera.ts
rts.exe run tests/test_pacote_ambiente.ts
npm run check:game-build
```
