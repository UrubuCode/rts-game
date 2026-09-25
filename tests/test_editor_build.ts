import io from "@compat/io";
import fs from "@compat/fs";
import { EditorBuild } from "@editor/editor_build";
import { S } from "@editor/control/session";
import { logEntries, logClear, setLogEcho, LOG_ERROR } from "@engine/core/logger";

function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
setLogEcho(0); logClear();
const builder = new EditorBuild();
S.simulating = 1; builder.start(); check(!builder.running, "play cannot start a build"); S.simulating = 0;
builder.directory = "build/build-status-test-" + Date.now(); fs.create_dir_all(builder.directory);
fs.write(builder.directory + "/status.json", JSON.stringify({ state: "ok", message: "Build concluido: test.exe" }));
fs.write(builder.directory + "/output.log", "compiler output\n");
builder.started = Date.now(); builder.running = true; builder.poll();
check(!builder.running && builder.status === "Build concluido: test.exe", "read successful completion");
const rows = logEntries(); check(rows[rows.length - 1].message === builder.status, "result is last visible row");
fs.write(builder.directory + "/status.json", JSON.stringify({ state: "error", message: "Compilation failed" }));
builder.running = true; builder.lastPoll = 0; builder.poll();
check(!builder.running && logEntries(LOG_ERROR).length > 0, "compile failure reaches Console");
fs.write(builder.directory + "/status.json", "invalid JSON");
builder.started = 0; builder.running = true; builder.lastPoll = 0; builder.poll();
check(!builder.running && builder.status.indexOf("sem resposta") >= 0, "missing/corrupt completion cannot poll forever");
io.print("[PASSOU] EditorBuild: play guard, success, failure, visible result and timeout");
