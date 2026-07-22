#!/usr/bin/env python3
"""Cliente da porta de controle TCP da Engine RTS (netharness.ts).

Uso:
  python tools/control_client.py            # modo interativo (digite comandos)
  python tools/control_client.py --script <arquivo>   # envia linhas de um arquivo
  echo -e 'spawn a 0 1 0\nstep 5\nstate\nquit' | python tools/control_client.py

Conecta em 127.0.0.1:7777, envia cada linha e imprime a resposta.
"""
import socket, time, sys, argparse

def recvall(s):
    time.sleep(0.12)
    s.settimeout(1.5)
    data = b""
    try:
        while True:
            chunk = s.recv(4096)
            if not chunk: break
            data += chunk
            if len(chunk) < 4096: break
    except socket.timeout:
        pass
    return data.decode(errors="replace")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7777)
    ap.add_argument("--script")
    a = ap.parse_args()
    s = socket.create_connection((a.host, a.port), timeout=5)
    print(recvall(s), end="")
    if a.script:
        lines = open(a.script).read().splitlines()
    elif not sys.stdin.isatty():
        lines = sys.stdin.read().splitlines()
    else:
        lines = None  # interativo
    if lines is not None:
        for cmd in lines:
            if not cmd.strip(): continue
            s.sendall((cmd + "\n").encode())
            print(f">>> {cmd}\n{recvall(s)}", end="")
            if cmd.strip() in ("quit", "exit"): break
    else:
        try:
            while True:
                cmd = input("rts> ").strip()
                if not cmd: continue
                s.sendall((cmd + "\n").encode())
                print(recvall(s), end="")
                if cmd in ("quit", "exit"): break
        except (EOFError, KeyboardInterrupt):
            pass
    s.close()

if __name__ == "__main__":
    main()
