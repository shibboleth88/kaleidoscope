import { describe, expect, it } from 'vitest';
import { type Carrier, type Rule, Discovery, World, react, readProgram, rng, spots, stats } from '../src/engine';

/**
 * F103: a node joining or leaving links changes what meets the other nodes on those links only where they can tell: a
 * pattern's closed edge, meeting a link of exactly its points; a negative's node at a root, tied by a link, which the
 * node that moved could now be; a fold over the link's points. Not through every link of the node (a realm declaring
 * a war does not change its faith's link of many points, nor every town it holds), and not on a link of many points
 * where none of those can tell. Discovery must be a full search at every step.
 */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

const program = `Program(
  module = (
    Rule = Type(<: Link)
    Creed = Type(<: Link)
    War = Type(<: Link)
    Realms = Type()
    Faiths = Type()
    Earth = Type()
    Faith[creed :: Creed * | zeal :: Int = 0 | small :: Int = 0] = Type()
    Realm[holds :: Rule * | foes :: War * | creed :: Creed * | army :: Int = 3] = Type()
    Town[ruler :: Rule * | creed :: Creed * | n :: Int = 4 | sick :: Int = 0] = Type()
    # a town changes faith: a link of many points left, another joined
    convert[rate = 0.3] = (?f = Faith[creed = (~a | ?fa)] | ?h = Faith[creed = (~b | ?hb)]) || (?e = Earth(?t = Town[creed = ~a] | ?es))
      => (?f = Faith[creed = (~a | ?fa)] | ?h = Faith[creed = (~b | ?hb)]) || (?e = Earth(?t = Town[creed = ~b] | ?es))
    # wars made and ended: a realm's foes relinked, its holds and faith not
    declare[rate = 0.2] = (?k = Realm[foes = ?kf] | ?q = Realm[foes = ?qf]) where count[?kf] == 0 and count[?qf] == 0
      => (?k = Realm[foes = (?kf | ~w)] | ?q = Realm[foes = (?qf | ~w)])
    peace[rate = 0.3] = (~w :: War | ?k = Realm[foes = (~w | ?kf)] | ?q = Realm[foes = (~w | ?qf)]) => (?k = Realm[foes = ?kf] | ?q = Realm[foes = ?qf])
    # a town changes ruler
    defect[rate = 0.1] = (~r :: Rule | ?k = Realm[holds = (~r | ?ks)] | ?q = Realm[holds = ?qs]) || (?t = Town[ruler = ~r])
      => (~r :: Rule | ?k = Realm[holds = ?ks] | ?q = Realm[holds = (~r | ?qs)]) || (?t = Town[ruler = ~r])
    # values
    sicken[rate = 0.1] = ?t = Town[sick = 0] => ?t = Town[sick = 1]
    heal[rate = 0.3] = ?t = Town[sick = 1] => ?t = Town[sick = 0]
    grow[rate = 0.1] = ?t = Town[n = ?n] where ?n < 8 => ?t = Town[n = ?n + 1]
    # a closed edge of three points: a faith of exactly two towns
    small[rate = 0.5] = (~f :: Creed | ?x = Faith[creed = ~f | small = ?s]) || (?e = Earth(?a = Town[creed = ~f] | ?b = Town[creed = ~f] | ?es)) where ?s < 50
      => (~f :: Creed | ?x = Faith[creed = ~f | small = ?s + 1]) || (?e = Earth(?a = Town[creed = ~f] | ?b = Town[creed = ~f] | ?es))
    # a negative's node at a root, tied by a link: no sick town of my faith beside me
    calm[rate = 0.2] = ?t = Town[creed = ~f | n = ?n] where ?n > 1
      => ?t = Town[creed = ~f | n = ?n - 1]
      unless (?t = Town | Town[creed = ~f | sick = 1])
    # a fold over the faith's link: its members
    fervor[rate = 0.02 * sum[?fs 1.0]] = ?x = Faith[creed = ?fs | zeal = ?z] where ?z < 50 => ?x = Faith[creed = ?fs | zeal = ?z + 1]
    # and over a realm's holds, reading its towns' people
    muster[rate = 0.01 * sum[?ks ?ks.n]] = ?k = Realm[holds = ?ks | army = ?a] where ?a < 50 => ?k = Realm[holds = ?ks | army = ?a + 1]
  )
  world = (~r1 :: Rule | ~r2 :: Rule | ~r3 :: Rule | ~r4 :: Rule | ~r5 :: Rule | ~r6 :: Rule | ~r7 :: Rule | ~fa :: Creed | ~fb :: Creed | ~fc :: Creed
    | Realms(Realm[holds = (~r1 | ~r2 | ~r3 | ~r4) | creed = ~fa] | Realm[holds = (~r5 | ~r6 | ~r7) | creed = ~fb])
    | Faiths(Faith[creed = ~fa] | Faith[creed = ~fb] | Faith[creed = ~fc])
    | Earth(Town[ruler = ~r1 | creed = ~fa] | Town[ruler = ~r2 | creed = ~fa] | Town[ruler = ~r3 | creed = ~fa | sick = 1] | Town[ruler = ~r4 | creed = ~fb]
      | Town[ruler = ~r5 | creed = ~fb] | Town[ruler = ~r6 | creed = ~fc] | Town[ruler = ~r7 | creed = ~fc]))
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

describe('a node relinked changes what meets on the links it joined or left (F103)', () => {
  it('discovery is a full search, step after step', () => {
    for (const [seed, inPlace] of [[1, true], [2, true], [3, false], [4, false]] as const) {
      const { p, fired } = run(seed, 300, inPlace);
      expect([...fired].sort(), `seed ${seed}`).toEqual(p.rules.map((r) => r.name).sort());
    }
  });

  it('a war declared searches what meets the two realms, not their towns nor their faiths', () => {
    const p = readProgram(program);
    const world = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    d.live(world.g);
    const spot = d.live(world.g).find((s) => s.rule.name === 'declare')!;
    const c0 = stats.calls;
    const { transition, before } = world.apply(spot.rule, spot.occurrences[0], p.sig, { inPlace: true });
    d.advanceWorld(world, before, transition);
    const searched = stats.calls - c0;
    expect(view(d.live(world.g))).toEqual(view(spots(world.g, p.rules, p.sig)));
    // the two realms (and Realms, holding them), each by the rules that could meet a realm
    expect(searched).toBeLessThanOrEqual(30);
  });
});
