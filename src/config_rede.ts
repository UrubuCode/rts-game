// Lê config/rede.json: modo de execução, endereço do servidor, porta e
// quantidade de bots. Usado por server.ts e client_rede.ts em vez de
// variáveis de ambiente.
import fs from "@compat/fs.ts";
import io from "@compat/io.ts";
import { FPS_PORTA_PADRAO, FPS_MAX_CLIENTES } from "./shared/config";

const FPS_HOST_PADRAO = "127.0.0.1";
const FPS_BOTS_PADRAO_REDE = 0;

// Modos de execução (chave "modo" do JSON):
//   dedicado — servidor sem janela (server.ts);
//   hospedar — a janela do jogador local roda o servidor no mesmo processo
//              (listen server): o local entra pela memória, os outros por UDP;
//   cliente  — a janela só conecta em servidor.host:servidor.porta.
export const FPS_MODO_DEDICADO = "dedicado";
export const FPS_MODO_HOSPEDAR = "hospedar";
export const FPS_MODO_CLIENTE = "cliente";
const FPS_MODO_PADRAO = FPS_MODO_CLIENTE;

export interface FpsConfigRede {
  modo: string;
  host: string;
  porta: number;
  bots: number;
}

function fpsAvisar(campo: string, motivo: string): void {
  io.print("[config_rede] aviso: campo '" + campo + "' invalido (" + motivo + "), usando padrao");
}

function fpsPadrao(): FpsConfigRede {
  return { modo: FPS_MODO_PADRAO, host: FPS_HOST_PADRAO, porta: FPS_PORTA_PADRAO, bots: FPS_BOTS_PADRAO_REDE };
}

/// Lê e valida `config/rede.json`. Nunca lança: arquivo ausente, JSON
/// inválido ou campo fora da faixa caem no padrão daquele campo (com aviso).
export function fpsLerConfigRede(caminho: string): FpsConfigRede {
  const cfg = fpsPadrao();
  if (!fs.exists(caminho)) {
    fpsAvisar("arquivo", "arquivo '" + caminho + "' nao encontrado");
    return cfg;
  }

  let dados: any = null;
  try {
    dados = JSON.parse(fs.read_text(caminho));
  } catch (e) {
    fpsAvisar("arquivo", "JSON invalido em '" + caminho + "'");
    return cfg;
  }

  if (dados === null || typeof dados !== "object") {
    fpsAvisar("arquivo", "conteudo de '" + caminho + "' nao e um objeto");
    return cfg;
  }

  const modo = dados.modo;
  if (modo === FPS_MODO_DEDICADO || modo === FPS_MODO_HOSPEDAR || modo === FPS_MODO_CLIENTE) {
    cfg.modo = modo;
  } else if (modo !== undefined) {
    fpsAvisar("modo", "deve ser \"" + FPS_MODO_DEDICADO + "\", \"" + FPS_MODO_HOSPEDAR + "\" ou \"" + FPS_MODO_CLIENTE + "\"");
  }

  const servidor = dados.servidor;
  if (servidor !== undefined && servidor !== null && typeof servidor === "object") {
    const host = servidor.host;
    if (typeof host === "string" && host.length > 0) {
      cfg.host = host;
    } else if (host !== undefined) {
      fpsAvisar("servidor.host", "deve ser uma string nao vazia");
    }

    const porta = servidor.porta;
    if (typeof porta === "number" && Number.isInteger(porta) && porta >= 1 && porta <= 65535) {
      cfg.porta = porta;
    } else if (porta !== undefined) {
      fpsAvisar("servidor.porta", "deve ser um inteiro entre 1 e 65535");
    }
  } else if (servidor !== undefined) {
    fpsAvisar("servidor", "deve ser um objeto com host e porta");
  }

  const bots = dados.bots;
  if (typeof bots === "number" && Number.isInteger(bots) && bots >= 0 && bots <= FPS_MAX_CLIENTES) {
    cfg.bots = bots;
  } else if (bots !== undefined) {
    fpsAvisar("bots", "deve ser um inteiro entre 0 e " + FPS_MAX_CLIENTES);
  }

  return cfg;
}
