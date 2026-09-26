// Teste SEM JANELA de `aplicarAmbiente` (Fix round 1 do Task 5): de onde vem a
// direção do sol do céu (SOL_PADRAO / slot 0 de aplicarLuzes / ambiente.sol por
// nome, sem tocar no shadow caster), e o cache de textura do panorama por
// caminho. Chamar SEMPRE depois de aplicarLuzes, como main.ts/game.ts fazem.
//
//   rts.exe run tests/test_aplicar_ambiente.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { Light, LUZ_DIRECIONAL } from "@engine/core/light";
import { aplicarLuzes, aplicarAmbiente, luzesColetadas, sombraAtual } from "@engine/render/scene_lighting";
import { setLogEcho, logCount } from "@engine/core/logger";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
setLogEcho(0);

const cam = new Float64Array(3);
const legado = new Float64Array(4); legado[3] = 0.28;

// 1) sem NENHUM Light: nem aplicarLuzes acha direcional -> SOL_PADRAO fixo.
const s1 = new Scene("sem-luz");
s1.computeWorld();
aplicarLuzes(0, s1, cam, legado);
aplicarAmbiente(0, s1);
const SOL_PADRAO_X = 0.0 - 0.3015113, SOL_PADRAO_Y = 0.0 - 0.9045340, SOL_PADRAO_Z = 0.0 - 0.3015113;
check(s1.ambiente.pacote[10] === SOL_PADRAO_X && s1.ambiente.pacote[11] === SOL_PADRAO_Y && s1.ambiente.pacote[12] === SOL_PADRAO_Z,
  "sem direcional nenhuma: sol do céu cai no SOL_PADRAO");

// 2) uma direcional SEM sombra, ambiente.sol vazio -> cai no slot 0 de aplicarLuzes (luzBuf).
const s2 = new Scene("uma-luz");
const godir = s2.createGameObject("D1");
godir.transform.rx = 0.3; godir.transform.ry = 1.1;
const ldir = new Light(); ldir.tipo = "direcional"; godir.addBehavior(ldir);
s2.computeWorld();
aplicarLuzes(0, s2, cam, legado);
const buf = luzesColetadas();
check(buf[0] === LUZ_DIRECIONAL, "slot 0 é a única direcional");
aplicarAmbiente(0, s2);
check(s2.ambiente.pacote[10] === buf[4] && s2.ambiente.pacote[11] === buf[5] && s2.ambiente.pacote[12] === buf[6],
  "sol do céu = direção do slot 0 (fallback de aplicarLuzes) quando ambiente.sol está vazio");

// 3) DUAS direcionais: "Sombra" com sombra=true, "Sol" sem sombra.
// ambiente.sol = "Sol": o disco do céu segue "Sol", mas o SHADOW CASTER
// continua sendo "Sombra" (slot 0 não é afetado por ambiente.sol — Fix round 1).
const s3 = new Scene("duas-luzes");
const goSombra = s3.createGameObject("Sombra");
goSombra.transform.rx = 0.2; goSombra.transform.ry = 0.4;
const lSombra = new Light(); lSombra.tipo = "direcional"; lSombra.sombra = true; goSombra.addBehavior(lSombra);
const goSol = s3.createGameObject("Sol");
goSol.transform.rx = 0.9; goSol.transform.ry = 2.5;
const lSol = new Light(); lSol.tipo = "direcional"; lSol.sombra = false; goSol.addBehavior(lSol);
s3.ambiente.sol = "Sol";
s3.computeWorld();
aplicarLuzes(0, s3, cam, legado);
const buf3 = luzesColetadas();
check(buf3[0] === LUZ_DIRECIONAL && buf3[14] !== 0.0, "slot 0 é uma direcional com sombra");
// direção esperada de "Sombra" (mesma fórmula de Light.lightPack)
const cp = Math.cos(0.2), sp = Math.sin(0.2), cy = Math.cos(0.4), sy = Math.sin(0.4);
const dirSombraX = sy * cp, dirSombraY = sp, dirSombraZ = cy * cp;
check(Math.abs(buf3[4] - dirSombraX) < 1e-9 && Math.abs(buf3[5] - dirSombraY) < 1e-9 && Math.abs(buf3[6] - dirSombraZ) < 1e-9,
  "slot 0 (sombra) é a direção de 'Sombra', não de 'Sol'");
const sb3 = sombraAtual();
check(Math.abs(sb3[0] - dirSombraX) < 1e-9 && Math.abs(sb3[1] - dirSombraY) < 1e-9 && Math.abs(sb3[2] - dirSombraZ) < 1e-9,
  "o shadow map segue 'Sombra' mesmo com ambiente.sol = 'Sol'");
aplicarAmbiente(0, s3);
const cp2 = Math.cos(0.9), sp2 = Math.sin(0.9), cy2 = Math.cos(2.5), sy2 = Math.sin(2.5);
const dirSolX = sy2 * cp2, dirSolY = sp2, dirSolZ = cy2 * cp2;
check(Math.abs(s3.ambiente.pacote[10] - dirSolX) < 1e-9 && Math.abs(s3.ambiente.pacote[11] - dirSolY) < 1e-9 && Math.abs(s3.ambiente.pacote[12] - dirSolZ) < 1e-9,
  "o disco do céu segue 'Sol' (ambiente.sol), não o shadow caster");
check(Math.abs(s3.ambiente.pacote[10] - dirSombraX) > 1e-6, "sol do céu != direção do shadow caster (são luzes diferentes)");

// 4) cache de textura por caminho: erro de carga vira 1 aviso por caminho, não
// 1 por quadro (aviso repetido a cada frame indicaria alocação de log inútil
// e, pior, tentativa de I/O redundante).
const s4 = new Scene("textura");
s4.computeWorld();
s4.ambiente.ceu.textura = "build/nao-existe-1.png";
const c0 = logCount();
aplicarAmbiente(0, s4);
const c1 = logCount();
aplicarAmbiente(0, s4);
const c2 = logCount();
check(c1 - c0 === 1, "1º caminho ruim: 1 aviso");
check(c2 - c1 === 0, "mesmo caminho de novo: nenhum aviso extra (cache por caminho)");
s4.ambiente.ceu.textura = "build/nao-existe-2.png";
aplicarAmbiente(0, s4);
const c3 = logCount();
check(c3 - c2 === 1, "caminho novo: mais 1 aviso (o cache não trava em 0 avisos pra sempre)");

io.print("[PASSOU] aplicarAmbiente: SOL_PADRAO, slot 0 de aplicarLuzes, ambiente.sol só decide o disco (não a sombra), cache de textura por caminho");
