"""Reempacota PNG sem filtros/deflate: pixels identicos, decoder TS mais barato."""
import struct
import zlib
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[1]/"assets/world-waterfall"
source=root/"rock-moss-base.png"
destination=root/"rock-moss-runtime.png"
image=Image.open(source)
assert image.mode=="RGB", "Entrada deve ser RGB sem conversao de cor"
width,height=image.size
pixels=image.tobytes()
stride=width*3
scan=b"".join(b"\0"+pixels[y*stride:(y+1)*stride] for y in range(height))
def chunk(kind,data):
    return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)
destination.write_bytes(b"\x89PNG\r\n\x1a\n"+
    chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,2,0,0,0))+
    chunk(b"IDAT",zlib.compress(scan,0))+chunk(b"IEND",b""))
assert Image.open(destination).tobytes()==pixels
print("PNG lossless verificado:",destination)
