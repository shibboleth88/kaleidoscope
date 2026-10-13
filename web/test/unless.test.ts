import { Signature, checkRule, discover, parseRule, readRule, readState, ruleText } from '../src/engine';

const sig = Signature.of({
  Room: {},
  Cat: {},
  Dog: {},
  Collar: { attrs: { color: 'Text' }, ports: { tag: 'Link' } },
  Tag: { ports: { t: 'Link' } },
  Flag: {},
});

const count = (state: string, rule: string) => {
  const r = readRule('r', rule, sig);
  expect(checkRule(r)).toEqual([]);
  return discover(readState(state, sig), r, sig).length;
};

describe('unless', () => {
  it('blocks where its addition is there', () => {
    const rule = '?c = Cat(?x) => ?c = Cat(?x | Flag) unless ?c = Cat(Flag)';
    expect(count('Cat() | Cat(Flag)', rule)).toBe(1);
  });

  it('meets what it adds whatever its attributes and links (a provisional extension)', () => {
    const rule = '?c = Cat(?x) => ?c = Cat(?x) unless ?c = Cat(Collar)';
    expect(count('Cat(Collar[color = "red"])', rule)).toBe(0);
    expect(count('Cat(Collar[color = "red" | tag = ~e]) | Tag[t = ~e]', rule)).toBe(0);
    expect(count('Cat(Dog)', rule)).toBe(1);
    // and can still ask for exactly a value
    const red = '?c = Cat(?x) => ?c = Cat(?x) unless ?c = Cat(Collar[color = "red"])';
    expect(count('Cat(Collar[color = "blue"])', red)).toBe(1);
    expect(count('Cat(Collar[color = "red"])', red)).toBe(0);
  });

  it('blocks by any one clause; all of one clause must be there', () => {
    const either = '?r = Room(?x) => ?r = Room(?x | Flag) unless ?r = Room(Cat) unless ?r = Room(Dog)';
    expect(count('Room(Cat) | Room(Dog) | Room()', either)).toBe(1);
    const both = '?r = Room(?x) => ?r = Room(?x | Flag) unless ?r = Room(Cat | Dog)';
    expect(count('Room(Cat) | Room(Dog) | Room(Cat | Dog)', both)).toBe(2);
  });

  it('can say what is linked to what', () => {
    // unless the cat wears a collar whose tag is linked to the Tag beside it: the link named in the redex
    const rule = '?c = Cat(?x) | ?t = Tag[t = ~l] => ?c = Cat(?x) | ?t = Tag[t = ~l] unless ?c = Cat(Collar[tag = ~l])';
    expect(count('Cat(Collar[tag = ~e]) | Tag[t = ~e]', rule)).toBe(0);
    expect(count('Cat(Collar[tag = ~e]) | Tag[t = ~e] | Tag', rule)).toBe(1);
    // the redex's own ports are not the negative's to say
    expect(() => readRule('r', '?t = Tag => ?t = Tag unless ?t = Tag[t = ~l]', sig)).toThrow(/only adds/);
  });

  it('writes back as it reads', () => {
    const src = '?r = Room(?x)\n  => ?r = Room(?x | Flag)\n  unless ?r = Room(Cat)\n  unless ?r = Room(Dog | Flag)';
    expect(ruleText(parseRule(src))).toBe(src);
  });
});

it('refuses an unless that adds nothing', () => {
  const r = readRule('r', '?c = Cat(?x) => ?c = Cat(?x | Flag) unless ?c = Cat()', sig);
  expect(checkRule(r).join()).toMatch(/adds nothing/);
});
