// ═══════════════════════════════════════════════════════════════════════════
// ANÁLISE DO MOTOR — quanto custa cada primitiva, medido nesta máquina.
//
// Não é um profiler (esse é `profiler.ts`, e mede ONDE o frame foi gasto). Este
// mede QUANTO CUSTA CADA COISA que o motor oferece, para que uma decisão de
// engenharia deixe de ser palpite.
//
// ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// Numa tarde, três palpites errados sobre onde o tempo ia — e o quarto achado
// foi por acidente: a MESMA aritmética custa 3× mais dentro do corpo de um frame
// do que numa função livre tipada, porque num caso os acessos a campo caem no
// caminho dinâmico de propriedade e no outro viram offset constante.
//
// `engine/core/scene.ts` já sabia disso e escreveu funções livres por causa
// dele. `main.ts` não sabia, e pagou 2,7 ms/frame. Um número que vive num
// comentário de um arquivo não protege o resto do projeto; um módulo que MEDE,
// sim.
//
// ── COMO LER ───────────────────────────────────────────────────────────────
//
// Os números são NANOSSEGUNDOS POR OPERAÇÃO nesta máquina, neste build. Não são
// verdades sobre o motor: são a régua de hoje. Rode de novo depois de mexer no
// motor — se um número mudar, a mudança tem efeito; se não, ela não tem.
//
// `Date.now()` tem 1 ms de resolução, então cada caso roda MUITAS iterações e
// divide. Um caso que custa menos de ~50 ns/op está no limite do que esta régua
// mede, e está marcado.
// ═══════════════════════════════════════════════════════════════════════════

import { GameObject } from "./gameobject";
import { Transform } from "./transform";

/// Uma linha da análise.
export class Medida {
  nome: string;
  nsPorOp: f64;
  nota: string;
  constructor(nome: string, nsPorOp: f64, nota: string) {
    this.nome = nome;
    this.nsPorOp = nsPorOp;
    this.nota = nota;
  }
}

const resultados: Medida[] = [];

function anota(nome: string, ns: f64, nota: string): void {
  resultados.push(new Medida(nome, ns, nota));
}

/// Roda `corpo` `reps` vezes e devolve os nanossegundos por operação.
///
/// `ops` é quantas operações lógicas cada repetição faz — é o que torna os
/// números comparáveis entre casos de tamanhos diferentes.
function cronometrar(reps: number, ops: number, corpo: () => number): f64 {
  // Aquecimento: a primeira passada paga o que for preguiçoso (shape novo,
  // primeira resolução de método), e medir isso junto mistura duas coisas.
  let q = 0;
  for (let i = 0; i < 3; i++) q = q + corpo();
  const t0 = Date.now();
  let acc = 0;
  for (let i = 0; i < reps; i++) acc = acc + corpo();
  const ms = Date.now() - t0;
  // `acc` é usado para que o laço não possa ser considerado morto.
  if (acc === 0x7FFFFFFF) return 0.0 - 1.0;
  return (ms * 1000000.0) / (reps * ops);
}

// ── os casos ───────────────────────────────────────────────────────────────

const N = 500;
let objs: GameObject[] = [];
let trs: Transform[] = [];

