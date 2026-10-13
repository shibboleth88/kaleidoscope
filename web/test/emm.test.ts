import { compile, emberMossMist } from '../src/library';
import { type Carrier, Discovery, rng, step } from '../src/engine';

describe('ember · moss · mist', () => {
  it('reads, and runs round the circle with all three, nested and linked, and stays bounded', () => {
    const lib = emberMossMist();
    const c = compile(lib);
    const bad = [...c.rules].filter(([, r]) => r instanceof Error).map(([id, r]) => `${lib.rules.find((x) => x.id === id)!.name}: ${(r as Error).message}`);
    expect(bad).toEqual([]);
    const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
    let g = c.states.get(lib.states[0].id) as Carrier;
    const random = rng(9);
    const d = new Discovery(rules, c.sig);
    const fired = new Set<string>();
    let most = 0;
    for (let i = 0; i < 3000; i++) {
      const s = step(g, rules, c.sig, random, d);
      if (!s) break;
      g = s.state;
      fired.add(s.transition.rule);
      most = Math.max(most, g.nodes.length);
    }
    // hunting, digesting and pacts all happen; the pond stays small, and no idle edge is left behind (F8)
    for (const r of ['Mist engulfs Ember', 'Ember digests Moss', 'Ember in Mist calls Moss', 'Moss comes for Mist']) expect(fired).toContain(r);
    expect(most).toBeLessThan(200);
    expect(g.edges.length).toBeLessThanOrEqual(g.nodes.length);
  });
});
