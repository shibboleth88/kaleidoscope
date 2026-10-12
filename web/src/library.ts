/**
 * The library: what the world is made of (types), states built from them, and reactions — and the system: one
 * initial state and a chosen set of reactions, running.
 *
 * Entries are kept as text for now (v004, `engine/text.ts`) and compiled to carriers whenever anything changes.
 */

import { type Carrier, type Rule, Signature, type TypeSpec, checkRule, readRule, readState } from './engine';

export interface StateEntry {
  id: string;
  name: string;
  text: string;
}

export interface RuleEntry extends StateEntry {
  rate: number;
}

export interface Library {
  types: string;
  states: StateEntry[];
  rules: RuleEntry[];
  system: { initial: string; rules: string[]; seed: number };
}

export interface Compiled {
  sig: Signature;
  typeError: string | null;
  states: Map<string, Carrier | Error>;
  rules: Map<string, Rule | Error>;
}

/**
 * Type declarations, one per line:
 *   Name                          a type
 *   Name <: Super                 within Super
 *   Name[p :: Link | a :: Float]  ports (slots whose type is a link) and attributes
 *   Name {color: "#f80", shape: "torus", sizeBy: "mass"}   how it looks
 */
export function readTypes(src: string): Signature {
  const specs: Record<string, TypeSpec> = {};
  const linkish = new Set(['Link']);
  // a comment runs from a `#` outside a string to the end of its line
  const uncomment = (l: string) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '"') q = !q;
      else if (l[i] === '#' && !q) return l.slice(0, i);
    }
    return l;
  };
  const lines = src.split('\n').map((l) => uncomment(l).trim()).filter(Boolean);
  const parsed = lines.map((line, i) => {
    const m = /^([A-Za-z_]\w*)\s*(?:\[([^\]]*)\])?\s*(?:<:\s*([\w\s,]+?))?\s*(\{.*\})?$/.exec(line);
    if (!m) throw new Error(`line ${i + 1}: cannot read "${line}"`);
    const [, name, slots, supers, style] = m;
    const sups = supers ? supers.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (sups.includes('Link')) linkish.add(name);
    return { name, slots, sups, style, i };
  });
  // link types: within Link, transitively
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of parsed) if (!linkish.has(p.name) && p.sups.some((s) => linkish.has(s))) linkish.add(p.name), (changed = true);
  }
  for (const { name, slots, sups, style, i } of parsed) {
    const spec: TypeSpec = { supers: sups, ports: {}, attrs: {} };
    if (linkish.has(name)) spec.kind = 'link';
    for (const slot of (slots ?? '').split('|').map((s) => s.trim()).filter(Boolean)) {
      const sm = /^([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)(?:\s*\*\s*(\d+))?$/.exec(slot);
      if (!sm) throw new Error(`line ${i + 1}: a slot is "key :: Type", not "${slot}"`);
      if (linkish.has(sm[2])) spec.ports![sm[1]] = sm[3] ? [sm[2], Number(sm[3])] : sm[2];
      else spec.attrs![sm[1]] = sm[2];
    }
    if (style) {
      try {
        spec.style = JSON.parse(style.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":'));
      } catch {
        throw new Error(`line ${i + 1}: the style should be {key: value, ...}`);
      }
    }
    specs[name] = spec;
  }
  return Signature.of(specs);
}

export function compile(lib: Library): Compiled {
  let sig: Signature;
  let typeError: string | null = null;
  try {
    sig = readTypes(lib.types);
  } catch (e) {
    typeError = (e as Error).message;
    sig = new Signature();
  }
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
  return { sig, typeError, states, rules };
}

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
pERK[s :: Link | name :: Text] {color: "#ff5e8a", shape: "icosahedron"}`,
    states: [cell],
    rules,
    system: { initial: cell.id, rules: rules.map((r) => r.id), seed: 7 },
  };
};

const KEY = 'kaleidoscope.library.v1';

export function load(): Library {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return JSON.parse(s) as Library;
  } catch {
    /* no storage: start fresh */
  }
  return mapk();
}

export function save(lib: Library) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
  } catch {
    /* no storage: the library lives for this visit */
  }
}
