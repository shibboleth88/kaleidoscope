import { type Carrier, Discovery, type Rule, readProgram, rng, spots, step } from '../src/engine';
import { local } from '../src/engine/incremental';

/**
 * F98: a redex whose regions are joined only by an open name (a link of many points, most outside the match: a faith
 * held by many communities) is local, as one joined by a closed edge is. Incremental discovery must find what a full
 * search finds at every step, as the faith rules of cycle's library v2 change which link each community is on.
 */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

const program = `Program(
  module = (
    Creed = Type(<: Link)
    Rule = Type(<: Link)
    Earth = Type()
    Realms = Type()
    Faiths = Type()
    Region = Type()
    Realm[holds :: Rule * | creed :: Creed * | legit :: Int = 50] = Type()
    Settlement[ruler :: Rule * | creed :: Creed * | n :: Int = 10 | loyalty :: Int = 30] = Type()
    Faith[creed :: Creed * | zeal :: Int = 50] = Type()
    # a community takes a neighbour's faith (two faith nodes: two links)
    conform[rate = 0.3 * ?m / (?n + ?m) * ?z / 50.0] =
      (?g = Region(?s = Settlement[creed = ~a | n = ?n] | ?t = Settlement[creed = ~b | n = ?m] | ?ss))
        || (?f = Faith[creed = (~a | ?fa)](?fx)) || (?h = Faith[creed = (~b | ?hb) | zeal = ?z](?hx))
      => (?g = Region(?s = Settlement[creed = ~b | n = ?n] | ?t = Settlement[creed = ~b | n = ?m] | ?ss))
        || (?f = Faith[creed = (~a | ?fa)](?fx)) || (?h = Faith[creed = (~b | ?hb) | zeal = ?z](?hx))
    # and its ruler's (a closed edge and two open names joining four regions)
    official[rate = 0.2] =
      (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | creed = ~b]) || (?s = Settlement[ruler = (~r | ?rs) | creed = ~a])
        || (?f = Faith[creed = (~a | ?fa)](?fx)) || (?h = Faith[creed = (~b | ?hb)](?hx))
      => (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | creed = ~b]) || (?s = Settlement[ruler = (~r | ?rs) | creed = ~b])
        || (?f = Faith[creed = (~a | ?fa)](?fx)) || (?h = Faith[creed = (~b | ?hb)](?hx))
    # shared faith lends legitimacy (one name met in three regions); a rate read across the faith's zeal
    consent[rate = 0.01 * (100 - ?g) * ?z / 50.0] =
      (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | creed = ~a | legit = ?g]) || (?s = Settlement[ruler = (~r | ?rs) | creed = ~a])
        || (?f = Faith[creed = (~a | ?fa) | zeal = ?z](?fx)) where ?g < 100
      => (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | creed = ~a | legit = ?g + 1]) || (?s = Settlement[ruler = (~r | ?rs) | creed = ~a])
        || (?f = Faith[creed = (~a | ?fa) | zeal = ?z](?fx))
    # a sect founded: a new link and a faith nested in the old; and zeal cooling, which the conform rate reads
    schism[rate = 0.05] =
      (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | creed = ~a]) || (?s = Settlement[ruler = (~r | ?rs) | creed = ~a | loyalty = ?y])
        || (?f = Faith[creed = (~a | ?fa)](?fx)) where ?y < 30
      => (~r :: Rule | ?k = Realm[holds = (~r | ?hs) | creed = ~a]) || (?s = Settlement[ruler = (~r | ?rs) | creed = ~c | loyalty = 30])
        || (?f = Faith[creed = (~a | ?fa)](?fx | Faith[creed = ~c | zeal = 90]))
    cool[rate = 0.2] = ?f = Faith[zeal = ?z](?fx) where ?z > 20 => ?f = Faith[zeal = ?z - 5](?fx)
    lapse[rate = 1.0] = ?p = Faiths(?f = Faith[creed = ?fs](?fx) | ?ps) where sum[?fs 1.0] == 0 => ?p = Faiths(?fx | ?ps)
  )
  world = (~a :: Creed | ~b :: Creed | ~r1 :: Rule | ~r2 :: Rule | ~r3 :: Rule | ~r4 :: Rule
    | Earth(Region(Settlement[ruler = ~r1 | creed = ~a | n = 12 | loyalty = 10] | Settlement[ruler = ~r2 | creed = ~b | n = 8])
      | Region(Settlement[ruler = ~r3 | creed = ~a] | Settlement[ruler = ~r4 | creed = ~b | n = 20 | loyalty = 5] | Settlement[creed = ~a | n = 5]))
    | Realms(Realm[holds = (~r1 | ~r2 | ~r3) | creed = ~a] | Realm[holds = ~r4 | creed = ~b])
    | Faiths(Faith[creed = ~a | zeal = 70] | Faith[creed = ~b]))
)`;

describe('regions joined by an open name (F98)', () => {
  it('are local: incremental discovery finds what a full search finds, step after step', () => {
    const p = readProgram(program);
    const joined = p.rules.filter((r) => r.redex.outer.places.length > 1);
    expect(joined.map((r) => r.name).sort()).toEqual(['conform', 'consent', 'official', 'schism']);
    // each is held local (found again by anchored search), not searched over the whole state after every step
    for (const r of joined) expect([r.name, local(r)]).toEqual([r.name, true]);
    let g = p.world as Carrier;
    const d = new Discovery(p.rules, p.sig);
    const random = rng(4);
    let fired = 0;
    for (let i = 0; i < 300; i++) {
      expect(view(d.live(g))).toEqual(view(spots(g, p.rules, p.sig)));
      const s = step(g, p.rules, p.sig, random, d);
      if (!s) break;
      g = s.state;
      fired++;
    }
    expect(fired).toBeGreaterThan(20);
  });
});
