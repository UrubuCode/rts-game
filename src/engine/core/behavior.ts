// Engine RTS — Behavior: o "MonoBehaviour". Todo script de gameplay estende
// isto e sobrescreve mount()/update(dt). Rodam num array polimórfico no
// GameObject (dispatch virtual provado no motor).
//
// REGRA: um Behavior só mexe no próprio transform (host). Ele NÃO desenha —
// o render é um passe separado (engine/render/draw.ts), como o Renderer do
// Unity é dirigido pelo motor, não pelo script.

import type { ContactInfo } from "./contact_events";
import { Transform } from "./transform";
import { componentMetadata } from "./component_metadata";
// só de TIPO: GameObject importa Behavior por valor, então isto teria que
// ser ciclo se não fosse `import type` (apagado na compilação).
import type { GameObject } from "./gameobject";

// TIPOS de component (tag numérica) — o primitivo do modelo uniforme "tudo é
// GameObject + componentes". Systems e o render acham um component por kind()
// (GameObject.componentIdx) sem cast nem parse de string. Novos componentes
// (Renderer, Collider, UI, Light…) entram aqui e plugam da mesma forma.
export const KIND_SCRIPT: number = 0;     // gameplay genérico (default)
export const KIND_MATERIAL: number = 1;   // aparência (textura/cor/emissivo)
export const KIND_RENDERER: number = 2;   // geometria a desenhar (mesh/primitivo)
export const KIND_UI: number = 3;         // elemento de UI (desenha em tela 2D)
export const KIND_SCENE_REF: number = 4;  // instância de outra cena (cena dentro de cena)
export const KIND_CAMERA: number = 5;     // ponto de vista (o jogo renderiza pela main)
export const KIND_COLLIDER: number = 6;   // a FORMA que colide (pode nao ser a que desenha)
// reservados p/ as próximas camadas: 6=COLLIDER, 7=LIGHT…

export class Behavior {
  host: Transform;   // transform do GameObject dono (setado no attach)
  enabled: number;
  collapsed: number; // foldout do inspector: 1 = recolhido (esconde os campos)
  bodyType: number;  // 0 = unassigned, 1 = static, 2 = kinematic, 3 = dynamic
  /// GameObject dono (setado por `GameObject.addBehavior`, null antes de
  /// anexado). Um Behavior que precisa de um COMPONENT IRMÃO do mesmo objeto
  /// (ex.: AnimationPlayer -> Skeleton) lê `owner.behaviors` por aqui, uma vez
  /// (cache), em vez de varrer a cena — não é herdado por Transform, que é
  /// compartilhado por todos os behaviors do objeto mas não sabe quem os tem.
  owner: GameObject | null;

  constructor() {
    this.host = new Transform();
    this.enabled = 1;
    this.collapsed = 0;
    this.bodyType = 0;
    this.owner = null;
  }

  /// Liga o script ao transform do GameObject dono.
  attach(t: Transform): void {
    this.host = t;
  }

  /// Chamado uma vez quando o objeto entra na cena (Awake/Start do Unity).
  mount(): void {}
  /// Chamado todo frame com o delta em SEGUNDOS.
  update(dt: f64): void {}

  // ── eventos de contato (Lote B2) ─────────────────────────────────────────
  // Entregues DEPOIS do passo de física por `Scene.resolveCollisions`, só a
  // objetos cujo `Collider.events` esteja ligado (1 = enter/exit, 2 = + stay).
  // `c` é UMA instância reutilizada: copie o que precisar guardar.
  onCollisionEnter(c: ContactInfo): void {}
  onCollisionStay(c: ContactInfo): void {}
  onCollisionExit(c: ContactInfo): void {}
  onTriggerEnter(c: ContactInfo): void {}
  onTriggerStay(c: ContactInfo): void {}
  onTriggerExit(c: ContactInfo): void {}

