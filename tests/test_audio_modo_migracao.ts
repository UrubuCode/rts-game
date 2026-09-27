import io from "@compat/io.ts";
import { recreateBehavior } from "@editor/sceneio";
import { AudioSource, AS_MODO_ARQUIVO, AS_MODO_GERADOR } from "@scripts/audiosource";
import { componentToData } from "@engine/components";

function check(c: boolean, m: string): void { if (!c) throw new Error("FALHOU: " + m); }

// Cena salva sem `modo`, com clip -> migra para arquivo.
const semModoComClip = recreateBehavior({
  type: "script:src/scripts/audiosource.ts#AudioSource",
  fields: { clip: "assets/audio/tiro.wav" }
}) as AudioSource;
check(semModoComClip.modo === AS_MODO_ARQUIVO, "sem modo + clip -> arquivo, got=" + semModoComClip.modo);

// Cena salva sem `modo`, sem clip -> migra para gerador.
const semModoSemClip = recreateBehavior({
  type: "script:src/scripts/audiosource.ts#AudioSource",
  fields: { clip: "" }
}) as AudioSource;
check(semModoSemClip.modo === AS_MODO_GERADOR, "sem modo sem clip -> gerador, got=" + semModoSemClip.modo);

// Cena salva COM `modo` explícito é respeitada (não sobrescrita pela migração).
const comModoGerador = recreateBehavior({
  type: "script:src/scripts/audiosource.ts#AudioSource",
  fields: { clip: "assets/audio/tiro.wav", modo: "gerador" }
}) as AudioSource;
check(comModoGerador.modo === AS_MODO_GERADOR, "modo explicito respeitado mesmo com clip, got=" + comModoGerador.modo);

// Formato antigo (`type:"audiosource"`) -> gerador.
const antigo = recreateBehavior({ type: "audiosource", kind: 0, freq: 440.0, dur: 0.2 }) as AudioSource;
check(antigo.modo === AS_MODO_GERADOR, "formato antigo -> gerador, got=" + antigo.modo);

// Round-trip: salvar grava `modo`.
const a = new AudioSource();
a.clip = "assets/audio/tiro.wav"; a.modo = "arquivo";
const salvo = componentToData(a);
check(salvo.fields.modo === "arquivo", "salvar grava modo: " + JSON.stringify(salvo.fields.modo));
const relido = recreateBehavior(salvo) as AudioSource;
check(relido.modo === "arquivo" && relido.clip === "assets/audio/tiro.wav", "round-trip preserva modo e clip");

io.print("[PASSOU] Migração de modo (sem modo+clip->arquivo, sem modo sem clip->gerador, modo explicito respeitado, formato antigo->gerador, round-trip)");
