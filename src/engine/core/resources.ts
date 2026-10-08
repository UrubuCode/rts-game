import { resolve } from "node:path";

/** Identidade de arquivo, sem confundir URLs e recursos procedurais com caminhos. */
export function resourcePath(path: string): string {
  if (path.indexOf("data:") === 0 || path.indexOf("proc:") === 0) return path;
  const result = resolve(path).split("\\").join("/");
  return result.length > 1 && result[1] === ":" ? result.toLowerCase() : result;
}

class ResourceEntry<T> {
  value: T; references: number = 0; pinned: boolean = false;
  dispose: ((value: T) => void) | null;
  constructor(value: T, dispose: ((value: T) => void) | null) {
    this.value = value; this.dispose = dispose;
  }
}

/** Uma referencia de uso. release e idempotente; nao usar value depois dele. */
export class ResourceLease<T> {
  readonly value: T; released: boolean = false;
  private cache: ResourceCache<T>; private key: string; private entry: ResourceEntry<T>;
  constructor(cache: ResourceCache<T>, key: string, entry: ResourceEntry<T>) {
    this.cache = cache; this.key = key; this.entry = entry; this.value = entry.value;
  }
  /** Cria uma referencia independente para uma copia ou outro proprietario. */
  retain(): ResourceLease<T> {
    if (this.released) throw new Error("ResourceLease encerrado");
    return this.cache.retainEntry(this.key, this.entry);
  }
  release(): void {
    if (this.released) return;
    this.released = true; this.cache.releaseEntry(this.key, this.entry);
  }
}

/** Compartilha assets ou trabalhos pendentes. Nunca faz descarte no caminho get. */
export class ResourceCache<T> {
  readonly kind: string;
  hits: number = 0; misses: number = 0; loads: number = 0; disposals: number = 0;
  private entries: Map<string, ResourceEntry<T>> = new Map<string, ResourceEntry<T>>();
  constructor(kind: string) { this.kind = kind; }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) { this.misses++; return undefined; }
    this.hits++; return entry.value;
  }
  has(key: string): boolean { return this.entries.has(key); }
  /** Compatibilidade: recursos sem lease ficam retidos ate evict/clear. */
  set(key: string, value: T): void {
    const old = this.entries.get(key);
    if (old !== undefined) {
      if (old.value === value) { old.pinned = true; return; }
      if (old.references > 0) throw new Error("Recurso ainda em uso: " + this.kind + ":" + key);
      this.entries.delete(key); this.destroy(old);
    }
    const entry = new ResourceEntry<T>(value, null); entry.pinned = true;
    this.entries.set(key, entry); this.loads++;
  }
  /** O factory roda uma vez. Pode devolver um asset pronto ou um job com tick(). */
  acquire(key: string, factory: () => T, dispose: ((value: T) => void) | null = null): ResourceLease<T> {
    let entry = this.entries.get(key);
    if (entry === undefined) {
      this.misses++;
      // Uma falha do factory nao deixa uma entrada parcial no registro.
      entry = new ResourceEntry<T>(factory(), dispose);
      this.entries.set(key, entry); this.loads++;
    } else this.hits++;
    entry.references++;
    return new ResourceLease<T>(this, key, entry);
  }
  retainEntry(key: string, entry: ResourceEntry<T>): ResourceLease<T> {
    if (this.entries.get(key) !== entry) throw new Error("Recurso descartado: " + this.kind);
    entry.references++;
    return new ResourceLease<T>(this, key, entry);
  }
  releaseEntry(key: string, entry: ResourceEntry<T>): void {
    if (entry.references > 0) entry.references--;
    if (entry.references === 0 && !entry.pinned && this.entries.get(key) === entry) {
      this.entries.delete(key); this.destroy(entry);
    }
  }
  /** Remove a retencao do cache; usuarios ativos mantem o recurso vivo. */
  evict(key: string): void {
    const entry = this.entries.get(key); if (entry === undefined) return;
    entry.pinned = false;
    if (entry.references === 0) { this.entries.delete(key); this.destroy(entry); }
  }
  clear(): void {
    const keys: string[] = [];
    this.entries.forEach((_entry, key) => { keys.push(key); });
    let failed = false; let failure: any = null;
    for (let i = 0; i < keys.length; i++) {
      try { this.evict(keys[i]); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    if (failed) throw failure;
  }
  private destroy(entry: ResourceEntry<T>): void {
    this.disposals++;
    if (entry.dispose !== null) entry.dispose(entry.value);
  }
  stats(): any {
    let references = 0; let pinned = 0;
    this.entries.forEach(entry => { references += entry.references; if (entry.pinned) pinned++; });
    return { kind: this.kind, entries: this.entries.size, references, pinned,
      hits: this.hits, misses: this.misses, loads: this.loads, disposals: this.disposals };
  }
}

const resourceCaches = new Map<string, ResourceCache<any>>();
export function resourceCache<T>(kind: string): ResourceCache<T> {
  const existing = resourceCaches.get(kind);
  if (existing !== undefined) return existing;
  const cache = new ResourceCache<T>(kind); resourceCaches.set(kind, cache); return cache;
}
/** Diagnostico sob demanda; nao chamar por quadro. */
export function resourceStatistics(): any[] {
  const result: any[] = [];
  resourceCaches.forEach(cache => { result.push(cache.stats()); });
  return result;
}

/** Agrupa referencias de uma cena, componente ou subsistema. */
export class ResourceScope {
  private leases: ResourceLease<any>[] = []; private closed: boolean = false;
  keep<T>(lease: ResourceLease<T>): ResourceLease<T> {
    if (this.closed) { lease.release(); throw new Error("ResourceScope encerrado"); }
    this.leases.push(lease); return lease;
  }
  release(): void {
    if (this.closed) return;
    this.closed = true;
    let failed = false; let failure: any = null;
    for (let i = this.leases.length - 1; i >= 0; i--) {
      try { this.leases[i].release(); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    this.leases.length = 0;
    if (failed) throw failure;
  }
}

// Descartes de GPU esperam o envio dos comandos da respectiva janela.
class DeferredResourceDisposal {
  owner:number;dispose:()=>void;
  constructor(owner:number,dispose:()=>void){this.owner=owner;this.dispose=dispose;}
}
let deferredDisposals:DeferredResourceDisposal[]=[];
export function deferResourceDisposal(owner:number,dispose:()=>void):void {
  deferredDisposals.push(new DeferredResourceDisposal(owner,dispose));
}
export function flushResourceDisposals(owner:number):void {
  if(deferredDisposals.length===0)return;
  flushPendingResourceDisposals(owner);
}
function flushPendingResourceDisposals(owner:number):void {
  const pending=deferredDisposals;deferredDisposals=[];
  let failed=false;let failure:any=null;
  for(let i=0;i<pending.length;i++){
    const item=pending[i];
    if(item.owner===owner){
      try{item.dispose();}catch(error){if(!failed){failed=true;failure=error;}}
    }else deferredDisposals.push(item);
  }
  if(failed)throw failure;
}