  // ── UI do jogo (src/engine/ui/game_ui.ts) ────────────────────────────────
  /// Um componente KIND_UI clicável responde 1 no frame do clique.
  uiClicked(): number { return 0; }
  /// Nome que o clique carrega (o rótulo do botão).
  uiName(): string { return ""; }
  /// Recebido por TODOS os behaviors habilitados do objeto cujo botão foi
  /// clicado — o script do botão é um irmão, como o OnClick da Unity.
  onUIClick(name: string): void {}

  /// Um backend EXTERNO (GPU ou o solver em Rust) assumiu (`1`) ou devolveu
  /// (`0`) a simulação do corpo dono. Quem INTEGRA movimento sobrescreve e para
  /// de integrar enquanto estiver ligado: o backend já aplica gravidade e move
  /// o corpo, e integrar aqui também seriam duas físicas sobre o mesmo estado —
  /// a velocidade da CPU cresce sem contato nenhum para freá-la, e o corpo
  /// treme a cada frame em que o resultado do backend não chegou. No-op no
  /// default. Chamado só na ressincronização, nunca por frame.
  setExternalSim(on: number): void {}

  // ── SURFACE DE INTEGRADOR (lida pelos backends de física, sem cast) ────────
  //
  // Quem MOVE um corpo por gravidade responde `1` em `bodyIntegrates` e os três
  // números abaixo; só o `Rigidbody` faz isso hoje. Existe porque os backends
  // externos (GPU, Rust) precisam desses valores — eles integram no lugar do
  // script — e perguntar por eles é o que faz os três solvers concordarem.
  //
  // O DEFAULT `0` é a metade que importa: um corpo dinâmico SEM integrador não
  // cai no caminho da CPU, e passou a não cair nos outros dois. Antes o kernel
  // aplicava gravidade a todo corpo que recebia, então a mesma cena caía ou não
  // conforme o backend.
  bodyIntegrates(): number { return 0; }
  /// Aceleração da gravidade deste corpo, como o script a guarda (negativa =
  /// para baixo). Quem lê normaliza o sinal.
  bodyGravity(): f64 { return 0.0; }
  /// Fração da velocidade perdida por segundo (0 = nenhuma).
  bodyDrag(): f64 { return 0.0; }
  /// Altura do chão implícito, ou um valor muito negativo para "desligado".
  bodyFloor(): f64 { return 0.0 - 1.0e30; }

  /// Devolve os dados do script como objeto simples (pra JSON.stringify da cena).
  /// `null` = não serializa. Subclasses sobrescrevem (o componente se descreve
  /// sozinho); o objeto é o que vai pro array `scripts` da cena.
  toData(): any {
    return componentMetadata.provider.serialize(this);
  }

  // ── SURFACE DE CONFIG (Inspector estilo Unity) ──────────────────────────────
  // O componente se autodescreve: nome + campos numéricos editáveis. O inspector
  // itera fieldCount() e desenha um numField por campo, lendo fieldGet/fieldSet.
  /// Nome do componente exibido no cabeçalho do inspector.
  typeName(): string { return componentMetadata.provider.name(this); }
  /// Quantos campos numéricos editáveis este componente expõe.
  fieldCount(): number { return componentMetadata.provider.fieldCount(this); }
  /// Tipo de controle no Inspector; componentes descrevem seus proprios campos.
  fieldType(i: number): string { return componentMetadata.provider.fieldType(this, i); }
  /// Rótulo curto do campo `i` (ex.: "SpdY").
  fieldLabel(i: number): string { return componentMetadata.provider.fieldLabel(this, i); }
  /// Valor atual do campo `i`.
  fieldGet(i: number): f64 { return componentMetadata.provider.fieldGet(this, i); }
  /// Grava `v` no campo `i` (chamado pelo inspector ao arrastar/editar).
  fieldSet(i: number, v: f64): void { componentMetadata.provider.fieldSet(this, i, v); }
  fieldStringGet(i: number): string { return componentMetadata.provider.fieldStringGet(this, i); }
  fieldStringSet(i: number, v: string): void { componentMetadata.provider.fieldStringSet(this, i, v); }
  /// Chamado depois de editar um campo automatico; use para atualizar dados derivados.
  onValidate(field: string): void {}

