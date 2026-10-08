import { HeightfieldWater } from "@engine/water/heightfield_water";
function check(ok:boolean,msg:string):void {if(!ok)throw new Error(msg);}
function near(a:number,b:number,msg:string):void {check(Math.abs(a-b)<.000001,msg);}
const bed=new Float64Array(64);for(let row=0;row<8;row++)bed[row*8+4]=3;
const water=new HeightfieldWater(8,1,bed);check(water.addVolume(1,3,16),"fonte valida");
for(let i=0;i<400;i++)water.step(.05);
near(water.volume(),16,"conservacao");check(water.depth[0]>0,"expansao");
for(let row=0;row<8;row++)near(water.depth[row*8+5],0,"barreira segura agua");
for(let i=0;i<4000;i++){water.addVolume(1,3,.08);water.step(.05);}
check(water.depth[5]>0,"transbordamento");near(water.volume(),336,"fonte conserva volume");
const snapshot=water.snapshot(),copy=new HeightfieldWater(8,1,bed);copy.restore(snapshot);
near(copy.volume(),water.volume(),"snapshot volume");
for(let i=0;i<50;i++){copy.step(.05);water.step(.05);}
for(let i=0;i<64;i++){near(copy.depth[i],water.depth[i],"retomada deterministica");check(water.depth[i]>=0&&Number.isFinite(water.depth[i]),"profundidade valida");}
const before=copy.snapshot();let rejected=false;
try{const bad=JSON.parse(before);bad.depth[63]=-1;copy.restore(JSON.stringify(bad));}catch(e){rejected=true;}
check(rejected&&before===copy.snapshot(),"restore atomico");
const changed=new Float64Array(bed);changed[0]=1;rejected=false;
try{new HeightfieldWater(8,1,changed).restore(snapshot);}catch(e){rejected=true;}
check(rejected,"invalidacao do leito");
check(!copy.addVolume(-1,0,1)&&!copy.addVolume(0,0,NaN),"fonte invalida");
const volume=copy.volume();copy.step(NaN);copy.step(100);near(copy.volume(),volume,"dt invalido");
const slope=new Float64Array(64);for(let i=0;i<64;i++)slope[i]=7-i%8;
const river=new HeightfieldWater(8,1,slope);river.addVolume(0,4,8);for(let i=0;i<1000;i++)river.step(.05);
check(river.depth[39]>river.depth[32],"segue gravidade");near(river.volume(),8,"rio conserva volume");
console.log("adaptive-water OK: conservacao, fonte, barreira, transbordamento, gravidade, snapshot e rejeicao atomica");
