// Teste SEM JANELA do prefixador de CSS e da separação do HTML de um DomCanvas.
//   rts.exe run tests/test_dom_css.ts
import io from "@compat/io.ts";
import { seletorEscopo, prefixarSeletor, prefixarCss, prepararHtml, scriptsRemovidos } from "@engine/ui/dom_css";

function check(c: boolean, m: string): void { if (!c) throw new Error(m + "\n"); }
function igual(obtido: string, esperado: string, m: string): void {
  if (obtido !== esperado) throw new Error(m + "\n  obtido:   " + obtido + "\n  esperado: " + esperado);
}
const E = seletorEscopo(7);
igual(E, "[data-go=\"7\"]", "escopo por atributo");
igual(prefixarSeletor("p", E), E + " p", "seletor simples");
igual(prefixarSeletor(" .a > b ", E), E + " .a > b", "combinador preservado");
igual(prefixarSeletor(":root", E), E, ":root vira a raiz");
igual(prefixarSeletor("body.escuro p", E), E + ".escuro p", "composto colado à raiz fica colado");
igual(prefixarSeletor("html > body .x", E), E + " .x", "html > body some");
igual(prefixarSeletor("bodyguard", E), E + " bodyguard", "nome que só começa com body não é raiz");
igual(prefixarCss("p{color:red}", E), E + " p{color:red}", "regra");
igual(prefixarCss("h1, .a > b{x:1}", E), E + " h1, " + E + " .a > b{x:1}", "lista");
igual(prefixarCss("html,body{margin:0}", E), E + ", " + E + "{margin:0}", "html,body");
igual(prefixarCss(":is(h1, h2) span{a:1}", E), E + " :is(h1, h2) span{a:1}", "vírgula entre parênteses não separa");
igual(prefixarCss("/* c */ a:hover{b:1}", E), E + " a:hover{b:1}", "comentário some");
igual(prefixarCss("@media (max-width: 600px){p{a:1} .b{c:2}}", E),
      "@media (max-width: 600px){" + E + " p{a:1}\n" + E + " .b{c:2}}", "@media prefixado por dentro");
igual(prefixarCss("@keyframes pulso{from{opacity:0}to{opacity:1}}", E), "@keyframes pulso{from{opacity:0}to{opacity:1}}", "@keyframes intacto");
igual(prefixarCss("@font-face{font-family:x}", E), "@font-face{font-family:x}", "@font-face intacto");
igual(prefixarCss("@import url(x.css);", E), "@import url(x.css);", "@import intacto");
igual(prefixarCss("a{b:1}\n\n c{d:2}", E), E + " a{b:1}\n" + E + " c{d:2}", "regras em linhas");
igual(prefixarCss("", E), "", "vazio");

const doc = "<!doctype html><html><head><title>x</title><style>p{color:red}</style></head>" +
  "<body><p>oi</p><script>alert(1)</script></body></html>";
igual(prepararHtml(doc, ".b{c:1}", E), "<style>" + E + " p{color:red}\n" + E + " .b{c:1}</style><p>oi</p>", "documento completo");
check(scriptsRemovidos() === 1, "<script> contado");
igual(prepararHtml("<div id=\"a\">x</div>", "", E), "<div id=\"a\">x</div>", "fragmento sem CSS");
igual(prepararHtml("<style>i{a:1}</style><i>x</i>", "", E), "<style>" + E + " i{a:1}</style><i>x</i>", "<style> no corpo");
check(scriptsRemovidos() === 0, "sem script");
io.print("[PASSOU] dom_css: prefixador (raiz, listas, @media, @keyframes) e HTML (corpo, estilos, scripts)");
