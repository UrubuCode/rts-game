// Servidor dedicado do FPS (sem janela), por UDP.
//   ../rts/target/release/rts.exe run src/server.ts
// Porta e bots vêm de config/rede.json (chaves servidor.porta e bots).
import io from "@compat/io.ts";
import { time } from "rts";
import { NetTransporteUdp } from "./net/transport_udp";
import { FpsServidorJogo } from "./servidor_jogo";
import { fpsLerConfigRede } from "./config_rede";
import { FPS_SEMENTE_PADRAO, FPS_TICK_DT, FPS_MAX_CLIENTES, FPS_CAMINHO_CONFIG_REDE } from "./shared/config";

const FPS_INTERVALO_LOG_MS = 5000;
const FPS_ATRASO_MAX_MS = 250;

const fpsConfig = fpsLerConfigRede(FPS_CAMINHO_CONFIG_REDE);
const fpsPorta = fpsConfig.porta;
const fpsBots = fpsConfig.bots;
const fpsTransporte = new NetTransporteUdp(fpsPorta);
const fpsJogo = new FpsServidorJogo(fpsTransporte, FPS_SEMENTE_PADRAO, 1.0, fpsBots);
io.print("[servidor] porta " + fpsPorta + ", " + fpsBots + " bots, mapa com " + fpsJogo.mundo.mapa.objetos + " estaticos");

const fpsTickMs: f64 = FPS_TICK_DT * 1000.0;
let fpsProximo: f64 = time.now_ms();
let fpsUltimoLog: f64 = fpsProximo;
let fpsBytesLog = fpsTransporte.bytesEnviados;
while (true) {
  const agoraMs: f64 = time.now_ms();
  if (agoraMs >= fpsProximo) {
    fpsJogo.passo(agoraMs / 1000.0);
    fpsProximo = fpsProximo + fpsTickMs;
    if (agoraMs - fpsProximo > FPS_ATRASO_MAX_MS) fpsProximo = agoraMs;
  } else {
    fpsTransporte.bombear();
    time.sleep_ms(1);
  }
  if (agoraMs - fpsUltimoLog >= FPS_INTERVALO_LOG_MS) {
    let clientes = 0;
    let c = 0;
    while (c < FPS_MAX_CLIENTES) { if (fpsJogo.jogadorDoCliente[c] >= 0) clientes = clientes + 1; c = c + 1; }
    const kbs = (fpsTransporte.bytesEnviados - fpsBytesLog) / 1024.0 / ((agoraMs - fpsUltimoLog) / 1000.0);
    io.print("[servidor] clientes " + clientes + " | tick " + fpsJogo.mundo.ultMsTick.toFixed(2) + " ms | rede " +
             fpsJogo.ultMsRede.toFixed(3) + " ms | envio " + kbs.toFixed(1) + " KB/s");
    fpsUltimoLog = agoraMs;
    fpsBytesLog = fpsTransporte.bytesEnviados;
  }
}
