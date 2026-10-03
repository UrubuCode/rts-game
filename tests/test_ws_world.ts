import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { history } from "@editor/undo";
import { ProceduralWorld } from "@engine/core/procedural_world";
function check(value:boolean,message:string):void{if(!value)throw new Error(message);}
function ok(command:string):string{const result=execCommand(800,600,command);check(!result.startsWith("[erro]"),command+": "+result);return result;}
function error(command:string):void{const n=history.u.length;check(execCommand(800,600,command).startsWith("[erro]"),command);check(history.u.length===n,"erro alterou undo: "+command);}
instalarEditorReal();scene.clear();
ok("spawn Rio 0 0 0 0");ok("addcomp Rio Spline");ok("addcomp Rio WaterBody");
const before=ok("spline Rio info");
ok("spline Rio set 0 -12 0 -10 10 4 3");ok("undo");check(ok("spline Rio info")===before,"undo ponto");ok("redo");
const changed=ok("spline Rio info");error("spline Rio set 0 0 0 0 -1 2 1");check(ok("spline Rio info")===changed,"erro alterou curva");
ok("spline Rio insert 0");ok("spline Rio remove 1");check(ok("spline Rio info")===changed,"insert/remove");
ok("spawn Chao 0 -1 0 0");ok("addcomp Chao Terrain");
ok("terrain Chao brush 0 0 4 2");check(ok("terrain Chao height 0 0").includes('"height":2'),"pincel");
ok("undo");check(ok("terrain Chao height 0 0").includes('"height":0'),"undo relevo");ok("redo");
error("terrain Chao brush 0 0 -1 1");error("terrain Chao brush 0 0 1 NaN");
ok("setfield Rio WaterBody terrainObject Chao");ok("water Rio carve");
check(ok("water Rio sample 0 0").includes('"inside":true'),"consulta agua");
ok("spawn Mundo 0 0 0 0");ok("addcomp Mundo ProceduralWorld");
check(ok("world Mundo info").includes('"initialized":false'),"consulta nao inicia worker");
ok("world Mundo paint 0 0 10 -1");
check((scene.objects[2].behaviors[0] as ProceduralWorld).vegetationMask.length>0,"pintura");ok("undo");
check((scene.objects[2].behaviors[0] as ProceduralWorld).vegetationMask==="","undo pintura");
ok("batch begin");ok("terrain Chao flatten");ok("spline Rio insert 0");ok("batch cancel");check(ok("spline Rio info")===changed,"rollback lote");
ok("spawn Barco 0 0 0 0");ok("addcomp Barco SailboatController");error("boat Barco sail 1");
ok("play");ok("boat Barco sail 1");ok("boat Barco rudder -0.5");ok("boat Barco anchor on");ok("boat Barco anchor on");
check(ok("boat Barco info").includes('"anchored":true'),"ancora idempotente");
error("terrain Chao flatten");error("boat Barco sail 2");
ok("batch begin");error("boat Barco sail 0");execCommand(800,600,"batch end");
ok("stop");check(ok("boat Barco info").includes('"sail":0'),"stop restaura controles");
error("world Rio info");error("spline Rio insert 1.5");
const n=history.u.length;ok("world Mundo info");ok("spline Rio info");ok("terrain Chao info");check(history.u.length===n,"consultas nao criam undo");
scene.clear();println("PASS WS world: spline, terrain, water, vegetation, boat, undo and validation");
