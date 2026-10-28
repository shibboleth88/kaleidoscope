import { describe, expect, it } from 'vitest';
import { Index, discover, print, readProgram, rng, spots } from '../src/engine';
import { quotes } from '../src/engine/match';
import { Reactions, Run } from '../src/engine/reactions';

/**
 * Rule values, native (PROPOSED, `reactions.ts`). The acceptance is reactioncraft's minted life (termlife/test/mint.test.ts,
 * where a runner outside the engine sealed rule values): live only where it acts, a rate per copy, sealed once per
 * structure, refusals with codes; plus what the native form adds: wiring (a value acts where it is wired, not where
 * it is held), the quote (an ordinary rule cannot eat inside a value), and rules that rewrite rule values. Each claim
 * has a control that turns it red.
 */
const types = `
    Wire = Type(<: Link)
    A = Type()
    B = Type()
    C = Type()
    Lhs = Type()
    Rhs = Type()
    Cell[reactions :: Wire] = Type()
    Reaction[at :: Wire | rate :: Float = 1.0] = Type()`;
const program = (rules: string, world: string) => readProgram(`Program(
  module = (${types}
    ${rules}
  )
  world = (${world})
)`);

const AAB = 'Lhs(A | A) | Rhs(B)';

/** Firings of each sealed rule, by its structure, over `n` steps of a seeded run. */
function runFor(r: Run, n: number, seed: number) {
  const random = rng(seed);
  const fired = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const s = r.step(random);
    if (!s) break;
    fired.set(s.transition.rule, (fired.get(s.transition.rule) ?? 0) + 1);
  }
  return fired;
}

