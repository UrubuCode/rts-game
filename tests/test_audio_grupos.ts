// Grupos do mixer por número: produto da cadeia, mudo leva a voz a virtual,
// pausa congela a posição, JSON válido/inválido, salvar/carregar e a API Mixer.
//   $RTS run tests/test_audio_grupos.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { initAudio, AUDIO_NULO, mixarBloco, tocarClipe, pararTodas, audioNivel, vozesTabela, vozIndice, audioPicoGrupo } from "@engine/audio/audio";
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

// ── mudo leva a virtual; volta de onde parou ────────────────────────────────
const b = vozIndice(id) * VOZ_FLOATS;
mixerSetMudo(MUSICA, 1);
mixarBloco(800);
audioNivel(nivel);
check(((vz[b + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0 && nivel[N_RMS_L] === 0.0 && vz[b + V_POS] === 1600.0, "mudo: virtual, silêncio, posição anda");
mixerSetMudo(MUSICA, 0);
mixerSetMudo(GRUPO_MASTER, 1);
check(ganhoGrupo(MUSICA) === 0.0, "Master mudo cala os filhos");
mixerSetMudo(GRUPO_MASTER, 0);
mixarBloco(800);
check(((vz[b + V_FLAGS] | 0) & FLAG_VIRTUAL) === 0 && vz[b + V_POS] === 2400.0, "desmutado: mixa de novo a partir de 2400");

// ── pausa congela ───────────────────────────────────────────────────────────
mixerSetPausa(GRUPO_MASTER, 1);
check(grupoPausado(MUSICA) === 1, "pausa do Master vale para a Música");
mixarBloco(800);
check(vz[b + V_POS] === 2400.0, "grupo em pausa: a posição não anda");
mixerSetPausa(GRUPO_MASTER, 0);
mixarBloco(800);
check(vz[b + V_POS] === 3200.0, "despausado: anda");
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
io.print("[PASSOU] grupos: produto da cadeia, mudo → virtual, pausa congela, JSON e recusas, arquivo, API Mixer");
