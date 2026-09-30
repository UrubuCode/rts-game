// Cliente do FPS em rede (sem predição no subprojeto A). Lê config/rede.json:
//   modo "cliente":  conecta em servidor.host:servidor.porta por UDP;
//   modo "hospedar": roda o servidor neste processo (listen server) na porta
//                    servidor.porta, entra nele pela memória e aceita os
//                    outros por UDP.
//   ../rts/target/release/examples/ui_fixture.exe src/client_rede.ts
import io from "@compat/io.ts";
import { createAppAt } from "@compat/app.ts";
import { initMeshes, winWidth, winHeight, setVsync } from "@engine/render/gpu3d";
import { NetTransport } from "./net/transport";
import { NetTransporteUdp } from "./net/transport_udp";
import { NET_ESTADO_CONECTANDO, NET_ESTADO_CONECTADO, NET_ESTADO_RECUSADO } from "./net/config";
import { FpsClienteRede } from "./cliente_rede";
import { NetworkObject } from "./net/components";
import { Transform } from "@engine/core/transform";
import { FpsAnimacao } from "./animacao";
import { FpsVagasRede, FPS_MAX_VAGAS_REDE } from "./vagas_rede";
import { fpsCarregarModelos } from "./modelos";
import { FpsServidorHospedado } from "./servidor_hospedado";
import { FpsEntrada } from "./entrada";
import { FpsHudRede, fpsDesenharMira, fpsDesenharStatusRede, FPS_HUD_REDE_DESCONECTADO, FPS_HUD_REDE_CONECTANDO,
         FPS_HUD_REDE_RECUSADO, FPS_HUD_REDE_CONECTADO } from "./hud";
import { fpsPrepararCamera, fpsDesenharCena, fpsCamera, FPS_CAM_X, FPS_CAM_Y, FPS_CAM_Z, FPS_CAM_YAW, FPS_CAM_PITCH,
         FPS_CAM_ASPECTO } from "./render";
import { fpsLerConfigRede, FPS_MODO_HOSPEDAR } from "./config_rede";
import { FPS_TICK_DT, FPS_MAX_TICKS_POR_FRAME, FPS_ALTURA_OLHO, FPS_ALTURA_CORPO, FPS_CAMINHO_CONFIG_REDE,
         FPS_SEMENTE_PADRAO } from "./shared/config";

const FPS_JANELA_MIN = 200;
const FPS_DT_MAX: f64 = 0.25;
const FPS_CAMERA_ESPERA_Y: f64 = 40.0;
const FPS_CAMERA_ESPERA_PITCH: f64 = -0.6;
const FPS_INTERVALO_LOG_MS = 5000;
/// Sem posição nova há mais que isso (s), o remoto está parado.
const FPS_REMOTO_PARADO_S: f64 = 0.25;
/// Deslocamento mínimo (u) que conta como movimento (vira a direção do corpo).
const FPS_REMOTO_MOVEU: f64 = 0.001;

const fpsConfig = fpsLerConfigRede(FPS_CAMINHO_CONFIG_REDE);
const fpsIp = fpsConfig.host;
const fpsPorta = fpsConfig.porta;
const fpsHospedar = fpsConfig.modo === FPS_MODO_HOSPEDAR;

let fpsW = 1280;
let fpsH = 720;
const fpsApp = createAppAt("rts-fps (rede)", fpsW, fpsH, 80, 60);
const FPS_WIN = fpsApp._win;
initMeshes(FPS_WIN);
setVsync(FPS_WIN, 1);
fpsCarregarModelos(FPS_WIN);

