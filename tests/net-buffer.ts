// Testes dos buffers binários e do cabeçalho da rede.
import io from "@compat/io.ts";
import { NetWriter, NetReader, NetFila } from "../src/net/buffer";
import { NetCabecalho, netEscreverCabecalho, netLerCabecalho, netSeqMaisNovo, netSeqDiferenca } from "../src/net/protocol";
import { NET_PKT_DADOS, NET_TAM_CABECALHO } from "../src/net/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

io.print("=== net-buffer ===");

const w = new NetWriter(64);
w.u8(200); w.u16(65000); w.u32(4000000000); w.i16(-1234); w.f32(3.25); w.angulo(Math.PI * 1.5); w.angulo(-0.5);
const r = new NetReader(64);
r.abrir(w.buf, 0, w.pos);
check("u8/u16/u32 ida e volta", r.u8() === 200 && r.u16() === 65000 && r.u32() === 4000000000);
check("i16 negativo e f32", r.i16() === -1234 && r.f32() === 3.25);
const a1 = r.angulo(); const a2 = r.angulo();
check("ângulo quantizado (erro < 0,0002 rad), negativo vira positivo",
      Math.abs(a1 - Math.PI * 1.5) < 0.0002 && Math.abs(a2 - (Math.PI * 2.0 - 0.5)) < 0.0002, "a1=" + a1 + " a2=" + a2);
check("fim exato sem erro", r.resta() === 0 && !r.erro);
const lixo = r.u32();
check("ler além do fim marca erro e devolve 0", r.erro && lixo === 0);

const pequeno = new NetWriter(3);
pequeno.u16(1); pequeno.u16(2);
check("escrever além da capacidade marca cheio sem estourar", pequeno.cheio && pequeno.pos === 2);

const wc = new NetWriter(32);
netEscreverCabecalho(wc, NET_PKT_DADOS, 65535, 12, 0xF0000001, true);
const rc = new NetReader(32);
rc.abrir(wc.buf, 0, wc.pos);
const c = new NetCabecalho();
check("cabeçalho tem 12 bytes", wc.pos === NET_TAM_CABECALHO);
check("cabeçalho ida e volta", netLerCabecalho(rc, c) && c.tipo === NET_PKT_DADOS && c.seq === 65535 &&
      c.ack === 12 && c.ackBits === 0xF0000001 && c.ackValido);
const rCurto = new NetReader(32);
rCurto.abrir(wc.buf, 0, 5);
check("pacote curto não é cabeçalho", !netLerCabecalho(rCurto, c));
wc.buf[0] = 0;
rc.abrir(wc.buf, 0, NET_TAM_CABECALHO);
check("magia errada não é cabeçalho", !netLerCabecalho(rc, c));

check("seq: 0 é mais novo que 65535 (volta)", netSeqMaisNovo(0, 65535) && !netSeqMaisNovo(65535, 0));
check("seq: igual não é mais novo", !netSeqMaisNovo(7, 7));
check("seq: diferença com volta", netSeqDiferenca(2, 65534) === 4 && netSeqDiferenca(65534, 2) === -4);

const f = new NetFila();
const src = new Uint8Array(4); src[0] = 9; src[1] = 8; src[2] = 7; src[3] = 6;
f.por(5, src, 1, 2);
const dst = new Uint8Array(8);
const n = f.tirar(dst);
check("fila copia o trecho e guarda a origem", n === 2 && dst[0] === 8 && dst[1] === 7 && f.origemTirada === 5);
check("fila vazia devolve 0", f.tirar(dst) === 0 && f.tamanho() === 0);

if (falhas === 0) io.print("[PASSOU] net-buffer"); else io.print("[FALHOU] net-buffer: " + falhas + " falha(s)");
