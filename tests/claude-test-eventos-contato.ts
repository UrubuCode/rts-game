// Eventos de contato (Lote B2): Enter/Stay/Exit e gatilhos entregues aos
// scripts depois do passo. Desenho: docs/superpowers/specs/2026-09-25-eventos-de-contato-design.md
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject, COL_BOX } from "@engine/core/gameobject";
import { FIXED_DT } from "@engine/core/fixedstep";
import { Rigidbody } from "@scripts/rigidbody";
import { Collider, SHAPE_BOX, SHAPE_SPHERE } from "@engine/core/collider";
import { Behavior } from "@engine/core/behavior";
import { ContactInfo, CONTACT_EVENTS_ENTER_EXIT, CONTACT_EVENTS_STAY } from "@engine/core/contact_events";
import { rigidSetMode, rigidStep, rigidFlush } from "@engine/core/physics_backend";
import { crAvailable } from "@engine/rigid/cpurigid";

let falhas = 0;
let total = 0;
function check(nome: string, cond: number): void {
  total = total + 1;
  if (cond !== 0) io.print("  [OK] " + nome);
  else { falhas = falhas + 1; io.print("  [FALHA] " + nome); }
}

/// Sonda: conta o que chega e guarda o último `other`/`stepId`.
class Sonda extends Behavior {
  enter: number = 0; stay: number = 0; exit: number = 0;
  tEnter: number = 0; tStay: number = 0; tExit: number = 0;
  lastOther: string = ""; lastStep: number = 0;
  ordem: string[] = [];
  removeOther: number = 0;
  cena: Scene | null = null;
  onCollisionEnter(c: ContactInfo): void {
    this.enter = this.enter + 1; this.lastOther = c.other.name; this.lastStep = c.stepId;
    this.ordem.push(c.other.name);
    if (this.removeOther !== 0 && this.cena !== null) {
      const idx = this.cena.objects.indexOf(c.other);
      if (idx >= 0) this.cena.removeAt(idx);
    }
  }
  onCollisionStay(c: ContactInfo): void { this.stay = this.stay + 1; }
  onCollisionExit(c: ContactInfo): void { this.exit = this.exit + 1; this.lastOther = c.other.name; }
  onTriggerEnter(c: ContactInfo): void { this.tEnter = this.tEnter + 1; this.lastOther = c.other.name; }
  onTriggerStay(c: ContactInfo): void { this.tStay = this.tStay + 1; }
  onTriggerExit(c: ContactInfo): void { this.tExit = this.tExit + 1; }
}

function passos(sc: Scene, n: number): void {
  let i = 0;
  while (i < n) {
    sc.update(FIXED_DT);
    if (rigidStep(sc, 0) === 0) sc.resolveCollisions();
    i = i + 1;
  }
  rigidFlush();
  sc.computeWorld();
}

function chao(sc: Scene): GameObject {
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.sx = 80.0; g.transform.sy = 1.0; g.transform.sz = 80.0;
  g.colShape = COL_BOX;
  g.stationary = 1;
  sc.add(g);
  return g;
}

function corpo(sc: Scene, nome: string, x: f64, y: f64, events: number): GameObject {
  const g = new GameObject(nome);
  g.setMesh(1, 200, 200, 200);
  g.colShape = COL_BOX;
  g.transform.setPosition(x, y, 0.0);
  const rb = new Rigidbody(0.0 - 9.8, 0.0);
  rb.floorY = 0.0 - 1.0e9;
  g.addBehavior(rb);
  if (events !== 0) {
    const c = new Collider(SHAPE_BOX);
    c.events = events;
    g.addBehavior(c);
  }
  sc.add(g);
  return g;
}

function sonda(g: GameObject): Sonda {
  const s = new Sonda();
  g.addBehavior(s);
  return s;
}

rigidSetMode(0);
io.print("=== Eventos de contato (Lote B2) ===");

