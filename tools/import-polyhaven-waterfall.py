"""Importa assets CC0 selecionados, preservando URLs e checksums de origem."""
import concurrent.futures
import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/"assets/vendor/polyhaven"
DEST.mkdir(parents=True,exist_ok=True)
AGENT="RTSGame asset importer (personal use)"
records=[]

def download(item):
    path,meta=item
    path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists() or hashlib.md5(path.read_bytes()).hexdigest()!=meta.get("md5"):
        subprocess.run(["curl.exe","-sSfL","--retry","2","--max-time","120","-A",AGENT,meta["url"],"-o",str(path)],check=True)
    if meta.get("md5") and hashlib.md5(path.read_bytes()).hexdigest()!=meta["md5"]:
        raise ValueError("Checksum incorreto: "+str(path))
    return {"file":path.relative_to(ROOT).as_posix(),"url":meta["url"],"md5":meta.get("md5"),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}

for asset in ("rock_moss_set_01","pine_sapling_small","fern_02","forest_ground_04"):
    folder=DEST/asset;folder.mkdir(exist_ok=True)
    api=folder/"files.json"
    subprocess.run(["curl.exe","-sSfL","-A",AGENT,"https://api.polyhaven.com/files/"+asset,"-o",str(api)],check=True)
    info=json.loads(api.read_text())
    if asset=="forest_ground_04":
        tasks=[(folder/(key+".jpg"),info[key]["1k"]["jpg"]) for key in ("Diffuse","nor_gl","Rough")]
    else:
        spec=info["gltf"]["1k"]["gltf"]
        tasks=[(folder/(asset+".gltf"),spec)]+[(folder/name,meta) for name,meta in spec["include"].items()]
        for key in info:
            if "alpha" in key.lower(): tasks.append((folder/(key+".png"),info[key]["1k"]["png"]))
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        files=list(pool.map(download,tasks))
    records.append({"asset":asset,"source":"https://polyhaven.com/a/"+asset,"license":"CC0-1.0","files":files})
    print(asset,"baixado",sum((ROOT/f["file"]).stat().st_size for f in files),"bytes",flush=True)
(DEST/"sources.json").write_text(json.dumps(records,indent=2))
