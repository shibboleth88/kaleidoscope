import { type Carrier, Signature, checkRule, compose, decompose, discover, discoverReference, parseRule, print, react, readRule, readState, ruleText, sameCarrier } from '../src/engine';

const sig = Signature.of({ Cell: { ports: { contacts: ['Link', 0] }, attrs: { x: 'Float' } }, Box: {} });

function run(state: string, rule: string): string[] {
  const g = readState(state, sig);
  const r = readRule('r', rule, sig);
  expect(checkRule(r)).toEqual([]);
  return discover(g, r, sig)
    .map((o) => {
      // each occurrence's decomposition composes back to the state (discover_sound), rests and all
      const { context, met, parameter } = decompose(g, r, o);
      expect(sameCarrier(compose(compose(parameter, met), context), g)).toBe(true);
      return print(react(g, r, o).state, sig);
    })
    .sort();
}

describe('a rest of points', () => {
  it('reads and writes a port of any number of points', () => {
    const g = readState('Cell[contacts = (~a | ~b) | x = 1.0] | Cell[contacts = ~a | x = 2.0] | Cell[contacts = ~b | x = 3.0]', sig);
    expect(print(g, sig)).toBe('Cell[contacts = (~e0 ~e1) | x = 1.0] | Cell[contacts = ~e0 | x = 2.0] | Cell[contacts = ~e1 | x = 3.0]');
    expect(ruleText(parseRule('?p = Cell[contacts = (~c | ?ps)]\n  => ?p = Cell[contacts = ?ps]'))).toBe('?p = Cell[contacts = (~c | ?ps)]\n  => ?p = Cell[contacts = ?ps]');
  });

  it('meets a point among any number, and the rest holds the others', () => {
    const g = readState('Cell[contacts = (~a | ~b | ~c)] | Cell[contacts = ~a] | Cell[contacts = ~b] | Cell[contacts = ~c]', sig);
    const r = readRule('r', '?p = Cell[contacts = (~k | ?ps)] where count[?ps] == 2 => ?p = Cell[contacts = ?ps]', sig);
    // the three-contact cell, once for each of its contacts
    expect(discover(g, r, sig)).toHaveLength(3);
    expect(discover(g, r, sig).map((o) => o.rests![0][1].ports.length)).toEqual([2, 2, 2]);
  });

  it('folds over the far ends', () => {
    expect(run('Cell[contacts = (~a | ~b) | x = 1.0] | Cell[contacts = ~a | x = 2.0] | Cell[contacts = ~b | x = 3.0]', '?p = Cell[contacts = ?ps | x = ?x] where count[?ps] == 2\n  => ?p = Cell[contacts = ?ps | x = sum[?ps ?ps.x]]')).toEqual([
      'Cell[contacts = (~e0 ~e1) | x = 5.0] | Cell[contacts = ~e0 | x = 2.0] | Cell[contacts = ~e1 | x = 3.0]',
    ]);
  });

  it('parts a shared link and keeps the others', () => {
    const part = '~c :: Link | ?p = Cell[contacts = (~c | ?ps) | x = 1.0] | ?q = Cell[contacts = (~c | ?qs) | x = 2.0]\n  => ?p = Cell[contacts = ?ps | x = 1.0] | ?q = Cell[contacts = ?qs | x = 2.0]';
    expect(run('Cell[contacts = (~a | ~b) | x = 1.0] | Cell[contacts = ~a | x = 2.0] | Cell[contacts = ~b | x = 3.0]', part)).toEqual([
      'Cell[contacts = ~e0 | x = 1.0] | Cell[contacts = ~e0 | x = 3.0] | Cell[x = 2.0]',
    ]);
  });

  it('joins two only where they share no link', () => {
    const touch = '?p = Cell[contacts = ?ps | x = 1.0] | ?q = Cell[contacts = ?qs | x = 2.0] where shared[?ps ?qs] == 0\n  => ?p = Cell[contacts = (?ps | ~n) | x = 1.0] | ?q = Cell[contacts = (?qs | ~n) | x = 2.0]';
    expect(run('Cell[contacts = ~a | x = 1.0] | Cell[contacts = ~a | x = 2.0]', touch)).toEqual([]);
    expect(run('Cell[x = 1.0] | Cell[x = 2.0]', touch)).toEqual(['Cell[contacts = ~e0 | x = 1.0] | Cell[contacts = ~e0 | x = 2.0]']);
  });

  it('is symmetric: one rule for a link either way round', () => {
    const near = '?a = Cell[contacts = (~k | ?as) | x = 1.0] | ?b = Cell[contacts = (~k | ?bs) | x = ?y] => ?a = Cell[contacts = (~k | ?as) | x = ?y] | ?b = Cell[contacts = (~k | ?bs) | x = ?y]';
    expect(run('Cell[contacts = ~a | x = 2.0] | Cell[contacts = ~a | x = 1.0]', near)).toEqual(['Cell[contacts = ~e0 | x = 2.0] | Cell[contacts = ~e0 | x = 2.0]']);
  });

  it('the reference matcher has no rests; the compiled one agrees where there are none', () => {
    const g = readState('Cell[contacts = (~a | ~b)] | Cell[contacts = ~a] | Box', sig) as Carrier;
    const r = readRule('r', 'Box => Box | Box', sig);
    expect(discover(g, r, sig).length).toBe(discoverReference(g, r, sig).length);
  });
});
