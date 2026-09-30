// Constantes do FPS (entrega 1). Prefixo FPS_ em tudo: neste runtime, nomes
// de topo de módulos diferentes colidem (ver examples/physics_demo.ts).

// ── tempo ──────────────────────────────────────────────────────────────────
export const FPS_TICK_DT: f64 = 1.0 / 60.0;
export const FPS_MAX_TICKS_POR_FRAME = 4;

// ── mapa ───────────────────────────────────────────────────────────────────
export const FPS_SEMENTE_PADRAO = 20260923;
export const FPS_TAM_CHAO: f64 = 400.0;
export const FPS_BLOCO: f64 = 40.0;               // lado de um quarteirão, rua incluída
export const FPS_MEIO_QUARTEIRAO: f64 = 17.0;     // meia-largura da área construível
export const FPS_BLOCOS_POR_LADO = 9;
export const FPS_ALTURA_BORDA: f64 = 20.0;
export const FPS_CAIXOTES_POR_BLOCO: f64 = 24.0;  // multiplicado pela escala
export const FPS_DEGRAU_ALTURA: f64 = 0.3;
export const FPS_DEGRAUS = 10;

// tipos de quarteirão (ver docs/mapa.md); o tipo de (bi, bj) vem de fpsMapaTipoDoBloco
export const FPS_MAPA_TORRE = 0;
export const FPS_MAPA_GALPAO = 1;
export const FPS_MAPA_PATIO = 2;
export const FPS_MAPA_PRACA = 3;
export const FPS_MAPA_TIPOS = 4;
// torre: escada em x (degraus de 1 u) até a plataforma; passarela em L (uma
// perna em −z, outra em +x) até o mirante. Caixas retas: a fase larga do índice
// não alarga os limites de caixas giradas (ver docs/mapa.md).
export const FPS_TORRE_LADO: f64 = 8.0;
export const FPS_TORRE_ALTURA: f64 = 30.0;
export const FPS_TORRE_ESCADA_DX0: f64 = -16.5;   // centro do primeiro degrau
export const FPS_TORRE_ESCADA_DZ: f64 = 14.5;
export const FPS_TORRE_ESCADA_PROF: f64 = 3.0;
export const FPS_TORRE_PLATAFORMA_DX: f64 = -4.5;
export const FPS_TORRE_PLATAFORMA_LADO: f64 = 5.0;
export const FPS_TORRE_MIRANTE_DX: f64 = 8.0;
export const FPS_TORRE_MIRANTE_DZ: f64 = 6.0;
export const FPS_TORRE_PASSARELA_LARG: f64 = 1.8;
export const FPS_TORRE_PASSARELA_ESP: f64 = 0.4;
// galpão: paredes de FPS_GALPAO_ALTURA com teto, porta ao sul e a leste, paredes internas
export const FPS_GALPAO_MEIO_X: f64 = 12.0;
export const FPS_GALPAO_MEIO_Z: f64 = 8.0;
export const FPS_GALPAO_ALTURA: f64 = 4.0;
export const FPS_GALPAO_PAREDE: f64 = 0.4;
export const FPS_GALPAO_TETO: f64 = 0.4;
export const FPS_GALPAO_PORTA: f64 = 3.0;
// pátio: duas fileiras de contêineres, três soltos com yaw pequeno e uma pilha
// com escada. O yaw fica em |ry| <= FPS_CONTEINER_YAW: o descasamento entre o
// desenho e a colisão (índice com AABB reta e sinal espelhado nas consultas,
// docs/mapa.md) é comprimento × sin ry na quina, abaixo do raio do corpo.
export const FPS_CONTEINER_LARG: f64 = 2.5;
export const FPS_CONTEINER_ALT: f64 = 2.6;
export const FPS_CONTEINER_COMP: f64 = 6.0;
export const FPS_CONTEINER_YAW: f64 = 0.06;         // 6,0 × sin 0,06 = 0,36 < FPS_RAIO_CORPO
export const FPS_PATIO_PASSO_X: f64 = 7.0;          // corredor de 4,5 u entre contêineres
export const FPS_PATIO_FILEIRA_DZ: f64 = 9.0;
export const FPS_PATIO_DEGRAUS = 9;                 // 9 × 0,29 chega ao topo do contêiner (degrau <= 0,3)
export const FPS_PATIO_DEGRAU_PROF: f64 = 0.7;
// praça: pedestal em dois degraus, obelisco, quatro coberturas retas nos pontos
// cardeais, quatro canteiros quadrados a 45° nas diagonais, postes
export const FPS_PRACA_PEDESTAL_LADO: f64 = 8.0;
export const FPS_PRACA_PEDESTAL_ALT: f64 = 0.3;     // cada degrau; <= 0,3: acima disso a esfera baixa (centro a 0,4) bate de lado
export const FPS_PRACA_OBELISCO_LADO: f64 = 1.2;
export const FPS_PRACA_OBELISCO_ALT: f64 = 9.0;
export const FPS_PRACA_RAIO_ANEL: f64 = 11.0;
export const FPS_PRACA_COBERTURA_COMP: f64 = 3.2;
export const FPS_PRACA_COBERTURA_ALT: f64 = 1.1;
export const FPS_PRACA_COBERTURA_ESP: f64 = 0.7;
export const FPS_PRACA_CANTEIRO_LADO: f64 = 1.6;    // quadrado a 45°: quina invisível 0,33 < raio
export const FPS_PRACA_CANTEIRO_ALT: f64 = 0.9;
export const FPS_PRACA_RAIO_POSTES: f64 = 14.5;
export const FPS_PRACA_POSTE_ALT: f64 = 5.0;
export const FPS_PRACA_POSTE_LADO: f64 = 0.4;

