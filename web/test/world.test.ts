import { describe, expect, it } from 'vitest';
import { type Carrier, Discovery, type Rule, type Signature, World, affine, memberKey, print, react, readProgram, readState, relabel, rng, sameCarrier, spots, spotKey } from '../src/engine';
import { compile, emberMossMist, embryo, growth, lacOperon, mapk, yinYang } from '../src/library';

/** The live spots, as comparable text: rule, spot, rate. */
const view = (xs: { rule: Rule; occurrences: { nodes: [number, number][] }[]; rate: number }[]) =>
  xs
    .map((s) => `${s.rule.name}|${s.occurrences.map((o) => o.nodes.map(([, n]) => n).sort((a, b) => a - b).join(',')).sort()[0]}|${s.occurrences.length}|${s.rate.toFixed(6)}`)
    .sort();

const pools = `
Program(
  module = (
    Count = Type[kind = "int"](<: Int)
    Pool[a :: Count = 0 | b :: Count = 0 | c :: Count = 0] = Type()
    Cell[a :: Count = 0 | b :: Count = 0] = Type()
    Box = Type()
    Tag[n :: Int = 0] = Type()
    Enzyme[n :: Count = 0 | ~gene :: Link] = Type()
    Gene[~product :: Link] = Type()
    catalysed[rate = 0.01 * ?e * ?x] = ?c = Cell[a = ?x | b = ?y](cat = ?k = Enzyme[n = ?e] | ?r)
      => ?c = Cell[a = ?x - 1 | b = ?y + 1](cat = ?k = Enzyme[n = ?e] | ?r)
    convert[rate = 0.5 * ?x] = ?p = Pool[a = ?x | b = ?y] => ?p = Pool[a = ?x - 1 | b = ?y + 1]
    pair[rate = 0.1 * ?y] = ?p = Pool[b = ?y | c = ?z] where ?y >= 2
      => ?p = Pool[b = ?y - 2 | c = ?z + 1]
    pack = (?p = Pool[c = ?z] | ?q = Box(?r)) where ?z >= 2 => (?p = Pool[c = ?z - 2] | ?q = Box(?r | Tag[n = ?z]))
    unpack[rate = 0.2] = ?q = Box(Tag[n = ?n] | ?r) => ?q = Box(?r)
    clone[rate = 0.03] = ?q = Box(?r) where count[?r] < 4 => (?q = Box(?r) | Box(?r))
    twin[rate = 0.05] = ?q = Box(?t = Tag[n = ?n] | ?r) where ?n < 9 => (?q = Box(?t = Tag[n = ?n + 1] | ?r) | Box(Tag[n = ?n]))
  )
  world = (
    Pool[a = 40] | Box | Box(Tag | Tag[n = 3])
    Cell[a = 30](cat = Enzyme[n = 5 | gene = ~g] | Box | Gene[product = ~g])
  )
)`;

function systems(): [string, Signature, Rule[], Carrier][] {
  const out: [string, Signature, Rule[], Carrier][] = [];
  for (const [name, lib, state] of [
    ['MAPK', mapk()],
    ['Growth', growth()],
    ['lac operon', lacOperon()],
    ['yin yang', yinYang()],
    ['embryo', embryo()],
    ['ember moss mist', emberMossMist()],
    ['MAPK, crowded', mapk(), `Cell(Cytoplasm(${Array(8).fill('MEK').join(' | ')} | ${Array(8).fill('ERK[name = "e"]').join(' | ')} | Nucleus(pERK[name = "p"]) | ERLumen()))`],
  ] as [string, ReturnType<typeof mapk>, string?][]) {
    const c = compile(lib);
    out.push([name, c.sig, lib.rules.map((r) => c.rules.get(r.id) as Rule), (state ? readState(state, c.sig) : c.states.get(lib.states[0].id)) as Carrier]);
  }
  const p = readProgram(pools);
  out.push(['pools and boxes (a program)', p.sig, p.rules, p.world]);
  return out;
}

