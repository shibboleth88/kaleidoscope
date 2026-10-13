// A run of the embryo, for profiling: `npm run profile` (node --cpu-prof on a bundle of this file).
import { type Carrier, Discovery, rng, step } from '../src/engine';
import { compile, embryo } from '../src/library';

const lib = embryo();
const c = compile(lib);
const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
let g = c.states.get(lib.states[0].id) as Carrier;
const d = new Discovery(rules, c.sig);
const random = rng(1);
const cells = () => g.nodes.filter((n) => n.type === c.sig.id('Cell')).length;
const stop = Number(process.argv[2] ?? 4000);
const t0 = performance.now();
let last = t0;
const fired = new Map<string, number>();
for (let i = 1; i <= stop; i++) {
  const s = step(g, rules, c.sig, random, d);
  if (!s) break;
  g = s.state;
  fired.set(s.transition.rule, (fired.get(s.transition.rule) ?? 0) + 1);
  if (i % 500 === 0) {
    const now = performance.now();
    console.log(`step ${i}  cells ${cells()}  nodes ${g.nodes.length}  ${((now - last) / 500).toFixed(2)} ms/step`);
    last = now;
  }
}
console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log([...fired].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(' · '));
