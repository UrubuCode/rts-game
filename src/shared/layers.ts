// Bits de camada do FPS. Filtro do índice: (mascaraDaConsulta & camadaDoAlvo)
// != 0 E (mascaraDoAlvo & camadaDaConsulta) != 0. Os objetos do jogo mantêm a
// máscara padrão (tudo), então quem escolhe é a máscara da consulta.
export const FPS_CAMADA_MAPA = 2;
export const FPS_CAMADA_JOGADOR = 4;
export const FPS_CAMADA_GRANADA = 8;
