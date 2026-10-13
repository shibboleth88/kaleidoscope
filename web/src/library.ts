/**
 * The library: what the world is made of (types), states built from them, and reactions — and the system: one
 * initial state and a chosen set of reactions, running.
 *
 * Entries are kept as text for now (v004, `engine/text.ts`) and compiled to carriers whenever anything changes.
 */

import { BUILTIN, type Carrier, type Rule, Signature, type TypeSpec, checkRule, readRule, readState } from './engine';

export interface StateEntry {
  id: string;
  name: string;
  text: string;
}

export interface RuleEntry extends StateEntry {
  /** A number, or an expression over the redex's sites (`max[count[?x Yang] - 12 0]`), evaluated at each spot. */
  rate: number | string;
}

/** A type: its declaration, one line of text. */
export interface TypeEntry {
  id: string;
  text: string;
}

export interface Library {
  types: TypeEntry[];
  states: StateEntry[];
  rules: RuleEntry[];
  system: {
    initial: string;
    rules: string[];
    seed: number;
    /** How the world plays: a reaction per tick, or reactions spaced by the time they take. */
    pace?: 'steps' | 'time';
  };
}

export interface Compiled {
  sig: Signature;
  /** What is wrong with each type that is wrong. */
  typeErrors: Map<string, string>;
  states: Map<string, Carrier | Error>;
  rules: Map<string, Rule | Error>;
}

/**
 * A type declaration, the structure of one line:
 *   Name                          a type
 *   Name <: Super                 within Super (within Link: a kind of link)
 *   Name[p :: Link | a :: Float]  slots: ports (whose type is a link; `p :: Link * 2` for two points) and attributes
 *   Name {color: "#f80", shape: "torus", sizeBy: "mass"}   how it looks
 */
export interface TypeDef {
  name: string;
  supers: string[];
  slots: { key: string; type: string; arity?: number }[];
  style: Record<string, unknown>;
}

const uncomment = (l: string) => {
  let q = false;
  for (let i = 0; i < l.length; i++) {
    if (l[i] === '"') q = !q;
    else if (l[i] === '#' && !q) return l.slice(0, i);
  }
  return l;
};

