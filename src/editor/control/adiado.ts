// RESPOSTAS ADIADAS da porta de controle.
//
// A maioria dos comandos responde na hora (roda entre dois quadros e devolve o
// texto). Alguns só sabem a resposta depois: `shot` espera o processo de
// captura, `input click` espera os quadros em que o clique acontece, `build` e
// `run tests` esperam processos longos. O comando cria um `Adiado`, guarda-o e
// devolve `RESPOSTA_ADIADA`; o servidor (server.ts) segura as linhas seguintes
// DAQUELA conexão até o `Adiado` concluir (ou vencer o prazo), e aí manda a
// resposta. As outras conexões seguem atendidas normalmente.
//
// Custo por quadro: o servidor só olha a lista de esperas quando ela não está
// vazia; sem comando adiado, é um `length > 0`.

/// Marcador devolvido por `execCommand` quando a resposta vem depois.
export const RESPOSTA_ADIADA: string = "[adiado]";

/// `out` é o marcador de resposta adiada?
export function ehRespostaAdiada(out: string): boolean { return out === RESPOSTA_ADIADA; }

export class Adiado {
  pronto: boolean = false;
  texto: string = "";
  /// `Date.now()` a partir do qual o servidor desiste e responde [erro].
  prazo: number = 0;
  comando: string = "";
  /// Chamado 1x por quadro enquanto espera (null = só eventos concluem).
  verificar: any = null;
  /// Descartado (prazo vencido): uma conclusão tardia é ignorada.
  abandonado: boolean = false;
  concluir(texto: string): void {
    if (this.pronto || this.abandonado) return;
    this.texto = texto; this.pronto = true;
  }
}

let recente: Adiado | null = null;

/// Cria a espera do comando que está rodando agora (o servidor a toma logo
/// depois com `tomarAdiado`). `prazoMs` é o limite de espera da resposta.
export function novoAdiado(comando: string, prazoMs: number): Adiado {
  const a = new Adiado();
  a.comando = comando;
  a.prazo = Date.now() + prazoMs;
  recente = a;
  return a;
}

/// A espera criada pelo último comando (e esquece): o servidor (ou um teste)
/// passa a ser o dono dela.
export function tomarAdiado(): Adiado | null {
  const a = recente;
  recente = null;
  return a;
}

/// Um passo da espera: roda `verificar` e aplica o prazo. true = acabou
/// (pronto ou vencido; `texto` tem a resposta).
export function avancarAdiado(a: Adiado): boolean {
  if (!a.pronto && a.verificar !== null) a.verificar();
  if (a.pronto) return true;
  if (Date.now() >= a.prazo) {
    a.abandonado = true;
    a.texto = "[erro] " + a.comando + ": sem resposta dentro do prazo";
    return true;
  }
  return false;
}
