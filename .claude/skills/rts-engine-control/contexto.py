"""Contexto vivo do editor RTS pra uma IA se orientar — SEM nada hardcoded.

Tenta a porta de controle do editor (ws://127.0.0.1:<porta>, `contexto`
embutido) e imprime a resposta ao vivo. Sem editor escutando, monta um
contexto OFFLINE lendo o codigo-fonte gerado (catalogo de componentes, itens
de menu) e o manifesto de comandos (via o compilador `rts.exe`, ou
`docs/ws-comandos.md` como ultimo recurso).

So biblioteca padrao do Python (nenhum pacote externo, nem `websockets`):
implementa o handshake e o framing do WebSocket na mao (RFC 6455, so o
necessario pro protocolo texto-por-linha da porta de controle).

Uso:
    python contexto.py [--port N] [secao...]
    RTS_CTRL_PORT=7790 python contexto.py
    python contexto.py --port 7793 componentes

Funciona de qualquer cwd (os caminhos sao relativos a este arquivo) e no
Windows (Git Bash e PowerShell chamam `python contexto.py` igual).
"""
import argparse
import base64
import hashlib
import json
import os
import re
import struct
import subprocess
import sys

PORTA_PADRAO = 7777
TIMEOUT_PADRAO = 1.5

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# .claude/skills/rts-engine-control/contexto.py -> raiz do projeto (3 niveis acima)
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))


def utf8_na_saida():
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


# ── WebSocket mínimo (RFC 6455), só o que a porta de controle usa ──────────

class ErroWs(Exception):
    pass


def _handshake(sock, host, port):
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    req = (
        "GET / HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n" % (host, port, key)
    )
    sock.sendall(req.encode("ascii"))
    resp = b""
    while b"\r\n\r\n" not in resp:
        pedaco = sock.recv(4096)
        if not pedaco:
            raise ErroWs("conexao fechada durante o handshake")
        resp += pedaco
    cabecalho, resto = resp.split(b"\r\n\r\n", 1)
    if b" 101 " not in cabecalho.split(b"\r\n", 1)[0]:
        raise ErroWs("handshake ws falhou: " + cabecalho.split(b"\r\n", 1)[0].decode("latin-1"))
    return bytearray(resto)


def _enviar_texto(sock, texto):
    payload = texto.encode("utf-8")
    mascara = os.urandom(4)
    mascarado = bytes(b ^ mascara[i % 4] for i, b in enumerate(payload))
    n = len(payload)
    if n < 126:
        cabecalho = struct.pack("!BB", 0x81, 0x80 | n)
    elif n < 65536:
        cabecalho = struct.pack("!BBH", 0x81, 0x80 | 126, n)
    else:
        cabecalho = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
    sock.sendall(cabecalho + mascara + mascarado)


def _ler_frame(sock, buf):
    """Lê UM frame WS a partir de `buf` (sobra de leituras anteriores),
    puxando mais bytes do socket se precisar. Devolve (opcode, payload, buf)."""
    def garantir(n):
        while len(buf) < n:
            pedaco = sock.recv(4096)
            if not pedaco:
                raise ErroWs("conexao fechada")
            buf.extend(pedaco)
    garantir(2)
    b0, b1 = buf[0], buf[1]
    opcode = b0 & 0x0F
    mascarado = (b1 & 0x80) != 0
    comprimento = b1 & 0x7F
    offset = 2
    if comprimento == 126:
        garantir(4)
        comprimento = struct.unpack("!H", bytes(buf[2:4]))[0]
        offset = 4
    elif comprimento == 127:
        garantir(10)
        comprimento = struct.unpack("!Q", bytes(buf[2:10]))[0]
        offset = 10
    mascara = b""
    if mascarado:
        garantir(offset + 4)
        mascara = bytes(buf[offset:offset + 4])
        offset += 4
    garantir(offset + comprimento)
    payload = bytes(buf[offset:offset + comprimento])
    if mascarado:
        payload = bytes(b ^ mascara[i % 4] for i, b in enumerate(payload))
    del buf[:offset + comprimento]
    return opcode, payload, buf


