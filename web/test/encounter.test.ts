/**
 * Encounter rules held factored (F57): a rule whose redex is motifs sharing nothing is held as its components, its
 * propensity the product of their sums. Against the full search: the same total at every step of a run, occurrences
 * sampled in proportion to their rates, and the same process in distribution.
 */
import { describe, expect, it } from 'vitest';
import { type Carrier, Discovery, type LiveSpot, type Occurrence, type Rule, World, encounter, parentKey, readProgram, rng, spotKey, spots } from '../src/engine';

const TEXT = `
Program(
  module = (
    Count = Type[kind = "int"](<: Int)
    Pool[x :: Count = 0 | y :: Count = 0] = Type()
    A[P :: Int = 0 | w :: Int = 1] = Type()
    B[P :: Int = 0] = Type()
    C = Type()
    Box = Type()
    load[rate = 0.02 * ?x] = (?p = Pool[x = ?x | y = ?y] | ?a = A[P = 0]) => (?p = Pool[x = ?x - 1 | y = ?y + 1] | ?a = A[P = 1])
    unload[rate = 0.01 * ?y] = (?p = Pool[x = ?x | y = ?y] | ?a = A[P = 1]) => (?p = Pool[x = ?x + 1 | y = ?y - 1] | ?a = A[P = 0])
    pass[rate = 0.3 * ?w] = (?a = A[P = 1 | w = ?w] | ?b = B[P = 0]) => (?a = A[P = 0 | w = ?w] | ?b = B[P = 1])
    back[rate = 0.1 / ?w] = (?a = A[P = 0 | w = ?w] | ?b = B[P = 1]) => (?a = A[P = 1 | w = ?w] | ?b = B[P = 0])
    spend[rate = 0.05] = (?b = B[P = 1] | C) => (?b = B[P = 0])
    three[rate = 0.0005 * ?x] = (?p = Pool[x = ?x] | ?a = A[P = 0] | ?b = B[P = 0]) => (?p = Pool[x = ?x] | ?a = A[P = 1] | ?b = B[P = 1])
    pairC[rate = 0.02] = (C | C) => (C)
    make[rate = 0.4] = ?p = Pool[x = ?x] => (?p = Pool[x = ?x] | C)
  )
  world = (
    Pool[x = 60 | y = 5]
    A[w = 1] | A[w = 2] | A[w = 3] | A[w = 1 | P = 1] | A[w = 2 | P = 1] | A[w = 3] | A[w = 1] | A[w = 2 | P = 1]
    B | B | B | B[P = 1] | B | B[P = 1]
    C | C | C
    Box(A[w = 2] | A[w = 1 | P = 1] | B | B[P = 1] | C)
  )
)`;
const program = readProgram(TEXT);
const { sig, rules } = program;
const all = () => true;

/** The full search's total rate for each rule in each place. */
function enumerated(g: Carrier): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of spots(g, rules, sig)) {
    const k = `${s.rule.name}|@${parentKey(s.occurrences[0].places[0])}`;
    out.set(k, (out.get(k) ?? 0) + s.rate);
  }
  return out;
}

/** One step of the exact process over a discovery's live spots, in a fixed order; returns the time it took. */
function step(world: World, d: Discovery, random: () => number, factored: boolean): number | null {
  const live = d.live(world.g).sort((a, b) => rules.indexOf(a.rule) - rules.indexOf(b.rule) || (a.key! < b.key! ? -1 : 1));
  const total = live.reduce((x, s) => x + s.rate, 0);
  if (!(total > 0)) return null;
  let u = random() * total;
  let chosen: LiveSpot = live[live.length - 1];
  for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
  const occ: Occurrence = chosen.factored ? d.sample(world.g, chosen, random)! : chosen.occurrences[Math.floor(random() * chosen.occurrences.length)];
  const { transition, before } = world.apply(chosen.rule, occ, sig);
  d.advanceWorld(world, before, transition);
  void factored;
  return -Math.log(1 - random()) / total;
}