// ── 1) sem inscrição: nada ─────────────────────────────────────────────────
{
  const sc = new Scene("SemInscricao");
  chao(sc);
  const g = corpo(sc, "Caixa", 0.0, 3.0, 0);
  const s = sonda(g);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 120);
  check("1. sem Collider.events: nenhum Enter", s.enter === 0 ? 1 : 0);
  check("1. sem Collider.events: conjunto persistente vazio", sc.contacts.count() === 0 ? 1 : 0);
}

// ── 2) queda no chão: UM Enter, other e stepId certos, sem Stay ────────────
{
  const sc = new Scene("Queda");
  chao(sc);
  const g = corpo(sc, "Caixa", 0.0, 3.0, CONTACT_EVENTS_ENTER_EXIT);
  const s = sonda(g);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 120);
  check("2. exatamente um Enter (nao um por passada/lado)", s.enter === 1 ? 1 : 0);
  check("2. other e o Chao", s.lastOther === "Chao" ? 1 : 0);
  check("2. stepId do Enter e um passo valido (1..120)", s.lastStep >= 1 && s.lastStep <= 120 ? 1 : 0);
  check("2. events=1 nao entrega Stay", s.stay === 0 ? 1 : 0);
  check("2. um par persistente", sc.contacts.count() === 1 ? 1 : 0);
  // ── 4) repouso: nada de espúrio ──
  const enterAntes = s.enter;
  passos(sc, 300);
  check("4. em repouso (dormindo) nao ha Enter nem Exit espurios", s.enter === enterAntes && s.exit === 0 ? 1 : 0);
  // ── 5) separação por impulso: UM Exit ──
  g.transform.vy = 12.0;
  passos(sc, 30);
  check("5. impulso para cima gera um Exit", s.exit === 1 ? 1 : 0);
  check("5. conjunto persistente esvaziou", sc.contacts.count() === 0 ? 1 : 0);
  passos(sc, 200);
  check("5. e volta a cair: segundo Enter", s.enter === 2 ? 1 : 0);
}

// ── 3) Stay opt-in ────────────────────────────────────────────────────────
{
  const sc = new Scene("Stay");
  chao(sc);
  const g = corpo(sc, "Caixa", 0.0, 3.0, CONTACT_EVENTS_STAY);
  const s = sonda(g);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 120);
  check("3. events=2: Enter uma vez", s.enter === 1 ? 1 : 0);
  check("3. events=2: Stay veio em varios passos", s.stay > 10 ? 1 : 0);
  const stayAntes = s.stay;
  g.transform.vy = 12.0;
  passos(sc, 10);
  const stayNaSubida = s.stay;
  passos(sc, 10);
  check("3. Stay para de vir depois de separar", s.stay === stayNaSubida || s.stay - stayNaSubida <= 1 ? 1 : 0);
  check("3. (houve Stay antes de separar)", stayAntes > 0 ? 1 : 0);
}

// ── 6) remoção de um corpo tocando: Exit para o sobrevivente ──────────────
{
  const sc = new Scene("Remocao");
  chao(sc);
  const a = corpo(sc, "A", 0.0, 3.0, CONTACT_EVENTS_ENTER_EXIT);
  const s = sonda(a);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 120);
  check("6. A tocou o chao", s.enter === 1 ? 1 : 0);
  sc.removeAt(sc.objects.indexOf(sc.objects[0]));  // remove o Chao
  passos(sc, 1);
  check("6. remover o outro corpo gera Exit no sobrevivente", s.exit === 1 && s.lastOther === "Chao" ? 1 : 0);
  check("6. conjunto persistente vazio apos remocao", sc.contacts.count() === 0 ? 1 : 0);
}

