import fs from "@compat/fs";
import process from "@compat/process";

// Installation hints, not a list of assumed installed applications.
// Paths stay here; the preferences UI only consumes detected choices.
export const CODE_EDITOR_HINTS = [
  { name: "Visual Studio Code", local: "Programs/Microsoft VS Code/Code.exe", system: "Microsoft VS Code/Code.exe" },
  { name: "VS Code Insiders", local: "Programs/Microsoft VS Code Insiders/Code - Insiders.exe", system: "Microsoft VS Code Insiders/Code - Insiders.exe" },
  { name: "Cursor", local: "Programs/cursor/Cursor.exe", system: "Cursor/Cursor.exe" },
  { name: "Antigravity", local: "Programs/antigravity/Antigravity.exe", system: "Antigravity/Antigravity.exe" },
  { name: "Windsurf", local: "Programs/Windsurf/Windsurf.exe", system: "Windsurf/Windsurf.exe" },
  { name: "Sublime Text", local: "Programs/Sublime Text/sublime_text.exe", system: "Sublime Text/sublime_text.exe" },
  { name: "Notepad++", local: "Programs/Notepad++/notepad++.exe", system: "Notepad++/notepad++.exe" },
];

export class CodeEditorChoice {
  name: string; path: string;
  constructor(name: string, path: string) { this.name = name; this.path = path; }
}

export function sameEditorPath(a: string, b: string): boolean {
  return a.split("\\").join("/").toLowerCase() === b.split("\\").join("/").toLowerCase();
}

export function detectCodeEditors(local: string, programFiles: string, programFilesX86: string): CodeEditorChoice[] {
  const found: CodeEditorChoice[] = [];
  let i = 0;
  while (i < CODE_EDITOR_HINTS.length) {
    const hint = CODE_EDITOR_HINTS[i];
    const roots = [local, programFiles, programFilesX86];
    let rootIndex = 0;
    let selected = "";
    while (rootIndex < roots.length && selected.length === 0) {
      const root = roots[rootIndex];
      if (root.length > 0) {
        const candidate = root + "/" + (rootIndex === 0 ? hint.local : hint.system);
        if (fs.exists(candidate) && !fs.is_dir(candidate)) selected = candidate;
      }
      rootIndex = rootIndex + 1;
    }
    if (selected.length > 0) found.push(new CodeEditorChoice(hint.name, selected));
    i = i + 1;
  }
  return found;
}

export function installedCodeEditors(): CodeEditorChoice[] {
  return detectCodeEditors(process.env("LOCALAPPDATA"), process.env("ProgramFiles"), process.env("ProgramFiles(x86)"));
}
