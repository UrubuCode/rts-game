import { CityLayout } from "@engine/core/city_layout";
const a=new CityLayout(42),b=new CityLayout(42),c=new CityLayout(43);
if(JSON.stringify(a.lots)!==JSON.stringify(b.lots))throw new Error("Seed is not repeatable");
if(JSON.stringify(a.lots)===JSON.stringify(c.lots))throw new Error("Seed does not change layout");
for(let seed=0;seed<100;seed++){
  const city=new CityLayout(seed);
  if(city.lots.length!==14)throw new Error("Missing lots");
  for(let i=0;i<city.lots.length;i++){
    const lot=city.lots[i];
    if(Math.abs(lot.x)-lot.width/2<11.79)throw new Error("Building occupies pedestrian route");
    if(i%7!==0){const previous=city.lots[i-1];if(previous.z+previous.depth/2>=lot.z-lot.depth/2)throw new Error("Overlapping lots");}
  }
}
println("PASS city-layout: deterministic seeds, variation, 100 layouts without lot/route overlap");
