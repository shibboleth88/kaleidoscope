/**
 * Division (F61): a rule with `split` divides a site its reactum writes twice. A count of a type declaring `divide`
 * stands in both places, partitioned by its policy (`binomial`, `half`); any other node goes whole to one place.
 * Every count's parts sum to it, and every node lands exactly once.
 */
import { describe, expect, it } from 'vitest';
import { Discovery, World, divide, readProgram, rng } from '../src/engine';

const TEXT = (uses: string) => `
Program(
  module = (
    Count = Type[kind = "int" | divide = "binomial"](<: Int)
    Area = Type[kind = "int" | divide = "half"](<: Int)
    Pool[a :: Count = 0 | b :: Area = 0] = Type()
    Token = Type()
    Box = Type()
    Mark = Type()
    split[rate = 1.0 | split = "r"] = (?m = Mark | ?x = Box(?r)) => (${uses})
  )
  world = (Mark | Box(Pool[a = 1000 | b = 11] | ${Array(20).fill('Token').join(' | ')}))
)`;

describe('division', () => {
  it('partitions a site: counts summed by their policy, every other node in exactly one place', () => {
    const p = readProgram(TEXT('?x = Box(?r) | Box(?r)'));
    const rule = p.rules.find((r) => r.name === 'split')!;
    expect(rule.split).toBe(0);
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new World(p.world);
      // a site worked out (discovery leaves it lazy until a reaction needs what it holds)
      const d = new Discovery(p.rules, p.sig);
      const occ = d.fresh(w.g, rule, d.all(w.g)[0].occurrences[0]);
      const { transition } = w.apply(rule, occ, p.sig);
      const g = divide(w.snapshot(), p.sig, occ.sites[rule.split!], transition.copied, rng(seed));
      const boxes = g.nodes.filter((n) => p.sig.name(n.type) === 'Box');
      expect(boxes.length).toBe(2);
      const inBox = (b: number, t: string) => g.nodes.filter((n) => 'node' in n.parent && n.parent.node === b && p.sig.name(n.type) === t);
      const attr = (pool: number, k: string) => (g.nodes.find((n) => 'node' in n.parent && n.parent.node === pool && 'attr' in n.member && (n.member.attr as { text: string }).text === k)!.payload as { scalar: { int: number } }).scalar.int;
      const pools = boxes.map((b) => inBox(b.id, 'Pool')[0].id);
      expect(pools.length).toBe(2);
      expect(attr(pools[0], 'a') + attr(pools[1], 'a'), `seed ${seed}`).toBe(1000);
      expect([attr(pools[0], 'b'), attr(pools[1], 'b')].sort()).toEqual([5, 6]);
      const tokens = boxes.map((b) => inBox(b.id, 'Token').length);
      expect(tokens[0] + tokens[1], `seed ${seed}`).toBe(20);
      expect(g.nodes.filter((n) => p.sig.name(n.type) === 'Token').length).toBe(20);
    }
  });

  it('refuses a split site written other than twice', () => {
    expect(() => readProgram(TEXT('?x = Box(?r) | Box(?r) | Box(?r)'))).toThrow(/split: \?r is written 3 times/);
    expect(() => readProgram(TEXT('?x = Box(?r)'))).toThrow(/split: \?r is written 1 times/);
  });
});
