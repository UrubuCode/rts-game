// GERADO por tools/generate-components.mjs. Só o editor (main.ts) importa este arquivo.
import "../../../assets/pacotes/ambiente/ambiente_editor";
import "../../../assets/pacotes/audio/audio_comandos";
import "../../../assets/pacotes/audio/audio_editor";
import "../../../assets/pacotes/camera/camera_editor";
import "../../../assets/pacotes/luz/luz_editor";
import "../../../assets/pacotes/particulas/particulas_comandos";
import "../../../assets/pacotes/particulas/particulas_editor";
import { CameraMenu as Menu0 } from "../../../assets/pacotes/camera/camera_editor";
import { ParticulasMenu as Menu1 } from "../../../assets/pacotes/particulas/particulas_editor";
import { LuzMenu as Menu2 } from "../../../assets/pacotes/luz/luz_editor";
import { AudioMenu as Menu3 } from "../../../assets/pacotes/audio/audio_editor";
import { JanelaAmbiente as Menu4 } from "../../../assets/pacotes/ambiente/ambiente_editor";
import { JanelaMixer as Menu5 } from "../../../assets/pacotes/audio/audio_editor";
export const MENU_ITEMS: string[] = ["Criar/Câmera","Criar/Efeitos/Partículas","Criar/Luz/Direcional","Criar/Luz/Pontual","Criar/Luz/Spot","Criar/Áudio/Fonte","Criar/Áudio/Ouvinte","Janela/Ambiente","Janela/Mixer"];
export function runMenuItem(index: number): void {
  if (index === 0) { Menu0.camera(); return; }
  if (index === 1) { Menu1.criar(); return; }
  if (index === 2) { Menu2.direcional(); return; }
  if (index === 3) { Menu2.pontual(); return; }
  if (index === 4) { Menu2.spot(); return; }
  if (index === 5) { Menu3.fonte(); return; }
  if (index === 6) { Menu3.ouvinte(); return; }
  if (index === 7) { Menu4.abrir(); return; }
  if (index === 8) { Menu5.abrir(); return; }
  throw new Error("Item de menu inexistente: " + index);
}