describe('a world: reaction in place', () => {
  for (const [name, sig, rules, start] of systems())
    it(`is react, identities and all, and discovery over it is a full search: ${name}`, () => {
      const world = new World(start);
      const d = new Discovery(rules, sig);
      const random = rng(5);
      d.live(world.g);
      const fired = new Set<string>();
      let steps = 0;
      for (; steps < 250; steps++) {
        const live = spots(world.g, rules, sig);
        expect(view(d.live(world.g)), `discovery at step ${steps}`).toEqual(view(live));
        if (!live.length) break;
        live.sort((a, b) => rules.indexOf(a.rule) - rules.indexOf(b.rule) || (spotKey(a.occurrences[0]) < spotKey(b.occurrences[0]) ? -1 : 1));
        const total = live.reduce((x, s) => x + s.rate, 0);
        let u = random() * total;
        let chosen = live[live.length - 1];
        for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
        const occ = chosen.occurrences[Math.floor(random() * chosen.occurrences.length)];
        const before = world.snapshot();
        const ref = react(before, chosen.rule, occ, sig, { ids: { node: world.next.node, edge: world.next.edge } });
        const { transition, before: was } = world.apply(chosen.rule, occ, sig);
        expect(sameCarrier(world.g, ref.state), `state after step ${steps} (${chosen.rule.name})`).toBe(true);
        d.advanceWorld(world, was, transition);
        fired.add(chosen.rule.name);
      }
      expect(steps).toBeGreaterThan(5);
      // the program exercises every path: counts, moves, drops, copies, fresh nodes
      if (name.startsWith('pools')) expect([...fired].sort()).toEqual(rules.map((r) => r.name).sort());
    });
});

describe('a world: values written in place', () => {
  for (const [name, sig, rules, start] of systems())
    it(`is react up to the identities of the scalars it rewrites, and discovery over it is a full search: ${name}`, () => {
      const world = new World(start);
      const d = new Discovery(rules, sig);
      const random = rng(5);
      d.live(world.g);
      let steps = 0, revalued = 0;
      for (; steps < 250; steps++) {
        const live = spots(world.g, rules, sig);
        expect(view(d.live(world.g)), `discovery at step ${steps}`).toEqual(view(live));
        if (!live.length) break;
        live.sort((a, b) => rules.indexOf(a.rule) - rules.indexOf(b.rule) || (spotKey(a.occurrences[0]) < spotKey(b.occurrences[0]) ? -1 : 1));
        const total = live.reduce((x, s) => x + s.rate, 0);
        let u = random() * total;
        let chosen = live[live.length - 1];
        for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
        const occ = chosen.occurrences[Math.floor(random() * chosen.occurrences.length)];
        const ref = react(world.snapshot(), chosen.rule, occ, sig, { ids: { node: world.next.node, edge: world.next.edge } });
        const { transition, before: was } = world.apply(chosen.rule, occ, sig, { inPlace: true });
        // each scalar rewritten in place is react's fresh one at the same holder and key; all else is identical
        const rename = new Map<number, number>();
        for (const s of transition.revalued ?? []) {
          const n = world.g.nodes.find((x) => x.id === s)!;
          const r = ref.state.nodes.find((x) => JSON.stringify(x.parent) === JSON.stringify(n.parent) && JSON.stringify(x.member) === JSON.stringify(n.member))!;
          rename.set(r.id, s);
        }
        const aligned = relabel(ref.state, (x) => rename.get(x) ?? x, (e) => e);
        expect(sameCarrier(world.g, aligned), `state after step ${steps} (${chosen.rule.name})`).toBe(true);
        revalued += transition.revalued?.length ?? 0;
        d.advanceWorld(world, was, transition);
      }
      expect(steps).toBeGreaterThan(5);
      // where a program rewrites counts, they were rewritten where they stood
      if (name.startsWith('pools')) expect(revalued).toBeGreaterThan(0);
    });
});

