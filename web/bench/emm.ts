// Explore ember · moss · mist: counts of each kind (and how deep they nest) over simulated time.
import { compile, emberMossMist } from '../src/library';
import { type Carrier, Discovery, Index, rng, step } from '../src/engine';

const lib = emberMossMist();
// overrides, for sweeping: E=engulf S=starve D=digest A=arrive K=capacity G=growth
const env = process.env;
for (const r of lib.rules) {
  if (env.E && / engulfs /.test(r.name)) r.rate = Number(env.E);
  if (env.C && / calls /.test(r.name)) r.rate = Number(env.C);
  if (env.H && / comes for /.test(r.name)) r.rate = Number(env.H);
  const own = env[`E_${r.name.split(' ')[0]}`];
  if (own && / engulfs /.test(r.name)) r.rate = Number(own);
  if (env.S && / (starves|withers)$/.test(r.name) && !/Moss/.test(r.name)) r.rate = Number(env.S);
  if (env.D && / digests /.test(r.name)) r.rate = Number(env.D);
  if (env.A && / arrives$/.test(r.name)) r.rate = Number(env.A);
  if ((env.K || env.G) && r.name === 'Moss grows') r.rate = `${env.G ?? 0.8} * max[1 - count[?s] / ${env.K ?? 24} 0]`;
}
const c = compile(lib);
for (const [id, r] of c.rules) if (r instanceof Error) console.log('BAD', lib.rules.find((x) => x.id === id)!.name, r.message);
const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
const seed = Number(process.argv[2] ?? 9);
const T = Number(process.argv[3] ?? 400);
let g = c.states.get(lib.states[0].id) as Carrier;
const random = rng(seed);
const d = new Discovery(rules, c.sig);
let t = 0, next = 0, steps = 0;
const fired = new Map<string, number>();
const combos = new Map<string, number>();
const t0 = performance.now();
while (t < T && steps < 60000) {
  const s = step(g, rules, c.sig, random, d);
  if (!s) break;
  {
    const key = ['Ember', 'Moss', 'Mist'].map((k) => (g.nodes.some((x) => x.type === c.sig.id(k)) ? k[0] + (k === 'Mist' ? 'i' : '') : '·')).join('');
    combos.set(key, (combos.get(key) ?? 0) + s.dt);
  }
  g = s.state; t += s.dt; steps++;
  if (env.TRACE && /Mist/.test(s.transition.rule)) console.log(`  ${t.toFixed(1)} ${s.transition.rule}  mists ${g.nodes.filter((x) => x.type === c.sig.id('Mist')).length}`);
  fired.set(s.transition.rule, (fired.get(s.transition.rule) ?? 0) + 1);
  if (t >= next) {
    next += T / 40;
    const ix = new Index(g);
    const depth = (id: number) => { let k = 0; let n = g.nodes.find((x) => x.id === id)!; while ('node' in n.parent) { k++; n = g.nodes.find((x) => x.id === (n.parent as { node: number }).node)!; } return k; };
    const row = ['Ember', 'Moss', 'Mist'].map((k) => {
      const ns = g.nodes.filter((x) => x.type === c.sig.id(k));
      return `${k[0]} ${String(ns.length).padStart(3)}`;
    });
    const maxDepth = Math.max(0, ...g.nodes.map((n) => depth(n.id)));
    const links = g.edges.length;
    void ix;
    console.log(`t ${t.toFixed(0).padStart(4)}  ${row.join('  ')}  depth ${maxDepth}  pacts ${links}`);
  }
}
console.log('time with each present:', [...combos].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / t).toFixed(0)}%`).join(' · '));
console.log(`${steps} steps, ${(performance.now() - t0).toFixed(0)} ms`);
console.log([...fired].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