// No modo hospedar o servidor escuta UDP em fpsPorta para os remotos e o
// cliente local entra pela ponta em memória; no modo cliente, UDP direto.
let fpsHosp: FpsServidorHospedado | null = null;
let fpsTransporte: NetTransport;
let fpsServidor = 0;
if (fpsHospedar) {
  fpsHosp = new FpsServidorHospedado(new NetTransporteUdp(fpsPorta), FPS_SEMENTE_PADRAO, 1.0, fpsConfig.bots);
  fpsTransporte = fpsHosp.pontaLocal;
  fpsServidor = fpsHosp.pontaServidor.endereco;
  io.print("[servidor] hospedado na porta " + fpsPorta + ", " + fpsConfig.bots + " bots, mapa com " +
           fpsHosp.jogo.mundo.mapa.objetos + " estaticos");
} else {
  const udp = new NetTransporteUdp(0);
  fpsTransporte = udp;
  fpsServidor = udp.par(fpsIp, fpsPorta);
}
let fpsUltimo: f64 = performance.now();
const fpsCliente = new FpsClienteRede(fpsTransporte, fpsServidor, fpsUltimo / 1000.0);
const fpsEntrada = new FpsEntrada(0.0);
let fpsAcumulador: f64 = 0.0;
let fpsUltimoLog: f64 = fpsUltimo;
let fpsBytesLog = 0;
/// Personagens animados dos remotos, em vagas reaproveitáveis por netId
/// (src/vagas_rede.ts): quem sai libera a vaga, no máximo FPS_MAX_VAGAS_REDE.
const fpsAnim = new FpsAnimacao();
if (fpsAnim.erro !== "") io.print("[animacao] " + fpsAnim.erro + "; personagens viram caixas");
fpsAnim.subirModelos(FPS_WIN);
const fpsVagas = new FpsVagasRede();
/// Hora (s) da última posição nova de cada vaga.
const fpsAnimMudou = new Float64Array(FPS_MAX_VAGAS_REDE);
const fpsHudRede = new FpsHudRede(fpsIp + ":" + fpsPorta, fpsHospedar ? fpsPorta : 0);
if (fpsHospedar) io.print("[cliente] entrando no servidor hospedado pela memoria");
else io.print("[cliente] conectando em " + fpsIp + ":" + fpsPorta);

/// Linha de status do servidor hospedado, no formato do server.ts.
function fpsLogServidor(hosp: FpsServidorHospedado, agoraMs: f64): void {
  if (agoraMs - fpsUltimoLog < FPS_INTERVALO_LOG_MS) return;
  const kbs = (hosp.transporte.bytesEnviados - fpsBytesLog) / 1024.0 / ((agoraMs - fpsUltimoLog) / 1000.0);
  io.print("[servidor] clientes " + hosp.clientes() + " | tick " + hosp.jogo.mundo.ultMsTick.toFixed(2) + " ms | rede " +
           hosp.jogo.ultMsRede.toFixed(3) + " ms | passo hospedado " + hosp.ultMsPasso.toFixed(3) + " ms | envio " +
           kbs.toFixed(1) + " KB/s");
  fpsUltimoLog = agoraMs;
  fpsBytesLog = hosp.transporte.bytesEnviados;
}

/// Remotos -> personagens animados. A replicação só traz posição: a
/// velocidade vem da distância entre posições novas / tempo entre elas, e a
/// direção do corpo, do movimento. Tiro e morte não são replicados (subprojeto A).
function fpsAnimarRemotos(agora: f64, dt: f64, eu: NetworkObject | null): void {
  const objs = fpsCliente.rep.objetos;
  const a = fpsAnim;
  const vg = fpsVagas;
  vg.comecar();
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    const go = o.go;
    if (go !== null && o !== eu) {
      const j = vg.vaga(o.netId);
      if (j >= 0) {
        a.garantir(j + 1);
        fpsAnimarRemoto(j, vg.nova, go.transform, agora);
      }
    }
    i = i + 1;
  }
  vg.terminar();
  let j = 0;
  while (j < vg.usadas) { a.visivel[j] = vg.ocupada(j) ? 1 : 0; j = j + 1; }
  a.passo(vg.usadas, dt);
}

function fpsAnimarRemoto(j: number, nova: boolean, t: Transform, agora: f64): void {
  const a = fpsAnim;
  const x = t.wx; const z = t.wz;
  a.y[j] = t.wy - FPS_ALTURA_CORPO * 0.5;
  if (nova) {
    // vaga nova (ou reaproveitada): começa parado onde está, animação do zero
    a.x[j] = x; a.z[j] = z; a.vel[j] = 0.0; a.vivo[j] = 1; fpsAnimMudou[j] = agora;
    a.ans[j].resetRuntime();
    return;
  }
  const dx = x - a.x[j]; const dz = z - a.z[j];
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > FPS_REMOTO_MOVEU) {
    const intervalo = agora - fpsAnimMudou[j];
    if (intervalo > 0.0 && intervalo < FPS_REMOTO_PARADO_S) a.vel[j] = d / intervalo;
    a.yaw[j] = Math.atan2(dx, dz);
    a.x[j] = x; a.z[j] = z; fpsAnimMudou[j] = agora;
  } else if (agora - fpsAnimMudou[j] > FPS_REMOTO_PARADO_S) a.vel[j] = 0.0;
}

