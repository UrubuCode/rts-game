# O mapa

Gerado por `src/shared/map.ts` a partir de uma semente (LCG, sem `Math.random`),
na mesma ordem em servidor e clientes. Contrato: ~3.000 estáticos em escala 1,
64 renascimentos nos cruzamentos, tudo na camada `FPS_CAMADA_MAPA`; escala 0
gera só chão e quatro bordas. Constantes em `src/shared/config.ts` (bloco
"mapa"). Testes em `tests/fps-map.ts`.

## Grade

Cidade de 9 × 9 quarteirões de 40 u (`FPS_BLOCO`), área construível de ±17 u
(`FPS_MEIO_QUARTEIRAO`), ruas de 6 u. Renascimentos nos cruzamentos, sempre a
pelo menos 3 u de qualquer geometria.

O tipo do quarteirão (bi, bj) é `(bi + 2·bj + 3) mod 4` (`fpsMapaTipoDoBloco`):
toda vizinhança 2 × 2 tem os quatro tipos, e o quarteirão central (4, 4) é uma
praça. Cada tipo tem geometria fixa mais caixotes aleatórios (`FPS_CAIXOTES_POR_BLOCO
× escala`, metade no pátio) que só caem onde o tipo deixa (`fpsMapaLivre*`).

| Tipo | Objetos fixos | O que tem |
|---|---|---|
| Torre (0) | 19 | torre 8 × 8 de 24–36 u, quatro muros baixos na base, escada de 10 degraus de 0,3 u até uma plataforma a 3 u, passarela em L (perna em −z, perna em +x) até um mirante de 5 × 5 |
| Galpão (1) | 12 | prédio 24 × 16 × 4 com teto, porta ao sul e a leste (3 u), três divisórias internas que formam corredores e um salão, duas colunas; caixotes também dentro do salão |
| Pátio (2) | 21 | duas fileiras de 4 contêineres 2,5 × 2,6 × 6 (corredores de 4,5 u, fileiras deslocadas), três contêineres soltos no meio com yaw leve, uma pilha de dois com escada de 9 degraus de 0,29 u para subir |
| Praça (3) | 15 | pedestal em dois degraus de 0,3 u (sobe-se) com obelisco de 9 u, quatro coberturas baixas nos pontos cardeais, quatro canteiros quadrados a 45° nas diagonais, quatro postes |

Pontos altos: plataforma/mirante das torres (3 u) e topo da pilha do pátio
(2,6 u, pela escada); ambos alcançáveis a pé (teste "torre: sobe a escada" e
degraus de 0,29). Degraus ficam <= 0,3: com 0,4 a esfera baixa do corpo (centro a 0,4) toca a face lateral e o `fps-resistencia` acusa penetração de 0,37.

## Caixas giradas (`transform.ry`) e o motor em 0740d2f

O motor colide caixas giradas em Y como OBB na fase estreita, mas há dois
limites no índice espacial (`engine/src/engine/core/spatial_queries.ts`) que
o mapa contorna por desenho, não por código no `engine/`:

1. **Fase larga com AABB reta.** Os limites `minX..maxZ` de um estático
   (`~l. 585-605`) usam `worldHx/Hz` sem alargar pelo yaw. Qualquer parte do
   OBB fora da AABB não girada não é candidata: raio e esfera passam direto.
   Repro: `scratch/repro_obb_bounds.ts` — passarela 17 × 1,8 a 45°, raios
   para baixo ao longo do eixo só acertam no centro (13 pontos, 1 acerto).
   Por isso a passarela da torre é em L, com caixas retas.
2. **Sinal do yaw espelhado nas consultas.** Renderer
   (`rts-egui/src/frame/scene3d/math.rs`: coluna X = `(cos ry, 0, −sin ry)`) e
   offset do colisor (`collider.ts`) levam o eixo local X para
   `(cos ry, −sin ry)`; esfera e raio em `spatial_queries.ts` usam
   `cos(−yaw)`, ou seja, `(cos ry, +sin ry)`. A caixa desenhada e a que colide
   são espelhadas em z. Repro: `scratch/repro_obb_sinal.ts` — caixa 6 × 2
   com `ry = 0,3`: esfera na ponta desenhada não toca, na ponta espelhada toca.

Regras de desenho enquanto isso vale: caixas giradas só quadradas a 45° (o
espelho é idêntico; a quina fora da AABB é `lado·(√2−1)/2 = 0,33 u` para o
canteiro de 1,6) ou com yaw pequeno (`FPS_CONTEINER_YAW = 0,06`: descasamento
na ponta `6 × sin 0,06 = 0,36 u`, abaixo do raio do corpo de 0,4). O teste
"contêiner com yaw colide como OBB" é agnóstico ao sinal de propósito.
