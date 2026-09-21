// Verificacao visual isolada: nao carrega cena, fisica nem salva assets.
// rts compile --no-compiler tools/component_picker_preview.ts build/ComponentPickerPreview.exe
import { createAppAt } from "@compat/app.ts";
import input from "rts:input";
import { setVsync } from "rts:egui";
import { ComponentPicker } from "@editor/component_picker";
import { UI_C, UI_COMPONENT_PICKER as P, UI_INSP_DEFAULT, UI_BAR_H, UI_INSPECTOR_FOOTER_H } from "@editor/ui_config";

const width = UI_INSP_DEFAULT;
const height = UI_BAR_H + P.maxRows * P.rowH + P.detailH + P.titleH + P.breadcrumbH + P.searchH + UI_INSPECTOR_FOOTER_H + P.padding * 2;
const preview = createAppAt("RTS — teste isolado do seletor", width, height, UI_BAR_H, UI_BAR_H);
const picker = new ComponentPicker();
let opened = false;
let chosen = "Nenhum componente adicionado";
setVsync(preview._win, 1);
while (preview.running()) {
  if (!preview.beginFrame()) break;
  preview.box(0, 0, width, height, UI_C.panel, 0, 0, 0);
  preview.text(P.margin, P.padding, "Inspector • objeto de teste", UI_C.primaryText, P.font);
  preview.text(P.margin, P.titleH, chosen, UI_C.primaryText, P.smallFont);
  const click = preview.button(P.margin, height - UI_INSPECTOR_FOOTER_H + P.gap,
    width - P.margin * 2, P.buttonH, "+ " + P.title);
  if (click) {
    opened = !opened;
    if (opened) picker.begin(preview);
  }
  if (opened) {
    const mx = input.mouseX(preview._win);
    const my = input.mouseY(preview._win);
    const pressed = input.mousePressed(preview._win, 0) ? 1 : 0;
    const result = picker.draw(preview, P.margin, height - UI_INSPECTOR_FOOTER_H - P.gap,
      width - P.margin * 2, UI_BAR_H, mx, my,
      click || my >= height - UI_INSPECTOR_FOOTER_H ? 0 : pressed, input.wheel(preview._win));
    if (result.length > 0) chosen = "Adicionado: " + result;
    if (result.length > 0 || picker.closed) { opened = false; preview.setFocus(0 - 1); }
  }
  preview.endFrame();
}
preview.close();
