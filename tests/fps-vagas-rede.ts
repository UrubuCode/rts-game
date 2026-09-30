// Vagas de personagem dos remotos (client_rede): netId -> vaga reaproveitável,
// liberada quando o netId some do snapshot, com teto FPS_MAX_VAGAS_REDE.
import io from "@compat/io.ts";
import { FpsVagasRede, FPS_MAX_VAGAS_REDE } from "../src/vagas_rede";
import { FpsAnimacao } from "../src/animacao";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome + (detalhe !== undefined ? " (" + detalhe + ")" : "")); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

const v = new FpsVagasRede();
// quadro 1: netIds 10, 11, 12
v.comecar();
const a = v.vaga(10); const na = v.nova;
const b = v.vaga(11);
const c = v.vaga(12);
v.terminar();
check("tres remotos ocupam vagas 0, 1, 2", a === 0 && b === 1 && c === 2 && v.usadas === 3, a + "," + b + "," + c);
check("vaga recem-ocupada vem marcada como nova", na);
// quadro 2: mesmos netIds -> mesmas vagas, sem 'nova'
v.comecar();
const a2 = v.vaga(10); const na2 = v.nova;
v.vaga(11); v.vaga(12);
v.terminar();
check("mesmo netId, mesma vaga, nao nova", a2 === 0 && !na2);
// quadro 3: 11 saiu
v.comecar(); v.vaga(10); v.vaga(12); v.terminar();
check("netId que sumiu libera a vaga", !v.ocupada(1) && v.ocupada(0) && v.ocupada(2));
// quadro 4: entra o 13 -> reaproveita a vaga 1
v.comecar(); v.vaga(10); v.vaga(12);
const d = v.vaga(13); const nd = v.nova;
v.terminar();
check("quem entra reaproveita a vaga livre", d === 1 && nd && v.usadas === 3, "vaga " + d + ", usadas " + v.usadas);

// rotatividade: 2000 entradas/saídas com no máximo 16 ao mesmo tempo
const r = new FpsVagasRede();
const anim = new FpsAnimacao();
let proximo = 100;
const vivos: number[] = [];
let q = 0;
while (q < 2000) {
  if (vivos.length >= 16 || (q % 3 === 0 && vivos.length > 0)) vivos.splice(q % vivos.length, 1);
  vivos.push(proximo); proximo = proximo + 1;
  r.comecar();
  let i = 0;
  while (i < vivos.length) {
    const j = r.vaga(vivos[i]);
    if (j >= 0) { anim.garantir(j + 1); anim.visivel[j] = 1; anim.vel[j] = 4.0; }
    i = i + 1;
  }
  r.terminar();
  anim.passo(r.usadas, 1.0 / 60.0);
  q = q + 1;
}
// a vaga de quem sai só é liberada no fim do quadro: quem entra no MESMO
// quadro pega outra, então o pico é simultâneos + entradas por quadro (16 + 1)
check("2000 entradas com 16 simultaneos: vagas nao passam de 17", r.usadas <= 17 && anim.vagas() <= 17,
      "usadas " + r.usadas + ", personagens criados " + anim.vagas() + ", netIds ate " + proximo);

// teto
const t = new FpsVagasRede();
t.comecar();
let k = 0;
let semVaga = 0;
while (k < FPS_MAX_VAGAS_REDE + 5) { if (t.vaga(1000 + k) < 0) semVaga = semVaga + 1; k = k + 1; }
t.terminar();
check("acima do teto o remoto fica sem vaga (-1)", t.usadas === FPS_MAX_VAGAS_REDE && semVaga === 5, "sem vaga " + semVaga);

if (falhas === 0) io.print("[PASSOU] fps-vagas-rede");
else io.print("[FALHOU] fps-vagas-rede: " + falhas + " falha(s)");
