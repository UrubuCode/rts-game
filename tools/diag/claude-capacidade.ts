// Quantas alocações o motor aguenta antes de reciclar um handle VIVO?
// Sem GPU, sem janela: só a tabela de handles.
import io from "rts:io";
import buffer from "rts:buffer";

const vitima = buffer.alloc(1024);
buffer.write_f32(vitima, 0, 424242.0);
io.print("[cap] vitima = " + vitima + " valor = " + buffer.read_f32(vitima, 0));

let i = 0;
let morreu = -1;
while (i < 400000 && morreu < 0) {
  // uma alocação por volta — o mesmo que qualquer chamada que crie um temporário
  const lixo = buffer.alloc(64);
  buffer.write_f32(lixo, 0, 1.0);
  if (i % 1000 === 0) {
    const v = buffer.read_f32(vitima, 0);
    if (v !== 424242.0) {
      morreu = i;
      io.print("[cap] a vitima MORREU apos " + i + " alocacoes: leitura = " + v);
    }
  }
  i = i + 1;
}
io.print(morreu < 0
  ? "[cap] a vitima sobreviveu a " + i + " alocacoes"
  : "[cap] capacidade ~ " + morreu + " alocacoes");
