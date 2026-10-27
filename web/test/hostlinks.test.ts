// A host reading the values its node's links hold (host.ts `HostCtx.links`, `ReadSet.across[port].held`; F97, F106):
// a native type's read set is the fold over its node's star, the far nodes' attributes and each edge's value.
import { describe, expect, it } from 'vitest';
import { discover, react, readProgram, registerHost } from '../src/engine';

let derivations = 0;
// a stateless host: a cell's load, each contact's strength times the far cell's size, summed over its contacts
registerHost('loaded', {
  reads: { fields: ['size'], across: { touches: { fields: ['size'], held: ['k'] } } },
  derive: {
    load(self, _nodes, ctx) {
      derivations++;
      return ctx.links(self, 'touches').reduce((s, l) => s + Number(l.held.k ?? 1) * l.far.reduce((t, f) => t + Number(ctx.field(f, 'size')), 0), 0);
    },
  },
  methods: { load: { arity: [0, 0], derive: 'load', answer: ({ derived }) => derived as number } },
});

const p = readProgram(`
Program(
  module = (
    Touch = Type(<: Link)
    Bond[k :: Float = 1.0] = Type()
    Cell[size :: Float = 1.0 | touches :: Touch * | seen :: Float = 0.0] = Type[host = "loaded"]()
    look = ?c = Cell[seen = 0.0] => ?c = Cell[seen = ?c.load[]]
    firm[rate = 1.0] = (~t :: Touch = Bond[k = ?k] | ?a = Cell[touches = (~t | ?as)] | ?b = Cell[touches = (~t | ?bs)]) where ?k < 3.0
      => (~t :: Touch = Bond[k = ?k + 1.0] | ?a = Cell[touches = (~t | ?as)] | ?b = Cell[touches = (~t | ?bs)])
  )
  world = (
    ~x :: Touch = Bond[k = 2.0] | ~y :: Touch
    Cell[size = 1.0 | touches = (~x | ~y)] | Cell[size = 5.0 | touches = ~x] | Cell[size = 7.0 | touches = ~y]
  )
)`);
const look = p.rules.find((r) => r.name === 'look')!, firm = p.rules.find((r) => r.name === 'firm')!;
/** what each cell's `look` writes, its load, sorted */
const loads = (g: typeof p.world) =>
  discover(g, look, p.sig).map((o) => react(g, look, o, p.sig).state).map((s) => {
    for (const n of s.nodes) if ('attr' in n.member && n.member.attr && Object.values(n.member.attr)[0] === 'seen' && typeof n.payload === 'object') {
      const v = Object.values(n.payload.scalar)[0] as number;
      if (v) return v;
    }
    return 0;
  }).sort((a, b) => a - b);

describe('a host reads its links\' values', () => {
  it('each link with its far nodes and the fields it holds; the unit holds none', () => {
    // the 1: ~x (k 2) to the 5, ~y (the unit, which holds no k: 1 in the host) to the 7 → 2·5 + 1·7 = 17;
    // the 5: ~x to the 1 → 2; the 7: ~y to the 1 → 1
    expect(loads(p.world)).toEqual([1, 2, 17]);
  });

  it('a link\'s value rewritten makes the host answer again, read by its read set', () => {
    const before = derivations;
    const [o] = discover(p.world, firm, p.sig);
    const g = react(p.world, firm, o, p.sig).state;   // ~x: k 2 → 3
    expect(loads(g)).toEqual([1, 3, 22]);   // 3·5 + 7; the 5's 3·1
    expect(derivations).toBeGreaterThan(before);
  });
});
