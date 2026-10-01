import { Terrain } from "@engine/core/terrain";
import { recreateBehavior } from "@editor/sceneio";
function fpsTerrainCheck(ok:boolean,msg:string):void {if(!ok)throw new Error(msg);}
const fpsTerrain=new Terrain();
fpsTerrainCheck(fpsTerrain.heightAt(0,0)===0,"new terrain must be flat");
fpsTerrain.brush(0,0,6,2);
fpsTerrainCheck(fpsTerrain.heightAt(0,0)>1.5,"raise brush did not affect center");
fpsTerrainCheck(fpsTerrain.heightAt(15,15)===0,"brush modified vertices outside radius");
const fpsBefore=fpsTerrain.heightAt(0,0);fpsTerrain.brush(0,0,6,-1);
fpsTerrainCheck(fpsTerrain.heightAt(0,0)<fpsBefore,"lower brush did not lower center");
const fpsMesh=fpsTerrain.buildMesh();
fpsTerrainCheck(fpsMesh.vertices.length===(fpsTerrain.resolution+1)*(fpsTerrain.resolution+1)*8,"wrong terrain vertex count");
for(let i=0;i<fpsMesh.indices.length;i++)fpsTerrainCheck(fpsMesh.indices[i]>=0&&fpsMesh.indices[i]<fpsMesh.vertices.length/8,"invalid mesh index");
for(let i=0;i<fpsMesh.vertices.length;i+=8){const x=fpsMesh.vertices[i+3],y=fpsMesh.vertices[i+4],z=fpsMesh.vertices[i+5];fpsTerrainCheck(Math.abs(x*x+y*y+z*z-1)<0.00001&&y>0,"invalid terrain normal");}
const fpsTerrainCopy=recreateBehavior(JSON.parse(JSON.stringify(fpsTerrain.toData())));
fpsTerrainCheck(fpsTerrainCopy instanceof Terrain,"terrain missing from scene restoration");
fpsTerrainCheck(JSON.stringify(fpsTerrainCopy.toData())===JSON.stringify(fpsTerrain.toData()),"terrain heights lost on save");
fpsTerrain.fieldSet(1,48);fpsTerrainCheck(fpsTerrain.heightAt(0,0)>0.5,"resolution change must preserve shape");
let fpsRejected=false;try{Terrain.fromData({size:32,resolution:999999,heights:[]});}catch(e){fpsRejected=true;}
fpsTerrainCheck(fpsRejected,"invalid resolution accepted");
println("PASS terrain: brush bounds, raise/lower, mesh normals, indices, resampling and scene roundtrip");
