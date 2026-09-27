// Mixer de vozes de clipe no dispositivo NULO, por número: ganho, rampa, laço,
// pitch, voz virtual que retoma no ponto certo, pressão de vozes, pausa, API de
// tons, bandeira de jogo e prévia.
//   $RTS run tests/test_audio_mixer.ts
import io from "@compat/io.ts";
import { initAudio, closeAudio, audioReady, audioRate, audioNulo, AUDIO_NULO, mixarBloco, tocarClipe,
         pararVoz, pausarVoz, vozTocando, moverVoz, definirVolumeVoz, pararTodas, activeVoices,
         audioNivel, audioUltimoBloco, vozesTabela, vozIndice, playTone, playToneAt, moveVoice,
         audioEntrarJogo, audioSairJogo, audioEmJogo, tocarPrevia, previaTocando } from "@engine/audio/audio";
import { AudioClip } from "@engine/audio/clip";
import { novoPedido, PEDIDO_VOLUME, PEDIDO_PITCH, PEDIDO_LACO, PEDIDO_FLAGS, PEDIDO_X, PEDIDO_BLEND,
         PEDIDO_MIN, PEDIDO_MAX, FLAG_3D, FLAG_VIRTUAL, VOZ_FLOATS, V_POS, V_FLAGS, MAX_VOZES } from "@engine/audio/vozes";
import { N_RMS_L, N_RMS_R, NIVEL_FLOATS } from "@engine/audio/mix_desc";
import { setListener, setRolloff } from "@engine/audio/spatial";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64, tol: f64): boolean { return Math.abs(a - b) <= tol; }
const nivel = new Float64Array(NIVEL_FLOATS);
const vz = vozesTabela();
function base(id: number): number { return vozIndice(id) * VOZ_FLOATS; }
function cruzamentosL(quadros: number): number {
  const b = audioUltimoBloco(); let n = 0; let q = 1;
  while (q < quadros) { if ((b[(q - 1) * 2] < 0.0) !== (b[q * 2] < 0.0)) n = n + 1; q = q + 1; }
  return n;
}
function seno(freq: f64, quadros: number): AudioClip {
  const a = new Float32Array(quadros); let q = 0;
  while (q < quadros) { a[q] = 0.5 * Math.sin(2.0 * Math.PI * freq * q / 48000.0); q = q + 1; }
  return AudioClip.fromSamples("seno " + freq, a, 1);
}

check(initAudio(AUDIO_NULO) === 1 && audioReady() === 1 && audioRate() === 48000.0 && audioNulo() === 1, "nulo a 48 kHz");
const dcA = new Float32Array(48000); dcA.fill(0.5);
const dc = AudioClip.fromSamples("dc", dcA, 1);
const p = novoPedido();

// ── ganho e rampa ───────────────────────────────────────────────────────────
const id = tocarClipe(dc, p);
check(id > 0 && mixarBloco(800) === 1, "uma voz ativa");
audioNivel(nivel);
check(perto(nivel[N_RMS_L], 0.5, 1e-6) && perto(nivel[N_RMS_R], 0.5, 1e-6), "2D, volume 1: RMS 0,5 nos dois canais já no primeiro bloco");
definirVolumeVoz(id, 0.5);
mixarBloco(800);
const bl = audioUltimoBloco();
check(perto(bl[0], 0.5 * (1.0 - 0.5 / 800.0), 1e-6) && perto(bl[2 * 799], 0.25, 1e-6), "rampa de 0,5 a 0,25 no bloco");
const passo0 = bl[2] - bl[0];
let rampaOk = true; let k = 2;
while (k < 800) { if (!perto(bl[2 * k] - bl[2 * (k - 1)], passo0, 1e-6)) rampaOk = false; k = k + 1; }
check(rampaOk, "rampa linear, sem degrau");
pararVoz(id);
check(vozTocando(id) === 0, "pararVoz já não conta como tocando, mesmo antes do bloco de rampa");
check(activeVoices() === 1, "mas o slot segue ocupado até a rampa de saída terminar");
mixarBloco(800); // bloco de rampa (fase A6): ganho vai de 0,5 a 0 em vez de cortar na hora
check(perto(bl[2 * 799], 0.0, 1e-4), "rampa de parar termina em zero, sem clique");
{
  const passoParar = bl[2] - bl[0];
  let rampaPararOk = true; let kk = 2;
  while (kk < 800) { if (!perto(bl[2 * kk] - bl[2 * (kk - 1)], passoParar, 1e-4)) rampaPararOk = false; kk = kk + 1; }
  check(rampaPararOk, "rampa de parar é linear, sem salto");
}
check(activeVoices() === 0 && vozTocando(id) === 0, "parar libera, agora que a rampa terminou");

