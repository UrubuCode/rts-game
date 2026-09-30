import { GameObject } from "@engine/core/gameobject";
import { RoutePath } from "@engine/core/route_path";
import { RouteAgent } from "@engine/core/route_agent";
import { recreateBehavior } from "@editor/sceneio";
import { createComponent } from "@engine/components";
function fpsRouteCheck(ok:boolean,msg:string):void {if(!ok)throw new Error(msg);}
const fpsHost=new GameObject("route-test");fpsHost.transform.setPosition(10,2,20);
const fpsPath=new RoutePath(),fpsAgent=new RouteAgent();
fpsHost.addBehavior(fpsPath);fpsHost.addBehavior(fpsAgent);fpsHost.mount();
for(let i=0;i<100;i++)fpsAgent.update(0.05);
fpsRouteCheck(fpsHost.transform.pz>20&&fpsHost.transform.pz<=28,"agent must follow local path from initial position");
fpsRouteCheck(fpsHost.transform.py===2,"agent must preserve height");
const fpsCopy=recreateBehavior(fpsPath.toData());
fpsRouteCheck(fpsCopy instanceof RoutePath,"path deserialization missing");
fpsRouteCheck(JSON.stringify(fpsCopy.toData())===JSON.stringify(fpsPath.toData()),"route graph lost on save");
fpsRouteCheck(createComponent("RouteAgent") instanceof RouteAgent,"agent not available in component factory");
fpsRouteCheck(createComponent("RoutePath") instanceof RoutePath,"path not available in component factory");
fpsAgent.enabled=0;const fpsOldZ=fpsHost.transform.pz;fpsAgent.update(1);
fpsRouteCheck(fpsHost.transform.pz===fpsOldZ,"disabled agent moved");
let fpsInvalid=false;try{fpsPath.fieldStringSet(4,"999");}catch(e){fpsInvalid=true;}
fpsRouteCheck(fpsInvalid,"invalid route link accepted");
println("PASS route-components: factory, local routes, serialized graph, enabled state and invalid links");
