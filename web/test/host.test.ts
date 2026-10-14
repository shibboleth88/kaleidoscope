// Host types (src/engine/host.ts; wyrm docs/HOST-TYPES.md): a type whose arms a package supplies, its instance a node
// with a public face, its internal state in the host.
import { describe, expect, it } from 'vitest';
import { type Carrier, type Id, World, discover, hostState, readProgram, registerHost, serializeHosts } from '../src/engine';

// a stateless host: a disc of radius r, which reads its neighbours' radii across `nbrs`
let derivations = 0;
registerHost('disc', {
  reads: { fields: ['r'], across: { nbrs: { fields: ['r'] } } },
  derive: {
    disc(self, nodes, ctx) {
      derivations++;
      const r = Number(ctx.field(self, 'r'));
      const rs = ctx.far(self, 'nbrs').map((n) => Number(ctx.field(n, 'r')));
      const extra = nodes.map((n) => Number(ctx.field(n, 'r')));
      return { area: Math.PI * r * r, crowd: [...rs, ...extra].reduce((s, x) => s + x, 0) };
    },
  },
  methods: {
    area: { arity: [0, 0], derive: 'disc', answer: ({ derived }) => (derived as { area: number }).area },
    crowd: { arity: [0, 1], derive: 'disc', answer: ({ derived }) => (derived as { crowd: number }).crowd },
    scaled: { arity: [1, 1], derive: 'disc', answer: ({ derived, args }) => (derived as { area: number }).area * Number(args[0]) },
  },
});

// a stateful host: a bag of numbers. Its face: `put` (a reaction writes it: the host adds it), `n` and `sum` (the host
// writes them), `state` (the channel: a serialized bag, realized). `half[k]` is the k-th half of a division.
type Bag = number[];
registerHost<Bag>('bag', {
  reads: { fields: ['put'], state: true },
  channel: 'state',
  derive: { halves: (self, _n, ctx) => { const b = ctx.state<Bag>(self)!; const h = Math.ceil(b.length / 2); return [b.slice(0, h), b.slice(h)]; } },
  methods: {
    total: { arity: [0, 0], answer: ({ self, ctx }) => ctx.state<Bag>(self)!.reduce((s, x) => s + x, 0) },
    half: { arity: [1, 1], derive: 'halves', answer: ({ derived, args }) => JSON.stringify((derived as Bag[])[Number(args[0])]) },
  },
  make: (self, ctx) => [Number(ctx.field(self, 'put') ?? 0)],
  apply: (s, self, changed, ctx) => (changed.includes('put') ? [...s, Number(ctx.field(self, 'put'))] : s),
  project: (s) => ({ n: s.length, sum: s.reduce((a, x) => a + x, 0) }),
  serialize: (s) => JSON.stringify(s),
  realize: (e) => JSON.parse(e) as Bag,
});

const TEXT = `
Program(
  module = (
    Disc[r :: Float = 1.0 | k :: Float = 0.0 | c :: Float = 0.0 | nbrs :: Link *] = Type[host = "disc"]()
    Bag[put :: Float = 0.0 | n :: Int = 0 | sum :: Float = 0.0 | state :: Text = "" | t :: Int = 0] = Type[host = "bag"]()
    measure = ?d = Disc[k = 0.0 | c = ?c] => ?d = Disc[k = ?d.area[] | c = ?d.crowd[]]
    grow = ?d = Disc[r = ?r | k = ?k] where ?k > 0.0 and ?r < 2.0 => ?d = Disc[r = ?r + 1.0 | k = 0.0]
    pair = (?a = Disc[nbrs = (~l | ?as) | k = ?k] | ?b = Disc[nbrs = (~l | ?bs)]) where ?k == 0.0
      => (?a = Disc[nbrs = (~l | ?as) | k = ?a.crowd[?b]] | ?b = Disc[nbrs = (~l | ?bs)])
    add = ?b = Bag[put = ?p | t = ?t] where ?t < 3 => ?b = Bag[put = ?p + 1.0 | t = ?t + 1]
    split = ?b = Bag[t = 3 | n = ?n | state = ""] where ?n > 1
      => (?b = Bag[t = 4 | n = ?n | state = ?b.half[0]] | Bag[t = 4 | state = ?b.half[1]])
  )
  world = ( Disc[r = 1.0 | nbrs = ~x] | Disc[r = 3.0 | nbrs = ~x] | Bag[put = 5.0] )
)`;

