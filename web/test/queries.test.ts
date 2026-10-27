import { describe, expect, it } from 'vitest';
import { type Carrier, type Rule, Discovery, World, discover, local, react, readProgram, rng, spots, stats } from '../src/engine';

/**
 * F105: a query over a place a redex node names (SYNTAX §7, "A pattern in code is a query"; FOLDS a4, `in ?s`):
 * `count[Settlement(sick = 1) in ?g]`, `sum[Settlement(n = ?x) in ?g -> ?x]`, a one-node pattern's occurrences within
 * the place, at any depth, counted or summed. An occurrence reading one is stale when what the place holds changes
 * (members made, removed, moved, or a value the query reads rewritten), at the cost of the place: a value rewritten in
 * place rates again, or finds again, only what met a place holding it by such a query.
 */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

const program = `Program(
  module = (
    Earth = Type()
    Region[climate :: Int = 100] = Type()
    Fort = Type()
    Settlement[n :: Int = 4 | sick :: Int = 0 | wealth :: Int = 0] = Type()
    # values in place: people (read by queries), sickness (read by a guard's count), wealth (read by none)
    grow[rate = 0.2] = ?s = Settlement[n = ?n] where ?n < 9 => ?s = Settlement[n = ?n + 1]
    shrink[rate = 0.2] = ?s = Settlement[n = ?n] where ?n > 1 => ?s = Settlement[n = ?n - 1]
    sicken[rate = 0.1] = ?s = Settlement[sick = 0] => ?s = Settlement[sick = 1]
    heal[rate = 0.2] = ?s = Settlement[sick = 1] => ?s = Settlement[sick = 0]
    earn[rate = 0.3] = ?s = Settlement[wealth = ?w] where ?w < 5 => ?s = Settlement[wealth = ?w + 1]
    lose[rate = 0.3] = ?s = Settlement[wealth = ?w] where ?w > 0 => ?s = Settlement[wealth = ?w - 1]
    # members made, removed and moved (one stands in a fort, within its region)
    found[rate = 0.05] = ?g = Region(?s = Settlement[n = ?n] | ?gs) where ?n > 5 => ?g = Region(?s = Settlement[n = ?n - 2] | Settlement[n = 2] | ?gs)
    abandon[rate = 0.1] = ?g = Region(?s = Settlement[n = ?n] | ?gs) where ?n < 3 => ?g = Region(?gs)
    migrate[rate = 0.05] = (?g = Region(?s = Settlement | ?gs)) || (?h = Region(?hs)) => (?g = Region(?gs)) || (?h = Region(?s = Settlement | ?hs))
    garrison[rate = 0.05] = ?g = Region(?f = Fort(?fs) | ?s = Settlement | ?gs) => ?g = Region(?f = Fort(?s = Settlement | ?fs) | ?gs)
    # queries: in a rate, a guard, and a reactum; one joined to the occurrence's value
    die_out[rate = 1.0 / (1.0 + sum[Settlement(n = ?x) in ?g -> ?x] / 10.0)] = ?g = Region(?s = Settlement[sick = 1] | ?gs) => ?g = Region(?s = Settlement[sick = 0] | ?gs)
    spread[rate = 0.3] = ?g = Region(?s = Settlement[sick = 0] | ?gs) where count[Settlement(sick = 1) in ?g] > 1 => ?g = Region(?s = Settlement[sick = 1] | ?gs)
    weather[rate = 0.1] = ?g = Region[climate = ?c](?gs) where ?c > 50 => ?g = Region[climate = 100 - count[Settlement() in ?g] * 10](?gs)
    peers[rate = 0.05 * count[Settlement(n = ?n) in ?g]] = ?g = Region(?s = Settlement[n = ?n] | ?gs) => ?g = Region(?s = Settlement[n = ?n] | ?gs)
  )
  world = (Earth(Region(Settlement | Settlement[n = 7 | sick = 1] | Settlement[n = 2] | Fort(Settlement[sick = 1]))
    | Region(Settlement[n = 6] | Settlement[sick = 1] | Fort)
    | Region(Settlement[n = 1])))
)`;

