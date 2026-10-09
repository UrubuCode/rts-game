"""Captura quadros reais do editor pela API da engine e monta a prévia GIF.

Com a cena wave-demo aberta: python tools/capture-wave-demo.py --port 7791
Requer websockets e Pillow. Os quadros são poses amostradas do clipe; não é
uma medição de FPS nem uma gravação em tempo real.
"""
import argparse
import asyncio
from pathlib import Path

import websockets
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = 32
DURATION = 3.8


async def capture(port):
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.recv()  # saudação

        async def command(text):
            await ws.send(text)
            reply = await asyncio.wait_for(ws.recv(), 30)
            if reply.startswith("[erro]"):
                raise RuntimeError(reply)
            return reply

        await command("anim WaveDemo preview pause")
        files = []
        try:
            for i in range(FRAMES):
                await command(f"anim WaveDemo preview seek {i * DURATION / FRAMES:.6f}")
                filename = f"build/wave-frames/frame-{i:02d}.png"
                await command(f"shot {filename} jogo")
                files.append(ROOT / filename)
                if i % 8 == 0:
                    print(f"Capturados {i + 1}/{FRAMES}", flush=True)
        finally:
            await command("anim WaveDemo preview play")

    images = [Image.open(file).convert("RGB") for file in files]
    output = ROOT / "build/wave-demo.gif"
    images[0].save(output, save_all=True, append_images=images[1:],
                   duration=round(DURATION * 1000 / FRAMES), loop=0)
    for image in images:
        image.close()
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7791)
    asyncio.run(capture(parser.parse_args().port))
