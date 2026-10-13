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
  rate: number;
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
  system: { initial: string; rules: string[]; seed: number };
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

/** The examples that come with it: always loaded fresh, never overwritten. */
export const EXAMPLES: Record<string, () => Library> = { 'lac operon': lacOperon, Growth: growth, MAPK: mapk };

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
