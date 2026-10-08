"""Paisagem deterministica com malhas agrupadas e materiais PBR existentes."""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/world-waterfall"
OUT.mkdir(exist_ok=True)
random.seed(712)
scene = json.loads((ROOT / "scenes/waterfall-demo.json").read_text())
scene["name"] = "Vale da Cachoeira - luz de fim de tarde"
scene["camera"] = [17, 12, -28, -.48, -.16]
scene["objects"] = [o for o in scene["objects"] if o["mesh"] == 0]
sun = scene["objects"][0]
sun["name"] = "Sol de fim de tarde"
sun["rot"] = [-.55, -.8, 0]
sun["scripts"][0]["fields"].update(cor=0xFFE0AF, intensidade=1.5, sombra=True)
scene["ambiente"] = {
    "exposicao": 1.1,
    "ceu": {"modo": "procedural", "topo": [.18,.34,.55], "horizonte": [.85,.66,.43],
            "chao": [.13,.16,.12], "estrelas": 0, "exposicao": 1, "tamanhoSol": .025},
    "neblina": {"cor": [.49,.58,.62], "densidade": .001},
    "luzAmbiente": {"modo": "ceu", "cor": [.65,.78,1], "intensidade": .25},
    "sol": sun["name"]}

def material(texture="stone", roughness=.9, tile=.35):
    return {"type":"material", "pbr":1, "metallic":0, "roughness":roughness,
            "texturePath":"assets/world-waterfall/rock-moss-runtime.png" if texture=="stone" else f"assets/pbr/{texture}-base.png",
            "normalPath":"" if texture=="stone" else f"assets/pbr/{texture}-normal.png",
            "normalScale":.65, "tile":tile, "occlusionStrength":.7}

def height(x,z):
    edge = 3.3 + 1.1*math.sin(x*.24) + .55*math.sin(x*.83)
    upper = 10*max(0,min(1,(z-edge)/2))
    # O canal preserva a conexao com o topo da queda.
    if abs(x)<4 and z>3: upper=10*max(0,min(1,(z-2.3)/1.2))
    basin = -3.2*max(0,1-(x/8.1)**2-((z+4)/8.4)**2)
    ground=.65+.35*math.sin(x*.41)*math.cos(z*.29)+.12*math.sin(x*1.2+z*.55)
    channel=1.15*max(0,1-(x/3.5)**4) if z>3 else 0
    hills=9*math.exp(-((x+22)/13)**2-((z-22)/15)**2)+15*math.exp(-((x-26)/18)**2-((z-37)/20)**2)
    return upper+ground+basin-channel+hills

terrain=next(o for o in scene["objects"] if o["name"]=="Terreno da cachoeira")
n,size=96,120
terrain["scripts"]=[{"type":"terrain", "size":size,"resolution":n,
                     "heights":[height((c/n-.5)*size,(r/n-.5)*size) for r in range(n+1) for c in range(n+1)]}, material()]
terrain["color"]=[113,130,87]

class Mesh:
    def __init__(self): self.vertices=[]; self.faces=[]
    def triangle(self,a,b,c):
        base=len(self.vertices)+1
        self.vertices.extend((a,b,c)); self.faces.append((base,base+1,base+2))
    def save(self,name):
        lines=[]
        for p in self.vertices: lines.append("v %.5f %.5f %.5f"%p)
        for p in self.vertices: lines.append("vt %.5f %.5f"%(p[0]*.3+p[2]*.1,p[1]*.3+p[2]*.2))
        for i,face in enumerate(self.faces):
            a,b,c=(self.vertices[j-1] for j in face)
            u=[b[k]-a[k] for k in range(3)];v=[c[k]-a[k] for k in range(3)]
            normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
            length=math.sqrt(sum(t*t for t in normal)) or 1
            lines.append("vn %.5f %.5f %.5f"%tuple(t/length for t in normal))
        for i,f in enumerate(self.faces): lines.append("f "+" ".join(f"{j}/{j}/{i+1}" for j in f))
        (OUT/f"{name}.obj").write_text("\n".join(lines))
        return f"assets/world-waterfall/{name}.obj"

def rock(mesh,center,scale):
    rows,cols=8,12
    points=[]
    phase=random.random()*6
    for r in range(rows+1):
        theta=math.pi*r/rows
        for c in range(cols):
            a=c*math.tau/cols
            jitter=1+.13*math.sin(a*3+theta*5+phase)+.07*math.cos(a*5-theta*3)
            points.append((center[0]+scale[0]*math.sin(theta)*math.cos(a)*jitter,
                           center[1]+scale[1]*math.cos(theta)*jitter,
                           center[2]+scale[2]*math.sin(theta)*math.sin(a)*jitter))
    for r in range(rows):
        for c in range(cols):
            a=points[r*cols+c];b=points[r*cols+(c+1)%cols]
            d=points[(r+1)*cols+c];e=points[(r+1)*cols+(c+1)%cols]
            if r>0: mesh.triangle(a,b,d)
            if r<rows-1: mesh.triangle(b,e,d)

