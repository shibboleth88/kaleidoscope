import { describe, expect, it } from 'vitest';
import { type Carrier, type Rule, Discovery, World, react, readProgram, rng, spots, stats } from '../src/engine';

/**
 * F101: a rule folding across links (`sum[?hs ?hs.n]` over a realm's `holds`, `sum[?tr ?tr.n]` over a town's `trade`)
 * stales only what folds over the value that changed: a value read across a link is found again (a guard) or rated
 * again (a rate) at the nodes whose rest of that group holds a point on the link, and a value no rule reads across stays
 * on the fast path. Towns share a faith's link of many points, never walked for these folds. Discovery, with values
 * written in place and with links made, moved and broken, must be a full search at every step.
 */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

const program = `Program(
  module = (
    Rule = Type(<: Link)
    Creed = Type(<: Link)
    Trade = Type(<: Link)
    Realms = Type()
    Earth = Type()
    Faith[creed :: Creed * | zeal :: Int = 5] = Type()
    Realm[holds :: Rule * | treasury :: Int = 0] = Type()
    Town[ruler :: Rule * | creed :: Creed * | trade :: Trade * | n :: Int = 4 | tax :: Int = 2 | wealth :: Int = 0 | sick :: Int = 0] = Type()
    # values in place: some read across links, some not
    grow[rate = 0.3] = ?t = Town[n = ?n] where ?n < 9 => ?t = Town[n = ?n + 1]
    shrink[rate = 0.3] = ?t = Town[n = ?n] where ?n > 1 => ?t = Town[n = ?n - 1]
    earn[rate = 0.4] = ?t = Town[wealth = ?w] where ?w < 5 => ?t = Town[wealth = ?w + 1]
    lose[rate = 0.4] = ?t = Town[wealth = ?w] where ?w > 0 => ?t = Town[wealth = ?w - 1]
    raise[rate = 0.2] = ?t = Town[tax = ?x] where ?x < 4 => ?t = Town[tax = ?x + 1]
    ease[rate = 0.2] = ?t = Town[tax = ?x] where ?x > 0 => ?t = Town[tax = ?x - 1]
    fervor[rate = 0.3] = ?f = Faith[zeal = ?z] where ?z < 9 => ?f = Faith[zeal = ?z + 1]
    # folds: in a rate, over a realm's holds and a town's trade; in a guard, over a town's trade
    levy[rate = 0.01 * sum[?hs ?hs.tax * ?hs.n]] = ?k = Realm[holds = ?hs | treasury = ?m] where ?m < 6 => ?k = Realm[holds = ?hs | treasury = ?m + 1]
    spend[rate = 0.2 * ?m] = ?k = Realm[treasury = ?m] where ?m > 0 => ?k = Realm[treasury = ?m - 1]
    fade[rate = 1.0 / (1.0 + sum[?tr ?tr.n])] = ?t = Town[trade = ?tr | sick = 1] => ?t = Town[trade = ?tr | sick = 0]
    catch[rate = 0.1] = ?t = Town[sick = 0 | trade = ?tr] where sum[?tr ?tr.n] > 6 => ?t = Town[sick = 1 | trade = ?tr]
    # links made, moved and broken; towns founded and abandoned
    open[rate = 0.05] = (?a = Town[trade = ?ta] | ?b = Town[trade = ?tb]) where shared[?ta ?tb] == 0 and count[?ta] < 2 and count[?tb] < 2
      => (?a = Town[trade = (?ta | ~t)] | ?b = Town[trade = (?tb | ~t)])
    close[rate = 0.1] = (?a = Town[trade = (~t | ?ta)] | ?b = Town[trade = (~t | ?tb)]) => (?a = Town[trade = ?ta] | ?b = Town[trade = ?tb])
    defect[rate = 0.05] = (~r :: Rule | ?k = Realm[holds = (~r | ?ks)] | ?q = Realm[holds = ?qs]) || (?t = Town[ruler = ~r])
      => (~r :: Rule | ?k = Realm[holds = ?ks] | ?q = Realm[holds = (~r | ?qs)]) || (?t = Town[ruler = ~r])
    found[rate = 0.3] = (~r :: Rule | ?k = Realm[holds = (~r | ?ks)]) || (?e = Earth(?t = Town[ruler = ~r | creed = ~c | n = ?n] | ?es)) where ?n > 4
      => (~r :: Rule | ~s :: Rule | ?k = Realm[holds = (~r | ~s | ?ks)]) || (?e = Earth(?t = Town[ruler = ~r | creed = ~c | n = ?n - 2] | Town[ruler = ~s | creed = ~c | n = 2] | ?es))
    abandon[rate = 0.5] = (~r :: Rule | ?k = Realm[holds = (~r | ?ks)]) || (?e = Earth(?t = Town[ruler = ~r | creed = ~c | trade = ?tt | n = ?n] | ?es)) where ?n <= 2 and count[?tt] == 0
      => (?k = Realm[holds = ?ks]) || (?e = Earth(?es))
  )
  world = (~r1 :: Rule | ~r2 :: Rule | ~r3 :: Rule | ~r4 :: Rule | ~r5 :: Rule | ~r6 :: Rule | ~f :: Creed | ~t1 :: Trade | ~t2 :: Trade
    | Faith[creed = ~f]
    | Realms(Realm[holds = (~r1 | ~r2 | ~r3)] | Realm[holds = (~r4 | ~r5 | ~r6)])
    | Earth(Town[ruler = ~r1 | creed = ~f | trade = ~t1] | Town[ruler = ~r2 | creed = ~f | trade = (~t1 | ~t2) | sick = 1] | Town[ruler = ~r3 | creed = ~f]
      | Town[ruler = ~r4 | creed = ~f | trade = ~t2 | n = 7] | Town[ruler = ~r5 | creed = ~f] | Town[ruler = ~r6 | creed = ~f | n = 8]))
)`;

