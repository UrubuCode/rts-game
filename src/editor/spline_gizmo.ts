import { Spline } from "@engine/core/spline";
import { scene,S } from "./control/session";
import { history } from "./undo";
import { projPt,screenToGround } from "./gizmo";
import { UI_SPLINE } from "./ui_config";
const point=new Float64Array(6),world=new Float64Array(3),screen=new Float64Array(3),plane=new Float64Array(10),hit=new Float64Array(4);
let dragging:Spline|null=null;
let offsetX=0,offsetZ=0;
/** Mouse: x,y,pressionou,segurando. Consome o gesto antes do gizmo de objetos. */
export function splineInput(view:Float64Array,mouse:Float64Array,allow:boolean):boolean {
  let selected:Spline|null=null;
  if(S.simulating===0&&S.selected>=0&&S.selected<scene.objects.length){
    const o=scene.objects[S.selected];
    for(let i=0;i<o.behaviors.length;i++){const b=o.behaviors[i];if(b instanceof Spline&&b.enabled!==0&&b.editPoints){selected=b;break;}}
  }
  if(dragging!==null&&(dragging!==selected||mouse[3]===0)){dragging=null;return true;}
  if(selected===null)return false;
  if(dragging===null&&allow&&mouse[2]!==0){
    let best=-1,distance=UI_SPLINE.pickRadius*UI_SPLINE.pickRadius;
    for(let i=0;i<selected.count();i++){
      selected.point(i,point);world[0]=point[0]+selected.host.wx;world[1]=point[1]+selected.host.wy;world[2]=point[2]+selected.host.wz;projPt(screen,view,world);
      const dx=screen[0]-mouse[0],dy=screen[1]-mouse[1],d=dx*dx+dy*dy;
      if(screen[2]!==0&&d<distance){best=i;distance=d;}
    }
    if(best>=0){selected.selectPoint(best);selected.point(best,point);plane.set(view);plane[1]-=point[1]+selected.host.wy;screenToGround(hit,plane,mouse[0],mouse[1]);
      if(hit[3]!==0){history.snapshot();dragging=selected;offsetX=point[0]+selected.host.wx-hit[0];offsetZ=point[2]+selected.host.wz-hit[2];}
      return true;
    }
  }
  if(dragging!==null){
    dragging.point(dragging.pointIndex,point);plane.set(view);plane[1]-=point[1]+dragging.host.wy;screenToGround(hit,plane,mouse[0],mouse[1]);
    if(hit[3]!==0&&allow){const x=hit[0]+offsetX-dragging.host.wx,z=hit[2]+offsetZ-dragging.host.wz;
      if(Math.abs(x-point[0])+Math.abs(z-point[2])>.0001){point[0]=x;point[2]=z;dragging.setPoint(dragging.pointIndex,point);}}
    return true;
  }
  return false;
}
