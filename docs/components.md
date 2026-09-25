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

## Compatibilidade e limites

Esta etapa suporta campos escalares `number/f64`, `boolean` e `string`. Arrays,
objetos aninhados e referências a assets/GameObjects ainda precisam de suporte
específico; campos públicos desses tipos produzem um diagnóstico no build.
O parser apenas analisa os arquivos, sem executar o código dos scripts.

Spinner, Bobber, Mover, Pulse, Orbit e Patrol usam campos gerados, preservando seus
formatos de cena antigos. Componentes com campos especiais (por exemplo, FOV da
Camera em graus, Material e Rigidbody) conservam os inspectores personalizados
`fieldCount/fieldGet/fieldSet`. Esses overrides são opcionais para scripts novos.

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
```
