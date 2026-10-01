/** Contrato de CPU. Geradores não acessam janela, GPU ou estado do editor. */
export class WorldMeshData {
  v:number[]=[];i:number[]=[];material:number=0;lod:number=0;
}
export interface WorldGenerationJob {
  done:boolean;
  geometry:WorldMeshData[];
  colliders:number[];
  step():void;
}
export class WorldGenerationProfile {
  generator:string="heightfield";
  biomeScale:number=512;
  heightScale:number=28;
  biomes:boolean=false;
  caves:boolean=true;
  options:any={};
  validate():void {
    if(this.generator.length===0||this.generator.length>64)throw new Error("Identificador de gerador inválido");
    if(!Number.isFinite(this.biomeScale)||this.biomeScale<64||this.biomeScale>8192)throw new Error("Escala de biomas inválida");
    if(!Number.isFinite(this.heightScale)||this.heightScale<1||this.heightScale>48)throw new Error("Altura de geração inválida");
    if(this.options===null||typeof this.options!=="object"||Array.isArray(this.options)||JSON.stringify(this.options).length>65536)throw new Error("Opções da extensão inválidas");
  }
  static fromData(data:any):WorldGenerationProfile {
    const p=new WorldGenerationProfile();
    if(data){p.generator=data.generator;p.biomeScale=data.biomeScale;p.heightScale=data.heightScale;p.biomes=data.biomes===true;p.caves=data.caves===true;if(data.options!==undefined)p.options=JSON.parse(JSON.stringify(data.options));}
    p.validate();return p;
  }
}
export class WorldGenerationRequest {
  seed:number;x:number;z:number;profile:WorldGenerationProfile;vegetation:any=null;
  constructor(seed:number,x:number,z:number,profile:WorldGenerationProfile){this.seed=seed;this.x=x;this.z=z;this.profile=profile;}
}
export class WorldGeneratorRegistry {
  private factories:Map<string,(request:WorldGenerationRequest)=>WorldGenerationJob>=new Map();
  private sizes:Map<string,number>=new Map();
  register(id:string,size:number,factory:(request:WorldGenerationRequest)=>WorldGenerationJob):void {
    if(this.factories.has(id)||id.length===0||!Number.isFinite(size)||size<=0)throw new Error("Registro de gerador inválido: "+id);
    this.factories.set(id,factory);this.sizes.set(id,size);
  }
  chunkSize(id:string):number {
    const size=this.sizes.get(id);if(size===undefined)throw new Error("Gerador não registrado: "+id);return size;
  }
  create(request:WorldGenerationRequest):WorldGenerationJob {
    request.profile.validate();const factory=this.factories.get(request.profile.generator);
    if(factory===undefined)throw new Error("Gerador não registrado: "+request.profile.generator);
    return factory(request);
  }
}
