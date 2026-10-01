import { RouteNode as FpsRouteNode, RouteMotion as FpsRouteAgent, ROUTE_WALK as FPS_ROUTE_WALK, ROUTE_WAIT as FPS_ROUTE_WAIT, ROUTE_TURN as FPS_ROUTE_TURN } from "@engine/core/route_motion";
function fpsCityCheck(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
const fpsNodes=[new FpsRouteNode(0,0,[1],0.5),new FpsRouteNode(0,8,[0,2],0.5),new FpsRouteNode(6,8,[1],0.5)];
const fpsWalker=new FpsRouteAgent(fpsNodes,0,2,17);
fpsWalker.step(0.25);
fpsCityCheck(fpsWalker.state===FPS_ROUTE_WAIT&&fpsWalker.z===0,"must respect waypoint waiting time");
let fpsWalkSeen=false,fpsTurnSeen=false,fpsWaitSeen=false;
for(let i=0;i<1500;i++) {
  fpsWalker.step(0.05);
  fpsWalkSeen=fpsWalkSeen||fpsWalker.state===FPS_ROUTE_WALK;
  fpsTurnSeen=fpsTurnSeen||fpsWalker.state===FPS_ROUTE_TURN;
  fpsWaitSeen=fpsWaitSeen||fpsWalker.state===FPS_ROUTE_WAIT;
  fpsCityCheck(Number.isFinite(fpsWalker.x)&&fpsWalker.x>=0&&fpsWalker.x<=6,"invalid route position");
  fpsCityCheck(fpsWalker.z>=0&&fpsWalker.z<=8,"escaped route bounds");
  fpsCityCheck(fpsWalker.x<0.001||Math.abs(fpsWalker.z-8)<0.001,"cut through unconnected waypoints");
}
fpsCityCheck(fpsWalkSeen&&fpsTurnSeen&&fpsWaitSeen,"state transitions missing");
const fpsA=new FpsRouteAgent(fpsNodes,1,1.3,42),fpsB=new FpsRouteAgent(fpsNodes,1,1.3,42);
for(let i=0;i<100;i++){fpsA.step(0.1);fpsB.step(0.1);}
fpsCityCheck(fpsA.x===fpsB.x&&fpsA.z===fpsB.z&&fpsA.state===fpsB.state,"seeded choices must be deterministic");
const fpsStill=fpsA.z;fpsA.step(0);fpsCityCheck(fpsA.z===fpsStill,"zero dt must not move");
const fpsDeadEnd=new FpsRouteAgent([new FpsRouteNode(1,2,[],0)],0,2,1);
fpsDeadEnd.step(10);fpsCityCheck(fpsDeadEnd.x===1&&fpsDeadEnd.z===2,"isolated node must remain safe");
println("PASS pbr-city-motion: route edges, wait/walk/turn states, seeded choices, bounds and isolated nodes");
