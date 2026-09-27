// Teste do fallback de `drawParticlesSeguro` (compat/particles.ts) — roda sem
// janela real (win=0, inválido): confere que a chamada não lança e que o
// binário deste teste (rts.exe sem a Task 1) devolve 0 em todas as chamadas.
//
//   rts.exe run tests/test_particulas_fallback.ts
import { drawParticlesSeguro, temDrawParticles } from "@compat/particles";
import io from "@compat/io.ts";

let ok = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}

const buf = new Float32Array(9);
buf[0] = 1; buf[1] = 2; buf[2] = 3; buf[3] = 1; // x,y,z,tamanho
buf[8] = 1; // alpha

// 5 chamadas seguidas: nenhuma lança, e o resultado é estável (0 quando o
// nativo está ausente — o caso deste binário de teste).
let i = 0;
let resultados = 0;
while (i < 5) {
  resultados = resultados + drawParticlesSeguro(0, buf, 1, 0);
  i = i + 1;
}

check("temDrawParticles() é booleano estável (" + temDrawParticles() + ")", typeof temDrawParticles() === "boolean");
check("sem o nativo, 5 chamadas devolvem soma 0", !temDrawParticles() ? resultados === 0 : true);

io.print("[resultado] " + ok + " ok, " + fail + " falhas (temDrawParticles=" + temDrawParticles() + ")");
if (fail === 0) io.print("[PASSOU] test_particulas_fallback");
else io.print("[FALHOU] test_particulas_fallback");
