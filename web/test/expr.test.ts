import { Signature, discover, parseRule, print, react, readRule, readState, ruleText } from '../src/engine';

const sig = Signature.of({
  Cat: { attrs: { age: 'Int' } },
  Cell: { attrs: { mass: 'Float' } },
  Box: {},
  Star: {},
});

function fire(state: string, rule: string): string[] {
  const g = readState(state, sig);
  const r = readRule('r', rule, sig);
  return discover(g, r, sig).map((o) => print(react(g, r, o).state, sig)).sort();
}

describe('computed values', () => {
  it('computes from what a site holds', () => {
    expect(fire('Cat[age = 3]', '?c = Cat[age = ?a] => ?c = Cat[age = ?a + 1]')).toEqual(['Cat[age = 4]']);
    expect(fire('Cell[mass = 3.0]', 'Cell[mass = ?m] => Cell[mass = ?m / 2] | Cell[mass = ?m / 2]')).toEqual(['Cell[mass = 1.5] | Cell[mass = 1.5]']);
  });

  it('keeps whole numbers whole, by the slot', () => {
    expect(fire('Cat[age = 7]', 'Cat[age = ?a] => Cat[age = ?a / 2]')).toEqual(['Cat[age = 3]']);
    expect(fire('Cat[age = 7]', 'Cat[age = ?a] => Cat[age = max[?a - 10 0]]')).toEqual(['Cat[age = 0]']);
  });

  it('meets only where it can compute', () => {
    // ?x holds two things, not one value
    expect(fire('Box(Star | Star)', 'Box(?x) => Cell[mass = ?x * 2]')).toEqual([]);
  });

  it('folds constants in a state', () => {
    expect(print(readState('Cat[age = 2 * 3 + 1]', sig), sig)).toBe('Cat[age = 7]');
  });
});

describe('guards', () => {
  it('meets only where the guard holds', () => {
    expect(fire('Cat[age = 2] | Cat[age = 9]', 'Cat[age = ?a] where ?a >= 5 => Star')).toEqual(['Cat[age = 2] | Star']);
    expect(fire('Cat[age = 2]', 'Cat[age = ?a] where ?a >= 5 or ?a == 2 => Star')).toEqual(['Star']);
  });

  it('counts what a site holds', () => {
    const rule = '?b = Box(?x) where count[?x] < 2 => ?b = Box(?x | Star)';
    expect(fire('Box()', rule)).toEqual(['Box(Star)']);
    expect(fire('Box(Star)', rule)).toEqual(['Box(Star | Star)']);
    expect(fire('Box(Star | Star)', rule)).toEqual([]);
  });
});

describe('expressions as text', () => {
  it('print back as they read, by precedence', () => {
    for (const src of [
      'Cat[age = ?a] where ?a > 1 and not ?a == 3\n  => Cat[age = (?a + 1) * 2]',
      'Cat[age = ?a]\n  => Cat[age = ?a - -1]',
      'Cell[mass = ?m]\n  => Cell[mass = max[?m * 0.5 sqrt[?m]]]',
      'Cat[age = ?a]\n  => Cat[age = ?a - 1 - 1]',
    ])
      expect(ruleText(parseRule(src))).toBe(src);
    // a minus between values is an operator; before a number, a sign
    expect(fire('Cat[age = 5]', 'Cat[age = ?a] => Cat[age = ?a -1]')).toEqual(['Cat[age = 4]']);
  });
});

describe('Growth', () => {
  it('runs: cells eat, grow and divide, and the dish keeps its bounds', async () => {
    const { growth, compile } = await import('../src/library');
    const { rng, step, formedProblems } = await import('../src/engine');
    const lib = growth();
    const c = compile(lib);
    expect([...c.typeErrors]).toEqual([]);
    const rules = lib.rules.map((r) => c.rules.get(r.id)!);
    for (const r of rules) expect(r instanceof Error ? r.message : 'ok').toBe('ok');
    let g = c.states.get(lib.states[0].id) as ReturnType<typeof readState>;
    const random = rng(3);
    const fired = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const s = step(g, rules as never, c.sig, random);
      if (!s) break;
      g = s.state;
      fired.add(s.transition.rule);
      expect(formedProblems(g)).toEqual([]);
      const masses = g.nodes.filter((n) => n.type === c.sig.id('Float')).map((n) => (n.payload as { scalar: { float: number } }).scalar.float);
      for (const m of masses) expect(m).toBeGreaterThan(0);
      expect(g.nodes.filter((n) => n.type !== c.sig.id('Float')).length).toBeLessThanOrEqual(42);
    }
    expect(fired.has('divide') && fired.has('eat') && fired.has('feed')).toBe(true);
  });
});

describe('if, clamp, hypot', () => {
  it('work out', () => {
    expect(fire('Cat[age = 3]', 'Cat[age = ?a] => Cat[age = if[?a > 2 ?a * 10 0]]')).toEqual(['Cat[age = 30]']);
    expect(fire('Cat[age = 3]', 'Cat[age = ?a] => Cat[age = clamp[?a * 10 0 7]]')).toEqual(['Cat[age = 7]']);
    expect(fire('Cell[mass = 1.0]', 'Cell[mass = ?m] => Cell[mass = hypot[3 4 * ?m]]')).toEqual(['Cell[mass = 5.0]']);
    // only the branch taken is worked out
    expect(fire('Cat[age = 0]', 'Cat[age = ?a] => Cat[age = if[?a == 0 1 10 / ?a]]')).toEqual(['Cat[age = 1]']);
  });
});
