// `rts:fs` sobre `node:fs`.
//
// Toda função aqui existe do outro lado; o que muda são os nomes (snake_case
// para camelCase + `Sync`) e, em dois casos, a forma da resposta. Os dois estão
// marcados.

import * as fs from "node:fs";

export default {
  exists(path: string): boolean {
    return fs.existsSync(path);
  },

  read_text(path: string): string {
    return fs.readFileSync(path, "utf8") as string;
  },

  // O antigo devolvia bytes. `readFileSync` sem encoding devolve um `Buffer`,
  // que é indexável e tem `.length` — o suficiente para todo chamador do jogo,
  // que trata o retorno como array de bytes.
  read_all(path: string): any {
    return fs.readFileSync(path);
  },

  write(path: string, data: any): void {
    fs.writeFileSync(path, data);
  },

  size(path: string): number {
    return fs.statSync(path).size;
  },

  is_dir(path: string): boolean {
    // `statSync` LANÇA para um caminho que não existe, onde o `is_dir` antigo
    // respondia `false`. O chamador do jogo pergunta isto varrendo um
    // diretório, onde uma entrada pode sumir entre a listagem e a pergunta —
    // então a resposta honesta para "não existe" é `false`, e não uma exceção.
    try {
      return fs.statSync(path).isDirectory();
    } catch {
      return false;
    }
  },

  readdir(path: string): string[] {
    return fs.readdirSync(path) as string[];
  },

  rename(from: string, to: string): void {
    fs.renameSync(from, to);
  },

  remove_file(path: string): void {
    fs.unlinkSync(path);
  },

  remove_dir_all(path: string): void {
    fs.rmSync(path, { recursive: true, force: true });
  },

  create_dir(path: string): void {
    fs.mkdirSync(path);
  },

  create_dir_all(path: string): void {
    fs.mkdirSync(path, { recursive: true });
  },
};
