// Testa o editor de chaves do Inspector do ParticleSystem (Task 8):
// - setChaveGradiente/setChaveTamanho entram ORDENADAS por tempo, mesmo
//   quando a chave nova/editada não é adicionada em ordem.
// - nChavesGradiente/nChavesTamanho nunca passam de MAX_CHAVES (4): a 5ª
//   tentativa devolve false e não altera a contagem.
// - Ruling P3 (serialização): toData()/ParticleSystem.fromData() fazem o
//   round-trip exato dos bursts/gradiente/curva de tamanho (arrays não
//   escalares, fora da reflexão automática), preservando também os campos
//   escalares automáticos (componentFields) — o mesmo caminho que
//   componentToData()/recreateBehavior usam para salvar, duplicar e Rodar.
import process from "@compat/process.ts";
import { ParticleSystem } from "@scripts/particlesystem";
import { componentToData } from "@engine/components";
import { restoreRegisteredComponent } from "@engine/generated/components";
import { componentMetadata } from "@engine/core/component_metadata";

function falhar(msg: string): void { console.log("[FALHOU] " + msg); process.exit(1); }
function aproxIgual(a: number, b: number, msg: string): void {
  if (Math.abs(a - b) > 1e-9) falhar(msg + " (" + a + " != " + b + ")");
}

// Recria um ParticleSystem a partir do descritor de componentToData(), o
// mesmo caminho de sceneio.ts:recreateBehavior (sem depender do editor).
function recriar(p: ParticleSystem): ParticleSystem {
  const sd = componentToData(p);
  const registrado = restoreRegisteredComponent(sd);
  const copia = registrado !== null ? registrado : ParticleSystem.fromData(sd);
  componentMetadata.provider.restoreLegacyFields(copia, sd.componentFields);
  return copia as ParticleSystem;
}

// ── setChaveGradiente: ordena por tempo, mesmo fora de ordem ───────────────
{
  const p = new ParticleSystem();
  const v = new Float64Array(5);
  // estado inicial: 2 chaves (t=0 branco opaco, t=1 branco transparente)
  if (p.nChavesGradienteCount() !== 2) falhar("gradiente inicial deveria ter 2 chaves");

  // insere uma chave no MEIO (t=0.5) escrevendo no próximo índice livre (2)
  v[0] = 0.5; v[1] = 1.0; v[2] = 0.5; v[3] = 0.1; v[4] = 1.0;
  if (!p.setChaveGradiente(2, v)) falhar("setChaveGradiente(2,...) deveria aceitar (só 2 chaves usadas)");
  if (p.nChavesGradienteCount() !== 3) falhar("deveria ter 3 chaves depois do insert");
  // ordenada: índice 1 (do meio) deve ser a chave t=0.5 que acabou de entrar
  aproxIgual(p.chaveGradienteTempo(0), 0.0, "chave 0 deveria continuar em t=0");
  aproxIgual(p.chaveGradienteTempo(1), 0.5, "chave nova deveria ficar ordenada em t=0.5 (índice 1)");
  aproxIgual(p.chaveGradienteTempo(2), 1.0, "chave antiga t=1 deveria ir para o índice 2");
  const cor = new Float64Array(4);
  p.chaveGradienteCor(1, cor);
  aproxIgual(cor[0], 1.0, "cor.r da chave reordenada"); aproxIgual(cor[1], 0.5, "cor.g da chave reordenada");
  aproxIgual(cor[2], 0.1, "cor.b da chave reordenada"); aproxIgual(cor[3], 1.0, "cor.a da chave reordenada");

  // teto de MAX_CHAVES=4: preenche até 4, a 5ª tentativa falha e não muda a contagem
  v[0] = 0.75; v[1] = 0.0; v[2] = 0.0; v[3] = 0.0; v[4] = 1.0;
  if (!p.setChaveGradiente(3, v)) falhar("setChaveGradiente(3,...) deveria aceitar (4ª chave)");
  if (p.nChavesGradienteCount() !== 4) falhar("deveria ter 4 chaves");
  v[0] = 0.9;
  if (p.setChaveGradiente(4, v)) falhar("setChaveGradiente(4,...) deveria recusar (excede MAX_CHAVES=4)");
  if (p.nChavesGradienteCount() !== 4) falhar("contagem não deveria mudar após a 5ª tentativa recusada");
}

