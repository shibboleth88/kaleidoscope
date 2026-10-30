/**
 * A rule written for a type meets its subtypes, and a subtype may add ports (F109): the pattern binds the groups it
 * names, and a kept node keeps the others as they stood, on the links they were on, by `react` and by a world's
 * reaction in place alike.
 */
import { describe, expect, it } from 'vitest';
import { Discovery, World, pickOccurrence, readProgram, rng, step } from '../src/engine';

const program = (decl: string, world: string) =>
  readProgram(`Program(
  module = (
    L = Type(<: Link)
    A[p :: L] = Type()
    ${decl}
    W[p :: L | q :: L] = Type()
    Done = Type()
    mark[rate = 1.0] = ?x = A[p = ~a] => ?x = A[p = ~a](Done)
  )
  world = (${world})
)`);

/** The edge a node's point at a port group is on. */
const on = (p: ReturnType<typeof program>, g: ReturnType<typeof program>['world'], type: string, port: string) => {
  const n = g.nodes.find((x) => p.sig.name(x.type) === type)!;
  return JSON.stringify(n.ports.find((x) => JSON.stringify(x.key).includes(`"${port}"`))?.points[0]?.[1].target);
};

describe('subtypes', () => {
  it('a subtype with the same ports is met, and keeps its type', () => {
    const p = program('B[p :: L] = Type(<: A)', 'B[p = ~w]');
    const s = step(p.world, p.rules, p.sig, rng(1))!;
    expect(s).not.toBeNull();
    expect(s.state.nodes.some((n) => p.sig.name(n.type) === 'B')).toBe(true);
  });

  it('a subtype with a port of its own is met, and keeps the port on its link (react)', () => {
    const p = program('B[p :: L | q :: L] = Type(<: A)', 'B[p = ~w | q = ~v] | W[p = ~u | q = ~v]');
    const s = step(p.world, p.rules, p.sig, rng(1))!;
    expect(s).not.toBeNull();
    expect(s.state.nodes.filter((n) => p.sig.name(n.type) === 'Done')).toHaveLength(1);
    expect(on(p, s.state, 'B', 'q')).toBe(on(p, s.state, 'W', 'q'));
  });

  it('and the same in place (a world)', () => {
    const p = program('B[p :: L | q :: L] = Type(<: A)', 'B[p = ~w | q = ~v] | W[p = ~u | q = ~v]');
    const random = rng(1);
    const w = new World(p.world, p.sig);
    const d = new Discovery(p.rules, p.sig);
    const [spot] = d.live(w.g);
    const occ = d.fresh(w.g, spot.rule, pickOccurrence(spot, random)!, { inPlace: true });
    w.apply(spot.rule, occ, p.sig, { inPlace: true, random });
    const g = w.snapshot();
    expect(g.nodes.filter((n) => p.sig.name(n.type) === 'Done')).toHaveLength(1);
    expect(on(p, g, 'B', 'q')).toBe(on(p, g, 'W', 'q'));
  });

  it('a subtype with an attribute of its own is not met yet (F109: open)', () => {
    const p = program('B[p :: L | n :: Int = 1] = Type(<: A)', 'B[p = ~w | n = 3]');
    expect(step(p.world, p.rules, p.sig, rng(1))).toBeNull();
  });
});
