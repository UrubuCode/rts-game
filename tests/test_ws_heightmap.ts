import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { history } from "@editor/undo";
import { HeightmapImage } from "@engine/core/heightmap_image";
function check(value:boolean,message:string):void{if(!value)throw new Error(message);}
function ok(command:string):string{const result=execCommand(800,600,command);check(!result.startsWith("[erro]"),command+": "+result);return result;}
function height(x:number,z:number):number{return JSON.parse(ok("terrain Chao height "+x+" "+z).substring(10)).height;}
const image=new HeightmapImage("tests/heightmap-gray-2x2.png");
check(image.sample(0,0)===0,"preto zero");check(Math.abs(image.sample(1,0)-1)<1e-10,"branco um");
check(Math.abs(image.sample(.5,.5)-(0+255+128+64)/(4*255))<1e-10,"bilinear");
instalarEditorReal();scene.clear();ok("spawn Chao 0 0 0 0");ok("addcomp Chao Terrain");ok("addcomp Chao TerrainImageTool");
ok("setfield Chao TerrainImageTool imagePath tests/heightmap-gray-2x2.png");
ok("setfield Chao TerrainImageTool minHeight -10");ok("setfield Chao TerrainImageTool maxHeight 30");
ok("terrain Chao heightmap");check(Math.abs(height(-16,-16)+10)<1e-8,"preto min");check(Math.abs(height(16,-16)-30)<1e-8,"branco max");
ok("undo");check(height(16,-16)===0,"undo importacao");ok("redo");check(Math.abs(height(16,-16)-30)<1e-8,"redo importacao");
ok("terrain Chao flatten");ok("setfield Chao TerrainImageTool strength -2");ok("terrain Chao stamp");
check(height(0,0)<0,"carimbo negativo");check(height(16,16)===0,"carimbo fora da area");ok("undo");check(height(0,0)===0,"undo carimbo");
ok("setfield Chao TerrainImageTool imagePath tests/missing.png");
const n=history.u.length;check(execCommand(800,600,"terrain Chao heightmap").startsWith("[erro]"),"arquivo ausente");check(history.u.length===n&&height(0,0)===0,"erro atomico");
scene.clear();println("PASS WS heightmap: grayscale, bilinear, import, stamp and undo");
