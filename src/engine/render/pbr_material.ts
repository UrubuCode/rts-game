import { resourceCache, resourcePath, deferResourceDisposal } from "@engine/core/resources";
// PBR maps have separate color/data upload paths. The cache includes the window
// and encoding: one PNG used as color and data must create different GPU views.
import { materialSet, materialFree, textureUploadData, textureUpload } from "rts:egui";
import { Behavior } from "../core/behavior";
import { Material } from "../core/material";
import { decodePNG } from "./png";
import { Buffer } from "node:buffer";
import fs from "@compat/fs.ts";
import { registrarFalhaAsset } from "../core/falhas";
import { logWarn } from "../core/logger";

const mapCache = resourceCache<number>("textures");
function mapTexture(win: number, path: string, data: boolean): number {
  if (path.length === 0) return 0;
  const key = win + ":" + (data ? "data:" : "color:") + resourcePath(path);
  if (mapCache.has(key)) return mapCache.get(key) as number;
  return loadMap(win, path, data, key);
}
function loadMap(win: number, path: string, data: boolean, key: string): number {
  let id = 0;
  try {
    const embedded = path.indexOf("data:image/png;base64,") === 0;
    if (!embedded && !path.toLowerCase().endsWith(".png")) throw new Error("PBR: use PNG para os mapas.");
    const bytes = embedded ? Buffer.from(path.substring(22), "base64") : fs.read_all(path);
    const image = decodePNG(bytes, 4096);
    id = data ? textureUploadData(win, image.pixels, image.width, image.height) : textureUpload(win, image.pixels, image.width, image.height);
    if (id < 2) throw new Error("PBR: upload falhou.");
  } catch (error) {
    registrarFalhaAsset("material PBR", path, String(error)); logWarn(String(error));
    id = 0;
  }
  mapCache.set(key, id);
  return id;
}

export function resolvePbrMaterial(win: number, behavior: Behavior): number {
  const m = behavior as Material;
  const reset = m.gpuWindow !== win;
  if (reset) { m.gpuWindow = win; m.gpuMaterial = 0; }
  const s = m.gpuState;
  s[0] = m.metallic; s[1] = m.roughness; s[2] = m.normalScale; s[3] = m.occlusionStrength;
  s[4] = m.emissiveR; s[5] = m.emissiveG; s[6] = m.emissiveB;
  if (reset || m.normalPath !== m.gpuNormalPath) {
    s[7] = mapTexture(win, m.normalPath, true); m.gpuNormalPath = m.normalPath;
  }
  if (reset || m.metallicRoughnessPath !== m.gpuMrPath) {
    s[8] = mapTexture(win, m.metallicRoughnessPath, true); m.gpuMrPath = m.metallicRoughnessPath;
  }
  if (reset || m.occlusionPath !== m.gpuAoPath) {
    s[9] = mapTexture(win, m.occlusionPath, true); m.gpuAoPath = m.occlusionPath;
  }
  if (reset || m.emissivePath !== m.gpuEmissivePath) {
    s[10] = mapTexture(win, m.emissivePath, false); m.gpuEmissivePath = m.emissivePath;
  }
  let changed = m.gpuMaterial === 0;
  for (let i = 0; i < 11; i++) { if (s[i] !== m.gpuLast[i]) changed = true; }
  if (changed) {
    const id = shareMaterial(win, m);
    if (id === 0) throw new Error("Não foi possível criar material PBR; verifique os valores e o runtime.");
    m.gpuMaterial = id;
    for (let i = 0; i < 11; i++) m.gpuLast[i] = s[i];
  }
  return m.gpuMaterial;
}

/// Publica mapas preparados pelo worker, mantendo separado sRGB de dados lineares.
export function cachePbrTexture(win:number,path:string,id:number,data:boolean):void {
  mapCache.set(win+":"+(data?"data:":"color:")+resourcePath(path),id);
}
export function cachedPbrTexture(win:number,path:string,data:boolean):number {
  const id=mapCache.get(win+":"+(data?"data:":"color:")+resourcePath(path));return id===undefined?0:id;
}

class SharedMaterial {
  window:number;id:number;
  constructor(win:number,state:Float64Array){
    this.window=win;this.id=materialSet(win,0,state);
    if(this.id===0)throw new Error("Falha ao criar material compartilhado");
  }
}
const materials=resourceCache<SharedMaterial>("materials");
function disposeSharedMaterial(resource:SharedMaterial):void {
  deferResourceDisposal(resource.window,()=>materialFree(resource.window,resource.id));
}
function shareMaterial(win:number,m:Material):number {
  let key=String(win);
  for(let i=0;i<11;i++)key+=":"+m.gpuState[i];
  const lease=materials.acquire(key,()=>new SharedMaterial(win,m.gpuState),disposeSharedMaterial);
  const previous=m.gpuLease;m.gpuLease=lease;
  if(previous!==null)previous.release();
  return lease.value.id;
}
