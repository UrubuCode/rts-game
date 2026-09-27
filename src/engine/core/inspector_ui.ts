// Engine RTS — InspectorUI: o que um componente usa em onInspectorGUI(ui) para
// desenhar o próprio Inspector. O editor fornece a implementação real
// (src/editor/inspector_gui.ts). Esta base só conta os usos e devolve os valores
// recebidos: um componente que não desenha nada fica com a lista automática.
import type { GameObject } from "./gameobject";
export class InspectorUI {
  /// Controles pedidos nesta chamada; 0 = o componente não tem GUI própria.
  usos: number;
  constructor() { this.usos = 0; }
  field(nome: string): void { this.usos = this.usos + 1; }
  /// Campo de asset estilo Unity (ObjectField): caixa com ícone + "<nome>
  /// (<tipo>)", botão ⊙ que abre "Selecionar <tipo>" (lista `exts` sob
  /// assets/), ping no Project ao clicar e soltar um tile compatível do
  /// Project no campo. `nome` é o campo string do componente (ex.: "clip");
  /// `icon` é o nome do ícone do editor (ex.: "audio-fonte"). Reusável: hoje só
  /// o AudioSource usa, com tipo "AudioClip" e exts [".wav",".ogg"].
  objectField(nome: string, tipo: string, exts: string[], icon: string): void { this.usos = this.usos + 1; }
  label(texto: string): void { this.usos = this.usos + 1; }
  button(rotulo: string): boolean { this.usos = this.usos + 1; return false; }
  toggle(rotulo: string, valor: boolean): boolean { this.usos = this.usos + 1; return valor; }
  slider(rotulo: string, valor: number, min: number, max: number): number { this.usos = this.usos + 1; return valor; }
  color(rotulo: string, rgb: number): number { this.usos = this.usos + 1; return rgb; }
  dropdown(rotulo: string, opcoes: string[], indice: number): number { this.usos = this.usos + 1; return indice; }
  /// Um passo de Desfazer antes de uma mudança feita pelo próprio componente.
  alterar(): void {}
  /// Copia a pose da câmera da vista de Cena para `o`, com Desfazer.
  alinharComVista(o: GameObject | null): void {}
}