  // ── IDENTIDADE do component (modelo uniforme) ───────────────────────────────
  /// O TIPO deste component (uma das consts KIND_*). Systems e o render acham um
  /// component por kind() sem cast. Default = KIND_SCRIPT (gameplay genérico); o
  /// Material devolve KIND_MATERIAL, futuros Renderer/Collider/UI os seus.
  kind(): number { return KIND_SCRIPT; }

  // ── SURFACE DE MATERIAL (lida pelo render via dispatch virtual, sem cast) ────
  // O component Material sobrescreve estes; qualquer outro Behavior devolve os
  // defaults (o render só consulta um component cujo kind()===KIND_MATERIAL).
  /// Id da textura de imagem real (>=2) ou 0 (sem imagem).
  matTexId(): number { return 0; }
  /// 1 = emissivo (não sombreado).
  matEmissive(): number { return 0; }
  /// Modo de textura procedural quando NÃO há imagem: 0=nenhuma, 1=xadrez.
  matTexMode(): number { return 0; }
  /// Path da imagem aplicada ("" = nenhuma). Só exibição (slot do inspector).
  matTexPath(): string { return ""; }
  /// Repetições da textura por unidade de MUNDO (0 = UV da malha).
  matTile(): number { return 0; }
  /// Nome de textura procedural (`proc_textures.ts`), "" se nenhuma.
  matProc(): string { return ""; }

  // ── SURFACE DE CÂMERA (só o component Camera sobrescreve) ───────────────────
  /// Campo de visão vertical em radianos.
  camFov(): f64 { return 1.05; }
  /// 1 = é a câmera principal da cena (a que o jogo usa pra renderizar).
  camIsMain(): number { return 0; }
  /// Aplica uma textura de imagem (id + path) — só o Material implementa; nos
  /// demais é no-op. Chamado pelo asset browser / ws ao aplicar uma textura.
  setMatTexture(id: number, path: string): void {}

  // ── SURFACE DE RENDERER (lida pelo render via dispatch virtual, sem cast) ────
  // O MeshRenderer sobrescreve; os demais devolvem 0 (o render só consulta um
  // component cujo kind()===KIND_RENDERER).
  /// Primitivo a desenhar: 1=cubo, 2=pirâmide, 3=octaedro, 4=esfera (0 = usar mesh).
  rMeshKind(): number { return 0; }
  /// Id de mesh carregada (.obj) — tem prioridade sobre rMeshKind (0 = nenhuma).
  rCustomMesh(): number { return 0; }
  /// Um renderer que se desenha sozinho (ex.: Skeleton, várias peças por
  /// objeto) devolve 1 depois de desenhar; o laço de render então pula o
  /// desenho por meshKind/customMesh. 0 = seguir o caminho normal.
  drawSelf(win: number): number { return 0; }
  /// 1 = este renderer se desenha sozinho (`drawSelf`) e tem prioridade sobre
  /// os demais renderers do objeto. Lido só em `refreshComponentCache`.
  drawsSelf(): number { return 0; }

  // ── SURFACE DE UI (chamada pelo pass de UI-scene, dispatch virtual) ──────────
  // Um component de UI (kind UI) desenha a si mesmo em tela 2D. É o seam da visão
  // "um painel do editor é um GameObject". Os demais componentes são no-op.
  /// Desenha este elemento de UI na janela `win` (usa render.* em coords de tela).
  /// `w`/`h` = tamanho lógico da janela (pra âncora tipo RectTransform da Unity: o
  /// elemento gruda num canto + offset, seguindo o resize). No-op no default.
  drawUI(win: i64, w: f64, h: f64): void {}
  /// Atualiza o texto/título deste elemento de UI (HUD ao vivo). No-op no default.
  setUITitle(s: string): void {}
}
