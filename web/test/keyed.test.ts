/**
 * Keyed counts (chrysalis D-keyed-counts-are-a-place-keyed-by-a-record; boundary's B1, docs/36; F69): a place holds one
 * entry per type and key (every attribute but the count), a reactum writing an entry at a key finds it or makes it,
 * and an entry at count 0 leaves. A rate is per spot (D-a-rate-is-per-spot; B2; F70): an entry of count n is n spots. Boundary's suite case: one RNA, sites a and b, an enzyme for each, degradation of any.
 */
import { describe, expect, it } from 'vitest';
import { type Carrier, Discovery, World, affine, readProgram, rng, step } from '../src/engine';

const p = readProgram(`
Program(
  module = (
    Count = Type[kind = "int" | divide = "binomial"](<: Int)
    Rna[a :: Int | b :: Int | n :: Count = 0] = Type[keyed = "n"]()
    Free[nmp :: Count = 0] = Type()
    Cell = Type()
    makeA[rate = 0.1] = (?r = Rna[a = 0 | b = ?y | n = ?k]) => (?r = Rna[a = 0 | b = ?y | n = ?k - 1] | Rna[a = 1 | b = ?y | n = 1])
    makeB[rate = 0.05] = (?r = Rna[a = ?x | b = 0 | n = ?k]) => (?r = Rna[a = ?x | b = 0 | n = ?k - 1] | Rna[a = ?x | b = 1 | n = 1])
    degrade[rate = 0.01] = (?r = Rna[a = ?x | b = ?y | n = ?k] | ?f = Free[nmp = ?m]) => (?r = Rna[a = ?x | b = ?y | n = ?k - 1] | ?f = Free[nmp = ?m + 80])
  )
  world = (Cell(Rna[a = 0 | b = 0 | n = 100] | Free))
)`);
const val = (g: Carrier, id: number, k: string) => (g.nodes.find((c) => 'node' in c.parent && c.parent.node === id && 'attr' in c.member && (c.member.attr as { text: string }).text === k)!.payload as { scalar: { int: number } }).scalar.int;
const entries = (g: Carrier) => g.nodes.filter((n) => p.sig.name(n.type) === 'Rna').map((n) => ({ a: val(g, n.id, 'a'), b: val(g, n.id, 'b'), n: val(g, n.id, 'n') }));
const free = (g: Carrier) => val(g, g.nodes.find((n) => p.sig.name(n.type) === 'Free')!.id, 'nmp');

/** The laws at a state: the books, one entry per key, no entry at zero. */
function laws(g: Carrier) {
  const es = entries(g);
  expect(es.reduce((a, e) => a + e.n, 0) + free(g) / 80).toBe(100);
  expect(new Set(es.map((e) => `${e.a},${e.b}`)).size).toBe(es.length);
  for (const e of es) expect(e.n).toBeGreaterThan(0);
  return es;
}

