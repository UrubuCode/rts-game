// Imprime o manifesto da porta de controle (o mesmo JSON de `doc json`) com os
// comandos de pacote registrados, para tools/ws-docs/gerar.mjs gerar
// docs/ws-comandos.md sem abrir o editor.
//   node tools/rts-run.mjs tools/ws-docs/manifesto.ts
import io from "@compat/io.ts";
import { setLogEcho } from "@engine/core/logger";
import { instalarEditorReal } from "@editor/editor_host";
import { manifestoComandos } from "@editor/control/commands/doc";

setLogEcho(0);
instalarEditorReal();
io.print("MANIFESTO " + JSON.stringify(manifestoComandos()));
