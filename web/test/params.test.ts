import { describe, expect, it } from 'vitest';
import { discover, print, react, readProgram, ReadError, spots } from '../src/engine';

/**
 * F107: a module's parameters, `name = <constant>`, read bare by expressions, defaults and host configuration (DESIGN:
 * "a lowercase name is a value"), and configured when the program is read: the values a run is given, in place of the
 * declared ones. wyrm's hypotheses each set numbers (a measured skew, a depletion); its generator baked them in from
 * environment variables, out of the program's sight.
 */
const lib = `
grow_by = 2
cap = grow_by * 5
Cell[size :: Int = grow_by | max :: Int = cap] = Type()
`;
const files: Record<string, string> = { lib };
const load = (path: string) => files[path];

const withParams = `
Program(
  module = (
    lib = Module["lib"]
    speed = 0.5
    label = "grown"
    grow[rate = speed * 2.0] = ?c = Cell[size = ?s | max = ?m] where ?s < ?m - grow_by
      => ?c = Cell[size = ?s + grow_by | max = ?m]
  )
  world = ( Cell | Cell[size = cap - 1] )
)`;
const written = `
Program(
  module = (
    Cell[size :: Int = 2 | max :: Int = 10] = Type()
    grow[rate = 1.0] = ?c = Cell[size = ?s | max = ?m] where ?s < ?m - 2
      => ?c = Cell[size = ?s + 2 | max = ?m]
  )
  world = ( Cell | Cell[size = 9] )
)`;

const states = (p: ReturnType<typeof readProgram>) => {
  const out: string[] = [];
  let g = p.world;
  for (let i = 0; i < 6; i++) {
    const o = discover(g, p.rules[0], p.sig).sort((a, b) => JSON.stringify(a.nodes) < JSON.stringify(b.nodes) ? -1 : 1)[0];
    if (!o) break;
    g = react(g, p.rules[0], o, p.sig).state;
    out.push(print(g, p.sig));
  }
  return out;
};

describe('parameters (F107)', () => {
  it('are read where a number is written: rates, guards, reactums, defaults, a world; one made of another, across modules', () => {
    const a = readProgram(withParams, load), b = readProgram(written);
    expect(a.params).toEqual({ grow_by: 2, cap: 10, speed: 0.5, label: 'grown' });
    expect(print(a.world, a.sig)).toBe(print(b.world, b.sig));
    expect(states(a)).toEqual(states(b));
    expect(spots(a.world, a.rules, a.sig).map((s) => s.rate)).toEqual(spots(b.world, b.rules, b.sig).map((s) => s.rate));
  });

  it('are configured when the program is read', () => {
    const a = readProgram(withParams, load, { params: { grow_by: 3, speed: 2.0 } });
    expect(a.params).toEqual({ grow_by: 3, cap: 15, speed: 2.0, label: 'grown' });   // cap follows grow_by
    const w = print(a.world, a.sig);   // a cell's attributes print in the order they were made
    expect(w.match(/max = 15/g)?.length).toBe(2);
    expect(w).toContain('size = 14');
    expect(w).toContain('size = 3');
    expect(spots(a.world, a.rules, a.sig).map((s) => s.rate)).toEqual([4]);
  });

  it('refuse a name no module declares, a value of another kind, and a parameter declared twice', () => {
    expect(() => readProgram(withParams, load, { params: { grwo_by: 3 } })).toThrow(/no parameter grwo_by/);
    expect(() => readProgram(withParams, load, { params: { grow_by: 2.5 } })).toThrow(ReadError);
    expect(() => readProgram(withParams, load, { params: { label: 3 } })).toThrow(/text/);
    files.twice = 'speed = 1.0';
    expect(() => readProgram(withParams.replace('lib = Module["lib"]', 'lib = Module["lib"]\n    twice = Module["twice"]'), load)).toThrow(/declared twice/);
  });

  it('leave a program without them as it was', () => {
    const b = readProgram(written);
    expect(b.params).toEqual({});
  });
});