function fpsQuadro(): void {
  const nw = winWidth(FPS_WIN);
  const nh = winHeight(FPS_WIN);
  if (nw > FPS_JANELA_MIN) fpsW = nw;
  if (nh > FPS_JANELA_MIN) fpsH = nh;
  fpsEntrada.ler(fpsApp, FPS_WIN);

  const agoraMs = performance.now();
  let dt = (agoraMs - fpsUltimo) / 1000.0;
  fpsUltimo = agoraMs;
  if (dt > FPS_DT_MAX) dt = FPS_DT_MAX;
  fpsAcumulador = fpsAcumulador + dt;
  let ticks = 0;
  while (fpsAcumulador >= FPS_TICK_DT && ticks < FPS_MAX_TICKS_POR_FRAME) {
    // servidor hospedado antes do cliente local, uma vez por tick
    if (fpsHosp !== null) fpsHosp.passo(agoraMs / 1000.0);
    fpsCliente.passo(agoraMs / 1000.0, fpsEntrada.inp);
    fpsEntrada.consumirBordas();
    fpsAcumulador = fpsAcumulador - FPS_TICK_DT;
    ticks = ticks + 1;
  }
  if (ticks === FPS_MAX_TICKS_POR_FRAME) fpsAcumulador = 0.0;
  if (fpsHosp !== null) fpsLogServidor(fpsHosp, agoraMs);

  const eu = fpsCliente.meuObjeto();
  fpsAnimarRemotos(agoraMs / 1000.0, dt, eu);
  const cam = fpsCamera;
  cam[FPS_CAM_ASPECTO] = fpsW / fpsH;
  if (eu !== null && eu.go !== null) {
    const t = eu.go.transform;
    cam[FPS_CAM_X] = t.wx; cam[FPS_CAM_Y] = t.wy - FPS_ALTURA_CORPO * 0.5 + FPS_ALTURA_OLHO; cam[FPS_CAM_Z] = t.wz;
    cam[FPS_CAM_YAW] = fpsEntrada.yaw; cam[FPS_CAM_PITCH] = fpsEntrada.pitch;
    fpsPrepararCamera(FPS_WIN, cam);
    fpsDesenharCena(FPS_WIN, fpsCliente.scene, eu.go);
  } else {
    cam[FPS_CAM_X] = 0.0; cam[FPS_CAM_Y] = FPS_CAMERA_ESPERA_Y; cam[FPS_CAM_Z] = 0.0;
    cam[FPS_CAM_YAW] = 0.0; cam[FPS_CAM_PITCH] = FPS_CAMERA_ESPERA_PITCH;
    fpsPrepararCamera(FPS_WIN, cam);
    fpsDesenharCena(FPS_WIN, fpsCliente.scene, null);
  }
  fpsAnim.desenharTodos(FPS_WIN, fpsVagas.usadas);

  fpsDesenharMira(fpsW, fpsH);
  const cli = fpsCliente.cli;
  const hud = fpsHudRede;
  hud.estado = FPS_HUD_REDE_DESCONECTADO;
  if (cli.estado === NET_ESTADO_CONECTANDO) hud.estado = FPS_HUD_REDE_CONECTANDO;
  else if (cli.estado === NET_ESTADO_RECUSADO) { hud.estado = FPS_HUD_REDE_RECUSADO; hud.motivo = cli.motivoRecusa; }
  else if (cli.estado === NET_ESTADO_CONECTADO) {
    hud.estado = FPS_HUD_REDE_CONECTADO;
    hud.ping = cli.con !== null ? Math.round(cli.con.rtt * 1000.0) : 0;
    hud.clienteId = cli.clienteId;
    hud.jogadores = fpsCliente.rep.objetos.length;
    hud.clientes = fpsHosp !== null ? fpsHosp.clientes() : 0;
  }
  fpsDesenharStatusRede(hud, fpsEntrada.travado);
  fpsApp.endFrame();
}

while (fpsApp.running()) {
  if (!fpsApp.beginFrame()) break;
  fpsQuadro();
}
fpsCliente.cli.desconectar();
if (fpsHosp !== null) fpsHosp.transporte.fechar();
io.print("[cliente] encerrado");
fpsApp.close();
