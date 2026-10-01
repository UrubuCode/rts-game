/** Deterministic avenue layout. Geometry stays inside lots, clear of sidewalks. */
export class CityLot {
  x:number=0;z:number=0;width:number=0;depth:number=0;height:number=0;facade:number=0;
}
export class CityLayout {
  seed:number;lots:CityLot[]=[];skyline:CityLot[]=[];
  private state:number;
  constructor(seed:number){
    this.seed=seed>>>0;this.state=this.seed;
    for(let side=0;side<2;side++)for(let block=0;block<7;block++){
      const lot=new CityLot();lot.width=10+this.next()*5;lot.depth=13+this.next()*5;
      lot.height=9+Math.floor(this.next()*10)*3;lot.facade=Math.floor(this.next()*3);
      lot.x=(side===0?-1:1)*(11.8+lot.width/2+this.next()*1.3);
      lot.z=block*22-6+(this.next()-.5)*2;this.lots.push(lot);
    }
    for(let i=0;i<22;i++){
      const lot=new CityLot();lot.x=-90+i*8.5+(this.next()-.5)*2;
      lot.z=165+this.next()*22;lot.width=6+this.next()*3;lot.depth=8+this.next()*4;
      lot.height=18+Math.floor(this.next()*36);if(Math.abs(lot.x)>=10)this.skyline.push(lot);
    }
  }
  private next():number{this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state/4294967296;}
}
