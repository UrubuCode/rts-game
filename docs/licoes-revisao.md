# Lições de revisão (índice espacial e física)

Aprendizados dos PRs #8 e #9, para quem implementar o próximo lote. Leia antes de abrir um PR que mexa em caminhos quentes (consultas, índice espacial, solver).


Estes erros se repetiram ao longo dos PRs #8 e #9. Cada um custou pelo menos uma rodada de revisão.

## 1. O número vem da saída do comando, nunca da memória ou da expectativa
- **Rev. 4 do #8:** "todas as metas batidas", mas só a cena 2 bateu.
- **Rev. 6 do #8:** o "A/B" era texto fixo copiado de relatórios antigos.
- **Rev. 3 do #9:** "~0,34 ms", com o bench imprimindo "0/7".

**Regra:** o relatório cola a saída bruta do bench, rodado **neste commit**. Se um número do texto não aparece na saída, ele não entra. Meta não atingida se escreve assim: "falta X; causa medida: Y" ou "causa não diagnosticada".

## 2. Um tempo sem conferir o resultado não vale nada
- **Overlap que "melhorou" de 36 para 24 µs:** devolvia **0 em vez de 27 ocorrências**.
- **Raycast de 6 µs:** começava dentro de um corpo, distância 0.
- **Raio "que atravessa os dois grids":** acertava um dinâmico, não o chão.
- **Cena sorteada:** era 7× menos densa, e por isso parecia rápida.

**Regra:** todo número de desempenho sai acompanhado do que a consulta devolveu: quantas ocorrências, `bodyId` e distância. Se a otimização muda o resultado, o tempo é inválido. A cena de comparação precisa ter a mesma densidade e a mesma carga da referência.

## 3. Todo cache precisa de uma regra de invalidação escrita
- `sWorldCx` usado para dinâmicos e nunca atualizado.
- Caixa dos dinâmicos calculada só quando a `compVersion` mudava.
- Estático movido sem aviso.
- `markCollidersDirty` deixando de reindexar os estáticos.

**Regra:** para cada cache, escrevam no código três coisas: o que ele guarda, **o que o invalida** e quem chama essa invalidação. Para cada cache, um teste "mudar e consultar de novo".

## 4. Nada de O(N) escondido no caminho quente
- Checagem de estático movido **por consulta** (305 µs por raycast), depois por passo (+72%).
- Filtro de `active` por corpo, a cada passo.
- "Inserção incremental" que ainda varria a cena inteira.

**Regra:** antes de pôr um laço em `ensureIndex`, `rebuildDynamicsInto` ou numa consulta, perguntem quantas vezes ele roda por frame com 20 mil objetos. Prefiram invalidar quando o evento acontece a descobrir a mudança varrendo tudo. Toda mudança nesses caminhos exige A/B.

## 5. Corrijam a família do problema, não a sonda
- **Limiar fixo de 16 u:** resolveu o chão e quebrou os prédios de 30 u.
- **Mediana:** resolveu os prédios e fatiou o chão de 2 km em milhões de células.
- **Teto de 128 u:** funciona até existirem 300 blocos colossais.

**Regra:** diante de um caso patológico, perguntem qual parâmetro gera toda a família (tamanho, contagem, densidade) e testem os extremos: 1 contra 10.000 objetos, 0,1 u contra 4 km. Usem limites **relativos** (à célula, à mediana), não números fixos.

## 6. Tenham um oráculo de força bruta
O teste que comparou 4.800 consultas aleatórias com força bruta, numa cena que muda a cada passo, achou em minutos o que levou revisões para aparecer, e ainda um bug antigo (`maxDistance + 1.0`).

**Regra:** esse teste entra na suíte oficial. Toda otimização do índice precisa passar por ele antes de ser medida.

## 7. Na terceira cópia, extraiam uma função
As 22 cópias da inserção ordenada e os 4 blocos de preenchimento do cache fazem com que cada correção precise ser repetida em vários lugares, e acaba esquecida em algum deles. O motivo da duplicação era desempenho, mas uma função livre de parâmetros tipados é **tão rápida** quanto o código inline neste runtime, e o próprio arquivo já usa esse padrão.

## 8. Estado global e camadas misturadas escondem custos
Um índice único para o processo inteiro significa que duas cenas custam 300×. `Scene` conhecer a fila do índice e `GameObject` guardar o slot do índice deixa os três módulos amarrados. O dono do dado é quem o indexa.

## 9. Higiene de medição
Neste mesmo PC, o mesmo código variou de 11 para 20 µs entre execuções.

**Regra:**
- A/B **alternado** (A, B, A, B) com o mesmo arquivo de bench;
- aquecimento, mediana e o menor/maior valor visíveis;
- não concluir nada de uma execução só;
- teste com tempo limite usa a **cena de referência**. O `< 2 ms` com 50 projéteis não provava nada.

## 10. Não defendam uma limitação com a premissa errada
"Em RTS, 99,9% das unidades…": o rts-game é um **motor genérico**. Uma limitação aceita se registra com o número medido e o caso que a dispara, não com uma suposição sobre o tipo de jogo.

## Checklist antes de pedir revisão
- [ ] Rodei os testes e o bench **neste commit** e colei a saída.
- [ ] Todo número traz o que a consulta devolveu (ocorrências, id, distância).
- [ ] A/B alternado contra o `master` nos caminhos quentes que mexi.
- [ ] O teste contra força bruta passa.
- [ ] Todo cache novo tem a regra de invalidação escrita e o teste "mudar e consultar de novo".
- [ ] Nenhum laço O(N) novo por consulta ou por passo sem medição.
- [ ] Nenhuma cópia nova de lógica que já existe.
- [ ] Toda meta não atingida aparece com quanto falta e por quê.
