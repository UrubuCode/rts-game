// Verificação FIM A FIM de verdade (sem depender do humano ouvir): abre o
// dispositivo de áudio REAL da máquina, dispara cada um dos seis sons do
// FpsSom pelo caminho real (fpsSomQuadro/fpsSomEfeitos/fpsSomPassos) e
// confere a saída real da placa por loopback (`escuta_iniciar`/`escuta_ler` de
// `rts:audio`, o mesmo mecanismo do comando `audio escuta` — Ruling A7 do
// motor) que saiu som de verdade da placa. Pula com um aviso, sem falhar, se
// a máquina não tiver dispositivo real ou o binário do rts não tiver as
// nativas de escuta contínua (binário antigo).
//   $RTS run tests/fps-som-real.ts
import io from "@compat/io.ts";
import time from "@compat/time.ts";
import { Scene } from "@engine/core/scene";
import { initAudio, closeAudio, AUDIO_REAL } from "@engine/audio/audio";
import { escutaDisponivel, escutaIniciar, escutaLer, ESCUTA_CONTINUA_FLOATS } from "@compat/audio.ts";
import { Mixer } from "@engine/audio/mixer_grupos";
import { FpsWorld } from "../src/shared/world";
import { FPS_EFEITO_TRACADOR, FPS_EFEITO_MARCA, FPS_EFEITO_EXPLOSAO, FPS_VIDA_TRACADOR, FPS_VIDA_MARCA,
         FPS_VIDA_EXPLOSAO, FPS_ALTURA_OLHO } from "../src/shared/config";
import { FpsSom, fpsSomIniciar, fpsSomQuadro } from "../src/som";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

const RMS_MIN: f64 = 0.0005;
/// Janela de captura + margem de latência do hardware/loopback.
const MARGEM_MS: f64 = 400.0;

io.print("=== fps-som-real ===");

interface Linha { nome: string; rms: f64; pico: f64; silencio: number; }
const tabela: Linha[] = [];

function pumpEscuta(ms: f64, cadaQuadro: (dt: f64) => void): Float64Array {
  const out = new Float64Array(ESCUTA_CONTINUA_FLOATS);
  escutaIniciar(ms, 0.0);
  let ultimo = time.now_ms();
  const prazo = ultimo + ms + MARGEM_MS;
  while (true) {
    const agora = time.now_ms();
    const dt = (agora - ultimo) / 1000.0;
    ultimo = agora;
    cadaQuadro(dt > 0.0 ? dt : 0.016);
    if (escutaLer(out) === 1) break;
    if (agora > prazo) break;
    time.sleep_ms(15);
  }
  return out;
}

function registrar(nome: string, out: Float64Array): void {
  const rms = out[0]; const pico = out[1]; const silencio = out[2] | 0;
  tabela.push({ nome: nome, rms: rms, pico: pico, silencio: silencio });
  check(nome + ": som audível pelo loopback", silencio === 0 && rms > RMS_MIN,
        "rms=" + rms.toFixed(5) + " pico=" + pico.toFixed(5) + " silencio=" + silencio);
}

if (!escutaDisponivel()) {
  io.print("[aviso] rts.exe sem escuta_iniciar/escuta_ler (binário antigo) — pulando fps-som-real.");
} else if (initAudio(AUDIO_REAL) === 0) {
  io.print("[aviso] sem dispositivo de áudio real nesta máquina — pulando fps-som-real.");
} else {
  const m = new FpsWorld(new Scene("som-real"), 7, 1.0);
  const eu = m.adicionarJogador(false);
  m.adicionarJogador(true);
  const som = new FpsSom();
  fpsSomIniciar(som, eu);
  const p = m.jogadores[eu];
  const pose = som.pose;
  pose[0] = p.x; pose[1] = p.y + FPS_ALTURA_OLHO; pose[2] = p.z;

  // Música tocando desde `fpsSomIniciar`; silencia o grupo Música enquanto os
  // outros cinco são conferidos, para não misturar os sinais.
  Mixer.pause("Música", true);

  // tiro próprio (traçador nascendo perto do olho do humano)
  m.adicionarEfeito(FPS_EFEITO_TRACADOR, p.x, p.y + FPS_ALTURA_OLHO, p.z, p.x + 10.0, p.y, p.z, FPS_VIDA_TRACADOR);
  registrar("tiro próprio", pumpEscuta(500.0, (dt) => fpsSomQuadro(som, m, pose, dt)));

  // tiro de outro (traçador nascendo longe do olho do humano)
  m.adicionarEfeito(FPS_EFEITO_TRACADOR, p.x + 20.0, p.y + 1.0, p.z, p.x, p.y, p.z, FPS_VIDA_TRACADOR);
  registrar("tiro de outro", pumpEscuta(500.0, (dt) => fpsSomQuadro(som, m, pose, dt)));

  // impacto (marca de bala)
  m.adicionarEfeito(FPS_EFEITO_MARCA, p.x + 5.0, p.y, p.z + 5.0, 0.0, 1.0, 0.0, FPS_VIDA_MARCA);
  registrar("impacto", pumpEscuta(500.0, (dt) => fpsSomQuadro(som, m, pose, dt)));

  // explosão (clipe mais longo: janela maior)
  m.adicionarEfeito(FPS_EFEITO_EXPLOSAO, p.x + 30.0, p.y, p.z, 0.0, 0.0, 0.0, FPS_VIDA_EXPLOSAO);
  registrar("explosão", pumpEscuta(900.0, (dt) => fpsSomQuadro(som, m, pose, dt)));

  // passo (anda no chão até cruzar os 2,2 u do gatilho, dentro da janela)
  p.noChao = true; p.vivo = true;
  registrar("passo", pumpEscuta(700.0, (dt) => { p.x = p.x + 0.4; fpsSomQuadro(som, m, pose, dt); }));

  // música (religa o grupo e escuta o laço já tocando)
  Mixer.pause("Música", false);
  registrar("música", pumpEscuta(600.0, (dt) => fpsSomQuadro(som, m, pose, dt)));

  io.print("");
  io.print("som          | rms      | pico     | silencio");
  io.print("-------------+----------+----------+---------");
  let i = 0;
  while (i < tabela.length) {
    const l = tabela[i];
    io.print(l.nome.padEnd(12) + " | " + l.rms.toFixed(5) + "  | " + l.pico.toFixed(5) + "  | " + l.silencio);
    i = i + 1;
  }
  closeAudio();
}

if (falhas === 0) io.print("[PASSOU] fps-som-real"); else io.print("[FALHOU] fps-som-real: " + falhas + " falha(s)");