function montar(): void {
  const arr: GameObject[] = [];
  for (let i = 0; i < N; i++) {
    const g = new GameObject("a" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition(i * 0.5, 1.0, i * 0.25);
    arr.push(g);
  }
  objs = arr;
  const t: Transform[] = [];
  for (let i = 0; i < N; i++) t.push(arr[i].transform);
  trs = t;
}

/// A MESMA soma, num laço livre tipado. É a linha de base: se algo custar muito
/// mais que isto por operação, a diferença é imposto, não trabalho.
function somaLivre(ts: Transform[], n: number): number {
  let s: f64 = 0.0;
  let i = 0;
  while (i < n) { const t: Transform = ts[i]; s = s + t.wx + t.wy + t.wz; i = i + 1; }
  return s > 0.0 ? 1 : 0;
}

/// A mesma soma escrita FORA de função livre — o caminho que `main.ts` usava.
function medirDinamicoVsLivre(): void {
  const livre = cronometrar(400, N * 3, () => somaLivre(trs, N));
  anota("leitura de campo (funcao livre tipada)", livre, "a linha de base");

  const dinamico = cronometrar(400, N * 3, () => {
    let s: f64 = 0.0;
    let i = 0;
    while (i < N) { const t = trs[i]; s = s + t.wx + t.wy + t.wz; i = i + 1; }
    return s > 0.0 ? 1 : 0;
  });
  anota("leitura de campo (corpo de closure)", dinamico,
        dinamico > livre * 1.5 ? "IMPOSTO: extraia para funcao livre tipada" : "sem diferenca aqui");
}

function medirChamadaDeMetodo(): void {
  const direto = cronometrar(200, N, () => {
    let n = 0; let i = 0;
    while (i < N) { const o: GameObject = objs[i]; if (o.active !== 0) n = n + 1; i = i + 1; }
    return n;
  });
  anota("ler campo de GameObject por indice", direto, "objs[i].active");

  const metodo = cronometrar(200, N, () => {
    let n = 0; let i = 0;
    while (i < N) { const o: GameObject = objs[i]; if (o.transform.sx > 0.0) n = n + 1; i = i + 1; }
    return n;
  });
  anota("campo ANINHADO (o.transform.sx)", metodo,
        metodo > direto * 1.8 ? "cada hop custa: use o espelho `trs[i]`" : "barato");
}

function medirAritmetica(): void {
  const ns = cronometrar(2000, 100, () => {
    let s: f64 = 0.0;
    let i = 0;
    while (i < 100) { s = s + (i * 1.5 - 0.25) * 0.5; i = i + 1; }
    return s > 0.0 ? 1 : 0;
  });
  anota("aritmetica f64 em locais", ns, ns < 50.0 ? "no limite da regua (1 ms)" : "");
}

function medirAlocacao(): void {
  const ns = cronometrar(200, 100, () => {
    let n = 0;
    for (let i = 0; i < 100; i++) { const a: number[] = [1, 2, 3]; n = n + a.length; }
    return n;
  });
  anota("alocar um array de 3", ns, "por objeto criado no frame");
}


// ── travessia para o motor ─────────────────────────────────────────────────
//
// O caso que custou 8,4 ms/frame no editor e que eu levei três tentativas para
// achar. Um `drawMesh` faz DUAS coisas caras que não são desenhar: cria um
// objeto de opções (alocação JS) e o nativo lê 12 campos dele.

function medirObjetoDeOpcoes(): void {
  const ns = cronometrar(200, 100, () => {
    let n = 0;
    for (let i = 0; i < 100; i++) {
      // O mesmo formato que `drawMesh` recebe.
      const o = { mesh: 1, x: 0.0, y: 1.0, z: 2.0, rx: 0.0, ry: 0.0,
                  sx: 1.0, sy: 1.0, sz: 1.0, color: 255, emissive: 0, tex: 0 };
      n = n + (o.mesh | 0);
    }
    return n;
  });
  anota("criar objeto de opcoes de 12 campos", ns,
        "por drawMesh; 500 objetos = 500 destes por frame");
}

// ── despacho polimórfico ───────────────────────────────────────────────────
//
// O `update(dt)` de cada Behavior e o `rMeshKind()` do MeshRenderer passam por
// aqui. Se for caro, um cache por objeto paga; se for barato, cachear é
// complexidade sem retorno.

function medirPolimorfismo(): void {
  const direto = cronometrar(200, N, () => {
    let n = 0; let i = 0;
    while (i < N) { const o: GameObject = objs[i]; n = n + (o.meshKind | 0); i = i + 1; }
    return n;
  });
  anota("ler campo direto (o.meshKind)", direto, "sem despacho");

  const viaBehavior = cronometrar(200, N, () => {
    let n = 0; let i = 0;
    while (i < N) {
      const o: GameObject = objs[i];
      if (o.rendIdx >= 0) { const r = o.behaviors[o.rendIdx]; n = n + (r.rMeshKind() | 0); }
      else n = n + (o.meshKind | 0);
      i = i + 1;
    }
    return n;
  });
  anota("mesmo valor por METODO de Behavior", viaBehavior,
        viaBehavior > direto * 2.0 ? "IMPOSTO: cache o valor no objeto" : "despacho barato");
}

// ── strings ────────────────────────────────────────────────────────────────
//
// Concatenar aloca. Num HUD que escreve texto por frame isso aparece.

function medirStrings(): void {
  const ns = cronometrar(200, 100, () => {
    let n = 0;
    for (let i = 0; i < 100; i++) { const s = "obj " + i + " ok"; n = n + s.length; }
    return n;
  });
  anota("concatenar 3 pedacos de string", ns, "cada texto de HUD por frame");
}

// ── arrays ─────────────────────────────────────────────────────────────────
//
// Array de NÚMEROS e array de OBJETOS podem ter caminhos diferentes: um guarda
// valores, o outro referências que o coletor precisa enxergar.

function medirArrays(): void {
  const nums: f64[] = [];
  for (let i = 0; i < N; i++) nums.push(i * 1.5);
  const lerNum = cronometrar(400, N, () => {
    let s: f64 = 0.0; let i = 0;
    while (i < N) { s = s + nums[i]; i = i + 1; }
    return s > 0.0 ? 1 : 0;
  });
  anota("ler array de numeros", lerNum, "o caminho mais barato que existe");

  const lerObj = cronometrar(400, N, () => {
    let n = 0; let i = 0;
    while (i < N) { const o: GameObject = objs[i]; if (o.active !== 0) n = n + 1; i = i + 1; }
    return n;
  });
  anota("ler array de objetos + 1 campo", lerObj,
        lerObj > lerNum * 3.0 ? "arrays paralelos de numeros valem a pena (SoA)" : "");
}

// ── Math ───────────────────────────────────────────────────────────────────

function medirMath(): void {
  const ns = cronometrar(400, 100, () => {
    let s: f64 = 0.0;
    for (let i = 0; i < 100; i++) s = s + Math.sin(i * 0.01) * Math.cos(i * 0.01);
    return s > 0.0 - 1000.0 ? 1 : 0;
  });
  anota("Math.sin + Math.cos", ns, "por par; hoiste para fora do laco se puder");
}

/// Roda tudo e devolve a tabela pronta para imprimir.
export function analisarMotor(): string {
  resultados.length = 0;
  montar();
  medirDinamicoVsLivre();
  medirChamadaDeMetodo();
  medirAritmetica();
  medirAlocacao();
  medirObjetoDeOpcoes();
  medirPolimorfismo();
  medirStrings();
  medirArrays();
  medirMath();

  let out = "[analise do motor] ns por operacao, nesta maquina, neste build";
  const nl = String.fromCharCode(10);
  let i = 0;
  while (i < resultados.length) {
    const m: Medida = resultados[i];
    out = out + nl + "  " + m.nome.padEnd(42) + m.nsPorOp.toFixed(1).padStart(9) + " ns   " + m.nota;
    i = i + 1;
  }
  return out;
}

/// As medidas cruas, para quem quiser comparar duas execuções em vez de ler.
export function analiseResultados(): Medida[] { return resultados; }
