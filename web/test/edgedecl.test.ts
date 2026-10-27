import { describe, expect, it } from 'vitest';
import { World, discover, print, readProgram, react, spots } from '../src/engine';

/**
 * F100: a closed edge is declared at a side's top level, whichever region it is written in. A rule meeting two regions
 * joined by a border, `(?g = Region[border = (~e | …)](…)) || (~e :: Border = … | ?k = …)`, declared its edge in the
 * second region and silently met nothing: the first region's `~e` was read as an outer name before the declaration.
 */
const program = (first: boolean) => `Program(
  module = (
    Border = Type(<: Link)
    Crossing[cost :: Int = 1] = Type()
    Region[border :: Border * | n :: Int = 0] = Type()
    pass[rate = 1.0 / ?c] =
      ${first ? '(~e :: Border = Crossing[cost = ?c] | ' : '('}?g = Region[border = (~e | ?gb) | n = ?n]) || (${first ? '' : '~e :: Border = Crossing[cost = ?c] | '}?k = Region[border = (~e | ?kb) | n = ?m])
        where ?n > 0
      => ${first ? '(~e :: Border = Crossing[cost = ?c + 1] | ' : '('}?g = Region[border = (~e | ?gb) | n = ?n - 1]) || (${first ? '' : '~e :: Border = Crossing[cost = ?c + 1] | '}?k = Region[border = (~e | ?kb) | n = ?m + 1])
  )
  world = (~a :: Border = Crossing[cost = 2] | ~b :: Border | Region[border = ~a | n = 3] | Region[border = (~a | ~b) | n = 1] | Region[border = ~b])
)`;

describe('a closed edge declared in a later region (F100)', () => {
  it('is the edge every region of the side uses, as where it is declared first', () => {
    const early = readProgram(program(true)), late = readProgram(program(false));
    const [re, rl] = [early.rules[0], late.rules[0]];
    // the redex has one closed edge and no outer name for it, in both
    expect(rl.redex.edges.length).toBe(1);
    expect(rl.redex.outer.names.length).toBe(re.redex.outer.names.length);
    const occ = (p: typeof early) => discover(p.world, p.rules[0], p.sig);
    expect(occ(late).length).toBe(2);
    expect(occ(late).length).toBe(occ(early).length);
    expect(spots(late.world, late.rules, late.sig).map((s) => s.rate).sort()).toEqual(spots(early.world, early.rules, early.sig).map((s) => s.rate).sort());
    // and it fires alike: the value written on the edge, the people moved
    const fire = (p: typeof early) => print(react(p.world, p.rules[0], occ(p)[0], p.sig).state, p.sig);
    expect(fire(late)).toBe(fire(early));
    const w = new World(late.world, late.sig);
    w.apply(rl, occ(late)[0], late.sig, { inPlace: true });
    expect(print(w.g, late.sig)).toBe(fire(early));
  });
});
