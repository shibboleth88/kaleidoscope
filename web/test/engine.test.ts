import {
  type Carrier,
  type Rule,
  Signature,
  checkRule,
  compose,
  decompose,
  discover,
  formedProblems,
  identity,
  print,
  react,
  readRule,
  readState,
  sameCarrier,
} from '../src/engine';

const sig = Signature.of({
  A: {},
  B: {},
  Star: {},
  Flag: {},
  Box: {},
  Cat: { attrs: { age: 'Int' } },
  Atom: { ports: { b: 'Link' } },
  Ion: { ports: { b: 'Link' } },
  Compartment: {},
  Nucleus: { supers: ['Compartment'] },
});

/** Every occurrence, each checked: its decomposition composes back to the state (`discover_sound`). */
function occurrences(g: Carrier, rule: Rule) {
  expect(checkRule(rule)).toEqual([]);
  const os = discover(g, rule, sig);
  for (const o of os) {
    const { context, met, parameter } = decompose(g, rule, o);
    const back = compose(compose(parameter, met), context);
    expect(sameCarrier(back, g)).toBe(true);
  }
  return os;
}

/** Every distinct state one reaction of the rule reaches, printed. */
function results(state: string, rule: Rule): string[] {
  const g = readState(state, sig);
  const out = new Set<string>();
  for (const o of occurrences(g, rule)) {
    const { state: g2 } = react(g, rule, o);
    expect(formedProblems(g2)).toEqual([]);
    out.add(print(g2, sig));
  }
  return [...out].sort();
}

const rule = (src: string, name = 'r') => readRule(name, src, sig);
const canon = (s: string) => print(readState(s, sig), sig);

describe('text', () => {
  it('reads and prints back, canonically', () => {
    const s = 'Box(B | A | Box(Star)) | Atom[b = ~e] | Atom[b = ~e] | Atom[b = !]';
    const once = canon(s);
    expect(canon(once)).toBe(once);
    expect(canon('Atom[b = !] | Atom[b = ~q] | Box(Box(Star) | A | B) | Atom[b = ~q]')).toBe(once);
  });

  it('reads attributes, keys and scalars', () => {
    expect(canon('Cat[age = 3](name = "tom")')).toBe('Cat[age = 3](name = "tom")');
  });

  it('reads regions and line breaks as merges', () => {
    const g = readState('A\nB || Box(\n  Star\n  A)', sig);
    expect(g.outer.places.length).toBe(2);
    expect(print(g, sig)).toBe('A | B || Box(A | Star)');
  });
});

describe('composition', () => {
  it('has identities on either side', () => {
    const g = readState('Box(A | B) | Atom[b = ~e] | Atom[b = ~e]', sig);
    expect(sameCarrier(compose(g, identity(g.outer)), g)).toBe(true);
    expect(sameCarrier(compose(identity(g.inner), g), g)).toBe(true);
  });
});

describe('reaction', () => {
  it('replaces a node', () => {
    expect(results('A | A | B', rule('A => B'))).toEqual(['A | B | B']);
    expect(discover(readState('A | A | B', sig), rule('A => B'), sig)).toHaveLength(2);
  });

  it('matches siblings in one place only', () => {
    expect(results('Box(A) | B', rule('A | B => Star'))).toEqual([]);
    expect(results('Box(A | B) | B', rule('A | B => Star'))).toEqual(['B | Box(Star)']);
  });

  it('holds exactly what a node without a site holds', () => {
    expect(results('Box(A | B)', rule('Box(A) => Star'))).toEqual([]);
    expect(results('Box(A)', rule('Box(A) => Star'))).toEqual(['Star']);
  });

  it('moves what a site holds', () => {
    expect(results('Box(A | B) | Box()', rule('Box(?x) => Box(Star | ?x)'))).toEqual(['Box | Box(A | B | Star)', 'Box(A | B) | Box(Star)']);
  });

  it('copies a site used twice and drops one never used', () => {
    expect(results('Box(A | Box(B))', rule('Box(A | ?x) => Box(?x) | Box(?x)'))).toEqual(['Box(Box(B)) | Box(Box(B))']);
    expect(results('Box(A | B)', rule('Box(?x) => Box()'))).toEqual(['Box']);
  });

  it('keeps a node by name, and what is beside it', () => {
    const r = rule('?b = Box(A | ?x) => ?b = Box(B | ?x)');
    const g = readState('Box(A | Star)', sig);
    const [o] = occurrences(g, r);
    const { state, transition } = react(g, r, o);
    expect(print(state, sig)).toBe('Box(B | Star)');
    const box = o.nodes.find(([p]) => r.redex.nodes.find((n) => n.id === p)!.type === sig.id('Box'))![1];
    expect(transition.kept).toEqual([box]);
    expect(state.nodes.some((n) => n.id === box)).toBe(true);
    expect(transition.removed).toHaveLength(1);
    expect(transition.created).toHaveLength(1);
  });

  it('meets a subtype, and a kept node keeps the type it was met at', () => {
    const r = rule('?c = Compartment(?x) => ?c = Compartment(Star | ?x)');
    expect(results('Nucleus(A)', r)).toEqual(['Nucleus(A | Star)']);
    expect(results('Nucleus(A)', rule('Compartment(?x) => Compartment(Star | ?x)'))).toEqual(['Compartment(A | Star)']);
  });

  it('reaches attributes by key', () => {
    expect(results('Cat[age = 3]', rule('Cat[age = ?a] => Box(?a)'))).toEqual(['Box(3)']);
    // an attribute is never cut from its node, nor held by an anonymous site
    expect(results('Box[w = 3]', rule('Box(?x) => Star(?x)'))).toEqual([]);
    // a declared attribute left unwritten is met whatever it is, and a kept node keeps it
    expect(results('Cat[age = 3](A)', rule('?c = Cat(A) => ?c = Cat(B)'))).toEqual(['Cat[age = 3](B)']);
  });

  it('is blocked by a negative', () => {
    const r = rule('?c = Cat(?r) => ?c = Cat(Flag() | ?r) unless ?c = Cat(Flag())');
    expect(results('Cat(A) | Cat(Flag() | A)', r)).toEqual(['Cat(A | Flag) | Cat(A | Flag)']);
    expect(discover(readState('Cat(A) | Cat(Flag() | A)', sig), r, sig)).toHaveLength(1);
  });
});

