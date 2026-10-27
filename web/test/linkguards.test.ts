import { describe, expect, it } from 'vitest';
import { type Carrier, type Rule, Discovery, World, react, readProgram, rng, spots, stats } from '../src/engine';
import { guardParts } from '../src/engine/match';

/**
 * F102: a link's value read by a guard's conjunct of its own (`where ?v > 0`, `?v` a field of one redex link's value),
 * or by what a reactum computes or writes, is the rate's, as F99 has a node's attribute; and a value pattern of
 * variables alone (`~t :: Trade = Flow[volume = ?v]`) binds without constraining, but for the value's type. A volume
 * rewritten in place then rates its readers again and searches nothing; a literal field (`Flow[volume = 0]`) is still
 * matched, and a value whose type changed (`Flow` to `Jam`) is found again by the patterns testing its type.
 */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

const program = `Program(
  module = (
    Border = Type(<: Link)
    Trade = Type(<: Link)
    Crossing[cost :: Int = 1] = Type()
    Flow[volume :: Int = 0] = Type()
    Jam[volume :: Int = 0] = Type()
    Region[border :: Border * | n :: Int = 0] = Type()
    Town[trade :: Trade * | n :: Int = 4 | wealth :: Int = 0] = Type()
    # relax_far's shape: regions joined by a border, a link's value in the guard and the rate, the write computed from it
    relax[rate = abs[?n * ?m / (8.0 * (1.0 + ?c)) - ?v] / 2.0] =
      (~t :: Trade = Flow[volume = ?v] | ~e :: Border = Crossing[cost = ?c] | ?g = Region[border = (~e | ?gb)](?a = Town[trade = (~t | ?ta) | n = ?n] | ?ss))
        || (?k = Region[border = (~e | ?kb)](?b = Town[trade = (~t | ?tb) | n = ?m] | ?ks))
        where ?v > 0
      => (~t :: Trade = Flow[volume = if[?n * ?m > 8.0 * (1.0 + ?c) * ?v ?v + 1 ?v - 1]] | ~e :: Border = Crossing[cost = ?c] | ?g = Region[border = (~e | ?gb)](?a = Town[trade = (~t | ?ta) | n = ?n] | ?ss))
        || (?k = Region[border = (~e | ?kb)](?b = Town[trade = (~t | ?tb) | n = ?m] | ?ks))
    # carry's shape: no guard, a write reading the value
    carry[rate = 0.05] = (~t = Flow[volume = ?v] | ?a = Town[trade = (~t | ?ta) | wealth = ?w]) where ?w < 4
      => (~t = Flow[volume = ?v + 1] | ?a = Town[trade = (~t | ?ta) | wealth = ?w + 1])
    earn[rate = 0.1 * ~t.volume] = ?a = Town[trade = (~t | ?ta) | wealth = ?w] where ~t.volume > 2 and ?w < 6
      => ?a = Town[trade = (~t | ?ta) | wealth = ?w + 1]
    spend[rate = 0.1 * ?w] = ?a = Town[wealth = ?w] where ?w > 0 => ?a = Town[wealth = ?w - 1]
    grow[rate = 0.1] = ?a = Town[n = ?n] where ?n < 8 => ?a = Town[n = ?n + 1]
    shrink[rate = 0.1] = ?a = Town[n = ?n] where ?n > 1 => ?a = Town[n = ?n - 1]
    # a literal field: matched
    close[rate = 1.0] = (~t :: Trade = Flow[volume = 0] | ?a = Town[trade = (~t | ?ta)]) || (?b = Town[trade = (~t | ?tb)])
      => (?a = Town[trade = ?ta]) || (?b = Town[trade = ?tb])
    reopen[rate = 0.05] = (?a = Town[trade = ?ta] | ?b = Town[trade = ?tb]) where count[?ta] == 0 and count[?tb] == 0
      => (~t :: Trade = Flow[volume = 2] | ?a = Town[trade = (?ta | ~t)] | ?b = Town[trade = (?tb | ~t)])
    # a value's type rewritten: Flow to Jam and back
    jam[rate = 0.1] = (~t = Flow[volume = ?v] | ?a = Town[trade = (~t | ?ta)]) where ?v > 1
      => (~t = Jam[volume = ?v] | ?a = Town[trade = (~t | ?ta)])
    clear[rate = 0.3] = (~t = Jam[volume = ?v] | ?a = Town[trade = (~t | ?ta)])
      => (~t = Flow[volume = ?v - 1] | ?a = Town[trade = (~t | ?ta)])
  )
  world = (~e :: Border = Crossing[cost = 2] | ~t1 :: Trade = Flow[volume = 2] | ~t2 :: Trade = Flow[volume = 3] | ~t3 :: Trade = Flow[volume = 1]
    | Region[border = ~e](Town[trade = (~t1 | ~t2)] | Town[trade = ~t3 | n = 6])
    | Region[border = ~e](Town[trade = (~t1 | ~t3)] | Town[trade = ~t2 | n = 2]))
)`;

function run(seed: number, steps: number, inPlace: boolean) {
  const p = readProgram(program);
  const world = new World(p.world, p.sig);
  let g: Carrier = p.world;
  const d = new Discovery(p.rules, p.sig);
  const random = rng(seed);
  d.live(inPlace ? world.g : g);
  const fired = new Set<string>();
  let retyped = 0;
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
      retyped += transition.edgesRetyped?.length ?? 0;
      d.advanceWorld(world, before, transition);
    } else {
      const r = react(g, chosen.rule, occ, p.sig);
      retyped += r.transition.edgesRetyped?.length ?? 0;
      d.advance(g, r.state, r.transition);
      g = r.state;
    }
    fired.add(chosen.rule.name);
  }
  return { p, fired, retyped };
}

describe("a link's value in a guard is the rate's (F102)", () => {
  it('is deferred where a conjunct reads one link alone, or a write reads it', () => {
    const p = readProgram(program);
    new Discovery(p.rules, p.sig);
    const rule = (n: string) => p.rules.find((r) => r.name === n)!;
    for (const n of ['relax', 'carry', 'earn', 'jam']) expect([n, guardParts.has(rule(n))]).toEqual([n, true]);
    // relax's whole guard is the rate's; earn's town conjunct too (one node), carry's
    expect(guardParts.get(rule('relax'))!.match).toBeUndefined();
    expect(guardParts.get(rule('earn'))!.match).toBeUndefined();
  });

  it('discovery is a full search, step after step, values in place and made anew', () => {
    for (const [seed, inPlace] of [[1, true], [2, true], [3, false]] as const) {
      const { p, fired, retyped } = run(seed, 400, inPlace);
      expect([...fired].sort(), `seed ${seed}`).toEqual(p.rules.map((r) => r.name).sort());
      expect(retyped).toBeGreaterThan(5);
    }
  });

  it('a volume rewritten in place searches only the rule meeting its literal', () => {
    const p = readProgram(program);
    const world = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    d.live(world.g);
    const before0 = stats.calls;
    const spot = d.live(world.g).find((s) => s.rule.name === 'relax')!;
    const { transition, before } = world.apply(spot.rule, spot.occurrences[0], p.sig, { inPlace: true });
    expect(transition.edgesRevalued?.length).toBe(1);
    d.advanceWorld(world, before, transition);
    // close (a literal volume) at the two towns on the link; nothing else
    expect(stats.calls - before0).toBeLessThanOrEqual(4);
    expect(view(d.live(world.g))).toEqual(view(spots(world.g, p.rules, p.sig)));
  });
});
