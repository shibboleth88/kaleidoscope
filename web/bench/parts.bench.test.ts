import { it } from 'vitest';
import { type Carrier, Discovery, readState, react, rng } from '../src/engine';
import { compile, mapk } from '../src/library';

it('parts of a step (crowded MAPK, incremental)', () => {
  const lib = mapk();
  const c = compile(lib);
  const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
  let g = readState(`Cell(Cytoplasm(${Array(120).fill('MEK').join(' | ')} | ${Array(120).fill('ERK[name = "e"]').join(' | ')} | Nucleus() | ERLumen()))`, c.sig) as Carrier;
  const d = new Discovery(rules, c.sig);
  const random = rng(1);
  const t = { live: 0, pick: 0, fresh: 0, react: 0, advance: 0 };
  const N = 40;
  d.live(g);
  for (let i = 0; i < N; i++) {
    let t0 = performance.now();
    const live = d.live(g);
    t.live += performance.now() - t0;
    t0 = performance.now();
    const total = live.reduce((a, s) => a + s.rate, 0);
    let u = random() * total, chosen = live[0];
    for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
    t.pick += performance.now() - t0;
    t0 = performance.now();
    const occ = d.fresh(g, chosen.rule, chosen.occurrences[0]);
    t.fresh += performance.now() - t0;
    t0 = performance.now();
    const r = react(g, chosen.rule, occ, c.sig);
    t.react += performance.now() - t0;
    t0 = performance.now();
    d.advance(g, r.state, r.transition);
    t.advance += performance.now() - t0;
    g = r.state;
  }
  console.log(Object.entries(t).map(([k, v]) => `${k} ${(v / N).toFixed(2)}ms`).join('  '));
});
