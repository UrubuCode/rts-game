/** Inactive chunks, oldest first. Taking an entry transfers resource ownership. */
export class FpsChunkCache {
  bytes:number=0;
  private entries:any[]=[];private maxCount:number;private maxBytes:number;
  private release:(chunk:any)=>void;
  constructor(maxCount:number,maxBytes:number,release:(chunk:any)=>void){
    if(!Number.isInteger(maxCount)||maxCount<0||!Number.isFinite(maxBytes)||maxBytes<0)throw new Error("Invalid chunk cache budget");
    this.maxCount=maxCount;this.maxBytes=maxBytes;this.release=release;
  }
  get count():number{return this.entries.length;}
  evictOldest():boolean {
    if(this.entries.length===0)return false;
    const evicted=this.entries.shift();this.bytes-=evicted.byteSize;this.release(evicted);return true;
  }
  take(x:number,z:number):any {
    for(let i=0;i<this.entries.length;i++){
      const c=this.entries[i];if(c.x===x&&c.z===z){this.entries.splice(i,1);this.bytes-=c.byteSize;return c;}
    }
    return null;
  }
  put(chunk:any):void {
    if(!Number.isFinite(chunk.byteSize)||chunk.byteSize<0)throw new Error("Invalid chunk byte size");
    const old=this.take(chunk.x,chunk.z);if(old!==null&&old!==chunk)this.release(old);
    this.entries.push(chunk);this.bytes+=chunk.byteSize;
    while(this.entries.length>this.maxCount||this.bytes>this.maxBytes){
      this.evictOldest();
    }
  }
  clear():void{for(let i=0;i<this.entries.length;i++)this.release(this.entries[i]);this.entries.length=0;this.bytes=0;}
}
