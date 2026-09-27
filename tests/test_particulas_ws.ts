// Teste SEM JANELA do comando `particulas` (pacote particulas/): play/stop/
// emit/clear/info por número (vivas, max, tocando, t, bbox) — a IA verifica o
// efeito sem depender da janela (spec §5, Task 10).
//   $RTS run tests/test_particulas_ws.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { history } from "@editor/undo";
import { ParticleSystem } from "@scripts/particlesystem";
import { FORMA_ESFERA } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import "../assets/pacotes/particulas/particulas_comandos";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function cmd(l: string): string { return execCommand(800, 600, l); }

/// Extrai o valor de "chave=..." (delimitado por espaço) de uma linha `info`,
/// sem depender de RegExp (não usado em nenhum outro teste deste repo).
function campo(info: string, chave: string): string {
  const marca = chave + "=";
  const i = info.indexOf(marca);
  if (i < 0) return "";
  let j = i + marca.length;
  let k = j;
  while (k < info.length && info.charAt(k) !== " ") k = k + 1;
  return info.slice(j, k);
}
/// [minx,miny,minz,maxx,maxy,maxz] do sufixo "bbox=(a,b,c)-(d,e,f)".
function bboxDe(info: string): number[] {
  const ini = info.indexOf("bbox=(") + 6;
  const meio = info.indexOf(")-(", ini);
  const fim = info.indexOf(")", meio + 3);
  const minP = info.slice(ini, meio).split(",");
  const maxP = info.slice(meio + 3, fim).split(",");
  return [parseFloat(minP[0]), parseFloat(minP[1]), parseFloat(minP[2]), parseFloat(maxP[0]), parseFloat(maxP[1]), parseFloat(maxP[2])];
}

fixarSementeAleatorio(7);
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];

const fogoGo = scene.createGameObject("Fogo");
const ps = new ParticleSystem();
ps.maxParticles = 500;
ps.forma = FORMA_ESFERA; ps.raio = 3.0;
// Velocidade 0: a partícula fica onde nasceu (na esfera de raio `raio`), sem
// o alcance extra do deslocamento — o bbox esperado é o da própria forma.
ps.startSpeedMin = 0.0; ps.startSpeedMax = 0.0;
ps.startLifetimeMin = 10.0; ps.startLifetimeMax = 10.0;
ps.rateOverTime = 100.0;
ps.playOnAwake = false; // fora do jogo, só `play()`/`particulas play` simula
fogoGo.addBehavior(ps);
scene.computeWorld();

// ── objeto inexistente ──────────────────────────────────────────────────────
check(cmd("particulas Faltante play").indexOf("[erro]") === 0, "objeto inexistente: erro");
check(cmd("particulas Faltante info").indexOf("[erro]") === 0, "info em objeto inexistente: erro");

// ── uso incompleto ───────────────────────────────────────────────────────────
check(cmd("particulas Fogo").indexOf("[erro] particulas: uso") === 0, "uso sem subcomando");

// ── play + 60 quadros ────────────────────────────────────────────────────────
check(cmd("particulas Fogo play").indexOf("[ok]") === 0, "play: ok");
check(ps.isPlaying(), "tocando após play");
// 180 quadros (3s a rateOverTime=100/s -> ~300 vivas) amostram o bastante pro
// bbox chegar perto das bordas da esfera (raio=3), sem encher o pool
// (max=500) — o `emit` abaixo precisa de slot livre para provar que soma.
let f = 0;
while (f < 180) { ps.update(1.0 / 60.0); f = f + 1; }

const info = cmd("particulas Fogo info");
check(info.indexOf("[ok]") === 0, "info: ok");
check(info.indexOf("vivas=") > 0 && info.indexOf("max=500") > 0 && info.indexOf("tocando=1") > 0, "info tem os campos: " + info);
const vivas = parseInt(campo(info, "vivas"));
check(vivas > 0, "vivas cresceu em 60 quadros: " + info);
check(vivas === ps.particleCount, "vivas do comando bate com o componente");

const bbox = bboxDe(info);
const ladoX = bbox[3] - bbox[0]; const ladoY = bbox[4] - bbox[1]; const ladoZ = bbox[5] - bbox[2];
const esperado = 2.0 * ps.raio;
// Tolerância larga (1,0): amostragem uniforme no VOLUME da esfera (não na
// casca), então o lado observado tende a ficar um pouco abaixo de 2*raio
// mesmo com centenas de amostras — o teste confere "aproximadamente cúbico",
// não o raio exato.
check(Math.abs(ladoX - esperado) < 1.0 && Math.abs(ladoY - esperado) < 1.0 && Math.abs(ladoZ - esperado) < 1.0,
  "bbox aproximadamente cúbico de lado 2*raio (" + esperado + "): " + info);

// ── stop ─────────────────────────────────────────────────────────────────────
check(cmd("particulas Fogo stop").indexOf("[ok]") === 0, "stop: ok");
check(!ps.isPlaying(), "parado após stop");

// ── emit ─────────────────────────────────────────────────────────────────────
const vivasAntes = ps.particleCount;
check(cmd("particulas Fogo emit 5").indexOf("[ok]") === 0, "emit: ok");
check(ps.particleCount === vivasAntes + 5, "emit aumenta vivas em 5: " + ps.particleCount + " vs " + (vivasAntes + 5));

// ── clear ────────────────────────────────────────────────────────────────────
check(cmd("particulas Fogo clear").indexOf("[ok]") === 0, "clear: ok");
check(ps.particleCount === 0, "clear zera vivas");
check(campo(cmd("particulas Fogo info"), "vivas") === "0", "info reflete o clear");

io.print("[PASSOU] test_particulas_ws: comando `particulas` play/stop/emit/clear/info");
