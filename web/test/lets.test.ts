import { describe, expect, it } from 'vitest';
import { type Carrier, World, discover, print, react, readProgram, registerNative, spots } from '../src/engine';

/** Each town's values, sorted: a state up to the order its attributes were made in (which `print` keeps). */
const canon = (g: Carrier) =>
  g.nodes
    .filter((n) => n.payload === 'composite')
    .map((n) => g.nodes.filter((c) => 'node' in c.parent && c.parent.node === n.id && typeof c.payload === 'object').map((c) => `${JSON.stringify(c.member)}=${JSON.stringify((c.payload as { scalar: unknown }).scalar)}`).sort().join(' '))
    .sort()
    .concat(g.edges.filter((e) => e.held).map((e) => JSON.stringify(e.held)));

/**
 * F104: values a rule names in its header, `R[x = E] = …` (SYNTAX §7: `tally[g = group[…]] = … => … ?g …`), read as `?x`
 * by its guard, rate, acceptance and reactum, each worked out once where an occurrence's expressions are evaluated.
 * cycle's epidemic repeats one long expression eight times for want of it (F36).
 */
let ticks = 0;
registerNative('tick104', [1, 1], (args, _env, value) => {
  ticks++;
  return value(args[0]);
});

const types = `
    Trade = Type(<: Link)
    Flow[volume :: Int = 0] = Type()
    Town[trade :: Trade * | n :: Int = 10 | immune :: Int = 0 | sick :: Int = 0 | dead :: Int = 0] = Type()`;
const world = `world = (~t :: Trade = Flow[volume = 3] | Town[trade = ~t | n = 12 | immune = 30 | sick = 2] | Town[trade = ~t | n = 4 | immune = 90 | sick = 2] | Town[n = 1 | sick = 2])`;

// the same rule, its values named and written out
const named = `Program(
  module = (${types}
    strike[z = 1.0 - exp[(?i - 100) / 20.0 * (1.0 - exp[(?i - 100) / 20.0])] | dead = floor[0.002 * (100 - ?i) * ?n * ?z] | rate = 1.0 + ?dead / 2.0] =
      ?s = Town[sick = 2 | immune = ?i | n = ?n] where ?dead < ?n
      => ?s = Town[sick = 1 | immune = 100 - floor[(100 - ?i) * ?z] | n = ?n - ?dead | dead = ?dead]
    flow[v = ~t.volume * 2 | rate = 0.5 * ?v] = (~t = Flow[volume = ?u] | ?a = Town[trade = (~t | ?ta) | n = ?n]) where ?v < ?n
      => (~t = Flow[volume = ?v] | ?a = Town[trade = (~t | ?ta) | n = ?n])
  )
  ${world}
)`;
const written = `Program(
  module = (${types}
    strike[rate = 1.0 + floor[0.002 * (100 - ?i) * ?n * (1.0 - exp[(?i - 100) / 20.0 * (1.0 - exp[(?i - 100) / 20.0])])] / 2.0] =
      ?s = Town[sick = 2 | immune = ?i | n = ?n] where floor[0.002 * (100 - ?i) * ?n * (1.0 - exp[(?i - 100) / 20.0 * (1.0 - exp[(?i - 100) / 20.0])])] < ?n
      => ?s = Town[sick = 1 | immune = 100 - floor[(100 - ?i) * (1.0 - exp[(?i - 100) / 20.0 * (1.0 - exp[(?i - 100) / 20.0])])]
        | n = ?n - floor[0.002 * (100 - ?i) * ?n * (1.0 - exp[(?i - 100) / 20.0 * (1.0 - exp[(?i - 100) / 20.0])])]
        | dead = floor[0.002 * (100 - ?i) * ?n * (1.0 - exp[(?i - 100) / 20.0 * (1.0 - exp[(?i - 100) / 20.0])])]]
    flow[rate = 0.5 * ~t.volume * 2] = (~t = Flow[volume = ?u] | ?a = Town[trade = (~t | ?ta) | n = ?n]) where ~t.volume * 2 < ?n
      => (~t = Flow[volume = ~t.volume * 2] | ?a = Town[trade = (~t | ?ta) | n = ?n])
  )
  ${world}
)`;

const rates = (p: ReturnType<typeof readProgram>) => spots(p.world, p.rules, p.sig).map((s) => `${s.rule.name} ${s.occurrences[0].nodes.map(([, n]) => n).join(',')} ${s.rate}`).sort();

describe('values a rule names (F104)', () => {
  it('mean what they name, in the guard, the rate and the reactum', () => {
    const a = readProgram(named), b = readProgram(written);
    expect(rates(a)).toEqual(rates(b));
    expect(rates(a).length).toBe(4);
    for (const name of ['strike', 'flow']) {
      const [ra, rb] = [a.rules.find((r) => r.name === name)!, b.rules.find((r) => r.name === name)!];
      const [oa, ob] = [discover(a.world, ra, a.sig), discover(b.world, rb, b.sig)];
      expect(oa.length).toBe(ob.length);
      for (let i = 0; i < oa.length; i++) {
        expect(canon(react(a.world, ra, oa[i], a.sig).state)).toEqual(canon(react(b.world, rb, ob[i], b.sig).state));
        const w = new World(a.world, a.sig);
        w.apply(ra, oa[i], a.sig, { inPlace: true });
        expect(canon(w.g)).toEqual(canon(react(b.world, rb, ob[i], b.sig).state));
      }
    }
    // a name never read is a label, kept as written
    expect(a.ruleAttrs.get('strike')).toMatchObject({ dead: 'floor[0.002 * (100 - ?i) * ?n * ?z]' });
  });

  it('are each worked out once where an occurrence is evaluated', () => {
    const p = readProgram(`Program(
      module = (${types}
        grow[t = tick104[?n] | rate = ?t + ?t * ?t] = ?s = Town[n = ?n] where ?t < 20 and ?t > 0 => ?s = Town[n = ?t + 1 | dead = ?t * ?t]
      )
      world = (Town[n = 3])
    )`);
    const [o] = discover(p.world, p.rules[0], p.sig);
    ticks = 0;
    spots(p.world, p.rules, p.sig);
    // a full search: the guard (once, for its two reads), then the rate (once, for its three)
    expect(ticks).toBe(2);
    ticks = 0;
    const after = react(p.world, p.rules[0], o, p.sig).state;
    expect(ticks).toBe(1);
    expect(print(after, p.sig)).toMatch(/dead = 9/);
    expect(print(after, p.sig)).toMatch(/n = 4/);
  });

  it('are refused where they name each other, or a name of the redex', () => {
    const rule = (header: string) => `Program(module = (${types}
      r[${header}] = ?s = Town[n = ?n] => ?s = Town[n = ?a]
    ) world = (Town))`;
    expect(() => readProgram(rule('a = ?b + 1 | b = ?a * 2'))).toThrow(/a → b → a name each other/);
    expect(() => readProgram(rule('a = 1 | n = 2'))).toThrow(/\?n is named in the redex and given a value/);
    expect(readProgram(rule('a = ?n + 1 | label = "grow"')).rules[0].computed).toHaveLength(1);
  });
});
