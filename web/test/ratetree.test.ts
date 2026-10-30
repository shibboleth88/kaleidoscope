/**
 * The sum tree of rates (F91): discovery's total is the sum of the live spots' rates at every step, and the spot it
 * finds at a point of the total is drawn in proportion to its rate.
 */
import { describe, expect, it } from 'vitest';
import { Discovery, World, readProgram, rng } from '../src/engine';

const p = readProgram(`Program(
  module = (
    Bond = Type(<: Link)
    Pool = Type()
    A[b :: Bond * | n :: Int] = Type()
    grow[rate = 0.5 * ?n] = (?a = A[n = ?n]) where ?n < 9 => (?a = A[n = ?n + 1])
    shrink[rate = 0.3 * ?n] = (?a = A[n = ?n]) => (?a = A[n = ?n - 1])
    bond[rate = 0.2] = (?a = A[b = ?as] | ?c = A[b = ?cs]) => (?a = A[b = (?as | ~x)] | ?c = A[b = (?cs | ~x)])
    part[rate = 1.0] = (~x :: Bond | ?a = A[b = (~x | ?as)] | ?c = A[b = (~x | ?cs)]) => (?a = A[b = ?as] | ?c = A[b = ?cs])
  )
  world = (Pool(A[n = 1] | A[n = 2] | A[n = 3] | A[n = 4] | A[n = 5]))
)`);

describe('the sum tree of rates (F91)', () => {
  it("holds the live spots' total at every step of a run in place", () => {
    const w = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    const random = rng(4);
    for (let i = 0; i < 400; i++) {
      const live = d.live(w.g);
      const sum = live.reduce((a, s) => a + s.rate, 0);
      expect(d.totalRate(w.g)).toBeCloseTo(sum, 9);
      const s = d.spotAt(w.g, random() * sum)!;
      expect(live).toContain(s);
      const { transition, before } = w.apply(s.rule, d.fresh(w.g, s.rule, s.occurrences[0]), p.sig, { inPlace: true, random });
      d.advanceWorld(w, before, transition);
    }
  });

  it('finds each spot in proportion to its rate', () => {
    const d = new Discovery(p.rules, p.sig);
    const live = d.live(p.world);
    const total = d.totalRate(p.world)!;
    const seen = new Map<unknown, number>();
    const N = 20000;
    for (let k = 0; k < N; k++) {
      const s = d.spotAt(p.world, ((k + 0.5) / N) * total)!;
      seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    for (const s of live) expect((seen.get(s) ?? 0) / N).toBeCloseTo(s.rate / total, 3);
  });

  it('comes to exactly zero when the last spot goes, whatever rounding the rates gathered', () => {
    const q = readProgram(`Program(
  module = (
    Pool = Type()
    A = Type()
    B = Type()
    C = Type()
    a[rate = 0.1] = A => ()
    b[rate = 0.2] = B => ()
    c[rate = 0.7] = C => ()
  )
  world = (Pool(A | B | C | A | B | C | A | B | C))
)`);
    const w = new World(q.world, q.sig);
    const d = new Discovery(q.rules, q.sig);
    const random = rng(2);
    let steps = 0;
    for (let total = d.totalRate(w.g)!; total > 0; total = d.totalRate(w.g)!) {
      const s = d.spotAt(w.g, random() * total)!;
      expect(s).toBeTruthy();
      const { transition, before } = w.apply(s.rule, d.fresh(w.g, s.rule, s.occurrences[0]), q.sig, { inPlace: true, random });
      d.advanceWorld(w, before, transition);
      steps++;
    }
    expect(steps).toBe(9);
    expect(d.totalRate(w.g)).toBe(0);
  });
});
