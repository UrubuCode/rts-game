// Grupos do mixer por número: produto da cadeia, mudo/pausa rampam o ganho a
// zero ANTES de virar VIRTUAL/CONGELADA (sem clique — ruling A8), pausa
// congela a posição depois da rampa, JSON válido/inválido, salvar/carregar e
// a API Mixer.
//   $RTS run tests/test_audio_grupos.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { initAudio, AUDIO_NULO, mixarBloco, tocarClipe, pararTodas, audioNivel, audioUltimoBloco, vozesTabela, vozIndice,
         audioPicoGrupo, audioContadorMix, audioZerarContadorMix, definirVolumeVoz, definirGrupoVoz, pausarVoz, vozTocando } from "@engine/audio/audio";
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

// ── caminho barato: mudo/volume 0 persistente usa avancarVirtual, não mixa
// mais de verdade (round 1: `atualizarAlvoVoz` não podia mais limpar
// FLAG_VIRTUAL a cada bloco, senão a voz nunca ficava barata) ────────────────
{
  const p2 = novoPedido(); p2[PEDIDO_GRUPO] = MUSICA;
  const idM = tocarClipe(dc, p2);
  const bM = vozIndice(idM) * VOZ_FLOATS;
  mixarBloco(800);
  mixerSetMudo(MUSICA, 1);
  audioZerarContadorMix();
  mixarBloco(800); // bloco de rampa: 1 chamada real de mix
  check(audioContadorMix() === 1, "mudo: o bloco de rampa mixa de verdade (1 chamada)");
  audioZerarContadorMix();
  mixarBloco(800); mixarBloco(800); mixarBloco(800);
  check(audioContadorMix() === 0, "mudo persistente: 3 blocos depois, ZERO chamadas reais de mix (caminho barato)");
  check(((vz[bM + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0, "mudo persistente: continua virtual (a bandeira não é limpa à toa)");
  mixerSetMudo(MUSICA, 0);
  pararTodas();
}
{
  const p3 = novoPedido();
  const idV = tocarClipe(dc, p3);
  const bV = vozIndice(idV) * VOZ_FLOATS;
  mixarBloco(800);
  definirVolumeVoz(idV, 0.0);
  audioZerarContadorMix();
  mixarBloco(800); // bloco de rampa
  check(audioContadorMix() === 1, "volume 0: o bloco de rampa mixa de verdade (1 chamada)");
  audioZerarContadorMix();
  mixarBloco(800); mixarBloco(800);
  check(audioContadorMix() === 0, "volume 0 persistente: caminho barato (0 chamadas reais)");
  check(((vz[bV + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0, "volume 0 persistente: continua virtual");
  pararTodas();
}

// ── definirGrupoVoz: mover uma voz tocando pra um grupo mudo rampa a
// silêncio (mesma regra de sempre, sem clique) ──────────────────────────────
{
  mixerSetMudo(EFEITOS, 1);
  const p4 = novoPedido(); // grupo 0 (Master), audível
  const idG = tocarClipe(dc, p4);
  const bG = vozIndice(idG) * VOZ_FLOATS;
  mixarBloco(800);
  audioNivel(nivel);
  const rmsAntesMover = nivel[N_RMS_L];
  check(rmsAntesMover > 0.0, "antes de mover: audível no Master (" + rmsAntesMover + ")");
  definirGrupoVoz(idG, EFEITOS);
  mixarBloco(800); // bloco de rampa: o novo grupo (mudo) já vale nesse bloco
  audioNivel(nivel);
  check(nivel[N_RMS_L] > 0.0 && nivel[N_RMS_L] < rmsAntesMover && decaiSemDegrau(800), "definirGrupoVoz pra grupo mudo: rampa sem degrau (" + nivel[N_RMS_L] + ")");
  mixarBloco(800);
  audioNivel(nivel);
  check(nivel[N_RMS_L] === 0.0 && ((vz[bG + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0, "definirGrupoVoz pra grupo mudo: silêncio total depois da rampa");
  mixerSetMudo(EFEITOS, 0);
  pararTodas();
}

// ── pausarVoz (por voz) e pausa de GRUPO não se confundem: quem pausou por
// último só é despausado pela SUA própria chamada ───────────────────────────
{
  // ordem 1: grupo pausa primeiro, DEPOIS a voz pausa individualmente.
  const p5 = novoPedido(); p5[PEDIDO_GRUPO] = MUSICA;
  const idO1 = tocarClipe(dc, p5);
  const bO1 = vozIndice(idO1) * VOZ_FLOATS;
  mixarBloco(800);
  mixerSetPausa(MUSICA, 1);
  mixarBloco(800); mixarBloco(800); // rampa + congela (grupo)
  pausarVoz(idO1, 1); // pausa individual, com o grupo já pausado
  mixarBloco(800);
  const posAntes1 = vz[bO1 + V_POS];
  mixerSetPausa(MUSICA, 0); // despausa o GRUPO — a voz deve continuar parada
  mixarBloco(800); mixarBloco(800);
  check(vz[bO1 + V_POS] === posAntes1 && vozTocando(idO1) === 0, "grupo despausado, voz ainda pausada por si mesma: não anda, não toca");
  pausarVoz(idO1, 0); // só a despausa individual retoma
  mixarBloco(800);
  check(vz[bO1 + V_POS] > posAntes1 && vozTocando(idO1) === 1, "despausada individualmente: agora sim anda");
  pararTodas();

  // ordem 2 (invertida): a voz pausa primeiro, DEPOIS o grupo pausa/despausa.
  const idO2 = tocarClipe(dc, p5);
  const bO2 = vozIndice(idO2) * VOZ_FLOATS;
  mixarBloco(800);
  pausarVoz(idO2, 1);
  mixarBloco(800); mixarBloco(800); // rampa da pausa individual
  const posAntes2 = vz[bO2 + V_POS];
  check(vozTocando(idO2) === 0, "pausada individualmente");
  mixerSetPausa(MUSICA, 1); // pausa o grupo por cima
  mixarBloco(800); mixarBloco(800);
  mixerSetPausa(MUSICA, 0); // despausa o grupo — não deve reviver a voz
  mixarBloco(800); mixarBloco(800);
  check(vz[bO2 + V_POS] === posAntes2 && vozTocando(idO2) === 0, "pausa/despausa do grupo não afeta a pausa individual: continua parada");
  pausarVoz(idO2, 0);
  mixarBloco(800);
  check(vz[bO2 + V_POS] > posAntes2 && vozTocando(idO2) === 1, "só a despausa individual retoma");
  pararTodas();
}

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

// ── mixerSetVolume ignora NaN/±Infinity (mantém o valor anterior) ───────────
{
  mixerSetVolume(EFEITOS, 0.4);
  const vAntes = grupoVolume(EFEITOS);
  mixerSetVolume(EFEITOS, NaN);
  check(grupoVolume(EFEITOS) === vAntes, "volume NaN: ignorado, mantém 0,4");
  mixerSetVolume(EFEITOS, Infinity);
  check(grupoVolume(EFEITOS) === vAntes, "volume +Infinity: ignorado");
  mixerSetVolume(EFEITOS, -Infinity);
  check(grupoVolume(EFEITOS) === vAntes, "volume -Infinity: ignorado");
}
io.print("[PASSOU] grupos: produto da cadeia, mudo/pausa rampam sem clique, caminho barato persiste, definirGrupoVoz, pausa por voz x pausa de grupo, volume NaN/Infinity ignorado, JSON e recusas, arquivo, API Mixer");
