// Navegacao de pastas do Project. O disco e lido somente ao atualizar a arvore,
// expandir um ramo ou revelar uma pasta; o desenho usa as linhas em cache.
import fs from "../compat/fs.ts";
import { UI_PROJECT_TREE_MAX_DEPTH } from "./ui_config";

export class ProjectTree {
  root: string;
  paths: string[];
  labels: string[];
  depths: number[];
  branches: number[];
  expanded: string[];

  constructor(root: string) {
    this.root = root;
    this.paths = []; this.labels = []; this.depths = []; this.branches = [];
    this.expanded = [root];
  }

  isExpanded(path: string): boolean {
    return this.expanded.indexOf(path) >= 0;
  }

  refresh(): void {
    this.paths = []; this.labels = []; this.depths = []; this.branches = [];
    this.append(this.root, this.root, 0);
  }

  append(path: string, label: string, depth: number): void {
    const folders: string[] = [];
    try {
      const entries = fs.readdir(path);
      let entryIndex = 0;
      while (entryIndex < entries.length) {
        if (fs.is_dir(path + "/" + entries[entryIndex])) folders.push(entries[entryIndex]);
        entryIndex = entryIndex + 1;
      }
    } catch {
      // Uma pasta sem permissao continua visivel e nao derruba o editor.
    }
    folders.sort();
    this.paths.push(path); this.labels.push(label); this.depths.push(depth);
    this.branches.push(folders.length > 0 && depth < UI_PROJECT_TREE_MAX_DEPTH ? 1 : 0);
    if (!this.isExpanded(path) || depth >= UI_PROJECT_TREE_MAX_DEPTH) return;
    let childIndex = 0;
    while (childIndex < folders.length) {
      this.append(path + "/" + folders[childIndex], folders[childIndex], depth + 1);
      childIndex = childIndex + 1;
    }
  }

  toggle(path: string): void {
    const idx = this.expanded.indexOf(path);
    if (idx >= 0) this.expanded.splice(idx, 1);
    else this.expanded.push(path);
    this.refresh();
  }

  // Navegar pelo grid ou subir uma pasta tambem revela sua linha na arvore.
  reveal(path: string): void {
    if (path !== this.root && path.indexOf(this.root + "/") !== 0) return;
    let i = this.root.length;
    while (i < path.length) {
      if (path.charCodeAt(i) === 47) {
        const ancestor = path.substring(0, i);
        if (!this.isExpanded(ancestor)) this.expanded.push(ancestor);
      }
      i = i + 1;
    }
    this.refresh();
  }
}
