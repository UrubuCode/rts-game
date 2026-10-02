# Multiplayer por componentes

A base UDP que existia no protótipo FPS agora pertence à engine, em
`src/engine/net`. `NetworkManager`, `NetworkObject` e `NetworkTransform`
entram no catálogo gerado, na categoria **Rede**, com configuração por
instância, serialização e cópia para Play.

## Uso

Adicione um `NetworkManager` a um GameObject da cena. Configure `mode`
(`server` ou `client`), `address` (IPv4 do servidor), `port`, `maxPlayers`
e `tickRate`. `autoStart` inicia no primeiro update do jogo/Play; o padrão
é desligado. Configure callbacks e prefabs antes de iniciar.

```ts
import { NetworkManager } from "@engine/core/network_manager";
import { configureMovement } from "../examples/network_movement";

const session = scene.createGameObject("Network session");
const manager = new NetworkManager();
session.addBehavior(manager);
manager.mode = "server";
manager.port = 27015;
configureMovement(manager);
manager.start();
// O loop normal chama scene.update(dt).
```

No cliente, crie outro gerenciador em outra cena/processo, configure
`mode = "client"`, `address` e a mesma porta/taxa. Chame `start()` e aguarde
`isConnected()`. O exemplo envia comandos de um byte:

```ts
const input = new Uint8Array(1); // reutilizado durante a sessão
// Antes de scene.update(dt), a cada tick:
input[0] = rightPressed ? 1 : leftPressed ? 2 : 0;
manager.sendInput(input, 1);
```

`examples/network_movement.ts` fornece a regra do servidor: cria um jogador
por conexão, valida o comando e move somente o objeto daquele cliente,
a 3 unidades/segundo. Não inclui janela, input de teclado ou colisão.
O ID do dono vem da conexão; a posição não é aceita do cliente.
O último input pode ser repetido quando um pacote falta: envie também o
estado neutro ao soltar teclas. Ações pontuais precisam de IDs/deduplicação
na lógica do jogo.

`spawn(gameObject, ownerId)` exige `NetworkObject` e publica o objeto.
O dono 255 representa o servidor. `despawn(object)` remove a instância e
avisa os clientes; desconectar remove objetos daquele dono. `stop()` fecha
o transporte e remove os objetos publicados/recebidos pela sessão. Limpar
a cena, remover o componente ou parar Play libera seus recursos.
Desabilitar um componente suspende seus updates; para encerrar imediatamente
a sessão, chame `stop()`.

## Prefabs e estado próprio

O prefab 1 é um jogador de teste com malha simples, `NetworkObject` e
`NetworkTransform`. Substitua-o ou registre outros via
`manager.prefabs.register(id, () => gameObject)`. A fábrica deve criar uma
instância nova com `NetworkObject` e os mesmos componentes de estado, na
mesma ordem, que o servidor. IDs válidos: 1–65535. Não se transmitem arquivos
ou scripts. ID desconhecido é ignorado.

`NetworkTransform` replica posição e yaw. Escala, animação, pitch/roll,
inventário e vida exigem estados próprios estendendo `NetworkState`, com
`writeState(writer)` e `readState(reader)`. Os estados são coletados pelo
`NetworkObject` ao montar/publicar. Não altere esse esquema durante a sessão.
Valide limites e leituras antes de aplicar estado. Callbacks, fábricas,
sockets, `netId` e `ownerId` são de runtime e não ficam no arquivo da cena.

Para testes/transporte customizado, use `startServerOn(transport, scene)` ou
`startClientOn(transport, peer, scene)`. O gerenciador assume a responsabilidade
de fechar o transporte. `NetRedeMemoria` simula perda/atraso com semente fixa.
Os nomes legados em português da camada de protocolo foram preservados.

## Protocolo e limites desta etapa

- UDP IPv4, protocolo v1, cabeçalho de 12 bytes, MTU de 1200 bytes,
  sequências/ACKs, canal confiável ordenado e snapshots não confiáveis.
- Tick padrão 60 Hz; snapshots a cada dois ticks nesse padrão. Há limite
  de quatro ticks de recuperação por update para evitar uma espiral de atraso.
- Inputs até 32 bytes, mensagens confiáveis até 380 bytes e 64 mensagens
  confiáveis pendentes por conexão. Entrada tardia de mundos maiores precisa
  de envio gradual: exceder essa janela pode encerrar a conexão.
- Snapshots divididos em mensagens com orçamento de 700 bytes. O estado de
  cada objeto deve caber nesses limites; não há fragmentação de um único estado.
- Filas limitadas a 1024 mensagens, recepção por passo limitada a 256 pacotes;
  o transporte UDP guarda até 256 endpoints recebidos ao longo da sessão.
- `netId` é monotônico de 16 bits, sem reutilização dentro da sessão.
  O contador de snapshot de 32 bits ainda não trata uma sessão que atravessa
  sua volta. Clientes devem usar a mesma versão e esquema de prefabs.

Ainda faltam interpolação, predição/reconciliação, compensação de lag,
interesse por distância/chunk, sincronização de alterações do mundo,
autenticação, criptografia, descoberta de partidas e NAT/relay. O transporte
atual abre a porta de servidor nas interfaces disponíveis. Os testes cobrem
localhost; não estabelecem desempenho ou segurança de um serviço na internet.
O tráfego ainda aloca buffers por mensagem; não há garantia de zero GC em
uma partida ativa.

## Validação

Execute com o runtime RTS compatível e os aliases deste projeto:

```powershell
$fixture = '..\pbr-target\debug\examples\ui_fixture.exe'
& $fixture tests/net-buffer.ts
& $fixture tests/net-conexao.ts
& $fixture tests/net-confiavel.ts
& $fixture tests/net-replicacao.ts
& $fixture tests/net-transporte.ts
& $fixture tests/network-manager.ts
& $fixture tests/network-components.ts
```

`network-manager` exercita um servidor e dois clientes no mesmo processo,
com três cenas independentes e sockets UDP reais em portas efêmeras. Também
executa com perda de 15% e atraso de dois passos em memória. Cobre entrada
tardia, convergência, validação de comandos, desconexão e limpeza de recursos.
Os testes de conexão/confiabilidade cobrem perdas de 30%/20%, reconexão,
sequências com volta e mensagens truncadas. O teste de replicação inclui
snapshots de 122 objetos.

`network-components` cobre persistência, IDs transitórios, Play/Stop,
compatibilidade binária, valores inválidos e limites de fila.
`network-frame-gc` mede 200 mil ticks de servidor sem clientes mais escrita
de transform: zero coletas entre marcadores na validação local. Isso não
mede o caminho com tráfego.

Benchmark local de regressão `jogo-vitrine`, uma execução de 300 quadros após
60 de aquecimento, mesmo runtime: média de quadro 6,729 → 7,073 ms; CPU TS
5,775 → 5,951 ms; zero GC em ambas. A carga média da máquina foi 41,1% →
43,7%. A amostra curta não permite atribuir essa variação à mudança, nem
representa o custo de uma partida em rede.
