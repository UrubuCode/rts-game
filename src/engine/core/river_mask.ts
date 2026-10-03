import { HeightmapImage } from "./heightmap_image";

/** Extrai uma linha central aberta. Bifurcacoes, ilhas e ciclos exigem edicao da mascara. */
export function traceRiverMask(image:HeightmapImage,threshold:number):Float64Array {
  const width=Math.min(128,image.width()),height=Math.min(128,image.height()),stride=width+2;
  if(width<3||height<3||!Number.isFinite(threshold)||threshold<=0||threshold>=1)throw new Error("Mascara exige dimensoes >= 3 e limiar entre 0 e 1");
  const pixels=new Uint8Array(stride*(height+2)),remove=new Uint8Array(pixels.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[(y+1)*stride+x+1]=image.sample(x/(width-1),y/(height-1))>=threshold?1:0;
  // Afinamento Zhang-Suen em duas fases: remove somente bordas preservando conectividade.
  const neighbors=new Int32Array([ -stride,1-stride,1,1+stride,stride,stride-1,-1,-stride-1 ]);
  let changed=true;
  for(let iteration=0;iteration<256&&changed;iteration++){
    changed=false;
    for(let phase=0;phase<2;phase++){
      remove.fill(0);
      for(let y=1;y<=height;y++)for(let x=1;x<=width;x++){
        const k=y*stride+x;if(pixels[k]===0)continue;
        let count=0,transitions=0;
        for(let j=0;j<8;j++){const a=pixels[k+neighbors[j]],b=pixels[k+neighbors[(j+1)%8]];count+=a;if(a===0&&b===1)transitions++;}
        if(count<2||count>6||transitions!==1)continue;
        const north=pixels[k-stride],east=pixels[k+1],south=pixels[k+stride],west=pixels[k-1];
        if(phase===0?(north*east*south===0&&east*south*west===0):(north*east*west===0&&north*south*west===0))remove[k]=1;
      }
      for(let k=0;k<pixels.length;k++)if(remove[k]!==0){pixels[k]=0;changed=true;}
    }
  }
  let first=-1,total=0,endpoints=0;
  const degree=new Uint8Array(pixels.length);
  for(let k=stride+1;k<pixels.length-stride-1;k++)if(pixels[k]!==0){
    total++;
    for(let j=0;j<8;j++)if(connected(pixels,k,j,stride))degree[k]++;
    if(degree[k]===1){endpoints++;if(first<0)first=k;}
    if(degree[k]>2)throw new Error("Mascara com bifurcacao: separe cada rio em uma imagem");
  }
  if(total<2||endpoints!==2)throw new Error("Use um rio aberto continuo, sem ilhas ou ciclos");
  const path:number[]=[],visited=new Uint8Array(pixels.length);
  let current=first;
  while(current>=0){
    path.push(current);visited[current]=1;let next=-1;
    for(let j=0;j<8;j++)if(connected(pixels,current,j,stride)&&visited[current+neighbors[j]]===0){next=current+neighbors[j];break;}
    current=next;
  }
  if(path.length!==total)throw new Error("Mascara com trechos desconectados");
  const out=new Float64Array(path.length*2);
  for(let i=0;i<path.length;i++){out[i*2]=(path[i]%stride-1)/(width-1);out[i*2+1]=(Math.floor(path[i]/stride)-1)/(height-1);}
  return out;
}

function connected(pixels:Uint8Array,k:number,direction:number,stride:number):boolean {
  const dx=direction>=1&&direction<=3?1:direction>=5?-1:0;
  const dy=direction===0||direction===1||direction===7?-1:direction>=3&&direction<=5?1:0;
  if(pixels[k+dy*stride+dx]!==1)return false;
  // Uma diagonal nao cria uma aresta extra em uma curva de 90 graus.
  return dx===0||dy===0||(pixels[k+dx]===0&&pixels[k+dy*stride]===0);
}
