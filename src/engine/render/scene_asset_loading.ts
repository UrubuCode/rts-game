import { readFileSync } from "node:fs";
import { ResourceScope } from "@engine/core/resources";
import { acquireModel } from "./model";
import { TextureLoadOperation } from "./texture_loading";
import { loadSkeletonAsset } from "./gltf_anim";

/** Prepara os recursos da cena antes do primeiro desenho. Reutiliza os caches da engine. */
export class SceneAssetLoadOperation {
  done:boolean=false;error:string="";progress:number=0;label:string="Preparando recursos";
  completed:number=0;lastStepMs:number=0;maxStepMs:number=0;
  private resources:ResourceScope=new ResourceScope();
  private win:number;private models:string[]=[];private modelIndex:number=0;
  /// GLBs de esqueleto. Ficam numa lista PRÓPRIA porque não passam por
  /// `acquireModel`: um esqueleto tem ossos e clipes além da malha, e quem
  /// sabe montá-lo é o `loadSkeletonAsset`.
  private rigs:string[]=[];private rigIndex:number=0;
  private paths:string[]=[];private data:boolean[]=[];private next:number=0;
  private unique:Set<string>=new Set<string>();
  private active:TextureLoadOperation[]=[];
  constructor(win:number,path:string){
    this.win=win;
    const scene=JSON.parse(readFileSync(path,"utf8"));
    if(!Array.isArray(scene.objects))throw new Error("Cena sem objects");
    for(let i=0;i<scene.objects.length;i++){
      const o=scene.objects[i];
      if(typeof o.meshPath==="string"&&o.meshPath.length>0&&this.models.indexOf(o.meshPath)<0)this.models.push(o.meshPath);
      if(Array.isArray(o.scripts))for(let j=0;j<o.scripts.length;j++){
        const script=o.scripts[j];
        this.material(script);
        // Sem isto, o GLB do personagem fazia parse no PRIMEIRO QUADRO
        // DESENHADO — o único quadro da carga que não pode ter pausa.
        if(script!==null&&script.type==="skeleton"&&typeof script.modelPath==="string"&&
           script.modelPath.length>0&&this.rigs.indexOf(script.modelPath)<0)this.rigs.push(script.modelPath);
      }
    }
    if(scene.ambiente!==undefined&&scene.ambiente.ceu!==undefined)this.add(scene.ambiente.ceu.textura,false);
  }
  private add(path:any,data:boolean):void {
    if(typeof path!=="string"||path.length===0)return;
    const key=(data?"data:":"color:")+path;
    if(this.unique.has(key))return;
    this.unique.add(key);this.paths.push(path);this.data.push(data);
  }
  private material(m:any):void {
    this.add(m.texturePath,false);this.add(m.normalPath,true);this.add(m.metallicRoughnessPath,true);
    this.add(m.occlusionPath,true);this.add(m.emissivePath,false);
  }
  tick():void {
    if(this.done)return;
    const started=performance.now();
    this.advance();
    this.lastStepMs=performance.now()-started;this.maxStepMs=Math.max(this.maxStepMs,this.lastStepMs);
  }
  private advance():void {
    // No maximo quatro decodificadores e um upload de textura por quadro.
    while(this.active.length<4&&this.next<this.paths.length){
      this.active.push(new TextureLoadOperation(this.win,this.paths[this.next],this.data[this.next]));this.next++;
    }
    for(let i=0;i<this.active.length;i++){
      const op=this.active[i];op.tick();
      if(op.done){
        if(op.error.length>0)throw new Error(op.error);
        this.active.splice(i,1);this.completed++;break;
      }
    }
    if(this.rigIndex<this.rigs.length){
      const rig=this.rigs[this.rigIndex];this.label="Preparando personagem: "+rig;
      // As texturas das peças sobem junto com o asset; o checkpoint fica de
      // fora porque aqui já se está dentro de um tick orçado.
      loadSkeletonAsset(this.win,rig);
      this.rigIndex++;this.completed++;
    }else if(this.modelIndex<this.models.length){
      const path=this.models[this.modelIndex];this.label="Preparando modelo: "+path;
      const parts=this.resources.keep(acquireModel(this.win,path)).value;
      if(parts.length===0)throw new Error("Modelo vazio: "+path);
      for(let i=0;i<parts.length;i++)if(parts[i].pbrMaterial!==null)this.material(parts[i].pbrMaterial);
      this.modelIndex++;this.completed++;
    }else this.label="Preparando texturas e materiais";
    const total=this.models.length+this.rigs.length+this.paths.length;
    this.progress=Math.max(this.progress,this.completed/Math.max(1,total));
    if(this.rigIndex===this.rigs.length&&this.modelIndex===this.models.length&&
       this.next===this.paths.length&&this.active.length===0){this.done=true;this.progress=1;}
  }
  /** A cena montada ja possui suas proprias referencias. */
  release():void { this.resources.release(); }
  cancel():void {
    for(let i=0;i<this.active.length;i++)this.active[i].cancel();
    this.resources.release();
    this.active=[];this.done=true;this.error="Carga cancelada";
  }
}
