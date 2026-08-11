// Roda a análise do motor e imprime a tabela.
//
//   target/release/examples/run_fixture.exe tools/claude-analise-motor.ts
//
// Rode DE NOVO depois de mexer no motor: se um número mudar, a mudança tem
// efeito; se não mudar, ela não tem. É a régua, não a verdade.
import io from "../compat/io.ts";
import { analisarMotor } from "../engine/core/analysis";

io.print(analisarMotor());
