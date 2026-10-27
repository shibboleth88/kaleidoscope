import { describe, expect, it } from 'vitest';
import {
  type Carrier,
  Discovery,
  type Rule,
  World,
  discover,
  fieldOf,
  parseRule,
  print,
  react,
  readProgram,
  readRule,
  readState,
  ReadError,
  ruleText,
  sameCarrier,
  spotKey,
  spots,
} from '../src/engine';

// F97: links holding values (chrysalis D-every-link-holds-one-value; SYNTAX §8 `~r :: Ref[Cat] = @tom`, §11 `~l = ?v`)

const trade = `
Program(
  module = (
    Trade = Type(<: Link)
    Flow[volume :: Int = 0 | open :: Bool = true] = Type()
    Big = Type(<: Flow)
    Town[trade :: Trade * | wealth :: Int = 0] = Type()
    Hamlet[trade :: Trade *] = Type()

    # a link's value met, read by the guard and the rate, and written anew
    grow[rate = 1.0 + ?v] =
      (~t :: Trade = Flow[volume = ?v] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)]) where ?v < 6
      => (~t :: Trade = Flow[volume = ?v + 1] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
    # a literal field: met only at 3, open; a field left unwritten keeps its value
    shut[rate = 4.0] =
      (~t :: Trade = Flow[volume = 3 | open = true] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
      => (~t :: Trade = Flow[open = false] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
    cut[rate = 1.0] =
      (~t :: Trade = Flow[open = false] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
      => (?a = Town[trade = ?as] | ?b = Town[trade = ?bs])
    # a link made with its value
    found[rate = 0.05] = (?a = Town[trade = ?as] | ?b = Town[trade = ?bs]) where shared[?as ?bs] == 0
      => (~n :: Trade = Flow[volume = 1] | ?a = Town[trade = (?as | ~n)] | ?b = Town[trade = (?bs | ~n)])
    # restated as it was: nothing changes
    touch[rate = 0.3] =
      (~t :: Trade = Flow[volume = ?v] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
      => (~t :: Trade = Flow[volume = ?v] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
    # no pattern on the link: any value, kept
    swap[rate = 0.2] =
      (~t :: Trade | ?a = Town[trade = (~t | ?as) | wealth = ?x] | ?b = Town[trade = (~t | ?bs) | wealth = ?y]) where ?x > ?y
      => (~t :: Trade | ?a = Town[trade = (~t | ?as) | wealth = ?y] | ?b = Town[trade = (~t | ?bs) | wealth = ?x])
    # a fold over a town's links, in a rate and in a guard
    prosper[rate = 0.1 * sum[?ps ~ps.volume]] = ?a = Town[trade = ?ps | wealth = ?w] where ?w < 20
      => ?a = Town[trade = ?ps | wealth = ?w + 1]
    boom = ?a = Town[trade = ?ps | wealth = ?w] where sum[?ps ~ps.volume] >= 9 and ?w < 30
      => ?a = Town[trade = ?ps | wealth = ?w + 10]
    # an open link's value, met and written from one end: the town at the other end reads it in its folds
    levy[rate = 0.3] = (~t = Flow[volume = ?v] | ?h = Hamlet[trade = (~t | ?hs)]) where ?v > 0
      => (~t = Flow[volume = ?v - 1] | ?h = Hamlet[trade = (~t | ?hs)])
    tend[rate = 0.2] = ?h = Hamlet[trade = (~t | ?hs)] where ~t.volume < 4
      => ?h = Hamlet[trade = (~t | ?hs)]
    # a subtype's value meets a pattern of its supertype
    big[rate = 1.0] = (~t :: Trade = Big | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
      => (~t :: Trade = Flow[volume = 0] | ?a = Town[trade = (~t | ?as)] | ?b = Town[trade = (~t | ?bs)])
  )
  world = (
    ~ab :: Trade = Flow[volume = 2] | ~h :: Trade = Flow[volume = 4] | ~bc :: Trade = Big[volume = 7]
    Town[trade = (~ab | ~h)] | Town[trade = (~ab | ~bc)] | Town[trade = ~bc] | Town | Hamlet[trade = ~h]
  )
)`;

const p = readProgram(trade);
const rule = (n: string) => p.rules.find((r) => r.name === n)!;
const volumes = (g: Carrier) => g.edges.map((e) => fieldOf(e.held, 'volume')).filter((v) => v !== null).map((v) => Object.values(v!)[0]).sort();

