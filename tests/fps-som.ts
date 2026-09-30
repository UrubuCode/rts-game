// Som do cliente FPS por número, no dispositivo NULO: música em laço no grupo
// Música, tiro próprio quase 2D e o dos outros 3D, impacto e explosão 3D,
// nada repetido entre quadros, passos a cada 2,2 u no chão, alternando.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { initAudio, AUDIO_NULO, activeVoices, vozesTabela } from "@engine/audio/audio";
import { VOZ_FLOATS, MAX_VOZES, V_ESTADO, V_BLEND, V_GRUPO, V_MAX, V_PITCH, V_LACO } from "@engine/audio/vozes";
import { grupoIndex } from "@engine/audio/mixer_grupos";
import { FpsWorld } from "../src/shared/world";
import { FPS_EFEITO_TRACADOR, FPS_EFEITO_MARCA, FPS_EFEITO_EXPLOSAO, FPS_VIDA_TRACADOR, FPS_VIDA_MARCA,
         FPS_VIDA_EXPLOSAO, FPS_ALTURA_OLHO } from "../src/shared/config";
import { FpsSom, fpsSomIniciar, fpsSomQuadro, FPS_SOM_BLEND_TIRO_PROPRIO, FPS_SOM_MAX_EXPLOSAO } from "../src/som";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}
io.print("=== fps-som ===");
initAudio(AUDIO_NULO);
const m = new FpsWorld(new Scene("som"), 7, 1.0);
const eu = m.adicionarJogador(false);
m.adicionarJogador(true);
const som = new FpsSom();
fpsSomIniciar(som, eu);
const vz = vozesTabela();
function ultimaVoz(): number {
  let v = MAX_VOZES - 1;
  while (v >= 0) { if (vz[v * VOZ_FLOATS + V_ESTADO] !== 0.0) return v * VOZ_FLOATS; v = v - 1; }
  return 0 - 1;
}
check("música tocando em laço no grupo Música", activeVoices() === 1 && vz[V_LACO] === 1.0 && vz[V_GRUPO] === grupoIndex("Música") && vz[V_BLEND] === 0.0);

const p = m.jogadores[eu];
const pose = som.pose;
pose[0] = p.x; pose[1] = p.y + FPS_ALTURA_OLHO; pose[2] = p.z;
m.adicionarEfeito(FPS_EFEITO_TRACADOR, p.x, p.y + FPS_ALTURA_OLHO, p.z, p.x + 10.0, p.y, p.z, FPS_VIDA_TRACADOR);
fpsSomQuadro(som, m, pose, 0.016);
let b = ultimaVoz();
check("tiro próprio: blend 0,3 no grupo Efeitos", som.tocadosTiro === 1 && vz[b + V_BLEND] === FPS_SOM_BLEND_TIRO_PROPRIO && vz[b + V_GRUPO] === grupoIndex("Efeitos"));
check("pitch do tiro dentro de ±3 %", Math.abs(vz[b + V_PITCH] - 1.0) <= 0.03 + 1e-9, "" + vz[b + V_PITCH]);

m.adicionarEfeito(FPS_EFEITO_TRACADOR, p.x + 20.0, p.y + 1.0, p.z, p.x, p.y, p.z, FPS_VIDA_TRACADOR);
m.adicionarEfeito(FPS_EFEITO_MARCA, p.x + 5.0, p.y, p.z + 5.0, 0.0, 1.0, 0.0, FPS_VIDA_MARCA);
m.adicionarEfeito(FPS_EFEITO_EXPLOSAO, p.x + 30.0, p.y, p.z, 0.0, 0.0, 0.0, FPS_VIDA_EXPLOSAO);
fpsSomQuadro(som, m, pose, 0.016);
b = ultimaVoz();
check("tiro de outro 3D, impacto e explosão", som.tocadosTiro === 2 && som.tocadosImpacto === 1 && som.tocadosExplosao === 1);
check("explosão 3D com alcance maior", vz[b + V_BLEND] === 1.0 && vz[b + V_MAX] === FPS_SOM_MAX_EXPLOSAO);
fpsSomQuadro(som, m, pose, 0.016);
check("efeito já tocado não toca de novo", som.tocadosTiro === 2 && som.tocadosImpacto === 1 && som.tocadosExplosao === 1);

p.noChao = true; p.vivo = true;
let k = 0;
while (k < 10) { p.x = p.x + 0.5; fpsSomQuadro(som, m, pose, 0.016); k = k + 1; }
check("5 u no chão = 2 passos (a cada 2,2 u)", som.tocadosPasso === 2, "" + som.tocadosPasso);
check("os passos alternam passo1/passo2", som.alterna[eu] === 0);
p.noChao = false;
k = 0;
while (k < 10) { p.x = p.x + 0.5; fpsSomQuadro(som, m, pose, 0.016); k = k + 1; }
check("no ar não há passo", som.tocadosPasso === 2);
p.noChao = true;
p.x = p.x + 50.0;
fpsSomQuadro(som, m, pose, 0.016);
check("um salto de 50 u (renascer) não conta como passo", som.tocadosPasso === 2);
if (falhas === 0) io.print("[PASSOU] fps-som"); else io.print("[FALHOU] fps-som: " + falhas + " falha(s)");
