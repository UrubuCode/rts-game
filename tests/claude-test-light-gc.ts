// Teste de ALOCAÇÃO de coletarLuzes + aplicarLuzes (Task 3). Rodar com
// RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as
// coletas antes do primeiro marcador são do setup). Portão: 1.000 e 10.000
// quadros dão o MESMO número por fase (medido: 0 em ambas).
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-light-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-light-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: 12 Lights pontuais + 1 direcional com sombra numa cena só;
// `Scene.collectLights` chamado N vezes movendo a câmera, depois
// `aplicarLuzes` (coleta + os três invólucros `set*Buf`) N vezes.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Light, MAX_LUZES, FLOATS_POR_LUZ } from "@engine/core/light";
import { aplicarLuzes } from "@engine/render/scene_lighting";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));

const sc = new Scene("sonda");
let k = 0;
while (k < 12) {
  const o = sc.createGameObject("P" + k);
  o.transform.setPosition(k, 1.0, 0.0);
  const l = new Light(); l.tipo = "pontual"; l.cor = 0x80C0FF; o.addBehavior(l);
  k = k + 1;
}
const sol = sc.createGameObject("Sol");
sol.transform.setPosition(0.0, 10.0, 0.0);
const lsol = new Light(); lsol.tipo = "direcional"; lsol.sombra = true; sol.addBehavior(lsol);
sc.computeWorld();

const buf = new Float64Array(MAX_LUZES * FLOATS_POR_LUZ);
const cam = new Float64Array(3);
const legado = new Float64Array(4);
legado[0] = 7.0; legado[1] = 13.0; legado[2] = 5.0; legado[3] = 0.28;

// aquece fora das fases
sc.collectLights(buf, cam);
aplicarLuzes(0, sc, cam, legado);

io.print("FASE collectLights " + n);
let f = 0;
while (f < n) {
  cam[0] = f * 0.001;
  sc.collectLights(buf, cam);
  f = f + 1;
}
io.print("FASE aplicarLuzes " + n);
f = 0;
while (f < n) {
  cam[0] = f * 0.001;
  aplicarLuzes(0, sc, cam, legado);
  f = f + 1;
}
io.print("FASE fim");
