"""Original, deterministic low-poly environment meshes. Run from any directory."""
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1] / 'assets/environment'
COLORS = {'steel': (48, 76, 83), 'edge': (143, 163, 159), 'wood': (140, 89, 47),
          'dark': (43, 48, 49), 'concrete': (164, 174, 173), 'glass': (39, 78, 92),
          'ochre': (216, 159, 65), 'paving': (99, 111, 114), 'white': (207, 211, 192)}

class Mesh:
    def __init__(self):
        self.parts = defaultdict(list)

    def box(self, material, x, y, z, sx, sy, sz):
        v = [(x+dx*sx/2, y+dy*sy/2, z+dz*sz/2)
             for dx, dy, dz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                                (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        for face in [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(3,7,6,2),(0,1,5,4)]:
            self.parts[material].append([v[i] for i in face])

    def plane(self, material, x, z, sx, sz, y=0.02):
        self.parts[material].append([(x-sx/2,y,z-sz/2),(x-sx/2,y,z+sz/2),
                                     (x+sx/2,y,z+sz/2),(x+sx/2,y,z-sz/2)])

    def save(self, name):
        lines = ['# Generated original RTS FPS environment', 'mtllib environment.mtl']
        index = 1
        for material, faces in self.parts.items():
            lines += [f'usemtl {material}']
            for face in faces:
                lines += ['v ' + ' '.join(f'{n:.5f}' for n in vertex) for vertex in face]
                lines += [f'f {index} {index+1} {index+2}', f'f {index} {index+2} {index+3}']
                index += 4
        (ROOT / f'{name}.obj').write_text('\n'.join(lines)+'\n')

def generate():
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT/'environment.mtl').write_text(''.join(
        f'newmtl {name}\nKd ' + ' '.join(f'{v/255:.6f}' for v in rgb)+'\n\n'
        for name, rgb in COLORS.items()))
    m = Mesh()
    m.box('wood',0,0,0,.95,.95,.95)
    for a in (-.43,.43):
        m.box('dark',a,0,0,.1,1,1)
        m.box('dark',0,0,a,1,1,.1)
    for a in (-.3,-.1,.1,.3):
        m.box('wood',0,a,0,.98,.16,.98)
    m.box('ochre',0,.13,-.495,.34,.18,.01)
    m.save('crate')
    m = Mesh()
    m.box('steel',0,0,0,.96,.96,.98)
    for z in [i/12-.458 for i in range(12)]:
        for x in (-.49,.49): m.box('edge',x,0,z,.02,.88,.018)
    for y in (-.475,.475): m.box('edge',0,y,0,1,.05,1)
    for x in (-.47,.47): m.box('edge',x,0,0,.06,1,1)
    for x in (-.22,.22): m.box('edge',x,0,-.498,.025,.88,.004)
    m.box('ochre',0,.2,-.5,.34,.15,.002)
    m.save('container')
    m = Mesh()
    m.box('concrete',0,0,0,1,1,1)
    # Window strips on four facades; only millimetres outside the collision box.
    for row in range(9):
        y = -.40+row*.092
        for col in range(4):
            a = -.34+col*.225
            for sign in (-1,1):
                m.box('glass',a,y,sign*.501,.15,.052,.002)
                m.box('glass',sign*.501,y,a,.002,.052,.15)
    for y in (-.47,.465): m.box('steel',0,y,0,1.004,.05,1.004)
    m.box('ochre',-.40,0,-.503,.055,.83,.002)
    m.save('tower')
    m = Mesh()
    for bi in range(9):
        for bj in range(9):
            x,z = (bi-4)*40,(bj-4)*40
            m.plane('paving',x,z,35,35,.008)
            # Sidewalk perimeter; visual surfacing, no new collision step.
            for sign in (-1,1):
                m.plane('concrete',x+sign*17,z,.7,34,.012)
                m.plane('concrete',x,z+sign*17,34,.7,.012)
    for road in range(8):
        c = (road-4)*40+20
        for step in range(-43,44):
            a = step*4
            if abs((a+20)%40-20) < 3: continue
            m.plane('ochre',c,a,.12,1.7)
            m.plane('ochre',a,c,1.7,.12)
        for cross in range(8):
            d = (cross-4)*40+20
            for side in (-1,1):
                for stripe in range(5):
                    offset = (stripe-2)*.8
                    m.plane('white',c+offset,d+side*4,.45,1.8)
                    m.plane('white',c+side*4,d+offset,1.8,.45)
    m.save('streets')
    print('Generated crate, container, tower and streets')

if __name__ == '__main__':
    generate()