const program = readProgram(TEXT);
const rule = (n: string) => program.rules.find((r) => r.name === n)!;
const of = (w: World, type: string) => w.g.nodes.filter((n) => program.sig.name(n.type) === type).map((n) => n.id);
const field = (w: World, id: Id, k: string) => {
  const c = w.g.nodes.find((n) => 'node' in n.parent && n.parent.node === id && 'attr' in n.member && n.member.attr && 'text' in n.member.attr && n.member.attr.text === k);
  return c && typeof c.payload === 'object' ? Object.values(c.payload.scalar)[0] : undefined;
};
/** Fire a rule wherever it meets, until it meets nowhere (at most n times). */
const run = (w: World, name: string, n = 20) => {
  for (let i = 0; i < n; i++) {
    const occ = discover(w.g, rule(name), program.sig, { index: w.ix })[0];
    if (!occ) return i;
    w.apply(rule(name), occ, program.sig);
  }
  return n;
};

describe('host types', () => {
  it('answer methods dispatched on the receiver, reading across its links what the type declares', () => {
    const w = new World(program.world, program.sig);
    const [a, b] = of(w, 'Disc');
    expect(run(w, 'measure')).toBe(2);
    expect(field(w, a, 'k')).toBeCloseTo(Math.PI);
    expect(field(w, a, 'c')).toBe(3); // its neighbour's radius
    expect(field(w, b, 'c')).toBe(1);
    // a node passed as an argument is read by the same declaration (this host counts it beside its links)
    const w2 = new World(program.world, program.sig);
    expect(run(w2, 'pair', 1)).toBe(1);
    const [p, q] = of(w2, 'Disc').sort((x, y) => Number(field(w2, y, 'k')) - Number(field(w2, x, 'k')));
    expect(field(w2, q, 'k')).toBe(0);
    expect(field(w2, p, 'k')).toBe(2 * Number(field(w2, q, 'r')));
  });

  it('memoise a derivation by what it declared it reads, so it is asked again when, and only when, that changes', () => {
    const w = new World(program.world, program.sig);
    derivations = 0;
    run(w, 'measure');
    const after = derivations;
    expect(after).toBeLessThanOrEqual(2 * 2); // area and crowd share one derivation per disc (matching and firing)
    run(w, 'grow', 1); // a's radius changes: its own derivation, and b's (which reads a's radius), are stale
    const [a, b] = of(w, 'Disc');
    run(w, 'measure');
    expect(field(w, a, 'k')).toBeCloseTo(Math.PI * Number(field(w, a, 'r')) ** 2);
    expect(Number(field(w, b, 'c'))).toBe(Number(field(w, a, 'r')));
  });

  it('keep a stateful instance: made with the world, carried by apply, projected into the face', () => {
    const w = new World(program.world, program.sig);
    const [bag] = of(w, 'Bag');
    expect(hostState<number[]>(w.g, bag)).toEqual([5]);
    expect(field(w, bag, 'n')).toBe(1);
    expect(run(w, 'add')).toBe(3);
    expect(hostState<number[]>(w.g, bag)).toEqual([5, 6, 7, 8]);
    expect(field(w, bag, 'n')).toBe(4);
    expect(field(w, bag, 'sum')).toBe(26);
  });

  it('divide through values: each daughter realized from its half, the channel cleared', () => {
    const w = new World(program.world, program.sig);
    run(w, 'add');
    expect(run(w, 'split')).toBe(1);
    const bags = of(w, 'Bag');
    expect(bags.length).toBe(2);
    expect(bags.map((b) => hostState<number[]>(w.g, b))).toEqual([[5, 6], [7, 8]]);
    expect(bags.map((b) => field(w, b, 'state'))).toEqual(['', '']);
    expect(bags.map((b) => field(w, b, 'sum'))).toEqual([11, 15]);
  });

  it('serialize and realize: a state written whole resumes as an equivalent world', () => {
    const w = new World(program.world, program.sig);
    run(w, 'add');
    run(w, 'split');
    const saved: Carrier = serializeHosts(w.g, w.ix, program.sig);
    const w2 = new World(saved, program.sig);
    const states = (x: World) => of(x, 'Bag').map((b) => hostState<number[]>(x.g, b));
    expect(states(w2)).toEqual(states(w));
    expect(of(w2, 'Bag').map((b) => field(w2, b, 'state'))).toEqual(['', '']);
  });

  it('refuse a method its receiver\'s type has no arm for', () => {
    expect(() => readProgram(TEXT.replace('measure = ?d = Disc[k = 0.0 | c = ?c] => ?d = Disc[k = ?d.area[] | c = ?d.crowd[]]', 'measure = ?d = Bag[n = ?c] => ?d = Bag[n = ?d.area[]]'))).not.toThrow();
    const p = readProgram(TEXT.replace('measure = ?d = Disc[k = 0.0 | c = ?c] => ?d = Disc[k = ?d.area[] | c = ?d.crowd[]]', 'measure = ?d = Bag[sum = ?c] => ?d = Bag[sum = ?d.area[]]'));
    const w = new World(p.world, p.sig);
    const r = p.rules.find((x) => x.name === 'measure')!;
    const occ = discover(w.g, r, p.sig, { index: w.ix });
    expect(occ.length).toBe(0); // the computed value cannot be computed: E-no-arm, so the rule meets nothing
  });
});
