import { Terrain } from "@engine/core/terrain";
import { TerrainImageTool } from "@engine/core/terrain_image_tool";
import { activeInScene } from "@engine/core/gameobject";
import { scene,S } from "./control/session";
import { history } from "./undo";
import { raioDaTela } from "./gizmo";
const ray=new Float64Array(3),origin=new Float64Array(3),hit=new Float64Array(3);
let drawing:TerrainImageTool|null=null,hovered:TerrainImageTool|null=null;
let lastX=0,lastZ=0,anchor=false;
let pointerX=0,pointerY=0,targetX=0,targetZ=0;

/** Raio local contra heightfield: slab limitado + passos de meia celula + bissecao. */
export function terrainRayHit(terrain:Terrain,start:Float64Array,direction:Float64Array,out:Float64Array):boolean {
  let near=0,far=100000;
  for(let axis=0;axis<3;axis++){
    const bound=axis===1?1000:terrain.size*.5,d=direction[axis],p=start[axis];
    if(Math.abs(d)<.0000001){if(p < -bound||p>bound)return false;}
    else{const a=(-bound-p)/d,b=(bound-p)/d;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}
  }
  if(far<=near)return false;
  const horizontal=Math.sqrt(direction[0]*direction[0]+direction[2]*direction[2]);
  const steps=Math.max(1,Math.min(1024,Math.ceil((far-near)*horizontal/(terrain.size/terrain.resolution*.5))));
  let previous=near,delta=start[1]+direction[1]*near-terrain.heightAt(start[0]+direction[0]*near,start[2]+direction[2]*near);
  for(let i=1;i<=steps;i++){
    const t=near+(far-near)*i/steps,d=start[1]+direction[1]*t-terrain.heightAt(start[0]+direction[0]*t,start[2]+direction[2]*t);
    if(delta*d<=0){
      let lo=previous,hi=t;
      for(let j=0;j<18;j++){const mid=(lo+hi)*.5,value=start[1]+direction[1]*mid-terrain.heightAt(start[0]+direction[0]*mid,start[2]+direction[2]*mid);if(delta*value>0)lo=mid;else hi=mid;}
      const distance=(lo+hi)*.5;out[0]=start[0]+direction[0]*distance;out[2]=start[2]+direction[2]*distance;out[1]=terrain.heightAt(out[0],out[2]);return true;
    }
    previous=t;delta=d;
  }
  return false;
}

/** Nenhuma leitura de arquivo no hover/quadro; a imagem carrega no inicio do gesto. */
export function terrainBrushInput(view:Float64Array,mouse:Float64Array,allow:boolean):boolean {
  let tool:TerrainImageTool|null=null,terrain:Terrain|null=null;
  if(S.simulating===0&&S.selected>=0&&S.selected<scene.objects.length){
    const object=scene.objects[S.selected];
    if(activeInScene(scene.objects,object))for(let i=0;i<object.behaviors.length;i++){
      const b=object.behaviors[i];if(b.enabled===0)continue;
      if(b instanceof TerrainImageTool&&b.paintInViewport)tool=b;
      if(b instanceof Terrain)terrain=b;
    }
  }
  if(hovered!==null)hovered.hidePreview();hovered=tool;
  const wasDrawing=drawing!==null;
  if(drawing!==tool||mouse[3]===0||terrain===null){drawing=null;anchor=false;}
  if(tool===null||terrain===null)return wasDrawing;
  const t=terrain.host;
  // Mesmo contrato de autoria do WaterBody; nao pinta um transform que nao entende.
  if(t.wrx!==0||t.wry!==0||t.rz!==0||t.sx!==1||t.sy!==1||t.sz!==1)return wasDrawing;
  if(!allow){anchor=false;return wasDrawing;}
  raioDaTela(ray,view,mouse[0],mouse[1]);origin[0]=view[0]-t.wx;origin[1]=view[1]-t.wy;origin[2]=view[2]-t.wz;
  if(!terrainRayHit(terrain,origin,ray,hit)){anchor=false;return wasDrawing;}
  tool.showPreview(terrain,hit[0],hit[2]);
  if(mouse[2]!==0){
    if(!tool.prepareBrush())return true;
    history.snapshot();drawing=tool;anchor=true;lastX=hit[0];lastZ=hit[2];targetX=lastX;targetZ=lastZ;pointerX=mouse[0];pointerY=mouse[1];tool.dabAt(terrain,lastX,lastZ);return true;
  }
  if(drawing===null)return wasDrawing;
  if(!tool.brushReady()){drawing=null;return true;}
  if(!anchor){lastX=hit[0];lastZ=hit[2];targetX=lastX;targetZ=lastZ;pointerX=mouse[0];pointerY=mouse[1];anchor=true;return true;}
  // A propria deformacao desloca a intersecao de um raio obliquo. So movimento
  // real do mouse cria um novo alvo; terminar uma fila nao cria pintura infinita.
  if(mouse[0]!==pointerX||mouse[1]!==pointerY){targetX=hit[0];targetZ=hit[2];pointerX=mouse[0];pointerY=mouse[1];}
  const dx=targetX-lastX,dz=targetZ-lastZ,distance=Math.sqrt(dx*dx+dz*dz),spacing=Math.max(terrain.size/terrain.resolution*.25,tool.radius*.25);
  const count=Math.min(64,Math.floor(distance/spacing));
  if(count>0){const x=lastX,z=lastZ;for(let i=1;i<=count;i++)tool.dabAt(terrain,x+dx*i*spacing/distance,z+dz*i*spacing/distance);lastX=x+dx*count*spacing/distance;lastZ=z+dz*count*spacing/distance;}
  return true;
}
