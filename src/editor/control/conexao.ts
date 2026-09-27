// QUEM está mandando o comando: a conexão da porta de controle que o servidor
// está atendendo agora (0 = nenhuma: testes sem servidor, chamada local). O
// estado que um cliente deixa no editor — entrada simulada segurada, lote
// aberto — tem dono, e é desfeito quando esse dono fecha a conexão
// (`aoFecharConexao`), para um cliente que caiu não travar o humano.

let atual = 0;
let proximoId = 1;
const ouvintes: any[] = [];

/// Id novo para uma conexão que chegou.
export function novaConexao(): number { const id = proximoId; proximoId = proximoId + 1; return id; }
/// A conexão cujo comando está rodando (0 = nenhuma).
export function conexaoAtual(): number { return atual; }
export function definirConexaoAtual(id: number): void { atual = id; }
/// Registra `f(id)` para quando uma conexão fechar (uma vez, na carga do módulo).
export function aoFecharConexao(f: any): void { ouvintes.push(f); }
/// A conexão `id` fechou: avisa quem guarda estado dela.
export function conexaoFechou(id: number): void {
  let i = 0;
  while (i < ouvintes.length) { ouvintes[i](id); i = i + 1; }
}