def contexto_ao_vivo(porta, timeout, comando):
    """Conecta na porta de controle, manda `comando` e devolve a resposta em
    texto — ou None se não conseguir conectar/saudar a tempo."""
    import socket
    try:
        sock = socket.create_connection(("127.0.0.1", porta), timeout=timeout)
    except OSError:
        return None
    try:
        sock.settimeout(timeout)
        buf = _handshake(sock, "127.0.0.1", porta)
        # saudação do editor: um frame de texto antes de qualquer comando
        opcode, _saudacao, buf = _ler_frame(sock, buf)
        _enviar_texto(sock, comando)
        opcode, payload, buf = _ler_frame(sock, buf)
        while opcode not in (0x1, 0x2):  # pula pings/etc., se algum vier antes
            opcode, payload, buf = _ler_frame(sock, buf)
        return payload.decode("utf-8", "replace")
    except (OSError, ErroWs):
        return None
    finally:
        try:
            sock.close()
        except OSError:
            pass


# ── modo OFFLINE: lê o código-fonte gerado, sem abrir o editor ─────────────

def _ler(rel):
    with open(os.path.join(PROJECT_ROOT, rel), encoding="utf-8") as f:
        return f.read()


def componentes_do_catalogo():
    """[{name, category, description, source}] de src/engine/generated/component_catalog.ts
    (o mesmo arquivo que `npm run components` gera — não uma cópia)."""
    try:
        texto = _ler("src/engine/generated/component_catalog.ts")
    except OSError:
        return []
    m = re.search(r"COMPONENT_CATALOG\s*=\s*(\[[\s\S]*?\n\]);", texto)
    if not m:
        return []
    try:
        return json.loads(m.group(1))
    except ValueError:
        return []


def menus_gerados():
    """MENU_ITEMS de src/engine/generated/editor_extensions.ts."""
    try:
        texto = _ler("src/engine/generated/editor_extensions.ts")
    except OSError:
        return []
    m = re.search(r"MENU_ITEMS:\s*string\[\]\s*=\s*(\[[^\]]*\]);", texto)
    if not m:
        return []
    try:
        return json.loads(m.group(1))
    except ValueError:
        return []


def pacotes_do_disco():
    pasta = os.path.join(PROJECT_ROOT, "assets", "pacotes")
    if not os.path.isdir(pasta):
        return []
    return sorted(nm for nm in os.listdir(pasta) if os.path.isdir(os.path.join(pasta, nm)))


def _localizar_compilador():
    """A mesma busca de tools/rts-compiler.mjs: RTS_COMPILER, rts.exe na raiz,
    RTS_MOTOR, ../rts, e (worktree em build/) um checkout `rts` irmão de um
    ancestral."""
    candidatos = [
        os.environ.get("RTS_COMPILER"),
        os.path.join(PROJECT_ROOT, "rts.exe"),
    ]
    motor = os.environ.get("RTS_MOTOR")
    if motor:
        candidatos.append(os.path.join(motor, "target", "release", "rts.exe"))
    candidatos.append(os.path.abspath(os.path.join(PROJECT_ROOT, "..", "rts", "target", "release", "rts.exe")))
    ancestral = PROJECT_ROOT
    while True:
        pai = os.path.dirname(ancestral)
        if pai == ancestral:
            break
        candidatos.append(os.path.join(pai, "rts", "target", "release", "rts.exe"))
        ancestral = pai
    for c in candidatos:
        if c and os.path.isfile(c):
            return c
    return None


