import { type Carrier, type Rule, discover, discoverReference, rng, step } from '../src/engine';
import { compile, embryo, growth, lacOperon, mapk, yinYang } from '../src/library';

/** Occurrences as comparable text: rule, node map, edge map, what each site holds. */
const canon = (os: { rule: string; nodes: [number, number][]; edges: [number, number][]; sites: number[][] }[]) =>
  os
    .map((o) => `${o.rule}|${[...o.nodes].sort((a, b) => a[0] - b[0]).join(';')}|${[...o.edges].sort((a, b) => a[0] - b[0]).join(';')}|${o.sites.map((x) => [...x].sort((a, b) => a - b).join('.')).join('/')}`)
    .sort();

describe('the compiled matcher', () => {
  for (const [name, lib] of [['MAPK', mapk()], ['Growth', growth()], ['lac operon', lacOperon()], ['yin yang', yinYang()], ['embryo', embryo()]] as const)
    it(`finds exactly what the reference matcher finds: ${name}`, () => {
      const c = compile(lib);
      const rules = lib.rules.map((r) => c.rules.get(r.id) as Rule);
      let g = c.states.get(lib.states[0].id) as Carrier;
      const random = rng(4);
      for (let i = 0; i < 120; i++) {
        if (i % 6 === 0) for (const r of rules) expect([r.name, canon(discover(g, r, c.sig))]).toEqual([r.name, canon(discoverReference(g, r, c.sig))]);
        const s = step(g, rules, c.sig, random);
        if (!s) break;
        g = s.state;
      }
    });
});
