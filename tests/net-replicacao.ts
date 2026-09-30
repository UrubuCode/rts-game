// Replicação: spawn/despawn, snapshot (posição, yaw, ativo), quem entra depois,
// netId sem reuso e snapshot dividido em várias mensagens.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { NetRedeMemoria } from "../src/net/transport";
import { NetServidor } from "../src/net/server";
import { NetCliente } from "../src/net/client";
import { NetworkObject, NetworkTransform } from "../src/net/components";
import { NetFabrica, NetReplicacaoServidor, NetReplicacaoCliente } from "../src/net/replication";
import { NET_DONO_SERVIDOR } from "../src/net/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

class NetTesteFabrica extends NetFabrica {
  criar(tipo: number, netId: number, dono: number): NetworkObject | null {
    const go = new GameObject("remoto" + netId);
    go.setMesh(1, 1, 1, 1);
    const no = new NetworkObject(tipo, dono);
    no.go = go;
    no.adicionar(new NetworkTransform(go.transform));
    go.addBehavior(no);
    return no;
  }
}

function objetoServidor(nome: string): NetworkObject {
  const go = new GameObject(nome);
  go.setMesh(1, 1, 1, 1);
  const no = new NetworkObject(7, NET_DONO_SERVIDOR);
  no.go = go;
  no.adicionar(new NetworkTransform(go.transform));
  go.addBehavior(no);
  return no;
}

const DT: f64 = 1.0 / 60.0;
let relogio = 0;
const rede = new NetRedeMemoria(0.0, 1, 1);
const tS = rede.criarPonta();
const srv = new NetServidor(tS, 4, 60);
const repS = new NetReplicacaoServidor(srv);
const clientes: NetCliente[] = [];
const reps: NetReplicacaoCliente[] = [];

function novoCliente(): number {
  const cli = new NetCliente(rede.criarPonta());
  cli.conectar(tS.endereco, relogio * DT);
  clientes.push(cli);
  reps.push(new NetReplicacaoCliente(cli, new Scene("cli" + clientes.length), new NetTesteFabrica()));
  return clientes.length - 1;
}

function rodar(ticks: number, snapshot: boolean): void {
  let t = 0;
  while (t < ticks) {
    const agora = relogio * DT;
    let k = 0;
    while (k < clientes.length) { clientes[k].passo(agora); reps[k].processar(); clientes[k].enviar(agora); k = k + 1; }
    rede.avancar();
    srv.receber(agora);
    let c = srv.proximoNovo();
    while (c >= 0) { repS.aoConectar(c); c = srv.proximoNovo(); }
    if (snapshot) repS.enviarSnapshot(relogio);
    srv.enviar(agora);
    rede.avancar();
    relogio = relogio + 1;
    t = t + 1;
  }
}

io.print("=== net-replicacao ===");

const a = objetoServidor("a");
a.go!.transform.setPosition(1.0, 2.0, 3.0);
check("primeiro netId é 1", repS.spawn(a) === 1);
const c0 = novoCliente();
rodar(10, true);
check("cliente recebe o que já existia", reps[c0].objetos.length === 1 && reps[c0].porNetId(1) !== null);

const b = objetoServidor("b");
repS.spawn(b);
a.go!.transform.setPosition(3.0, 4.0, 5.0);
a.go!.transform.ry = 1.0;
rodar(5, true);
const ra = reps[c0].porNetId(1);
const ta = ra !== null && ra.go !== null ? ra.go.transform : null;
check("spawn novo chega", reps[c0].objetos.length === 2);
check("snapshot aplica posição e yaw", ta !== null && Math.abs(ta.px - 3.0) < 0.001 && Math.abs(ta.pz - 5.0) < 0.001 &&
      Math.abs(ta.ry - 1.0) < 0.0002);

a.go!.active = 0;
rodar(3, true);
const raAtivo = reps[c0].porNetId(1);
check("estado ativo é replicado", raAtivo !== null && raAtivo.go !== null && raAtivo.go.active === 0);

repS.despawn(b);
rodar(5, true);
check("despawn remove do cliente", reps[c0].objetos.length === 1 && reps[c0].porNetId(2) === null);
const cObj = objetoServidor("c");
check("netId não é reaproveitado", repS.spawn(cObj) === 3);

const c1 = novoCliente();
rodar(10, true);
check("quem entra depois recebe os objetos vivos", reps[c1].objetos.length === 2 &&
      reps[c1].porNetId(1) !== null && reps[c1].porNetId(3) !== null);

// 120 spawns em 3 lotes de 40: de uma vez só estourariam as 64 confiáveis pendentes por cliente
let muitos: NetworkObject[] = [];
let i = 0;
while (i < 120) {
  const o = objetoServidor("m" + i);
  o.go!.transform.setPosition(i * 1.0, 0.0, 0.0);
  repS.spawn(o);
  muitos.push(o);
  i = i + 1;
  if (i % 40 === 0) rodar(6, true);
}
rodar(10, true);
i = 0;
while (i < 120) { muitos[i].go!.transform.setPosition(i * 1.0, 7.0, 0.0); i = i + 1; }
rodar(5, true);
let certos = 0;
i = 0;
while (i < 120) {
  const r = reps[c0].porNetId(muitos[i].netId);
  if (r !== null && r.go !== null && Math.abs(r.go.transform.py - 7.0) < 0.001) certos = certos + 1;
  i = i + 1;
}
check("snapshot com 122 objetos é dividido e todos atualizam", certos === 120, "certos=" + certos);

if (falhas === 0) io.print("[PASSOU] net-replicacao"); else io.print("[FALHOU] net-replicacao: " + falhas + " falha(s)");
