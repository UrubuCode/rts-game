import { WorldGenerationRequest,WorldMeshData } from "./world_generation";
import { WorldBiomeField } from "./world_biomes";
const VOXEL_FACE_BASIS=[0,0,1,1,0,0,0,1,0,0,0,-1,-1,0,0,0,1,0,1,0,0,0,0,-1,0,1,0,-1,0,0,0,0,1,0,1,0,0,1,0,1,0,0,0,0,-1,0,-1,0,1,0,0,0,0,1];
/** Extensão inicial: colunas 16×32×16 de blocos de 2 unidades. Halo evita faces entre chunks. */
export class VoxelGenerationJob {
  done:boolean=false;geometry:WorldMeshData[]=[];colliders:number[]=[];
  blocks:Uint8Array=new Uint8Array(18*34*18);
  private request:WorldGenerationRequest;private field:WorldBiomeField;
  private column:number=0;private meshing:boolean=false;
  constructor(request:WorldGenerationRequest){
    this.request=request;this.field=new WorldBiomeField(request.seed,request.profile.biomeScale,request.profile.heightScale);
    const materials=[0,1,5,4,11];
    for(let i=0;i<5;i++){const g=new WorldMeshData();g.material=materials[i];this.geometry.push(g);}
  }
  blockAt(x:number,y:number,z:number):number {
    if(x< -1||x>16||z< -1||z>16||y< -1||y>32)return 0;
    return this.blocks[((z+1)*34+y+1)*18+x+1];
  }
  private fillColumn(index:number):void {
    const x=index%18-1,z=Math.floor(index/18)-1,wx=(this.request.x*16+x)*2,wz=(this.request.z*16+z)*2;
    const top=Math.min(30,Math.max(2,Math.floor(this.field.height(wx,wz)/2)));
    const biome=this.request.profile.biomes?this.field.biomeAt(wx,wz):0;
    const surface=biome===2?4:biome===3?5:1;
    for(let y=-1;y<=32;y++){
      let block=y>top?0:y===top?surface:y>=top-2?3:2;
      if(block!==0&&y>1&&y<top-2&&this.request.profile.caves&&this.field.cave(wx,y*2,wz))block=0;
      this.blocks[((z+1)*34+y+1)*18+x+1]=block;
    }
  }
  private face(g:WorldMeshData,p:number[],side:number):void {
    const basis=VOXEL_FACE_BASIS,a=side*9,n=g.v.length/8;
    for(let c=0;c<4;c++){
      const u=c===0||c===3?-1:1,t=c<2?-1:1;
      g.v.push(p[0]+basis[a]+basis[a+3]*u+basis[a+6]*t,p[1]+basis[a+1]+basis[a+4]*u+basis[a+7]*t,p[2]+basis[a+2]+basis[a+5]*u+basis[a+8]*t,basis[a],basis[a+1],basis[a+2],u<0?0:1,t<0?0:1);
    }
    g.i.push(n,n+1,n+2,n,n+2,n+3);
  }
  private meshColumn(index:number):void {
    const x=index%16,z=Math.floor(index/16),p=[x*2+1,0,z*2+1];let run=-1;
    for(let y=0;y<=32;y++){
      const block=y<32?this.blockAt(x,y,z):0;
      if(block===0){if(run>=0){this.colliders.push(x*2,run*2,z*2,x*2+2,y*2,z*2+2);run=-1;}continue;}
      if(run<0)run=y;p[1]=y*2+1;
      const g=this.geometry[block-1],b=VOXEL_FACE_BASIS;
      for(let side=0;side<6;side++){const a=side*9;if(this.blockAt(x+b[a],y+b[a+1],z+b[a+2])===0)this.face(g,p,side);}
    }
  }
  step():void {
    if(this.done)return;
    if(!this.meshing){this.fillColumn(this.column++);if(this.column===324){this.column=0;this.meshing=true;}}
    else{this.meshColumn(this.column++);if(this.column===256)this.done=true;}
  }
}