describe('a rule value acts where it is wired', () => {
  it('in the place whose reactions link it is on; held but unwired, or wired nowhere, it is matter', () => {
    const p = program('', `~c :: Wire | ~d :: Wire
      Cell[reactions = ~c](A | A | A)
      Reaction[at = ~c | rate = 2.0](${AAB})
      Cell[reactions = ~d](A | A | Reaction[at = !](${AAB}))
      Cell[reactions = !](A | A)`);
    const rx = new Reactions(p.sig);
    rx.scan(p.world);
    expect(rx.met).toEqual(['A | A => B']);
    expect(rx.compiles).toBe(1); // one structure: two values, one compile (to two rules, the value outside its place or in it)
    expect(rx.rules().length).toBe(2);
    const live = spots(p.world, rx.rules(), p.sig);
    // three ways to pick two As in the wired cell; none in the other two cells
    expect(live.length).toBe(3);
    expect(live.every((s) => s.rate === 2)).toBe(true);
    const r = new Run(p);
    const value = (g: typeof p.world) => g.nodes.filter((n) => p.sig.name(n.type) === 'Reaction' && n.ports[0].points.length).map((n) => n.id);
    const ids = (g: typeof p.world) => { const ix = Index.of(g); return value(g).flatMap((id) => ix.subtree(id)).sort(); };
    const before = ids(r.g);
    r.step(rng(1));
    expect(print(r.g, p.sig)).toContain('Cell[reactions = ~e0](A | B)');
    expect(ids(r.g)).toEqual(before); // the value is kept node for node: firing never remakes it
    expect(r.step(rng(2))).toBeNull(); // one A left where it is wired; the others' As are never met
  });

  it('containment wires nothing: a value held in one cell and wired to another acts in the other', () => {
    const p = program('', `~c :: Wire | ~d :: Wire
      Cell[reactions = ~c](A | A | Reaction[at = ~d](${AAB}))
      Cell[reactions = ~d](A | A)`);
    const r = new Run(p);
    r.step(rng(1));
    const out = print(r.g, p.sig);
    expect(out).toMatch(/Cell\[reactions = ~e\d\]\(B\)/); // the cell it is wired to
    expect(out).toMatch(/Cell\[reactions = !\]\(A \| A \| Reaction/); // the cell holding it, untouched
  });

  it('a value held in the place it is wired to acts there (a genome in its cell), deeper in it not yet', () => {
    const p = program('', `~c :: Wire | ~d :: Wire | ~e :: Wire
      Cell[reactions = ~c](A | A | Reaction[at = ~c](${AAB}))
      Cell[reactions = ~d](A | A | Cell[reactions = !](Reaction[at = ~d](${AAB})))
      Cell[reactions = ~e](A | A)`);
    const rx = new Reactions(p.sig);
    rx.scan(p.world);
    const live = spots(p.world, rx.rules(), p.sig);
    expect(live.map((s) => s.rule.name)).toEqual(['Reaction@Cell held: A | A => B']);
  });

  it('each copy wired is its own spot: two copies, twice the spots (control: one copy)', () => {
    const one = program('', `~c :: Wire | Cell[reactions = ~c](A | A) | Reaction[at = ~c](${AAB})`);
    const two = program('', `~c :: Wire | Cell[reactions = ~c](A | A) | Reaction[at = ~c](${AAB}) | Reaction[at = ~c](${AAB})`);
    const count = (p: typeof one) => {
      const rx = new Reactions(p.sig);
      rx.scan(p.world);
      return spots(p.world, rx.rules(), p.sig).reduce((a, s) => a + s.rate, 0);
    };
    expect(count(one)).toBe(1);
    expect(count(two)).toBe(2);
  });
});

describe('the inside of a rule value is quoted', () => {
  const src = (eat: string) => program(eat, `~c :: Wire | Cell[reactions = ~c](A | Reaction[at = !](${AAB}))`);

  it('an ordinary rule eats the A in the cell, never the As in the value (control: without the quote it does)', () => {
    const p = src('eat = A => ()');
    const eat = p.rules[0];
    expect(discover(p.world, eat, p.sig).length).toBe(3); // the engine as it is: every A, two of them inside the value
    new Reactions(p.sig); // names the forms: quotes them
    expect(discover(p.world, eat, p.sig).length).toBe(1);
    quotes.delete(p.sig);
    expect(discover(p.world, eat, p.sig).length).toBe(3);
  });

  it('a rule naming the forms reads and rewrites a value, and the value rewritten is the new structure at once', () => {
    const p = program('mutate[rate = 1.0] = ?l = Lhs(A | ?x) => ?l = Lhs(C | ?x)', `~c :: Wire
      Cell[reactions = ~c](C | A | Reaction[at = ~c | rate = 0.000001](${AAB}))`);
    const r = new Run(p);
    expect(r.reactions.met).toEqual(['A | A => B']);
    const fired = runFor(r, 20, 3);
    expect(fired.get('mutate')).toBe(2); // each A in the value's Lhs, once
    expect(r.reactions.met).toEqual(['A | A => B', 'A | C => B', 'C | C => B']);
    expect(r.live.map((x) => x.name)).toEqual(['mutate', ...['A | A => B', 'A | C => B', 'C | C => B'].flatMap((k) => [`Reaction@Cell: ${k}`, `Reaction@Cell held: ${k}`])]);
    // the cell held C | A: the rewritten value meets it there
    expect(spots(r.g, r.reactions.sealed.get('A | C => B')!, p.sig).length).toBe(0); // the value has moved on to C | C
    expect(print(r.g, p.sig)).toContain('Lhs(C | C)');
  });
});

describe('sealing', () => {
  it('once per structure, whatever the copies; refused values carry a code and stay matter', () => {
    const p = program('', `~c :: Wire
      Cell[reactions = ~c](A | A | B)
      Reaction[at = ~c](${AAB}) | Reaction[at = ~c](${AAB}) | Reaction[at = ~c](Rhs(B) | Lhs(A | A))
      Reaction[at = ~c](Lhs(A) | Rhs(A))
      Reaction[at = ~c](Lhs() | Rhs(B))
      Reaction[at = ~c](Lhs(A))
      Reaction[at = ~c](Lhs(A | Cell[reactions = ~c]) | Rhs(B))
      Reaction[at = ~c](Lhs(B) | Rhs())`);
    const rx = new Reactions(p.sig);
    rx.scan(p.world);
    expect([...rx.sealed.keys()]).toEqual(['A | A => B', 'B => ']);
    expect(rx.compiles).toBe(2);
    expect([...rx.refused.values()].sort()).toEqual(['E-empty', 'E-form', 'E-linked', 'still']);
    // a refused value is never a rule: only the sealed structures have spots, the three copies of A | A => B each one
    const live = spots(p.world, rx.rules(), p.sig);
    expect(live.filter((s) => s.rule.name.endsWith('A | A => B')).length).toBe(3);
    expect(live.filter((s) => s.rule.name.endsWith('B => ')).length).toBe(1);
    // scanning again seals nothing
    expect(rx.scan(p.world)).toEqual([]);
    expect(rx.compiles).toBe(2);
  });

  it("the world's own judgement refuses with its code (minted life's books are the world's, not the language's)", () => {
    const p = program('', `~c :: Wire | Cell[reactions = ~c](A | A) | Reaction[at = ~c](${AAB}) | Reaction[at = ~c](Lhs(A) | Rhs(B | B))`);
    const rx = new Reactions(p.sig, { admit: (s) => (s.rhs.split('|').length > s.lhs.split('|').length ? 'unbalanced' : null) });
    rx.scan(p.world);
    expect([...rx.sealed.keys()]).toEqual(['A | A => B']);
    expect([...rx.refused.entries()]).toEqual([['A => B | B', 'unbalanced']]);
  });
});

describe('a system that makes its own rules', () => {
  // values copied and miscopied by rules that name the forms: the program never writes the rules that come to act
  const rules = `
    copy[rate = 0.5] = ?c = Cell(?r = Reaction[at = ~w](?v) | ?g) => ?c = Cell(?r = Reaction[at = ~w](?v) | Reaction[at = ~w](?v) | ?g)
    lose[rate = 0.4] = ?c = Cell(Reaction(?v) | ?g) => ?c = Cell(?g)
    subA[rate = 0.1] = ?l = Lhs(A | ?x) => ?l = Lhs(C | ?x)
    subC[rate = 0.1] = ?l = Rhs(B | ?x) => ?l = Rhs(C | ?x)
    feedA[rate = 2.0] = ?c = Cell(?g) => ?c = Cell(A | ?g)
    feedC[rate = 1.0] = ?c = Cell(?g) => ?c = Cell(C | ?g)
    invent[rate = 0.05] = ?c = Cell[reactions = ~w](B | ?g) => ?c = Cell[reactions = ~w](Reaction[at = ~w](Lhs(C) | Rhs(B)) | ?g)`;
  const world = `~c :: Wire | ~d :: Wire
    Cell[reactions = ~c](Reaction[at = ~c | rate = 3.0](${AAB}))
    Cell[reactions = ~d](Reaction[at = ~d | rate = 3.0](${AAB}))`;

  it("new structures are sealed as the system makes them, and discovery agrees with a full search at every step", () => {
    const p = program(rules, world);
    const r = new Run(p);
    const random = rng(7);
    const key = (rule: string, nodes: [number, number][]) => `${rule}|${[...nodes].sort((a, b) => a[0] - b[0]).map(([a, b]) => `${a}:${b}`).join(',')}`;
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      if (!r.step(random)) break;
      // every occurrence the run would choose among is one a full search finds, and no more
      const full = spots(r.g, [...p.rules, ...r.reactions.rules()], p.sig).flatMap((s) => s.occurrences.map((o) => key(o.rule, o.nodes))).sort();
      const held = r.spots().flatMap((s) => s.occurrences.map((o) => key(o.rule, o.nodes))).sort();
      expect(held).toEqual(full);
      // and reading only the values a reaction touched misses none: a full read of the state finds nothing new
      const all = new Reactions(p.sig);
      all.scan(r.g);
      expect([...all.sealed.keys()].filter((k) => !r.reactions.sealed.has(k))).toEqual([]);
      checked++;
    }
    expect(checked).toBe(300);
    expect(r.reactions.sealed.size).toBeGreaterThan(2); // more rules act than the program wrote
    expect(r.reactions.compiles).toBe(r.reactions.sealed.size);
  });

  it('a seed makes one run (control: another seed makes another)', () => {
    const go = (seed: number) => {
      const r = new Run(program(rules, world));
      runFor(r, 200, seed);
      return `${print(r.g, r.program.sig)} ${r.reactions.met.join(';')}`;
    };
    expect(go(11)).toBe(go(11));
    expect(go(11)).not.toBe(go(12));
  });
});
