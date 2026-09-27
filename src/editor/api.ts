// @editor/api — o que um script de pacote usa para estender o editor: comandos
// do WebSocket, ganchos, seleção, Desfazer e a cena editada. No jogo exportado
// não há host instalado: tudo vira no-op, sem erro.
//
// Importa só TIPOS, o logger e a lista de comandos embutidos: um componente de
// pacote pode importar isto sem fechar ciclo pelo registro gerado
// (sceneio → components → componente → api).
import type { Scene } from "@engine/core/scene";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { logWarn, logError } from "@engine/core/logger";
import { BUILTIN_COMMANDS } from "./control/builtin_commands";
import { resolverObjeto } from "@editor/control/object_ref";
import math from "@compat/math.ts";

// Gizmos: um pacote desenha ajudas visuais do editor para um tipo de
// componente que não pode sobrescrever onDrawGizmos (ex.: Light, Camera).
export { Gizmos, registerGizmoDrawer as registerGizmo } from "@engine/core/gizmos";
export type { GizmoFn } from "@engine/core/gizmos";

export type ComandoFn = (partes: string[]) => string;
export type GanchoFn = (arg: string) => void;
export const EVENTOS_EDITOR: string[] = ["salvar", "abrirCena", "entrarPlay", "sairPlay"];
/// Distância à frente da câmera do editor onde objetos novos nascem.
export const SPAWN_DISTANCE: number = 8.0;
const COLCHETE: number = 91;   // '['
const SEPARADOR_AJUDA: string = " :: ";

/// O editor real sobrescreve (editor_host.ts). Aqui, os no-ops do jogo.
export class EditorHost {
  ativo: boolean;
  constructor() { this.ativo = false; }
  scene(): Scene | null { return null; }
  selection(): GameObject | null { return null; }
  select(o: GameObject | null): void {}
  snapshot(rotulo: string): void {}
  log(msg: string): void {}
  /// [x, y, z, yaw, pitch] da câmera da vista de Cena.
  viewPose(out: Float64Array): void {}
  inspect(b: Behavior, titulo: string): void {}
}
class EstadoEditor {
  host: EditorHost; nomes: string[]; ajudas: string[]; mutam: boolean[]; fns: ComandoFn[];
  ganchoEvento: string[]; ganchoFn: GanchoFn[];
  constructor() {
    this.host = new EditorHost(); this.nomes = []; this.ajudas = []; this.mutam = []; this.fns = [];
    this.ganchoEvento = []; this.ganchoFn = [];
  }
}
const estado = new EstadoEditor();

export function instalarHost(h: EditorHost): void { estado.host = h; }
export function editorAtivo(): boolean { return estado.host.ativo; }

export function registerCommand(nome: string, ajuda: string, muta: boolean, fn: ComandoFn): boolean {
  let ok = nome.length > 0 && nome.indexOf(" ") < 0;
  if (ok && (BUILTIN_COMMANDS.indexOf(nome) >= 0 || estado.nomes.indexOf(nome) >= 0)) ok = false;
  if (ok) { estado.nomes.push(nome); estado.ajudas.push(ajuda); estado.mutam.push(muta); estado.fns.push(fn); }
  else logWarn("registerCommand recusou '" + nome + "' (vazio, com espaço, embutido ou repetido)");
  return ok;
}
export function commandIndex(nome: string): number { return estado.nomes.indexOf(nome); }
export function commandMutates(i: number): boolean { return estado.mutam[i]; }
export function runCommand(i: number, partes: string[]): string {
  // Sem `try` aqui: a exceção sobe até o ponto protegido único do despacho
  // (dispatch.ts execProtegido), que responde "[erro] <nome>: <mensagem>".
  let out = estado.fns[i](partes);
  if (out.length === 0 || out.charCodeAt(0) !== COLCHETE) out = "[ok] " + out;
  return out;
}
/// A ajuda sempre começa pelo nome do comando (o `doc <prefixo>` filtra por
/// ele): "texto" vira "nome :: texto"; "<args> :: desc" vira "nome <args> :: desc".
function ajudaComNome(i: number): string {
  const n = estado.nomes[i];
  const a = estado.ajudas[i];
  if (a.indexOf(SEPARADOR_AJUDA) < 0) return n + SEPARADOR_AJUDA + a;
  if (a.indexOf(n + " ") === 0) return a;
  return n + " " + a;
}
/// Quantos comandos de pacote estão registrados.
export function commandCount(): number { return estado.nomes.length; }
export function commandName(i: number): string { return estado.nomes[i]; }
/// Uso no formato do `doc`: "assinatura :: descrição :: exemplo" (sem exemplo
/// na ajuda, o exemplo é o próprio nome).
export function commandUsage(i: number): string {
  const a = ajudaComNome(i);
  return a.split(SEPARADOR_AJUDA).length > 2 ? a : a + SEPARADOR_AJUDA + estado.nomes[i];
}
export function emitEditorEvent(evento: string, arg: string): void {
  if (!estado.host.ativo) return;
  let i = 0;
  while (i < estado.ganchoEvento.length) {
    if (estado.ganchoEvento[i] === evento) {
      try { estado.ganchoFn[i](arg); } catch (error) { logError("Gancho '" + evento + "': " + String(error)); }
    }
    i = i + 1;
  }
}

export class Editor {
  static scene(): Scene | null { return estado.host.scene(); }
  static selection(): GameObject | null { return estado.host.selection(); }
  static select(o: GameObject | null): void { estado.host.select(o); }
  static snapshot(rotulo: string): void { estado.host.snapshot(rotulo); }
  static log(msg: string): void { estado.host.log(msg); }
  static on(evento: string, fn: GanchoFn): boolean {
    const ok = EVENTOS_EDITOR.indexOf(evento) >= 0;
    if (ok) { estado.ganchoEvento.push(evento); estado.ganchoFn.push(fn); }
    return ok;
  }
  static viewPose(out: Float64Array): void { estado.host.viewPose(out); }
  /// Pose da vista com a posição levada SPAWN_DISTANCE à frente (onde o menu Criar põe objetos).
  static spawnPoint(out: Float64Array): void {
    estado.host.viewPose(out);
    const cy = math.cos(out[3]); const sy = math.sin(out[3]); const cp = math.cos(out[4]); const sp = math.sin(out[4]);
    out[0] = out[0] + sy * cp * SPAWN_DISTANCE; out[1] = out[1] + sp * SPAWN_DISTANCE; out[2] = out[2] + cy * cp * SPAWN_DISTANCE;
  }
  static inspect(b: Behavior, titulo: string): void { estado.host.inspect(b, titulo); }
  /// Objeto da cena editada por índice ("3"/"#3"), nome exato ou caminho
  /// "Pai/Filho" — o mesmo resolvedor dos comandos embutidos. null se não
  /// achar, se o nome for ambíguo ou fora do editor.
  static object(ref: string): GameObject | null {
    const sc = estado.host.scene();
    if (sc === null) return null;
    const i = resolverObjeto(sc, ref);
    return i >= 0 ? sc.objects[i] : null;
  }
}