describe('a world: an affine count rule applied k times at once', () => {
  const p = readProgram(pools);
  const rule = (n: string) => p.rules.find((r) => r.name === n)!;
  it('recognizes affine rules and refuses the rest', () => {
    expect(affine(rule('convert'))).toEqual([
      { node: expect.any(Number), key: 'a', step: -1 },
      { node: expect.any(Number), key: 'b', step: 1 },
    ]);
    expect(affine(rule('pair'))!.map((s) => [s.key, s.step])).toEqual([['b', -2], ['c', 1]]);
    for (const n of ['pack', 'unpack', 'twin', 'clone']) expect(affine(rule(n)), n).toBeNull();
    // a keyed, linked catalyst read and left as it was: still affine
    expect(affine(rule('catalysed'))!.map((s) => [s.key, s.step])).toEqual([['a', -1], ['b', 1]]);
  });
  it('is the rule applied k times, wherever the end is a state it meets', () => {
    for (const [name, k] of [['convert', 7], ['pair', 3], ['convert', 1], ['catalysed', 9]] as const) {
      const one = new World(p.world), many = new World(p.world);
      // reach a state with b to spare
      for (const w of [one, many]) {
        const o = spots(w.g, [rule('convert')], p.sig)[0].occurrences[0];
        for (let i = 0; i < 20; i++) w.applyRepeated(rule('convert'), o, 1, affine(rule('convert'))!);
      }
      const occ = spots(one.g, [rule(name)], p.sig)[0].occurrences[0];
      for (let i = 0; i < k; i++) one.apply(rule(name), spots(one.g, [rule(name)], p.sig)[0].occurrences[0], p.sig);
      many.applyRepeated(rule(name), occ, k, affine(rule(name))!);
      expect(print(many.g, p.sig), `${name} ×${k}`).toBe(print(one.g, p.sig));
    }
  });
  it('keeps discovery exact', () => {
    const w = new World(p.world);
    const d = new Discovery(p.rules, p.sig);
    d.live(w.g);
    for (let i = 0; i < 30; i++) {
      const occ = spots(w.g, [rule('convert')], p.sig)[0]?.occurrences[0];
      if (!occ) break;
      const { transition, before } = w.applyRepeated(rule('convert'), occ, 1, affine(rule('convert'))!);
      d.advanceWorld(w, before, transition);
      expect(view(d.live(w.g))).toEqual(view(spots(w.g, p.rules, p.sig)));
    }
  });
});

describe('discovery where only counts change: rates worked out again, no search', () => {
  // value-free rules (no guard, no negative, no literal) over a pool, and a guarded one elsewhere
  const src = `
Program(
  module = (
    Count = Type[kind = "int"](<: Int)
    Pool[a :: Count = 0 | b :: Count = 0] = Type()
    Item[w :: Int = 1] = Type()
    Bin = Type()
    flow[rate = 0.3 * ?x] = ?p = Pool[a = ?x | b = ?y] => ?p = Pool[a = ?x - 1 | b = ?y + 1]
    back[rate = 0.1 * ?y] = ?p = Pool[a = ?x | b = ?y] => ?p = Pool[a = ?x + 1 | b = ?y - 1]
    use[rate = 0.01 * ?x * ?w] = (?p = Pool[a = ?x] | ?i = Item[w = ?w]) => (?p = Pool[a = ?x] | ?i = Item[w = ?w])
    take[rate = 0.2] = ?q = Bin(Item[w = ?w] | ?r) where ?w > 0 => ?q = Bin(?r)
  )
  world = (Pool[a = 500 | b = 100] | Item[w = 2] | Item[w = 5] | Bin(Item | Item[w = 3]))
)`;
  it('finds what a full search finds, rates included, after every leap', () => {
    const p = readProgram(src);
    const w = new World(p.world);
    const d = new Discovery(p.rules, p.sig);
    d.live(w.g);
    const random = rng(4);
    for (let i = 0; i < 40; i++) {
      const name = random() < 0.5 ? 'flow' : 'back';
      const rule = p.rules.find((r) => r.name === name)!;
      const occ = spots(w.g, [rule], p.sig)[0]?.occurrences[0];
      if (!occ) continue;
      const k = 1 + Math.floor(random() * 5);
      const { transition, before } = w.applyRepeated(rule, occ, k, affine(rule)!);
      d.advanceValues(w, before, transition, [occ.nodes[0][1]]);
      expect(view(d.live(w.g)), `after leap ${i}`).toEqual(view(spots(w.g, p.rules, p.sig)));
    }
  });
});

