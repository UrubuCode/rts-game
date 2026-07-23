import asyncio, sys, websockets
async def main():
    cmds = sys.argv[1:]
    async with websockets.connect("ws://127.0.0.1:7777") as w:
        print("<-", await asyncio.wait_for(w.recv(), 3))
        for c in cmds:
            await w.send(c)
            try: print("["+c+"] ->", await asyncio.wait_for(w.recv(), 3))
            except: print("["+c+"] -> (sem resposta)")
asyncio.run(main())
