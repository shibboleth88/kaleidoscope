import { type Carrier, Discovery, type Rule, readState, rng, spots, step } from '../src/engine';
import { compile, embryo, growth, lacOperon, mapk, yinYang } from '../src/library';

/** The live spots, as comparable text: rule, spot, rate. */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

describe('incremental discovery', () => {
  const systems: [string, ReturnType<typeof mapk>, string?][] = [
    ['MAPK', mapk()],
    ['Growth', growth()],
    ['lac operon', lacOperon()],
    ['yin yang', yinYang()],
    ['embryo', embryo()],
    ['MAPK, crowded', mapk(), `Cell(Cytoplasm(${Array(8).fill('MEK').join(' | ')} | ${Array(8).fill('ERK[name = "e"]').join(' | ')} | Nucleus(pERK[name = "p"]) | ERLumen()))`],
  ];
  for (const [name, lib, state] of systems)
    it(`finds what a full search finds, step after step: ${name}`, () => {
      const c = compile(lib);
      const rules = lib.rules.map((r) => c.rules.get(r.id) as Rule);
      let g = (state ? readState(state, c.sig) : c.states.get(lib.states[0].id)) as Carrier;
      const d = new Discovery(rules, c.sig);
      const random = rng(9);
      for (let i = 0; i < 150; i++) {
        const live = d.live(g);
        expect(view(live)).toEqual(view(spots(g, rules, c.sig)));
        // and an occurrence kept with stale site contents, refreshed, holds what a full search says
        for (const sp of live) {
          const o = d.fresh(g, sp.rule, sp.occurrences[0]);
          const canon = (xs: [number, number][]) => JSON.stringify([...xs].sort((a, b) => a[0] - b[0]));
          const full = spots(g, [sp.rule], c.sig).flatMap((x) => x.occurrences).find((x) => canon(x.nodes) === canon(o.nodes));
          expect(full && JSON.stringify(o.sites.map((x) => [...x].sort())) === JSON.stringify(full.sites.map((x) => [...x].sort()))).toBe(true);
        }
        const s = step(g, rules, c.sig, random, d);
        if (!s) break;
        g = s.state;
      }
    });
});
