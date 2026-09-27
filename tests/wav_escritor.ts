// Escritor de WAV dos testes: gera, byte a byte, o arquivo que o decodificador
// tem de ler — sem fixture binária versionada e com o sinal conhecido.
export class EspecWav {
  formato: number = 1;      // 1 PCM, 3 float, 2 ADPCM, 7 µ-law (os dois últimos só para recusa)
  bits: number = 16;
  canais: number = 1;
  taxa: number = 48000;
  quadros: number = 480;
  freq: number = 440.0;
  listNoMeio: boolean = false;   // chunk LIST de 5 bytes (ímpar) entre fmt e data
  extensivel: boolean = false;   // WAVE_FORMAT_EXTENSIBLE com o subformato em `formato`
  constructor() {}
}

export function amostraTeste(e: EspecWav, q: number, c: number): f64 {
  const amp = c === 0 ? 0.5 : 0.25;
  return amp * Math.sin(2.0 * Math.PI * e.freq * q / e.taxa);
}

function ewId(b: Uint8Array, p: number, id: string): number {
  let k = 0;
  while (k < 4) { b[p + k] = id.charCodeAt(k); k = k + 1; }
  return p + 4;
}
function ewU16(b: Uint8Array, p: number, v: number): number { b[p] = v & 255; b[p + 1] = (v >> 8) & 255; return p + 2; }
function ewU32(b: Uint8Array, p: number, v: number): number {
  b[p] = v & 255; b[p + 1] = (v >> 8) & 255; b[p + 2] = (v >> 16) & 255; b[p + 3] = (v >>> 24) & 255; return p + 4;
}

export function escreverWav(e: EspecWav): Uint8Array {
  const ba = e.bits >> 3;
  const bloco = ba * e.canais;
  const dataLen = e.quadros * bloco;
  const fmtLen = e.extensivel ? 40 : 16;
  const listTotal = e.listNoMeio ? 8 + 5 + 1 : 0;
  const total = 12 + 8 + fmtLen + listTotal + 8 + dataLen;
  const b = new Uint8Array(total);
  const dv = new DataView(b.buffer);
  let p = 0;
  p = ewId(b, p, "RIFF"); p = ewU32(b, p, total - 8); p = ewId(b, p, "WAVE");
  p = ewId(b, p, "fmt "); p = ewU32(b, p, fmtLen);
  p = ewU16(b, p, e.extensivel ? 0xFFFE : e.formato); p = ewU16(b, p, e.canais);
  p = ewU32(b, p, e.taxa); p = ewU32(b, p, e.taxa * bloco); p = ewU16(b, p, bloco); p = ewU16(b, p, e.bits);
  if (e.extensivel) { p = ewU16(b, p, 22); p = ewU16(b, p, e.bits); p = ewU32(b, p, 3); p = ewU16(b, p, e.formato); p = p + 14; }
  if (e.listNoMeio) { p = ewId(b, p, "LIST"); p = ewU32(b, p, 5); p = ewId(b, p, "INFO"); b[p] = 120; p = p + 2; }
  p = ewId(b, p, "data"); p = ewU32(b, p, dataLen);
  let q = 0;
  while (q < e.quadros) {
    let c = 0;
    while (c < e.canais) {
      const v = amostraTeste(e, q, c);
      if (e.formato === 3) dv.setFloat32(p, v, true);
      else if (e.bits === 8) b[p] = Math.round(v * 127.0) + 128;
      else if (e.bits === 16) ewU16(b, p, Math.round(v * 32767.0) & 0xFFFF);
      else if (e.bits === 24) { const i = Math.round(v * 8388607.0) & 0xFFFFFF; b[p] = i & 255; b[p + 1] = (i >> 8) & 255; b[p + 2] = (i >> 16) & 255; }
      else if (e.bits === 32) ewU32(b, p, Math.round(v * 2147483647.0));
      p = p + ba;
      c = c + 1;
    }
    q = q + 1;
  }
  return b;
}
