// O "ouvido" da cena (spec §3.5): o som é ouvido da pose deste objeto. Sem
// campos: a pose vem do Transform. Só um fica ativo por cena (o primeiro ativo
// e habilitado); sem nenhum, vale Camera.main e depois a pose empurrada.
import { Behavior, KIND_AUDIO, AUDIO_PAPEL_OUVINTE } from "./behavior";

/**
 * @componentCategory Áudio
 * @componentDescription O ouvido da cena: o som é ouvido da pose deste objeto. Só um fica ativo por cena.
 * @componentKeywords ouvinte listener ouvido escuta som
 */
export class AudioListener extends Behavior {
  constructor() { super(); }
  kind(): number { return KIND_AUDIO; }
  audioPapel(): number { return AUDIO_PAPEL_OUVINTE; }
}
