import { describe, expect, it } from 'vitest';
import { Discovery, ReadError, print, readProgram, rng, step } from '../src/engine';

const garden = `
Program(
  module = (
    Mass = Type[kind = "float"](<: Float)
    Thing = Type()
    Cell[mass :: Mass = 1.0 | ~bond :: Link] = Type(<: Thing | contents :: Place)
    Food = Type(<: Thing)
    Dish[room :: Int = 3] = Type[color = "#2c5f74"]()
    eat[rate = 2.0 * ?m] =
      (?c = Cell[mass = ?m] | Food) => ?c = Cell[mass = ?m + 0.5]
    divide = Cell[mass = ?m] where ?m >= 2.0
      => (Cell[mass = ?m / 2.0] | Cell[mass = ?m / 2.0])
    feed[rate = 1.0 | label = "feed"] = ?d = Dish[room = ?r](?x) where ?r > 0
      => ?d = Dish[room = ?r - 1](?x | Food)
      unless ?d = Dish(Cell[mass = 3.0])
  )
  world = (
    Dish(Cell | Food | Food)
  )
  run = (seed = 7 | horizon = 10.0)
)`;

describe('programs', () => {
  it('reads types, rules, a world and a run, in v004', () => {
    const p = readProgram(garden);
    expect(p.rules.map((r) => r.name)).toEqual(['eat', 'divide', 'feed']);
    expect(p.run).toEqual({ seed: { int: 7 }, horizon: { float: 10 } });
    expect(p.ruleAttrs.get('feed')).toEqual({ label: '"feed"' });
    expect(p.sig.sub(p.sig.id('Cell'), p.sig.id('Thing'))).toBe(true);
    expect(p.sig.get(p.sig.id('Mass')).kind).toBe('float');
    expect(p.sig.get(p.sig.id('Dish')).style).toEqual({ color: '#2c5f74' });
    // defaults fill what the world leaves unwritten
    const text = print(p.world, p.sig);
    expect(text).toContain('room = 3');
    expect(text).toContain('mass = 1.0');
  });

  it('runs: the rate reads the redex, the guard and the negative hold', () => {
    const p = readProgram(garden);
    let g = p.world;
    const random = rng(1);
    const d = new Discovery(p.rules, p.sig);
    for (let i = 0; i < 40; i++) {
      const s = step(g, p.rules, p.sig, random, d);
      if (!s) break;
      g = s.state;
    }
    const text = print(g, p.sig);
    expect(text).toContain('room = 0');
    expect(text).not.toContain('Food');
  });

  it('loads modules, once each', () => {
    const files: Record<string, string> = {
      'chem': 'atoms = Module["atoms"]\nMolecule = Type(<: Atom)\nbond = (Atom | Atom) => Molecule',
      'atoms': 'Atom = Type()',
    };
    const p = readProgram('Program(module = (chem = Module["chem"] | again = Module["atoms"]) | world = (Atom | Atom))', (x) => files[x]);
    expect(p.types.map((t) => [t.name, t.module])).toEqual([['Molecule', 'chem'], ['Atom', 'atoms']]);
    expect(p.rules.map((r) => r.name)).toEqual(['bond']);
  });

  it('refuses what it cannot read, saying where', () => {
    expect(() => readProgram('Program(module = (T = Type(x :: Nope)))')).not.toThrow();
    expect(() => readProgram('Program(module = (T[x :: Nope] = Type()))')).toThrow(ReadError);
    expect(() => readProgram('Program(module = (r = A => B | r = A => B))')).toThrow(/declared twice|no type/);
    expect(() => readProgram('Program(stuff = ())')).toThrow(/module, world and run/);
  });
});
