// Teste SEM JANELA de `contexto`: o retrato do editor pra uma IA, gerado só
// de registros do runtime (manifesto de comandos, catálogo de componentes,
// menus, pacotes em disco, sondas de sistema e a sessão da cena) — nada
// hardcoded. Confere que um comando REGISTRADO agora (sem tocar em
// contexto.ts) já aparece, que um componente do catálogo aparece com campos,
// que as seções existem e que `contexto json` é JSON válido com a mesma
// forma.
//
//   rts.exe run tests/test_ws_contexto.ts
import { registerCommand } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { COMPONENT_CATALOG } from "@engine/generated/component_catalog";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
instalarEditorReal();
check(registerCommand("teste_contexto_pacote", "teste_contexto_pacote <x> :: comando de teste registrado agora :: teste_contexto_pacote 1", false,
  (p: string[]) => "[ok]"), "registra comando de teste");
history.u = []; history.r = [];

// ── resumo padrão: todas as 6 seções, sem argumento ─────────────────────────
const resumo = execCommand(800, 600, "contexto");
check(resumo.indexOf("[contexto] ") === 0, "contexto: " + resumo.slice(0, 60));
check(resumo.indexOf("[contexto:comandos]") > 0, "secao comandos");
check(resumo.indexOf("[contexto:componentes]") > 0, "secao componentes");
check(resumo.indexOf("[contexto:menus]") > 0, "secao menus");
check(resumo.indexOf("[contexto:pacotes]") > 0, "secao pacotes");
check(resumo.indexOf("[contexto:sistemas]") > 0, "secao sistemas");
check(resumo.indexOf("[contexto:cena]") > 0, "secao cena");

// ── um comando registrado NESTE teste (não em contexto.ts) já aparece ──────
check(resumo.indexOf("teste_contexto_pacote") > 0, "comando de pacote registrado agora aparece sem mudar contexto.ts");
const soComandos = execCommand(800, 600, "contexto comandos");
check(soComandos.indexOf("teste_contexto_pacote <x> :: comando de teste registrado agora") > 0,
  "contexto comandos mostra sintaxe+ajuda do comando novo: " + soComandos.slice(0, 200));

// ── um componente do catálogo aparece com os campos reais da instância ─────
check(COMPONENT_CATALOG.length > 0, "catalogo gerado nao esta vazio (npm run components rodou)");
const alvo = COMPONENT_CATALOG.find(c => c.name === "Spinner") || COMPONENT_CATALOG[0];
const soComponentes = execCommand(800, 600, "contexto componentes");
check(soComponentes.indexOf(alvo.name + " (" + alvo.category + ")") > 0, "componente do catalogo aparece: " + alvo.name);
const detalhe = execCommand(800, 600, "contexto componentes " + alvo.name);
check(detalhe.indexOf("[contexto:componentes] " + alvo.name) === 0, "ficha detalhada: " + detalhe.slice(0, 80));
check(execCommand(800, 600, "contexto componentes NaoExiste123").indexOf("[erro]") === 0, "componente inexistente da erro");

// ── seção desconhecida dá erro; seções focadas batem com a completa ────────
check(execCommand(800, 600, "contexto zzz").indexOf("[erro]") === 0, "secao desconhecida");
check(execCommand(800, 600, "contexto menus").indexOf("[contexto:menus]") === 0, "so a secao pedida, sem as outras");
check(execCommand(800, 600, "contexto menus").indexOf("[contexto:comandos]") < 0, "so a secao pedida (nao mistura outras)");

// ── contexto json: JSON válido, mesma forma das seções em texto ────────────
const j = execCommand(800, 600, "contexto json");
check(j.indexOf("[contexto] ") === 0, "contexto json: " + j.slice(0, 60));
const d = JSON.parse(j.slice("[contexto] ".length));
check(Array.isArray(d.comandos.commands) && d.comandos.commands.length > 0, "json.comandos.commands");
check(Array.isArray(d.componentes) && d.componentes.length === COMPONENT_CATALOG.length, "json.componentes == catalogo gerado");
check(Array.isArray(d.componentes[0].fields), "componente tem 'fields' (introspeccao real, nao so nome/categoria)");
check(Array.isArray(d.menus), "json.menus");
check(Array.isArray(d.pacotes), "json.pacotes");
check(typeof d.sistemas.audio.pronto === "boolean" && typeof d.sistemas.particulas.drawParticlesDisponivel === "boolean" &&
  typeof d.sistemas.input.droppedCountDisponivel === "boolean", "json.sistemas: audio/particulas/input sondados");
check(typeof d.cena.objetos === "number" && typeof d.cena.playing === "boolean", "json.cena");
let achouPacote = false;
let ki = 0;
while (ki < d.comandos.commands.length) { if (d.comandos.commands[ki].name === "teste_contexto_pacote") achouPacote = true; ki = ki + 1; }
check(achouPacote, "json tambem traz o comando de pacote registrado neste teste");

// consulta: nao entra no Desfazer
check(history.undoDepth() === 0, "contexto e consulta, sem Desfazer");
println("[PASSOU] ws contexto: comandos/componentes/menus/pacotes/sistemas/cena ao vivo do runtime, json valido, secoes focadas, comando de pacote sem mudar contexto.ts");