describe('encounter rules, held factored', () => {
  it('the factored rules are those whose components share nothing and cannot meet one node', () => {
    const d = new Discovery(rules, sig, { factor: all });
    expect(d.encounters.map((e) => e.rule.name).sort()).toEqual(['back', 'load', 'pass', 'spend', 'three', 'unload']);
    const reason = (name: string) => encounter(rules.find((r) => r.name === name) as Rule, sig);
    expect(reason('pairC')).toBe('components that could meet one node');
    expect(reason('make')).toBe('one component');
  });

  it('at every step of a run, each factored spot is the full search summed, and every occurrence sampled is one of its occurrences', () => {
    for (const seed of [1, 2, 3]) {
      const world = new World(program.world);
      const d = new Discovery(rules, sig, { factor: all });
      const random = rng(seed);
      let steps = 0;
      for (; steps < 300; steps++) {
        const full = enumerated(world.g);
        const live = d.all(world.g);
        for (const s of live.filter((x) => x.factored)) {
          const want = full.get(s.key!) ?? 0;
          expect(Math.abs(s.rate - want), `${s.key} at step ${steps}`).toBeLessThanOrEqual(1e-12 * Math.max(1, want));
        }
        // and nothing the full search finds is missing
        for (const [k, v] of full) if (d.encounters.some((e) => k.startsWith(`${e.rule.name}|`)) && v > 0) expect(live.some((s) => s.key === k), k).toBe(true);
        // the rules left enumerated are found as before
        const plain = (xs: LiveSpot[]) => xs.filter((x) => !x.factored && x.rate > 0).map((x) => `${x.rule.name}|${spotKey(x.occurrences[0])}|${x.rate}`).sort();
        expect(plain(d.live(world.g))).toEqual(plain(spots(world.g, rules, sig).filter((x) => !d.encounters.some((e) => e.rule === x.rule))));
        // a sampled occurrence is one the full search has
        const f = live.find((x) => x.factored && x.rate > 0);
        if (f) {
          const o = d.sample(world.g, f, random)!;
          expect(spots(world.g, [f.rule], sig).some((s) => s.occurrences.some((x) => spotKey(x) === spotKey(o))), `${f.key} sampled`).toBe(true);
        }
        if (step(world, d, random, true) === null) break;
      }
      expect(steps).toBeGreaterThan(100);
    }
  });

  it('holds the components\' matches, never their product: held occurrences grow with the molecules, listed ones with their pairs', () => {
    const held = (n: number) => {
      const p = readProgram(TEXT.replace(/world = \([\s\S]*\)\n\)$/, `world = (Pool[x = 60] | ${Array(n).fill('A | A[P = 1]').join(' | ')} | ${Array(n).fill('B | B[P = 1]').join(' | ')} | C | C | C)\n)`));
      const f = new Discovery(p.rules, p.sig, { factor: all }), e = new Discovery(p.rules, p.sig);
      f.all(p.world);
      e.all(p.world);
      return { factored: f.occurrencesHeld, listed: e.occurrencesHeld };
    };
    const a = held(10), b = held(40);
    // four times the molecules (the Cs, which pair among themselves unfactored, held at three): the factored hold
    // about four times as many, the listed about sixteen times
    expect(b.factored / a.factored).toBeLessThan(5);
    expect(b.listed / a.listed).toBeGreaterThan(10);
    expect(b.factored).toBeLessThan(b.listed / 10);
  });

  it('samples occurrences in proportion to their rates', () => {
    const world = new World(program.world);
    const d = new Discovery(rules, sig, { factor: all });
    const f = d.all(world.g).find((s) => s.key === `pass|@${parentKey({ region: 0 })}`)!;
    const want = new Map(spots(world.g, [rules.find((r) => r.name === 'pass')!], sig).filter((s) => parentKey(s.occurrences[0].places[0]) === 'r0').map((s) => [spotKey(s.occurrences[0]), s.rate]));
    const total = [...want.values()].reduce((a, b) => a + b, 0);
    const n = 40000, seen = new Map<string, number>();
    const random = rng(9);
    for (let i = 0; i < n; i++) {
      const k = spotKey(d.sample(world.g, f, random)!);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect([...seen.keys()].every((k) => want.has(k))).toBe(true);
    // χ² against the rates: 99.9% point for want.size - 1 degrees of freedom is below 2.5 × dof + 15 for these sizes
    let chi = 0;
    for (const [k, r] of want) chi += ((seen.get(k) ?? 0) - (n * r) / total) ** 2 / ((n * r) / total);
    expect(chi).toBeLessThan(2.5 * (want.size - 1) + 15);
  });

  it('runs the same process: a factored run and a full one agree in distribution', () => {
    const T = 3, N = 300;
    const read = (g: Carrier) => {
      let bp = 0, c = 0;
      for (const n of g.nodes) {
        if (n.type === sig.id('C')) c++;
        if (n.type === sig.id('B')) {
          const p = g.nodes.find((x) => 'node' in x.parent && x.parent.node === n.id && 'attr' in x.member && x.member.attr && 'text' in x.member.attr && x.member.attr.text === 'P');
          if (p && typeof p.payload === 'object' && 'int' in p.payload.scalar && p.payload.scalar.int === 1) bp++;
        }
      }
      return [bp, c];
    };
    const sample = (factor: boolean) => {
      const xs: number[][] = [];
      for (let k = 0; k < N; k++) {
        const world = new World(program.world);
        const d = new Discovery(rules, sig, factor ? { factor: all } : {});
        const random = rng(100 + k);
        let t = 0;
        let last = read(world.g);
        for (;;) {
          last = read(world.g);
          const dt = step(world, d, random, factor);
          if (dt === null || (t += dt) > T) break;
        }
        xs.push(last);
      }
      return [0, 1].map((i) => {
        const v = xs.map((x) => x[i]);
        const m = v.reduce((a, b) => a + b, 0) / N;
        return { m, s2: v.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1) };
      });
    };
    const a = sample(false), b = sample(true);
    for (const i of [0, 1]) expect(Math.abs(a[i].m - b[i].m), `observable ${i}: ${a[i].m} against ${b[i].m}`).toBeLessThan(4 * Math.sqrt((a[i].s2 + b[i].s2) / N) + 1e-9);
  });
});
