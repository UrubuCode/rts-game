# Rede, subprojeto A (transporte, tick e replicação básica): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** duas janelas do FPS conectadas por UDP num servidor dedicado, cada uma vendo o outro jogador andar, sobre uma camada de rede genérica (`src/net/`) que depois vira PR no motor.

**Architecture:** `src/net/` tem transporte plugável (UDP e memória), conexão com canal confiável ordenado sobre UDP (seq/ack/ackBits), servidor e cliente com handshake, inputs redundantes e replicação por snapshot de `NetworkObject`s. O FPS usa isso em `src/servidor_jogo.ts` e `src/cliente_rede.ts` (lógica sem janela, testada em memória); `src/server.ts` e `src/client_rede.ts` só fazem o laço.

**Tech Stack:** TypeScript no runtime `rts` (`../rts`), `node:dgram`, `DataView`, motor rts-game via submódulo `engine/`.

**Spec:** `docs/rede/2026-09-23-rede-arquitetura-e-subprojeto-a.md`

## Global Constraints

- Comandos a partir da raiz do `rts-fps`. Teste: `../rts/target/release/rts.exe run tests/<arquivo>.ts`. Janela: `../rts/target/release/examples/ui_fixture.exe src/<arquivo>.ts`.
- **Prefixos:** `Net`/`net`/`NET_` em todo nome de topo de `src/net/`; `Fps`/`fps`/`FPS_` no resto. Neste runtime, nomes de topo de módulos diferentes colidem.
- **`src/net/` não importa nada de `src/shared/` nem do jogo.** O caminho inverso (jogo → net) é permitido.
- **Imports do motor sempre pelos aliases** `@engine/...` e `@compat/...`. Entre arquivos do próprio repo, caminhos relativos.
- **Despacho por herança de classe**, não por interface: `NetTransport`, `NetComponente` e `NetFabrica` são classes-base com métodos sobrescritos.
- **Tempo entra por parâmetro** (`agora` em segundos, `f64`): nada em `src/net/` lê relógio. É isso que deixa os testes determinísticos.
- **Binário little-endian.** Cabeçalho de 12 bytes: magia `0x4652` (u16), versão (u8), tipo (u8; o bit `0x80` indica ack válido), seq (u16), ack (u16), ackBits (u32).
- **Constantes da spec:** `NET_MTU = 1200`, `NET_TAXA_SNAPSHOT = 30`, `NET_INPUTS_REDUNDANTES = 3`, `NET_MAX_CONFIAVEIS_PENDENTES = 64`, tempo limite de 5 s, `NET_MAX_CLIENTES` do FPS = 16, porta padrão 27015.
- **Alocação:** o A aceita uma cópia (`Uint8Array`) por mensagem enfileirada; buffers de leitura e escrita são fixos. Pools ficam para quando uma medição pedir.
- **Sem reuso de `netId` no A:** ids são monotônicos (1..65535). Isso cumpre "não reaproveitar antes da confirmação"; o reuso entra quando for necessário.
- **Commits:** um por tarefa, com as linhas de atribuição da sessão. Relatórios colam a saída real dos comandos (`docs/licoes-revisao.md`).

## Review Focus

1. **Lixo na porta** (pacote curto, magia errada, versão errada): ignorado sem erro e sem mudar estado. Teste na Tarefa 4 (`net-conexao`).
2. **Números de sequência dando a volta** (65535 → 0) durante a sessão: acks e canal confiável continuam funcionando. Teste na Tarefa 3 (`net-confiavel`, começando em 65500).
3. **Snapshot maior que um pacote** (muitos objetos): dividido em várias mensagens, e todos os objetos atualizam. Teste na Tarefa 5 (`net-replicacao`, 120 objetos).
4. **Cliente cai e volta do mesmo endereço:** depois do tempo limite, a nova conexão é aceita como cliente novo. Teste na Tarefa 4.
5. **Perda de pacotes de input:** com 30% de perda, a redundância de 3 inputs por pacote faz o servidor aplicar ≥ 90% deles; um input só se perde se sumir nos 3 pacotes (~0,3³ ≈ 2,7%). Teste na Tarefa 4.

---

### Tarefa 1: constantes, buffers binários e cabeçalho

**Files:**
- Create: `src/net/config.ts`, `src/net/buffer.ts`, `src/net/protocol.ts`
- Test: `tests/net-buffer.ts`

**Interfaces:**
- Produces:
  - constantes `NET_*` de `config.ts` (lista no código);
  - `class NetWriter { buf: Uint8Array; pos: number; cheio: boolean; constructor(cap: number); reiniciar(); cabe(n): boolean; u8(v); u16(v); u32(v); i16(v); f32(v); angulo(rad); bytes(src: Uint8Array, n); u8Em(pos, v); u16Em(pos, v) }`;
  - `class NetReader { buf; pos; fim; erro: boolean; constructor(cap); abrir(src: Uint8Array, ini: number, n: number); resta(): number; u8(); u16(); u32(); i16(); f32(); angulo(); bytes(dst: Uint8Array, n) }`;
  - `class NetFila { origem: number[]; dados: Uint8Array[]; tam: number[]; inicio: number; origemTirada: number; por(origem, src, ini, n); tamanho(): number; tirar(dst: Uint8Array): number }`;
  - `class NetCabecalho { tipo; versao; seq; ack; ackBits: number; ackValido: boolean }`;
  - `netEscreverCabecalho(w, tipo, seq, ack, ackBits, ackValido: boolean)`, `netEscreverCabecalhoVersao(w, versao, tipo, seq, ack, ackBits, ackValido)`, `netLerCabecalho(r, c): boolean`, `netSeqMaisNovo(a, b): boolean`, `netSeqDiferenca(a, b): number`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/net-buffer.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/net-buffer.ts`
Expected: FAIL: módulo `../src/net/buffer` não encontrado.

- [ ] **Step 3: Implementar `config.ts`**

`src/net/config.ts`:

```ts
// Constantes da camada de rede (genérica: nada aqui conhece o jogo).

// ── protocolo ──────────────────────────────────────────────────────────────
export const NET_MAGIA = 0x4652;               // "RF"
export const NET_VERSAO_PROTOCOLO = 1;
export const NET_TAM_CABECALHO = 12;
export const NET_MTU = 1200;
export const NET_FLAG_ACK = 0x80;              // no byte de tipo: o campo ack é válido

// tipos de pacote
export const NET_PKT_CONECTAR = 1;
export const NET_PKT_RECUSADO = 2;
export const NET_PKT_DESCONECTAR = 3;
export const NET_PKT_DADOS = 4;

// mensagens dentro de DADOS
export const NET_MSG_BEMVINDO = 1;
export const NET_MSG_SPAWN = 2;
export const NET_MSG_DESPAWN = 3;
export const NET_MSG_SNAPSHOT = 4;
export const NET_MSG_INPUT = 5;

// motivos de recusa
export const NET_RECUSA_VERSAO = 1;
export const NET_RECUSA_LOTADO = 2;

// ── conexão ────────────────────────────────────────────────────────────────
export const NET_JANELA_SEQ = 1024;            // registro de pacotes enviados (anel)
export const NET_MAX_CONFIAVEIS_PENDENTES = 64;
export const NET_ORCAMENTO_CONFIAVEL = 400;    // bytes de confiáveis por pacote
export const NET_MAX_TAM_CONFIAVEL = 380;
export const NET_TEMPO_LIMITE_S: f64 = 5.0;
export const NET_INTERVALO_CONECTAR_S: f64 = 0.25;
export const NET_ALFA_RTT: f64 = 0.1;
export const NET_REPETICOES_DESCONECTAR = 3;
export const NET_MAX_PACOTES_POR_ENVIO = 8;

// estados do cliente
export const NET_ESTADO_DESCONECTADO = 0;
export const NET_ESTADO_CONECTANDO = 1;
export const NET_ESTADO_CONECTADO = 2;
export const NET_ESTADO_RECUSADO = 3;

// ── inputs ─────────────────────────────────────────────────────────────────
export const NET_INPUTS_REDUNDANTES = 3;
export const NET_JANELA_INPUT = 64;
export const NET_MAX_ATRASO_INPUT = 6;         // ticks de input acumulados antes de pular
export const NET_MAX_TAM_INPUT = 32;

// ── replicação ─────────────────────────────────────────────────────────────
export const NET_TAXA_SNAPSHOT = 30;           // por segundo
export const NET_ORCAMENTO_SNAPSHOT = 700;     // bytes por mensagem de snapshot
export const NET_MAX_NETID = 65535;
export const NET_DONO_SERVIDOR = 255;
```

- [ ] **Step 4: Implementar `buffer.ts`**

`src/net/buffer.ts`:

```ts
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
    let i = 0;
    while (i < n) { this.buf[this.pos + i] = src[i]; i = i + 1; }
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
    let i = 0;
    while (i < n) { this.buf[i] = src[ini + i]; i = i + 1; }
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
    let i = 0;
    while (i < n) { dst[i] = this.buf[this.pos + i]; i = i + 1; }
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
    let i = 0;
    while (i < n) { c[i] = src[ini + i]; i = i + 1; }
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
    let i = 0;
    while (i < n) { dst[i] = d[i]; i = i + 1; }
    this.origemTirada = this.origem[k];
    this.inicio = k + 1;
    return n;
  }
}
```

- [ ] **Step 5: Implementar `protocol.ts`**

`src/net/protocol.ts`:

```ts
// Cabeçalho de 12 bytes de todo pacote e aritmética de números de sequência.
import { NetWriter, NetReader } from "./buffer";
import { NET_MAGIA, NET_VERSAO_PROTOCOLO, NET_TAM_CABECALHO, NET_FLAG_ACK } from "./config";

export class NetCabecalho {
  tipo: number;
  versao: number;
  seq: number;
  ack: number;
  ackBits: number;
  ackValido: boolean;

  constructor() {
    this.tipo = 0;
    this.versao = 0;
    this.seq = 0;
    this.ack = 0;
    this.ackBits = 0;
    this.ackValido = false;
  }
}

export function netEscreverCabecalhoVersao(w: NetWriter, versao: number, tipo: number, seq: number,
                                          ack: number, ackBits: number, ackValido: boolean): void {
  w.u16(NET_MAGIA);
  w.u8(versao);
  w.u8(ackValido ? (tipo | NET_FLAG_ACK) : tipo);
  w.u16(seq);
  w.u16(ack);
  w.u32(ackBits);
}

export function netEscreverCabecalho(w: NetWriter, tipo: number, seq: number, ack: number,
                                     ackBits: number, ackValido: boolean): void {
  netEscreverCabecalhoVersao(w, NET_VERSAO_PROTOCOLO, tipo, seq, ack, ackBits, ackValido);
}

/// Lê o cabeçalho. false = não é um pacote nosso (curto ou magia errada).
export function netLerCabecalho(r: NetReader, c: NetCabecalho): boolean {
  if (r.resta() < NET_TAM_CABECALHO) return false;
  if (r.u16() !== NET_MAGIA) return false;
  c.versao = r.u8();
  const bruto = r.u8();
  c.tipo = bruto & 0x7F;
  c.ackValido = (bruto & NET_FLAG_ACK) !== 0;
  c.seq = r.u16();
  c.ack = r.u16();
  c.ackBits = r.u32();
  return !r.erro;
}

/// a - b com volta em 16 bits (-32768..32767).
export function netSeqDiferenca(a: number, b: number): number {
  let d = (a - b) & 0xFFFF;
  if (d >= 32768) d = d - 65536;
  return d;
}

