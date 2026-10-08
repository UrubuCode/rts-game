"""Conversao tecnica glTF/PNG para a engine; preserva geometria integral."""
import copy
import json
import math
import random
import struct
import zlib
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/"assets/vendor/polyhaven"

def png(path,image):
    image=image.convert("RGBA")
    w,h=image.size;raw=image.tobytes();stride=w*4
    scan=b"".join(b"\0"+raw[y*stride:(y+1)*stride] for y in range(h))
    def chunk(kind,data):return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)
    path.write_bytes(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,6,0,0,0))+chunk(b"IDAT",zlib.compress(scan,0))+chunk(b"IEND",b""))
    assert Image.open(path).tobytes()==image.tobytes()

models={}
for asset in ("rock_moss_set_01","pine_sapling_small","fern_02"):
    folder=BASE/asset;data=json.loads((folder/(asset+".gltf")).read_text())
    for image in data.get("images",[]):
        path=folder/image["uri"];target=path.with_suffix(".png")
        pixels=Image.open(path).convert("RGBA")
        if "diff" in path.name and (asset=="fern_02" or "twig" in path.name):
            alpha=Image.open(folder/("Alpha.png" if asset=="fern_02" else "twig_alpha.png")).convert("L")
            if alpha.size!=pixels.size: raise ValueError("Dimensoes alpha/diff diferentes")
            pixels.putalpha(alpha)
        png(target,pixels);image["uri"]=target.relative_to(folder).as_posix()
    for index,mesh in enumerate(data["meshes"]):
        variant=copy.deepcopy(data)
        variant["meshes"]=[mesh];variant["nodes"]=[{"mesh":0}];variant["scenes"]=[{"nodes":[0]}];variant["scene"]=0
        # Transforms de exposicao do conjunto nao fazem parte de uma instancia.
        path=folder/f"runtime-{index}.gltf";path.write_text(json.dumps(variant,separators=(",",":")))
    models[asset]=data

ground=BASE/"forest_ground_04"
for name in ("Diffuse","nor_gl","Rough"):png(ground/(name+".png"),Image.open(ground/(name+".jpg")))

def material(asset,mat):
    data=models[asset];folder=BASE/asset
    def path(info):
        if not info:return ""
        return (folder/data["images"][data["textures"][info["index"]]["source"]]["uri"]).relative_to(ROOT).as_posix()
    p=mat.get("pbrMetallicRoughness",{})
    return {"type":"material","pbr":1,"metallic":p.get("metallicFactor",0),"roughness":p.get("roughnessFactor",1),
            "tile":0,"texturePath":path(p.get("baseColorTexture")),"normalPath":path(mat.get("normalTexture")),
            "metallicRoughnessPath":path(p.get("metallicRoughnessTexture")),"normalScale":.8}

scene=json.loads((ROOT/"scenes/waterfall-world.json").read_text())
scene["name"]="Vale da Cachoeira - Poly Haven / teste pesado"
keep={"Sol de fim de tarde","Terreno da cachoeira","Rio superior","Queda de agua","Piscina natural","Gotas da queda","Espuma e nevoa"}
scene["objects"]=[o for o in scene["objects"] if o["name"] in keep]
terrain=next(o for o in scene["objects"] if o["name"]=="Terreno da cachoeira")
terrain["color"]=[220,230,210]
terrain["scripts"]=[c for c in terrain["scripts"] if c["type"]!="material"]
terrain["scripts"].append({"type":"material","pbr":1,"metallic":0,"roughness":.95,"tile":.17,
    "texturePath":(ground/"Diffuse.png").relative_to(ROOT).as_posix(),"normalPath":(ground/"nor_gl.png").relative_to(ROOT).as_posix(),"normalScale":.6})
t=terrain["scripts"][0];n=t["resolution"];size=t["size"]
def height(x,z):
    fx=max(0,min(n-1,(x/size+.5)*n));fz=max(0,min(n-1,(z/size+.5)*n));c=int(fx);r=int(fz);u=fx-c;v=fz-r;a=r*(n+1)+c;h=t["heights"]
    return h[a]+(h[a+1]-h[a])*u+(h[a+n+1]-h[a])*v if u+v<=1 else h[a+n+2]+(h[a+n+1]-h[a+n+2])*(1-u)+(h[a+1]-h[a+n+2])*(1-v)

triangle_total=0
def place(asset,index,name,pos,scale,yaw):
    global triangle_total
    data=models[asset];mesh=data["meshes"][index]
    bounds=[data["accessors"][p["attributes"]["POSITION"]] for p in mesh["primitives"]]
    center=[(min(b["min"][k] for b in bounds)+max(b["max"][k] for b in bounds))*.5 for k in range(3)]
    center[1]=min(b["min"][1] for b in bounds)
    x=center[0]*scale[0];z=center[2]*scale[2]
    origin=[pos[0]-x*math.cos(yaw)-z*math.sin(yaw),pos[1]-center[1]*scale[1],pos[2]-z*math.cos(yaw)+x*math.sin(yaw)]
    for part,p in enumerate(mesh["primitives"]):
        triangle_total+=data["accessors"][p["indices"]]["count"]//3
        scene["objects"].append({"name":name+f" / {part}","mesh":1,"meshPath":f"assets/vendor/polyhaven/{asset}/runtime-{index}.gltf",
            "meshPart":part,"pos":origin,"rot":[0,yaw,0],"scale3":scale,"color":[255,255,255],"stationary":1,
            "scripts":[material(asset,data["materials"][p["material"]])]})

random.seed(912)
for side in (-1,1):
    for j in range(5):
        x=side*(3.5+j*3.5);z=3+math.sin(x*.24)
        place("rock_moss_set_01",j%6,f"Rocha escarpa {side} {j}",[x,-.5,z],[3.2,3.2,3.2],random.random()*math.tau)
for i in range(20):
    angle=random.random()*math.tau;r=random.uniform(7.5,14);x=math.cos(angle)*r;z=-4+math.sin(angle)*r
    if z>2 and abs(x)<5:continue
    s=random.uniform(.5,1.3)
    place("rock_moss_set_01",i%6,f"Rocha margem {i}",[x,height(x,z)-.25,z],[s,s,s],random.random()*math.tau)
for i,(x,z) in enumerate([(-13,-8),(-18,0),(-12,12),(-20,19),(13,10),(20,18),(26,25),(-26,30)]):
    s=random.uniform(5.5,8.0)
    place("pine_sapling_small",i%3,f"Pinheiro real {i}",[x,height(x,z),z],[s,s,s],random.random()*math.tau)
for i in range(16):
    x=random.choice((-1,1))*random.uniform(8,16);z=random.uniform(-13,3);s=random.uniform(.7,1.2)
    place("fern_02",i%4,f"Samambaia {i}",[x,height(x,z),z],[s,s,s],random.random()*math.tau)
scene["camera"]=[20,13,-36,-.5,-.17]
(ROOT/"scenes/waterfall-polyhaven.json").write_text(json.dumps(scene,separators=(",",":")))
print("Cena:",len(scene["objects"]),"objetos;",triangle_total,"triangulos de assets (sem terrain/agua)")
