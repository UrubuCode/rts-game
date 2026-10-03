import { scene, S } from "../session";
import { argObj, numeroEstrito } from "../args";
import { history } from "../../undo";
import { loteAtivo } from "../lote";
import { Behavior } from "@engine/core/behavior";
import { Spline } from "@engine/core/spline";
import { RiverMaskTool } from "@engine/core/river_mask_tool";
import { Terrain } from "@engine/core/terrain";
import { TerrainImageTool } from "@engine/core/terrain_image_tool";
import { WaterBody } from "@engine/core/water_body";
import { WaterSurface } from "@engine/core/water_surface";
import { ProceduralWorld } from "@engine/core/procedural_world";
import { SailboatController } from "@engine/core/sailboat_controller";
import { Buoyancy } from "@engine/core/buoyancy";

// Operações pontuais: validação antes do snapshot, consultas sem Desfazer.
function component(parts:string[],name:string):Behavior|null {
  const index=argObj(parts,1);if(index<0)return null;
  let found:Behavior|null=null;
  const items=scene.objects[index].behaviors;
  for(let i=0;i<items.length;i++)if(items[i].typeName()===name){if(found!==null)return null;found=items[i];}
  return found;
}
function missing(name:string):string{return "[erro] objeto deve ter exatamente um componente "+name;}
function editAllowed():boolean{return S.simulating===0;}
const EDIT_ERROR:string="[erro] edicao de mundo requer sair do Play (stop)";
function numbers(parts:string[],start:number,count:number):Float64Array|null {
  if(parts.length!==start+count)return null;
  const out=new Float64Array(count);
  for(let i=0;i<count;i++){out[i]=numeroEstrito(parts[start+i]);if(!Number.isFinite(out[i]))return null;}
  return out;
}

export function cmdSpline(parts:string[]):string {
  const c=component(parts,"Spline");if(!(c instanceof Spline))return missing("Spline");
  const op=parts[2];
  if(op==="info"&&parts.length===3)return "[spline] "+JSON.stringify({closed:c.closed,points:JSON.parse(c.points),error:c.error()});
  if(!editAllowed())return EDIT_ERROR;
  if((op==="trace"||op==="applytrace")&&parts.length===3){
    const tool=component(parts,"RiverMaskTool");if(!(tool instanceof RiverMaskTool))return missing("RiverMaskTool");
    if(op==="trace"){tool.preview();return "[spline-preview] "+tool.previewData();}
    tool.target();if(!tool.ready())return "[erro] gere a previa com spline <obj> trace";
    history.snapshot();tool.apply();return "[ok] spline applytrace";
  }
  if(op==="set"){
    const values=numbers(parts,4,6),index=numeroEstrito(parts[3]??"");
    if(values===null||!Number.isInteger(index)||index<0||index>=c.count())return "[erro] spline set: indice e seis numeros obrigatorios";
    for(let i=0;i<6;i++)if(Math.abs(values[i])>10000)return "[erro] ponto fora dos limites";
    if(values[3]<.1||values[3]>1000||values[4]<.01||values[4]>100||Math.abs(values[5])>100)return "[erro] largura, profundidade ou velocidade fora dos limites";
    history.snapshot();c.setPoint(index,values);return "[ok] spline set";
  }
  if((op==="insert"||op==="remove")&&parts.length===4){
    const index=numeroEstrito(parts[3]);
    if(!Number.isInteger(index)||index<0||index>=c.count())return "[erro] indice de ponto invalido";
    if(op==="insert"&&c.count()>=64)return "[erro] limite de 64 pontos";
    if(op==="remove"&&c.count()<=(c.closed?3:2))return "[erro] minimo de pontos da curva";
    history.snapshot();c.selectPoint(index);if(op==="insert")c.insertPoint();else c.removePoint();return "[ok] spline "+op;
  }
  if(op==="closed"&&parts.length===4&&(parts[3]==="on"||parts[3]==="off")){
    if(parts[3]==="on"&&c.count()<3)return "[erro] curva fechada exige tres pontos";
    history.snapshot();c.closed=parts[3]==="on";c.onValidate("closed");return "[ok] spline closed";
  }
  return "[erro] use doc spline";
}

export function cmdTerrain(parts:string[]):string {
  const c=component(parts,"Terrain");if(!(c instanceof Terrain))return missing("Terrain");
  const op=parts[2];
  if(op==="info"&&parts.length===3)return "[terrain] "+JSON.stringify({size:c.size,resolution:c.resolution,automaticCollider:false,texturePainting:false});
  if(op==="height"){
    const p=numbers(parts,3,2);if(p===null)return "[erro] use terrain <obj> height <x> <z> (local)";
    return "[terrain] "+JSON.stringify({height:c.heightAt(p[0],p[1]),space:"local"});
  }
  if(!editAllowed())return EDIT_ERROR;
  if(op==="paint"&&parts.length===4&&(parts[3]==="on"||parts[3]==="off")){
    const tool=component(parts,"TerrainImageTool");if(!(tool instanceof TerrainImageTool))return missing("TerrainImageTool");
    if(loteAtivo())return "[erro] modo do pincel nao participa de batch";
    if(parts[3]==="on"&&!tool.prepareBrush())return "[erro] pincel invalido; verifique imagem, raio e intensidade no Inspector";
    tool.paintInViewport=parts[3]==="on";return "[ok] terrain paint "+parts[3];
  }
  if((op==="heightmap"||op==="stamp")&&parts.length===3){
    const tool=component(parts,"TerrainImageTool");if(!(tool instanceof TerrainImageTool))return missing("TerrainImageTool");
    const values=tool.prepare(op==="stamp");history.snapshot();tool.apply(values);return "[ok] terrain "+op;
  }
  if(op==="brush"){
    const p=numbers(parts,3,4);if(p===null||p[2]<=0||p[2]>2048||Math.abs(p[3])>100)return "[erro] pincel: x z raio (0,2048] intensidade [-100,100]";
    history.snapshot();c.brush(p[0],p[1],p[2],p[3]);return "[ok] terrain brush";
  }
  if(op==="flatten"&&parts.length===3){history.snapshot();c.flatten();return "[ok] terrain flatten";}
  return "[erro] use doc terrain; pintura de textura nao implementada";
}