export function netSeqMaisNovo(a: number, b: number): boolean {
  return netSeqDiferenca(a, b) > 0;
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/net-buffer.ts`
Expected: 15 `[OK]` e `[PASSOU] net-buffer`.

- [ ] **Step 7: Commit**

```bash
git add src/net/config.ts src/net/buffer.ts src/net/protocol.ts tests/net-buffer.ts
git commit -m "feat(net): constantes, buffers binários, fila e cabeçalho do protocolo"
```

---

### Tarefa 2: transportes (memória e UDP)

**Files:**
- Create: `src/net/transport.ts`, `src/net/transport_udp.ts`
- Test: `tests/net-transporte.ts`

**Interfaces:**
- Consumes: `NetFila` (Tarefa 1).
- Produces:
  - `class NetTransport { origemRecebida: number; bytesEnviados: number; enviar(destino: number, dados: Uint8Array, tamanho: number): void; bombear(): void; receber(dados: Uint8Array): number; fechar(): void }`;
  - `class NetRedeMemoria { tick: number; constructor(perda: f64, atraso: number, semente: number); criarPonta(): NetTransporteMemoria; avancar(): void }`;
  - `class NetTransporteMemoria extends NetTransport { endereco: number }`;
  - `class NetTransporteUdp extends NetTransport { constructor(porta: number); par(ip: string, porta: number): number }`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/net-transporte.ts`:

```ts
// Testes dos transportes: memória (perda e atraso determinísticos) e UDP local.
import io from "@compat/io.ts";
import { time } from "rts";
import { NetRedeMemoria } from "../src/net/transport";
import { NetTransporteUdp } from "../src/net/transport_udp";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function entregues(perda: f64, semente: number): number {
  const rede = new NetRedeMemoria(perda, 0, semente);
  const a = rede.criarPonta();
  const b = rede.criarPonta();
  const pkt = new Uint8Array(4);
  const buf = new Uint8Array(16);
  let n = 0;
  let i = 0;
  while (i < 1000) {
    pkt[0] = i & 0xFF;
    a.enviar(b.endereco, pkt, 4);
    rede.avancar();
    while (b.receber(buf) > 0) n = n + 1;
    i = i + 1;
  }
  return n;
}

io.print("=== net-transporte ===");

const sem = entregues(0.0, 1);
check("memória sem perda entrega tudo", sem === 1000, "n=" + sem);
const p1 = entregues(0.5, 42);
const p2 = entregues(0.5, 42);
check("perda de 50% entrega perto da metade", p1 > 440 && p1 < 560, "n=" + p1);
check("perda é determinística pela semente", p1 === p2, p1 + " vs " + p2);

{
  const rede = new NetRedeMemoria(0.0, 3, 1);
  const a = rede.criarPonta();
  const b = rede.criarPonta();
  const pkt = new Uint8Array(3); pkt[0] = 7; pkt[1] = 8; pkt[2] = 9;
  const buf = new Uint8Array(16);
  a.enviar(b.endereco, pkt, 3);
  rede.avancar(); const r1 = b.receber(buf);
  rede.avancar(); const r2 = b.receber(buf);
  rede.avancar(); const r3 = b.receber(buf);
  check("atraso de 3 ticks: chega no 3º avanço, com conteúdo e origem",
        r1 === 0 && r2 === 0 && r3 === 3 && buf[0] === 7 && buf[2] === 9 && b.origemRecebida === a.endereco);
  check("bytes enviados são contados", a.bytesEnviados === 3);
}

{
  const srv = new NetTransporteUdp(27101);
  const cli = new NetTransporteUdp(0);
  const destino = cli.par("127.0.0.1", 27101);
  const pkt = new Uint8Array(5); pkt[0] = 1; pkt[1] = 2; pkt[2] = 3; pkt[3] = 4; pkt[4] = 5;
  const buf = new Uint8Array(64);
  let recebido = 0;
  let resposta = 0;
  const t0 = time.now_ms();
  while ((recebido === 0 || resposta === 0) && time.now_ms() - t0 < 3000) {
    if (recebido === 0) cli.enviar(destino, pkt, 5);
    srv.bombear();
    const n = srv.receber(buf);
    if (n > 0) { recebido = n; srv.enviar(srv.origemRecebida, buf, n); }
    cli.bombear();
    const m = cli.receber(buf);
    if (m > 0 && cli.origemRecebida === destino) resposta = m;
    time.sleep_ms(2);
  }
  check("UDP local: ida e volta de 5 bytes", recebido === 5 && resposta === 5 && buf[4] === 5,
        "recebido=" + recebido + " resposta=" + resposta);
  srv.fechar();
  cli.fechar();
}

if (falhas === 0) io.print("[PASSOU] net-transporte"); else io.print("[FALHOU] net-transporte: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/net-transporte.ts`
Expected: FAIL: módulo `../src/net/transport` não encontrado.

- [ ] **Step 3: Implementar `transport.ts`**

`src/net/transport.ts`:

```ts
// Transporte plugável: a camada de conexão só vê "pares" numerados e bytes.
import { NetFila } from "./buffer";

export class NetTransport {
  origemRecebida: number;
  bytesEnviados: number;

  constructor() {
    this.origemRecebida = -1;
    this.bytesEnviados = 0;
  }

  enviar(destino: number, dados: Uint8Array, tamanho: number): void {}
  /// Deixa os pacotes pendentes chegarem (no UDP: chama o dgram).
  bombear(): void {}
  /// Copia o próximo pacote para `dados` e devolve o tamanho (0 = nada).
  receber(dados: Uint8Array): number { return 0; }
  fechar(): void {}
}

/// Rede em memória para testes: perda e atraso em ticks, com PRNG semeado.
export class NetRedeMemoria {
  tick: number;
  perda: f64;
  atraso: number;
  semente: number;
  pontas: NetTransporteMemoria[];
  pOrigem: number[];
  pDestino: number[];
  pEntrega: number[];
  pDados: Uint8Array[];
  pTam: number[];

  constructor(perda: f64, atraso: number, semente: number) {
    this.tick = 0;
    this.perda = perda;
    this.atraso = atraso;
    this.semente = semente | 0;
    this.pontas = [];
    this.pOrigem = []; this.pDestino = []; this.pEntrega = []; this.pDados = []; this.pTam = [];
  }

  criarPonta(): NetTransporteMemoria {
    const p = new NetTransporteMemoria(this, this.pontas.length);
    this.pontas.push(p);
    return p;
  }

  rnd(): f64 {
    this.semente = ((this.semente * 1664525 + 1013904223) | 0);
    return (this.semente >>> 0) / 4294967296.0;
  }

  postar(origem: number, destino: number, dados: Uint8Array, n: number): void {
    if (destino < 0 || destino >= this.pontas.length) return;
    if (this.perda > 0.0 && this.rnd() < this.perda) return;
    const c = new Uint8Array(n);
    let i = 0;
    while (i < n) { c[i] = dados[i]; i = i + 1; }
    this.pOrigem.push(origem);
    this.pDestino.push(destino);
    this.pEntrega.push(this.tick + this.atraso);
    this.pDados.push(c);
    this.pTam.push(n);
  }

  /// Um tick de rede: entrega o que venceu, em ordem de envio.
  avancar(): void {
    this.tick = this.tick + 1;
    let w = 0;
    let i = 0;
    while (i < this.pOrigem.length) {
      if (this.pEntrega[i] <= this.tick) {
        this.pontas[this.pDestino[i]].chegou(this.pOrigem[i], this.pDados[i], this.pTam[i]);
      } else {
        this.pOrigem[w] = this.pOrigem[i]; this.pDestino[w] = this.pDestino[i];
        this.pEntrega[w] = this.pEntrega[i]; this.pDados[w] = this.pDados[i]; this.pTam[w] = this.pTam[i];
        w = w + 1;
      }
      i = i + 1;
    }
    this.pOrigem.length = w; this.pDestino.length = w; this.pEntrega.length = w;
    this.pDados.length = w; this.pTam.length = w;
  }
}

export class NetTransporteMemoria extends NetTransport {
  rede: NetRedeMemoria;
  endereco: number;
  caixa: NetFila;

  constructor(rede: NetRedeMemoria, endereco: number) {
    super();
    this.rede = rede;
    this.endereco = endereco;
    this.caixa = new NetFila();
  }

  enviar(destino: number, dados: Uint8Array, tamanho: number): void {
    this.bytesEnviados = this.bytesEnviados + tamanho;
    this.rede.postar(this.endereco, destino, dados, tamanho);
  }

  chegou(origem: number, dados: Uint8Array, n: number): void {
    this.caixa.por(origem, dados, 0, n);
  }

  receber(dados: Uint8Array): number {
    const n = this.caixa.tirar(dados);
    if (n > 0) this.origemRecebida = this.caixa.origemTirada;
    return n;
  }
}
```

Sobre o atraso: um pacote postado com `tick = T` tem `entrega = T + atraso` e sai no avanço em que `tick >= entrega`. Com `atraso` 0 ou 1 ele chega no próximo avanço; com 3, no terceiro.

- [ ] **Step 4: Implementar `transport_udp.ts`**

`src/net/transport_udp.ts`:

```ts
// Transporte UDP (node:dgram). Duas particularidades medidas neste runtime:
// o evento 'message' entrega Uint8Array (não Buffer) e só dispara quando o
// código chama alguma função do dgram, por isso bombear() chama address().
import dgram from "node:dgram";
import { NetTransport } from "./transport";
import { NetFila } from "./buffer";

export class NetTransporteUdp extends NetTransport {
  sock: any;
  ips: string[];
  portas: number[];
  chaves: string[];
  caixa: NetFila;

  constructor(porta: number) {
    super();
    this.ips = [];
    this.portas = [];
    this.chaves = [];
    this.caixa = new NetFila();
    this.sock = dgram.createSocket("udp4");
    const eu = this;
    this.sock.on("message", (msg: any, rinfo: any) => { eu.chegou(msg, rinfo.address, rinfo.port); });
    this.sock.bind(porta);
  }

  /// Id numérico do par "ip:porta" (cria na primeira vez).
  par(ip: string, porta: number): number {
    const chave = ip + ":" + porta;
    let i = this.chaves.indexOf(chave);
    if (i < 0) {
      i = this.chaves.length;
      this.chaves.push(chave);
      this.ips.push(ip);
      this.portas.push(porta);
    }
    return i;
  }

  chegou(msg: any, ip: string, porta: number): void {
    this.caixa.por(this.par(ip, porta), msg, 0, msg.length);
  }

  enviar(destino: number, dados: Uint8Array, tamanho: number): void {
    if (destino < 0 || destino >= this.ips.length) return;
    this.bytesEnviados = this.bytesEnviados + tamanho;
    this.sock.send(dados.subarray(0, tamanho), this.portas[destino], this.ips[destino]);
  }

  bombear(): void {
    this.sock.address();
  }

  receber(dados: Uint8Array): number {
    const n = this.caixa.tirar(dados);
    if (n > 0) this.origemRecebida = this.caixa.origemTirada;
    return n;
  }

  fechar(): void {
    this.sock.close();
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/net-transporte.ts`
Expected: 6 `[OK]` e `[PASSOU] net-transporte`.

Se o caso UDP falhar com "`eu` indefinido" ou o callback não disparar, o runtime não está capturando a variável local na closure: troque por um `let netUdpAtual: NetTransporteUdp | null` de módulo, atribuído no construtor, e registre isso como decisão.

- [ ] **Step 6: Commit**

```bash
git add src/net/transport.ts src/net/transport_udp.ts tests/net-transporte.ts
git commit -m "feat(net): transporte em memória com perda/atraso e transporte UDP"
```

---

### Tarefa 3: conexão (seq/ack, canal confiável ordenado, RTT)

**Files:**
- Create: `src/net/connection.ts`
- Test: `tests/net-confiavel.ts`

**Interfaces:**
- Consumes: Tarefas 1 e 2.
- Produces: `class NetConexao` com:
  - `constructor(par: number, agora: f64, seqInicial: number, idInicial: number)` (em produção, `0, 0`);
  - campos `par`, `rtt: f64`, `temRtt: boolean`, `ultimoContato: f64`, `transbordou: boolean`, `confiaveis: NetFila` (entregues ao jogo, em ordem), `naoConfiaveis: NetFila`, `ncSaida: NetFila`;
  - métodos:
    - `enfileirarConfiavel(dados: Uint8Array, n: number): void`;
    - `enfileirarNaoConfiavel(dados, n): void`;
    - `pendentesConfiaveis(): number`;
    - `montar(w: NetWriter, agora: f64): void` (monta um pacote `DADOS` completo em `w`);
    - `receber(c: NetCabecalho, r: NetReader, agora: f64): void` (corpo de um `DADOS` com o cabeçalho já lido).

- [ ] **Step 1: Escrever o teste que falha**

`tests/net-confiavel.ts`:

```ts
// Canal confiável ordenado sobre transporte com perda, atraso e volta de seq.
import io from "@compat/io.ts";
import { NetRedeMemoria, NetTransport } from "../src/net/transport";
import { NetConexao } from "../src/net/connection";
import { NetWriter, NetReader } from "../src/net/buffer";
import { NetCabecalho, netLerCabecalho } from "../src/net/protocol";
import { NET_MTU } from "../src/net/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

const w = new NetWriter(NET_MTU);
const r = new NetReader(NET_MTU);
const rm = new NetReader(64);
const cab = new NetCabecalho();
const buf = new Uint8Array(NET_MTU);
const msg = new Uint8Array(NET_MTU);

function drenar(t: NetTransport, con: NetConexao, agora: f64): void {
  let n = t.receber(buf);
  while (n > 0) {
    r.abrir(buf, 0, n);
    if (netLerCabecalho(r, cab)) con.receber(cab, r, agora);
    n = t.receber(buf);
  }
}

function cenario(nome: string, perda: f64, seqInicial: number, idInicial: number): void {
  const rede = new NetRedeMemoria(perda, 2, 42);
  const ta = rede.criarPonta();
  const tb = rede.criarPonta();
  const a = new NetConexao(tb.endereco, 0.0, seqInicial, idInicial);
  const b = new NetConexao(ta.endereco, 0.0, seqInicial, idInicial);
  const TOTAL = 1000;
  let enviadas = 0;
  let recebidas = 0;
  let emOrdem = true;
  const pedaco = new NetWriter(8);
  let t = 0;
  while (t < 4000 && (recebidas < TOTAL || a.pendentesConfiaveis() > 0)) {
    const agora = t / 60.0;
    let k = 0;
    while (k < 5 && enviadas < TOTAL) {
      pedaco.reiniciar(); pedaco.u32(enviadas);
      a.enfileirarConfiavel(pedaco.buf, pedaco.pos);
      enviadas = enviadas + 1; k = k + 1;
    }
    a.montar(w, agora); ta.enviar(tb.endereco, w.buf, w.pos);
    b.montar(w, agora); tb.enviar(ta.endereco, w.buf, w.pos);
    rede.avancar();
    drenar(tb, b, agora);
    drenar(ta, a, agora);
    let n = b.confiaveis.tirar(msg);
    while (n > 0) {
      rm.abrir(msg, 0, n);
      if (rm.u32() !== recebidas) emOrdem = false;
      recebidas = recebidas + 1;
      n = b.confiaveis.tirar(msg);
    }
    t = t + 1;
  }
  check(nome + ": 1.000 mensagens chegam, em ordem, sem duplicata",
        recebidas === TOTAL && emOrdem, "recebidas=" + recebidas + " emOrdem=" + emOrdem + " ticks=" + t);
  check(nome + ": remetente fica sem pendências e mede RTT",
        a.pendentesConfiaveis() === 0 && a.temRtt && a.rtt > 0.0 && !a.transbordou,
        "pendentes=" + a.pendentesConfiaveis() + " rtt=" + a.rtt);
}

io.print("=== net-confiavel ===");
cenario("sem perda", 0.0, 0, 0);
cenario("20% de perda", 0.2, 0, 0);
cenario("seq e id dando a volta", 0.2, 65500, 65400);

// não confiável: chega uma vez se não houver perda, e some sem reenvio
{
  const rede = new NetRedeMemoria(0.0, 0, 1);
  const ta = rede.criarPonta();
  const tb = rede.criarPonta();
  const a = new NetConexao(tb.endereco, 0.0, 0, 0);
  const b = new NetConexao(ta.endereco, 0.0, 0, 0);
  const um = new Uint8Array(1); um[0] = 42;
  a.enfileirarNaoConfiavel(um, 1);
  a.montar(w, 0.0); ta.enviar(tb.endereco, w.buf, w.pos);
  a.montar(w, 0.0); ta.enviar(tb.endereco, w.buf, w.pos);
  rede.avancar();
  drenar(tb, b, 0.0);
  const n1 = b.naoConfiaveis.tirar(msg);
  const n2 = b.naoConfiaveis.tirar(msg);
  check("não confiável chega uma vez e não é reenviada", n1 === 1 && msg[0] === 42 && n2 === 0);
}

if (falhas === 0) io.print("[PASSOU] net-confiavel"); else io.print("[FALHOU] net-confiavel: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/net-confiavel.ts`
Expected: FAIL: módulo `../src/net/connection` não encontrado.

- [ ] **Step 3: Implementar `connection.ts`**

`src/net/connection.ts`:

```ts
// Estado de uma conexão: números de sequência e acks (seq/ack/ackBits), canal
// confiável ordenado por reenvio "de carona" e RTT. Tempo entra por parâmetro.
import { NetWriter, NetReader, NetFila } from "./buffer";
import { NetCabecalho, netEscreverCabecalho, netSeqDiferenca, netSeqMaisNovo } from "./protocol";
import {
  NET_PKT_DADOS, NET_JANELA_SEQ, NET_MAX_CONFIAVEIS_PENDENTES, NET_ORCAMENTO_CONFIAVEL,
  NET_MAX_TAM_CONFIAVEL, NET_ALFA_RTT, NET_TAM_CABECALHO, NET_MTU,
} from "./config";

export class NetConexao {
  par: number;
  seqEnvio: number;
  ackRemoto: number;
  ackBitsRemoto: number;
  recebeuAlgum: boolean;
  regSeq: number[];
  regTempo: f64[];
  regPrimeiro: number[];
  regUltimo: number[];
  confProximoId: number;
  pendId: number[];
  pendDados: Uint8Array[];
  pendTam: number[];
  confEsperado: number;
  adId: number[];
  adDados: Uint8Array[];
  adTam: number[];
  confiaveis: NetFila;
  naoConfiaveis: NetFila;
  ncSaida: NetFila;
  rtt: f64;
  temRtt: boolean;
  ultimoContato: f64;
  transbordou: boolean;

  constructor(par: number, agora: f64, seqInicial: number, idInicial: number) {
    this.par = par;
    this.seqEnvio = seqInicial & 0xFFFF;
    this.ackRemoto = 0;
    this.ackBitsRemoto = 0;
    this.recebeuAlgum = false;
    this.regSeq = []; this.regTempo = []; this.regPrimeiro = []; this.regUltimo = [];
    let i = 0;
    while (i < NET_JANELA_SEQ) {
      this.regSeq.push(-1); this.regTempo.push(0.0); this.regPrimeiro.push(-1); this.regUltimo.push(-1);
      i = i + 1;
    }
    this.confProximoId = idInicial & 0xFFFF;
    this.pendId = []; this.pendDados = []; this.pendTam = [];
    this.confEsperado = idInicial & 0xFFFF;
    this.adId = []; this.adDados = []; this.adTam = [];
    this.confiaveis = new NetFila();
    this.naoConfiaveis = new NetFila();
    this.ncSaida = new NetFila();
    this.rtt = 0.0;
    this.temRtt = false;
    this.ultimoContato = agora;
    this.transbordou = false;
  }

  pendentesConfiaveis(): number { return this.pendId.length; }

  enfileirarConfiavel(dados: Uint8Array, n: number): void {
    if (n > NET_MAX_TAM_CONFIAVEL || this.pendId.length >= NET_MAX_CONFIAVEIS_PENDENTES) {
      this.transbordou = true;
      return;
    }
    const c = new Uint8Array(n);
    let i = 0;
    while (i < n) { c[i] = dados[i]; i = i + 1; }
    this.pendId.push(this.confProximoId);
    this.pendDados.push(c);
    this.pendTam.push(n);
    this.confProximoId = (this.confProximoId + 1) & 0xFFFF;
  }

  enfileirarNaoConfiavel(dados: Uint8Array, n: number): void {
    if (n > NET_MTU - NET_TAM_CABECALHO - 8) return;   // nunca caberia num pacote
    this.ncSaida.por(0, dados, 0, n);
  }

  /// Monta um pacote DADOS: confiáveis pendentes (até o orçamento) e as não
  /// confiáveis que couberem. As que não couberem ficam para o próximo pacote.
  montar(w: NetWriter, agora: f64): void {
    w.reiniciar();
    const seq = this.seqEnvio;
    this.seqEnvio = (seq + 1) & 0xFFFF;
    netEscreverCabecalho(w, NET_PKT_DADOS, seq, this.ackRemoto, this.ackBitsRemoto, this.recebeuAlgum);

    const posN = w.pos;
    w.u8(0);
    const inicioConf = w.pos;
    let n = 0;
    let primeiro = -1;
    let ultimo = -1;
    let i = 0;
    while (i < this.pendId.length && n < 255) {
      const tam = this.pendTam[i];
      if (w.pos - inicioConf + 4 + tam > NET_ORCAMENTO_CONFIAVEL) i = this.pendId.length;
      else {
        w.u16(this.pendId[i]);
        w.u16(tam);
        w.bytes(this.pendDados[i], tam);
        if (primeiro < 0) primeiro = this.pendId[i];
        ultimo = this.pendId[i];
        n = n + 1;
        i = i + 1;
      }
    }
    w.u8Em(posN, n);

    const posM = w.pos;
    w.u8(0);
    let m = 0;
    const f = this.ncSaida;
    let cabeMais = true;
    while (cabeMais && f.inicio < f.origem.length && m < 255) {
      const tam = f.tam[f.inicio];
      if (!w.cabe(2 + tam)) cabeMais = false;          // o resto fica para o próximo pacote
      else {
        w.u16(tam);
        w.bytes(f.dados[f.inicio], tam);
        f.inicio = f.inicio + 1;
        m = m + 1;
      }
    }
    f.compactar();
    w.u8Em(posM, m);

    const slot = seq % NET_JANELA_SEQ;
    this.regSeq[slot] = seq;
    this.regTempo[slot] = agora;
    this.regPrimeiro[slot] = primeiro;
    this.regUltimo[slot] = ultimo;
  }

  ncPendentes(): number { return this.ncSaida.tamanho(); }

  receber(c: NetCabecalho, r: NetReader, agora: f64): void {
    this.ultimoContato = agora;
    this.registrarRecebido(c.seq);
    if (c.ackValido) this.processarAcks(c.ack, c.ackBits, agora);
    const n = r.u8();
    let i = 0;
    while (i < n && !r.erro) {
      const id = r.u16();
      const tam = r.u16();
      if (tam > r.resta()) { r.erro = true; return; }
      const d = new Uint8Array(tam);
      r.bytes(d, tam);
      this.receberConfiavel(id, d, tam);
      i = i + 1;
    }
    const m = r.u8();
    let j = 0;
    while (j < m && !r.erro) {
      const tam = r.u16();
      if (tam > r.resta()) { r.erro = true; return; }
      this.naoConfiaveis.por(0, r.buf, r.pos, tam);
      r.pos = r.pos + tam;
      j = j + 1;
    }
  }

  registrarRecebido(seq: number): void {
    if (!this.recebeuAlgum) {
      this.recebeuAlgum = true;
      this.ackRemoto = seq;
      this.ackBitsRemoto = 0;
      return;
    }
    const d = netSeqDiferenca(seq, this.ackRemoto);
    if (d > 0) {
      const deslocado = d >= 32 ? 0 : ((this.ackBitsRemoto << d) >>> 0);
      const bitAntigo = d <= 32 ? ((1 << (d - 1)) >>> 0) : 0;
      this.ackBitsRemoto = (deslocado | bitAntigo) >>> 0;
      this.ackRemoto = seq;
    } else if (d < 0 && d >= -32) {
      this.ackBitsRemoto = (this.ackBitsRemoto | ((1 << (-d - 1)) >>> 0)) >>> 0;
    }
  }

  processarAcks(ack: number, bits: number, agora: f64): void {
    this.confirmar(ack, agora);
    let i = 0;
    while (i < 32) {
      if (((bits >>> i) & 1) === 1) this.confirmar((ack - 1 - i) & 0xFFFF, agora);
      i = i + 1;
    }
  }

  confirmar(seq: number, agora: f64): void {
    const slot = seq % NET_JANELA_SEQ;
    if (this.regSeq[slot] !== seq) return;
    this.regSeq[slot] = -1;
    const amostra = agora - this.regTempo[slot];
    if (!this.temRtt) { this.rtt = amostra; this.temRtt = true; }
    else this.rtt = this.rtt + (amostra - this.rtt) * NET_ALFA_RTT;
    if (this.regPrimeiro[slot] >= 0) this.removerConfirmadas(this.regPrimeiro[slot], this.regUltimo[slot]);
  }

  removerConfirmadas(primeiro: number, ultimo: number): void {
    const faixa = (ultimo - primeiro) & 0xFFFF;
    let w = 0;
    let i = 0;
    while (i < this.pendId.length) {
      if (((this.pendId[i] - primeiro) & 0xFFFF) > faixa) {
        this.pendId[w] = this.pendId[i];
        this.pendDados[w] = this.pendDados[i];
        this.pendTam[w] = this.pendTam[i];
        w = w + 1;
      }
      i = i + 1;
    }
    this.pendId.length = w;
    this.pendDados.length = w;
    this.pendTam.length = w;
  }

  receberConfiavel(id: number, dados: Uint8Array, tam: number): void {
    if (id === this.confEsperado) {
      this.confiaveis.por(0, dados, 0, tam);
      this.confEsperado = (this.confEsperado + 1) & 0xFFFF;
      let achou = true;
      while (achou) {
        achou = false;
        let i = 0;
        while (i < this.adId.length) {
          if (this.adId[i] === this.confEsperado) {
            this.confiaveis.por(0, this.adDados[i], 0, this.adTam[i]);
            this.confEsperado = (this.confEsperado + 1) & 0xFFFF;
            const u = this.adId.length - 1;
            this.adId[i] = this.adId[u]; this.adDados[i] = this.adDados[u]; this.adTam[i] = this.adTam[u];
            this.adId.length = u; this.adDados.length = u; this.adTam.length = u;
            achou = true;
            i = this.adId.length;
          } else {
            i = i + 1;
          }
        }
      }
    } else if (netSeqMaisNovo(id, this.confEsperado) && this.adId.indexOf(id) < 0) {
      this.adId.push(id);
      this.adDados.push(dados);
      this.adTam.push(tam);
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/net-confiavel.ts`
Expected: 7 `[OK]` e `[PASSOU] net-confiavel`.

- [ ] **Step 5: Commit**

```bash
git add src/net/connection.ts tests/net-confiavel.ts
git commit -m "feat(net): conexão com acks, canal confiável ordenado e RTT"
```

---

### Tarefa 4: servidor e cliente (handshake, tempo limite, inputs)

**Files:**
- Create: `src/net/server.ts`, `src/net/client.ts`
- Test: `tests/net-conexao.ts`

**Interfaces:**
- Consumes: Tarefas 1–3.
- Produces:
  - `class NetServidor` com:
    - `constructor(t: NetTransport, maxClientes: number, taxaTick: number)`;
    - `definirBoasVindas(dados: Uint8Array, n: number)`;
    - `receber(agora: f64)`, `verificarTempo(agora: f64)`, `enviar(agora: f64)`;
    - `enviarConfiavel(c, dados, n)`, `enviarConfiavelTodos(dados, n)`, `enviarNaoConfiavelTodos(dados, n)`;
    - `proximoNovo(): number` e `proximoSaido(): number` (−1 = nenhum);
    - `proximoInput(c: number, dst: Uint8Array): number`;
    - `conectado(c): boolean`;
    - campos `conexoes: (NetConexao | null)[]` e `tick: number`.
  - `class NetCliente` com:
    - `constructor(t: NetTransport)`;
    - `conectar(servidor: number, agora: f64)`, `passo(agora: f64)`, `enviarInput(seq: number, dados: Uint8Array, n: number)`, `enviar(agora: f64)`, `desconectar()`;
    - campos `estado`, `clienteId`, `motivoRecusa`, `boasVindas: Uint8Array`, `boasVindasTam`, `mensagens: NetFila` (confiáveis para o jogo), `instantaneos: NetFila` (não confiáveis para o jogo), `con: NetConexao | null`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/net-conexao.ts`:

```ts
// Handshake, recusa, lixo na porta, tempo limite, reconexão e inputs redundantes.
import io from "@compat/io.ts";
import { NetRedeMemoria } from "../src/net/transport";
import { NetServidor } from "../src/net/server";
import { NetCliente } from "../src/net/client";
import { NetWriter, NetReader } from "../src/net/buffer";
import { NetCabecalho, netEscreverCabecalhoVersao, netLerCabecalho } from "../src/net/protocol";
import {
  NET_ESTADO_CONECTADO, NET_ESTADO_RECUSADO, NET_ESTADO_DESCONECTADO, NET_RECUSA_LOTADO,
  NET_RECUSA_VERSAO, NET_PKT_CONECTAR, NET_PKT_RECUSADO, NET_MTU,
} from "../src/net/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

const DT: f64 = 1.0 / 60.0;
let relogio = 0;

function rodar(rede: NetRedeMemoria, srv: NetServidor | null, clis: NetCliente[], ticks: number): void {
  let t = 0;
  while (t < ticks) {
    const agora = relogio * DT;
    let k = 0;
    while (k < clis.length) { clis[k].passo(agora); clis[k].enviar(agora); k = k + 1; }
    rede.avancar();
    if (srv !== null) { srv.receber(agora); srv.verificarTempo(agora); srv.enviar(agora); }
    rede.avancar();
    relogio = relogio + 1;
    t = t + 1;
  }
}

io.print("=== net-conexao ===");

// 1. handshake com bytes de boas-vindas
const rede = new NetRedeMemoria(0.0, 1, 1);
const tS = rede.criarPonta();
const srv = new NetServidor(tS, 1, 60);
const bv = new Uint8Array(3); bv[0] = 7; bv[1] = 8; bv[2] = 9;
srv.definirBoasVindas(bv, 3);
const c1 = new NetCliente(rede.criarPonta());
c1.conectar(tS.endereco, 0.0);
rodar(rede, srv, [c1], 20);
check("conecta e recebe o BEMVINDO com os bytes do jogo",
      c1.estado === NET_ESTADO_CONECTADO && c1.clienteId === 0 && c1.boasVindasTam === 3 && c1.boasVindas[2] === 9);
check("servidor avisa o jogo do cliente novo", srv.proximoNovo() === 0 && srv.proximoNovo() === -1);

// 2. lotado
const c2 = new NetCliente(rede.criarPonta());
c2.conectar(tS.endereco, relogio * DT);
rodar(rede, srv, [c1, c2], 10);
check("servidor lotado recusa", c2.estado === NET_ESTADO_RECUSADO && c2.motivoRecusa === NET_RECUSA_LOTADO);

// 3. versão errada e lixo na porta
{
  const tR = rede.criarPonta();
  const w = new NetWriter(NET_MTU);
  netEscreverCabecalhoVersao(w, 99, NET_PKT_CONECTAR, 0, 0, 0, false);
  tR.enviar(tS.endereco, w.buf, w.pos);
  const lixo = new Uint8Array(20); lixo[0] = 1; lixo[1] = 2;
  tR.enviar(tS.endereco, lixo, 20);
  tR.enviar(tS.endereco, lixo, 3);
  rodar(rede, srv, [c1], 3);
  const buf = new Uint8Array(NET_MTU);
  const r = new NetReader(NET_MTU);
  const cab = new NetCabecalho();
  let motivo = -1;
  let n = tR.receber(buf);
  while (n > 0) {
    r.abrir(buf, 0, n);
    if (netLerCabecalho(r, cab) && cab.tipo === NET_PKT_RECUSADO) motivo = r.u8();
    n = tR.receber(buf);
  }
  check("versão errada é recusada com motivo", motivo === NET_RECUSA_VERSAO, "motivo=" + motivo);
  check("lixo na porta é ignorado sem derrubar ninguém", c1.estado === NET_ESTADO_CONECTADO && srv.conectado(0));
}

// 4. tempo limite nos dois lados e reconexão do mesmo par
{
  rodar(rede, srv, [], 5.2 * 60);
  check("servidor derruba cliente em silêncio por 5 s", srv.proximoSaido() === 0 && !srv.conectado(0));
  c1.conectar(tS.endereco, relogio * DT);
  rodar(rede, srv, [c1], 20);
  check("o mesmo par volta depois do tempo limite e ocupa a vaga liberada",
        c1.estado === NET_ESTADO_CONECTADO && srv.conectado(0) && srv.proximoNovo() === 0);
  const rede2 = new NetRedeMemoria(0.0, 1, 5);
  const tS2 = rede2.criarPonta();
  const srv2 = new NetServidor(tS2, 1, 60);
  const c4 = new NetCliente(rede2.criarPonta());
  c4.conectar(tS2.endereco, relogio * DT);
  rodar(rede2, srv2, [c4], 20);
  rodar(rede2, null, [c4], 5.2 * 60);
  check("cliente desiste de servidor mudo em 5 s", c4.estado === NET_ESTADO_DESCONECTADO);
}

// 5. inputs com 30% de perda: aplicados em sequência, sem buracos
{
  const redeP = new NetRedeMemoria(0.3, 1, 9);
  const tSP = redeP.criarPonta();
  const srvP = new NetServidor(tSP, 1, 60);
  const cP = new NetCliente(redeP.criarPonta());
  cP.conectar(tSP.endereco, 0.0);
  let t = 0;
  while (t < 60 && cP.estado !== NET_ESTADO_CONECTADO) {
    const agora = t * DT;
    cP.passo(agora); cP.enviar(agora); redeP.avancar();
    srvP.receber(agora); srvP.enviar(agora); redeP.avancar();
    t = t + 1;
  }
  const dado = new Uint8Array(2);
  const dst = new Uint8Array(32);
  let esperado = -1;
  let ultimoV = -1;
  let buracos = 0;
  let aplicados = 0;
  let seq = 0;
  while (seq < 600) {
    const agora = (t + seq) * DT;
    dado[0] = seq & 0xFF; dado[1] = (seq >> 8) & 0xFF;
    cP.enviarInput(seq, dado, 2);
    cP.passo(agora); cP.enviar(agora); redeP.avancar();
    srvP.receber(agora);
    const n = srvP.proximoInput(0, dst);
    if (n === 2) {
      const v = dst[0] | (dst[1] << 8);
      if (v !== ultimoV) {
        if (esperado >= 0 && v !== esperado) buracos = buracos + 1;
        aplicados = aplicados + 1;
        esperado = v + 1;
        ultimoV = v;
      }
    }
    srvP.enviar(agora); redeP.avancar();
    seq = seq + 1;
  }
  // um input só se perde se sumir nos 3 pacotes que o carregam: ~0,3³ = 2,7%
  check("com 30% de perda, ≥ 90% dos inputs aplicados e buracos só na faixa de perda³",
        aplicados >= 540 && buracos <= 40, "buracos=" + buracos + " aplicados=" + aplicados);
}

if (falhas === 0) io.print("[PASSOU] net-conexao"); else io.print("[FALHOU] net-conexao: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/net-conexao.ts`
Expected: FAIL: módulo `../src/net/server` não encontrado.

- [ ] **Step 3: Implementar `server.ts`**

`src/net/server.ts`:

```ts
// Servidor: aceita conexões (com versão e limite), entrega inputs ao jogo um
// por tick e envia um pacote por conexão a cada enviar().
import { NetTransport } from "./transport";
import { NetConexao } from "./connection";
import { NetWriter, NetReader } from "./buffer";
import { NetCabecalho, netEscreverCabecalho, netLerCabecalho, netSeqMaisNovo, netSeqDiferenca } from "./protocol";
import {
  NET_MTU, NET_VERSAO_PROTOCOLO, NET_PKT_CONECTAR, NET_PKT_RECUSADO, NET_PKT_DESCONECTAR, NET_PKT_DADOS,
  NET_MSG_BEMVINDO, NET_MSG_INPUT, NET_RECUSA_VERSAO, NET_RECUSA_LOTADO, NET_TEMPO_LIMITE_S,
  NET_REPETICOES_DESCONECTAR, NET_TAXA_SNAPSHOT, NET_JANELA_INPUT, NET_MAX_TAM_INPUT,
  NET_MAX_ATRASO_INPUT, NET_MAX_PACOTES_POR_ENVIO,
} from "./config";

export class NetServidor {
  t: NetTransport;
  maxClientes: number;
  taxaTick: number;
  tick: number;
  conexoes: (NetConexao | null)[];
  boasVindas: Uint8Array;
  boasVindasTam: number;
  novos: number[];
  saidos: number[];
  w: NetWriter;
  r: NetReader;
  rMsg: NetReader;
  cab: NetCabecalho;
  pacote: Uint8Array;
  msg: Uint8Array;
  inSeq: number[][];
  inDados: Uint8Array[][];
  inTam: number[][];
  inTem: boolean[];
  inMaior: number[];
  inAplicado: number[];
  inUltimo: Uint8Array[];
  inUltimoTam: number[];

  constructor(t: NetTransport, maxClientes: number, taxaTick: number) {
    this.t = t;
    this.maxClientes = maxClientes;
    this.taxaTick = taxaTick;
    this.tick = 0;
    this.conexoes = [];
    this.boasVindas = new Uint8Array(0);
    this.boasVindasTam = 0;
    this.novos = [];
    this.saidos = [];
    this.w = new NetWriter(NET_MTU);
    this.r = new NetReader(NET_MTU);
    this.rMsg = new NetReader(NET_MTU);
    this.cab = new NetCabecalho();
    this.pacote = new Uint8Array(NET_MTU);
    this.msg = new Uint8Array(NET_MTU);
    this.inSeq = []; this.inDados = []; this.inTam = []; this.inTem = []; this.inMaior = [];
    this.inAplicado = []; this.inUltimo = []; this.inUltimoTam = [];
    let c = 0;
    while (c < maxClientes) {
      this.conexoes.push(null);
      const seqs: number[] = [];
      const dados: Uint8Array[] = [];
      const tams: number[] = [];
      let k = 0;
      while (k < NET_JANELA_INPUT) { seqs.push(-1); dados.push(new Uint8Array(NET_MAX_TAM_INPUT)); tams.push(0); k = k + 1; }
      this.inSeq.push(seqs); this.inDados.push(dados); this.inTam.push(tams);
      this.inTem.push(false); this.inMaior.push(0); this.inAplicado.push(0);
      this.inUltimo.push(new Uint8Array(NET_MAX_TAM_INPUT)); this.inUltimoTam.push(0);
      c = c + 1;
    }
  }

  definirBoasVindas(dados: Uint8Array, n: number): void {
    this.boasVindas = new Uint8Array(n);
    let i = 0;
    while (i < n) { this.boasVindas[i] = dados[i]; i = i + 1; }
    this.boasVindasTam = n;
  }

  conectado(c: number): boolean { return c >= 0 && c < this.maxClientes && this.conexoes[c] !== null; }

  clienteDoPar(par: number): number {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null && con.par === par) return c;
      c = c + 1;
    }
    return -1;
  }

  proximoNovo(): number {
    if (this.novos.length === 0) return -1;
    const c = this.novos[0];
    this.novos.splice(0, 1);
    return c;
  }

  proximoSaido(): number {
    if (this.saidos.length === 0) return -1;
    const c = this.saidos[0];
    this.saidos.splice(0, 1);
    return c;
  }

  receber(agora: f64): void {
    this.t.bombear();
    let n = this.t.receber(this.pacote);
    while (n > 0) {
      this.processarPacote(this.t.origemRecebida, n, agora);
      n = this.t.receber(this.pacote);
    }
  }

  processarPacote(origem: number, n: number, agora: f64): void {
    const r = this.r;
    r.abrir(this.pacote, 0, n);
    if (!netLerCabecalho(r, this.cab)) return;
    const c = this.clienteDoPar(origem);
    if (this.cab.tipo === NET_PKT_CONECTAR) {
      if (c < 0) this.aceitar(origem, agora);
      return;
    }
    if (c < 0 || this.cab.versao !== NET_VERSAO_PROTOCOLO) return;
    if (this.cab.tipo === NET_PKT_DESCONECTAR) { this.desconectar(c, false); return; }
    if (this.cab.tipo !== NET_PKT_DADOS) return;
    const con = this.conexoes[c];
    if (con === null) return;
    con.receber(this.cab, r, agora);
    let m = con.naoConfiaveis.tirar(this.msg);
    while (m > 0) {
      this.processarMensagem(c, m);
      m = con.naoConfiaveis.tirar(this.msg);
    }
    while (con.confiaveis.tirar(this.msg) > 0) { /* o cliente não manda confiáveis no subprojeto A */ }
  }

  aceitar(origem: number, agora: f64): void {
    if (this.cab.versao !== NET_VERSAO_PROTOCOLO) { this.recusar(origem, NET_RECUSA_VERSAO); return; }
    let c = -1;
    let i = 0;
    while (i < this.maxClientes && c < 0) { if (this.conexoes[i] === null) c = i; i = i + 1; }
    if (c < 0) { this.recusar(origem, NET_RECUSA_LOTADO); return; }
    const con = new NetConexao(origem, agora, 0, 0);
    this.conexoes[c] = con;
    this.inTem[c] = false;
    this.inUltimoTam[c] = 0;
    let k = 0;
    while (k < NET_JANELA_INPUT) { this.inSeq[c][k] = -1; k = k + 1; }
    const w = this.w;
    w.reiniciar();
    w.u8(NET_MSG_BEMVINDO);
    w.u8(c);
    w.u32(this.tick);
    w.u8(this.taxaTick);
    w.u8(NET_TAXA_SNAPSHOT);
    w.u16(this.boasVindasTam);
    w.bytes(this.boasVindas, this.boasVindasTam);
    con.enfileirarConfiavel(w.buf, w.pos);
    this.novos.push(c);
  }

  recusar(origem: number, motivo: number): void {
    const w = this.w;
    w.reiniciar();
    netEscreverCabecalho(w, NET_PKT_RECUSADO, 0, 0, 0, false);
    w.u8(motivo);
    this.t.enviar(origem, w.buf, w.pos);
  }

  processarMensagem(c: number, n: number): void {
    const r = this.rMsg;
    r.abrir(this.msg, 0, n);
    if (r.u8() !== NET_MSG_INPUT) return;
    const k = r.u8();
    let i = 0;
    while (i < k && !r.erro) {
      const seq = r.u16();
      const tam = r.u8();
      if (tam > NET_MAX_TAM_INPUT || tam > r.resta()) { r.erro = true; return; }
      if (!this.inTem[c] || netSeqMaisNovo(seq, this.inAplicado[c])) {
        const slot = seq % NET_JANELA_INPUT;
        this.inSeq[c][slot] = seq;
        r.bytes(this.inDados[c][slot], tam);
        this.inTam[c][slot] = tam;
        if (!this.inTem[c]) {
          this.inTem[c] = true;
          this.inAplicado[c] = (seq - 1) & 0xFFFF;
          this.inMaior[c] = seq;
        } else if (netSeqMaisNovo(seq, this.inMaior[c])) {
          this.inMaior[c] = seq;
        }
      } else {
        r.pos = r.pos + tam;
      }
      i = i + 1;
    }
  }

  /// O input a aplicar neste tick: o próximo em sequência se já chegou; senão
  /// repete o último. Devolve o tamanho (0 = ainda nenhum input).
  proximoInput(c: number, dst: Uint8Array): number {
    if (!this.inTem[c]) return 0;
    if (netSeqDiferenca(this.inMaior[c], this.inAplicado[c]) > NET_MAX_ATRASO_INPUT) {
      this.inAplicado[c] = (this.inMaior[c] - 1) & 0xFFFF;
    }
    const alvo = (this.inAplicado[c] + 1) & 0xFFFF;
    const slot = alvo % NET_JANELA_INPUT;
    if (this.inSeq[c][slot] === alvo) {
      const n = this.inTam[c][slot];
      const src = this.inDados[c][slot];
      const ult = this.inUltimo[c];
      let i = 0;
      while (i < n) { ult[i] = src[i]; i = i + 1; }
      this.inUltimoTam[c] = n;
      this.inAplicado[c] = alvo;
    }
    const n = this.inUltimoTam[c];
    const ult = this.inUltimo[c];
    let j = 0;
    while (j < n) { dst[j] = ult[j]; j = j + 1; }
    return n;
  }

  enviarConfiavel(c: number, dados: Uint8Array, n: number): void {
    const con = this.conexoes[c];
    if (con === null) return;
    con.enfileirarConfiavel(dados, n);
    if (con.transbordou) this.desconectar(c, true);
  }

  enviarConfiavelTodos(dados: Uint8Array, n: number): void {
    let c = 0;
    while (c < this.maxClientes) { if (this.conexoes[c] !== null) this.enviarConfiavel(c, dados, n); c = c + 1; }
  }

  enviarNaoConfiavelTodos(dados: Uint8Array, n: number): void {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null) con.enfileirarNaoConfiavel(dados, n);
      c = c + 1;
    }
  }

  enviar(agora: f64): void {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null) {
        let p = 0;
        let continuar = true;
        while (continuar) {
          con.montar(this.w, agora);
          this.t.enviar(con.par, this.w.buf, this.w.pos);
          p = p + 1;
          continuar = con.ncPendentes() > 0 && p < NET_MAX_PACOTES_POR_ENVIO;
        }
      }
      c = c + 1;
    }
  }

  verificarTempo(agora: f64): void {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null && agora - con.ultimoContato > NET_TEMPO_LIMITE_S) this.desconectar(c, true);
      c = c + 1;
    }
  }

  desconectar(c: number, avisar: boolean): void {
    const con = this.conexoes[c];
    if (con === null) return;
    if (avisar) {
      const w = this.w;
      w.reiniciar();
      netEscreverCabecalho(w, NET_PKT_DESCONECTAR, 0, 0, 0, false);
      let k = 0;
      while (k < NET_REPETICOES_DESCONECTAR) { this.t.enviar(con.par, w.buf, w.pos); k = k + 1; }
    }
    this.conexoes[c] = null;
    this.inTem[c] = false;
    this.inUltimoTam[c] = 0;
    this.saidos.push(c);
  }
}
```

- [ ] **Step 4: Implementar `client.ts`**

`src/net/client.ts`:

```ts
// Cliente: conecta (repetindo CONECTAR até o BEMVINDO), manda os últimos
// inputs em todo pacote e separa as mensagens do servidor para o jogo.
import { NetTransport } from "./transport";
import { NetConexao } from "./connection";
import { NetWriter, NetReader, NetFila } from "./buffer";
import { NetCabecalho, netEscreverCabecalho, netLerCabecalho } from "./protocol";
import {
  NET_MTU, NET_VERSAO_PROTOCOLO, NET_PKT_CONECTAR, NET_PKT_RECUSADO, NET_PKT_DESCONECTAR, NET_PKT_DADOS,
  NET_MSG_BEMVINDO, NET_MSG_INPUT, NET_INTERVALO_CONECTAR_S, NET_TEMPO_LIMITE_S, NET_INPUTS_REDUNDANTES,
  NET_MAX_TAM_INPUT, NET_REPETICOES_DESCONECTAR, NET_ESTADO_DESCONECTADO, NET_ESTADO_CONECTANDO,
  NET_ESTADO_CONECTADO, NET_ESTADO_RECUSADO,
} from "./config";

export class NetCliente {
  t: NetTransport;
  servidor: number;
  con: NetConexao | null;
  estado: number;
  clienteId: number;
  tickServidor: number;
  taxaTick: number;
  taxaSnapshot: number;
  motivoRecusa: number;
  boasVindas: Uint8Array;
  boasVindasTam: number;
  ultimoConectar: f64;
  mensagens: NetFila;
  instantaneos: NetFila;
  w: NetWriter;
  r: NetReader;
  rMsg: NetReader;
  cab: NetCabecalho;
  pacote: Uint8Array;
  msg: Uint8Array;
  inSeq: number[];
  inDados: Uint8Array[];
  inTam: number[];
  inN: number;

  constructor(t: NetTransport) {
    this.t = t;
    this.servidor = -1;
    this.con = null;
    this.estado = NET_ESTADO_DESCONECTADO;
    this.clienteId = -1;
    this.tickServidor = 0;
    this.taxaTick = 0;
    this.taxaSnapshot = 0;
    this.motivoRecusa = 0;
    this.boasVindas = new Uint8Array(0);
    this.boasVindasTam = 0;
    this.ultimoConectar = -1.0e9;
    this.mensagens = new NetFila();
    this.instantaneos = new NetFila();
    this.w = new NetWriter(NET_MTU);
    this.r = new NetReader(NET_MTU);
    this.rMsg = new NetReader(NET_MTU);
    this.cab = new NetCabecalho();
    this.pacote = new Uint8Array(NET_MTU);
    this.msg = new Uint8Array(NET_MTU);
    this.inSeq = []; this.inDados = []; this.inTam = [];
    let i = 0;
    while (i < NET_INPUTS_REDUNDANTES) { this.inSeq.push(0); this.inDados.push(new Uint8Array(NET_MAX_TAM_INPUT)); this.inTam.push(0); i = i + 1; }
    this.inN = 0;
  }

  conectar(servidor: number, agora: f64): void {
    while (this.t.receber(this.pacote) > 0) { /* descarta pacotes de uma sessão anterior */ }
    this.servidor = servidor;
    this.estado = NET_ESTADO_CONECTANDO;
    this.con = new NetConexao(servidor, agora, 0, 0);
    this.ultimoConectar = -1.0e9;
    this.inN = 0;
  }

  passo(agora: f64): void {
    this.t.bombear();
    let n = this.t.receber(this.pacote);
    while (n > 0) {
      if (this.t.origemRecebida === this.servidor) this.processarPacote(n, agora);
      n = this.t.receber(this.pacote);
    }
    if (this.estado === NET_ESTADO_CONECTANDO && agora - this.ultimoConectar >= NET_INTERVALO_CONECTAR_S) {
      const w = this.w;
      w.reiniciar();
      netEscreverCabecalho(w, NET_PKT_CONECTAR, 0, 0, 0, false);
      this.t.enviar(this.servidor, w.buf, w.pos);
      this.ultimoConectar = agora;
    }
    const con = this.con;
    if ((this.estado === NET_ESTADO_CONECTANDO || this.estado === NET_ESTADO_CONECTADO) &&
        con !== null && agora - con.ultimoContato > NET_TEMPO_LIMITE_S) {
      this.estado = NET_ESTADO_DESCONECTADO;
    }
  }

  processarPacote(n: number, agora: f64): void {
    const r = this.r;
    r.abrir(this.pacote, 0, n);
    if (!netLerCabecalho(r, this.cab) || this.cab.versao !== NET_VERSAO_PROTOCOLO) return;
    if (this.cab.tipo === NET_PKT_RECUSADO) { this.motivoRecusa = r.u8(); this.estado = NET_ESTADO_RECUSADO; return; }
    if (this.cab.tipo === NET_PKT_DESCONECTAR) { this.estado = NET_ESTADO_DESCONECTADO; return; }
    const con = this.con;
    if (this.cab.tipo !== NET_PKT_DADOS || con === null) return;
    if (this.estado !== NET_ESTADO_CONECTANDO && this.estado !== NET_ESTADO_CONECTADO) return;
    con.receber(this.cab, r, agora);
    let m = con.confiaveis.tirar(this.msg);
    while (m > 0) {
      if (this.msg[0] === NET_MSG_BEMVINDO) this.lerBemvindo(m);
      else this.mensagens.por(0, this.msg, 0, m);
      m = con.confiaveis.tirar(this.msg);
    }
    m = con.naoConfiaveis.tirar(this.msg);
    while (m > 0) {
      this.instantaneos.por(0, this.msg, 0, m);
      m = con.naoConfiaveis.tirar(this.msg);
    }
  }

  lerBemvindo(n: number): void {
    const r = this.rMsg;
    r.abrir(this.msg, 0, n);
    r.u8();
    this.clienteId = r.u8();
    this.tickServidor = r.u32();
    this.taxaTick = r.u8();
    this.taxaSnapshot = r.u8();
    const tam = r.u16();
    this.boasVindas = new Uint8Array(tam);
    r.bytes(this.boasVindas, tam);
    this.boasVindasTam = tam;
    if (!r.erro) this.estado = NET_ESTADO_CONECTADO;
  }

  /// Guarda o input mais novo; os NET_INPUTS_REDUNDANTES últimos vão em todo pacote.
  enviarInput(seq: number, dados: Uint8Array, n: number): void {
    if (n > NET_MAX_TAM_INPUT) return;
    if (this.inN < NET_INPUTS_REDUNDANTES) this.inN = this.inN + 1;
    else {
      let i = 0;
      while (i < NET_INPUTS_REDUNDANTES - 1) {
        this.inSeq[i] = this.inSeq[i + 1];
        const d = this.inDados[i]; this.inDados[i] = this.inDados[i + 1]; this.inDados[i + 1] = d;
        this.inTam[i] = this.inTam[i + 1];
        i = i + 1;
      }
    }
    const k = this.inN - 1;
    this.inSeq[k] = seq & 0xFFFF;
    let j = 0;
    while (j < n) { this.inDados[k][j] = dados[j]; j = j + 1; }
    this.inTam[k] = n;
  }

  enviar(agora: f64): void {
    const con = this.con;
    if (this.estado !== NET_ESTADO_CONECTADO || con === null) return;
    const w = this.w;
    if (this.inN > 0) {
      w.reiniciar();
      w.u8(NET_MSG_INPUT);
      w.u8(this.inN);
      let i = 0;
      while (i < this.inN) {
        w.u16(this.inSeq[i]);
        w.u8(this.inTam[i]);
        w.bytes(this.inDados[i], this.inTam[i]);
        i = i + 1;
      }
      con.enfileirarNaoConfiavel(w.buf, w.pos);
    }
    con.montar(w, agora);
    this.t.enviar(this.servidor, w.buf, w.pos);
  }

  desconectar(): void {
    if (this.servidor >= 0 && this.estado === NET_ESTADO_CONECTADO) {
      const w = this.w;
      w.reiniciar();
      netEscreverCabecalho(w, NET_PKT_DESCONECTAR, 0, 0, 0, false);
      let k = 0;
      while (k < NET_REPETICOES_DESCONECTAR) { this.t.enviar(this.servidor, w.buf, w.pos); k = k + 1; }
    }
    this.estado = NET_ESTADO_DESCONECTADO;
  }
}
```

- [ ] **Step 4b: Garantir que `src/net/` não conhece o jogo**

Run: `grep -rn "shared/\|fps\|Fps" src/net`
Expected: nenhuma linha.

- [ ] **Step 5: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/net-conexao.ts`
Expected: 9 `[OK]` e `[PASSOU] net-conexao`. Rode também `net-buffer`, `net-transporte` e `net-confiavel`: continuam verdes.

- [ ] **Step 6: Commit**

```bash
git add src/net/server.ts src/net/client.ts tests/net-conexao.ts
git commit -m "feat(net): servidor e cliente com handshake, recusa, tempo limite e inputs redundantes"
```

---

### Tarefa 5: componentes e replicação

**Files:**
- Create: `src/net/components.ts`, `src/net/replication.ts`
- Test: `tests/net-replicacao.ts`

**Interfaces:**
- Consumes: Tarefas 1–4; `Behavior` de `@engine/core/behavior`; `GameObject`; `Transform`; `Scene`.
- Produces:
  - `class NetComponente { netEscrever(w: NetWriter): void; netLer(r: NetReader): void }`;
  - `class NetworkObject extends Behavior { netId; tipo; dono: number; go: GameObject | null; componentes: NetComponente[]; constructor(tipo: number, dono: number); adicionar(c: NetComponente): NetworkObject; escreverEstado(w); lerEstado(r) }`;
  - `class NetworkTransform extends NetComponente { constructor(t: Transform) }`;
  - `class NetFabrica { criar(tipo: number, netId: number, dono: number): NetworkObject | null }`;
  - `class NetReplicacaoServidor { constructor(srv: NetServidor); spawn(no): number; despawn(no): void; aoConectar(c: number): void; enviarSnapshot(tick: number): void; objetos: NetworkObject[] }`;
  - `class NetReplicacaoCliente { constructor(cli: NetCliente, scene: Scene, fab: NetFabrica); processar(): void; porDono(dono: number): NetworkObject | null; porNetId(id): NetworkObject | null; objetos: NetworkObject[]; ultimoTick: number }`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/net-replicacao.ts`:

```ts
// Replicação: spawn/despawn, snapshot (posição, yaw, ativo), quem entra depois,
// netId sem reuso e snapshot dividido em várias mensagens.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { NetRedeMemoria } from "../src/net/transport";
import { NetServidor } from "../src/net/server";
import { NetCliente } from "../src/net/client";
import { NetworkObject, NetworkTransform } from "../src/net/components";
import { NetFabrica, NetReplicacaoServidor, NetReplicacaoCliente } from "../src/net/replication";
import { NET_DONO_SERVIDOR } from "../src/net/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

class NetTesteFabrica extends NetFabrica {
  criar(tipo: number, netId: number, dono: number): NetworkObject | null {
    const go = new GameObject("remoto" + netId);
    go.setMesh(1, 1, 1, 1);
    const no = new NetworkObject(tipo, dono);
    no.go = go;
    no.adicionar(new NetworkTransform(go.transform));
    go.addBehavior(no);
    return no;
  }
}

function objetoServidor(nome: string): NetworkObject {
  const go = new GameObject(nome);
  go.setMesh(1, 1, 1, 1);
  const no = new NetworkObject(7, NET_DONO_SERVIDOR);
  no.go = go;
  no.adicionar(new NetworkTransform(go.transform));
  go.addBehavior(no);
  return no;
}

const DT: f64 = 1.0 / 60.0;
let relogio = 0;
const rede = new NetRedeMemoria(0.0, 1, 1);
const tS = rede.criarPonta();
const srv = new NetServidor(tS, 4, 60);
const repS = new NetReplicacaoServidor(srv);
const clientes: NetCliente[] = [];
const reps: NetReplicacaoCliente[] = [];

function novoCliente(): number {
  const cli = new NetCliente(rede.criarPonta());
  cli.conectar(tS.endereco, relogio * DT);
  clientes.push(cli);
  reps.push(new NetReplicacaoCliente(cli, new Scene("cli" + clientes.length), new NetTesteFabrica()));
  return clientes.length - 1;
}

function rodar(ticks: number, snapshot: boolean): void {
  let t = 0;
  while (t < ticks) {
    const agora = relogio * DT;
    let k = 0;
    while (k < clientes.length) { clientes[k].passo(agora); reps[k].processar(); clientes[k].enviar(agora); k = k + 1; }
    rede.avancar();
    srv.receber(agora);
    let c = srv.proximoNovo();
    while (c >= 0) { repS.aoConectar(c); c = srv.proximoNovo(); }
    if (snapshot) repS.enviarSnapshot(relogio);
    srv.enviar(agora);
    rede.avancar();
    relogio = relogio + 1;
    t = t + 1;
  }
}

io.print("=== net-replicacao ===");

const a = objetoServidor("a");
a.go!.transform.setPosition(1.0, 2.0, 3.0);
check("primeiro netId é 1", repS.spawn(a) === 1);
const c0 = novoCliente();
rodar(10, true);
check("cliente recebe o que já existia", reps[c0].objetos.length === 1 && reps[c0].porNetId(1) !== null);

const b = objetoServidor("b");
repS.spawn(b);
a.go!.transform.setPosition(3.0, 4.0, 5.0);
a.go!.transform.ry = 1.0;
rodar(5, true);
const ra = reps[c0].porNetId(1);
const ta = ra !== null && ra.go !== null ? ra.go.transform : null;
check("spawn novo chega", reps[c0].objetos.length === 2);
check("snapshot aplica posição e yaw", ta !== null && Math.abs(ta.px - 3.0) < 0.001 && Math.abs(ta.pz - 5.0) < 0.001 &&
      Math.abs(ta.ry - 1.0) < 0.0002);

a.go!.active = 0;
rodar(3, true);
const raAtivo = reps[c0].porNetId(1);
check("estado ativo é replicado", raAtivo !== null && raAtivo.go !== null && raAtivo.go.active === 0);

repS.despawn(b);
rodar(5, true);
check("despawn remove do cliente", reps[c0].objetos.length === 1 && reps[c0].porNetId(2) === null);
const cObj = objetoServidor("c");
check("netId não é reaproveitado", repS.spawn(cObj) === 3);

const c1 = novoCliente();
rodar(10, true);
check("quem entra depois recebe os objetos vivos", reps[c1].objetos.length === 2 &&
      reps[c1].porNetId(1) !== null && reps[c1].porNetId(3) !== null);

// 120 spawns em 3 lotes de 40: de uma vez só estourariam as 64 confiáveis pendentes por cliente
let muitos: NetworkObject[] = [];
let i = 0;
while (i < 120) {
  const o = objetoServidor("m" + i);
  o.go!.transform.setPosition(i * 1.0, 0.0, 0.0);
  repS.spawn(o);
  muitos.push(o);
  i = i + 1;
  if (i % 40 === 0) rodar(6, true);
}
rodar(10, true);
i = 0;
while (i < 120) { muitos[i].go!.transform.setPosition(i * 1.0, 7.0, 0.0); i = i + 1; }
rodar(5, true);
let certos = 0;
i = 0;
while (i < 120) {
  const r = reps[c0].porNetId(muitos[i].netId);
  if (r !== null && r.go !== null && Math.abs(r.go.transform.py - 7.0) < 0.001) certos = certos + 1;
  i = i + 1;
}
check("snapshot com 122 objetos é dividido e todos atualizam", certos === 120, "certos=" + certos);

if (falhas === 0) io.print("[PASSOU] net-replicacao"); else io.print("[FALHOU] net-replicacao: " + falhas + " falha(s)");
```

Se o runtime não aceitar o operador `!` de não-nulo, troque `a.go!` por uma variável local `const goA = a.go as GameObject;` e registre como decisão.

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/net-replicacao.ts`
Expected: FAIL: módulo `../src/net/components` não encontrado.

- [ ] **Step 3: Implementar `components.ts`**

`src/net/components.ts`:

```ts
// Componentes de rede no modelo do motor: NetworkObject é um Behavior preso ao
// GameObject; o estado replicado vem dos NetComponente registrados nele, em
// ordem fixa (a mesma no servidor e no cliente).
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";
import { NetWriter, NetReader } from "./buffer";

export class NetComponente {
  netEscrever(w: NetWriter): void {}
  netLer(r: NetReader): void {}
}

export class NetworkObject extends Behavior {
  netId: number;
  tipo: number;
  dono: number;
  go: GameObject | null;
  componentes: NetComponente[];

  constructor(tipo: number, dono: number) {
    super();
    this.netId = 0;
    this.tipo = tipo;
    this.dono = dono;
    this.go = null;
    this.componentes = [];
  }

  typeName(): string { return "NetworkObject"; }

  adicionar(c: NetComponente): NetworkObject {
    this.componentes.push(c);
    return this;
  }

  escreverEstado(w: NetWriter): void {
    w.u8(this.go !== null ? this.go.active : 0);
    let i = 0;
    while (i < this.componentes.length) { this.componentes[i].netEscrever(w); i = i + 1; }
  }

  lerEstado(r: NetReader): void {
    const ativo = r.u8();
    if (this.go !== null && !r.erro) this.go.active = ativo;
    let i = 0;
    while (i < this.componentes.length) { this.componentes[i].netLer(r); i = i + 1; }
  }
}

/// Posição (f32 × 3) e yaw quantizado (u16): 14 bytes.
export class NetworkTransform extends NetComponente {
  t: Transform;

  constructor(t: Transform) {
    super();
    this.t = t;
  }

  netEscrever(w: NetWriter): void {
    w.f32(this.t.px);
    w.f32(this.t.py);
    w.f32(this.t.pz);
    w.angulo(this.t.ry);
  }

  netLer(r: NetReader): void {
    const x = r.f32();
    const y = r.f32();
    const z = r.f32();
    const yaw = r.angulo();
    if (r.erro) return;
    this.t.setPosition(x, y, z);
    this.t.ry = yaw;
  }
}
```

- [ ] **Step 4: Implementar `replication.ts`**

`src/net/replication.ts`:

```ts
// Replicação por snapshot: o servidor manda SPAWN/DESPAWN (confiáveis) e
// SNAPSHOTs (não confiáveis, divididos por orçamento); o cliente cria os
// objetos pela fábrica do jogo e aplica o estado.
import { Scene } from "@engine/core/scene";
import { NetServidor } from "./server";
import { NetCliente } from "./client";
import { NetWriter, NetReader } from "./buffer";
import { NetworkObject } from "./components";
import { NET_MTU, NET_MSG_SPAWN, NET_MSG_DESPAWN, NET_MSG_SNAPSHOT, NET_ORCAMENTO_SNAPSHOT, NET_MAX_NETID } from "./config";

export class NetFabrica {
  criar(tipo: number, netId: number, dono: number): NetworkObject | null { return null; }
}

export class NetReplicacaoServidor {
  srv: NetServidor;
  objetos: NetworkObject[];
  proximoId: number;
  w: NetWriter;
  wObj: NetWriter;

  constructor(srv: NetServidor) {
    this.srv = srv;
    this.objetos = [];
    this.proximoId = 1;
    this.w = new NetWriter(NET_MTU);
    this.wObj = new NetWriter(NET_MTU);
  }

  /// Dá um netId (monotônico, sem reuso no subprojeto A) e avisa todos. -1 = esgotou.
  spawn(no: NetworkObject): number {
    if (this.proximoId > NET_MAX_NETID) return -1;
    no.netId = this.proximoId;
    this.proximoId = this.proximoId + 1;
    this.objetos.push(no);
    this.montarSpawn(no);
    this.srv.enviarConfiavelTodos(this.w.buf, this.w.pos);
    return no.netId;
  }

  montarSpawn(no: NetworkObject): void {
    const w = this.w;
    w.reiniciar();
    w.u8(NET_MSG_SPAWN);
    w.u16(no.netId);
    w.u16(no.tipo);
    w.u8(no.dono);
    no.escreverEstado(w);
  }

  despawn(no: NetworkObject): void {
    const i = this.objetos.indexOf(no);
    if (i < 0) return;
    this.objetos.splice(i, 1);
    const w = this.w;
    w.reiniciar();
    w.u8(NET_MSG_DESPAWN);
    w.u16(no.netId);
    this.srv.enviarConfiavelTodos(w.buf, w.pos);
  }

  aoConectar(c: number): void {
    let i = 0;
    while (i < this.objetos.length) {
      this.montarSpawn(this.objetos[i]);
      this.srv.enviarConfiavel(c, this.w.buf, this.w.pos);
      i = i + 1;
    }
  }

  enviarSnapshot(tick: number): void {
    const w = this.w;
    const wo = this.wObj;
    w.reiniciar();
    w.u8(NET_MSG_SNAPSHOT);
    w.u32(tick);
    let posN = w.pos;
    w.u16(0);
    let n = 0;
    let i = 0;
    while (i < this.objetos.length) {
      const o = this.objetos[i];
      wo.reiniciar();
      wo.u16(o.netId);
      o.escreverEstado(wo);
      if (n > 0 && w.pos + wo.pos > NET_ORCAMENTO_SNAPSHOT) {
        w.u16Em(posN, n);
        this.srv.enviarNaoConfiavelTodos(w.buf, w.pos);
        w.reiniciar();
        w.u8(NET_MSG_SNAPSHOT);
        w.u32(tick);
        posN = w.pos;
        w.u16(0);
        n = 0;
      }
      w.bytes(wo.buf, wo.pos);
      n = n + 1;
      i = i + 1;
    }
    if (n > 0) {
      w.u16Em(posN, n);
      this.srv.enviarNaoConfiavelTodos(w.buf, w.pos);
    }
  }
}

export class NetReplicacaoCliente {
  cli: NetCliente;
  scene: Scene;
  fab: NetFabrica;
  porId: (NetworkObject | null)[];
  objetos: NetworkObject[];
  r: NetReader;
  msg: Uint8Array;
  ultimoTick: number;

  constructor(cli: NetCliente, scene: Scene, fab: NetFabrica) {
    this.cli = cli;
    this.scene = scene;
    this.fab = fab;
    this.porId = [];
    let i = 0;
    while (i <= NET_MAX_NETID) { this.porId.push(null); i = i + 1; }
    this.objetos = [];
    this.r = new NetReader(NET_MTU);
    this.msg = new Uint8Array(NET_MTU);
    this.ultimoTick = 0;
  }

  porNetId(id: number): NetworkObject | null {
    if (id < 0 || id > NET_MAX_NETID) return null;
    return this.porId[id];
  }

  porDono(dono: number): NetworkObject | null {
    let i = 0;
    while (i < this.objetos.length) {
      if (this.objetos[i].dono === dono) return this.objetos[i];
      i = i + 1;
    }
    return null;
  }

  processar(): void {
    let n = this.cli.mensagens.tirar(this.msg);
    while (n > 0) { this.processarConfiavel(n); n = this.cli.mensagens.tirar(this.msg); }
    n = this.cli.instantaneos.tirar(this.msg);
    while (n > 0) { this.processarSnapshot(n); n = this.cli.instantaneos.tirar(this.msg); }
  }

  processarConfiavel(n: number): void {
    const r = this.r;
    r.abrir(this.msg, 0, n);
    const tipoMsg = r.u8();
    if (tipoMsg === NET_MSG_SPAWN) {
      const netId = r.u16();
      const tipo = r.u16();
      const dono = r.u8();
      if (r.erro || this.porId[netId] !== null) return;
      const no = this.fab.criar(tipo, netId, dono);
      if (no === null || no.go === null) return;
      no.netId = netId;
      no.lerEstado(r);
      this.scene.add(no.go);
      this.porId[netId] = no;
      this.objetos.push(no);
    } else if (tipoMsg === NET_MSG_DESPAWN) {
      const netId = r.u16();
      const no = this.porNetId(netId);
      if (no === null) return;
      if (no.go !== null) {
        const idx = this.scene.objects.indexOf(no.go);
        if (idx >= 0) this.scene.removeAt(idx);
      }
      this.porId[netId] = null;
      const k = this.objetos.indexOf(no);
      if (k >= 0) this.objetos.splice(k, 1);
    }
  }

  processarSnapshot(n: number): void {
    const r = this.r;
    r.abrir(this.msg, 0, n);
    if (r.u8() !== NET_MSG_SNAPSHOT) return;
    const tick = r.u32();
    if (tick < this.ultimoTick) return;      // chegou atrasado: um mais novo já foi aplicado
    this.ultimoTick = tick;
    const k = r.u16();
    let i = 0;
    while (i < k && !r.erro) {
      const netId = r.u16();
      const no = this.porNetId(netId);
      if (no === null) return;               // ainda sem SPAWN: tamanho desconhecido, descarta o resto
      no.lerEstado(r);
      i = i + 1;
    }
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/net-replicacao.ts`
Expected: 9 `[OK]` e `[PASSOU] net-replicacao`. Rode também os 4 testes `net-*` anteriores.

- [ ] **Step 6: Commit**

```bash
git add src/net/components.ts src/net/replication.ts tests/net-replicacao.ts
git commit -m "feat(net): NetworkObject, NetworkTransform e replicação por snapshot"
```

---

### Tarefa 6: FPS em rede sem janela (servidor e cliente testáveis)

**Files:**
- Modify: `src/shared/config.ts`, `src/shared/input.ts`, `src/shared/world.ts`
- Create: `src/servidor_jogo.ts`, `src/cliente_rede.ts`
- Test: `tests/fps-world.ts` (novos casos), `tests/net-fps.ts`

**Interfaces:**
- Consumes: Tarefas 1–5; `FpsWorld`, `fpsGerarMapa`, `FpsPlayerInput`.
- Produces:
  - `FPS_NET_TIPO_JOGADOR = 1`, `FPS_PORTA_PADRAO = 27015`, `FPS_MAX_CLIENTES = 16` (em `shared/config.ts`);
  - `FPS_TAM_INPUT_REDE = 7`, `fpsEscreverInput(w: NetWriter, inp: FpsPlayerInput): void`, `fpsLerInput(r: NetReader, inp: FpsPlayerInput): void`;
  - `FpsWorld.ocupado: boolean[]`, `FpsWorld.liberarJogador(i: number): void`, `FpsWorld.ocuparJogador(ehBot: boolean): number`;
  - `class FpsServidorJogo { constructor(t: NetTransport, semente: number, escala: f64, bots: number); passo(agora: f64); mundo: FpsWorld; srv: NetServidor; jogadorDoCliente: number[]; ultMsRede: f64 }`;
  - `class FpsClienteRede { constructor(t: NetTransport, servidor: number, agora: f64); passo(agora: f64, inp: FpsPlayerInput); conectado(): boolean; meuObjeto(): NetworkObject | null; scene: Scene; cli: NetCliente; rep: NetReplicacaoCliente; mapa: FpsMapa | null }`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/fps-world.ts`, antes da linha final `if (falhas === 0) ...`, acrescente:

```ts
// 5. vagas de jogador: liberar e ocupar de novo (para clientes de rede)
{
  const w = new FpsWorld(new Scene("vagas"), 21, 0.0);
  w.adicionarJogador(false);
  w.adicionarJogador(false);
  w.liberarJogador(1);
  let t = 0;
  while (t < 300) { w.passo([]); t = t + 1; }
  check("vaga liberada fica fora do jogo e não renasce",
        !w.ocupado[1] && !w.jogadores[1].vivo && w.corpos[1].active === 0);
  const i = w.ocuparJogador(false);
  check("ocupar reaproveita a vaga livre e renasce", i === 1 && w.ocupado[1] && w.jogadores[1].vivo &&
        w.jogadores.length === 2);
  check("sem vaga livre, ocupar cria um jogador novo", w.ocuparJogador(true) === 2 && w.jogadores.length === 3);
}
```

`tests/net-fps.ts`:

```ts
// FPS em rede sem janela: servidor + 16 clientes em memória. Critérios 2, 4, 5
// e 6 da spec do subprojeto A.
import io from "@compat/io.ts";
import { NetRedeMemoria } from "../src/net/transport";
import { NetWriter, NetReader } from "../src/net/buffer";
import { FpsServidorJogo } from "../src/servidor_jogo";
import { FpsClienteRede } from "../src/cliente_rede";
import { FpsPlayerInput, fpsInputVazio, fpsEscreverInput, fpsLerInput, FPS_TAM_INPUT_REDE } from "../src/shared/input";
import { FPS_TICK_DT, FPS_ALTURA_CORPO } from "../src/shared/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

io.print("=== net-fps ===");

// input em 7 bytes, ida e volta
{
  const a = fpsInputVazio();
  a.frente = -1; a.lado = 1; a.pulo = true; a.atirar = true; a.granada = true; a.yaw = 2.5; a.pitch = -0.7;
  const w = new NetWriter(16);
  fpsEscreverInput(w, a);
  const r = new NetReader(16);
  r.abrir(w.buf, 0, w.pos);
  const b = fpsInputVazio();
  fpsLerInput(r, b);
  check("input em 7 bytes, ida e volta", w.pos === FPS_TAM_INPUT_REDE && b.frente === -1 && b.lado === 1 &&
        b.pulo && b.atirar && !b.recarregar && b.granada && Math.abs(b.yaw - 2.5) < 0.0002 &&
        Math.abs(b.pitch + 0.7) < 0.0002);
}

const CLIENTES = 16;
const rede = new NetRedeMemoria(0.0, 1, 3);
const tS = rede.criarPonta();
const jogo = new FpsServidorJogo(tS, 77, 0.0, 0);
const clis: FpsClienteRede[] = [];
const inps: FpsPlayerInput[] = [];
const ativos: boolean[] = [];
let k = 0;
while (k < CLIENTES) {
  clis.push(new FpsClienteRede(rede.criarPonta(), tS.endereco, 0.0));
  const inp = fpsInputVazio();
  inp.frente = 1;
  inp.yaw = k * 0.39;
  inps.push(inp);
  ativos.push(true);
  k = k + 1;
}

let tick = 0;
const msRede: f64[] = [];
function rodar(ticks: number): void {
  let t = 0;
  while (t < ticks) {
    const agora = tick * FPS_TICK_DT;
    let c = 0;
    while (c < CLIENTES) { if (ativos[c]) clis[c].passo(agora, inps[c]); c = c + 1; }
    rede.avancar();
    jogo.passo(agora);
    rede.avancar();
    msRede.push(jogo.ultMsRede);
    tick = tick + 1;
    t = t + 1;
  }
}

rodar(60);
const inicioX: f64[] = [];
const inicioZ: f64[] = [];
k = 0;
while (k < CLIENTES) {
  const eu = clis[k].meuObjeto();
  inicioX.push(eu !== null && eu.go !== null ? eu.go.transform.px : 0.0);
  inicioZ.push(eu !== null && eu.go !== null ? eu.go.transform.pz : 0.0);
  k = k + 1;
}
const bytesAntes = tS.bytesEnviados;
rodar(60);
const kbPorCliente = (tS.bytesEnviados - bytesAntes) / CLIENTES / 1024.0;

let conectados = 0;
let veemTodos = 0;
let andaramCerto = 0;
k = 0;
while (k < CLIENTES) {
  if (clis[k].conectado()) conectados = conectados + 1;
  if (clis[k].rep.objetos.length === CLIENTES) veemTodos = veemTodos + 1;
  const eu = clis[k].meuObjeto();
  if (eu !== null && eu.go !== null) {
    const dx = eu.go.transform.px - inicioX[k];
    const dz = eu.go.transform.pz - inicioZ[k];
    const ao = dx * Math.sin(inps[k].yaw) + dz * Math.cos(inps[k].yaw);
    if (ao > 4.0) andaramCerto = andaramCerto + 1;
  }
  k = k + 1;
}
check("16 clientes conectados e cada um vê os 16 jogadores", conectados === CLIENTES && veemTodos === CLIENTES,
      "conectados=" + conectados + " veemTodos=" + veemTodos);
check("o input de cada cliente move o jogador dele na direção da mira", andaramCerto === CLIENTES,
      "certos=" + andaramCerto);

let pior = 0.0;
k = 0;
while (k < CLIENTES) {
  const i = jogo.jogadorDoCliente[k];
  const p = jogo.mundo.jogadores[i];
  const visto = clis[0].rep.porDono(k);
  if (visto !== null && visto.go !== null) {
    const dx = visto.go.transform.px - p.x;
    const dy = visto.go.transform.py - (p.y + FPS_ALTURA_CORPO * 0.5);
    const dz = visto.go.transform.pz - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > pior) pior = d;
  } else pior = 1.0e9;
  k = k + 1;
}
check("o cliente 0 vê todos a no máximo 4 snapshots de atraso (≤ 1,0 u)", pior <= 1.0, "pior=" + pior);

const ultimos = msRede.slice(msRede.length - 60);
ultimos.sort((x: f64, y: f64) => x - y);
const medianaRede = ultimos[30];
io.print("  banda: " + kbPorCliente.toFixed(2) + " KB/s por cliente | rede no tick: mediana " + medianaRede.toFixed(3) + " ms");
check("banda ≤ 30 KB/s por cliente", kbPorCliente <= 30.0, "kb=" + kbPorCliente);
check("rede ≤ 0,5 ms no tick com 16 clientes (mediana)", medianaRede <= 0.5, "ms=" + medianaRede);

// cliente 3 some: em 5 s sai do mundo de todos
ativos[3] = false;
rodar(330);
check("cliente em silêncio sai do servidor e do mundo dos outros",
      jogo.jogadorDoCliente[3] === -1 && clis[0].rep.objetos.length === CLIENTES - 1,
      "jogador=" + jogo.jogadorDoCliente[3] + " objetos=" + clis[0].rep.objetos.length);

if (falhas === 0) io.print("[PASSOU] net-fps"); else io.print("[FALHOU] net-fps: " + falhas + " falha(s)");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `../rts/target/release/rts.exe run tests/fps-world.ts`
Expected: FAIL: `w.liberarJogador is not a function`.

Run: `../rts/target/release/rts.exe run tests/net-fps.ts`
Expected: FAIL: módulo `../src/servidor_jogo` não encontrado.

- [ ] **Step 3: Constantes e input em rede**

Em `src/shared/config.ts`, acrescente ao fim:

```ts

// ── rede ───────────────────────────────────────────────────────────────────
export const FPS_NET_TIPO_JOGADOR = 1;
export const FPS_PORTA_PADRAO = 27015;
export const FPS_MAX_CLIENTES = 16;
export const FPS_ESCALA_PITCH_REDE: f64 = 20000.0;   // pitch em i16: ±1,45 rad cabe
```

Em `src/shared/input.ts`, acrescente o import no topo e as funções ao fim:

```ts
import { NetWriter, NetReader } from "../net/buffer";
import { FPS_ESCALA_PITCH_REDE } from "./config";
```

```ts

/// Formato de rede do input: 7 bytes (frente+1, lado+1, bits, yaw u16, pitch i16).
export const FPS_TAM_INPUT_REDE = 7;
const FPS_BIT_PULO = 1;
const FPS_BIT_ATIRAR = 2;
const FPS_BIT_RECARREGAR = 4;
const FPS_BIT_GRANADA = 8;

export function fpsEscreverInput(w: NetWriter, inp: FpsPlayerInput): void {
  w.u8(inp.frente + 1);
  w.u8(inp.lado + 1);
  let bits = 0;
  if (inp.pulo) bits = bits | FPS_BIT_PULO;
  if (inp.atirar) bits = bits | FPS_BIT_ATIRAR;
  if (inp.recarregar) bits = bits | FPS_BIT_RECARREGAR;
  if (inp.granada) bits = bits | FPS_BIT_GRANADA;
  w.u8(bits);
  w.angulo(inp.yaw);
  w.i16(Math.round(inp.pitch * FPS_ESCALA_PITCH_REDE));
}

export function fpsLerInput(r: NetReader, inp: FpsPlayerInput): void {
  const frente = r.u8() - 1;
  const lado = r.u8() - 1;
  const bits = r.u8();
  const yaw = r.angulo();
  const pitch = r.i16() / FPS_ESCALA_PITCH_REDE;
  if (r.erro) return;
  inp.frente = frente < -1 ? -1 : (frente > 1 ? 1 : frente);
  inp.lado = lado < -1 ? -1 : (lado > 1 ? 1 : lado);
  inp.pulo = (bits & FPS_BIT_PULO) !== 0;
  inp.atirar = (bits & FPS_BIT_ATIRAR) !== 0;
  inp.recarregar = (bits & FPS_BIT_RECARREGAR) !== 0;
  inp.granada = (bits & FPS_BIT_GRANADA) !== 0;
  inp.yaw = yaw;
  inp.pitch = pitch;
}
```

Nota de ângulo: `fpsLerInput` devolve o yaw em [0, 2π). O `FpsWorld` usa `sin`/`cos`, então a faixa não muda nada; o teste compara `2.5` (dentro da faixa).

- [ ] **Step 4: Vagas de jogador no `FpsWorld`**

Em `src/shared/world.ts`:
1. campo novo, logo depois de `bots: FpsBotState[];`: `  ocupado: boolean[];`
2. no construtor, logo depois de `this.bots = [];`: `    this.ocupado = [];`
3. em `adicionarJogador`, logo depois de `this.inputsTick.push(this.inputNulo);`: `    this.ocupado.push(true);`
4. em `removerUltimoBot`, logo depois de `this.inputsTick.pop();`: `    this.ocupado.pop();`
5. no passo 3 de `passo` (renascimentos), troque `      if (!p.vivo) {` por `      if (!p.vivo && this.ocupado[i]) {`
6. métodos novos, logo antes de `indicePorCorpo(`:

```ts
  /// Tira o jogador i do jogo (cliente que saiu): fica morto e sem renascer
  /// até alguém ocupar a vaga.
  liberarJogador(i: number): void {
    this.ocupado[i] = false;
    const p = this.jogadores[i];
    p.vivo = false;
    p.vida = 0.0;
    p.tempoRenascer = 0.0;
    this.corpos[i].active = 0;
    let k = 0;
    while (k < FPS_POOL_GRANADAS) { if (this.grDono[k] === i) this.grDono[k] = -1; k = k + 1; }
    this.sincronizarCorpos();
  }

  /// Reaproveita a primeira vaga livre (ou cria um jogador) e o faz nascer.
  ocuparJogador(ehBot: boolean): number {
    let i = 0;
    while (i < this.jogadores.length) {
      if (!this.ocupado[i]) {
        this.ocupado[i] = true;
        this.ehBot[i] = ehBot;
        this.bots[i] = fpsNovoBot(i);
        const p = this.jogadores[i];
        p.abates = 0;
        p.mortes = 0;
        p.granadasVivas = 0;
        p.tempoGranada = 0.0;
        this.renascer(i);
        this.sincronizarCorpos();
        return i;
      }
      i = i + 1;
    }
    return this.adicionarJogador(ehBot);
  }

```

- [ ] **Step 5: `src/servidor_jogo.ts`**

```ts
// Servidor do FPS sem janela: FpsWorld + NetServidor + replicação. Cada
// cliente que conecta ocupa uma vaga de jogador; o corpo dele ganha
// NetworkObject + NetworkTransform. server.ts só faz o laço com UDP.
import { Scene } from "@engine/core/scene";
import { NetTransport } from "./net/transport";
import { NetServidor } from "./net/server";
import { NetReplicacaoServidor } from "./net/replication";
import { NetworkObject, NetworkTransform } from "./net/components";
import { NetWriter, NetReader } from "./net/buffer";
import { NET_MAX_TAM_INPUT, NET_TAXA_SNAPSHOT, NET_DONO_SERVIDOR } from "./net/config";
import { FpsWorld } from "./shared/world";
import { FpsPlayerInput, fpsInputVazio, fpsLerInput } from "./shared/input";
import { FPS_TICK_DT, FPS_NET_TIPO_JOGADOR, FPS_MAX_CLIENTES } from "./shared/config";

export class FpsServidorJogo {
  scene: Scene;
  mundo: FpsWorld;
  srv: NetServidor;
  rep: NetReplicacaoServidor;
  jogadorDoCliente: number[];
  redeDoJogador: (NetworkObject | null)[];
  inputs: FpsPlayerInput[];
  bufInput: Uint8Array;
  rIn: NetReader;
  tick: number;
  ticksPorSnapshot: number;
  ultMsRede: f64;

  constructor(t: NetTransport, semente: number, escala: f64, bots: number) {
    this.scene = new Scene("servidor");
    this.mundo = new FpsWorld(this.scene, semente, escala);
    const taxaTick = Math.round(1.0 / FPS_TICK_DT);
    this.srv = new NetServidor(t, FPS_MAX_CLIENTES, taxaTick);
    const w = new NetWriter(16);
    w.u32(semente);
    w.f32(escala);
    this.srv.definirBoasVindas(w.buf, w.pos);
    this.rep = new NetReplicacaoServidor(this.srv);
    this.jogadorDoCliente = [];
    let c = 0;
    while (c < FPS_MAX_CLIENTES) { this.jogadorDoCliente.push(-1); c = c + 1; }
    this.redeDoJogador = [];
    this.inputs = [];
    this.bufInput = new Uint8Array(NET_MAX_TAM_INPUT);
    this.rIn = new NetReader(NET_MAX_TAM_INPUT);
    this.tick = 0;
    this.ticksPorSnapshot = Math.max(1, Math.round(taxaTick / NET_TAXA_SNAPSHOT));
    this.ultMsRede = 0.0;
    let b = 0;
    while (b < bots) {
      const i = this.mundo.ocuparJogador(true);
      this.garantirVagas();
      this.replicarJogador(i, NET_DONO_SERVIDOR);
      b = b + 1;
    }
  }

  garantirVagas(): void {
    while (this.inputs.length < this.mundo.jogadores.length) {
      this.inputs.push(fpsInputVazio());
      this.redeDoJogador.push(null);
    }
  }

  replicarJogador(i: number, dono: number): void {
    const corpo = this.mundo.corpos[i];
    const no = new NetworkObject(FPS_NET_TIPO_JOGADOR, dono);
    no.go = corpo;
    no.adicionar(new NetworkTransform(corpo.transform));
    corpo.addBehavior(no);
    this.rep.spawn(no);
    this.redeDoJogador[i] = no;
  }

  pararReplicacao(i: number): void {
    const no = this.redeDoJogador[i];
    if (no === null) return;
    this.rep.despawn(no);
    const corpo = this.mundo.corpos[i];
    const k = corpo.behaviors.indexOf(no);
    if (k >= 0) corpo.behaviors.splice(k, 1);
    this.redeDoJogador[i] = null;
  }

  passo(agora: f64): void {
    const t0 = performance.now();
    this.srv.receber(agora);
    this.srv.verificarTempo(agora);
    let c = this.srv.proximoNovo();
    while (c >= 0) {
      const i = this.mundo.ocuparJogador(false);
      this.garantirVagas();
      this.jogadorDoCliente[c] = i;
      this.rep.aoConectar(c);
      this.replicarJogador(i, c);
      c = this.srv.proximoNovo();
    }
    c = this.srv.proximoSaido();
    while (c >= 0) {
      const i = this.jogadorDoCliente[c];
      if (i >= 0) {
        this.pararReplicacao(i);
        this.mundo.liberarJogador(i);
        this.inputs[i] = fpsInputVazio();
      }
      this.jogadorDoCliente[c] = -1;
      c = this.srv.proximoSaido();
    }
    c = 0;
    while (c < FPS_MAX_CLIENTES) {
      const i = this.jogadorDoCliente[c];
      if (i >= 0) {
        const n = this.srv.proximoInput(c, this.bufInput);
        if (n > 0) {
          this.rIn.abrir(this.bufInput, 0, n);
          fpsLerInput(this.rIn, this.inputs[i]);
        }
      }
      c = c + 1;
    }
    const t1 = performance.now();
    this.mundo.passo(this.inputs);
    const t2 = performance.now();
    this.tick = this.tick + 1;
    this.srv.tick = this.tick;
    if (this.tick % this.ticksPorSnapshot === 0) {
      this.rep.enviarSnapshot(this.tick);
      this.srv.enviar(agora);
    }
    this.ultMsRede = (t1 - t0) + (performance.now() - t2);
  }
}
```

- [ ] **Step 6: `src/cliente_rede.ts`**

```ts
// Cliente do FPS sem janela: conecta, gera o mapa pela semente do BEMVINDO,
// cria os jogadores remotos pela fábrica e manda o input a cada tick.
// client_rede.ts só adiciona janela, entrada e desenho.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { NetTransport } from "./net/transport";
import { NetCliente } from "./net/client";
import { NetFabrica, NetReplicacaoCliente } from "./net/replication";
import { NetworkObject, NetworkTransform } from "./net/components";
import { NetWriter, NetReader } from "./net/buffer";
import { NET_ESTADO_CONECTADO } from "./net/config";
import { FpsPlayerInput, fpsEscreverInput, FPS_TAM_INPUT_REDE } from "./shared/input";
import { FpsMapa, fpsGerarMapa } from "./shared/map";
import { FPS_NET_TIPO_JOGADOR, FPS_MEIA_LARGURA_CAIXA, FPS_ALTURA_CORPO } from "./shared/config";
import { FPS_CAMADA_JOGADOR } from "./shared/layers";

export class FpsFabricaRede extends NetFabrica {
  criar(tipo: number, netId: number, dono: number): NetworkObject | null {
    if (tipo !== FPS_NET_TIPO_JOGADOR) return null;
    const go = new GameObject("remoto" + netId);
    go.setMesh(1, 200, 120, 60);
    go.transform.sx = FPS_MEIA_LARGURA_CAIXA * 2.0;
    go.transform.sy = FPS_ALTURA_CORPO;
    go.transform.sz = FPS_MEIA_LARGURA_CAIXA * 2.0;
    go.layer = FPS_CAMADA_JOGADOR;
    const no = new NetworkObject(tipo, dono);
    no.go = go;
    no.adicionar(new NetworkTransform(go.transform));
    go.addBehavior(no);
    return no;
  }
}

export class FpsClienteRede {
  scene: Scene;
  cli: NetCliente;
  rep: NetReplicacaoCliente;
  mapa: FpsMapa | null;
  seqInput: number;
  w: NetWriter;

  constructor(t: NetTransport, servidor: number, agora: f64) {
    this.scene = new Scene("cliente");
    this.cli = new NetCliente(t);
    this.rep = new NetReplicacaoCliente(this.cli, this.scene, new FpsFabricaRede());
    this.mapa = null;
    this.seqInput = 0;
    this.w = new NetWriter(FPS_TAM_INPUT_REDE + 4);
    this.cli.conectar(servidor, agora);
  }

  conectado(): boolean { return this.cli.estado === NET_ESTADO_CONECTADO; }

  passo(agora: f64, inp: FpsPlayerInput): void {
    this.cli.passo(agora);
    if (this.conectado() && this.mapa === null) {
      const r = new NetReader(16);
      r.abrir(this.cli.boasVindas, 0, this.cli.boasVindasTam);
      const semente = r.u32();
      const escala = r.f32();
      this.mapa = fpsGerarMapa(this.scene, semente, escala);
    }
    if (this.mapa !== null) this.rep.processar();
    if (this.conectado()) {
      this.w.reiniciar();
      fpsEscreverInput(this.w, inp);
      this.cli.enviarInput(this.seqInput, this.w.buf, this.w.pos);
      this.seqInput = (this.seqInput + 1) & 0xFFFF;
      this.cli.enviar(agora);
    }
    this.scene.computeWorld();
  }

  meuObjeto(): NetworkObject | null {
    return this.rep.porDono(this.cli.clienteId);
  }
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `../rts/target/release/rts.exe run tests/fps-world.ts` → Expected: `[PASSOU] fps-world` (11 `[OK]`).
Run: `../rts/target/release/rts.exe run tests/net-fps.ts` → Expected: 7 `[OK]`, a linha `banda: ... | rede no tick: ...` e `[PASSOU] net-fps`.

Rode a suíte inteira (6 `fps-*` e 6 `net-*`): tudo verde. Se banda ou custo passarem da meta, **não afrouxe**: registre quanto falta e por quê (spec §5).

- [ ] **Step 8: Commit**

```bash
git add src/shared/config.ts src/shared/input.ts src/shared/world.ts src/servidor_jogo.ts src/cliente_rede.ts tests/fps-world.ts tests/net-fps.ts
git commit -m "feat(fps): servidor e cliente de rede sem janela, com vagas de jogador e input binário"
```

---

### Tarefa 7: janelas e servidor dedicado com UDP

**Files:**
- Create: `src/entrada.ts`, `src/render.ts`, `src/client_rede.ts`, `src/server.ts`
- Modify: `src/client.ts` (passa a usar `entrada.ts` e `render.ts`, sem mudar comportamento)

**Interfaces:**
- Consumes: Tarefa 6.
- Produces:
  - `class FpsEntrada { inp: FpsPlayerInput; travado: number; yaw: f64; pitch: f64; constructor(yaw: f64); ler(app: any, win: number): void; consumirBordas(): void }` e as constantes `FPS_TECLA_*`;
  - `FPS_FOV`, `fpsPrepararCamera(win, x, y, z, yaw, pitch, aspecto)`, `fpsDesenharCena(win, scene, ignorar: GameObject | null): number`.

- [ ] **Step 1: `src/entrada.ts`**

```ts
// Teclado e mouse → FpsPlayerInput, compartilhado pelos dois clientes.
import input from "rts:input";
import { mouseLock } from "rts:egui";
import { FpsPlayerInput, fpsInputVazio, fpsAcumularBorda } from "./shared/input";
import { FPS_PITCH_MAX } from "./shared/config";

// códigos neutros do rts-egui: A..Z = 100..125, F1..F12 = 140..151
export const FPS_TECLA_A = 100;
export const FPS_TECLA_D = 103;
export const FPS_TECLA_G = 106;
export const FPS_TECLA_M = 112;
export const FPS_TECLA_N = 113;
export const FPS_TECLA_R = 117;
export const FPS_TECLA_S = 118;
export const FPS_TECLA_W = 122;
export const FPS_TECLA_ESC = 2;
export const FPS_TECLA_ESPACO = 3;
export const FPS_TECLA_F3 = 142;
export const FPS_BOTAO_ESQ = 0;
const FPS_SENS_MOUSE: f64 = 0.0025;

export class FpsEntrada {
  inp: FpsPlayerInput;
  travado: number;
  yaw: f64;
  pitch: f64;
  seq: number;

  constructor(yaw: f64) {
    this.inp = fpsInputVazio();
    this.travado = 0;
    this.yaw = yaw;
    this.pitch = 0.0;
    this.seq = 0;
  }

  ler(app: any, win: number): void {
    if (this.travado === 0 && input.mouseClicked(win, FPS_BOTAO_ESQ)) {
      this.travado = 1;
      mouseLock(win, 1);
    } else if (this.travado !== 0 && app.keyPressed(FPS_TECLA_ESC) !== 0) {
      this.travado = 0;
      mouseLock(win, 0);
    }
    if (this.travado !== 0) {
      this.yaw = this.yaw + input.mouseDeltaX(win) * FPS_SENS_MOUSE;
      this.pitch = this.pitch - input.mouseDeltaY(win) * FPS_SENS_MOUSE;
      if (this.pitch > FPS_PITCH_MAX) this.pitch = FPS_PITCH_MAX;
      if (this.pitch < 0.0 - FPS_PITCH_MAX) this.pitch = 0.0 - FPS_PITCH_MAX;
    }
    const inp = this.inp;
    this.seq = this.seq + 1;
    inp.seq = this.seq;
    inp.frente = app.keyDown(FPS_TECLA_W) - app.keyDown(FPS_TECLA_S);
    inp.lado = app.keyDown(FPS_TECLA_D) - app.keyDown(FPS_TECLA_A);
    inp.pulo = app.keyDown(FPS_TECLA_ESPACO) !== 0;
    inp.yaw = this.yaw;
    inp.pitch = this.pitch;
    inp.atirar = this.travado !== 0 && input.mouseDown(win, FPS_BOTAO_ESQ);
    inp.recarregar = fpsAcumularBorda(inp.recarregar, app.keyPressed(FPS_TECLA_R) !== 0);
    inp.granada = fpsAcumularBorda(inp.granada, app.keyPressed(FPS_TECLA_G) !== 0);
  }

  /// Bordas de tecla valem um tick só.
  consumirBordas(): void {
    this.inp.granada = false;
    this.inp.recarregar = false;
  }
}
```

- [ ] **Step 2: `src/render.ts`**

```ts
// Câmera, luz e desenho da cena, compartilhados pelos dois clientes.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";
import { setCam, setLgt, setShadow, drawGPU, frustumBegin, inFrustumFast } from "@engine/render/gpu3d";

export const FPS_FOV: f64 = 1.2;
const FPS_LUZ_X: f64 = 60.0;
const FPS_LUZ_Y: f64 = 120.0;
const FPS_LUZ_Z: f64 = -40.0;
const FPS_LUZ_AMBIENTE: f64 = 0.35;
const FPS_SOMBRA_ALCANCE: f64 = 80.0;
const FPS_FATOR_RAIO_FRUSTUM: f64 = 0.87;

export function fpsPrepararCamera(win: number, x: f64, y: f64, z: f64, yaw: f64, pitch: f64, aspecto: f64): void {
  setCam(win, x, y, z, yaw, pitch, FPS_FOV, aspecto);
  setLgt(win, FPS_LUZ_X, FPS_LUZ_Y, FPS_LUZ_Z, FPS_LUZ_AMBIENTE);
  setShadow(win, 0.0 - FPS_LUZ_X, 0.0 - FPS_LUZ_Y, 0.0 - FPS_LUZ_Z, 0.0, 1.0, 0.0, FPS_SOMBRA_ALCANCE);
  frustumBegin(x, y, z, yaw, pitch, FPS_FOV, aspecto);
}

/// Desenha os objetos ativos visíveis da cena, menos `ignorar`. Devolve quantos.
export function fpsDesenharCena(win: number, scene: Scene, ignorar: GameObject | null): number {
  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;
  let desenhados = 0;
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    if (o.active !== 0 && o !== ignorar) {
      const t: Transform = trs[i];
      let rmax: f64 = t.sx;
      if (t.sy > rmax) rmax = t.sy;
      if (t.sz > rmax) rmax = t.sz;
      if (inFrustumFast(t.wx, t.wy, t.wz, rmax * FPS_FATOR_RAIO_FRUSTUM) !== 0) {
        const col = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
        drawGPU(win, o.meshKind, t.wx, t.wy, t.wz, t.wrx, t.wry, t.sx, t.sy, t.sz, col, o.emissive, o.tex);
        desenhados = desenhados + 1;
      }
    }
    i = i + 1;
  }
  return desenhados;
}
```

- [ ] **Step 3: `src/client.ts` passa a usar os dois**

Aplique estas substituições em `src/client.ts`, sem mudar comportamento:
- **Imports:**
  - remova `import input from "rts:input";` e `import { mouseLock } from "rts:egui";`;
  - troque o import de `@engine/render/gpu3d` por `import { initMeshes, drawGPU, winWidth, winHeight, setVsync } from "@engine/render/gpu3d";`;
  - acrescente `import { FpsEntrada, FPS_TECLA_F3, FPS_TECLA_N, FPS_TECLA_M } from "./entrada";` e `import { fpsPrepararCamera, fpsDesenharCena } from "./render";`;
  - tire `fpsAcumularBorda` e `FPS_PITCH_MAX` dos imports.
- **Constantes:** apague o bloco "teclas" inteiro e as constantes `FPS_FOV`, `FPS_SENS_MOUSE`, `FPS_LUZ_*` e `FPS_SOMBRA_ALCANCE` (passaram para `entrada.ts` e `render.ts`).
- **Variáveis de topo:** troque `const fpsInputs: FpsPlayerInput[] = [fpsInputVazio()];` e as variáveis `fpsYaw`, `fpsPitch`, `fpsTravado`, `fpsSeq` por:

```ts
const fpsEntrada = new FpsEntrada(fpsMundo.jogadores[FPS_HUMANO].yaw);
const fpsInputs: FpsPlayerInput[] = [fpsEntrada.inp];
```

- **Leitura da entrada:** troque o corpo de `fpsLerEntrada` por:

```ts
function fpsLerEntrada(): void {
  fpsEntrada.ler(fpsApp, FPS_WIN);
  if (fpsApp.keyPressed(FPS_TECLA_F3) !== 0) fpsDebug = 1 - fpsDebug;
  if (fpsApp.keyPressed(FPS_TECLA_N) !== 0) fpsMundo.adicionarJogador(true);
  if (fpsApp.keyPressed(FPS_TECLA_M) !== 0) fpsMundo.removerUltimoBot();
}
```

- **Simulação:** em `fpsSimular`, troque as duas linhas `fpsInputs[0].granada = false;` e `fpsInputs[0].recarregar = false;` por `fpsEntrada.consumirBordas();`.
- **Desenho:** troque o corpo de `fpsDesenharMundo` por:

```ts
function fpsDesenharMundo(): void {
  const eu = fpsMundo.jogadores[FPS_HUMANO];
  const camY = eu.vivo ? eu.y + FPS_ALTURA_OLHO : eu.y + FPS_ALTURA_CAMERA_MORTO;
  fpsPrepararCamera(FPS_WIN, eu.x, camY, eu.z, fpsEntrada.yaw, fpsEntrada.pitch, fpsW / fpsH);
  fpsDesenhados = fpsDesenharCena(FPS_WIN, scene, fpsMundo.corpos[FPS_HUMANO]);
  let e = 0;
  while (e < FPS_POOL_EFEITOS) {
    if (fpsMundo.efVida[e] > 0.0) fpsDesenharEfeito(e);
    e = e + 1;
  }
}
```

- **HUD:** troque `fpsTravado === 0` por `fpsEntrada.travado === 0`.

Run: `grep -n "fpsYaw\|fpsPitch\|fpsTravado\|mouseLock\|FPS_TECLA_W" src/client.ts`
Expected: nenhuma linha.

Run: `../rts/target/release/examples/ui_fixture.exe src/client.ts`
Expected: a janela local abre como antes (`[fps] mapa com 2975 estaticos, 12 bots`); mira, tiro, `G`, `F3`, `N`/`M` e `Esc` funcionam. Feche a janela.

- [ ] **Step 4: `src/server.ts`**

```ts
// Servidor dedicado do FPS (sem janela), por UDP.
//   ../rts/target/release/rts.exe run src/server.ts
// Variáveis: FPS_PORTA (padrão 27015), FPS_BOTS_SERVIDOR (padrão 0).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { time } from "rts";
import { NetTransporteUdp } from "./net/transport_udp";
import { FpsServidorJogo } from "./servidor_jogo";
import { FPS_SEMENTE_PADRAO, FPS_TICK_DT, FPS_PORTA_PADRAO, FPS_MAX_CLIENTES } from "./shared/config";

const FPS_INTERVALO_LOG_MS = 5000;
const FPS_ATRASO_MAX_MS = 250;

function fpsEnvNumero(nome: string, padrao: number): number {
  const v = process.env(nome);
  if (v === undefined || v === null || v.length === 0) return padrao;
  const n = parseInt(v, 10);
  return n === n ? n : padrao;
}

const fpsPorta = fpsEnvNumero("FPS_PORTA", FPS_PORTA_PADRAO);
const fpsBots = fpsEnvNumero("FPS_BOTS_SERVIDOR", 0);
const fpsTransporte = new NetTransporteUdp(fpsPorta);
const fpsJogo = new FpsServidorJogo(fpsTransporte, FPS_SEMENTE_PADRAO, 1.0, fpsBots);
io.print("[servidor] porta " + fpsPorta + ", " + fpsBots + " bots, mapa com " + fpsJogo.mundo.mapa.objetos + " estaticos");

const fpsTickMs: f64 = FPS_TICK_DT * 1000.0;
let fpsProximo: f64 = time.now_ms();
let fpsUltimoLog: f64 = fpsProximo;
let fpsBytesLog = fpsTransporte.bytesEnviados;
while (true) {
  const agoraMs: f64 = time.now_ms();
  if (agoraMs >= fpsProximo) {
    fpsJogo.passo(agoraMs / 1000.0);
    fpsProximo = fpsProximo + fpsTickMs;
    if (agoraMs - fpsProximo > FPS_ATRASO_MAX_MS) fpsProximo = agoraMs;
  } else {
    fpsTransporte.bombear();
    time.sleep_ms(1);
  }
  if (agoraMs - fpsUltimoLog >= FPS_INTERVALO_LOG_MS) {
    let clientes = 0;
    let c = 0;
    while (c < FPS_MAX_CLIENTES) { if (fpsJogo.jogadorDoCliente[c] >= 0) clientes = clientes + 1; c = c + 1; }
    const kbs = (fpsTransporte.bytesEnviados - fpsBytesLog) / 1024.0 / ((agoraMs - fpsUltimoLog) / 1000.0);
    io.print("[servidor] clientes " + clientes + " | tick " + fpsJogo.mundo.ultMsTick.toFixed(2) + " ms | rede " +
             fpsJogo.ultMsRede.toFixed(3) + " ms | envio " + kbs.toFixed(1) + " KB/s");
    fpsUltimoLog = agoraMs;
    fpsBytesLog = fpsTransporte.bytesEnviados;
  }
}
```

- [ ] **Step 5: `src/client_rede.ts`**

```ts
// Cliente do FPS conectado a um servidor dedicado (sem predição no subprojeto A).
//   FPS_SERVIDOR=127.0.0.1:27015 ../rts/target/release/examples/ui_fixture.exe src/client_rede.ts
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { createAppAt } from "@compat/app.ts";
import { initMeshes, winWidth, winHeight, setVsync } from "@engine/render/gpu3d";
import { NetTransporteUdp } from "./net/transport_udp";
import { NET_ESTADO_CONECTANDO, NET_ESTADO_CONECTADO, NET_ESTADO_RECUSADO } from "./net/config";
import { FpsClienteRede } from "./cliente_rede";
import { FpsEntrada } from "./entrada";
import { fpsPrepararCamera, fpsDesenharCena } from "./render";
import { FPS_TICK_DT, FPS_MAX_TICKS_POR_FRAME, FPS_ALTURA_OLHO, FPS_ALTURA_CORPO, FPS_PORTA_PADRAO } from "./shared/config";

const FPS_JANELA_MIN = 200;
const FPS_DT_MAX: f64 = 0.25;
const FPS_CAMERA_ESPERA_Y: f64 = 40.0;
const FPS_CAMERA_ESPERA_PITCH: f64 = -0.6;
const FPS_HUD_MARGEM = 14;
const FPS_HUD_LINHA = 20;
const FPS_HUD_TAM = 16;
const FPS_HUD_TAM_MIRA = 20;
const FPS_HUD_MEIA_MIRA_X = 5;
const FPS_HUD_MEIA_MIRA_Y = 11;
const FPS_COR_TEXTO = 0xE8F0FFFF;
const FPS_COR_ALERTA = 0xFF6060FF;
const FPS_COR_MIRA = 0xFFFFFFFF;

function fpsEnderecoServidor(): string {
  const v = process.env("FPS_SERVIDOR");
  if (v === undefined || v === null || v.length === 0) return "127.0.0.1:" + FPS_PORTA_PADRAO;
  return v;
}

const fpsAlvo = fpsEnderecoServidor();
const fpsDoisPontos = fpsAlvo.lastIndexOf(":");
const fpsIp = fpsDoisPontos > 0 ? fpsAlvo.substring(0, fpsDoisPontos) : fpsAlvo;
const fpsPorta = fpsDoisPontos > 0 ? parseInt(fpsAlvo.substring(fpsDoisPontos + 1), 10) : FPS_PORTA_PADRAO;

let fpsW = 1280;
let fpsH = 720;
const fpsApp = createAppAt("rts-fps (rede)", fpsW, fpsH, 80, 60);
const FPS_WIN = fpsApp._win;
initMeshes(FPS_WIN);
setVsync(FPS_WIN, 1);

const fpsTransporte = new NetTransporteUdp(0);
const fpsServidor = fpsTransporte.par(fpsIp, fpsPorta);
let fpsUltimo: f64 = performance.now();
const fpsCliente = new FpsClienteRede(fpsTransporte, fpsServidor, fpsUltimo / 1000.0);
const fpsEntrada = new FpsEntrada(0.0);
let fpsAcumulador: f64 = 0.0;
io.print("[cliente] conectando em " + fpsIp + ":" + fpsPorta);

function fpsQuadro(): void {
  const nw = winWidth(FPS_WIN);
  const nh = winHeight(FPS_WIN);
  if (nw > FPS_JANELA_MIN) fpsW = nw;
  if (nh > FPS_JANELA_MIN) fpsH = nh;
  fpsEntrada.ler(fpsApp, FPS_WIN);

  const agoraMs = performance.now();
  let dt = (agoraMs - fpsUltimo) / 1000.0;
  fpsUltimo = agoraMs;
  if (dt > FPS_DT_MAX) dt = FPS_DT_MAX;
  fpsAcumulador = fpsAcumulador + dt;
  let ticks = 0;
  while (fpsAcumulador >= FPS_TICK_DT && ticks < FPS_MAX_TICKS_POR_FRAME) {
    fpsCliente.passo(agoraMs / 1000.0, fpsEntrada.inp);
    fpsEntrada.consumirBordas();
    fpsAcumulador = fpsAcumulador - FPS_TICK_DT;
    ticks = ticks + 1;
  }
  if (ticks === FPS_MAX_TICKS_POR_FRAME) fpsAcumulador = 0.0;

  const eu = fpsCliente.meuObjeto();
  const aspecto = fpsW / fpsH;
  if (eu !== null && eu.go !== null) {
    const t = eu.go.transform;
    fpsPrepararCamera(FPS_WIN, t.wx, t.wy - FPS_ALTURA_CORPO * 0.5 + FPS_ALTURA_OLHO, t.wz,
                      fpsEntrada.yaw, fpsEntrada.pitch, aspecto);
    fpsDesenharCena(FPS_WIN, fpsCliente.scene, eu.go);
  } else {
    fpsPrepararCamera(FPS_WIN, 0.0, FPS_CAMERA_ESPERA_Y, 0.0, 0.0, FPS_CAMERA_ESPERA_PITCH, aspecto);
    fpsDesenharCena(FPS_WIN, fpsCliente.scene, null);
  }

  fpsApp.text(fpsW / 2 - FPS_HUD_MEIA_MIRA_X, fpsH / 2 - FPS_HUD_MEIA_MIRA_Y, "+", FPS_COR_MIRA, FPS_HUD_TAM_MIRA);
  const cli = fpsCliente.cli;
  let linha = "desconectado do servidor";
  let cor = FPS_COR_ALERTA;
  if (cli.estado === NET_ESTADO_CONECTANDO) { linha = "conectando em " + fpsIp + ":" + fpsPorta + "..."; cor = FPS_COR_TEXTO; }
  else if (cli.estado === NET_ESTADO_RECUSADO) linha = "recusado pelo servidor (motivo " + cli.motivoRecusa + ")";
  else if (cli.estado === NET_ESTADO_CONECTADO) {
    const ping = cli.con !== null ? Math.round(cli.con.rtt * 1000.0) : 0;
    linha = "conectado: jogador " + cli.clienteId + " | ping " + ping + " ms | jogadores " + fpsCliente.rep.objetos.length;
    cor = FPS_COR_TEXTO;
  }
  fpsApp.text(FPS_HUD_MARGEM, FPS_HUD_MARGEM, linha, cor, FPS_HUD_TAM);
  if (fpsEntrada.travado === 0) {
    fpsApp.text(FPS_HUD_MARGEM, FPS_HUD_MARGEM + FPS_HUD_LINHA, "clique para jogar (Esc solta o mouse)", FPS_COR_TEXTO, FPS_HUD_TAM);
  }
  fpsApp.endFrame();
}

while (fpsApp.running()) {
  if (!fpsApp.beginFrame()) break;
  fpsQuadro();
}
fpsCliente.cli.desconectar();
io.print("[cliente] encerrado");
fpsApp.close();
```

- [ ] **Step 6: Verificação manual (critério 1)**

Em três terminais, a partir da raiz:

```
../rts/target/release/rts.exe run src/server.ts
../rts/target/release/examples/ui_fixture.exe src/client_rede.ts
../rts/target/release/examples/ui_fixture.exe src/client_rede.ts
```

Expected:
- servidor imprime `[servidor] porta 27015, 0 bots, mapa com 2975 estaticos` e, a cada 5 s, a linha de status com `clientes 2`;
- cada janela mostra `conectado: jogador N | ping X ms | jogadores 2`;
- andar numa janela move o jogador na outra;
- fechar uma janela: em até 5 s o servidor mostra `clientes 1` e o jogador some da outra.

Anote a linha de status do servidor (tick, rede, KB/s) para a Tarefa 8.

- [ ] **Step 7: Commit**

```bash
git add src/entrada.ts src/render.ts src/client.ts src/client_rede.ts src/server.ts
git commit -m "feat(fps): servidor dedicado UDP e cliente de rede com janela"
```

---

### Tarefa 8: medições, README e issue

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Suíte inteira, saída guardada**

```bash
for t in net-buffer net-transporte net-confiavel net-conexao net-replicacao net-fps fps-map fps-player fps-world fps-weapons fps-determinismo fps-resistencia; do ../rts/target/release/rts.exe run tests/$t.ts 2>&1 | tail -2; done
```

Expected: 12 × `[PASSOU]`. Copie a linha `banda: ... | rede no tick: ...` do `net-fps`.

- [ ] **Step 2: README**

Em `README.md`:
- acrescente uma seção **"Multiplayer (subprojeto A)"** com:
  - os comandos do servidor e dos dois clientes (Tarefa 7, Step 6) e as variáveis `FPS_SERVIDOR`, `FPS_PORTA` e `FPS_BOTS_SERVIDOR`;
  - o que funciona: conectar, ver os outros andando, sair e o jogador sumir;
  - o que ainda não funciona: tiro e placar em rede (B), predição (C) e compensação de lag (D);
- acrescente os números **colados**: a linha do `net-fps` e a linha de status do servidor anotada na Tarefa 7;
- na lista de testes, acrescente os 6 `net-*`.

- [ ] **Step 3: CLAUDE.md**

Na seção "Rede", troque o texto por um resumo do que existe agora:
- `src/net/` genérico (prefixo `Net`, não importa o jogo) e os comandos do servidor e do cliente;
- **tempo por parâmetro** e o **transporte em memória** nos testes.

- [ ] **Step 4: Commit e issue**

```bash
git add README.md CLAUDE.md
git commit -m "docs: multiplayer do subprojeto A (comandos, números medidos)"
```

Comente na issue `UrubuCode/rts-game#11` com os critérios da spec §5, um por um, cada um com o número medido ou a evidência (saída colada). Se algum não fechou, diga quanto falta e por quê.
