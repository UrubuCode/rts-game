// Grupos do mixer por número: produto da cadeia, mudo/pausa rampam o ganho a
// zero ANTES de virar VIRTUAL/CONGELADA (sem clique — ruling A8), pausa
// congela a posição depois da rampa, JSON válido/inválido, salvar/carregar e
// a API Mixer.
//   $RTS run tests/test_audio_grupos.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { initAudio, AUDIO_NULO, mixarBloco, tocarClipe, pararTodas, audioNivel, audioUltimoBloco, vozesTabela, vozIndice, audioPicoGrupo } from "@engine/audio/audio";
import { AudioClip } from "@engine/audio/clip";
import { novoPedido, PEDIDO_GRUPO, VOZ_FLOATS, V_POS, V_FLAGS, FLAG_VIRTUAL } from "@engine/audio/vozes";
import { N_RMS_L, NIVEL_FLOATS } from "@engine/audio/mix_desc";
import { mixerPadrao, mixerNGrupos, grupoIndex, grupoNome, grupoPai, mixerSetVolume, mixerSetMudo, mixerSetPausa,
         ganhoGrupo, grupoPausado, mixerVersao, mixerAlterado, mixerDeJson, mixerParaJson, carregarMixer, salvarMixer,
         grupoVolume, Mixer, GRUPO_MASTER } from "@engine/audio/mixer_grupos";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64): boolean { return Math.abs(a - b) < 1e-9; }
const nivel = new Float64Array(NIVEL_FLOATS);
const vz = vozesTabela();

/// O bloco (2 canais) decai (ou sobe) sem degrau — só usado para o canal
/// esquerdo de um sinal DC constante, então a magnitude segue o ganho linear.
function decaiSemDegrau(quadros: number): boolean {
  const b = audioUltimoBloco();
  let k = 1;
  while (k < quadros) { if (Math.abs(b[2 * k]) > Math.abs(b[2 * (k - 1)]) + 1e-6) return false; k = k + 1; }
  return true;
}
function sobeSemDegrau(quadros: number): boolean {
  const b = audioUltimoBloco();
  let k = 1;
  while (k < quadros) { if (Math.abs(b[2 * k]) < Math.abs(b[2 * (k - 1)]) - 1e-6) return false; k = k + 1; }
  return true;
}

mixerPadrao();
const MUSICA = grupoIndex("Música"); const EFEITOS = grupoIndex("Efeitos");
check(mixerNGrupos() === 4 && grupoNome(GRUPO_MASTER) === "Master" && MUSICA === 1 && grupoPai(MUSICA) === GRUPO_MASTER, "quatro grupos padrão");
check(grupoIndex("Trilha") === 0 - 1, "grupo inexistente");

// ── produto da cadeia ───────────────────────────────────────────────────────
const v0 = mixerVersao();
mixerSetVolume(GRUPO_MASTER, 0.5); mixerSetVolume(MUSICA, 0.5);
check(mixerVersao() > v0 && perto(ganhoGrupo(MUSICA), 0.25) && perto(ganhoGrupo(EFEITOS), 0.5), "Master 0,5 × Música 0,5 = 0,25");

initAudio(AUDIO_NULO);
const dcA = new Float32Array(48000); dcA.fill(0.5);
const dc = AudioClip.fromSamples("dc", dcA, 1);
const p = novoPedido(); p[PEDIDO_GRUPO] = MUSICA;
const id = tocarClipe(dc, p);
mixarBloco(800);
audioNivel(nivel);
check(Math.abs(nivel[N_RMS_L] - 0.125) < 1e-6, "voz na Música: 0,5 × 0,25 = 0,125 (" + nivel[N_RMS_L] + ")");
check(Math.abs(audioPicoGrupo(MUSICA) - 0.125) < 1e-6 && audioPicoGrupo(EFEITOS) === 0.0, "pico estimado por grupo");

