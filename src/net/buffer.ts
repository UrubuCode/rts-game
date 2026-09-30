// Leitura e escrita binária little-endian sobre buffers fixos, e uma fila de
// mensagens. O NetReader copia o trecho para o próprio buffer em vez de criar
// uma visão nova por mensagem.

const NET_DOIS_PI: f64 = Math.PI * 2.0;
const NET_ESCALA_ANGULO: f64 = 65536.0;

export class NetWriter {
  buf: Uint8Array;
  dv: DataView;
  pos: number;
  cheio: boolean;

  constructor(capacidade: number) {
    this.buf = new Uint8Array(capacidade);
    this.dv = new DataView(this.buf.buffer);
    this.pos = 0;
    this.cheio = false;
  }

  reiniciar(): void { this.pos = 0; this.cheio = false; }

  cabe(n: number): boolean { return this.pos + n <= this.buf.length; }

  reservar(n: number): boolean {
    if (this.pos + n > this.buf.length) { this.cheio = true; return false; }
    return true;
  }

  u8(v: number): void {
    if (!this.reservar(1)) return;
    this.dv.setUint8(this.pos, v & 0xFF);
    this.pos = this.pos + 1;
  }

  u16(v: number): void {
    if (!this.reservar(2)) return;
    this.dv.setUint16(this.pos, v & 0xFFFF, true);
    this.pos = this.pos + 2;
  }

  u32(v: number): void {
    if (!this.reservar(4)) return;
    this.dv.setUint32(this.pos, v >>> 0, true);
    this.pos = this.pos + 4;
  }

  i16(v: number): void {
    if (!this.reservar(2)) return;
    this.dv.setInt16(this.pos, v, true);
    this.pos = this.pos + 2;
  }

  f32(v: f64): void {
    if (!this.reservar(4)) return;
    this.dv.setFloat32(this.pos, v, true);
    this.pos = this.pos + 4;
  }

  /// Ângulo em radianos quantizado em u16 (volta completa = 65536 passos).
  angulo(rad: f64): void {
    let a = rad % NET_DOIS_PI;
    if (a < 0.0) a = a + NET_DOIS_PI;
    this.u16(Math.round(a / NET_DOIS_PI * NET_ESCALA_ANGULO) & 0xFFFF);
  }

  bytes(src: Uint8Array, n: number): void {
    if (!this.reservar(n)) return;
    // set(subarray) em vez de laço byte a byte: medido bem mais rápido neste
    // runtime, onde laços com acesso a campo/índice caem num caminho
    // dinâmico lento (Tarefa 6, rodada de correções de desempenho).
    this.buf.set(src.subarray(0, n), this.pos);
    this.pos = this.pos + n;
  }

  /// Regrava valores numa posição já escrita (contagens preenchidas depois).
  u8Em(pos: number, v: number): void { this.dv.setUint8(pos, v & 0xFF); }
  u16Em(pos: number, v: number): void { this.dv.setUint16(pos, v & 0xFFFF, true); }
}

export class NetReader {
  buf: Uint8Array;
  dv: DataView;
  pos: number;
  fim: number;
  erro: boolean;

  constructor(capacidade: number) {
    this.buf = new Uint8Array(capacidade);
    this.dv = new DataView(this.buf.buffer);
    this.pos = 0;
    this.fim = 0;
    this.erro = false;
  }

  /// Copia `n` bytes de `src` (a partir de `ini`) e começa a ler do zero.
  abrir(src: Uint8Array, ini: number, n: number): void {
    this.pos = 0;
    this.erro = false;
    if (n < 0 || n > this.buf.length) { this.fim = 0; this.erro = true; return; }
    this.buf.set(src.subarray(ini, ini + n));
    this.fim = n;
  }

  resta(): number { return this.fim - this.pos; }

  garantir(n: number): boolean {
    if (this.pos + n > this.fim) { this.erro = true; this.pos = this.fim; return false; }
    return true;
  }

  u8(): number {
    if (!this.garantir(1)) return 0;
    const v = this.dv.getUint8(this.pos);
    this.pos = this.pos + 1;
    return v;
  }

  u16(): number {
    if (!this.garantir(2)) return 0;
    const v = this.dv.getUint16(this.pos, true);
    this.pos = this.pos + 2;
    return v;
  }

  u32(): number {
    if (!this.garantir(4)) return 0;
    const v = this.dv.getUint32(this.pos, true);
    this.pos = this.pos + 4;
    return v;
  }

  i16(): number {
    if (!this.garantir(2)) return 0;
    const v = this.dv.getInt16(this.pos, true);
    this.pos = this.pos + 2;
    return v;
  }

  f32(): f64 {
    if (!this.garantir(4)) return 0.0;
    const v = this.dv.getFloat32(this.pos, true);
    this.pos = this.pos + 4;
    return v;
  }

  angulo(): f64 {
    return this.u16() * NET_DOIS_PI / NET_ESCALA_ANGULO;
  }

  bytes(dst: Uint8Array, n: number): void {
    if (!this.garantir(n)) return;
    dst.set(this.buf.subarray(this.pos, this.pos + n));
    this.pos = this.pos + n;
  }
}

/// Fila de mensagens com origem. `por` copia os bytes; `tirar` devolve o
/// tamanho (0 = vazia) e guarda a origem em `origemTirada`.
export class NetFila {
  origem: number[];
  dados: Uint8Array[];
  tam: number[];
  inicio: number;
  origemTirada: number;

  constructor() {
    this.origem = [];
    this.dados = [];
    this.tam = [];
    this.inicio = 0;
    this.origemTirada = -1;
  }

  por(origem: number, src: Uint8Array, ini: number, n: number): void {
    const c = new Uint8Array(n);
    c.set(src.subarray(ini, ini + n));
    this.origem.push(origem);
    this.dados.push(c);
    this.tam.push(n);
  }

  tamanho(): number { return this.origem.length - this.inicio; }

  /// Esvazia de vez quando tudo já foi tirado (mantém os arrays curtos).
  compactar(): void {
    if (this.inicio > 0 && this.inicio >= this.origem.length) {
      this.origem.length = 0;
      this.dados.length = 0;
      this.tam.length = 0;
      this.inicio = 0;
    }
  }

  tirar(dst: Uint8Array): number {
    if (this.inicio >= this.origem.length) { this.compactar(); return 0; }
    const k = this.inicio;
    const n = this.tam[k];
    const d = this.dados[k];
    dst.set(d);
    this.origemTirada = this.origem[k];
    this.inicio = k + 1;
    return n;
  }
}
