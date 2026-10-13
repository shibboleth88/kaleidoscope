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
    const sm = /^([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)(?:\s*\*\s*(\d+))?$/.exec(slot);
    if (!sm) throw new Error(`a slot is "key :: Type", not "${slot}"`);
    def.slots.push({ key: sm[1], type: sm[2], ...(sm[3] ? { arity: Number(sm[3]) } : {}) });
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
  const slots = d.slots.map((x) => `${x.key} :: ${x.type}${x.arity && x.arity > 1 ? ` * ${x.arity}` : ''}`).join(' | ');
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
      if (linkish.has(x.type)) spec.ports![x.key] = x.arity && x.arity > 1 ? [x.type, x.arity] : x.type;
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
 * class's period has passed since its birth (wyrm's measured periods, volume shares and axes). Contacts are
 * nodes joining two cells' identity links (a cell has as many contacts as it touches, which a port of fixed arity
 * cannot hold); daughters are joined by a Sister contact. Contacts form where cells come within reach and part
 * where they drift apart. Mechanics is pairwise: each contact pushes its two cells apart where they overlap and
 * draws them together where they are near, one reaction at a time (wyrm sums forces over neighbours per tick; a
 * one-reaction-at-a-time engine relaxes contact by contact instead). P2 signals: AB's daughter touching it takes
 * Notch (ABp), EMS touching it takes Wnt, and so divides into MS and E.
 *
 * As in wyrm, no rule reads a name: names are written, never read.
 */
