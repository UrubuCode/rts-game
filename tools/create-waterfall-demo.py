"""Gera uma cena de demonstracao visual usando componentes existentes."""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
random.seed(42)
scene = json.loads((ROOT / "scenes/river-lab.json").read_text(encoding="utf-8"))
sun = scene["objects"][1]
scene["name"] = "Cachoeira - demonstracao visual"
scene["camera"] = [18, 16, -34, -0.49, -0.28]
scene["objects"] = [sun]

def component(name, fields):
    files = {"Spline": "spline", "WaterBody": "water_body"}
    return {"type": f"script:src/engine/core/{files[name]}.ts#{name}", "fields": fields}

def obj(name, pos, mesh=0, scale=(1, 1, 1), color=(95, 120, 100), scripts=None):
    value = {"name": name, "pos": pos, "rot": [0, 0, 0], "mesh": mesh,
             "scale3": scale, "color": color, "stationary": 1, "scripts": scripts or []}
    scene["objects"].append(value)
    return value

def height(x, z):
    cliff = 10 * max(0, min(1, (z - 2.3) / 1.2))
    basin = -2.8 * max(0, 1 - (x / 8) ** 2 - ((z + 4) / 8) ** 2)
    bank = 0.7 + 0.24 * math.sin(x * .45) * math.cos(z * .38)
    channel = 1.35 * max(0, 1 - (x / 3.8) ** 4) if z > 3 else 0
    return cliff + bank + basin - channel

n, size = 64, 48
heights = [height((col/n-.5)*size, (row/n-.5)*size)
           for row in range(n+1) for col in range(n+1)]
obj("Terreno da cachoeira", [0, 0, 0], color=(105, 124, 84), scripts=[
    {"type": "terrain", "size": size, "resolution": n, "heights": heights}])

def water(name, points, closed=False):
    obj(name, [0, 0, 0], scripts=[
        component("Spline", {"closed": closed, "points": json.dumps(points)}),
        component("WaterBody", {"terrainObject": "Terreno da cachoeira", "waveAmplitude": .035,
                                "reflectionStrength": 0, "previewBed": False})])

water("Rio superior", [[0,10.05,19,4,1,2], [0,10.05,10,4,1,2], [0,10.05,4.3,4,1,3]])
water("Queda de agua", [[0,10.05,4.3,4,1,4], [0,9.9,3,4,1,5],
                       [0,7,1.8,4.2,1,6], [0,3.4,.6,4.4,1,7], [0,.1,-.8,5,1,7]])
water("Piscina natural", [[math.cos(i*math.tau/12)*7, .04,
                          -4+math.sin(i*math.tau/12)*6.6, 4,2,0] for i in range(12)], True)

# Rochas deixam a borda da queda legivel sem geometrias pesadas.
for side in (-1, 1):
    for j in range(5):
        x, z = side*(3.8+j*.7), 2.7+random.uniform(-.5,.6)
        obj(f"Rocha da escarpa {side} {j}", [x,5,z], 4,
            (1.6+random.random()*.5, 4.4+random.random(), 1.5), (93+j*5,100+j*4,97+j*4))
for i in range(16):
    a = math.tau*i/16
    x, z = math.cos(a)*8.1, -4+math.sin(a)*7.4
    if z > 1 and abs(x)<4: continue
    obj(f"Pedra da margem {i}", [x,height(x,z)+.3,z], 4,
        (1+random.random(), .7+random.random()*.8, 1+random.random()), (106,115,106))

def particles(name, pos, fields, gradient, size_curve):
    defaults = {"loop": True, "playOnAwake": True, "prewarm": True, "duration": 3,
                "simulationSpace": "world", "modo": 0, "sort": 1,
                "startColorR": .78, "startColorG": .9, "startColorB": 1}
    defaults.update(fields)
    obj(name, pos, scripts=[{"type": "particleSystem", "componentFields": defaults,
                            "bursts": [], "gradiente": gradient, "curvaTamanho": size_curve}])

particles("Gotas da queda", [0,9.9,2.4],
          {"maxParticles": 150, "rateOverTime": 100, "forma": 3, "caixaX": 3.9, "caixaY": .1, "caixaZ": .6,
           "startLifetimeMin": 1.22, "startLifetimeMax": 1.34, "startSpeedMin": .1, "startSpeedMax": .4,
           "startSizeMin": .09, "startSizeMax": .22, "gravityModifier": 11.5, "ventoZ": -2.7},
          [0,.8,.94,1,.7, .8,.85,.98,1,.85, 1,.9,1,1,0], [0,1, 1,1.3])
particles("Espuma e nevoa", [0,.25,-.8],
          {"maxParticles": 55, "rateOverTime": 25, "forma": 3, "caixaX": 4.8, "caixaY": .25, "caixaZ": 1.8,
           "startLifetimeMin": 1.2, "startLifetimeMax": 2.0, "startSpeedMin": .2, "startSpeedMax": .8,
           "startSizeMin": .3, "startSizeMax": .7, "gravityModifier": 0, "ventoY": .35, "ventoZ": -.15, "arrasto": .8},
          [0,.85,.97,1,0, .18,.85,.97,1,.4, 1,.85,.97,1,0], [0,.6, 1,2])

(ROOT / "scenes/waterfall-demo.json").write_text(json.dumps(scene, separators=(",", ":")), encoding="utf-8")
print("scenes/waterfall-demo.json", len(scene["objects"]), "objetos")
