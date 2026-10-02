import { Spline } from "@engine/core/spline";
import { WaterBody } from "@engine/core/water_body";
import { Terrain } from "@engine/core/terrain";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Buoyancy } from "@engine/core/buoyancy";
import { Rigidbody } from "@scripts/rigidbody";
import { componentToData } from "@engine/components";
import { recreateBehavior,sceneToJSON,sceneFromJSON } from "@editor/sceneio";
function check(ok:boolean,msg:string):void{if(!ok)throw new Error(msg);println("[OK] "+msg);}
const scene=new Scene(),o=new GameObject("River"),curve=new Spline(),water=new WaterBody(),q=new Float64Array(6);
curve.points="[[-12,0,0,8,3,2],[12,0,0,8,3,2]]";curve.onValidate("points");o.addBehavior(curve);o.addBehavior(water);scene.add(o);scene.computeWorld();water.synchronize();
check(water.sample(0,0,q)&&q[2]>1.9&&q[3]===0,"corrente segue tangente");
check(!water.sample(0,5,q)&&!water.sample(-13,0,q),"fora das margens e extremidades sem corrente");
curve.sample(0,q);check(q[0]===-12,"inicio exato");curve.sample(1,q);check(q[0]===12,"fim exato");
curve.selectPoint(0);curve.insertPoint();check(curve.count()===3,"inserir ponto");curve.removePoint();check(curve.count()===2,"remover ponto");
const restored=recreateBehavior(componentToData(curve)) as Spline;check(restored instanceof Spline&&restored.points===curve.points,"curva serializa");
const ground=new GameObject("Ground"),terrain=new Terrain();ground.addBehavior(terrain);scene.add(ground);scene.computeWorld();water.terrainObject="Ground";
const before=JSON.stringify(terrain.toData());check(water.carveTerrain()&&terrain.heightAt(0,0)===-3&&terrain.heightAt(0,12)===0,"escava apenas leito");
const carved=JSON.stringify(terrain.toData());water.carveTerrain();check(JSON.stringify(terrain.toData())===carved,"escavacao idempotente");
const box=new GameObject("Float"),body=new Rigidbody();body.mass=.4;body.floorY=-20;box.addBehavior(new Buoyancy());box.addBehavior(body);scene.add(box);scene.computeWorld();
for(let i=0;i<120;i++){scene.update(1/60);scene.computeWorld();}
check(box.transform.px>1&&box.transform.vx>1,"corrente transporta corpo");
curve.closed=true;curve.points="[[-8,0,-8,4,2,0],[8,0,-8,4,2,0],[8,0,8,4,2,0],[-8,0,8,4,2,0]]";curve.onValidate("points");water.synchronize();
check(water.error()===""&&water.sample(0,0,q)&&q[2]===0&&!water.sample(14,0,q),"lago fechado sem corrente");
o.transform.px=50;o.transform.py=4;scene.computeWorld();check(water.sample(50,0,q)&&q[0]===4&&!water.sample(0,0,q),"translacao consistente");
curve.points="[[-8,0,-8,4,2,0],[8,0,8,4,2,0],[8,0,-8,4,2,0],[-8,0,8,4,2,0]]";curve.onValidate("points");water.synchronize();check(water.error()!==""&&!water.sample(50,0,q),"recusa lago cruzado");
scene.clear();println("[PASSOU] water-spline");
