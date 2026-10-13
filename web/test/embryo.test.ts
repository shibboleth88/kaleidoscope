import { type Carrier, Discovery, rng, step } from '../src/engine';
import { compile, embryo } from '../src/library';

describe('the embryo (wyrm)', () => {
  it('reads', () => {
    const lib = embryo();
    const c = compile(lib);
    expect([...c.typeErrors]).toEqual([]);
    const bad = lib.rules.flatMap((r) => (c.rules.get(r.id) instanceof Error ? [`${r.name}: ${(c.rules.get(r.id) as Error).message}`] : []));
    expect(bad).toEqual([]);
    expect(c.states.get(lib.states[0].id) instanceof Error).toBe(false);
  });

  it('grows to the 28 cells of the lineage, by the time the measured periods say', () => {
    const lib = embryo();
    const c = compile(lib);
    const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
    let g = c.states.get(lib.states[0].id) as Carrier;
    const d = new Discovery(rules, c.sig);
    const random = rng(1);
    const text = (n: { payload: unknown }) => ((n.payload as { scalar: { text?: string } }).scalar.text ?? '');
    const names = () => {
      const cells = new Set(g.nodes.filter((n) => n.type === c.sig.id('Cell')).map((n) => n.id));
      return g.nodes.filter((n) => 'node' in n.parent && cells.has(n.parent.node) && JSON.stringify(n.member) === '{"attr":{"text":"name"}}').map(text).sort();
    };
    const clock = () => (g.nodes.find((n) => JSON.stringify(n.member) === '{"attr":{"text":"t"}}')!.payload as { scalar: { float: number } }).scalar.float;
    let fourCell: string[] | null = null;
    for (let i = 0; i < 60_000 && names().length < 28; i++) {
      const s = step(g, rules, c.sig, random, d);
      if (!s) break;
      g = s.state;
      if (!fourCell && names().length === 4) fourCell = names();
    }
    expect(fourCell).toEqual(['ABa', 'ABp', 'EMS', 'P2']);
    expect(names()).toEqual(
      ['ABalaa', 'ABalap', 'ABalpa', 'ABalpp', 'ABaraa', 'ABarap', 'ABarpa', 'ABarpp', 'ABplaa', 'ABplap', 'ABplpa', 'ABplpp', 'ABpraa', 'ABprap', 'ABprpa', 'ABprpp', 'MSaa', 'MSap', 'MSpa', 'MSpp', 'Ea', 'Ep', 'Caa', 'Cap', 'Cpa', 'Cpp', 'D', 'P4'].sort(),
    );
    // the measured lineage reaches 28 cells at about 60–80 minutes
    expect(clock()).toBeGreaterThan(50);
    expect(clock()).toBeLessThan(110);
  }, 120_000);
});
