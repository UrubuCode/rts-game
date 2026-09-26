// Teste de ALOCAÇÃO da coleta e do envio das câmeras por frame (Task 4). Rodar
// com RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as
// coletas antes do primeiro marcador são do setup). Portão: 1.000 e 10.000
// quadros dão o MESMO número por fase.
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-camera-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-camera-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: 3 câmeras (uma "ceu", uma "cor", uma "nada"; tela dividida e uma
// ortográfica) numa cena; `coletarCameras` N vezes; o bloco de render do
// game.ts inteiro (coleta + aplicarVistas + frustumDasVistas + posicaoDaVista)
// N vezes; `Camera.main()` + `Camera.all()` N vezes; e os raios/projeção N vezes.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Camera } from "@engine/core/camera";
import { setActiveScene } from "@engine/core/active_scene";
import { VistasDeCamera, coletarCameras, aplicarVistas, frustumDasVistas,
         posicaoDaVista } from "@engine/render/camera_views";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));

const sc = new Scene("sonda");
setActiveScene(sc);
function camera(nome: string, x: number, fundo: string): Camera {
  const o = sc.createGameObject(nome);
  o.transform.setPosition(x, 1.0, 0.0);
  const c = new Camera(); c.fundo = fundo; o.addBehavior(c);
  return c;
}
const a = camera("A", 0.0, "ceu"); a.viewportW = 0.5;
const b = camera("B", 3.0, "cor"); b.viewportX = 0.5; b.viewportW = 0.5; b.isMain = 0;
const c = camera("C", 6.0, "nada"); c.ortografica = true; c.profundidade = 1.0; c.isMain = 0;
c.viewportX = 0.7; c.viewportY = 0.7; c.viewportW = 0.3; c.viewportH = 0.3;
sc.computeWorld();

const vistas = new VistasDeCamera();
vistas.area[2] = 1280.0; vistas.area[3] = 720.0; vistas.tela[0] = 1280.0; vistas.tela[1] = 720.0;
const fp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const pos = new Float64Array(3);
const raio = new Float64Array(6);
const tela = new Float64Array(3);

// aquece fora das fases
coletarCameras(vistas, sc, null); aplicarVistas(0, vistas); frustumDasVistas(vistas, fp); posicaoDaVista(vistas, pos);
Camera.main(); Camera.all();
a.screenPointToRay(10.0, 10.0, raio); a.worldToScreenPoint(1.0, 1.0, 5.0, tela);

io.print("FASE coletar " + n);
let f = 0;
while (f < n) { vistas.area[2] = 1280.0 + (f & 1); coletarCameras(vistas, sc, null); f = f + 1; }
io.print("FASE render " + n);
f = 0;
while (f < n) {
  coletarCameras(vistas, sc, null); aplicarVistas(0, vistas);
  frustumDasVistas(vistas, fp); posicaoDaVista(vistas, pos);
  f = f + 1;
}
io.print("FASE mainAll " + n);
f = 0;
let soma = 0;
while (f < n) { if (Camera.main() === a) soma = soma + 1; soma = soma + Camera.all().length; f = f + 1; }
io.print("FASE raios " + n);
f = 0;
while (f < n) {
  a.screenPointToRay(f * 0.1, 10.0, raio);
  soma = soma + a.worldToScreenPoint(raio[3], raio[4], 5.0, tela);
  f = f + 1;
}
io.print("FASE fim " + soma);
