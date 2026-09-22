import { Behavior, KIND_UI } from "@engine/core/behavior";
import { EditorUI } from "./ui_controls";
import { playMode } from "./play_mode";
import { S } from "./control/session";
import { UI_PLAY as P, UI_C, UI_CONTROL_Y, UI_CONTROL_H } from "./ui_config";
import { nfCancel } from "./widgets";

export class PlayToolbar extends Behavior {
  ui: EditorUI;
  constructor(app: any) { super(); this.ui = new EditorUI(app, "Editor/PlayToolbar"); this.ui.root.addBehavior(this); }
  kind(): number { return KIND_UI; }
  typeName(): string { return "PlayToolbar"; }
  render(width: number, blocked: boolean): void {
    this.ui.begin(0, 0, 0, 0);
    const total = P.labels.length * P.buttonW + (P.labels.length - 1) * P.gap;
    const x = (width - total) / 2;
    let index = 0;
    while (index < P.labels.length) {
      const enabled = !blocked && (index === 0 || S.simulating !== 0);
      const button = this.ui.control(P.labels[index], "button", x + index * (P.buttonW + P.gap),
        UI_CONTROL_Y, P.buttonW, UI_CONTROL_H, P.labels[index], enabled);
      const active = index === 0 ? S.playing !== 0 : index === 1 && S.simulating !== 0 && S.playing === 0;
      button.fill = active ? UI_C.controlActive : UI_C.controlIdle;
      this.ui.draw(button);
      if (button.clicked) {
        nfCancel(); this.ui.app.setFocus(0 - 1);
        if (index === 0) playMode.play();
        else if (index === 1) playMode.pause();
        else playMode.stop();
      }
      index = index + 1;
    }
  }
}
