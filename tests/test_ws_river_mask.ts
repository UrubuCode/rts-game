import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { history } from "@editor/undo";
function check(value:boolean,message:string):void{if(!value)throw new Error(message);}
function ok(command:string):string{const result=execCommand(800,600,command);check(!result.startsWith("[erro]"),command+": "+result);return result;}
instalarEditorReal();scene.clear();
ok("spawn Rio 0 0 0 0");ok("addcomp Rio Spline");ok("addcomp Rio RiverMaskTool");ok("addcomp Rio WaterBody");
ok("setfield Rio RiverMaskTool imagePath tests/river-mask.png");
ok("setfield Rio RiverMaskTool pointCount 12");ok("setfield Rio RiverMaskTool startHeight 3");
const before=ok("spline Rio info"),undo=history.u.length;
const preview=JSON.parse(ok("spline Rio trace").substring(17));
check(preview.length===12&&preview[0][1]===3&&preview[11][1]===0,"numero de pontos e declive");
check(history.u.length===undo&&ok("spline Rio info")===before,"previa nao muta spline ou undo");
ok("spline Rio applytrace");const applied=ok("spline Rio info");check(applied!==before,"aplicou");
ok("undo");check(ok("spline Rio info")===before,"undo trace");ok("redo");check(ok("spline Rio info")===applied,"redo trace");
ok("setfield Rio Spline pointIndex 0");ok("setfield Rio Spline pointWidth 7");
check(ok("getfield Rio Spline pointWidth").includes("7"),"controles do Inspector expostos");
check(scene.objects[0].behaviors[0].toData().fields.pointIndex===undefined,"selecao de ponto nao serializa");
ok("undo");check(ok("spline Rio info")===applied,"undo edicao de ponto via Inspector");
ok("setfield Rio RiverMaskTool imagePath tests/river-branch.png");
const n=history.u.length;check(execCommand(800,600,"spline Rio trace").startsWith("[erro]"),"bifurcacao recusada");
check(history.u.length===n&&ok("spline Rio info")===applied,"erro nao muta");
check(execCommand(800,600,"spline Rio applytrace").startsWith("[erro]"),"nao reaplica previa velha");
ok("setfield Rio RiverMaskTool imagePath tests/river-empty.png");check(execCommand(800,600,"spline Rio trace").startsWith("[erro]"),"vazio recusado");
ok("setfield Rio RiverMaskTool imagePath tests/river-mask.png");ok("setfield Rio RiverMaskTool reverse true");
const reversed=JSON.parse(ok("spline Rio trace").substring(17));check(Math.abs(reversed[0][2]-preview[11][2])<1e-8,"inverteu direcao");
scene.clear();println("PASS WS river mask: preview, centerline, direction, undo and invalid masks");