// ── jogador ────────────────────────────────────────────────────────────────
export const FPS_RAIO_CORPO: f64 = 0.4;
export const FPS_ALTURA_CORPO: f64 = 1.8;
export const FPS_MEIA_LARGURA_CAIXA: f64 = 0.4;   // caixa atingível: 0,8 × 1,8 × 0,8
export const FPS_ALTURA_OLHO: f64 = 1.6;
export const FPS_VEL_ANDAR: f64 = 6.0;
export const FPS_ACEL_AR: f64 = 3.0;              // 1/s: convergência da velocidade no ar
export const FPS_VEL_PULO: f64 = 5.5;
export const FPS_GRAVIDADE: f64 = 18.0;
export const FPS_VEL_QUEDA_MAX: f64 = 20.0;       // 0,33 u/tick < raio do corpo
export const FPS_ITER_SEPARACAO = 3;
export const FPS_MAX_HITS_CORPO = 8;
export const FPS_ALTURA_DEGRAU: f64 = 0.45;
export const FPS_DIST_CHAO: f64 = 0.1;
export const FPS_PITCH_MAX: f64 = 1.45;
export const FPS_Y_MORTE: f64 = -50.0;
export const FPS_VIDA_MAX: f64 = 100.0;
export const FPS_TEMPO_RENASCER: f64 = 3.0;
export const FPS_RAIO_RENASCER_LIVRE: f64 = 3.0;

// ── fuzil ──────────────────────────────────────────────────────────────────
export const FPS_CADENCIA: f64 = 10.0;            // tiros por segundo
export const FPS_PENTE = 30;
export const FPS_TEMPO_RECARGA: f64 = 1.5;
export const FPS_ALCANCE: f64 = 300.0;
export const FPS_DANO: f64 = 25.0;
export const FPS_FRACAO_CABECA: f64 = 0.7;
export const FPS_MULT_CABECA: f64 = 2.0;

// ── granada ────────────────────────────────────────────────────────────────
export const FPS_GRANADAS_POR_JOGADOR = 2;
export const FPS_TEMPO_GRANADA: f64 = 3.0;
export const FPS_VEL_GRANADA: f64 = 14.0;
export const FPS_IMPULSO_CIMA_GRANADA: f64 = 3.0;
export const FPS_RAIO_GRANADA: f64 = 0.15;
export const FPS_QUIQUE: f64 = 0.5;
export const FPS_PAVIO: f64 = 2.5;
export const FPS_RAIO_EXPLOSAO: f64 = 6.0;
export const FPS_DANO_GRANADA: f64 = 100.0;
export const FPS_EMPURRAO_GRANADA: f64 = 8.0;
export const FPS_EMPURRAO_CIMA_GRANADA: f64 = 4.0;
export const FPS_POOL_GRANADAS = 32;

// ── bots ───────────────────────────────────────────────────────────────────
export const FPS_BOTS_PADRAO = 12;
export const FPS_REACAO_BOT: f64 = 0.65;
export const FPS_CADENCIA_BOT: f64 = 4.0;
export const FPS_VISAO_BOT: f64 = 60.0;
export const FPS_TICKS_ENTRE_VISADAS = 12;        // 60 Hz / 5 visadas por segundo
export const FPS_ERRO_MIRA_BOT: f64 = 0.04;       // rad
export const FPS_TEMPO_PARADO_BOT: f64 = 2.0;
export const FPS_DIST_CHEGOU_BOT: f64 = 3.0;

// ── efeitos visuais (registros, fora da cena) ──────────────────────────────
export const FPS_POOL_EFEITOS = 256;
export const FPS_EFEITO_MARCA = 1;
export const FPS_EFEITO_TRACADOR = 2;
export const FPS_EFEITO_EXPLOSAO = 3;
export const FPS_VIDA_MARCA: f64 = 4.0;
export const FPS_VIDA_TRACADOR: f64 = 0.08;
export const FPS_VIDA_EXPLOSAO: f64 = 0.4;

// ── rede ───────────────────────────────────────────────────────────────────
export const FPS_NET_TIPO_JOGADOR = 1;
export const FPS_PORTA_PADRAO = 27015;
export const FPS_MAX_CLIENTES = 16;
export const FPS_ESCALA_PITCH_REDE: f64 = 20000.0;   // pitch em i16: ±1,45 rad cabe
export const FPS_CAMINHO_CONFIG_REDE = "config/rede.json";
