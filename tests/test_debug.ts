import io from "@compat/io";
import { Debug } from "@engine/debug";
import { logClear, logEntries, logInfo, logTick, setLogEcho, setLogLevel, LOG_INFO, LOG_WARN, LOG_ERROR } from "@engine/core/logger";
import { ConsolePanel } from "@editor/console_panel";

function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
setLogEcho(0); logClear(); setLogLevel(LOG_INFO); logTick();
Debug.Log("Game started"); Debug.LogWarning("Texture missing"); Debug.LogError("Invalid object");
const entries = logEntries();
check(entries.length === 3, "Debug shares engine history");
check(entries[0].message === "Game started" && entries[0].level === LOG_INFO, "Log is info");
check(entries[1].level === LOG_WARN && entries[2].level === LOG_ERROR, "warning and error routing");
check(entries[0].frame > 0 && entries[0].id < entries[1].id, "shared frame and identity");
logInfo("Legacy caller"); Debug.Log(42); Debug.Log(false); Debug.Log(null); Debug.Log({ hp: 100 });
const formatted = logEntries();
check(formatted[3].message === "Legacy caller", "existing API stays compatible");
check(formatted[4].message === "42" && formatted[5].message === "false" && formatted[6].message === "null", "primitive values accepted");
check(formatted[7].message === '{"hp":100}', "objects formatted for inspection");
const panel = new ConsolePanel(null); panel.refresh();
check(panel.counts[0] === 6 && panel.counts[1] === 1 && panel.counts[2] === 1, "Console consumes the same logger");
setLogLevel(LOG_ERROR); const before = logEntries().length; Debug.Log("filtered"); Debug.LogWarning("filtered");
check(logEntries().length === before, "Debug respects engine log level");
Debug.LogError("visible"); check(logEntries().length === before + 1, "errors remain visible");
setLogLevel(LOG_INFO);
io.print("[PASSOU] Debug: familiar API, shared logger, formatting, levels and Console");
