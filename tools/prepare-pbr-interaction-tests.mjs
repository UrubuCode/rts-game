// Generates harnesses from the actual demos, preserving their exit/paint code.
import fs from 'node:fs';
fs.mkdirSync('build', { recursive: true });
const sim='import { simTeclaDesce, simTeclaSobe, simMover, simApertar, simSoltar, entradaQuadro } from "@compat/input_sim.ts";\n';
for(const scene of ['city','courtyard']) {
  let source=fs.readFileSync(`examples/pbr_${scene}.ts`,'utf8');
  source=sim+source.replace('while(pump(pbrWin)&&isOpen(pbrWin)) {\n  beginFrame(pbrWin);','while(pump(pbrWin)&&isOpen(pbrWin)) {\n  beginFrame(pbrWin);\n  if(pbrFrame===3)simTeclaDesce(2);entradaQuadro();');
  source=source.replace('close(pbrWin);','close(pbrWin);\nif(pbrFrame!==3||isOpen(pbrWin))throw new Error("Esc failed to close demo");\nprintln("PASS escape '+scene+'");');
  fs.writeFileSync(`build/test-pbr-${scene}-exit.ts`,source);
}
let terrain=fs.readFileSync('examples/pbr_terrain.ts','utf8');
terrain=sim+terrain.replace('assets/pbr/terrain.heightmap.json','build/terrain-interaction.json');
terrain=terrain.replace('let pbrFrame=0;','const fpsTerrainBefore=JSON.stringify(fpsTerrain.toData());\nlet pbrFrame=0;');
terrain=terrain.replace('  beginFrame(pbrWin);',`  beginFrame(pbrWin);
  if(pbrFrame===2){simMover(640,400);simApertar(0);}
  if(pbrFrame===7)simSoltar(0);
  if(pbrFrame===8)simTeclaDesce(144);
  if(pbrFrame===9)simTeclaSobe(144);
  if(pbrFrame===11)simTeclaDesce(2);
  entradaQuadro();`);
terrain=terrain.replace('fpsTerrainPaint(Math.min(0.05,Math.max(0,(fpsPbrTime-fpsPbrLastTime)/1000)))','fpsTerrainPaint(0.12)');
terrain=terrain.replace('close(pbrWin);',`close(pbrWin);
if(pbrFrame!==11||isOpen(pbrWin))throw new Error("Esc failed on terrain");
if(JSON.stringify(fpsTerrain.toData())===fpsTerrainBefore)throw new Error("Mouse brush did not modify terrain");
if(!fpsTerrainFs.exists(fpsTerrainFile)||fpsTerrainFs.read_text(fpsTerrainFile)!==JSON.stringify(fpsTerrain.toData()))throw new Error("F5 save did not preserve sculpting");
println("PASS terrain interaction: mouse sculpt, F5 save, Esc exit");`);
fs.writeFileSync('build/test-pbr-terrain-interaction.ts',terrain);