// ── laço sem descontinuidade ────────────────────────────────────────────────
const ciclo = seno(480.0, 100);
p[PEDIDO_LACO] = 1.0;
const idLaco = tocarClipe(ciclo, p);
mixarBloco(2400);
let piorSalto = 0.0; k = 1;
while (k < 2400) { const d = Math.abs(bl[2 * k] - bl[2 * (k - 1)]); if (d > piorSalto) piorSalto = d; k = k + 1; }
check(piorSalto < 0.035 && vozTocando(idLaco) === 1, "laço de um ciclo exato: maior salto " + piorSalto);
pararVoz(idLaco);
p[PEDIDO_LACO] = 0.0;

// ── pitch ───────────────────────────────────────────────────────────────────
const s480 = seno(480.0, 48000);
const idP1 = tocarClipe(s480, p);
mixarBloco(2400);
const c1 = cruzamentosL(2400);
pararVoz(idP1);
p[PEDIDO_PITCH] = 2.0;
const idP2 = tocarClipe(s480, p);
mixarBloco(2400);
const c2 = cruzamentosL(2400);
check(Math.abs(c2 - 2 * c1) <= 2, "pitch 2 dobra a frequência: " + c1 + " x " + c2);
k = 1;
while (k < 9) { mixarBloco(2400); k = k + 1; }
check(vozTocando(idP2) === 1, "9 blocos de 2400 = 21 600 quadros: ainda toca");
mixarBloco(2400);
check(vozTocando(idP2) === 0, "10 blocos = 24 000 quadros = metade da duração a pitch 2: acabou");
p[PEDIDO_PITCH] = 1.0;

