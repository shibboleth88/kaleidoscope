import { Signature, type Carrier, discover, readRule, readState, rng, spots, step } from '../src/engine';
import { compile, yinYang } from '../src/library';

const sig = Signature.of({ Pond: {}, Fish: {}, Shark: {}, Big: { supers: ['Fish'] } });

describe('typed count', () => {
  it('counts what a site holds of a type, subtypes included', () => {
    const g = readState('Pond(Fish | Fish | Big | Shark)', sig);
    const r = readRule('r', '?p = Pond(?x) where count[?x Fish] == 3 and count[?x Shark] == 1 and count[?x] == 4 => ?p = Pond(?x)', sig);
    expect(discover(g, r, sig)).toHaveLength(1);
  });
});

describe('rates as expressions', () => {
  it('weigh each spot by its own rate, and drop spots whose rate is not positive', () => {
    const g = readState('Pond(Fish | Fish | Fish) | Pond(Shark)', sig);
    const r = readRule('r', '?p = Pond(?x) => ?p = Pond(?x | Fish)', sig, { rate: 'count[?x Fish] * 2' });
    const live = spots(g, [r], sig);
    expect(live.map((s) => s.rate)).toEqual([6]); // the shark's pond: rate 0, not a spot
  });

  it('read numbers as numbers and refuse what does not read', () => {
    expect(readRule('r', 'Fish => Shark', sig, { rate: '2.5' }).rate).toBe(2.5);
    expect(() => readRule('r', 'Fish => Shark', sig, { rate: 'count[?nope]' })).toThrow(/rate/);
  });

  it('a rate that cannot be worked out is no spot', () => {
    const g = readState('Pond(Fish)', sig);
    const r = readRule('r', '?p = Pond(?x) => ?p = Pond(?x)', sig, { rate: '1 / (count[?x] - 1)' });
    expect(spots(g, [r], sig)).toEqual([]);
  });
});

describe('yin and yang', () => {
  it('oscillate a quarter turn apart around equilibrium', () => {
    const lib = yinYang();
    const c = compile(lib);
    const rules = lib.rules.map((r) => c.rules.get(r.id));
    for (const r of rules) expect(r instanceof Error ? r.message : 'ok').toBe('ok');
    let g = c.states.get(lib.states[0].id) as Carrier;
    const random = rng(3);
    const n = (t: string) => g.nodes.filter((x) => x.type === c.sig.id(t)).length;
    const yin: number[] = [], yang: number[] = [], dts: number[] = [];
    for (let i = 0; i < 600; i++) {
      const s = step(g, rules as never, c.sig, random);
      if (!s) break;
      g = s.state;
      yin.push(n('Yin') - 12);
      yang.push(n('Yang') - 12);
      dts.push(s.dt);
    }
    const crossings = (xs: number[]) => xs.slice(1).filter((x, i) => Math.sign(x) !== Math.sign(xs[i]) && x !== 0).length;
    expect(crossings(yin)).toBeGreaterThanOrEqual(3);
    expect(crossings(yang)).toBeGreaterThanOrEqual(3);
    // a quarter turn apart: weighted by time, Yin and Yang barely correlate
    let xy = 0, xx = 0, yy = 0;
    yin.forEach((x, i) => ((xy += x * yang[i] * dts[i]), (xx += x * x * dts[i]), (yy += yang[i] * yang[i] * dts[i])));
    expect(Math.abs(xy / Math.sqrt(xx * yy))).toBeLessThan(0.5);
    // and Yin moves fastest near equilibrium: its changes per unit time, near it and near its heights
    const speed = (keep: (y: number) => boolean) => {
      let changes = 0, time = 0;
      for (let i = 1; i < yin.length; i++)
        if (keep(yin[i - 1])) {
          time += dts[i];
          if (yin[i] !== yin[i - 1]) changes++;
        }
      return changes / time;
    };
    const amp = Math.max(...yin.map(Math.abs));
    expect(speed((y) => Math.abs(y) <= 2)).toBeGreaterThan(1.3 * speed((y) => Math.abs(y) >= amp - 2));
  });
});
