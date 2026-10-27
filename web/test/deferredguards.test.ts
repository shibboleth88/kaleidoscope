import { describe, expect, it } from 'vitest';
import { type Rule, Discovery, World, readProgram, rng, spots } from '../src/engine';
import { guardParts } from '../src/engine/match';

/**
 * F99: a guard's conjuncts that read one redex node's keyed attributes are the rate's. A realm's treasury, rewritten
 * in place at every tax, is read by per-town rules' guards (`?m == 0`, `?m >= 2`) beside conjuncts on the town;
 * their occurrences are kept dormant where the whole guard fails and put in or taken out of their spots as the
 * treasury moves, never searched again for it. Discovery, with values written in place, must be a full search at
 * every step; and a count of what a place holds (`count[?ks Column]`) makes no value at that place one a search waits
 * on.
 */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

const program = `Program(
  module = (
    Rule = Type(<: Link)
    Realms = Type()
    Earth = Type()
    Realm[holds :: Rule * | treasury :: Int = 3 | army :: Int = 5] = Type()
    Town[ruler :: Rule * | n :: Int = 10 | tax :: Int = 30] = Type()
    Column = Type()
    # the treasury moves at every tax and every outlay: rewritten in place
    tax[rate = 0.2] = (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m](?ks)) || (?t = Town[ruler = (~r | ?rs)])
      => (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m + 1](?ks)) || (?t = Town[ruler = (~r | ?rs)])
    spend[rate = 0.3 * ?m] = ?k = Realm[treasury = ?m](?ks) where ?m > 0 => ?k = Realm[treasury = ?m - 1](?ks)
    # per town, guards on the realm's treasury (deferred) and on the town (matched)
    starve[rate = 0.05] = (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m](?ks)) || (?t = Town[ruler = (~r | ?rs) | n = ?n])
        where ?m == 0 and ?n > 5
      => (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m](?ks)) || (?t = Town[ruler = (~r | ?rs) | n = ?n - 1])
    relieve[rate = 0.1] = (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m](?ks)) || (?t = Town[ruler = (~r | ?rs) | n = ?n])
        where ?m >= 2 and ?n < 14
      => (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m - 1](?ks)) || (?t = Town[ruler = (~r | ?rs) | n = ?n + 1])
    surtax[rate = 0.1] = (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m](?ks)) || (?t = Town[ruler = (~r | ?rs) | tax = ?x])
        where ?m < 2 and ?x < 60
      => (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | treasury = ?m](?ks)) || (?t = Town[ruler = (~r | ?rs) | tax = ?x + 10])
    # a guard counting what the realm holds, beside one on its army: the army is rewritten in place
    muster[rate = 0.2 * ?m] = ?k = Realm[treasury = ?m | army = ?a](?ks) where ?m > 0 => ?k = Realm[treasury = ?m - 1 | army = ?a + 1](?ks)
    march[rate = 0.1] = ?k = Realm[army = ?a](?ks) where ?a > 6 and count[?ks Column] == 0 => ?k = Realm[army = ?a - 2](?ks | Column)
    home[rate = 0.5] = ?k = Realm(?c = Column | ?ks) => ?k = Realm(?ks)
  )
  world = (~r1 :: Rule | ~r2 :: Rule | ~r3 :: Rule | ~r4 :: Rule | ~r5 :: Rule
    | Realms(Realm[holds = (~r1 | ~r2 | ~r3)] | Realm[holds = (~r4 | ~r5) | treasury = 0])
    | Earth(Town[ruler = ~r1] | Town[ruler = ~r2 | n = 4] | Town[ruler = ~r3 | n = 14] | Town[ruler = ~r4] | Town[ruler = ~r5 | tax = 55]))
)`;

describe('guards deferred to the rate (F99)', () => {
  it('discovery over values written in place is a full search, step after step', () => {
    const p = readProgram(program);
    const world = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    // the guards on the treasury and the army are deferred; what joins nothing else is matched
    const rule = (n: string) => p.rules.find((r) => r.name === n)!;
    for (const n of ['starve', 'relieve', 'surtax', 'spend', 'muster', 'march']) expect([n, guardParts.has(rule(n))]).toEqual([n, true]);
    expect(guardParts.get(rule('march'))!.match).toBeDefined();
    const random = rng(7);
    d.live(world.g);
    let steps = 0, revalued = 0;
    const fired = new Set<string>();
    for (; steps < 400; steps++) {
      const live = spots(world.g, p.rules, p.sig);
      expect(view(d.live(world.g)), `discovery at step ${steps}`).toEqual(view(live));
      if (!live.length) break;
      const total = live.reduce((x, s) => x + s.rate, 0);
      let u = random() * total;
      let chosen = live[live.length - 1];
      for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
      const occ = chosen.occurrences[Math.floor(random() * chosen.occurrences.length)];
      const { transition, before } = world.apply(chosen.rule, occ, p.sig, { inPlace: true });
      revalued += transition.revalued?.length ?? 0;
      fired.add(chosen.rule.name);
      d.advanceWorld(world, before, transition);
    }
    expect(steps).toBe(400);
    expect(revalued).toBeGreaterThan(100);
    // every rule fired, so every guard was crossed both ways
    expect([...fired].sort()).toEqual(p.rules.map((r) => r.name).sort());
  });
});
