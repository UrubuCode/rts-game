"""Cliente da porta de controle do editor (ws://127.0.0.1:7777).

Uso:
    python tools/ws_client.py [--port N] [--json] [--timeout S] [--file ARQ | --stdin] [comando ...]

    python tools/ws_client.py "state" "describe Cubo"
    python tools/ws_client.py --port 7778 "menu Criar/Câmera"
    python tools/ws_client.py --json "doc json" > manifesto.json
    python tools/ws_client.py --file comandos.txt      # um comando por linha (UTF-8)
    echo "find cubo" | python tools/ws_client.py --stdin

Cada argumento é UM comando (use aspas no shell). A resposta de cada comando é
uma mensagem só (pode ter várias linhas).

Saída:
    padrão   "[comando] -> resposta", com a saudação do editor antes.
    --json   só as respostas, cruas, uma por comando; quando a resposta é
             "[etiqueta] {...}" ou "[etiqueta] [...]" (describe json, scene json,
             doc json, ambienteinfo), só o JSON — dá para passar a um parser.

Código de saída: 0 se todas as respostas vieram sem "[erro"; 1 se alguma é
[erro] ou não chegou; 2 se não conectou.

Acentos (Windows/Git Bash): a saída é forçada para UTF-8 e um argumento que
chegou com os bytes UTF-8 lidos como cp1252/latin-1 ("CÃ¢mera") é recomposto
("Câmera"). Antes, a resposta com caractere fora do cp1252 do console fazia o
`print` lançar, e o `except` genérico a mostrava como "(sem resposta)".
Alternativas que não passam pela linha de comando: --file/--stdin (UTF-8).
"""
import argparse
import asyncio
import json
import sys

import websockets

PORTA_PADRAO = 7777
TIMEOUT_PADRAO = 5.0
PREFIXO_ERRO = "[erro"


def utf8_na_saida():
    """stdout/stderr em UTF-8: o console do Windows usa cp1252 por padrão."""
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def recompor_argumento(arg):
    """Desfaz os dois estragos comuns de argv no Windows: bytes inválidos
    guardados como surrogates (surrogateescape) e UTF-8 decodificado como
    cp1252/latin-1 ("CÃ¢mera"). Sem estrago, devolve o argumento como veio."""
    try:
        arg = arg.encode("utf-8", "surrogateescape").decode("utf-8")
    except UnicodeError:
        pass
    if not any(0x80 <= ord(c) <= 0xFF or c in "ÂÃ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ" for c in arg):
        return arg
    for codificacao in ("cp1252", "latin-1"):
        try:
            recomposto = arg.encode(codificacao).decode("utf-8")
        except UnicodeError:
            continue
        if recomposto != arg:
            return recomposto
    return arg


def so_json(resposta):
    """"[etiqueta] {..}" -> "{..}"; o resto volta como veio."""
    fecha = resposta.find("] ")
    if resposta.startswith("[") and fecha > 0:
        corpo = resposta[fecha + 2:]
        if corpo[:1] in ("{", "["):
            try:
                json.loads(corpo)
                return corpo
            except ValueError:
                pass
    return resposta


async def rodar(comandos, porta, modo_json, timeout):
    falhou = False
    try:
        conexao = websockets.connect("ws://127.0.0.1:%d" % porta, max_size=None)
        w = await asyncio.wait_for(conexao, timeout)
    except (OSError, asyncio.TimeoutError, websockets.exceptions.WebSocketException) as erro:
        print("[cliente] nao conectou em ws://127.0.0.1:%d: %s" % (porta, erro), file=sys.stderr)
        return 2
    async with w:
        saudacao = await asyncio.wait_for(w.recv(), timeout)
        if not modo_json:
            print("<-", saudacao)
        for c in comandos:
            await w.send(c)
            try:
                resposta = await asyncio.wait_for(w.recv(), timeout)
            except asyncio.TimeoutError:
                falhou = True
                if modo_json:
                    print(json.dumps({"cmd": c, "erro": "sem resposta em %ss" % timeout}, ensure_ascii=False))
                else:
                    print("[" + c + "] -> (sem resposta em %ss)" % timeout)
                continue
            if resposta.startswith(PREFIXO_ERRO):
                falhou = True
            print(so_json(resposta) if modo_json else "[" + c + "] -> " + resposta)
    return 1 if falhou else 0


def main():
    utf8_na_saida()
    p = argparse.ArgumentParser(description="Cliente da porta de controle do editor RTS.")
    p.add_argument("--port", type=int, default=PORTA_PADRAO, help="porta (padrao %d)" % PORTA_PADRAO)
    p.add_argument("--json", action="store_true", help="so as respostas cruas; JSON puro quando a resposta traz JSON")
    p.add_argument("--timeout", type=float, default=TIMEOUT_PADRAO, help="segundos por resposta")
    p.add_argument("--file", help="arquivo UTF-8 com um comando por linha")
    p.add_argument("--stdin", action="store_true", help="le os comandos da entrada padrao (UTF-8)")
    p.add_argument("comandos", nargs="*", help="um comando por argumento")
    a = p.parse_args()
    comandos = [recompor_argumento(c) for c in a.comandos]
    if a.file:
        with open(a.file, encoding="utf-8") as f:
            comandos += [l.rstrip("\r\n") for l in f if l.strip()]
    if a.stdin:
        entrada = sys.stdin.buffer.read().decode("utf-8", "replace")
        comandos += [l.rstrip("\r") for l in entrada.split("\n") if l.strip()]
    if not comandos:
        p.error("nenhum comando")
    sys.exit(asyncio.run(rodar(comandos, a.port, a.json, a.timeout)))


if __name__ == "__main__":
    main()