describe('link values (F97)', () => {
  it('a world declares them, and the printer writes them back', () => {
    const g = p.world;
    expect(volumes(g)).toEqual([2, 4, 7]);
    const text = print(g, p.sig);
    expect(text).toContain(':: Trade = Flow[open = true | volume = 2]');
    expect(text).toContain(':: Trade = Big[open = true | volume = 7]');
    const again = readState(text, p.sig);
    expect(print(again, p.sig)).toBe(text);
    // a link of one point holding a value is named, not free
    const one = readState('~x :: Trade = Flow[volume = 1] | Hamlet[trade = ~x]', p.sig);
    expect(print(one, p.sig)).toBe('~e0 :: Trade = Flow[open = true | volume = 1] | Hamlet[trade = ~e0]');
    expect(print(readState('Hamlet[trade = ~x]', p.sig), p.sig)).toBe('Hamlet[trade = !]');
  });

  it('rules read and print them', () => {
    const src = '~t :: Trade = Flow[volume = ?v] | ?a = Town[trade = (~t | ?as)] where ?v < 6 and ~t.volume > 0\n  => ~t :: Trade = Flow[volume = ?v + 1] | ?a = Town[trade = (~t | ?as)]';
    expect(ruleText(parseRule(src))).toBe(src);
    expect(ruleText(parseRule('(~t = Flow[volume = ?v] | ?h = Hamlet[trade = (~t | ?hs)]) => (~t = Flow | ?h = Hamlet[trade = (~t | ?hs)])'))).toBe(
      '~t = Flow[volume = ?v] | ?h = Hamlet[trade = (~t | ?hs)]\n  => ~t = Flow | ?h = Hamlet[trade = (~t | ?hs)]',
    );
    expect(() => readState('~t = Flow[volume = 1] | Hamlet[trade = ~t]', p.sig)).toThrow(ReadError);
    expect(() => readRule('r', '?h = Hamlet[trade = ?hs] where ~q.volume > 1 => ?h = Hamlet[trade = ?hs]', p.sig)).toThrow(ReadError);
    expect(() => readRule('r', '(~t :: Trade = Flow[volume = ?v] | ?h = Hamlet[trade = (~t | ?v)]) => ?h = Hamlet[trade = ?v]', p.sig)).toThrow(ReadError);
  });

  it('a pattern binds a field, read by the guard and the rate', () => {
    const occ = discover(p.world, rule('grow'), p.sig);
    // ~ab at 2 (both ways round, one event); ~bc holds a Big, within Flow, at 7: the guard refuses it
    expect(occ).toHaveLength(2);
    expect(spots(p.world, [rule('grow')], p.sig).map((s) => s.rate)).toEqual([1 + 2]);
  });

  it('a literal field meets only its value; a type meets its subtypes', () => {
    expect(discover(p.world, rule('shut'), p.sig)).toHaveLength(0);
    const g = readState('~t :: Trade = Flow[volume = 3] | Town[trade = ~t] | Town[trade = ~t]', p.sig);
    expect(discover(g, rule('shut'), p.sig)).toHaveLength(2);
    expect(discover(p.world, rule('big'), p.sig)).toHaveLength(2);
    expect(discover(g, rule('big'), p.sig)).toHaveLength(0);
  });

  it('a pattern with no value meets a link whatever it holds, and keeps it', () => {
    const g = readState('~t :: Trade = Flow[volume = 3] | Town[trade = ~t | wealth = 5] | Town[trade = ~t]', p.sig);
    const [o] = discover(g, rule('swap'), p.sig);
    expect(o).toBeDefined();
    const after = react(g, rule('swap'), o, p.sig).state;
    expect(volumes(after)).toEqual([3]);
  });

  it('a reactum writes a value; restated as it was, nothing is rewritten', () => {
    const [o] = discover(p.world, rule('grow'), p.sig);
    const r = react(p.world, rule('grow'), o, p.sig);
    expect(volumes(r.state)).toEqual([3, 4, 7]);
    expect(r.transition.edgesRevalued).toHaveLength(1);
    const [t] = discover(p.world, rule('touch'), p.sig);
    const r2 = react(p.world, rule('touch'), t, p.sig);
    expect(sameCarrier(r2.state, p.world)).toBe(true);
    expect(r2.transition.edgesRevalued).toBeUndefined();
    // a field left unwritten keeps what the link held
    const g = readState('~t :: Trade = Flow[volume = 3] | Town[trade = ~t] | Town[trade = ~t]', p.sig);
    const s = react(g, rule('shut'), discover(g, rule('shut'), p.sig)[0], p.sig).state;
    expect(print(s, p.sig)).toBe('~e0 :: Trade = Flow[open = false | volume = 3] | Town[trade = ~e0 | wealth = 0] | Town[trade = ~e0 | wealth = 0]');
  });

  it('a link made in a reactum holds its value, its type defaults filling the rest', () => {
    const g = readState('Town | Town', p.sig);
    const [o] = discover(g, rule('found'), p.sig);
    expect(print(react(g, rule('found'), o, p.sig).state, p.sig)).toBe('~e0 :: Trade = Flow[open = true | volume = 1] | Town[trade = ~e0 | wealth = 0] | Town[trade = ~e0 | wealth = 0]');
  });

  it('folds read each point\'s link: a town\'s trade', () => {
    // the first town: ~ab (2) and ~h (4); the second: ~ab (2) and ~bc (7); the third: ~bc (7); the fourth: none
    const rates = spots(p.world, [rule('prosper')], p.sig).map((s) => +s.rate.toFixed(6)).sort((a, b) => a - b);
    expect(rates).toEqual([0.6, 0.7, 0.9]);
    expect(discover(p.world, rule('boom'), p.sig)).toHaveLength(1);
    // the far node's attribute and the link's value, in one fold
    const g = readState('~a :: Trade = Flow[volume = 2] | ~b :: Trade = Flow[volume = 3] | Town[trade = (~a | ~b)] | Town[trade = ~a | wealth = 10] | Town[trade = ~b | wealth = 100]', p.sig);
    const weigh = readRule('weigh', '?t = Town[trade = ?ps | wealth = 0] => ?t = Town[trade = ?ps | wealth = sum[?ps ?ps.wealth * ~ps.volume]]', p.sig);
    const [o] = discover(g, weigh, p.sig);
    expect(print(react(g, weigh, o, p.sig).state, p.sig)).toContain('wealth = 320');
  });

  it('an open link\'s value, met and written from one end', () => {
    const [o] = discover(p.world, rule('levy'), p.sig);
    const r = react(p.world, rule('levy'), o, p.sig);
    expect(volumes(r.state)).toEqual([2, 3, 7]);
    expect(discover(p.world, rule('tend'), p.sig)).toHaveLength(0);
    expect(discover(r.state, rule('tend'), p.sig)).toHaveLength(1);
  });
});

