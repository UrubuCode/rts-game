import { Behavior, KIND_UI, KIND_CAMERA } from "@engine/core/behavior";
import { EditorUI } from "./ui_controls";
import { scene, S } from "./control/session";
import { UI_WORKSPACE as L, UI_C } from "./ui_config";

export class WorkspaceViews extends Behavior {
  ui: EditorUI; game: boolean = false; console: boolean = false;
  x: number = 0; y: number = 0; z: number = 0; yaw: number = 0; pitch: number = 0; fov: number = 0;
  hasCamera: boolean = false;
  constructor(app: any) { super(); this.ui = new EditorUI(app, "Editor/WorkspaceTabs"); this.ui.root.addBehavior(this); }
  kind(): number { return KIND_UI; }
  camera(defaultFov: number): void {
    this.x = S.camX; this.y = S.camY; this.z = S.camZ; this.yaw = S.camYaw; this.pitch = S.camPitch; this.fov = defaultFov;
    this.hasCamera = false;
    if (!this.game) return;
    const index = scene.mainCameraIdx();
    if (index < 0) return;
    const object = scene.objects[index]; const t = object.transform;
    this.x = t.wx; this.y = t.wy; this.z = t.wz; this.yaw = t.wry; this.pitch = t.wrx;
    this.fov = object.behaviors[object.componentIdx(KIND_CAMERA)].camFov(); this.hasCamera = true;
  }
  tabs(x: number, top: number, bottom: number, blocked: boolean): void {
    this.ui.begin(0, 0, 0, 0);
    let i = 0;
    while (i < L.tabs.length) {
      const tab = this.ui.control("View/" + i, "button", x + L.padding + i * (L.tabW + L.gap), top, L.tabW, L.tabH, L.tabs[i], !blocked);
      if (this.game === (i === 1)) tab.fill = UI_C.controlActive;
      this.ui.draw(tab); if (tab.clicked) { this.game = i === 1; this.ui.app.setFocus(-1); }
      const bottomTab = this.ui.control("Bottom/" + i, "button", x + L.padding + i * (L.tabW + L.gap), bottom, L.tabW, L.tabH, L.bottomTabs[i], !blocked);
      if (this.console === (i === 1)) bottomTab.fill = UI_C.controlActive;
      this.ui.draw(bottomTab); if (bottomTab.clicked) { this.console = i === 1; this.ui.app.setFocus(-1); }
      i = i + 1;
    }
    this.ui.end();
  }
}