def comandos_do_manifesto_fonte():
    """Roda tools/ws-docs/manifesto.ts pelo compilador (o mesmo que gera
    docs/ws-comandos.md) e devolve o manifesto JSON — comandos embutidos +
    quaisquer comandos de pacote que existam no código-fonte AGORA, sem abrir
    o editor. None se não achar o compilador ou ele falhar/demorar demais."""
    compilador = _localizar_compilador()
    if compilador is None:
        return None
    try:
        r = subprocess.run(
            [compilador, "run", "tools/ws-docs/manifesto.ts"],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    for linha in r.stdout.splitlines():
        if linha.startswith("MANIFESTO "):
            try:
                return json.loads(linha[len("MANIFESTO "):])
            except ValueError:
                return None
    return None


_LINHA_TABELA = re.compile(r"^\|\s*`(?P<syntax>[^`]*)`\s*\|\s*(?P<help>.*?)\s*\|\s*`(?P<example>[^`]*)`\s*\|\s*(?P<undo>\S*)\s*\|\s*(?P<async>\S*)\s*\|\s*$")


def comandos_do_markdown():
    """Último recurso: docs/ws-comandos.md (gerado por `npm run docs:ws` —
    pode estar um commit atrás do código, mas nunca inventado)."""
    try:
        texto = _ler("docs/ws-comandos.md")
    except OSError:
        return []
    grupo = ""
    out = []
    for linha in texto.splitlines():
        if linha.startswith("## "):
            grupo = linha[3:].strip()
            continue
        m = _LINHA_TABELA.match(linha)
        if m:
            nome = m.group("syntax").split(" ")[0]
            out.append({
                "name": nome, "syntax": m.group("syntax"), "help": m.group("help"),
                "example": m.group("example"), "group": grupo,
                "undo": m.group("undo") if m.group("undo") not in ("", "nenhum") else "nenhum",
                "async": m.group("async") == "sim",
            })
    return out


def contexto_offline(secoes_pedidas):
    linhas = ["[contexto] editor fechado — contexto do codigo-fonte (sem abrir o editor)",
              "  pra ligar: RTS_VSYNC=0 <rts>/target/release/examples/ui_fixture.exe main.ts (da raiz do projeto)",
              ""]

    def quer(nome):
        return not secoes_pedidas or nome in secoes_pedidas

    if quer("comandos"):
        manifesto = comandos_do_manifesto_fonte()
        if manifesto is not None:
            cmds = manifesto["commands"]
            linhas.append("[comandos] %d (do manifesto, compilado agora do codigo-fonte)" % len(cmds))
            for c in cmds:
                marcas = [c["group"]]
                if c.get("undo", "nenhum") != "nenhum":
                    marcas.append("undo:" + c["undo"])
                if c.get("async"):
                    marcas.append("async")
                linhas.append("%s :: %s :: %s [%s]" % (c["name"], c["syntax"], c["help"], " ".join(marcas)))
        else:
            cmds = comandos_do_markdown()
            linhas.append("[comandos] %d (de docs/ws-comandos.md — pode estar 1 commit atras; rode npm run docs:ws)" % len(cmds))
            for c in cmds:
                marcas = [c["group"]]
                if c["undo"] != "nenhum":
                    marcas.append("undo:" + c["undo"])
                if c["async"]:
                    marcas.append("async")
                linhas.append("%s :: %s :: %s [%s]" % (c["name"], c["syntax"], c["help"], " ".join(marcas)))
        linhas.append("")

    if quer("componentes"):
        comps = componentes_do_catalogo()
        linhas.append("[componentes] %d (de src/engine/generated/component_catalog.ts — campos exigem o editor aberto: `contexto componentes` ao vivo)" % len(comps))
        for c in comps:
            linhas.append("%s (%s) :: %s [%s]" % (c["name"], c["category"], c["description"], c["source"]))
        linhas.append("")

    if quer("menus"):
        menus = menus_gerados()
        linhas.append("[menus] %d (de src/engine/generated/editor_extensions.ts)" % len(menus))
        linhas.extend(menus)
        linhas.append("")

    if quer("pacotes"):
        pacotes = pacotes_do_disco()
        linhas.append("[pacotes] %d em assets/pacotes: %s" % (len(pacotes), ", ".join(pacotes) if pacotes else "(nenhum)"))
        linhas.append("")

    if quer("sistemas") or quer("cena"):
        linhas.append("[sistemas/cena] só ao vivo (o editor precisa estar rodando pra sondar audio/particulas/input e o estado da cena)")

    return "\n".join(linhas).rstrip() + "\n"


def main():
    utf8_na_saida()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=int(os.environ.get("RTS_CTRL_PORT", PORTA_PADRAO)))
    p.add_argument("--timeout", type=float, default=TIMEOUT_PADRAO)
    p.add_argument("secao", nargs="*", help="comandos|componentes|menus|pacotes|sistemas|cena|json (padrão: tudo, resumido)")
    a = p.parse_args()

    comando = "contexto" + (" " + " ".join(a.secao) if a.secao else "")
    resposta = contexto_ao_vivo(a.port, a.timeout, comando)
    if resposta is not None:
        print(resposta)
        return
    print(contexto_offline(set(a.secao)), end="")


if __name__ == "__main__":
    main()
