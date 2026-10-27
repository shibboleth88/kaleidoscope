/**
 * Events (F83, `engine/events.ts`): the occurrences of a spot that are one reaction count once; those that are
 * different reactions count each at its own rate.
 */
import { describe, expect, it } from 'vitest';
import { Discovery, World, readProgram, spots } from '../src/engine';

const program = (rules: string, world: string) =>
  readProgram(`Program(
  module = (
    War = Type(<: Link)
    A = Type()
    B = Type()
    P[wars :: War * | s :: Int] = Type()
    ${rules}
  )
  world = (${world})
)`);

const total = (p: ReturnType<typeof program>, name: string) => {
  const plain = spots(p.world, p.rules, p.sig).filter((s) => s.rule.name === name).reduce((a, s) => a + s.rate, 0);
  const kept = new Discovery(p.rules, p.sig).live(p.world).filter((s) => s.rule.name === name).reduce((a, s) => a + s.rate, 0);
  expect(kept).toBeCloseTo(plain, 12);
  return plain;
};

describe('events: a spot rated by the reactions its occurrences are', () => {
  it('counts a symmetric rule once: two As meeting each way round are one reaction', () => {
    const p = program('pair[rate = 2.0] = (A | A) => (B)', 'A | A');
    expect(total(p, 'pair')).toBeCloseTo(2, 12);
  });

  it('counts a symmetric redex with an asymmetric reactum twice, each way round at its own rate', () => {
    // each side of a war is worn down at the other's strength: 3 wears down the 5, at 3; 5 the 3, at 5
    const p = program(
      'wear[rate = 1.0 * ?y] = (~w :: War | ?a = P[wars = (~w | ?as) | s = ?x] | ?b = P[wars = (~w | ?bs) | s = ?y]) => (~w :: War | ?a = P[wars = (~w | ?as) | s = ?x - 1] | ?b = P[wars = (~w | ?bs) | s = ?y])',
      'P[wars = ~w | s = 3] | P[wars = ~w | s = 5]',
    );
    expect(total(p, 'wear')).toBeCloseTo(8, 12);
  });

  it('keeps the rates right as the world changes in place', () => {
    const p = program(
      'wear[rate = 1.0 * ?y] = (~w :: War | ?a = P[wars = (~w | ?as) | s = ?x] | ?b = P[wars = (~w | ?bs) | s = ?y]) where ?x > 0 => (~w :: War | ?a = P[wars = (~w | ?as) | s = ?x - 1] | ?b = P[wars = (~w | ?bs) | s = ?y])',
      'P[wars = ~w | s = 30] | P[wars = ~w | s = 50]',
    );
    const w = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    for (let i = 0; i < 40; i++) {
      const live = d.live(w.g);
      const fresh = spots(w.snapshot(), p.rules, p.sig);
      expect(live.reduce((a, s) => a + s.rate, 0)).toBeCloseTo(fresh.reduce((a, s) => a + s.rate, 0), 9);
      if (!live.length) break;
      const s = live[0];
      const { transition, before } = w.apply(s.rule, d.fresh(w.g, s.rule, s.occurrences[i % s.occurrences.length]), p.sig, { inPlace: true });
      d.advanceWorld(w, before, transition);
    }
  });
});