function run(seed: number, steps: number, inPlace: boolean) {
  const p = readProgram(program);
  const world = new World(p.world, p.sig);
  let g: Carrier = p.world;
  const d = new Discovery(p.rules, p.sig);
  const random = rng(seed);
  d.live(inPlace ? world.g : g);
  const fired = new Set<string>();
  for (let i = 0; i < steps; i++) {
    const now = inPlace ? world.g : g;
    const live = spots(now, p.rules, p.sig);
    expect(view(d.live(now)), `discovery at step ${i}`).toEqual(view(live));
    const total = live.reduce((x, s) => x + s.rate, 0);
    let u = random() * total;
    let chosen = live[live.length - 1];
    for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
    const occ = chosen.occurrences[Math.floor(random() * chosen.occurrences.length)];
    if (inPlace) {
      const { transition, before } = world.apply(chosen.rule, occ, p.sig, { inPlace: true });
      d.advanceWorld(world, before, transition);
    } else {
      const r = react(g, chosen.rule, occ, p.sig);
      d.advance(g, r.state, r.transition);
      g = r.state;
    }
    fired.add(chosen.rule.name);
  }
  return { p, fired };
}

describe('queries over a place (F105)', () => {
  it('count and sum what a place holds, at any depth', () => {
    const p = readProgram(program);
    const rate = (name: string) => spots(p.world, p.rules, p.sig).filter((s) => s.rule.name === name).map((s) => s.rate).sort();
    // the first region holds people 4 + 7 + 2 + 4 (one in its fort): 17; the second 6 + 4
    expect(rate('die_out')).toEqual([1 / (1 + 10 / 10), 1 / (1 + 17 / 10)].sort());
    // two sick in the first region (one in the fort): spread there, to its two healthy settlements at large
    expect(rate('spread').length).toBe(2);
    // a reactum's value: the climate, ten less a settlement
    const w = discover(p.world, p.rules.find((r) => r.name === 'weather')!, p.sig);
    const after = react(p.world, p.rules.find((r) => r.name === 'weather')!, w[0], p.sig).state;
    expect(after.nodes.filter((n) => typeof n.payload === 'object' && 'int' in n.payload.scalar && n.payload.scalar.int === 60).length).toBe(1);
    // a join: the settlements of the region as many as this one
    // (in the first region two hold 4, one at large and one in the fort)
    expect(spots(p.world, p.rules, p.sig).filter((s) => s.rule.name === 'peers').map((s) => s.rate).sort()).toEqual([0.05, 0.05, 0.05, 0.05, 0.05, 0.1]);
  });

  it('discovery is a full search, step after step, values in place and made anew', () => {
    for (const [seed, inPlace] of [[1, true], [2, true], [3, false]] as const) {
      const { p, fired } = run(seed, 400, inPlace);
      expect(p.rules.map((r) => r.name).filter((n) => !fired.has(n)), `seed ${seed}`).toEqual([]);
    }
  });

  it('a value rewritten in place costs what reads it', () => {
    const p = readProgram(program);
    const world = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    d.live(world.g);
    const fire = (name: string) => {
      const spot = d.live(world.g).find((s) => s.rule.name === name)!;
      const c0 = stats.calls;
      const { transition, before } = world.apply(spot.rule, spot.occurrences[0], p.sig, { inPlace: true });
      expect(transition.revalued?.length).toBe(1);
      d.advanceWorld(world, before, transition);
      const searched = stats.calls - c0;
      expect(view(d.live(world.g))).toEqual(view(spots(world.g, p.rules, p.sig)));
      return searched;
    };
    // (migrate meets two regions no link joins: searched whole at every step, whatever changed)
    const whole = p.rules.filter((r) => !local(r)).length;
    expect(whole).toBe(1);
    // wealth: no query reads it
    expect(fire('earn')).toBe(whole);
    // sickness: spread's guard counts it in the region, found again there (and at the settlement, F88)
    expect(fire('sicken') - whole).toBeLessThanOrEqual(6);
  });

  it('is refused where its pattern or place is not one', () => {
    const rule = (q: string) => `Program(module = (
      Region = Type()
      Settlement[n :: Int = 1] = Type()
      r[rate = ${q}] = ?g = Region(?gs) => ?g = Region(?gs)) world = (Region))`;
    expect(() => readProgram(rule('count[Settlment() in ?g]'))).toThrow(/no type Settlment/);
    expect(() => readProgram(rule('sum[Settlement(m = ?x) in ?g -> ?x]'))).toThrow(/Settlement has no attribute m/);
    expect(() => readProgram(rule('count[Settlement() in ?h]'))).toThrow(/\?p is a node the redex names/);
    expect(() => readProgram(rule('sum[Settlement(n = ?x) in ?g]'))).toThrow(/follows ->/);
    expect(readProgram(rule('sum[Settlement(n = ?x) in ?g -> ?x * 2]')).ruleAttrs.get('r')).toEqual({});
  });
});
