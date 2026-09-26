// GERADO por tools/generate-components.mjs. Só o editor (main.ts) importa este arquivo.
import "../../../assets/pacotes/camera/camera_editor";
import "../../../assets/pacotes/luz/luz_editor";
import { CameraMenu as Menu0 } from "../../../assets/pacotes/camera/camera_editor";
import { LuzMenu as Menu1 } from "../../../assets/pacotes/luz/luz_editor";
export const MENU_ITEMS: string[] = ["Criar/Câmera","Criar/Luz/Direcional","Criar/Luz/Pontual","Criar/Luz/Spot"];
export function runMenuItem(index: number): void {
  if (index === 0) { Menu0.camera(); return; }
  if (index === 1) { Menu1.direcional(); return; }
  if (index === 2) { Menu1.pontual(); return; }
  if (index === 3) { Menu1.spot(); return; }
  throw new Error("Item de menu inexistente: " + index);
}
