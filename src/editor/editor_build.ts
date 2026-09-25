import { spawn } from "node:child_process";
import fs from "@compat/fs";
import { saveScene } from "./sceneio";
import { logInfo, logError } from "@engine/core/logger";
import { S } from "./control/session";

const BUILD_POLL_MS = 500;
const BUILD_START_TIMEOUT_MS = 30000;
const BUILD_FINISH_TIMEOUT_MS = 600000;

export class EditorBuild {
  child: any = null;
  running: boolean = false; status: string = ""; directory: string = ""; lastPoll: number = 0; started: number = 0;
  start(): void {
    if (this.running || S.simulating !== 0) return;
    try {
      this.directory = "build/editor-build-" + Date.now(); fs.create_dir_all(this.directory);
      saveScene(this.directory + "/scene.json");
      fs.write(this.directory + "/status.json", JSON.stringify({ state: "starting", message: "Iniciando build..." }));
      // Keep the native event emitter rooted while the editor pumps events.
      this.child = spawn("node", ["tools/editor-build.mjs", this.directory], { stdio: "ignore" });
      // Missing Node must become a Console error, not an unhandled error event.
      this.child.on("error", (error: any) => {
        this.running = false; this.status = "Nao foi possivel iniciar Node.js: " + String(error); logError(this.status);
      });
      if (typeof this.child.pid !== "number") throw new Error("Node.js nao encontrado no PATH.");
      this.child.unref();
      this.started = Date.now(); this.running = true; this.status = "Compilando jogo..."; logInfo(this.status);
    } catch (error) { this.running = false; this.status = "Build falhou: " + String(error); logError(this.status); }
  }
  poll(): void {
    if (!this.running || Date.now() - this.lastPoll < BUILD_POLL_MS) return;
    this.lastPoll = Date.now();
    if (this.lastPoll - this.started >= BUILD_FINISH_TIMEOUT_MS) {
      this.running = false; this.status = "Build sem resposta. Consulte " + this.directory; logError(this.status); return;
    }
    try {
      const data = JSON.parse(fs.read_text(this.directory + "/status.json"));
      if (data.state === "running" || data.state === "starting") {
        const timeout = data.state === "starting" ? BUILD_START_TIMEOUT_MS : BUILD_FINISH_TIMEOUT_MS;
        if (Date.now() - this.started < timeout) return;
        this.running = false; this.status = "Build sem resposta. Confira Node.js, RTS_COMPILER e " + this.directory; logError(this.status); return;
      }
      this.running = false; this.status = data.message;
      if (fs.exists(this.directory + "/output.log")) {
        const lines = fs.read_text(this.directory + "/output.log").split("\n");
        let i = 0; while (i < lines.length) { if (lines[i].trim().length > 0) {
          if (data.state === "ok") logInfo(lines[i]); else logError(lines[i]);
        } i = i + 1; }
      }
      // Keep the actionable result visible even in a short Console pane.
      if (data.state === "ok") logInfo(this.status); else logError(this.status);
    } catch {} // Writer publishes status atomically; keep polling a transient miss.
  }
}
