// Teste de ALOCAÇÃO de aplicarAmbiente (Task 5). Rodar com RTS_GC_DEBUG=1 e
// contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as coletas antes do
// primeiro marcador são do setup). Portão: 1.000 e 10.000 quadros dão o MESMO
// número por fase (medido: 0 em ambas).
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-ambiente-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-ambiente-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: nada mudou (setSky/setFog não deveriam ser chamados de novo), e o sol
// girando todo quadro (setSky chamado todo quadro; setFog nunca, pois a
// neblina não muda).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { aplicarAmbiente } from "@engine/render/scene_lighting";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));

const sc = new Scene("sonda");
sc.ambiente.ceu.modo = "procedural";
sc.ambiente.neblina.densidade = 0.05;
sc.computeWorld();

// aquece fora das fases (primeiro envio sempre acontece)
aplicarAmbiente(0, sc);

io.print("FASE estavel " + n);
let f = 0;
while (f < n) {
  aplicarAmbiente(0, sc);
  f = f + 1;
}

io.print("FASE sol-girando " + n);
f = 0;
while (f < n) {
  sc.ambiente.ceu.topo[0] = 0.25 + (f % 2) * 0.001;
  aplicarAmbiente(0, sc);
  f = f + 1;
}
io.print("FASE fim");