// ── mudo: rampa a zero (sem clique), SÓ DEPOIS fica virtual ─────────────────
const b = vozIndice(id) * VOZ_FLOATS;
mixerSetMudo(MUSICA, 1);
mixarBloco(800); // bloco de rampa: ainda mixa, o ganho desce de 0,125 a zero
audioNivel(nivel);
check(nivel[N_RMS_L] > 0.0 && nivel[N_RMS_L] < 0.125 && decaiSemDegrau(800), "mudo: RMS cai sem degrau (" + nivel[N_RMS_L] + ")");
check(Math.abs(audioUltimoBloco()[2 * 799]) < 1e-4, "mudo: a última amostra do bloco de rampa já está em zero");
check(vz[b + V_POS] === 1600.0, "mudo: a posição anda no bloco de rampa (800→1600)");
mixarBloco(800); // agora sim, virtual: silêncio total, posição continua andando
audioNivel(nivel);
check(((vz[b + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0 && nivel[N_RMS_L] === 0.0 && vz[b + V_POS] === 2400.0, "mudo: virtual, silêncio, posição anda (1600→2400)");
mixerSetMudo(MUSICA, 0);
mixerSetMudo(GRUPO_MASTER, 1);
check(ganhoGrupo(MUSICA) === 0.0, "Master mudo cala os filhos");
mixerSetMudo(GRUPO_MASTER, 0);
mixarBloco(800); // desmutado: rampa de VOLTA a partir de zero (sem clique)
audioNivel(nivel);
check(((vz[b + V_FLAGS] | 0) & FLAG_VIRTUAL) === 0 && vz[b + V_POS] === 3200.0, "desmutado: mixa de novo a partir de 3200");
check(nivel[N_RMS_L] > 0.0 && nivel[N_RMS_L] < 0.125 && sobeSemDegrau(800), "desmutado: RMS sobe sem degrau (" + nivel[N_RMS_L] + ")");
check(Math.abs(audioUltimoBloco()[0]) < 1e-3, "desmutado: a primeira amostra do bloco de rampa ainda está perto de zero");

// ── pausa: mesma rampa a zero, depois congela (nem mixa, nem anda) ──────────
mixerSetPausa(GRUPO_MASTER, 1);
check(grupoPausado(MUSICA) === 1, "pausa do Master vale para a Música");
mixarBloco(800); // bloco de rampa: ainda mixa, o ganho desce a zero
audioNivel(nivel);
check(nivel[N_RMS_L] > 0.0 && nivel[N_RMS_L] < 0.125 && decaiSemDegrau(800), "pausa: RMS cai sem degrau no bloco de rampa (" + nivel[N_RMS_L] + ")");
check(vz[b + V_POS] === 4000.0, "pausa: durante o bloco de rampa, a posição ainda anda (3200→4000)");
mixarBloco(800); // agora congelada: nem mixa, nem anda
audioNivel(nivel);
check(nivel[N_RMS_L] === 0.0 && vz[b + V_POS] === 4000.0, "grupo em pausa (depois da rampa): silêncio e a posição não anda");
mixerSetPausa(GRUPO_MASTER, 0);
mixarBloco(800); // despausado: rampa de volta a partir de zero
audioNivel(nivel);
check(vz[b + V_POS] === 4800.0, "despausado: anda de novo (4000→4800)");
check(nivel[N_RMS_L] > 0.0 && nivel[N_RMS_L] < 0.125 && sobeSemDegrau(800), "despausado: RMS sobe sem degrau (" + nivel[N_RMS_L] + ")");
pararTodas();

// ── JSON ────────────────────────────────────────────────────────────────────
mixerSetVolume(EFEITOS, 0.7);
const texto = mixerParaJson();
mixerPadrao();
check(mixerDeJson(texto) === "" && perto(grupoVolume(EFEITOS), 0.7) && perto(grupoVolume(GRUPO_MASTER), 0.5), "ida e volta pelo JSON");
function recusa(t: string, trecho: string): void {
  const antes = mixerParaJson();
  const e = mixerDeJson(t);
  check(e.indexOf(trecho) >= 0, "recusa '" + trecho + "': " + e);
  check(mixerParaJson() === antes, "recusa não muda nada: " + trecho);
}
recusa("{", "JSON");
recusa("{\"grupos\":[]}", "vazio");
recusa("{\"grupos\":[{\"nome\":\"A\",\"pai\":\"X\",\"volume\":1}]}", "raiz");
recusa("{\"grupos\":[{\"nome\":\"A\",\"pai\":\"\",\"volume\":1},{\"nome\":\"A\",\"pai\":\"A\",\"volume\":1}]}", "repetido");
recusa("{\"grupos\":[{\"nome\":\"A\",\"pai\":\"\",\"volume\":1},{\"nome\":\"B\",\"pai\":\"C\",\"volume\":1}]}", "pai");
recusa("{\"grupos\":[{\"nome\":\"A\",\"pai\":\"\",\"volume\":\"alto\"}]}", "volume");
recusa("{\"grupos\":[{\"nome\":\"A\",\"pai\":\"\",\"volume\":1.5}]}", "volume");
{
  let muitos = "{\"grupos\":[{\"nome\":\"G0\",\"pai\":\"\",\"volume\":1}";
  let k = 1;
  while (k < 17) { muitos = muitos + ",{\"nome\":\"G" + k + "\",\"pai\":\"G0\",\"volume\":1}"; k = k + 1; }
  recusa(muitos + "]}", "16");
}

// ── arquivo ─────────────────────────────────────────────────────────────────
fs.create_dir_all("build/test-audio");
check(carregarMixer("build/test-audio/nao_existe.json") === "" && mixerNGrupos() === 4 && perto(grupoVolume(EFEITOS), 1.0), "sem arquivo: padrão");
mixerSetVolume(grupoIndex("Voz"), 0.3);
check(mixerAlterado() === 1, "alterado desde a carga");
check(salvarMixer("build/test-audio/mixer.json") === "" && mixerAlterado() === 0, "salvo");
mixerSetVolume(grupoIndex("Voz"), 1.0);
check(carregarMixer("build/test-audio/mixer.json") === "" && perto(grupoVolume(grupoIndex("Voz")), 0.3) && mixerAlterado() === 0, "recarregado");
check(carregarMixer("assets/audio/mixer.json") === "" && mixerNGrupos() === 4, "o mixer.json do projeto é válido");

// ── API Mixer ───────────────────────────────────────────────────────────────
check(Mixer.setVolume("Efeitos", 0.4) && perto(grupoVolume(EFEITOS), 0.4), "Mixer.setVolume");
check(Mixer.mute("Efeitos", true) && ganhoGrupo(EFEITOS) === 0.0 && Mixer.mute("Efeitos", false), "Mixer.mute");
check(Mixer.pause("Efeitos", true) && grupoPausado(EFEITOS) === 1 && Mixer.pause("Efeitos", false), "Mixer.pause");
check(!Mixer.setVolume("Nada", 1.0) && Mixer.grupoIndex("Voz") === 3, "grupo desconhecido devolve false");
io.print("[PASSOU] grupos: produto da cadeia, mudo/pausa rampam sem clique antes de virtual/congelada, JSON e recusas, arquivo, API Mixer");