export const embryo = (): Library => {
  const S = 0.7937; // the cube root of a half: equal daughters
  const A = ['name', 'founder', 'depth', 'pgen', 'born', 'x', 'y', 'z', 'r', 'signal', 'wnt', 'glp1', 'fate'];
  const cell = (v: Record<string, string | number>, id: string, named?: string) =>
    `${named ? `?${named} = ` : ''}Cell[id = ~${id} | ${A.map((k) => `${k} = ${v[k]}`).join(' | ')}]`;
  const mother = (fixed: Record<string, string | number>) =>
    cell({ name: '?n', pgen: '?p', born: '?b', x: '?x', y: '?y', z: '?z', r: '?r', signal: '?s', wnt: '?w', glp1: '?g', fate: '?f', ...fixed }, 'i', 'm');
  const inEmbryo = (inner: string) => `?e = Embryo[t = ?t](${inner} | ?rest)`;
  const division = (name: string, period: number, before: string, after: string[]): RuleEntry => ({
    id: uid(),
    name,
    rate: 8,
    text: `${inEmbryo(before)} where ?t >= ?b + ${period.toFixed(1)}
  => ${inEmbryo([...after, 'Sister[a = ~i | b = ~d]'].join(' | '))}`,
  });

  // the germline: P_k gives a founder and P_k+1, unequally (wyrm's shares: the founder's part of the volume)
  const stem = (k: number, period: number, share: number, founder: string, fname: string): RuleEntry => {
    const cs = Math.cbrt(share).toFixed(4), cp = Math.cbrt(1 - share).toFixed(4);
    const keep = { pgen: k, born: '?t', y: '?y', signal: 'false', wnt: 'false', glp1: 'false' };
    return division(`P${k} divides`, period, mother({ founder: '"p"', depth: 0, pgen: k }), [
      cell({ ...keep, name: `"${fname}"`, founder: `"${founder}"`, depth: 0, x: `?x - 0.5 * ?r * ${cp}`, z: k === 1 ? '?z - 2.0' : '?z', r: `?r * ${cs}`, fate: `"${fname}"` }, 'i', 'm'),
      cell({ ...keep, name: `"P${k + 1}"`, founder: '"p"', depth: 0, pgen: k + 1, x: `?x + 0.5 * ?r * ${cs}`, z: '?z', r: `?r * ${cp}`, signal: k === 1 ? 'true' : 'false', fate: '"germline"' }, 'd'),
    ]);
  };

  // a somatic division: two equal daughters along an axis, named by their side
  const soma = (name: string, founder: string, depth: number, period: number, axis: 'x' | 'y', o: { tilt?: number; sides?: [string, string] } = {}) => {
    const [s1, s2] = o.sides ?? (axis === 'x' ? ['a', 'p'] : ['l', 'r']);
    const daughter = (sign: '-' | '+', side: string, id: string, named?: string) =>
      cell(
        {
          name: `?n ++ "${side}"`, founder: `"${founder}"`, depth: depth + 1, pgen: '?p', born: '?t',
          x: axis === 'x' ? `?x ${sign} 0.5 * ?r * ${S}` : '?x',
          y: axis === 'y' ? `?y ${sign} 0.5 * ?r * ${S}` : '?y',
          z: sign === '+' && o.tilt ? `?z + ${o.tilt.toFixed(1)}` : '?z',
          r: `?r * ${S}`, signal: 'false', wnt: '?w', glp1: '?g', fate: '?f',
        },
        id,
        named,
      );
    return division(name, period, mother({ founder: `"${founder}"`, depth }), [daughter('-', s1, 'i', 'm'), daughter('+', s2, 'd')]);
  };

  // EMS: with Wnt from P2, MS (anterior) and E; without it, two MS
  const ems = (wnt: boolean): RuleEntry => {
    const d = (sign: '-' | '+', nm: string, founder: string, fate: string, id: string, named?: string) =>
      cell({ name: `"${nm}"`, founder: `"${founder}"`, depth: 0, pgen: '?p', born: '?t', x: `?x ${sign} 0.5 * ?r * ${S}`, y: '?y', z: '?z', r: `?r * ${S}`, signal: 'false', wnt: wnt ? 'true' : 'false', glp1: '?g', fate: `"${fate}"` }, id, named);
    return division(wnt ? 'EMS divides (Wnt)' : 'EMS divides (no Wnt)', 14.3, mother({ founder: '"ems"', depth: 0, wnt: wnt ? 'true' : 'false' }), [
      d('-', 'MS', 'ms', 'mesoderm', 'i', 'm'),
      wnt ? d('+', 'E', 'e', 'endoderm', 'd') : d('+', 'MS', 'ms', 'mesoderm', 'd'),
    ]);
  };

  const D = 'hypot[?ax - ?bx ?ay - ?by ?az - ?bz]';
  const S0 = '(?ra + ?rb)';
  const pair = (contact: boolean) =>
    `${contact ? '?c = Contact[a = ~i | b = ~j] | ' : ''}?p = Cell[id = ~i | x = ?ax | y = ?ay | z = ?az | r = ?ra] | ?q = Cell[id = ~j | x = ?bx | y = ?by | z = ?bz | r = ?rb]`;
  const moved = (f: string) =>
    `?c = Contact[a = ~i | b = ~j] | ?p = Cell[id = ~i | x = ?ax + ${f} * (?ax - ?bx) | y = ?ay + ${f} * (?ay - ?by) | z = ?az + ${f} * (?az - ?bz) | r = ?ra]` +
    ` | ?q = Cell[id = ~j | x = ?bx - ${f} * (?ax - ?bx) | y = ?by - ${f} * (?ay - ?by) | z = ?bz - ${f} * (?az - ?bz) | r = ?rb]`;
  const still = '?p = Cell[id = ~i | x = ?ax | y = ?ay | z = ?az | r = ?ra] | ?q = Cell[id = ~j | x = ?bx | y = ?by | z = ?bz | r = ?rb]';
  const signal = (name: string, who: string, then: string, flip: boolean): RuleEntry => {
    const link = flip ? 'Contact[a = ~j | b = ~i]' : 'Contact[a = ~i | b = ~j]';
    return { id: uid(), name, rate: 2, text: `?a = Cell[id = ~i | ${who}] | ?c = ${link} | ?g = Cell[id = ~j | signal = true]
  => ?a = Cell[id = ~i | ${then}] | ?c = ${link} | ?g = Cell[id = ~j | signal = true]` };
  };
  const SH = '?x * ?x / (max[25 - ?r 1] * max[25 - ?r 1]) + ?y * ?y / (max[15 - ?r 1] * max[15 - ?r 1]) + ?z * ?z / (max[15 - ?r 1] * max[15 - ?r 1])';

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
    { id: uid(), name: 'push apart', rate: 3, text: `${pair(true)} where ${D} < ${S0}
  => ${moved(`clamp[0.15 * (${S0} - ${D}) 0 0.6] / max[${D} 0.01]`)}` },
    { id: uid(), name: 'hold together', rate: 3, text: `${pair(true)} where ${D} >= ${S0} and ${D} < 1.2 * ${S0}
  => ${moved(`-clamp[0.05 * (${D} - ${S0}) 0 0.6] / max[${D} 0.01]`)}` },
    {
      id: uid(),
      name: 'touch',
      rate: 2,
      text: `${pair(false)} where (?ax < ?bx or ?ax == ?bx and ?ay < ?by) and ${D} < ${S0}
  => ${still} | Contact[a = ~i | b = ~j]
  unless Contact[a = ~i | b = ~j]
  unless Contact[a = ~j | b = ~i]`,
    },
    { id: uid(), name: 'part', rate: 2, text: `${pair(true)} where ${D} > 1.2 * ${S0}
  => ${still}` },
    { id: uid(), name: 'eggshell', rate: 3, text: `?p = Cell[x = ?x | y = ?y | z = ?z | r = ?r] where ${SH} > 1
  => ?p = Cell[x = ?x / sqrt[${SH}] | y = ?y / sqrt[${SH}] | z = ?z / sqrt[${SH}] | r = ?r]` },
    signal('Notch (ABp)', 'founder = "ab" | depth = 1 | glp1 = false | fate = ?f', 'founder = "ab" | depth = 1 | glp1 = true | fate = "ABp-type"', false),
    signal('Notch (ABp) ·', 'founder = "ab" | depth = 1 | glp1 = false | fate = ?f', 'founder = "ab" | depth = 1 | glp1 = true | fate = "ABp-type"', true),
    signal('Wnt (EMS)', 'founder = "ems" | wnt = false', 'founder = "ems" | wnt = true', false),
    signal('Wnt (EMS) ·', 'founder = "ems" | wnt = false', 'founder = "ems" | wnt = true', true),
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
    text: `Embryo[t = 0.0](
  Cell[name = "P0" | founder = "p" | depth = 0 | pgen = 0 | born = 0.0 | x = 0.0 | y = 0.0 | z = 0.0 | r = 14.0 | signal = false | wnt = false | glp1 = false | fate = "germline"])`,
  };
  return {
    types: [
      'Embryo[t :: Float] {color: "#8a8fb8", container: true, ellipsoid: [25, 15, 15], scale: 0.25}',
      'Cell[id :: Link | name :: Text | founder :: Text | depth :: Int | pgen :: Int | born :: Float | x :: Float | y :: Float | z :: Float | r :: Float | signal :: Bool | wnt :: Bool | glp1 :: Bool | fate :: Text] {shape: "sphere", position: "x y z", radiusBy: "r", colorBy: "founder", label: "name", scale: 0.25, opacity: 0.55}',
      'Contact[a :: Link | b :: Link] {color: "#ffffff", asLink: true}',
      'Sister[a :: Link | b :: Link] <: Contact {color: "#ffd36e", asLink: true}',
    ].map((text) => ({ id: uid(), text })),
    states: [zygote],
    rules,
    system: { initial: zygote.id, rules: rules.map((r) => r.id), seed: 1, pace: 'time' },
  };
};

/** The examples that come with it: always loaded fresh, never overwritten. */
export const EXAMPLES: Record<string, () => Library> = { 'embryo (wyrm)': embryo, 'yin yang': yinYang, 'lac operon': lacOperon, Growth: growth, MAPK: mapk };

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