describe('discovery where only some counts change: only what reads them is rated again', () => {
  // leaps that each move two of three counts, and readers of each count (with an Item read beside one)
  const src = `
Program(
  module = (
    Count = Type[kind = "int"](<: Int)
    Pool[a :: Count = 0 | b :: Count = 0 | c :: Count = 0] = Type()
    Item[w :: Int = 1] = Type()
    ab[rate = 0.3 * ?x] = ?p = Pool[a = ?x | b = ?y] => ?p = Pool[a = ?x - 1 | b = ?y + 1]
    bc[rate = 0.2 * ?y] = ?p = Pool[b = ?y | c = ?z] => ?p = Pool[b = ?y - 1 | c = ?z + 1]
    ca[rate = 0.1 * ?z] = ?p = Pool[c = ?z | a = ?x] => ?p = Pool[c = ?z - 1 | a = ?x + 1]
    readA[rate = 0.01 * ?x * ?w] = (?p = Pool[a = ?x] | ?i = Item[w = ?w]) => (?p = Pool[a = ?x] | ?i = Item[w = ?w])
    readC[rate = 0.02 * ?z] = (?p = Pool[c = ?z] | ?i = Item[w = ?w]) => (?p = Pool[c = ?z] | ?i = Item[w = ?w])
  )
  world = (Pool[a = 400 | b = 300 | c = 200] | Item[w = 2] | Item[w = 5])
)`;
  it('finds what a full search finds, rates included, after every leap, told which keys changed', () => {
    const p = readProgram(src);
    const w = new World(p.world);
    const d = new Discovery(p.rules, p.sig);
    d.live(w.g);
    const random = rng(6);
    const movers = ['ab', 'bc', 'ca'].map((n) => p.rules.find((r) => r.name === n)!);
    for (let i = 0; i < 60; i++) {
      const rule = movers[Math.floor(random() * 3)];
      const occ = spots(w.g, [rule], p.sig)[0]?.occurrences[0];
      if (!occ) continue;
      const steps = affine(rule)!;
      const { transition, before } = w.applyRepeated(rule, occ, 1 + Math.floor(random() * 4), steps);
      const host = new Map(occ.nodes).get(steps[0].node)!;
      const keys = new Set(steps.map((s) => memberKey({ attr: { text: s.key } })));
      d.advanceValues(w, before, transition, [host], undefined, new Map([[host, keys]]));
      expect(view(d.live(w.g)), `after leap ${i} by ${rule.name}`).toEqual(view(spots(w.g, p.rules, p.sig)));
    }
  });
  it('and told wrongly (only b changed, when c did too), it leaves readC stale: the keys are what decide', () => {
    const p = readProgram(src);
    const w = new World(p.world);
    const d = new Discovery(p.rules, p.sig);
    d.live(w.g);
    const rule = p.rules.find((r) => r.name === 'bc')!;
    const occ = spots(w.g, [rule], p.sig)[0].occurrences[0];
    const steps = affine(rule)!;
    const { transition, before } = w.applyRepeated(rule, occ, 5, steps);
    const host = new Map(occ.nodes).get(steps[0].node)!;
    d.advanceValues(w, before, transition, [host], undefined, new Map([[host, new Set([memberKey({ attr: { text: 'b' } })])]]));
    expect(view(d.live(w.g))).not.toEqual(view(spots(w.g, p.rules, p.sig)));
  });
});

describe('a world resumed from its snapshot', () => {
  // (the live spots taken in the order the search meets them, not sorted: an order the state's history made would show)
  const choose = (w: World, rules: Rule[], sig: Signature, random: () => number) => {
    const live = spots(w.g, rules, sig);
    if (!live.length) return null;
    const total = live.reduce((x, s) => x + s.rate, 0);
    let u = random() * total;
    let chosen = live[live.length - 1];
    for (const s of live) if ((u -= s.rate) < 0) { chosen = s; break; }
    return { rule: chosen.rule, occ: chosen.occurrences[Math.floor(random() * chosen.occurrences.length)] };
  };
  for (const [name, sig, rules, start] of systems())
    it(`goes on as the world that made it does, list for list (F82): ${name}`, () => {
      const world = new World(start, sig), random = rng(7);
      for (let k = 0; k < 120; k++) {
        const c = choose(world, rules, sig, random);
        if (!c) break;
        world.apply(c.rule, c.occ, sig, { inPlace: true });
      }
      // (its next identities carried with it, as a checkpoint carries them: those of nodes since removed stay used)
      const resumed = new World(world.snapshot(), sig), a = rng(11), b = rng(11);
      resumed.next = { ...world.next };
      let steps = 0;
      for (; steps < 120; steps++) {
        const x = choose(world, rules, sig, a), y = choose(resumed, rules, sig, b);
        expect(!!y, `step ${steps}`).toBe(!!x);
        if (!x || !y) break;
        expect(y.rule.name, `step ${steps}`).toBe(x.rule.name);
        expect(y.occ.nodes, `step ${steps} (${x.rule.name})`).toEqual(x.occ.nodes);
        world.apply(x.rule, x.occ, sig, { inPlace: true });
        resumed.apply(y.rule, y.occ, sig, { inPlace: true });
        expect(JSON.stringify(resumed.g), `state after step ${steps} (${x.rule.name})`).toBe(JSON.stringify(world.g));
      }
      expect(steps).toBeGreaterThan(5);
    });
});
