/**
 * Met upward (F85): a later root joined to what is bound only through a node it holds is met from that node, by the
 * link, then upward. It finds exactly the occurrences there are, seeded or not. (Not checked against
 * `discoverReference`: it finds none here, with or without F85, as it does not meet a rest of points.)
 */
import { describe, expect, it } from 'vitest';
import { Index, discover, readProgram } from '../src/engine';

const p = readProgram(`Program(
  module = (
    Adj = Type(<: Link)
    Earth = Type()
    Polity[u :: Int] = Type()
    Cell[adj :: Adj * | h :: Int] = Type()
    annex[rate = 1.0] =
      (~e :: Adj | ?p = Polity[u = ?pu](?c = Cell[adj = (~e | ?ca)] | ?pr) | ?q = Polity[u = ?qu](?d = Cell[adj = (~e | ?da) | h = ?h] | ?qr))
      => (~e :: Adj | ?p = Polity[u = ?pu](?c = Cell[adj = (~e | ?ca)] | ?d = Cell[adj = (~e | ?da) | h = ?h] | ?pr) | ?q = Polity[u = ?qu](?qr))
  )
  world = (Earth(
    Polity[u = 1](Cell[adj = (~a | ~b) | h = 0] | Cell[adj = (~c) | h = 1])
    Polity[u = 2](Cell[adj = (~a) | h = 2])
    Polity[u = 3](Cell[adj = (~b | ~c | ~d) | h = 3])
    Polity[u = 4](Cell[adj = (~d) | h = 4] | Cell[h = 5])
  ))
)`);

/** Each occurrence as the h values of its two cells, attacker first. */
const pairs = (os: { nodes: [number, number][] }[]) => {
  const [rule] = p.rules;
  const h = (id: number) => (p.world.nodes.find((n) => 'node' in n.parent && n.parent.node === id && JSON.stringify(n.member) === '{"attr":{"text":"h"}}')!.payload as { scalar: { int: number } }).scalar.int;
  const cells = rule.redex.nodes.filter((n) => p.sig.name(n.type) === 'Cell').map((n) => n.id);
  return os.map((o) => cells.map((c) => h(new Map(o.nodes).get(c)!)).join('>')).sort();
};

describe('a later root met upward from a linked member (F85)', () => {
  it('finds each adjacency between cells of different polities, each way round', () => {
    const [rule] = p.rules;
    // ~a: h0–h2; ~b: h0–h3; ~c: h1–h3; ~d: h3–h4 (h5 has no link)
    expect(pairs(discover(p.world, rule, p.sig))).toEqual(['0>2', '0>3', '1>3', '2>0', '3>0', '3>1', '3>4', '4>3']);
  });

  it('finds, anchored at any node, exactly the occurrences that meet it', () => {
    const [rule] = p.rules;
    const ix = Index.of(p.world);
    const all = discover(p.world, rule, p.sig);
    for (const n of p.world.nodes) {
      if (typeof n.payload === 'object') continue;
      for (const pn of rule.redex.nodes) {
        if (!p.sig.sub(n.type, pn.type)) continue;
        const anchored = discover(p.world, rule, p.sig, { index: ix, anchor: { pattern: pn.id, state: n.id } });
        const want = all.filter((o) => o.nodes.some(([a, b]) => a === pn.id && b === n.id));
        expect(pairs(anchored)).toEqual(pairs(want));
      }
    }
  });
});
