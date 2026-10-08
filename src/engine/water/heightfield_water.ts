/** Água por colunas: transporte conservativo por diferença de nível, sem partículas.
 * Bordas fechadas. Obstáculos são alturas no leito; não resolve cavernas ou jatos 3D.
 * Um passo usa buffers persistentes e no máximo quatro vizinhos por célula.
 */
export class HeightfieldWater {
  readonly resolution:number;
  readonly cellSize:number;
  readonly bed:Float64Array;
  readonly depth:Float64Array;
  readonly velocityX:Float64Array;
  readonly velocityZ:Float64Array;
  private delta:Float64Array;
  private elapsed:number=0;
  constructor(resolution:number,cellSize:number,bed:Float64Array) {
    if(!Number.isInteger(resolution)||resolution<2||resolution>128||!Number.isFinite(cellSize)||cellSize<.1||cellSize>1000||bed.length!==resolution*resolution)throw new Error("Grade de agua invalida");
    for(let i=0;i<bed.length;i++)if(!Number.isFinite(bed[i])||Math.abs(bed[i])>10000)throw new Error("Leito invalido");
    this.resolution=resolution;this.cellSize=cellSize;this.bed=new Float64Array(bed);
    this.depth=new Float64Array(bed.length);this.velocityX=new Float64Array(bed.length);this.velocityZ=new Float64Array(bed.length);
    this.delta=new Float64Array(bed.length);
  }
  time():number{return this.elapsed;}
  volume():number {let total=0;for(let i=0;i<this.depth.length;i++)total+=this.depth[i];return total*this.cellSize*this.cellSize;}
  /** Fonte em coordenadas de célula; volume em m³. Não perde água fora da grade. */
  addVolume(col:number,row:number,volume:number):boolean {
    if(!Number.isInteger(col)||!Number.isInteger(row)||col<0||row<0||col>=this.resolution||row>=this.resolution||!Number.isFinite(volume)||volume<0)return false;
    const i=row*this.resolution+col,next=this.depth[i]+volume/(this.cellSize*this.cellSize);
    if(!Number.isFinite(next)||next>10000)return false;this.depth[i]=next;return true;
  }
  step(dt:number):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.05)return;
    const n=this.resolution,d=this.depth,bed=this.bed,delta=this.delta,vx=this.velocityX,vz=this.velocityZ,count=d.length;
    delta.fill(0);vx.fill(0);vz.fill(0);
    const rate=9.81*dt/this.cellSize;
    // Uma visita por aresta. Reserva no máximo 1/4 da coluna por vizinho;
    // assim quatro saídas simultâneas nunca removem mais que o volume disponível.
    for(let i=0;i<count;i++){
      const height=bed[i]+d[i];
      for(let axis=0;axis<2;axis++){
        if((axis===0&&i%n===n-1)||(axis===1&&i>=count-n))continue;
        const j=i+(axis===0?1:n),drop=height-bed[j]-d[j];
        if(drop===0)continue;
        const donor=drop>0?i:j,wet=d[donor];if(wet<=0)continue;
        const available=Math.max(0,bed[donor]+wet-Math.max(bed[i],bed[j]));
        const amount=Math.min(wet*.25,Math.abs(drop)*.125,available*rate*.125)*(drop>0?1:-1);
        delta[i]-=amount;delta[j]+=amount;
        if(axis===0){vx[i]+=amount;vx[j]+=amount;}else{vz[i]+=amount;vz[j]+=amount;}
      }
    }
    for(let i=0;i<count;i++){
      d[i]=Math.max(0,d[i]+delta[i]);const scale=d[i]>.000001?this.cellSize/(2*dt*d[i]):0;
      vx[i]*=scale;vz[i]*=scale;
    }
    this.elapsed+=dt;
  }
  snapshot():string {
    const bed:number[]=[],depth:number[]=[],vx:number[]=[],vz:number[]=[];
    for(let i=0;i<this.depth.length;i++){bed.push(this.bed[i]);depth.push(this.depth[i]);vx.push(this.velocityX[i]);vz.push(this.velocityZ[i]);}
    return JSON.stringify({version:1,resolution:this.resolution,cellSize:this.cellSize,time:this.elapsed,bed:bed,depth:depth,velocityX:vx,velocityZ:vz});
  }
  /** Valida tudo antes da mutação. Leito diferente invalida o snapshot. */
  restore(snapshot:string):void {
    const s=JSON.parse(snapshot),count=this.depth.length;
    if(s===null||s.version!==1||s.resolution!==this.resolution||s.cellSize!==this.cellSize||!Number.isFinite(s.time)||s.time<0)throw new Error("Snapshot de agua incompativel");
    if(!Array.isArray(s.bed)||!Array.isArray(s.depth)||!Array.isArray(s.velocityX)||!Array.isArray(s.velocityZ)||s.bed.length!==count||s.depth.length!==count||s.velocityX.length!==count||s.velocityZ.length!==count)throw new Error("Snapshot de agua incompleto");
    for(let i=0;i<count;i++)if(s.bed[i]!==this.bed[i]||!Number.isFinite(s.depth[i])||s.depth[i]<0||s.depth[i]>10000||!Number.isFinite(s.velocityX[i])||!Number.isFinite(s.velocityZ[i]))throw new Error("Snapshot de agua ou leito invalido");
    for(let i=0;i<count;i++){this.depth[i]=s.depth[i];this.velocityX[i]=s.velocityX[i];this.velocityZ[i]=s.velocityZ[i];}
    this.elapsed=s.time;
  }
}
