import { logInfo, logWarn, logError } from "./core/logger";

function messageText(message: any): string {
  if (message === null) return "null";
  if (message === undefined) return "undefined";
  if (typeof message === "string") return message;
  if (typeof message === "object") {
    try { const json = JSON.stringify(message); if (typeof json === "string") return json; } catch {}
  }
  return String(message);
}

// Familiar scripting API; the engine logger remains the single destination.
// No dependency on the editor, a window, or the generated component registry.
export class Debug {
  static Log(message: any): void { logInfo(messageText(message)); }
  static LogWarning(message: any): void { logWarn(messageText(message)); }
  static LogError(message: any): void { logError(messageText(message)); }
}