export function cmdWater(parts:string[]):string {
  const body=component(parts,"WaterBody"),surface=component(parts,"WaterSurface");
  if(!(body instanceof WaterBody)&&!(surface instanceof WaterSurface))return missing("WaterBody ou WaterSurface");
  if(body!==null&&surface!==null)return "[erro] objeto ambiguo: separe WaterBody e WaterSurface";
  scene.computeWorld();
  if(body instanceof WaterBody)body.synchronize();
  if(parts[2]==="info"&&parts.length===3){
    if(body instanceof WaterBody)return "[water] "+JSON.stringify({type:"WaterBody",terrainObject:body.terrainObject,error:body.error()});
    return "[water] "+JSON.stringify({type:"WaterSurface",coordinates:"world"});
  }
  if(parts[2]==="sample"){
    const p=numbers(parts,3,2);if(p===null)return "[erro] sample exige x z de mundo";
    if(body instanceof WaterBody){const out=new Float64Array(4),inside=body.sample(p[0],p[1],out);return "[water] "+JSON.stringify({inside:inside,height:inside?body.waterHeightAt(p[0],p[1]):null,depth:inside?out[1]:null,flowX:inside?out[2]:0,flowZ:inside?out[3]:0});}
    if(surface instanceof WaterSurface){const inside=surface.contains(p[0],p[1]);return "[water] "+JSON.stringify({inside:inside,height:inside?surface.heightAt(p[0],p[1]):null,depth:null,flowX:0,flowZ:0});}
  }
  if(parts[2]==="carve"&&parts.length===3&&body instanceof WaterBody){
    if(!editAllowed())return EDIT_ERROR;
    history.snapshot();if(!body.carveTerrain())return "[erro] Terrain ausente ou transform/curva incompativel";
    return "[ok] water carve";
  }
  return "[erro] use doc water";
}

export function cmdBoat(parts:string[]):string {
  const c=component(parts,"SailboatController");if(!(c instanceof SailboatController))return missing("SailboatController");
  if(parts[2]==="info"&&parts.length===3)return "[boat] "+c.controlStatus();
  if(S.simulating===0)return "[erro] controles do barco exigem Play";
  if(loteAtivo())return "[erro] controles de execucao nao participam de batch";
  if((parts[2]==="sail"||parts[2]==="rudder")&&parts.length===4){
    const value=numeroEstrito(parts[3]),min=parts[2]==="sail"?0:-1;
    if(!Number.isFinite(value)||value<min||value>1)return "[erro] controle fora da faixa";
    if(parts[2]==="sail")c.setSail(value);else c.setRudder(value);return "[ok] boat "+parts[2];
  }
  if(parts[2]==="anchor"&&parts.length===4&&(parts[3]==="on"||parts[3]==="off")){
    if(c.isAnchored()!==(parts[3]==="on"))c.toggleAnchor();return "[ok] boat anchor";
  }
  if(parts[2]==="reset"&&parts.length===3){c.resetMotion();return "[ok] boat reset";}
  return "[erro] use doc boat";
}

export function cmdWorld(parts:string[]):string {
  const c=component(parts,"ProceduralWorld");if(!(c instanceof ProceduralWorld))return missing("ProceduralWorld");
  if(parts[2]==="info"&&parts.length===3)return "[world] "+c.streamingStatus();
  if(!editAllowed())return EDIT_ERROR;
  if(parts[2]==="paint"){
    const p=numbers(parts,3,4);
    if(c.generator==="voxel")return "[erro] pintura de vegetacao nao se aplica ao gerador voxel";
    if(p===null||Math.abs(p[0])>10000000||Math.abs(p[1])>10000000||p[2]<.1||p[2]>2048||p[3]<-1||p[3]>1)return "[erro] paint exige x z raio [.1,2048] intensidade [-1,1]";
    history.snapshot();c.brushX=p[0];c.brushZ=p[1];c.brushRadius=p[2];c.paintVegetation(p[3]);return "[ok] world paint (vegetacao)";
  }
  // Regenerar descarta recursos de execucao; nao muda a cena salva.
  if(parts[2]==="regenerate"&&parts.length===3){if(loteAtivo())return "[erro] regenerate nao participa de batch";c.regenerate();return "[ok] world regenerate (inicia no proximo desenho)";}
  return "[erro] use doc world";
}

export function cmdBuoyancy(parts:string[]):string {
  const c=component(parts,"Buoyancy");if(!(c instanceof Buoyancy))return missing("Buoyancy");
  if(parts[2]!=="info"||parts.length!==3)return "[erro] use buoyancy <obj> info";
  return "[buoyancy] "+c.diagnosticStatus();
}
