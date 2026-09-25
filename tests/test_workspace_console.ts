import io from "@compat/io.ts";
import { scene, S } from "@editor/control/session";
import { Camera } from "@engine/core/camera";
import { WorkspaceViews } from "@editor/workspace_views";
import { ConsolePanel } from "@editor/console_panel";
import { EditorUI } from "@editor/ui_controls";
import { logInfo, logWarn, logError, logClear, logEntries, logRevision, setLogEcho, LOG_ERROR } from "@engine/core/logger";
import { scriptEditorArguments } from "@editor/script_editor";

function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
class TestApp {
  _win: number = 0; target: number = -1; focus: number = -1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  clickable(id: number, x: number, y: number, w: number, h: number): number { return id === this.target ? 3 : 0; }
  textField(id: number, x: number, y: number, w: number, text: string, enabled: boolean): string { return text; }
  box(x: number, y: number, w: number, h: number, color: number, stroke: number, border: number, radius: number): void {}
  text(x: number, y: number, text: string, color: number, size: number): void {}
}
setLogEcho(0); logClear();
logInfo("Loaded scene"); logWarn("Missing texture"); logError("Script failed", "assets/scripts/MotionSettings.ts", 12);
check(logEntries().length === 3 && logEntries(LOG_ERROR).length === 1, "structured log severity");
check(logEntries(1, "MISSING").length === 1, "case insensitive search");
const row = logEntries(LOG_ERROR)[0]; check(row.line === 12 && row.source.length > 0, "source location preserved");
row.message = "mutated copy"; check(logEntries(LOG_ERROR)[0].message === "Script failed", "snapshot independent of ring");
const revision = logRevision(); logClear(); check(logEntries().length === 0 && logRevision() > revision, "clear invalidates console");
let i = 0; while (i < 600) { logInfo("entry " + i); i = i + 1; }
const entries = logEntries(); check(entries.length === 512 && entries[0].message === "entry 88" && entries[511].message === "entry 599", "bounded ordered ring");
logClear(); logInfo("after clear"); check(logEntries().length === 1, "clear after wrap");
const app = new TestApp(); const views = new WorkspaceViews(app); const consolePanel = new ConsolePanel(app);
views.tabs(200, 60, 500, false);
const count = views.ui.scene.count(); views.tabs(200, 60, 500, false);
check(views.ui.scene.count() === count, "tabs reuse GameObjects");
app.target = views.ui.controls[views.ui.names.indexOf("View/1")].id;
views.tabs(200, 60, 500, true); check(!views.game, "blocked tab cannot switch");
views.tabs(200, 60, 500, false); check(views.game, "game tab clicks");
app.target = -1;
consolePanel.render(200, 524, 600, 240, false);
const controls = consolePanel.ui.scene.count(); consolePanel.render(200, 524, 600, 240, false);
check(consolePanel.ui.scene.count() === controls, "console reuses GameObjects");
app.target = consolePanel.ui.controls[consolePanel.ui.names.indexOf("Clear")].id;
consolePanel.render(200, 524, 600, 240, true); check(logEntries().length === 1, "blocked clear retains messages");
consolePanel.render(200, 524, 600, 240, false); check(logEntries().length === 0, "clear button clears");
const second = new EditorUI(app, "Other"); const button = second.control("Button", "button", 0, 0, 80, 24, "Other");
check(button.id !== views.ui.controls[0].id && button.id !== consolePanel.ui.controls[0].id, "window-global control IDs");
app.target = -1;
logInfo("Repeated message"); logInfo("Repeated message"); logWarn("Missing mesh"); logError("Script failed", "test.ts", 20);
consolePanel.refresh();
check(consolePanel.counts[0] === 2 && consolePanel.counts[1] === 1 && consolePanel.counts[2] === 1, "exact severity counters");
consolePanel.collapse = true; consolePanel.refresh();
check(consolePanel.rows.length === 3 && consolePanel.repeats[0] === 2, "collapse merges identical messages with count");
consolePanel.show[0] = false; consolePanel.refresh();
check(consolePanel.rows.length === 2 && consolePanel.counts[0] === 2, "severity switches hide independently without changing counters");
consolePanel.show[1] = false; consolePanel.refresh();
check(consolePanel.rows.length === 1 && consolePanel.rows[0].source === "test.ts", "error-only filter");
consolePanel.query = "TEST.TS"; consolePanel.refresh(); check(consolePanel.rows.length === 1, "search includes source path");
consolePanel.query = ""; consolePanel.show = [true, true, true]; consolePanel.refresh();
consolePanel.selected = 2; const selectedId = consolePanel.rows[2].id;
logInfo("Another log"); consolePanel.refresh(false);
check(consolePanel.rows[consolePanel.selected].id === selectedId, "new logs preserve selected message");
consolePanel.render(0, 0, 320, 126, false);
const searchControl = consolePanel.ui.controls[consolePanel.ui.names.indexOf("Search")];
const filterControl = consolePanel.ui.controls[consolePanel.ui.names.indexOf("Level/0")];
check(searchControl.host.px + searchControl.host.sx <= filterControl.host.px, "narrow toolbar search and counters do not overlap");
const controlCount = consolePanel.ui.scene.count();
consolePanel.render(0, 0, 320, 126, false);
check(consolePanel.ui.scene.count() === controlCount, "icon and detail controls keep identity");
consolePanel.follow = false; consolePanel.scroll = 2; const previousRows = consolePanel.rows.length;
logWarn("Arrived while reading"); consolePanel.refresh(false);
check(consolePanel.scroll === 2 + consolePanel.rows.length - previousRows, "paused follow anchors existing rows");
consolePanel.query = "does not exist"; consolePanel.refresh(); consolePanel.render(0, 0, 600, 240, false);
check(consolePanel.rows.length === 0 && consolePanel.selected === -1, "empty search clears stale selection");
scene.clear(); views.camera(1); check(!views.hasCamera, "empty scene has no game camera");
const camObject = scene.createGameObject("MainCamera"); const cam = new Camera(0.8); camObject.addBehavior(cam);
camObject.transform.setPosition(3, 4, 5); camObject.transform.ry = 0.4; scene.computeWorld();
const authorX = S.camX; views.camera(1);
check(views.hasCamera && views.x === 3 && views.y === 4 && views.fov === 0.8 && S.camX === authorX, "game view uses scene camera without moving editor camera");
cam.enabled = 0; views.camera(1); check(!views.hasCamera, "disabled camera ignored");
views.game = false; views.camera(1); check(views.x === S.camX && views.fov === 1, "scene tab restores fly view");
check(scriptEditorArguments("C:/Apps/Code.exe", "C:/Game/My Script.ts", 12)[1] === "C:/Game/My Script.ts:12", "VS Code location argument");
check(scriptEditorArguments("C:/Apps/notepad++.exe", "test.ts", 12)[0] === "-n12", "Notepad++ location argument");
check(scriptEditorArguments("C:/Apps/custom.exe", "test.ts", 12)[0] === "test.ts", "unknown editor keeps plain path");
io.print("[PASSOU] Workspace/Console: filtering, bounded logs, controls, cameras and source arguments");