/** Steps at random, values written in place (a world) or every change made anew (`react`), checked at each step. */
function run(seed: number, steps: number, inPlace: boolean) {
  const p = readProgram(program);
  const world = new World(p.world, p.sig);
  let g: Carrier = p.world;
  const d = new Discovery(p.rules, p.sig);
  const random = rng(seed);
  d.live(inPlace ? world.g : g);
  const fired = new Map<string, number>();
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
    fired.set(chosen.rule.name, (fired.get(chosen.rule.name) ?? 0) + 1);
  }
  return { p, fired };
}

describe('folds across links stale what they fold (F101)', () => {
  it('discovery over values written in place and links changed is a full search, step after step', () => {
    for (const [seed, inPlace] of [[3, true], [12, true], [5, false]] as const) {
      const { p, fired } = run(seed, 300, inPlace);
      expect([...fired.keys()].sort(), `seed ${seed}`).toEqual(p.rules.map((r) => r.name).sort());
    }
  });

  it('a value no rule reads across links searches nothing; one a rate folds over rates its folder again', () => {
    const p = readProgram(program);
    const world = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    d.live(world.g);
    // (fired at a town trading with two others)
    const trading = (s: { occurrences: { nodes: [number, number][] }[] }) =>
      s.occurrences[0].nodes.some(([, n]) => world.ix.node.get(n)!.ports.find((g) => 'text' in g.key && g.key.text === 'trade')?.points.length === 2);
    const fire = (name: string) => {
      const spot = d.live(world.g).find((s) => s.rule.name === name && trading(s))!;
      const before0 = stats.calls;
      const { transition, before } = world.apply(spot.rule, spot.occurrences[0], p.sig, { inPlace: true });
      expect(transition.revalued?.length).toBe(1);
      d.advanceWorld(world, before, transition);
      const searched = stats.calls - before0;
      expect(view(d.live(world.g))).toEqual(view(spots(world.g, p.rules, p.sig)));
      return searched;
    };
    // wealth: read by earn's and lose's guards at the town only (deferred, F99), by no fold
    expect(fire('earn')).toBe(0);
    // a town's tax: read by levy's rate across the realm's holds: the realm is rated again, nothing searched
    expect(fire('raise')).toBe(0);
    // a town's people: read by catch's guard across trade, so catch is found again at its trade partners only
    const searched = fire('grow');
    expect(searched).toBeGreaterThan(0);
    expect(searched).toBeLessThanOrEqual(4);
  });
});