describe('keyed counts', () => {
  it('in place (World.apply): finds or makes the entry at a key, one per key, none at zero, the books exact', () => {
    let keys = 0;
    for (const seed of [1, 2, 3]) {
      const w = new World(p.world, p.sig), d = new Discovery(p.rules, p.sig), random = rng(seed);
      for (let i = 0; i < 400; i++) {
        const live = d.live(w.g);
        const total = live.reduce((a, s) => a + s.rate, 0);
        if (!total) break;
        let u = random() * total;
        const s = live.find((x) => (u -= x.rate) < 0) ?? live[live.length - 1];
        const occ = d.fresh(w.g, s.rule, s.occurrences[0]);
        const { transition, before } = w.apply(s.rule, occ, p.sig, { inPlace: true });
        d.advanceWorld(w, before, transition);
        keys = Math.max(keys, laws(w.g).length);
        // discovery kept current through merges and departures
        expect(d.live(w.g).length).toBe(new Discovery(p.rules, p.sig).live(w.g).length);
      }
    }
    // all four keys were reached at some point
    expect(keys).toBe(4);
  });

  it('as a pure reaction (react, step): the same laws', () => {
    for (const seed of [4, 5]) {
      let g = p.world;
      const random = rng(seed);
      for (let i = 0; i < 300; i++) {
        const s = step(g, p.rules, p.sig, random);
        if (!s) break;
        g = s.state;
        laws(g);
      }
      // everything degraded in time leaves no entry
      expect(entries(g).length).toBeLessThanOrEqual(4);
    }
  });

  it('marginals agree with the closed form: a molecule has a made with p = 1 - exp(-0.1 t)', () => {
    // Gillespie in time; at t = 10, the mean count with a = 1 over seeds against 100 exp(-0.01 t) (1 - exp(-0.1 t))
    const T = 10, seeds = 40;
    let sum = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      let g = p.world, t = 0;
      const random = rng(100 + seed);
      for (;;) {
        const s = step(g, p.rules, p.sig, random);
        if (!s || t + s.dt > T) break;
        t += s.dt;
        g = s.state;
      }
      sum += entries(g).filter((e) => e.a === 1).reduce((a, e) => a + e.n, 0);
    }
    const mean = sum / seeds, pa = Math.exp(-0.01 * T) * (1 - Math.exp(-0.1 * T));
    // binomial spread of one run: sqrt(100 pa (1 - pa)); three standard errors of the mean
    expect(Math.abs(mean - 100 * pa)).toBeLessThan((3 * Math.sqrt(100 * pa * (1 - pa))) / Math.sqrt(seeds));
  });

  it('a rate is per spot: a consumer of a class takes each molecule equally likely (B2)', () => {
    const q = readProgram(`
Program(
  module = (
    Charged[mark :: Int | n :: Int = 0] = Type[keyed = "n"]()
    Used[n :: Int = 0 | from1 :: Int = 0] = Type()
    take0[rate = 1.0] = (?c = Charged[mark = 0 | n = ?k] | ?u = Used[n = ?n]) => (?c = Charged[mark = 0 | n = ?k - 1] | ?u = Used[n = ?n + 1])
    peek[rate = 0.5] = (?c = Charged[mark = 1]) => (?c = Charged[mark = 1])
    take1[rate = 1.0] = (?c = Charged[mark = 1 | n = ?k] | ?u = Used[n = ?n | from1 = ?f]) => (?c = Charged[mark = 1 | n = ?k - 1] | ?u = Used[n = ?n + 1 | from1 = ?f + 1])
  )
  world = (Charged[mark = 0 | n = 30] | Charged[mark = 1 | n = 70] | Used)
)`);
    // E1: propensities 30 and 70, per spot; the count unwritten (peek), the same
    const rates = Object.fromEntries(new Discovery(q.rules, q.sig).all(q.world).map((x) => [x.rule.name, x.rate]));
    expect(rates).toEqual({ take0: 30, take1: 70, peek: 35 });
    const takes = q.rules.filter((r) => r.name !== 'peek');
    // E2: of the first molecule taken, the fraction from mark 1, over 400 seeds: 0.7 within three standard errors
    let from1 = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const s = step(q.world, takes, q.sig, rng(seed))!;
      const used = s.state.nodes.find((x) => q.sig.name(x.type) === 'Used')!;
      from1 += val(s.state, used.id, 'from1');
    }
    expect(Math.abs(from1 / N - 0.7)).toBeLessThan(3 * Math.sqrt(0.21 / N));
  });

  it('an amount of a class in a rate: the counts of its entries summed, kept current as entries change (F71)', () => {
    const q = readProgram(`
Program(
  module = (
    Trna[species :: Int | mark :: Int | charged :: Int | n :: Int = 0] = Type[keyed = "n"]()
    Pool = Type()
    Ribo[want :: Int] = Type()
    Done[n :: Int = 0] = Type()
    read[rate = 0.01 * amount[?p Trna[species = ?s | charged = 1]]] = (?r = Ribo[want = ?s] | ?p = Pool(?x) | ?d = Done[n = ?k]) => (?r = Ribo[want = ?s] | ?p = Pool(?x) | ?d = Done[n = ?k + 1])
    use[rate = 0.1] = (?p = Pool(?t = Trna[species = ?s | mark = ?m | charged = 1 | n = ?k] | ?rest)) => (?p = Pool(?t = Trna[species = ?s | mark = ?m | charged = 1 | n = ?k - 1] | Trna[species = ?s | mark = ?m | charged = 0 | n = 1] | ?rest))
    mark[rate = 0.05] = (?p = Pool(?t = Trna[species = ?s | mark = 0 | charged = ?c | n = ?k] | ?rest)) => (?p = Pool(?t = Trna[species = ?s | mark = 0 | charged = ?c | n = ?k - 1] | Trna[species = ?s | mark = 1 | charged = ?c | n = 1] | ?rest))
  )
  world = (Pool(Trna[species = 1 | mark = 0 | charged = 1 | n = 30] | Trna[species = 1 | mark = 1 | charged = 1 | n = 20] | Trna[species = 1 | mark = 0 | charged = 0 | n = 50] | Trna[species = 2 | mark = 0 | charged = 1 | n = 7]) | Ribo[want = 1] | Ribo[want = 2] | Done)
)`);
    const readRates = (g: Carrier) => new Discovery(q.rules, q.sig).all(g).filter((x) => x.rule.name === 'read').map((x) => x.rate).sort((a, b) => a - b);
    expect(readRates(q.world)).toEqual([0.07, 0.5].map((x) => expect.closeTo(x, 12)));
    // the amount as a law: 0.01 times the charged of each species, summed over its marks, at every state reached
    const charged = (g: Carrier, sp: number) => g.nodes.filter((x) => q.sig.name(x.type) === 'Trna' && val(g, x.id, 'species') === sp && val(g, x.id, 'charged') === 1).reduce((a, x) => a + val(g, x.id, 'n'), 0);
    const w = new World(q.world, q.sig), d = new Discovery(q.rules, q.sig), random = rng(7);
    const view = (xs: { rule: { name: string }; rate: number }[]) => xs.map((x) => `${x.rule.name}:${x.rate.toFixed(9)}`).sort();
    for (let i = 0; i < 300; i++) {
      const live = d.live(w.g);
      expect(view(live)).toEqual(view(new Discovery(q.rules, q.sig).live(w.g)));
      const reads = live.filter((x) => x.rule.name === 'read').map((x) => x.rate).sort((a, b) => a - b);
      const want = [charged(w.g, 2), charged(w.g, 1)].map((c) => 0.01 * c).filter((r) => r > 0).sort((a, b) => a - b);
      expect(reads.map((r) => r.toFixed(9))).toEqual(want.map((r) => r.toFixed(9)));
      const total = live.reduce((a, x) => a + x.rate, 0);
      if (!total) break;
      let u = random() * total;
      const sp = live.find((x) => (u -= x.rate) < 0) ?? live[live.length - 1];
      const { transition, before } = w.apply(sp.rule, d.fresh(w.g, sp.rule, sp.occurrences[0]), q.sig, { inPlace: true });
      d.advanceWorld(w, before, transition);
    }
  });

  it('a draw of several molecules of a class: without replacement, rewritten, merged by key (F72; B2 E3)', () => {
    const q = readProgram(`
Program(
  module = (
    Trna[species :: Int | mark :: Int | charged :: Int | n :: Int = 0] = Type[keyed = "n"]()
    Pool = Type()
    Job[need :: Int] = Type()
    Done = Type()
    take3[rate = 1.0 | draw = take[?p Trna[species = 1 | charged = 1] ?k Trna[charged = 0]]] = (?j = Job[need = ?k] | ?p = Pool(?x)) => (?p = Pool(?x) | Done)
  )
  world = (Pool(Trna[species = 1 | mark = 0 | charged = 1 | n = 30] | Trna[species = 1 | mark = 1 | charged = 1 | n = 70] | Trna[species = 2 | mark = 1 | charged = 1 | n = 500]) | Job[need = 3])
)`);
    const at = (g: Carrier, sp: number, mark: number, ch: number) => g.nodes.filter((x) => q.sig.name(x.type) === 'Trna' && val(g, x.id, 'species') === sp && val(g, x.id, 'mark') === mark && val(g, x.id, 'charged') === ch).reduce((a, x) => a + val(g, x.id, 'n'), 0);
    const N = 400;
    const xs: number[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const s = step(q.world, q.rules, q.sig, rng(seed))!;
      const g = s.state;
      // three taken from species 1, put back uncharged with their marks; species 2 untouched; one entry per key
      expect(at(g, 1, 0, 1) + at(g, 1, 1, 1)).toBe(97);
      expect(at(g, 1, 0, 0) + at(g, 1, 1, 0)).toBe(3);
      expect(at(g, 1, 0, 1) + at(g, 1, 0, 0)).toBe(30);
      expect(at(g, 2, 1, 1)).toBe(500);
      const keys = g.nodes.filter((x) => q.sig.name(x.type) === 'Trna').map((x) => `${val(g, x.id, 'species')},${val(g, x.id, 'mark')},${val(g, x.id, 'charged')}`);
      expect(new Set(keys).size).toBe(keys.length);
      xs.push(at(g, 1, 1, 0));
    }
    // in place too (World.apply, as a runtime applies it), with discovery kept current
    for (const seed of [1, 2, 3]) {
      const w = new World(q.world, q.sig), d = new Discovery(q.rules, q.sig);
      const sp = d.live(w.g)[0];
      const { transition, before } = w.apply(sp.rule, d.fresh(w.g, sp.rule, sp.occurrences[0]), q.sig, { inPlace: true, random: rng(seed) });
      d.advanceWorld(w, before, transition);
      expect(at(w.g, 1, 0, 0) + at(w.g, 1, 1, 0)).toBe(3);
      expect(at(w.g, 1, 0, 1) + at(w.g, 1, 1, 1)).toBe(97);
      expect(d.live(w.g).length).toBe(new Discovery(q.rules, q.sig).live(w.g).length);
    }
    // the hypergeometric: mean 3 * 0.7 = 2.1, variance 3 * 0.7 * 0.3 * 97 / 99
    const mean = xs.reduce((a, b) => a + b, 0) / N, v = 3 * 0.7 * 0.3 * (97 / 99);
    expect(Math.abs(mean - 2.1)).toBeLessThan(3 * Math.sqrt(v / N));
    const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1);
    // (the sample variance's standard error, for a variable on 0..3: about v * sqrt(2 / N) at most twice that)
    expect(Math.abs(varr - v)).toBeLessThan(3 * 2 * v * Math.sqrt(2 / N));
    // where the class holds less than it takes, the rule meets at rate 0 (F74: a count's change re-rates it)
    const short = readProgram(`
Program(
  module = (
    Trna[species :: Int | charged :: Int | n :: Int = 0] = Type[keyed = "n"]()
    Pool = Type()
    Job[need :: Int] = Type()
    take[rate = 1.0 | draw = take[?p Trna[species = 1 | charged = 1] ?k Trna[charged = 0]]] = (?j = Job[need = ?k] | ?p = Pool(?x)) => (?p = Pool(?x))
  )
  world = (Pool(Trna[species = 1 | charged = 1 | n = 2]) | Job[need = 3])
)`);
    expect(new Discovery(short.rules, short.sig).all(short.world).map((x) => x.rate)).toEqual([0]);
  });

  it('a rule making a keyed entry is read as its merge (affine) and its make; exactly one meets where it would (F73)', () => {
    const names = p.rules.map((r) => r.name).sort();
    expect(names).toEqual(['degrade', 'makeA', 'makeA+', 'makeB', 'makeB+']);
    // the merges only change counts: a flow can integrate them
    for (const n of ['makeA', 'makeB']) expect(affine(p.rules.find((r) => r.name === n)!)).not.toBeNull();
    for (const n of ['makeA+', 'makeB+']) expect(affine(p.rules.find((r) => r.name === n)!)).toBeNull();
    // at the seed only [0, 0] stands: each enzyme can only make; its rate is per molecule of the source, not the target
    const at = (g: Carrier) => Object.fromEntries(new Discovery(p.rules, p.sig).all(g).map((x) => [x.rule.name, x.rate]));
    expect(at(p.world)).toEqual({ 'makeA+': 10, 'makeB+': 5, degrade: 1 });
    // once [1, 0] stands, makeA merges into it, at the same rate, and its make no longer meets
    const s1 = readProgram(`
Program(
  module = (
    Count = Type[kind = "int" | divide = "binomial"](<: Int)
    Rna[a :: Int | b :: Int | n :: Count = 0] = Type[keyed = "n"]()
    makeA[rate = 0.1] = (?r = Rna[a = 0 | b = ?y | n = ?k]) => (?r = Rna[a = 0 | b = ?y | n = ?k - 1] | Rna[a = 1 | b = ?y | n = 1])
  )
  world = (Rna[a = 0 | b = 0 | n = 100] | Rna[a = 1 | b = 0 | n = 7])
)`);
    const r1 = Object.fromEntries(new Discovery(s1.rules, s1.sig).all(s1.world).map((x) => [x.rule.name, x.rate]));
    expect(r1).toEqual({ makeA: 10 });
  });

  it('a draw puts its molecules back as another keyed type, each keeping its marks (F72)', () => {
    const q = readProgram(`
Program(
  module = (
    Charged[mark :: Int | n :: Int = 0] = Type[keyed = "n"]()
    Free[mark :: Int | n :: Int = 0] = Type[keyed = "n"]()
    Pool = Type()
    Job[need :: Int] = Type()
    take[rate = 1.0 | draw = take[?p Charged[] ?k Free[]]] = (?j = Job[need = ?k] | ?p = Pool(?x)) => (?p = Pool(?x))
  )
  world = (Pool(Charged[mark = 0 | n = 30] | Charged[mark = 1 | n = 70] | Free[mark = 1 | n = 5]) | Job[need = 10])
)`);
    for (const seed of [1, 2, 3]) {
      const g = step(q.world, q.rules, q.sig, rng(seed))!.state;
      const by = (t: string, m: number) => g.nodes.filter((x) => q.sig.name(x.type) === t && val(g, x.id, 'mark') === m).reduce((a, x) => a + val(g, x.id, 'n'), 0);
      expect(by('Charged', 0) + by('Charged', 1)).toBe(90);
      expect(by('Free', 0) + by('Free', 1)).toBe(15);
      // each mark's molecules conserved across the two types
      expect(by('Charged', 0) + by('Free', 0)).toBe(30);
      expect(by('Charged', 1) + by('Free', 1)).toBe(75);
      const keys = g.nodes.filter((x) => ['Charged', 'Free'].includes(q.sig.name(x.type))).map((x) => `${q.sig.name(x.type)},${val(g, x.id, 'mark')}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('a rate reading its entry\'s count is that entry\'s propensity as written, not multiplied again (F75)', () => {
    const q = readProgram(`
Program(
  module = (
    E[mark :: Int | n :: Int = 0] = Type[keyed = "n"]()
    perMolecule[rate = 0.5] = (?e = E[mark = 0 | n = ?k]) => (?e = E[mark = 0 | n = ?k])
    asWritten[rate = 2.0 * ?k / (10 + ?k)] = (?e = E[mark = 0 | n = ?k]) => (?e = E[mark = 0 | n = ?k])
  )
  world = (E[mark = 0 | n = 30])
)`);
    const r = Object.fromEntries(new Discovery(q.rules, q.sig).all(q.world).map((x) => [x.rule.name, x.rate]));
    expect(r.perMolecule).toBeCloseTo(15, 12);
    expect(r.asWritten).toBeCloseTo(1.5, 12);
  });

  it('a draw across types, each molecule put back as its own type names (F77; boundary H9c)', () => {
    const q = readProgram(`
Program(
  module = (
    ReadsGGA = Type()
    T_chargedA[mark :: Int = 0 | n :: Int = 0] = Type[keyed = "n" | uncharged = "T_freeA"](<: ReadsGGA)
    T_chargedB[mark :: Int = 0 | n :: Int = 0] = Type[keyed = "n" | uncharged = "T_freeB"](<: ReadsGGA)
    T_freeA[mark :: Int = 0 | n :: Int = 0] = Type[keyed = "n"]()
    T_freeB[mark :: Int = 0 | n :: Int = 0] = Type[keyed = "n"]()
    Pool = Type()
    Job[need :: Int] = Type()
    read[rate = 1.0 | draw = take[?p ReadsGGA[] ?k uncharged[]]] = (?j = Job[need = ?k] | ?p = Pool(?x)) => (?p = Pool(?x))
  )
  world = (Pool(T_chargedA[n = 30] | T_chargedB[mark = 1 | n = 70] | T_freeB[mark = 1 | n = 5]) | Job[need = 10])
)`);
    const by = (g: Carrier, t: string) => g.nodes.filter((x) => q.sig.name(x.type) === t).reduce((a, x) => a + val(g, x.id, 'n'), 0);
    // the class's amount reads both readers
    expect(new Discovery(q.rules, q.sig).all(q.world).map((x) => x.rate)).toEqual([1]);
    const N = 300, xs: number[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const g = step(q.world, q.rules, q.sig, rng(seed))!.state;
      // each species conserved: its charged and free together, the free back with the mark it was drawn with
      expect(by(g, 'T_chargedA') + by(g, 'T_freeA')).toBe(30);
      expect(by(g, 'T_chargedB') + by(g, 'T_freeB')).toBe(75);
      expect(by(g, 'T_freeA') + by(g, 'T_freeB')).toBe(15);
      const keys = g.nodes.filter((x) => q.sig.name(x.type).startsWith('T_')).map((x) => `${q.sig.name(x.type)},${val(g, x.id, 'mark')}`);
      expect(new Set(keys).size).toBe(keys.length);
      xs.push(by(g, 'T_freeB') - 5);
    }
    // the hypergeometric: of 10 drawn from 30 and 70, from B a mean of 7, variance 10 · 0.7 · 0.3 · 90/99
    const mean = xs.reduce((a, b) => a + b, 0) / N, v = 10 * 0.7 * 0.3 * (90 / 99);
    expect(Math.abs(mean - 7)).toBeLessThan(3 * Math.sqrt(v / N));
    // every type of the class must name where it goes
    expect(() => readProgram(`
Program(
  module = (
    R = Type()
    C[n :: Int = 0] = Type[keyed = "n"](<: R)
    Pool = Type()
    read[rate = 1.0 | draw = take[?p R[] 1 uncharged[]]] = (?p = Pool(?x)) => (?p = Pool(?x))
  )
  world = (Pool(C[n = 3]))
)`)).toThrow(/names no keyed type as its uncharged/);
  });
});