// ── 7) gatilho: onTrigger*, nada em onCollision* ──────────────────────────
{
  const sc = new Scene("Gatilho");
  chao(sc);
  const zona = new GameObject("Zona");
  zona.setMesh(1, 80, 160, 80);
  zona.colShape = COL_BOX;
  zona.transform.setPosition(0.0, 5.0, 0.0);
  zona.transform.sx = 3.0; zona.transform.sy = 1.0; zona.transform.sz = 3.0;
  zona.stationary = 1;
  const cz = new Collider(SHAPE_BOX);
  cz.trigger = 1;
  cz.events = CONTACT_EVENTS_ENTER_EXIT;
  zona.addBehavior(cz);
  const sz = sonda(zona);
  sc.add(zona);
  const g = corpo(sc, "Passante", 0.0, 10.0, 0);
  const sg = sonda(g);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 300);
  check("7. zona recebeu onTriggerEnter", sz.tEnter === 1 ? 1 : 0);
  check("7. passante recebeu onTriggerEnter (other = Zona)", sg.tEnter === 1 && sg.lastOther === "Zona" ? 1 : 0);
  check("7. e onTriggerExit ao atravessar", sz.tExit === 1 && sg.tExit === 1 ? 1 : 0);
  check("7. nada em onCollision*", sz.enter === 0 && sg.enter === 0 && sz.exit === 0 && sg.exit === 0 ? 1 : 0);
  check("7. passante atravessou (parou no chao)", g.transform.py < 1.2 ? 1 : 0);
}

// ── 8) ordem determinística por (minId, maxId) ────────────────────────────
{
  const sc = new Scene("Ordem");
  const centro = corpo(sc, "Centro", 0.0, 0.5, CONTACT_EVENTS_ENTER_EXIT);
  const s = sonda(centro);
  // três vizinhos criados em ordem de id; posicionados encostando no centro
  // em ordem DIFERENTE da de id, para a ordem de entrega nao ser a de posicao
  const c = corpo(sc, "C", 0.9, 0.5, 0);
  const a = corpo(sc, "A", 0.0 - 0.9, 0.5, 0);
  const b = corpo(sc, "B", 0.0, 0.5, 0);
  b.transform.setPosition(0.0, 0.5, 0.9);
  sc.markCollidersDirty(); sc.computeWorld();
  sc.resolveCollisions();
  check("8. tres Enter no mesmo passo", s.enter === 3 ? 1 : 0);
  check("8. ordem por id: C, A, B (ordem de criacao)",
        s.ordem.length === 3 && s.ordem[0] === "C" && s.ordem[1] === "A" && s.ordem[2] === "B" ? 1 : 0);
}

// ── 9) script que remove `other` dentro do Enter ──────────────────────────
{
  const sc = new Scene("RemoveNoHook");
  chao(sc);
  const g = corpo(sc, "Bala", 0.0, 3.0, CONTACT_EVENTS_ENTER_EXIT);
  const s = sonda(g);
  s.removeOther = 1; s.cena = sc;
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 120);
  check("9. remover other dentro de onCollisionEnter nao quebra o passo", s.enter === 1 ? 1 : 0);
  check("9. o chao foi removido pelo script", sc.objects.length === 1 ? 1 : 0);
  passos(sc, 5);
  check("9. e o par encerra com Exit", s.exit === 1 ? 1 : 0);
}

// ── 10) backend Rust + inscrição → passo na CPU e eventos chegam ──────────
if (crAvailable() !== 0) {
  rigidSetMode(2);
  const sc = new Scene("RustFallback");
  chao(sc);
  const g = corpo(sc, "Caixa", 0.0, 3.0, CONTACT_EVENTS_ENTER_EXIT);
  const s = sonda(g);
  sc.markCollidersDirty(); sc.computeWorld();
  let cpu = 1;
  let i = 0;
  while (i < 120) {
    sc.update(FIXED_DT);
    if (rigidStep(sc, 0) === 0) sc.resolveCollisions(); else cpu = 0;
    i = i + 1;
  }
  check("10. com colisor inscrito o backend Rust recusa e o passo fica na CPU", cpu);
  check("10. e o Enter chega", s.enter === 1 ? 1 : 0);
  rigidSetMode(0);
} else {
  io.print("  (10. backend Rust indisponivel: pulado)");
}

io.print("");
if (falhas === 0) io.print("[PASSOU] Eventos de contato: " + total + " verificacoes");
else io.print("[FALHA] Eventos de contato: " + falhas + " de " + total);
