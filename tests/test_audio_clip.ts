// AudioClip: cache por caminho (decodifica uma vez), erro no Console uma vez,
// WAV reamostrado para a taxa dos clipes, OGG pelo runtime, fromSamples e tons.
//   $RTS run tests/test_audio_clip.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { AudioClip, definirTaxaDosClipes, taxaDosClipes, clipPorId, clipDecodificacoes, clipInfo,
         toneClip, FORMA_SENO, FORMA_RUIDO } from "@engine/audio/clip";
import { logEntries, LOG_ERROR } from "@engine/core/logger";
import { EspecWav, escreverWav } from "./wav_escritor";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const DIR = "build/test-audio";
fs.create_dir_all(DIR);
const e = new EspecWav(); e.bits = 16; e.canais = 2; e.taxa = 44100; e.quadros = 44100;
fs.write(DIR + "/tom.wav", escreverWav(e));
fs.write(DIR + "/musica.mp3", new Uint8Array([73, 68, 51]));

definirTaxaDosClipes(48000);
check(taxaDosClipes() === 48000, "taxa dos clipes");
const antes = clipDecodificacoes();
const a = AudioClip.load(DIR + "/tom.wav");
check(a !== null && a.canais === 2 && a.taxa === 48000 && a.quadros === 48000, "1 s a 44,1 kHz vira 48 000 quadros a 48 kHz");
check(a !== null && Math.abs(a.duracao - 1.0) < 1e-9 && a.bytes === 48000 * 2 * 4, "duração e memória");
check(a !== null && a.pico > 0.49 && a.pico <= 0.5, "pico da esquerda (0,5)");
check(a !== null && a.nome === "tom.wav" && a.caminho === DIR + "/tom.wav", "nome e caminho");
check(AudioClip.load(DIR + "/tom.wav") === a && clipDecodificacoes() === antes + 1, "o mesmo arquivo decodifica uma vez");
check(a !== null && clipPorId(a.id) === a, "tabela por id");
check(a !== null && clipInfo(a) === "48000 Hz, estéreo, 1,00 s, 375 KB", "info: " + (a !== null ? clipInfo(a) : ""));

function erros(q: string): number { return logEntries(LOG_ERROR, q).length; }
check(AudioClip.load(DIR + "/nao_existe.wav") === null && erros("nao_existe.wav") === 1, "arquivo ausente: erro no Console");
check(AudioClip.load(DIR + "/nao_existe.wav") === null && erros("nao_existe.wav") === 1, "o erro sai uma vez só");
check(AudioClip.load(DIR + "/musica.mp3") === null && erros("formato não suportado") >= 1, "mp3 recusado com mensagem");

const ogg = AudioClip.load("tests/fixtures_seno440_mono_22050.ogg");
check(ogg !== null && ogg.canais === 1 && ogg.taxa === 48000 && ogg.quadros > 9000 && ogg.quadros < 17000, "OGG 22 050 Hz reamostrado para 48 kHz");

const amostras = new Float32Array([0.1, 0.0 - 0.8, 0.3, 0.2]);
const fs2 = AudioClip.fromSamples("proc", amostras, 2);
check(fs2.quadros === 2 && fs2.canais === 2 && fs2.taxa === 48000 && Math.abs(fs2.pico - 0.8) < 1e-6 && fs2.caminho === "", "fromSamples");

const t1 = toneClip(440.0, 0.15, FORMA_SENO);
check(toneClip(440.0, 0.15, FORMA_SENO) === t1, "o mesmo tom vem da cache");
check(toneClip(440.0, 0.15, FORMA_RUIDO) !== t1, "outra forma é outro clipe");
check(t1.quadros === 7200 && t1.canais === 1 && t1.amostras[0] === 0.0, "0,15 s a 48 kHz, começa em zero");
let ataqueOk = true;
let q = 1;
while (q < 240) { if (Math.abs(t1.amostras[q]) > q / 240.0 + 1e-6) ataqueOk = false; q = q + 1; }
check(ataqueOk, "ataque linear de 5 ms (240 quadros): |s| <= q/240");
check(Math.abs(t1.amostras[7199]) < 0.001, "queda até zero no fim");

// ── mudar a taxa não esvazia `clpLista` (os índices continuam os mesmos), mas
// os ids de ANTES da mudança precisam voltar `null` — sem lista à parte, só
// comparando a taxa guardada no clipe com a taxa atual (custo zero por quadro).
const idAntigo = a !== null ? a.id : 0 - 1;
check(idAntigo >= 0 && clipPorId(idAntigo) === a, "id ainda válido antes da mudança de taxa");
definirTaxaDosClipes(44100);
check(taxaDosClipes() === 44100, "taxa mudou");
check(clipPorId(idAntigo) === null, "id de um clipe da taxa antiga vira null depois da mudança");
const b2 = AudioClip.load(DIR + "/tom.wav"); // recarrega na taxa nova (cache por caminho foi esvaziada)
check(b2 !== null && b2.taxa === 44100 && b2 !== a, "recarregado na taxa nova é um clipe NOVO");
check(clipPorId(b2 !== null ? b2.id : 0 - 1) === b2, "o id novo resolve normalmente");
definirTaxaDosClipes(48000); // devolve a taxa padrão do resto do teste (e dos outros testes na mesma run)

io.print("[PASSOU] clip: cache por caminho, erro uma vez, WAV reamostrado, OGG, fromSamples, tons em cache com envelope, ids da taxa antiga viram null");