describe('links', () => {
  it('mints a bond between free ports', () => {
    expect(results('Atom[b = !] | Atom[b = !]', rule('Atom[b = !] | Atom[b = !] => Atom[b = ~e] | Atom[b = ~e]'))).toEqual([
      'Atom[b = ~e0] | Atom[b = ~e0]',
    ]);
  });

  it('breaks a closed bond, and meets one only where it is exactly that', () => {
    const r = rule('~e :: Link | Atom[b = ~e] | Atom[b = ~e] => Atom[b = !] | Atom[b = !]');
    expect(results('Atom[b = ~e] | Atom[b = ~e]', r)).toEqual(['Atom[b = !] | Atom[b = !]']);
    expect(results('Atom[b = ~e] | Atom[b = ~e] | Atom[b = ~e]', r)).toEqual([]);
    // an outer name is open: it meets a link with points beside it
    expect(results('Atom[b = ~e] | Atom[b = ~e] | Ion[b = ~e]', rule('Atom[b = ~x] | Atom[b = ~x] => Atom[b = ~x] | Star'))).toEqual([
      'Atom[b = ~e0] | Ion[b = ~e0] | Star',
    ]);
  });

  it('keeps a link a port is not rewritten on', () => {
    // unwritten in the redex: any link; on the kept node in the reactum: that same link
    expect(results('Box(Atom[b = ~e]) | Ion[b = ~e]', rule('Box(?a = Atom) => ?a = Atom'))).toEqual(['Atom[b = ~e0] | Ion[b = ~e0]']);
  });

  it('lets what a site holds keep its links to the context', () => {
    expect(results('Box(Atom[b = ~e]) | Ion[b = ~e]', rule('Box(?x) => Star(?x)'))).toEqual(['Ion[b = ~e0] | Star(Atom[b = ~e0])'])
  });

  it('copies a link inside a copied site, and shares one to outside', () => {
    expect(
      results('Box(Atom[b = ~i] | Ion[b = ~i] | Atom[b = ~o]) | Ion[b = ~o]', rule('Box(?x) => Box(?x) | Box(?x)')),
    ).toEqual(['Box(Atom[b = ~e0] | Atom[b = ~e1] | Ion[b = ~e0]) | Box(Atom[b = ~e2] | Atom[b = ~e1] | Ion[b = ~e2]) | Ion[b = ~e1]']);
  });
});

describe('the tree written back', () => {
  it('reads back as what it was', async () => {
    const { parseRule, parseState, ruleText, stateText } = await import('../src/engine');
    const { mapk } = await import('../src/library');
    const { sig: msig } = await import('../src/systems/mapk');
    const lib = mapk();
    for (const r of lib.rules) {
      const text = ruleText(parseRule(r.text));
      expect(print(readRule('a', text, msig).redex, msig)).toBe(print(readRule('a', r.text, msig).redex, msig));
      expect(print(readRule('a', text, msig).reactum, msig)).toBe(print(readRule('a', r.text, msig).reactum, msig));
      expect(ruleText(parseRule(text))).toBe(text);
    }
    const st = stateText(parseState(lib.states[0].text));
    expect(print(readState(st, msig), msig)).toBe(print(readState(lib.states[0].text, msig), msig));
    expect(ruleText(parseRule('A || B => B || A unless Star'))).toBe('A || B\n  => B || A\n  unless Star');
  });
});
