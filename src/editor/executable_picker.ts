import { spawnSync } from "node:child_process";

// Native modal chooser. No user input is interpolated into this command.
export const EXECUTABLE_PICKER_COMMAND = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
  "$dialog.Title = 'Escolher editor de codigo'",
  "$dialog.Filter = 'Aplicativos (*.exe)|*.exe'",
  "$dialog.CheckFileExists = $true",
  "$dialog.Multiselect = $false",
  "$dialog.RestoreDirectory = $true",
  "$owner = New-Object System.Windows.Forms.Form",
  "$owner.TopMost = $true",
  "try { if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) } } finally { $dialog.Dispose(); $owner.Dispose() }",
].join("; ");

export class ExecutableSelection {
  path: string = "";
  error: string = "";
}

export function executableSelection(status: number, output: string): ExecutableSelection {
  const result = new ExecutableSelection();
  if (status !== 0) result.error = "Nao foi possivel abrir o seletor. Informe o caminho manualmente.";
  else result.path = output.trim(); // Empty means Cancel, not reset to system default.
  return result;
}

export function chooseEditorExecutable(): ExecutableSelection {
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", EXECUTABLE_PICKER_COMMAND], { encoding: "utf8" });
    return executableSelection(result.status, typeof result.stdout === "string" ? result.stdout : "");
  } catch { return executableSelection(1, ""); }
}
