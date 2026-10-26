/**
 * A join on a value (F60, F68): a variable written at two attribute sites of a redex meets only where both hold equal
 * values; the reactum and the rate read it. A fork at segment k steps over the segment whose index is k, one rule for
 * every segment.
 */
import { describe, expect, it } from 'vitest';
import { Discovery, ReadError, World, readProgram, rng, spots, step } from '../src/engine';

const TEXT = (rule: string) => `
Program(
  module = (
    Fork[at :: Int] = Type()
    Seg[seg :: Int | rep :: Int = 0] = Type()
    ${rule}
  )
  world = (Fork[at = 0] | Seg[seg = 0] | Seg[seg = 1] | Seg[seg = 2])
)`;
const STEP = 'step[rate = 1.0 + ?k] = (?f = Fork[at = ?k] | ?s = Seg[seg = ?k | rep = 0]) => (?f = Fork[at = ?k + 1] | ?s = Seg[seg = ?k | rep = 1])';

describe('a join on a value', () => {
  it('meets only where the two sites hold equal values, the rate reading the joined value', () => {
    const p = readProgram(TEXT(STEP));
    const spots = new Discovery(p.rules, p.sig).all(p.world);
    expect(spots.length).toBe(1);
    expect(spots[0].rate).toBe(1);
  });

  it('runs the fork along every segment in order, one rule for all of them', () => {
    const p = readProgram(TEXT(STEP));
    const w = new World(p.world);
    let fired = 0;
    for (;;) {
      const d = new Discovery(p.rules, p.sig), spots = d.all(w.g);
      if (!spots.length) break;
      expect(spots.length).toBe(1);
      const rule = spots[0].rule;
      w.apply(rule, d.fresh(w.g, rule, spots[0].occurrences[0]), p.sig);
      fired++;
    }
    const g = w.snapshot();
    const val = (n: (typeof g.nodes)[number], k: string) => (g.nodes.find((c) => 'node' in c.parent && c.parent.node === n.id && 'attr' in c.member && (c.member.attr as { text: string }).text === k)!.payload as { scalar: { int: number } }).scalar.int;
    expect(fired).toBe(3);
    expect(g.nodes.filter((n) => p.sig.name(n.type) === 'Seg').map((n) => val(n, 'rep'))).toEqual([1, 1, 1]);
    expect(val(g.nodes.find((n) => p.sig.name(n.type) === 'Fork')!, 'at')).toBe(3);
  });

  it('joins only values: a structural site written twice is still refused', () => {
    expect(() => readProgram(TEXT('r[rate = 1.0] = (?f = Fork(?x) | ?s = Seg(?x)) => (?f = Fork(?x) | ?s = Seg(?x))'))).toThrow(ReadError);
  });

  it('incremental discovery keeps a join current as the value on either side changes', () => {
    // tags and slots whose values move; a join binds a tag and a slot of equal value (B5's shape, small)
    const p = readProgram(`
Program(
  module = (
    Tag[x :: Int | y :: Int | b :: Int = 0] = Type()
    Slot[x :: Int | y :: Int | b :: Int = 0] = Type()
    bind[rate = 1.0] = (?t = Tag[x = ?x | y = ?y | b = 0] | ?s = Slot[x = ?x | y = ?y | b = 0]) => (?t = Tag[x = ?x | y = ?y | b = 1] | ?s = Slot[x = ?x | y = ?y | b = 1])
    shiftT[rate = 2.0] = (?t = Tag[x = ?x | b = 0]) => (?t = Tag[x = (?x + 1) % 3 | b = 0])
    shiftS[rate = 2.0] = (?s = Slot[y = ?y | b = 0]) => (?s = Slot[y = (?y + 1) % 2 | b = 0])
  )
  world = (${[0, 1, 2, 0, 1, 2].map((x, i) => `Tag[x = ${x} | y = ${i % 2}] | Slot[x = ${(x + i) % 3} | y = ${(i + 1) % 2}]`).join(' | ')})
)`);
    const view = (xs: { rule: { name: string }; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
      xs.map((x) => `${x.rule.name}|${x.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort().join(';')}|${x.rate}`).sort();
    let g = p.world;
    const d = new Discovery(p.rules, p.sig), random = rng(5);
    for (let i = 0; i < 200; i++) {
      expect(view(d.live(g))).toEqual(view(spots(g, p.rules, p.sig)));
      const s = step(g, p.rules, p.sig, random, d);
      if (!s) break;
      g = s.state;
    }
    // some tag was bound, and to a slot of its values
    const bound = g.nodes.filter((n) => typeof n.payload === 'object' && 'attr' in n.member && (n.member.attr as { text: string }).text === 'b' && (n.payload as { scalar: { int: number } }).scalar.int === 1);
    expect(bound.length).toBeGreaterThan(0);
    expect(bound.length % 2).toBe(0);
  });
});