describe('link values in a world, found incrementally (F97)', () => {
  const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
    xs.map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`).sort();

  for (const inPlace of [false, true])
    it(`World.apply is react, and discovery over it a full search, every step${inPlace ? ' (values in place)' : ''}`, () => {
      const world = new World(p.world, p.sig);
      const d = new Discovery(p.rules, p.sig);
      const random = (() => {
        let a = 11;
        return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
      })();
      d.live(world.g);
      const fired = new Set<string>();
      let revaluedEdges = 0;
      for (let step = 0; step < 300; step++) {
        const live = spots(world.g, p.rules, p.sig);
        expect(view(d.live(world.g)), `discovery at step ${step}`).toEqual(view(live));
        if (!live.length) break;
        live.sort((a, b) => p.rules.indexOf(a.rule) - p.rules.indexOf(b.rule) || (spotKey(a.occurrences[0]) < spotKey(b.occurrences[0]) ? -1 : 1));
        const total = live.reduce((x, s) => x + s.rate, 0);
        let u = random() * total;
        let chosen = live[live.length - 1];
        for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
        const occ = chosen.occurrences[Math.floor(random() * chosen.occurrences.length)];
        const ref = react(world.snapshot(), chosen.rule, occ, p.sig, { ids: { node: world.next.node, edge: world.next.edge } });
        const { transition, before } = world.apply(chosen.rule, occ, p.sig, { inPlace });
        if (!inPlace || !transition.revalued?.length) expect(sameCarrier(world.g, ref.state), `state after step ${step} (${chosen.rule.name})`).toBe(true);
        expect(volumes(world.g)).toEqual(volumes(ref.state));
        expect(transition.edgesRevalued ?? []).toEqual(ref.transition.edgesRevalued ?? []);
        revaluedEdges += transition.edgesRevalued?.length ?? 0;
        d.advanceWorld(world, before, transition);
        fired.add(chosen.rule.name);
      }
      expect([...fired].sort()).toEqual(p.rules.map((r) => r.name).sort());
      expect(revaluedEdges).toBeGreaterThan(10);
    });
});