// ── setChaveTamanho: mesmo comportamento (ordena, teto de 4) ───────────────
{
  const p = new ParticleSystem();
  const v = new Float64Array(2);
  if (p.nChavesTamanhoCount() !== 2) falhar("curva de tamanho inicial deveria ter 2 chaves");
  v[0] = 0.3; v[1] = 2.0;
  if (!p.setChaveTamanho(2, v)) falhar("setChaveTamanho(2,...) deveria aceitar");
  aproxIgual(p.chaveTamanhoTempo(1), 0.3, "chave de tamanho nova deveria ficar ordenada no meio");
  aproxIgual(p.chaveTamanhoValor(1), 2.0, "valor da chave de tamanho reordenada");
  v[0] = 0.6; v[1] = 0.5;
  if (!p.setChaveTamanho(3, v)) falhar("setChaveTamanho(3,...) deveria aceitar (4ª chave)");
  v[0] = 0.99; v[1] = 1.0;
  if (p.setChaveTamanho(4, v)) falhar("setChaveTamanho(4,...) deveria recusar (excede MAX_CHAVES=4)");
  if (p.nChavesTamanhoCount() !== 4) falhar("contagem de tamanho não deveria mudar após a 5ª tentativa recusada");
}

// ── Ruling P3: round-trip salvar/carregar (toData/fromData) ────────────────
{
  const p = new ParticleSystem();
  p.rateOverTime = 42.0; p.forma = 2; p.anguloCone = 12.5;   // campo escalar automático
  p.setBurst(0, 0.1, 5.0); p.setBurst(1, 1.5, 20.0);
  const vg = new Float64Array(5);
  vg[0] = 0.4; vg[1] = 0.2; vg[2] = 0.3; vg[3] = 0.4; vg[4] = 0.9;
  p.setChaveGradiente(2, vg);
  const vt = new Float64Array(2);
  vt[0] = 0.4; vt[1] = 3.0;
  p.setChaveTamanho(2, vt);
  p.time = 3.33;   // estado de simulação: NUNCA deve sobreviver ao round-trip

  const r = recriar(p);
  aproxIgual(r.rateOverTime, 42.0, "round-trip: campo escalar automático (rateOverTime)");
  if (r.forma !== 2) falhar("round-trip: campo escalar automático (forma)");
  aproxIgual(r.anguloCone, 12.5, "round-trip: campo escalar automático (anguloCone)");
  if (r.burstCount() !== 2) falhar("round-trip: burstCount deveria ser 2");
  aproxIgual(r.burstTime(0), 0.1, "round-trip: burst 0 tempo"); aproxIgual(r.burstAmount(0), 5.0, "round-trip: burst 0 quantidade");
  aproxIgual(r.burstTime(1), 1.5, "round-trip: burst 1 tempo"); aproxIgual(r.burstAmount(1), 20.0, "round-trip: burst 1 quantidade");
  if (r.nChavesGradienteCount() !== 3) falhar("round-trip: nChavesGradiente deveria ser 3");
  aproxIgual(r.chaveGradienteTempo(1), 0.4, "round-trip: chave de gradiente ordenada preservada");
  if (r.nChavesTamanhoCount() !== 3) falhar("round-trip: nChavesTamanho deveria ser 3");
  aproxIgual(r.chaveTamanhoTempo(1), 0.4, "round-trip: chave de tamanho ordenada preservada");
  aproxIgual(r.time, 0.0, "round-trip: 'time' é estado de simulação, não deve sobreviver");
}

console.log("[PASSOU] test_particulas_inspector");
