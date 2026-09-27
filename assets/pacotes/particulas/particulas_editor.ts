/** @editorOnly */
// Pacote partículas (editor): gizmo do ParticleSystem (ícone + forma do
// emissor quando selecionado — esfera/cone/caixa, a mesma leitura que
// `sim.ts` usa para nascer as partículas) e o item Criar/Efeitos/Partículas.
// No molde de `audio_editor.ts`/`luz_editor.ts`; o comando WS fica em
// `particulas_comandos.ts` (like `audio_comandos.ts` separa o comando do
// resto do pacote de editor).
import { Editor, registerGizmo, Gizmos } from "@editor/api";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { ParticleSystem, definirConsultaSelecao } from "@scripts/particlesystem";
import { FORMA_ESFERA, FORMA_CONE, FORMA_CAIXA } from "@engine/particles/desc";

// Task 9: injeta a consulta de seleção no núcleo do componente (que não pode
// importar @editor/api, CLAUDE.md "sem ciclos") — a prévia de edição do
// ParticleSystem (`update()`/`onInspectorGUI` em particlesystem.ts) só
// simula fora do Play quando este pacote de editor está carregado E o objeto
// está selecionado.
definirConsultaSelecao((id: number) => Editor.selecionado(id));

const ICONE_EMISSOR: string = "particulas-emissor";
/// Cor do gizmo de forma (esfera/cone/caixa) quando o objeto está
/// selecionado — 0xRRGGBB, como `cor` de Light/AudioSource.
const COR_GIZMO_FORMA: number = 0x9FC5E8;
const NOME_PARTICULAS: string = "Partículas";

/// Rascunhos de módulo (Float64Array): nenhum gizmo aloca por quadro, mesmo
/// padrão de `gzPos`/`menuPonto` em `audio_editor.ts`.
const gzPos = new Float64Array(3);
const gzTam = new Float64Array(3);
const gzDir = new Float64Array(3);
/// `spawnPoint` escreve pose completa (posição + yaw/pitch): precisa de 5, não 3.
const menuPonto = new Float64Array(5);

function desenharEmissor(g: Gizmos, dono: GameObject, comp: Behavior): void {
  const p = comp as ParticleSystem;
  gzPos[0] = dono.transform.wx; gzPos[1] = dono.transform.wy; gzPos[2] = dono.transform.wz;
  g.color(COR_GIZMO_FORMA);
  g.icon(ICONE_EMISSOR, gzPos);
  if (!g.selecionado) return;
  if (p.forma === FORMA_ESFERA) {
    g.wireSphere(gzPos, p.raio);
  } else if (p.forma === FORMA_CONE) {
    // o cone do gizmo aponta pra cima (+Y): mesmo eixo que `sim.ts` usa pra
    // amostrar a direção inicial da forma CONE (spec §4.2) — o alcance
    // mostrado é o pior caso de velocidade (startSpeedMax), não a altura
    // real de nenhuma partícula.
    gzDir[0] = 0.0; gzDir[1] = 1.0; gzDir[2] = 0.0;
    g.wireCone(gzPos, gzDir, p.startSpeedMax > 0.0 ? p.startSpeedMax : p.raio, p.anguloCone);
  } else if (p.forma === FORMA_CAIXA) {
    gzTam[0] = p.caixaX; gzTam[1] = p.caixaY; gzTam[2] = p.caixaZ;
    g.wireBox(gzPos, gzTam);
  }
}
registerGizmo("ParticleSystem", desenharEmissor);

export class ParticulasMenu {
  /** @menuItem Criar/Efeitos/Partículas */
  static criar(): void {
    const sc = Editor.scene();
    if (sc === null) return;
    const o = sc.createGameObject(NOME_PARTICULAS);
    Editor.spawnPoint(menuPonto);
    o.transform.setPosition(menuPonto[0], menuPonto[1], menuPonto[2]);
    o.addBehavior(new ParticleSystem());
  }
}
