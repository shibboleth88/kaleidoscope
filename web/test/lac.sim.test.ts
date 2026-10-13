import { compile, lacOperon } from '../src/library';
import { type Carrier, Index, rng, step } from '../src/engine';

describe('the lac operon', () => {
  it('is repressed, induced by lactose, and repressed again once the lactose is digested', () => {
    const lib = lacOperon();
    const c = compile(lib);
    const bad = [...c.rules].filter(([, r]) => r instanceof Error).map(([id, r]) => `${lib.rules.find((x) => x.id === id)!.name}: ${(r as Error).message}`);
    expect(bad).toEqual([]);
    const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
    for (const seed of [1, 2, 3, 5]) {
      let g = c.states.get(lib.states[0].id) as Carrier;
      const random = rng(seed);
      const n = (t: string) => g.nodes.filter((x) => x.type === c.sig.id(t)).length;
      const repressed = () => {
        const ix = new Index(g);
        const op = g.nodes.find((x) => x.type === c.sig.id('Operon'))!;
        return ix.children({ node: op.id }).some((k) => k.type === c.sig.id('Repressor'));
      };
      expect(repressed()).toBe(true);
      let induced = false, again = false;
      for (let i = 0; i < 400 && !again; i++) {
        const s = step(g, rules, c.sig, random);
        if (!s) break;
        g = s.state;
        if (!induced && !repressed() && n('LacZ') >= 3) induced = true;
        if (induced && repressed() && n('Lactose') === 0) again = true;
        // only ever one repressor on the operator: the unless holds it
        const ix = new Index(g);
        const op = g.nodes.find((x) => x.type === c.sig.id('Operon'))!;
        expect(ix.children({ node: op.id }).filter((k) => k.type === c.sig.id('Repressor')).length).toBeLessThanOrEqual(1);
      }
      expect([seed, induced, again]).toEqual([seed, true, true]);
    }
  });
});
