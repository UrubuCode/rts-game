// Rótulos do editor refeitos só quando o que mostram muda (Task 10.5).
//
// Cada `"fps " + n`, `n + " obj"` ou `icone + " " + nome` montado por quadro é
// uma string nova para o coletor; com ~60 delas por quadro, o GC pausava o
// editor 8–48 ms várias vezes por segundo. Estes caches guardam o último valor
// e o texto dele: a string só é refeita quando o valor muda.

/// `prefixo + n + sufixo`, refeito só quando `n` muda.
export class RotuloNumero {
  prefixo: string; sufixo: string;
  valor: number = 0; texto: string = "";
  constructor(prefixoArg?: string, sufixoArg?: string) {
    this.prefixo = prefixoArg !== undefined ? prefixoArg : "";
    this.sufixo = sufixoArg !== undefined ? sufixoArg : "";
  }
  de(n: number): string {
    if (this.texto.length === 0 || this.valor !== n) { this.valor = n; this.texto = this.prefixo + n + this.sufixo; }
    return this.texto;
  }
}

/// `prefixo + a + b` (prefixo fixo), refeito só quando `a` ou `b` mudam.
export class RotuloPar {
  prefixo: string;
  a: string = ""; b: string = ""; texto: string = ""; pronto: boolean = false;
  constructor(prefixoArg?: string) { this.prefixo = prefixoArg !== undefined ? prefixoArg : ""; }
  de(a: string, b: string): string {
    if (!this.pronto || this.a !== a || this.b !== b) { this.pronto = true; this.a = a; this.b = b; this.texto = this.prefixo + a + b; }
    return this.texto;
  }
}

/// Rótulo de cada linha da Hierarquia ("[C] Nome"), por índice do objeto,
/// refeito só quando o nome ou a malha daquele índice mudam.
export class RotulosDeLinha {
  nomes: string[] = []; tipos: number[] = []; textos: string[] = [];
  de(i: number, icone: string, nome: string, tipo: number): string {
    while (this.textos.length <= i) { this.nomes.push(""); this.tipos.push(0 - 1); this.textos.push(""); }
    if (this.tipos[i] !== tipo || this.nomes[i] !== nome || this.textos[i].length === 0) {
      this.tipos[i] = tipo; this.nomes[i] = nome; this.textos[i] = icone + " " + nome;
    }
    return this.textos[i];
  }
}
