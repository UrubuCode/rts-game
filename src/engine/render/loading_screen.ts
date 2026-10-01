import { drawRect, drawText } from "rts:egui";
import { winWidth, winHeight } from "./gpu3d";

/** Lightweight loading UI. Call between beginFrame/endFrame; owns no event loop. */
export class LoadingScreen {
  title:string="HORIZONTE";
  subtitle:string="Uma cidade ganha vida ao cair da tarde.";
  private width:number=0;private height:number=0;
  private shapes:any[]=[];private labels:any[]=[];
  private bar:any={x:0,y:0,w:0,h:3,fill:0xf4be86ff};
  private pulse:any={x:0,y:0,w:3,h:3,fill:0xffecd6ff};
  private status:any={x:0,y:0,text:"",size:15,color:0xdfd9d5ff};
  private percent:any={x:0,y:0,text:"",size:18,color:0xffd4aaff};
  private barWidth:number=0;
  private lastPercent:number=-1;private lastLabel:string="";
  private rect(x:number,y:number,w:number,h:number,fill:number):void{this.shapes.push({x:x,y:y,w:w,h:h,fill:fill});}
  private text(x:number,y:number,text:string,size:number,color:number):void{this.labels.push({x:x,y:y,text:text,size:size,color:color});}
  private layout(w:number,h:number):void {
    this.width=w;this.height=h;this.shapes=[];this.labels=[];
    const s=Math.min(w/1280,h/800),margin=64*s;
    // A layered dusk sky, rendered without loading any external asset.
    for(let i=0;i<48;i++){
      const t=i/47;const r=Math.round(16+100*t),g=Math.round(23+39*t),b=Math.round(42+27*t);
      this.rect(0,i*h/48,w,h/48+1,((r<<24)|(g<<16)|(b<<8)|255)>>>0);
    }
    const sx=w*.76,sy=h*.37,r=100*s;
    for(let i=0;i<40;i++){
      const y=-r+i*r/20,half=Math.sqrt(Math.max(0,r*r-y*y));
      this.rect(sx-half,sy+y,half*2,r/20+1,0xf2b388ff);
    }
    for(let layer=0;layer<3;layer++){
      const ground=h*(.63+layer*.065),bw=(46+layer*25)*s;
      for(let i=0;i<Math.ceil(w/bw);i++){
        const bh=(45+(i*47+layer*31)%145)*s;
        const x=i*bw,top=ground-bh;
        this.rect(x,top,bw-5*s,h-top,layer===0?0x574550ff:layer===1?0x292e40ff:0x141d2cff);
        if(i%3===1)this.rect(x+bw*.35,top-15*s,bw*.3,15*s,layer===0?0x574550ff:0x292e40ff);
        if(layer===2)for(let j=0;j<3;j++){
          if((i+j)%3!==0)this.rect(x+12*s,top+18*s+j*25*s,4*s,8*s,0xc9916970);
        }
      }
    }
    this.rect(0,h*.76,w,h*.24,0x101824ff);
    this.rect(margin,49*s,28*s,3*s,0xf4be86ff);
    this.text(margin+40*s,39*s,"RTS  /  WORLDS",14*s,0xf3e3d5ff);
    this.text(margin,h*.27,"CIDADE AO PÔR DO SOL",12*s,0xf2b98cff);
    this.text(margin,h*.32,this.title,64*s,0xfff0e4ff);
    this.text(margin,h*.32+83*s,this.subtitle,17*s,0xdccbc8ff);
    const y=h*.81;
    this.status.x=margin;this.status.y=y;this.status.size=15*s;
    this.percent.x=w-margin-48*s;this.percent.y=y-3*s;this.percent.size=18*s;
    this.bar.x=margin;this.bar.y=y+37*s;this.bar.h=3*s;this.barWidth=w-2*margin;
    this.rect(margin,this.bar.y,this.barWidth,3*s,0x38414cff);
    this.pulse.y=this.bar.y;this.pulse.h=3*s;this.pulse.w=4*s;
    this.text(margin,h-48*s,"WASD  mover     •     Mouse direito  olhar     •     Shift  acelerar",12*s,0x97a3b4ff);
    this.text(w-margin-99*s,h-48*s,"ESC   cancelar",12*s,0xc5cbd3ff);
  }
  draw(win:number,label:string,progress:number):void {
    const w=winWidth(win),h=winHeight(win);if(w<=0||h<=0)return;
    if(w!==this.width||h!==this.height)this.layout(w,h);
    const p=Math.max(0,Math.min(1,progress)),percent=Math.floor(p*100);
    if(label!==this.lastLabel){this.status.text=label;this.lastLabel=label;}
    if(percent!==this.lastPercent){this.percent.text=percent+"%";this.lastPercent=percent;}
    for(let i=0;i<this.shapes.length;i++)drawRect(win,this.shapes[i]);
    for(let i=0;i<this.labels.length;i++)drawText(win,this.labels[i]);
    this.bar.w=this.barWidth*p;drawRect(win,this.bar);
    this.pulse.x=this.bar.x+(performance.now()%1500)/1500*Math.max(0,this.bar.w-this.pulse.w);
    if(this.bar.w>this.pulse.w)drawRect(win,this.pulse);
    drawText(win,this.status);drawText(win,this.percent);
  }
}
