// Testes de config/rede.json: leitura, padrões e validação (Tarefa 7).
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { fpsLerConfigRede, FPS_MODO_DEDICADO, FPS_MODO_HOSPEDAR, FPS_MODO_CLIENTE } from "../src/config_rede";
import { FPS_PORTA_PADRAO, FPS_MAX_CLIENTES } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

io.print("=== fps-config-rede ===");

const CAMINHO_VALIDO = "tests/_tmp_rede.json";
const CAMINHO_INVALIDO_PORTA = "tests/_tmp_rede_porta_invalida.json";
const CAMINHO_PORTA_NAO_NUMERO = "tests/_tmp_rede_porta_texto.json";
const CAMINHO_QUEBRADO = "tests/_tmp_rede_quebrado.json";
const CAMINHO_AUSENTE = "tests/_tmp_rede_nao_existe.json";

function limpar(caminho: string): void {
  if (fs.exists(caminho)) fs.remove_file(caminho);
}

// 1. arquivo válido lido corretamente
fs.write(CAMINHO_VALIDO, JSON.stringify({ servidor: { host: "192.168.0.10", porta: 27020 }, bots: 4 }));
{
  const cfg = fpsLerConfigRede(CAMINHO_VALIDO);
  check("arquivo valido: host lido", cfg.host === "192.168.0.10", "host=" + cfg.host);
  check("arquivo valido: porta lida", cfg.porta === 27020, "porta=" + cfg.porta);
  check("arquivo valido: bots lido", cfg.bots === 4, "bots=" + cfg.bots);
}
limpar(CAMINHO_VALIDO);

// 2. arquivo ausente -> padrões
{
  const cfg = fpsLerConfigRede(CAMINHO_AUSENTE);
  check("arquivo ausente: host padrao", cfg.host === "127.0.0.1", "host=" + cfg.host);
  check("arquivo ausente: porta padrao", cfg.porta === FPS_PORTA_PADRAO, "porta=" + cfg.porta);
  check("arquivo ausente: bots padrao", cfg.bots === 0, "bots=" + cfg.bots);
}

// 3. porta invalida (fora da faixa) -> porta padrao, demais campos lidos
fs.write(CAMINHO_INVALIDO_PORTA, JSON.stringify({ servidor: { host: "10.0.0.5", porta: 70000 }, bots: 2 }));
{
  const cfg = fpsLerConfigRede(CAMINHO_INVALIDO_PORTA);
  check("porta fora da faixa: cai para padrao", cfg.porta === FPS_PORTA_PADRAO, "porta=" + cfg.porta);
  check("porta fora da faixa: host continua lido", cfg.host === "10.0.0.5", "host=" + cfg.host);
  check("porta fora da faixa: bots continua lido", cfg.bots === 2, "bots=" + cfg.bots);
}
limpar(CAMINHO_INVALIDO_PORTA);

// 3b. porta não numérica -> porta padrao, demais campos lidos
fs.write(CAMINHO_PORTA_NAO_NUMERO, '{"servidor":{"host":"10.0.0.6","porta":"abc"},"bots":1}');
{
  const cfg = fpsLerConfigRede(CAMINHO_PORTA_NAO_NUMERO);
  check("porta nao numerica: cai para padrao", cfg.porta === FPS_PORTA_PADRAO, "porta=" + cfg.porta);
  check("porta nao numerica: host continua lido", cfg.host === "10.0.0.6", "host=" + cfg.host);
  check("porta nao numerica: bots continua lido", cfg.bots === 1, "bots=" + cfg.bots);
}
limpar(CAMINHO_PORTA_NAO_NUMERO);

// 4. JSON quebrado -> padrões, sem excecao
fs.write(CAMINHO_QUEBRADO, "{ nao é json valido ]");
{
  const cfg = fpsLerConfigRede(CAMINHO_QUEBRADO);
  check("json quebrado: host padrao", cfg.host === "127.0.0.1", "host=" + cfg.host);
  check("json quebrado: porta padrao", cfg.porta === FPS_PORTA_PADRAO, "porta=" + cfg.porta);
  check("json quebrado: bots padrao", cfg.bots === 0, "bots=" + cfg.bots);
}
limpar(CAMINHO_QUEBRADO);

// 5. bots fora da faixa -> bots padrao
fs.write(CAMINHO_VALIDO, JSON.stringify({ servidor: { host: "127.0.0.1", porta: 27015 }, bots: FPS_MAX_CLIENTES + 1 }));
{
  const cfg = fpsLerConfigRede(CAMINHO_VALIDO);
  check("bots acima do maximo: cai para padrao", cfg.bots === 0, "bots=" + cfg.bots);
}
limpar(CAMINHO_VALIDO);

// 6. modo de execução: "dedicado" | "hospedar" | "cliente" (padrão "cliente")
fs.write(CAMINHO_VALIDO, JSON.stringify({ modo: "hospedar", servidor: { host: "127.0.0.1", porta: 27015 }, bots: 0 }));
{
  const cfg = fpsLerConfigRede(CAMINHO_VALIDO);
  check("modo hospedar lido", cfg.modo === "hospedar", "modo=" + cfg.modo);
  // literais de propósito: neste runtime um export ausente vale undefined, e
  // comparar undefined com undefined passaria antes de o código existir
  check("constantes de modo batem com os literais do JSON",
        FPS_MODO_DEDICADO === "dedicado" && FPS_MODO_HOSPEDAR === "hospedar" && FPS_MODO_CLIENTE === "cliente");
}
fs.write(CAMINHO_VALIDO, JSON.stringify({ modo: "dedicado" }));
{
  const cfg = fpsLerConfigRede(CAMINHO_VALIDO);
  check("modo dedicado lido", cfg.modo === "dedicado", "modo=" + cfg.modo);
}
fs.write(CAMINHO_VALIDO, JSON.stringify({ servidor: { host: "127.0.0.1", porta: 27015 } }));
{
  const cfg = fpsLerConfigRede(CAMINHO_VALIDO);
  check("modo ausente: padrao cliente", cfg.modo === "cliente", "modo=" + cfg.modo);
}
fs.write(CAMINHO_VALIDO, JSON.stringify({ modo: "servidor" }));
{
  const cfg = fpsLerConfigRede(CAMINHO_VALIDO);
  check("modo invalido: cai para padrao cliente", cfg.modo === "cliente", "modo=" + cfg.modo);
}
limpar(CAMINHO_VALIDO);
{
  const cfg = fpsLerConfigRede(CAMINHO_AUSENTE);
  check("arquivo ausente: modo padrao cliente", cfg.modo === "cliente", "modo=" + cfg.modo);
}

if (falhas === 0) io.print("[PASSOU] fps-config-rede"); else io.print("[FALHOU] fps-config-rede: " + falhas + " falha(s)");
