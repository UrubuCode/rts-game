/** Explicit accounting for owned mesh buffers, including active, cached and staged. */
export class FpsResourceBudget {
  bytes:number=0;meshes:number=0;peakBytes:number=0;
  maxBytes:number;maxMeshes:number;
  constructor(maxBytes:number,maxMeshes:number){
    if(!Number.isFinite(maxBytes)||!Number.isInteger(maxMeshes)||maxBytes<=0||maxMeshes<=0)throw new Error("Invalid resource budget");
    this.maxBytes=maxBytes;this.maxMeshes=maxMeshes;
  }
  reserve(bytes:number):boolean {
    if(!Number.isFinite(bytes)||bytes<=0||this.bytes+bytes>this.maxBytes||this.meshes+1>this.maxMeshes)return false;
    this.bytes+=bytes;this.meshes++;this.peakBytes=Math.max(this.peakBytes,this.bytes);return true;
  }
  release(bytes:number,meshes:number):void {
    if(!Number.isFinite(bytes)||!Number.isInteger(meshes)||bytes<0||meshes<0||bytes>this.bytes||meshes>this.meshes)throw new Error("Resource accounting underflow");
    this.bytes-=bytes;this.meshes-=meshes;
  }
}
