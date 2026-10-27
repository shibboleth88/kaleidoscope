/**
 * Several rests put back in one port (F84): a reactum's group may name more than one rest, and holds the union of
 * their points. A conquered polity's other wars become the victor's.
 */
import { describe, expect, it } from 'vitest';
import { Discovery, ReadError, World, react, readProgram, sameCarrier } from '../src/engine';

const text = (rule: string) => `Program(
  module = (
    War = Type(<: Link)
    Land = Type()
    P[wars :: War * | name :: Text | s :: Int] = Type()
    ${rule}
  )
  world = (Land(
    P[wars = (~ab | ~ac) | name = "a" | s = 9]
    P[wars = (~ab | ~bd | ~be) | name = "b" | s = 0]
    P[wars = (~ac) | name = "c" | s = 5]
    P[wars = (~bd) | name = "d" | s = 5]
    P[wars = (~be) | name = "e" | s = 5]
  ))
)`;

const conquer = `conquer[rate = 1.0] =
      (~w :: War | ?l = Land(?a = P[wars = (~w | ?as) | s = ?x] | ?b = P[wars = (~w | ?bs) | s = 0] | ?rs)) where ?x > 0
      => (?l = Land(?a = P[wars = (?as | ?bs) | s = ?x] | ?rs))`;

/** Whom each polity is at war with, by name. */
const enemies = (g: import('../src/engine').Carrier) => {
  const name = (id: number) => (g.nodes.find((n) => 'node' in n.parent && n.parent.node === id && JSON.stringify(n.member) === '{"attr":{"text":"name"}}')!.payload as { scalar: { text: string } }).scalar.text;
  const ps = g.nodes.filter((n) => n.ports.length);
  const on = (n: (typeof ps)[number]) => n.ports.flatMap((pg) => pg.points.map(([, p]) => JSON.stringify(p.target)));
  return Object.fromEntries(ps.map((n) => [name(n.id), ps.filter((m) => m !== n && on(m).some((e) => on(n).includes(e))).map((m) => name(m.id)).sort()]));
};

describe('several rests in a reactum port', () => {
  it('reads, and the victor takes the loser’s other wars as its own', () => {
    const p = readProgram(text(conquer));
    const d = new Discovery(p.rules, p.sig);
    const [spot] = d.live(p.world);
    expect(spot).toBeDefined();
    const { state } = react(p.world, spot.rule, spot.occurrences[0], p.sig);
    expect(enemies(state)).toEqual({ a: ['c', 'd', 'e'], c: ['a'], d: ['a'], e: ['a'] });
  });

  it('is the same reaction in place', () => {
    const p = readProgram(text(conquer));
    const d = new Discovery(p.rules, p.sig);
    const [spot] = d.live(p.world);
    const w = new World(p.world, p.sig);
    const ref = react(p.world, spot.rule, spot.occurrences[0], p.sig, { ids: { node: w.next.node, edge: w.next.edge } });
    w.apply(spot.rule, spot.occurrences[0], p.sig, { inPlace: true });
    expect(enemies(w.snapshot())).toEqual(enemies(ref.state));
    expect(sameCarrier(w.snapshot(), ref.state)).toBe(true);
  });

  it('is refused in a redex, where which points each rest held would be ambiguous', () => {
    expect(() => readProgram(text(`bad[rate = 1.0] = (?a = P[wars = (?as | ?bs)]) => (?a = P[wars = (?as | ?bs)])`))).toThrow(ReadError);
  });
});
