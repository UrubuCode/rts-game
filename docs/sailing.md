# Mar Aberto: protótipo de navegação

Próximas implementações: [tarefa sequencial ENG-NAV-001](superpowers/plans/2026-10-02-water-navigation-foundation.md)
e [especificação da fundação](superpowers/specs/2026-10-02-water-navigation-foundation.md).

```powershell
.\run-pbr.ps1 -Scene sailing -RuntimePath ..\rts-pbr -TargetPath ..\pbr-target
```

Você começa no leme de um veleiro, com a vela recolhida. Segure W para abrir
a vela; S recolhe. A/D viram o leme e o barco ganha capacidade de manobra com
a velocidade. Espaço alterna a âncora, que desacelera progressivamente.
C alterna câmera externa e câmera a bordo. Mouse direito permite olhar em
volta. R reinicia a posição e os controles; Esc ou fechar a janela encerra.

O objetivo é passar próximo das cinco boias douradas, começando pela que está
à frente. Há ilhas, farol e um pequeno cais. Colisões aproximadas com as ilhas,
o cais e o limite de navegação param o barco; R recupera uma embarcação presa.

## Componentes

`SailboatController` controla movimento e acompanha a água indicada por
`waterObject`, com suporte a WaterSurface e WaterBody. A entrada é independente
de teclado: `setRudder(-1..1)`, `setSail(0..1)`, `toggleAnchor()` e
`resetMotion()` podem ser usados por jogador ou IA. Configurações de vento,
velocidade, aceleração, leme e pontos de apoio são serializadas; os controles
e a velocidade em execução não são salvos.

O apoio consulta proa, popa, bombordo e estibordo, suavizando altura, pitch e
roll. A integração usa subpassos de até 1/60 s e limita pausas longas a 0,1 s.
Vento favorável produz mais impulso; contra o vento há assistência de jogo.

`SailboatRenderer` cria e retém malhas de casco, convés e vela. Sua composição
usa quaternion, incluindo a inclinação lateral que o desenho comum dos
GameObjects ainda não suporta. A vela sobe/desce conforme o controlador.
O modelo tem dimensões fixas aproximadas de 10 × 4 unidades; os parâmetros
length/width do controlador ajustam a amostragem da água, não a malha.

Adicione ambos a um GameObject raiz, sem Rigidbody nem Buoyancy: este controle
é cinemático e já integra a posição. A demo faz a verificação de obstáculos;
o componente isolado não implementa colisões de casco.

## Escopo

É um protótipo jogável de pilotagem, com arte procedural simples. Não é uma
reprodução de Sea of Thieves. Ainda não há personagem andando pelo convés,
tripulação, canhões, dano, natação, multiplayer, torque físico completo,
colisões navais ou ajuste do ângulo das velas. O campo de água é finito.

`tests/sailboat.ts` verifica aceleração, leme, âncora, apoio nas ondas, limites
da água, reinício, serialização e estabilidade em 60/120 Hz. A demo tem
encerramento automático com RTS_PBR_FRAMES e captura com RTS_PBR_CAPTURE.

Os testes de navegação, serialização e os 16 testes do gerador passaram.
A sonda longa de 200 mil iterações foi interrompida; o teste está incluído,
mas zero alocação do renderer do barco ainda não está validada. O benchmark
de 300 quadros registrou 8,20 ms com o barco oculto e 19,61 ms visível,
com a máquina a 100% de uso e outros trabalhos concorrentes. Esses números
não isolam o custo do barco e não representam uma meta de desempenho atingida.