export function parseType(text: string): TypeDef {
  const line = uncomment(text).trim();
  const m = /^([A-Za-z_]\w*)\s*(?:\[([^\]]*)\])?\s*(?:<:\s*([\w\s,]+?))?\s*(\{.*\})?$/.exec(line);
  if (!m) throw new Error(`cannot read "${line}": a type is Name[slots] <: Super {style}`);
  const [, name, slots, supers, style] = m;
  const def: TypeDef = { name, supers: supers ? supers.split(',').map((x) => x.trim()).filter(Boolean) : [], slots: [], style: {} };
  for (const slot of (slots ?? '').split('|').map((x) => x.trim()).filter(Boolean)) {
    const sm = /^([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)(?:\s*(\*)\s*(\d+)?)?$/.exec(slot);
    if (!sm) throw new Error(`a slot is "key :: Type", not "${slot}"`);
    // `p :: Link * 2`: two points; `p :: Link *`: any number of points
    def.slots.push({ key: sm[1], type: sm[2], ...(sm[3] ? { arity: sm[4] ? Number(sm[4]) : 0 } : {}) });
  }
  if (style) {
    try {
      def.style = JSON.parse(style.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":'));
    } catch {
      throw new Error('the style should be {key: value, ...}');
    }
  }
  return def;
}

/** A type written back as its line. */
export function typeText(d: TypeDef): string {
  const slots = d.slots.map((x) => `${x.key} :: ${x.type}${x.arity === 0 ? ' *' : x.arity && x.arity > 1 ? ` * ${x.arity}` : ''}`).join(' | ');
  const style = Object.entries(d.style)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
  return `${d.name}${slots ? `[${slots}]` : ''}${d.supers.length ? ` <: ${d.supers.join(', ')}` : ''}${style ? ` {${style}}` : ''}`;
}

/** The signature the declarations make. A slot is a port where its type is a link (Link, or within it). */
export function signatureOf(defs: TypeDef[]): Signature {
  const linkish = new Set(['Link']);
  for (let more = true; more; ) {
    more = false;
    for (const d of defs) if (!linkish.has(d.name) && d.supers.some((x) => linkish.has(x))) linkish.add(d.name), (more = true);
  }
  const specs: Record<string, TypeSpec> = {};
  for (const d of defs) {
    const spec: TypeSpec = { supers: d.supers, ports: {}, attrs: {}, style: d.style };
    if (linkish.has(d.name)) spec.kind = 'link';
    for (const x of d.slots) {
      if (linkish.has(x.type)) spec.ports![x.key] = x.arity !== undefined && x.arity !== 1 ? [x.type, x.arity] : x.type;
      else spec.attrs![x.key] = x.type;
    }
    specs[d.name] = spec;
  }
  return Signature.of(specs);
}

/** Many declarations, a line each (for tests, and libraries written as one text). */
export const readTypes = (src: string): Signature =>
  signatureOf(src.split('\n').filter((l) => uncomment(l).trim()).map(parseType));

export function compile(lib: Library): Compiled {
  const typeErrors = new Map<string, string>();
  const defs: TypeDef[] = [];
  for (const t of lib.types) {
    try {
      defs.push(parseType(t.text));
    } catch (e) {
      typeErrors.set(t.id, (e as Error).message);
    }
  }
  // each type names only types there are; one that names another is let go, and says why
  const known = new Set<string>([...BUILTIN, ...defs.map((d) => d.name)]);
  for (let more = true; more; ) {
    more = false;
    for (const t of lib.types) {
      const d = defs.find((x) => x.name === typeName(t.text));
      if (!d || typeErrors.has(t.id)) continue;
      const missing = [...d.supers, ...d.slots.map((x) => x.type)].find((n) => !known.has(n));
      if (missing) {
        typeErrors.set(t.id, `no type named ${missing}`);
        known.delete(d.name);
        defs.splice(defs.indexOf(d), 1);
        more = true;
      }
    }
  }
  const names = defs.map((d) => d.name);
  for (const t of lib.types) if (!typeErrors.has(t.id) && names.filter((n) => n === typeName(t.text)).length > 1) typeErrors.set(t.id, `${typeName(t.text)} is declared twice`);
  const sig = signatureOf(defs.filter((d, i) => names.indexOf(d.name) === i));
  const states = new Map<string, Carrier | Error>();
  for (const s of lib.states) {
    try {
      states.set(s.id, readState(s.text, sig));
    } catch (e) {
      states.set(s.id, e as Error);
    }
  }
  const rules = new Map<string, Rule | Error>();
  for (const r of lib.rules) {
    try {
      const rule = readRule(r.name, r.text, sig, { rate: r.rate });
      const problems = checkRule(rule);
      rules.set(r.id, problems.length ? new Error(problems.join('; ')) : rule);
    } catch (e) {
      rules.set(r.id, e as Error);
    }
  }
  return { sig, typeErrors, states, rules };
}

/** A type's name, from its line, even a line that does not read. */
export const typeName = (text: string) => /^\s*([A-Za-z_]\w*)/.exec(text)?.[1] ?? '?';

export const uid = () => Math.random().toString(36).slice(2, 9);

export const mapk = (): Library => {
  const rules: RuleEntry[] = [
    { name: 'phosphorylate', rate: 2.0, text: '?m = MEK[e = !] | ERK[s = ! | name = ?n]\n  => ?m = MEK[e = ~b] | pERK[s = ~b | name = ?n]' },
    { name: 'dissociate', rate: 0.5, text: '~b :: Link | ?m = MEK[e = ~b] | ?p = pERK[s = ~b]\n  => ?m = MEK[e = !] | ?p = pERK[s = !]' },
    { name: 'dephosphorylate', rate: 0.4, text: '?k = Nucleus(pERK[s = ! | name = ?n] | ?r)\n  => ?k = Nucleus(ERK[name = ?n] | ?r)' },
    { name: 'erk in', rate: 1.0, text: '?c = Cytoplasm(?e = ERK | ?k = Compartment(?i) | ?o)\n  => ?c = Cytoplasm(?k = Compartment(?e = ERK | ?i) | ?o)' },
    { name: 'erk out', rate: 1.0, text: '?c = Cytoplasm(?k = Compartment(?e = ERK | ?i) | ?o)\n  => ?c = Cytoplasm(?e = ERK | ?k = Compartment(?i) | ?o)' },
    { name: 'perk in', rate: 2.0, text: '?c = Cytoplasm(?e = pERK[s = !] | ?k = Nucleus(?i) | ?o)\n  => ?c = Cytoplasm(?k = Nucleus(?e = pERK | ?i) | ?o)' },
    { name: 'perk out', rate: 0.1, text: '?c = Cytoplasm(?k = Nucleus(?e = pERK[s = !] | ?i) | ?o)\n  => ?c = Cytoplasm(?e = pERK | ?k = Nucleus(?i) | ?o)' },
  ].map((r) => ({ ...r, id: uid() }));
  const cell: StateEntry = {
    id: uid(),
    name: 'cell',
    text: `Cell(Cytoplasm(
  MEK
  MEK
  pERK[name = "erk0"]
  ERK[name = "erk1"]
  ERK[name = "erk2"]
  ERK[name = "erk4"]
  Nucleus()
  ERLumen(ERK[name = "erk3"])))`,
  };
  return {
    types: `Cell {color: "#3d5a80", container: true}
Compartment {container: true}
Cytoplasm <: Compartment {color: "#4a7c8c"}
Nucleus <: Compartment {color: "#8e5bd1"}
ERLumen <: Compartment {color: "#3f8f6a"}
MEK[e :: Link] {color: "#ffb347", shape: "dodecahedron", size: 1.3}
ERK[s :: Link | name :: Text] {color: "#5ec8ff", shape: "octahedron"}
pERK[s :: Link | name :: Text] {color: "#ff5e8a", shape: "icosahedron"}`
      .split('\n')
      .map((text) => ({ id: uid(), text })),
    states: [cell],
    rules,
    system: { initial: cell.id, rules: rules.map((r) => r.id), seed: 7 },
  };
};

/** An empty library: one empty state to begin from. */
export const empty = (): Library => {
  const start: StateEntry = { id: uid(), name: 'start', text: '' };
  return { types: [], states: [start], rules: [], system: { initial: start.id, rules: [], seed: 7 } };
};

/**
 * Growth: cells in a dish eat, grow, and divide. Mass is an attribute the cells are drawn by; food arrives while
 * there is room; a cell heavy enough splits in two, each half the mass. Guards and computed values throughout.
 */
export const growth = (): Library => {
  const rules: RuleEntry[] = [
    { name: 'eat', rate: 1.0, text: '?c = Cell[mass = ?m] | Food\n  => ?c = Cell[mass = ?m + 0.4]' },
    { name: 'divide', rate: 0.8, text: 'Cell[mass = ?m] where ?m >= 2\n  => Cell[mass = ?m / 2] | Cell[mass = ?m / 2]' },
    { name: 'starve', rate: 0.05, text: '?c = Cell[mass = ?m] where ?m > 0.5\n  => ?c = Cell[mass = ?m - 0.25]' },
    { name: 'die', rate: 0.5, text: 'Cell[mass = ?m] where ?m <= 0.5\n  => ()' },
    { name: 'feed', rate: 1.5, text: '?d = Dish(?x) where count[?x] < 40\n  => ?d = Dish(?x | Food)' },
  ].map((r) => ({ ...r, id: uid() }));
  const dish: StateEntry = { id: uid(), name: 'dish', text: 'Dish(\n  Cell[mass = 1.0]\n  Food\n  Food\n  Food)' };
  return {
    types: [
      'Dish {color: "#2c5f74", container: true}',
      'Cell[mass :: Float] {color: "#7be0a0", shape: "sphere", sizeBy: "mass"}',
      'Food {color: "#ffd36e", shape: "tetrahedron", size: 0.45}',
    ].map((text) => ({ id: uid(), text })),
    states: [dish],
    rules,
    system: { initial: dish.id, rules: rules.map((r) => r.id), seed: 11 },
  };
};

/**
 * Ember, moss and mist: three kinds that eat one another round a circle (ember burns moss, moss drinks mist, mist
 * quenches ember), in a pond, and inside one another.
 *
 * - **Only moss grows by itself** (in the light, while the pond has room). Ember and mist live by eating, and a
 *   hunter holding no prey starves.
 * - **Engulf, then digest.** A hunter takes its prey inside itself (up to three at a time), with whatever the prey
 *   holds. Digested, the prey's contents spill into the hunter, and the hunter buds. So a mist that has eaten an
 *   ember holds the moss the ember had eaten: its own hunter, carried inside it until it starves and lets it go.
 * - **Pacts across layers.** A hunter's prey is its hunter's hunter. An ember inside a mist can make a pact (a link,
 *   through the mist's skin) with a moss outside; while it lasts the ember cannot be digested, and the moss comes
 *   for the mist. Once the moss has digested the mist, the ember is inside the moss, still linked to it, and eats
 *   it from within.
 * - **Arrivals.** Now and then one of each drifts into the pond, so no ending is final.
 *
 * Every combination has its own dynamics. Moss alone fills the pond and holds. Ember alone, or mist alone, starves.
 * Ember and moss boom and bust (or ember overgrazes and both crash); mist with moss is eaten; mist with ember eats
 * it out and starves. All three chase one another round: mist booms when ember is high and moss low, ember
 * crashes, moss recovers and eats the mist. Each kind's population, the nesting and the pacts rise and fall.
 */
export const emberMossMist = (): Library => {
  // who eats whom: the hunter, its prey, and the hunter of the hunter (the prey's own prey)
  const circle: [string, string, string][] = [
    ['Ember', 'Moss', 'Mist'],
    ['Moss', 'Mist', 'Ember'],
    ['Mist', 'Ember', 'Moss'],
  ];
  // how keenly each hunts (per pair that could meet)
  // (moss, the one that grows by itself and so is always about, hunts gently; mist, at the top of the chain moss
  // feeds, keenly: an even circle would leave mist no room)
  const hunt: Record<string, number> = { Ember: 0.02, Moss: 0.005, Mist: 0.05 };
  const rules: RuleEntry[] = circle.flatMap(([x, y, z]) => [
    // only moss grows by itself (in the light); ember and mist live by eating
    ...(x === 'Moss' ? [{ name: 'Moss grows', rate: '0.8 * max[1 - count[?s] / 40 0]', text: '?p = Pond(?x = Moss(?i) | ?s)\n  => ?p = Pond(?x = Moss(?i) | Moss | ?s)' }] : []),
    { name: `${x} engulfs ${y}`, rate: hunt[x], text: `?x = ${x}(?i) | ?y = ${y}(?j) where count[?i ${y}] < 3\n  => ?x = ${x}(?i | ?y = ${y}(?j))` },
    { name: `${x} digests ${y}`, rate: 0.5, text: `?x = ${x}(${y}[pact = !](?j) | ?i)\n  => ?x = ${x}(?i | ?j) | ${x}` },
    // moss withers slowly; a hunter holding no prey starves
    x === 'Moss' ? { name: 'Moss withers', rate: 0.05, text: 'Moss(?i)\n  => ?i' } : { name: `${x} starves`, rate: 0.25, text: `${x}(?i) where count[?i ${y}] == 0\n  => ?i` },
    { name: `${x} arrives`, rate: 0.04, text: `?p = Pond(?s)\n  => ?p = Pond(?s | ${x})` },
    {
      name: `${y} in ${x} calls ${z}`,
      rate: 0.005,
      text: `?z = ${z}[pact = !](?k) | ?x = ${x}(?y = ${y}[pact = !](?j) | ?i)\n  => ?z = ${z}[pact = ~b](?k) | ?x = ${x}(?y = ${y}[pact = ~b](?j) | ?i)`,
    },
    {
      name: `${z} comes for ${x}`,
      rate: 2,
      text: `~b :: Link | ?z = ${z}[pact = ~b](?k) | ?x = ${x}(?y = ${y}[pact = ~b](?j) | ?i)\n  => ?z = ${z}[pact = ~b](?k | ?x = ${x}(?y = ${y}[pact = ~b](?j) | ?i))`,
    },
    {
      name: `${y} eats ${z} from within`,
      rate: 1,
      text: `~b :: Link | ?z = ${z}[pact = ~b](?y = ${y}[pact = ~b](?j) | ?k)\n  => ?y = ${y}[pact = !](?j) | ${y} | ?k`,
    },
    {
      name: `${y} and ${z} part`,
      rate: 0.15,
      text: `~b :: Link | ?y = ${y}[pact = ~b](?j) || ?z = ${z}[pact = ~b](?k)\n  => ?y = ${y}[pact = !](?j) || ?z = ${z}[pact = !](?k)`,
    },
  ]).map((r) => ({ ...r, id: uid() }));
  const pond: StateEntry = {
    id: uid(),
    name: 'pond',
    text: `Pond(\n${['Ember', 'Moss', 'Mist'].flatMap((k) => Array.from({ length: 6 }, () => `  ${k}`)).join('\n')})`,
  };
  return {
    types: [
      'Pond {color: "#123247", container: true}',
      'Ember[pact :: Link] {color: "#ff6a3d", container: true}',
      'Moss[pact :: Link] {color: "#7bd389", container: true}',
      'Mist[pact :: Link] {color: "#7fb8ff", container: true}',
    ].map((text) => ({ id: uid(), text })),
    states: [pond],
    rules,
    system: { initial: pond.id, rules: rules.map((r) => r.id), seed: 9, pace: 'time' },
  };
};

/**
 * The lac operon: a gene that is read only when it is needed. `unless` does the work twice:
 * - the gene is transcribed UNLESS a repressor sits on its operator;
 * - a repressor binds the operator UNLESS one already does.
 * Lactose that enters the cell takes repressors (a link), and pulls one off the operator; the gene turns on, makes
 * mRNA, then the enzyme LacZ, which digests the lactose. With the lactose gone, the repressors come free again and
 * the gene goes quiet: induction, then repression, on the timeline.
 */
export const lacOperon = (): Library => {
  const rules: RuleEntry[] = [
    { name: 'transcribe', rate: 1.5, text: '?o = Operon(?x)\n  => ?o = Operon(?x) | mRNA\n  unless ?o = Operon(Repressor)' },
    { name: 'translate', rate: 1.0, text: '?m = mRNA\n  => ?m = mRNA | LacZ' },
    { name: 'mRNA decays', rate: 0.5, text: 'mRNA\n  => ()' },
    { name: 'LacZ decays', rate: 0.08, text: 'LacZ\n  => ()' },
    { name: 'repress', rate: 2.0, text: '?o = Operon(?x) | ?p = Repressor[l = !]\n  => ?o = Operon(?x | ?p = Repressor[l = !])\n  unless ?o = Operon(Repressor)' },
    { name: 'leak', rate: 0.03, text: '?o = Operon(?p = Repressor | ?x)\n  => ?o = Operon(?x) | ?p = Repressor' },
    { name: 'import', rate: 0.8, text: 'Lactose | ?c = Cell(?x)\n  => ?c = Cell(?x | Lactose)' },
    { name: 'induce', rate: 1.5, text: '?p = Repressor[l = !] | ?s = Lactose[r = !]\n  => ?p = Repressor[l = ~b] | ?s = Lactose[r = ~b]' },
    { name: 'derepress', rate: 1.0, text: '?o = Operon(?p = Repressor[l = !] | ?x) | ?s = Lactose[r = !]\n  => ?o = Operon(?x) | ?p = Repressor[l = ~b] | ?s = Lactose[r = ~b]' },
    { name: 'let go', rate: 0.3, text: '~b :: Link | ?p = Repressor[l = ~b] | ?s = Lactose[r = ~b]\n  => ?p = Repressor[l = !] | ?s = Lactose[r = !]' },
    { name: 'digest', rate: 1.2, text: '?z = LacZ | Lactose[r = !]\n  => ?z = LacZ | Glucose' },
    { name: 'burn', rate: 0.5, text: 'Glucose\n  => ()' },
    { name: 'lactose arrives', rate: 0.06, text: '?m = Medium(?x) where count[?x] < 6\n  => ?m = Medium(?x | Lactose | Lactose | Lactose | Lactose)' },
  ].map((r) => ({ ...r, id: uid() }));
  const medium: StateEntry = {
    id: uid(),
    name: 'medium',
    text: `Medium(\n  Cell(Operon(Repressor) | Repressor)\n${Array.from({ length: 12 }, () => '  Lactose').join('\n')})`,
  };
  return {
    types: [
      'Medium {color: "#1d3b57", container: true}',
      'Cell {color: "#2f6d55", container: true}',
      'Operon {color: "#8e5bd1", container: true}',
      'Repressor[l :: Link] {color: "#ff5e7a", shape: "octahedron", size: 1.1}',
      'Lactose[r :: Link] {color: "#f4f1e8", shape: "tetrahedron", size: 0.55}',
      'mRNA {color: "#5ec8ff", shape: "torus", size: 0.8}',
      'LacZ {color: "#ffb347", shape: "dodecahedron"}',
      'Glucose {color: "#ffd36e", shape: "sphere", size: 0.4}',
    ].map((text) => ({ id: uid(), text })),
    states: [medium],
    rules,
    system: { initial: medium.id, rules: rules.map((r) => r.id), seed: 5 },
  };
};

/**
 * Yin and yang: two channels of mutual creation and destruction, a harmonic oscillator. Equilibrium is 12 of each.
 * Yang above it begets Yin, below it unmakes Yin; Yin above it unmakes Yang, below it begets Yang. So
 *   Yin′ ∝ (Yang − 12)   and   Yang′ ∝ −(Yin − 12)
 * as an electric field and its magnetic field: a quarter turn apart, each fastest through equilibrium (where the
 * other is at its height) and still at its own height. The rates are expressions over the halves' counts; the
 * world plays by time, so the rush and the lull are seen.
 *
 * A rule's rate is worked out at each place it can fire. Unmaking "a Yin" can fire at every Yin, so its rate is
 * divided by how many there are: the channel as a whole runs at the rate the equation says.
 */
export const yinYang = (): Library => {
  const rules: RuleEntry[] = [
    {
      name: 'yang begets yin',
      text: '?d = Dark(?x) | ?l = Light(?y)\n  => ?d = Dark(?x | Yin) | ?l = Light(?y)',
      rate: 'max[count[?y Yang] - 12 0] * 0.5',
    },
    {
      name: 'yang unmakes yin',
      text: '?d = Dark(Yin | ?x) | ?l = Light(?y)\n  => ?d = Dark(?x) | ?l = Light(?y)',
      rate: 'max[12 - count[?y Yang] 0] * 0.5 / (count[?x Yin] + 1)',
    },
    {
      name: 'yin unmakes yang',
      text: '?d = Dark(?x) | ?l = Light(Yang | ?y)\n  => ?d = Dark(?x) | ?l = Light(?y)',
      rate: 'max[count[?x Yin] - 12 0] * 0.5 / (count[?y Yang] + 1)',
    },
    {
      name: 'yin begets yang',
      text: '?d = Dark(?x) | ?l = Light(?y)\n  => ?d = Dark(?x) | ?l = Light(?y | Yang)',
      rate: 'max[12 - count[?x Yin] 0] * 0.5',
    },
  ].map((r) => ({ ...r, id: uid() }));
  const taiji: StateEntry = {
    id: uid(),
    name: 'taiji',
    text: `Taiji(\n  Dark(${Array.from({ length: 20 }, () => 'Yin').join(' | ')})\n  Light(${Array.from({ length: 12 }, () => 'Yang').join(' | ')}))`,
  };
  return {
    types: [
      'Taiji {color: "#8a8fb8", container: true}',
      'Dark {color: "#5a5fd6", container: true}',
      'Light {color: "#ffd36e", container: true}',
      'Yin {color: "#2b2d8e", shape: "sphere", size: 0.6}',
      'Yang {color: "#fff4d6", shape: "sphere", size: 0.6}',
    ].map((text) => ({ id: uid(), text })),
    states: [taiji],
    rules,
    system: { initial: taiji.id, rules: rules.map((r) => r.id), seed: 3, pace: 'time' },
  };
};

/**
 * The C. elegans embryo, from the zygote to 28 cells: a port of wyrm (`~/code/wyrm`, its `embryo-mechanics.ys`).
 *
 * Cells have positions and radii (µm) inside a 25 × 15 × 15 µm eggshell, and each divides when its lineage
 * class's period has passed since its birth (wyrm's measured periods, volume shares and axes). A cell's contacts
 * are links (a port of any arity: `contacts :: Link *`); sisters are joined by a Sister link. Contacts form where
 * cells come within reach and part where they drift apart.
 *
 * Mechanics is one rule per cell, `settle`: it moves the cell by the net force from all its contacts at once,
 * folded over the rest of its points (`sum[?ps …]`, `?ps.x` the neighbour's x), wyrm's force law, and then keeps
 * it inside the shell (projected back onto it, as wyrm's `confine`). P2 signals:
 * AB's daughter touching it takes Notch (ABp), EMS touching it takes Wnt, and so divides into MS and E. A link has
 * no direction, so each is one rule.
 *
 * As in wyrm, no rule reads a name: names are written, never read.
 */
export const embryo = (): Library => {
  const S = 0.7937; // the cube root of a half: equal daughters
  const A = ['name', 'founder', 'depth', 'pgen', 'born', 'x', 'y', 'z', 'r', 'signal', 'wnt', 'glp1', 'fate'];
  const cell = (v: Record<string, string | number>, contacts: string, named?: string) =>
    `${named ? `?${named} = ` : ''}Cell[contacts = ${contacts} | ${A.map((k) => `${k} = ${v[k]}`).join(' | ')}]`;
  const mother = (fixed: Record<string, string | number>) =>
    cell({ name: '?n', pgen: '?p', born: '?b', x: '?x', y: '?y', z: '?z', r: '?r', signal: '?s', wnt: '?w', glp1: '?g', fate: '?f', ...fixed }, '?cs', 'm');
  const inEmbryo = (inner: string) => `?e = Embryo[t = ?t](${inner} | ?rest)`;
  // the mother is the first daughter, keeping her contacts; the second starts with only her sister
  const division = (name: string, period: number, before: string, after: [string, string]): RuleEntry => ({
    id: uid(),
    name,
    rate: 8,
    text: `${inEmbryo(before)} where ?t >= ?b + ${period.toFixed(1)}\n  => ~s :: Sister | ${inEmbryo(after.join(' | '))}`,
  });

  // the germline: P_k gives a founder and P_k+1, unequally (wyrm's shares: the founder's part of the volume)
  const stem = (k: number, period: number, share: number, founder: string, fname: string): RuleEntry => {
    const cs = Math.cbrt(share).toFixed(4), cp = Math.cbrt(1 - share).toFixed(4);
    const keep = { pgen: k, born: '?t', y: '?y', signal: 'false', wnt: 'false', glp1: 'false' };
    return division(`P${k} divides`, period, mother({ founder: '"p"', depth: 0, pgen: k }), [
      cell({ ...keep, name: `"${fname}"`, founder: `"${founder}"`, depth: 0, x: `?x - 0.5 * ?r * ${cp}`, z: k === 1 ? '?z - 2.0' : '?z', r: `?r * ${cs}`, fate: `"${fname}"` }, '(?cs | ~s)', 'm'),
      cell({ ...keep, name: `"P${k + 1}"`, founder: '"p"', depth: 0, pgen: k + 1, x: `?x + 0.5 * ?r * ${cs}`, z: '?z', r: `?r * ${cp}`, signal: k === 1 ? 'true' : 'false', fate: '"germline"' }, '~s'),
    ]);
  };

  // a somatic division: two equal daughters along an axis, named by their side
  const soma = (name: string, founder: string, depth: number, period: number, axis: 'x' | 'y', o: { tilt?: number } = {}) => {
    const [s1, s2] = axis === 'x' ? ['a', 'p'] : ['l', 'r'];
    const daughter = (sign: '-' | '+', side: string, contacts: string, named?: string) =>
      cell(
        {
          name: `?n ++ "${side}"`, founder: `"${founder}"`, depth: depth + 1, pgen: '?p', born: '?t',
          x: axis === 'x' ? `?x ${sign} 0.5 * ?r * ${S}` : '?x',
          y: axis === 'y' ? `?y ${sign} 0.5 * ?r * ${S}` : '?y',
          z: sign === '+' && o.tilt ? `?z + ${o.tilt.toFixed(1)}` : '?z',
          r: `?r * ${S}`, signal: 'false', wnt: '?w', glp1: '?g', fate: '?f',
        },
        contacts,
        named,
      );
    return division(name, period, mother({ founder: `"${founder}"`, depth }), [daughter('-', s1, '(?cs | ~s)', 'm'), daughter('+', s2, '~s')]);
  };

  // EMS: with Wnt from P2, MS (anterior) and E; without it, two MS
  const ems = (wnt: boolean): RuleEntry => {
    const d = (sign: '-' | '+', nm: string, founder: string, fate: string, contacts: string, named?: string) =>
      cell({ name: `"${nm}"`, founder: `"${founder}"`, depth: 0, pgen: '?p', born: '?t', x: `?x ${sign} 0.5 * ?r * ${S}`, y: '?y', z: '?z', r: `?r * ${S}`, signal: 'false', wnt: wnt ? 'true' : 'false', glp1: '?g', fate: `"${fate}"` }, contacts, named);
    return division(wnt ? 'EMS divides (Wnt)' : 'EMS divides (no Wnt)', 14.3, mother({ founder: '"ems"', depth: 0, wnt: wnt ? 'true' : 'false' }), [
      d('-', 'MS', 'ms', 'mesoderm', '(?cs | ~s)', 'm'),
      wnt ? d('+', 'E', 'e', 'endoderm', '~s') : d('+', 'MS', 'ms', 'mesoderm', '~s'),
    ]);
  };

  // distance, reach and the pair force (wyrm: k_rep 0.2, k_adh 0.02, adhesion out to 1.2 × the summed radii)
  const D = 'hypot[?ax - ?bx ?ay - ?by ?az - ?bz]';
  const S0 = '(?ra + ?rb)';
  const both = (ps: string, qs: string, extra = '') =>
    `?p = Cell[contacts = ${ps} | x = ?ax | y = ?ay | z = ?az | r = ?ra${extra}] | ?q = Cell[contacts = ${qs} | x = ?bx | y = ?by | z = ?bz | r = ?rb${extra}]`;
  // settle: the net force from every contact, over the rest of the cell's points
  const nd = 'hypot[?x - ?ps.x ?y - ?ps.y ?z - ?ps.z]';
  // (no term starts with a minus: between whitespace-separated values it would read as a subtraction, F34)
  const f = `if[${nd} < ?r + ?ps.r 0.2 * (?r + ?ps.r - ${nd}) if[${nd} < 1.2 * (?r + ?ps.r) 0.02 * (?r + ?ps.r - ${nd}) 0.0]]`;
  const F = (ax: 'x' | 'y' | 'z') => `sum[?ps ${f} * (?${ax} - ?ps.${ax}) / max[${nd} 0.01]]`;
  // the shell: where a point lies within it, shrunk by the cell's radius (1: on its surface)
  const SH = (x: string, y: string, z: string) =>
    `(${x}) * (${x}) / (max[25 - ?r 1] * max[25 - ?r 1]) + (${y}) * (${y}) / (max[15 - ?r 1] * max[15 - ?r 1]) + (${z}) * (${z}) / (max[15 - ?r 1] * max[15 - ?r 1])`;
  // settle moves a cell by its net force, then keeps it inside the shell (wyrm's confine: projected back onto it)
  const step = (ax: 'x' | 'y' | 'z') => `?${ax} + clamp[${F(ax)} (-1.0) 1.0]`;
  const moved = SH(step('x'), step('y'), step('z'));
  const confine = (ax: 'x' | 'y' | 'z') => `if[${moved} <= 1.0 ${step(ax)} (${step(ax)}) / sqrt[${moved}]]`;
  const signal = (name: string, who: string, then: string): RuleEntry => ({
    id: uid(),
    name,
    rate: 2,
    text: `?a = Cell[contacts = (~k | ?as) | ${who}] | ?g = Cell[contacts = (~k | ?gs) | signal = true]\n  => ?a = Cell[contacts = (~k | ?as) | ${then}] | ?g = Cell[contacts = (~k | ?gs) | signal = true]`,
  });

  const rules: RuleEntry[] = [
    { id: uid(), name: 'clock', rate: 4, text: '?e = Embryo[t = ?t](?rest)\n  => ?e = Embryo[t = ?t + 0.25](?rest)' },
    stem(0, 1.0, 0.6, 'ab', 'AB'),
    stem(1, 14.6, 0.55, 'ems', 'EMS'),
    stem(2, 17.5, 0.55, 'c', 'C'),
    stem(3, 23.8, 0.5, 'd', 'D'),
    soma('AB divides', 'ab', 0, 12.5, 'x', { tilt: 2 }),
    soma('AB2 divide (left/right)', 'ab', 1, 12.7, 'y'),
    soma('AB4 divide', 'ab', 2, 15.0, 'x'),
    soma('AB8 divide', 'ab', 3, 16.6, 'x'),
    ems(true),
    ems(false),
    soma('MS divides', 'ms', 0, 17.0, 'x'),
    soma('MS2 divide', 'ms', 1, 21.3, 'x'),
    soma('E divides', 'e', 0, 18.2, 'x'),
    soma('C divides', 'c', 0, 18.3, 'x'),
    soma('C2 divide', 'c', 1, 23.8, 'x'),
    {
      id: uid(),
      name: 'settle',
      rate: 3,
      text: `?p = Cell[contacts = ?ps | x = ?x | y = ?y | z = ?z | r = ?r] where hypot[${F('x')} ${F('y')} ${F('z')}] > 0.05 or ${SH('?x', '?y', '?z')} > 1.001\n  => ?p = Cell[contacts = ?ps | x = ${confine('x')} | y = ${confine('y')} | z = ${confine('z')} | r = ?r]`,
    },
    {
      id: uid(),
      name: 'touch',
      rate: 2,
      text: `${both('?ps', '?qs')} where (?ax < ?bx or ?ax == ?bx and ?ay < ?by) and ${D} < ${S0} and shared[?ps ?qs] == 0\n  => ${both('(?ps | ~c)', '(?qs | ~c)')}`,
    },
    { id: uid(), name: 'part', rate: 2, text: `~c :: Link | ${both('(~c | ?ps)', '(~c | ?qs)')} where ${D} > 1.2 * ${S0}\n  => ${both('?ps', '?qs')}` },
    signal('Notch (ABp)', 'founder = "ab" | depth = 1 | glp1 = false | fate = ?f', 'founder = "ab" | depth = 1 | glp1 = true | fate = "ABp-type"'),
    signal('Wnt (EMS)', 'founder = "ems" | wnt = false', 'founder = "ems" | wnt = true'),
    {
      id: uid(),
      name: 'ABa',
      rate: 1,
      text: '?e = Embryo[t = ?t](?a = Cell[founder = "ab" | depth = 1 | glp1 = false | fate = "AB" | born = ?b] | ?rest) where ?t > ?b + 8\n  => ?e = Embryo[t = ?t](?a = Cell[founder = "ab" | depth = 1 | glp1 = false | fate = "ABa-type" | born = ?b] | ?rest)',
    },
  ];
  const zygote: StateEntry = {
    id: uid(),
    name: 'zygote',
    text: `Embryo[t = 0.0](\n  Cell[name = "P0" | founder = "p" | depth = 0 | pgen = 0 | born = 0.0 | x = 0.0 | y = 0.0 | z = 0.0 | r = 14.0 | signal = false | wnt = false | glp1 = false | fate = "germline"])`,
  };
  return {
    types: [
      'Embryo[t :: Float] {color: "#8a8fb8", container: true, ellipsoid: [25, 15, 15], scale: 0.25}',
      'Cell[contacts :: Link * | name :: Text | founder :: Text | depth :: Int | pgen :: Int | born :: Float | x :: Float | y :: Float | z :: Float | r :: Float | signal :: Bool | wnt :: Bool | glp1 :: Bool | fate :: Text] {shape: "sphere", position: "x y z", radiusBy: "r", colorBy: "founder", label: "name", scale: 0.25, opacity: 0.55}',
      'Sister <: Link {color: "#ffd36e"}',
    ].map((text) => ({ id: uid(), text })),
    states: [zygote],
    rules,
    system: { initial: zygote.id, rules: rules.map((r) => r.id), seed: 1, pace: 'time' },
  };
};

/** The examples that come with it: always loaded fresh, never overwritten. */
export const EXAMPLES: Record<string, () => Library> = {
  MAPK: mapk,
  'ember · moss · mist': emberMossMist,
  Growth: growth,
  'lac operon': lacOperon,
  'yin yang': yinYang,
  'embryo (wyrm)': embryo,
};

/**
 * The shelf: libraries saved by name, and the one being worked on. A saved one saves itself as it is edited;
 * one not saved yet (fresh from an example, or new) is kept in a scratch slot, so a reload loses nothing.
 */
export interface Shelf {
  current: string | null;
  scratch: Library;
  saved: Record<string, Library>;
}

const KEY = 'kaleidoscope.shelf.v1';
const OLD_KEY = 'kaleidoscope.library.v1';

/** A library as stored once, brought up to date. */
export function upgrade(raw: unknown): Library {
  const lib = raw as Library & { types: TypeEntry[] | string };
  // the types were once one text: a line each, now
  if (typeof lib.types === 'string') lib.types = lib.types.split('\n').filter((l) => l.trim()).map((text) => ({ id: uid(), text }));
  return lib as Library;
}

export function loadShelf(): Shelf {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const shelf = JSON.parse(s) as Shelf;
      shelf.scratch = upgrade(shelf.scratch);
      for (const k of Object.keys(shelf.saved)) shelf.saved[k] = upgrade(shelf.saved[k]);
      return shelf;
    }
    const old = localStorage.getItem(OLD_KEY);
    if (old) return { current: null, scratch: upgrade(JSON.parse(old)), saved: {} };
  } catch {
    /* no storage: start fresh */
  }
  return { current: null, scratch: mapk(), saved: {} };
}

export function saveShelf(shelf: Shelf) {
  try {
    localStorage.setItem(KEY, JSON.stringify(shelf));
  } catch {
    /* no storage: the shelf lives for this visit */
  }
}

/** The library being worked on. */
export const working = (shelf: Shelf): Library => (shelf.current && shelf.saved[shelf.current]) || shelf.scratch;
