import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene,S } from "@editor/control/session";
import { history } from "@editor/undo";
import { terrainBrushInput,terrainRayHit } from "@editor/terrain_brush";
import { Terrain } from "@engine/core/terrain";
import { TerrainImageTool } from "@engine/core/terrain_image_tool";
import process from "@compat/process";
function check(value:boolean,message:string):void{if(!value)throw new Error(message);}
function ok(command:string):void{const result=execCommand(800,600,command);check(!result.startsWith("[erro]"),command+": "+result);}
instalarEditorReal();scene.clear();ok("spawn Chao 0 0 0 0");ok("addcomp Chao Terrain");ok("addcomp Chao TerrainImageTool");ok("select Chao");
const terrain=scene.objects[0].behaviors[0] as Terrain,tool=scene.objects[0].behaviors[1] as TerrainImageTool;
tool.imagePath="tests/heightmap-gray-2x2.png";tool.radius=2;ok("terrain Chao paint on");
const view=new Float64Array([0,20,0,1,0,0,-1,400,800,600]),mouse=new Float64Array([400,300,0,0]);
const point=new Float64Array(3),origin=new Float64Array([0,20,0]),direction=new Float64Array([0,-1,0]);
check(terrainRayHit(terrain,origin,direction,point)&&point[1]===0,"ray vertical");
const before=history.u.length;
terrainBrushInput(view,mouse,true);check(history.u.length===before&&tool.centerX===0&&tool.centerZ===0,"hover nao edita");
mouse[2]=1;mouse[3]=1;check(terrainBrushInput(view,mouse,true),"capturou inicio");
mouse[2]=0;mouse[0]=480;terrainBrushInput(view,mouse,true);
const painted=terrain.heightAt(0,0);check(painted>0&&terrain.heightAt(3,0)>0,"pintou segmento");
terrainBrushInput(view,mouse,true);check(terrain.heightAt(0,0)===painted,"parado nao depende de fps");
mouse[0]=700;terrainBrushInput(view,mouse,false);check(terrain.heightAt(14,0)===0,"nao pinta fora do viewport");
mouse[3]=0;terrainBrushInput(view,mouse,true);check(history.u.length===before+1,"um gesto uma entrada");
ok("undo");check((scene.objects[0].behaviors[0] as Terrain).heightAt(0,0)===0,"undo gesto inteiro");
ok("redo");check((scene.objects[0].behaviors[0] as Terrain).heightAt(0,0)>0,"redo gesto");
S.simulating=1;mouse[2]=1;mouse[3]=1;check(!terrainBrushInput(view,mouse,true),"Play nao pinta");S.simulating=0;
ok("terrain Chao flatten");ok("terrain Chao paint on");
view[2]=-20;view[5]=Math.SQRT1_2;view[6]=-Math.SQRT1_2;
mouse[0]=400;mouse[1]=300;mouse[2]=1;mouse[3]=1;terrainBrushInput(view,mouse,true);mouse[2]=0;
const current=scene.objects[0].behaviors[0] as Terrain,held=current.heightAt(0,0);
for(let i=0;i<20;i++)terrainBrushInput(view,mouse,true);
check(current.heightAt(0,0)===held,"raio obliquo parado nao realimenta pintura");
if(process.env("RTS_BRUSH_GC")==="1"){
  println("TERRAIN_STROKE_GC_BEGIN");
  for(let i=0;i<200000;i++)terrainBrushInput(view,mouse,true);
  println("TERRAIN_STROKE_GC_END");
}
mouse[3]=0;terrainBrushInput(view,mouse,true);
scene.clear();println("PASS terrain drag: picking, spacing, hover, viewport, undo and Play");
