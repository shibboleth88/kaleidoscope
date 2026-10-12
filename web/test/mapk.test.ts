import { type Carrier, Index, checkRule, formedProblems, print, rng, step } from '../src/engine';
import { initial, rules, sig } from '../src/systems/mapk';

const count = (g: Carrier, type: string) => g.nodes.filter((n) => n.type === sig.id(type)).length;

describe('MAPK', () => {
  it('has well-formed rules', () => {
    for (const r of rules) expect([r.name, checkRule(r)]).toEqual([r.name, []]);
  });

  it('runs, conserving what it should', () => {
    let g = initial;
    const random = rng(7);
    const fired = new Map<string, number>();
    let t = 0;
    for (let i = 0; i < 400; i++) {
      const s = step(g, rules, sig, random);
      if (!s) break;
      g = s.state;
      t += s.dt;
      fired.set(s.transition.rule, (fired.get(s.transition.rule) ?? 0) + 1);
      expect(formedProblems(g)).toEqual([]);
      // four ERKs, phosphorylated or not; one MEK; every bond joins two
      expect(count(g, 'ERK') + count(g, 'pERK')).toBe(4);
      expect(count(g, 'MEK')).toBe(1);
      const ix = new Index(g);
      for (const e of g.edges) expect(ix.pointsOn({ edge: e.id }).length).toBeLessThanOrEqual(2);
      // no idle edges pile up
      expect(g.edges.every((e) => ix.pointsOn({ edge: e.id }).length > 0)).toBe(true);
    }
    expect(t).toBeGreaterThan(0);
    // every rule had its turn
    for (const r of rules) expect([r.name, (fired.get(r.name) ?? 0) > 0]).toEqual([r.name, true]);
    // the names survive phosphorylation and transport
    const names = g.nodes.filter((n) => typeof n.payload === 'object').map((n) => (n.payload as { scalar: { text: string } }).scalar.text);
    expect(names.sort()).toEqual(['erk0', 'erk1', 'erk2', 'erk3']);
    expect(print(g, sig)).toMatch(/^Cell\(Cytoplasm\(/);
  });
});
