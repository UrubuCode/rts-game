// O QUE O DECISOR ESCOLHE, em função de n — a régua do débito do modelo n².
//
//   rts.exe run tools/claude-probe-decisor.ts
//
// Existe para ser rodado ANTES e DEPOIS de mexer em `rigidCalibrate`, porque a
// pergunta que importa não é "o modelo ficou coerente" e sim "algum n trocou de
// backend". Um modelo coerente que escolhe pior é pior que um incoerente que
// escolhe bem, e só a tabela por n separa os dois casos — a faixa agregada
// (`rigidBand`) esconde exatamente a informação que decide isso.
//
// Imprime o custo modelado dos dois lados e a escolha, num varrimento de n que
// cobre desde a cena pequena até a grande. A saída é feita para `diff`.
import io from "../compat/io.ts";
import { rigidCalibrate, rigidCpuCostMs, rigidGpuCostMs, rigidBackendFor,
         rigidBand, rigidReport } from "../engine/core/physics_backend";

rigidCalibrate();
rigidReport();
io.print("");
io.print("  n      | cpu (modelo) | gpu (modelo) | escolha");
io.print("---------+--------------+--------------+--------");

// Potências e meios-passos: o interesse está no JOELHO (onde a escolha vira),
// e um passo linear grosso pularia por cima dele.
const NS: number[] = [16, 32, 64, 100, 128, 150, 160, 200, 256, 400, 512, 1000,
                      1024, 2000, 2048, 4000, 4096, 8192, 16384];
let i = 0;
while (i < NS.length) {
  const n = NS[i];
  const c = rigidCpuCostMs(n);
  const g = rigidGpuCostMs(n);
  const b = rigidBackendFor(n);
  io.print("  " + (n + "").padEnd(7) + "|" + c.toFixed(3).padStart(13) +
           " |" + g.toFixed(3).padStart(13) + " | " + (b === 1 ? "gpu" : "cpu"));
  i = i + 1;
}

const faixa = rigidBand();
io.print("");
io.print("  faixa em que a GPU vence: " + faixa[0] + " .. " + faixa[1]);
