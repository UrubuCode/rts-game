// Runner do bench de quadro (Task 10.5): roda editor/jogo com RTS_BENCH, conta
// as coletas do GC entre os marcadores e anota a carga da máquina (typeperf).
//
//   node bench/claude-frame-bench.mjs [--runs 5] [--frames 5000] [--warmup 600]
//        [--only ed-padrao,jogo-vitrine] [--label antes] [--out bench/out/x.json]
//
// Cada execução abre UMA janela (ui_fixture), mede e fecha sozinha. O binário
// vem de RTS_UI_FIXTURE ou de ../../../rts-uv-mundo (a worktree do runtime).
// Relata por cenário: mínimo e mediana das execuções para parede média, CPU
// média, GC/1000 quadros, objetos/quadro, pior quadro e quadros > 10 ms.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// Sobe a partir da raiz até achar a pasta irmã `rts-uv-mundo` (vale para worktrees aninhadas).
function acharFixture() {
  let d = root;
  for (let i = 0; i < 6; i++) {
    const c = path.join(d, 'rts-uv-mundo', 'target', 'release', 'examples', 'ui_fixture.exe');
    if (fs.existsSync(c)) return c;
    d = path.dirname(d);
  }
  return 'ui_fixture.exe';
}
const fixture = process.env.RTS_UI_FIXTURE || acharFixture();

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const RUNS = parseInt(arg('runs', '5'));
const FRAMES = parseInt(arg('frames', '5000'));
const WARMUP = parseInt(arg('warmup', '600'));
const LABEL = arg('label', 'medida');
const ONLY = arg('only', '');
const OUT = arg('out', path.join('bench', 'out', `frame-bench-${LABEL}.json`));

const CENARIOS = [
  // Sem seleção = -1: a sessão abre com o objeto 0 selecionado (S.selected = 0).
  { tag: 'ed-padrao', file: 'main.ts', env: { RTS_SCENE: 'scenes/shadowdemo.json', RTS_BENCH_SELECT: '-1' } },
  { tag: 'ed-padrao-sel', file: 'main.ts', env: { RTS_SCENE: 'scenes/shadowdemo.json', RTS_BENCH_SELECT: '1' } },
  { tag: 'ed-vitrine', file: 'main.ts', env: { RTS_SCENE: 'scenes/vitrine.json', RTS_BENCH_SELECT: '-1' } },
  { tag: 'ed-vitrine-sel', file: 'main.ts', env: { RTS_SCENE: 'scenes/vitrine.json', RTS_BENCH_SELECT: '0' } },
  { tag: 'jogo-vitrine', file: 'game.ts', env: {} },
].filter(c => ONLY === '' || ONLY.split(',').includes(c.tag));

const CPU_COUNTER = process.env.RTS_CPU_COUNTER || '\\Processador(_Total)\\% Tempo de Processador';

function runOnce(c, k) {
  return new Promise((resolve) => {
    const logDir = path.join(root, 'bench', 'out', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const log = path.join(logDir, `${LABEL}-${c.tag}-${k}.log`);
    // Posição da janela: a padrão do editor/jogo; RTS_JANELA_X/Y no ambiente a movem (ex.: outro monitor).
    const env = { ...process.env, ...c.env, RTS_VSYNC: '0', RTS_GC_DEBUG: '1',
      RTS_BENCH: String(FRAMES), RTS_BENCH_WARMUP: String(WARMUP), RTS_BENCH_TAG: c.tag };
    const cpu = spawn('typeperf', [CPU_COUNTER, '-si', '1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let cpuTxt = '';
    cpu.stdout.on('data', d => { cpuTxt += d.toString(); });
    const child = spawn('cmd', ['/s', '/c', `""${fixture}" ${c.file} > "${log}" 2>&1"`], { cwd: root, env, windowsVerbatimArguments: true });
    const timer = setTimeout(() => { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)]); }, 180000);
    child.on('exit', () => {
      clearTimeout(timer);
      spawnSync('taskkill', ['/T', '/F', '/PID', String(cpu.pid)]);
      const txt = fs.readFileSync(log, 'utf8');
      const lines = txt.split(/\r?\n/);
      let on = false; let gc = 0; let freed = 0; let resumo = null;
      for (const l of lines) {
        if (l.startsWith('[bench] inicio')) on = true;
        else if (l.startsWith('[bench] fim')) on = false;
        else if (on && l.startsWith('rts-gc')) { gc++; const m = /freed (\d+)/.exec(l); if (m) freed += parseInt(m[1]); }
        else if (l.startsWith('[bench] resumo')) {
          resumo = {};
          for (const kv of l.split(' ').slice(2)) { const [a, b] = kv.split('='); resumo[a] = isNaN(Number(b)) ? b : Number(b); }
        }
      }
      const samples = cpuTxt.split(/\r?\n/).map(l => /^"[^"]+","([\d.]+)"/.exec(l)).filter(Boolean).map(m => parseFloat(m[1]));
      const cpuMed = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : NaN;
      if (!resumo) { resolve({ tag: c.tag, erro: 'sem resumo (ver ' + log + ')' }); return; }
      resolve({ tag: c.tag, k, ...resumo, gc, gc1000: gc * 1000 / FRAMES, objQuadro: freed / FRAMES,
        cpuMaquina: cpuMed, cpuMaquinaMax: samples.length ? Math.max(...samples) : NaN });
    });
  });
}

function stat(v) { const s = [...v].sort((a, b) => a - b); return { min: s[0], med: s[(s.length / 2) | 0], max: s[s.length - 1] }; }
const f2 = x => (x === undefined || isNaN(x)) ? '-' : x.toFixed(2);

const todos = [];
for (const c of CENARIOS) {
  for (let k = 0; k < RUNS; k++) {
    const r = await runOnce(c, k);
    todos.push(r);
    console.log(JSON.stringify(r));
  }
}
fs.mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true });
fs.writeFileSync(path.resolve(root, OUT), JSON.stringify(todos, null, 1));

console.log(`\n| cenário (${LABEL}) | parede média ms (min/med) | CPU TS ms (min/med) | GC/1000 (min/med) | obj/quadro (min/med) | pior quadro ms (med) | >10 ms (med) | CPU máquina % (med) |`);
console.log('|---|---|---|---|---|---|---|---|');
for (const c of CENARIOS) {
  const rs = todos.filter(r => r.tag === c.tag && !r.erro);
  if (rs.length === 0) { console.log(`| ${c.tag} | erro | | | | | | |`); continue; }
  const p = stat(rs.map(r => r.parede_media)); const q = stat(rs.map(r => r.cpu_media));
  const g = stat(rs.map(r => r.gc1000)); const o = stat(rs.map(r => r.objQuadro));
  const m = stat(rs.map(r => r.parede_max)); const pk = stat(rs.map(r => r.picos_10ms)); const u = stat(rs.map(r => r.cpuMaquina));
  console.log(`| ${c.tag} | ${f2(p.min)} / ${f2(p.med)} | ${f2(q.min)} / ${f2(q.med)} | ${f2(g.min)} / ${f2(g.med)} | ${f2(o.min)} / ${f2(o.med)} | ${f2(m.med)} | ${pk.med} | ${f2(u.med)} |`);
}
