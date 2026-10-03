import { Terrain } from "@engine/core/terrain";
import { TerrainImageTool } from "@engine/core/terrain_image_tool";
import { terrainBrushInput } from "@editor/terrain_brush";
import { scene,S } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Gizmos } from "@engine/core/gizmos";
const object=new GameObject("Brush"),terrain=new Terrain(),tool=new TerrainImageTool();
terrain.fieldSet(1,8);tool.imagePath="tests/heightmap-gray-2x2.png";tool.radius=.25;tool.strength=0;tool.paintInViewport=true;
object.addBehavior(terrain);object.addBehavior(tool);scene.add(object);scene.computeWorld();S.selected=0;
if(!tool.prepareBrush())throw new Error("brush not ready");
const view=new Float64Array([0,20,0,1,0,0,-1,400,800,600]),mouse=new Float64Array([400,300,0,0]),g=new Gizmos();
for(let i=0;i<500;i++){terrainBrushInput(view,mouse,true);tool.dabAt(terrain,0,0);g.nSeg=0;tool.onDrawGizmosSelected(g);}
println("TERRAIN_BRUSH_GC_BEGIN");
for(let i=0;i<200000;i++){terrainBrushInput(view,mouse,true);tool.dabAt(terrain,0,0);g.nSeg=0;tool.onDrawGizmosSelected(g);}
println("TERRAIN_BRUSH_GC_END");scene.clear();
