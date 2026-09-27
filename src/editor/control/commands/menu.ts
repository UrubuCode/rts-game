// menu [caminho] — lista ou executa um item de menu de script (Criar/…, Janela/…).
import { MENU_ITEMS } from "@engine/generated/editor_extensions";
import { indiceDoCaminho, executarItemDeMenu } from "../../menu_items";
import { S } from "../session";
export function cmdMenu(parts: string[]): string {
  let out = "";
  if (parts.length < 2) out = "[menu] " + (MENU_ITEMS.length > 0 ? MENU_ITEMS.join(" | ") : "(nenhum item de script)");
  else {
    const caminho = parts.slice(1).join(" ");
    const i = indiceDoCaminho(caminho);
    if (i < 0) out = "[erro] item de menu inexistente: " + caminho;
    else {
      const erro = executarItemDeMenu(i, 0 - 1);
      out = erro.length > 0 ? "[erro] " + erro : "[ok] " + caminho + " (selecionado #" + S.selected + ")";
    }
  }
  return out;
}
