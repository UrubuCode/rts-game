import { spawnSync } from "node:child_process";

// Static command + literal arguments only; Windows asks before replacing a file.
export function chooseSceneFile(save: boolean): string {
  const kind = save ? "SaveFileDialog" : "OpenFileDialog";
  const command = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; " +
    "$d=New-Object System.Windows.Forms." + kind + "; $d.Filter='Cenas JSON (*.json)|*.json'; $d.DefaultExt='json'; $d.AddExtension=$true; $d.RestoreDirectory=$true; " +
    (save ? "$d.OverwritePrompt=$true; " : "$d.CheckFileExists=$true; ") +
    "$owner=New-Object System.Windows.Forms.Form; $owner.TopMost=$true; try { if($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK){ [Console]::Write($d.FileName) } } finally { $d.Dispose(); $owner.Dispose() }";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", command], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Nao foi possivel abrir o seletor de cenas.");
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}