def cone(mesh,base,radius,length,phase=0):
    for i in range(9):
        a=phase+i*math.tau/9;b=phase+(i+1)*math.tau/9
        p=(base[0]+radius*math.cos(a),base[1],base[2]+radius*math.sin(a))
        q=(base[0]+radius*math.cos(b),base[1],base[2]+radius*math.sin(b))
        mesh.triangle(p,(base[0],base[1]+length,base[2]),q)

def add_mesh(name,mesh,color,mat):
    scene["objects"].append({"name":name,"pos":[0,0,0],"rot":[0,0,0],"scale3":[1,1,1],
                             "mesh":1,"meshPath":mesh.save(name),"color":color,"stationary":1,"scripts":[mat]})

cliff=Mesh();banks=Mesh();wet=Mesh()
# Blocos parcialmente enterrados, com tamanhos e orientacoes irregulares.
for side in (-1,1):
    for j in range(7):
        x=side*(3.3+j*2.5)
        z=3.1+1.1*math.sin(x*.24)
        rock(cliff,(x,4.6+random.uniform(-.6,.6),z),(2.5+random.random(),5+random.random()*1.4,2.7))
for i in range(45):
    angle=random.random()*math.tau;radius=random.uniform(7.7,14)
    x=math.cos(angle)*radius;z=-4+math.sin(angle)*radius
    if z>1 and abs(x)<4: continue
    s=random.uniform(.35,1.1)
    rock(banks,(x,height(x,z)+s*.25,z),(s*1.5,s*.7,s))
for i in range(12):
    x=random.choice((-1,1))*random.uniform(3.7,6.7);z=random.uniform(-8,0)
    rock(wet,(x,height(x,z)+.3,z),(.6,.45,.8))
add_mesh("Escarpa rochosa",cliff,[151,145,124],material(tile=.22))
add_mesh("Pedras das margens",banks,[153,150,132],material(tile=.55))
add_mesh("Pedras molhadas",wet,[83,96,85],material(roughness=.22,tile=.6))

trunks=Mesh();foliage=[Mesh(),Mesh(),Mesh()]
for i in range(42):
    x=random.uniform(-34,34);z=random.uniform(-18,36)
    if abs(x)<10 or (x>8 and z<-10): continue
    y=height(x,z);h=random.uniform(4.5,9)
    cone(trunks,(x,y,z),.18,h)
    for layer in range(8):
        fraction=layer/8;radius=(1-fraction)*h*.23
        cone(foliage[i%3],(x,y+h*(.2+fraction*.67),z),radius,h*.32,random.random())
add_mesh("Troncos",trunks,[109,86,62],material("wood",tile=.6))
for i,m in enumerate(foliage):
    add_mesh(f"Pinheiros {i+1}",m,[(43,75,40),(62,88,46),(72,92,50)][i],{"type":"material","pbr":1,"roughness":.96})

# Capim agrupado: dados viram uma malha, sem GameObject por folha/planta.
grass=Mesh()
for i in range(700):
    x=random.uniform(-23,23);z=random.uniform(-18,22)
    if abs(x)<8 and z<5: continue
    y=height(x,z)
    if abs(height(x+.3,z)-y)>.45 or abs(height(x,z+.3)-y)>.45: continue
    for blade in range(3):
        angle=random.random()*math.tau;h=random.uniform(.22,.65);w=.05
        a=(x-w*math.cos(angle),y,z-w*math.sin(angle))
        b=(x+w*math.cos(angle),y,z+w*math.sin(angle))
        tip=(x+.12*math.cos(angle),y+h,z+.12*math.sin(angle))
        grass.triangle(a,tip,b);grass.triangle(b,tip,a)
add_mesh("Capim agrupado",grass,[80,104,44],{"type":"material","pbr":1,"roughness":.97})

for o in scene["objects"]:
    for c in o.get("scripts",[]):
        if "WaterBody" in c.get("type",""): c["fields"]["reflectionStrength"]=.12
scene["camera"]=[20,16,-40,-.44,-.24]
(ROOT/"scenes/waterfall-world.json").write_text(json.dumps(scene,separators=(",",":")),encoding="utf-8")
print("scenes/waterfall-world.json",len(scene["objects"]),"objetos; malhas agrupadas")