// ── voz virtual retoma no ponto certo ───────────────────────────────────────
const pose = new Float64Array(8);
setListener(pose); setRolloff(1.0, 60.0);
const p3 = novoPedido();
p3[PEDIDO_FLAGS] = FLAG_3D; p3[PEDIDO_BLEND] = 1.0; p3[PEDIDO_MIN] = 1.0; p3[PEDIDO_MAX] = 60.0; p3[PEDIDO_X] = 100.0;
p3[PEDIDO_LACO] = 1.0;
const idV = tocarClipe(dc, p3);
mixarBloco(2400); mixarBloco(2400);
check(((vz[base(idV) + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0 && vz[base(idV) + V_POS] === 4800.0, "além do máximo: virtual, mas a posição anda (4800)");
audioNivel(nivel);
check(nivel[N_RMS_L] === 0.0 && nivel[N_RMS_R] === 0.0, "virtual não mixa");
const perto5 = new Float64Array(3); perto5[0] = 5.0;
moverVoz(idV, perto5);
mixarBloco(2400);
audioNivel(nivel);
check(((vz[base(idV) + V_FLAGS] | 0) & FLAG_VIRTUAL) === 0 && vz[base(idV) + V_POS] === 7200.0, "de volta ao alcance: retoma em 7200");
check(nivel[N_RMS_R] > 0.01 && nivel[N_RMS_L] < 1e-6, "fonte à direita: só o canal direito");
pararTodas();

// ── parar/pausar voz VIRTUAL: já silenciosa, sem bloco de rampa de áudio ────
const p4 = novoPedido();
p4[PEDIDO_FLAGS] = FLAG_3D; p4[PEDIDO_BLEND] = 1.0; p4[PEDIDO_MIN] = 1.0; p4[PEDIDO_MAX] = 60.0; p4[PEDIDO_X] = 100.0;
const idVParar = tocarClipe(dc, p4);
check(((vz[base(idVParar) + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0, "fora do alcance desde a criação: virtual");
pararVoz(idVParar);
mixarBloco(100); // 1 bloco: avancarVirtual (não mix_add) — não precisa de rampa de ganho
check(activeVoices() === 0 && vozTocando(idVParar) === 0, "parar uma voz virtual libera sem rampa de áudio");
const idVPausar = tocarClipe(dc, p4);
check(((vz[base(idVPausar) + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0, "fora do alcance desde a criação: virtual");
pausarVoz(idVPausar, 1);
mixarBloco(100);
check(activeVoices() === 1 && vozTocando(idVPausar) === 0, "pausar uma voz virtual congela sem rampa de áudio");
pausarVoz(idVPausar, 0);
check(vozTocando(idVPausar) === 1, "despausar a volta a tocar (ainda virtual, mas TOCANDO)");
pararTodas();

// ── segurança de pararVoz: duplicada, id já livre, slot reaproveitado ───────
const idSeg = tocarClipe(dc, p);
mixarBloco(50);
pararVoz(idSeg);
pararVoz(idSeg); // segunda chamada em ESTADO_PARANDO: não reinicia nem quebra a rampa
mixarBloco(50);
check(activeVoices() === 0 && vozTocando(idSeg) === 0, "parar duas vezes seguidas libera normalmente");
pararVoz(idSeg); // id já livre: sem efeito, sem lançar
check(activeVoices() === 0, "parar um id já livre não faz nada");
const idNovoSlot = tocarClipe(dc, p);
check(idNovoSlot > 0 && idNovoSlot !== idSeg && vozIndice(idNovoSlot) === vozIndice(idSeg + MAX_VOZES) && vozTocando(idNovoSlot) === 1,
      "voz nova reaproveita o mesmo slot (id antigo + MAX_VOZES = próxima geração) e toca normalmente");
pararVoz(idSeg); // id antigo (geração velha), agora aponta pro slot da voz NOVA
check(vozTocando(idNovoSlot) === 1, "parar o id antigo NÃO afeta a voz nova que herdou o slot");
mixarBloco(50);
check(vozTocando(idNovoSlot) === 1, "…nem depois de mixar: a voz nova continua tocando");
pararTodas();

// ── pressão de vozes ────────────────────────────────────────────────────────
const ids: number[] = [];
k = 0;
while (k < MAX_VOZES) { ids.push(tocarClipe(dc, p)); k = k + 1; }
check(ids[MAX_VOZES - 1] > 0 && tocarClipe(dc, p) === 0, "33ª voz descartada com as 32 ocupadas");
definirVolumeVoz(ids[5], 0.0);
mixarBloco(64);
const novo = tocarClipe(dc, p);
check(novo > 0 && vozIndice(novo) === 5 && vozTocando(ids[5]) === 0, "a voz virtual cede o lugar; o id antigo fica inválido");
pararTodas();

// ── pausa (fase A6: rampa a zero antes de congelar, sem clique) ─────────────
const idPausa = tocarClipe(dc, p);
mixarBloco(100);
pausarVoz(idPausa, 1);
mixarBloco(100); // bloco de rampa: o ganho desce a zero; a posição ainda anda aqui
check(vz[base(idPausa) + V_POS] === 200.0, "durante o bloco de rampa, a posição ainda anda");
mixarBloco(100);
check(vz[base(idPausa) + V_POS] === 200.0, "pausada (depois da rampa) não anda mais");
pausarVoz(idPausa, 0);
mixarBloco(100);
check(vz[base(idPausa) + V_POS] === 300.0, "despausada anda");
pararTodas();

// ── API de tons de antes ────────────────────────────────────────────────────
check(playTone(440.0, 0.1, 0.3) === 1 && activeVoices() === 1, "playTone");
const idTom = playToneAt(440.0, 0.1, 0.3, 3.0, 0.0, 0.0);
check(idTom > 0 && activeVoices() === 2, "playToneAt");
moveVoice(idTom, 4.0, 0.0, 0.0);
check(vz[base(idTom) + 16] === 4.0, "moveVoice move a voz posicional");

// ── bandeira de jogo e prévia ───────────────────────────────────────────────
audioEntrarJogo();
check(audioEmJogo() === 1, "em jogo");
audioSairJogo();
check(audioEmJogo() === 0 && activeVoices() === 0, "sair do jogo para todas as vozes");
check(tocarPrevia(dc, 1.0, 1.0) > 0 && previaTocando() === 1, "prévia toca fora do jogo");
audioEntrarJogo();
check(previaTocando() === 0, "entrar no jogo para a prévia");
audioSairJogo();

closeAudio();
check(audioReady() === 0 && tocarClipe(dc, p) === 0, "fechado: nada toca");
io.print("[PASSOU] mixer: ganho, rampa linear, laço, pitch 2x, voz virtual retoma, pressão, pausa, tons, jogo e prévia");
