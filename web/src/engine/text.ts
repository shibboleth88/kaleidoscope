/**
 * Text: a reader and printer for the bigraph part of chrysalis's v004 syntax (`docs/SYNTAX.md`).
 *
 *   P | Q            merge: two places side by side in one region (a line break between items is `|` too)
 *   P || Q           two regions
 *   H[A](B)          a node of type H: ports and attributes A, members B
 *   k = t            a member at key k (in `[]`, an attribute; or, where H declares port k, a port)
 *   ~b               a link        ~b :: T   at a side's top level, a closed edge
 *   ?x   k = ?x      a site, anonymous or at key k (written twice in a reactum it copies; left out it drops)
 *   ?c = t           a matched node, named: named on both sides it is kept
 *   L => R unless N  a rule; each negative names the redex's nodes it extends
 *   3  2.5  "t"  true   scalars; a bare literal is a scalar node typed by its slot, else by its kind
 *
 * Kaleidoscope conventions, beyond v004 (each said where it applies):
 * - `!` is a port on a closed edge of its own: free.
 * - In a state every link is an edge. In a redex an undeclared link is an outer name, open on the face; in a
 *   reactum a link the redex does not name is a fresh closed edge (a bond minted).
 * - A port left unwritten is, in a state or on a fresh reactum node, free (`!`); in a redex, any link (a fresh
 *   outer name), which a kept node's unwritten port in the reactum keeps.
 * - Likewise an attribute the type declares, left unwritten: in a redex, a site at its key; on a kept node in the
 *   reactum, that same site, so it keeps its value. (A fresh node gets no default: v004 has none.)
 */

import {
  ANON,
  type Carrier,
  type Edge,
  type Handle,
  type Id,
  Index,
  type Member,
  type Node,
  type Parent,
  type PortGroup,
  type Scalar,
  emptyFace,
  isAttr,
  memberScalar,
} from './carrier';
import type { Rule } from './rule';
import type { Signature } from './signature';

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'id'; v: string; nl: boolean; at: number }
  | { t: 'num'; v: number; float: boolean; nl: boolean; at: number }
  | { t: 'str'; v: string; nl: boolean; at: number }
  | { t: 'link'; v: string; nl: boolean; at: number }
  | { t: 'site'; v: string; nl: boolean; at: number }
  | { t: 'sym'; v: string; nl: boolean; at: number }
  | { t: 'eof'; nl: boolean; at: number };

export class ReadError extends Error {}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let nl = false;
  const ident = /[A-Za-z_][A-Za-z0-9_]*/y;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') (nl = true), i++;
    else if (/\s/.test(c)) i++;
    else if (c === '#') while (i < src.length && src[i] !== '\n') i++;
    else {
      const at = i;
      const push = (tok: Tok) => (out.push(tok), (nl = false));
      if (src.startsWith('||', i) || src.startsWith('=>', i) || src.startsWith('::', i)) push({ t: 'sym', v: src.slice(i, (i += 2)), nl, at });
      else if ('()[]|=!'.includes(c)) push({ t: 'sym', v: c, nl, at }), i++;
      else if (c === '~' || c === '?') {
        ident.lastIndex = i + 1;
        const m = ident.exec(src);
        if (!m) throw new ReadError(`a name must follow ${c} at ${i}`);
        push({ t: c === '~' ? 'link' : 'site', v: m[0], nl, at });
        i = ident.lastIndex;
      } else if (c === '"') {
        let s = '';
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') {
            const e = src[++i];
            s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          } else s += src[i];
          i++;
        }
        if (src[i] !== '"') throw new ReadError(`an unclosed string at ${at}`);
        i++;
        push({ t: 'str', v: s, nl, at });
      } else if (/[-0-9]/.test(c)) {
        const m = /-?\d+(\.\d+)?([eE][-+]?\d+)?/y;
        m.lastIndex = i;
        const r = m.exec(src);
        if (!r) throw new ReadError(`unexpected ${c} at ${i}`);
        push({ t: 'num', v: Number(r[0]), float: r[1] !== undefined || r[2] !== undefined, nl, at });
        i = m.lastIndex;
      } else {
        ident.lastIndex = i;
        const m = ident.exec(src);
        if (!m) throw new ReadError(`unexpected ${c} at ${i}`);
        push({ t: 'id', v: m[0], nl, at });
        i = ident.lastIndex;
      }
    }
  }
  out.push({ t: 'eof', nl, at: src.length });
  return out;
}

// ── the syntax tree ────────────────────────────────────────────────────────────────────────────────────────

type Key = Scalar;
type Value =
  | { k: 'term'; head: string; attrs: Item[]; body: Item[] | null; at: number }
  | { k: 'lit'; v: Scalar }
  | { k: 'site'; name: string }
  | { k: 'link'; name: string }
  | { k: 'free' };
type Item =
  | { k: 'member'; key: Key | null; named: string | null; value: Value }
  | { k: 'edge'; name: string; type: string };

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}
  peek(o = 0) {
    return this.toks[this.i + o];
  }
  next() {
    return this.toks[this.i++];
  }
  isSym(v: string, o = 0) {
    const t = this.peek(o);
    return t.t === 'sym' && t.v === v;
  }
  expect(v: string) {
    const t = this.next();
    if (t.t !== 'sym' || t.v !== v) throw new ReadError(`expected ${v} at ${t.at}`);
  }
  atEnd() {
    const t = this.peek();
    return t.t === 'eof' || (t.t === 'id' && t.v === 'unless') || (t.t === 'sym' && ['=>', '||', ')', ']'].includes(t.v));
  }

  /** Items separated by `|` or line breaks, up to a closer. */
  place(): Item[] {
    const items: Item[] = [];
    if (this.atEnd()) return items;
    items.push(this.item());
    for (;;) {
      if (this.isSym('|')) {
        this.next();
        items.push(this.item());
      } else if (!this.atEnd() && this.peek().nl) items.push(this.item());
      else break;
    }
    return items;
  }

  item(): Item {
    const t = this.peek();
    // ~b :: T  — a closed edge
    if (t.t === 'link' && this.isSym('::', 1)) {
      this.next();
      this.next();
      const ty = this.next();
      if (ty.t !== 'id') throw new ReadError(`a type must follow :: at ${ty.at}`);
      return { k: 'edge', name: t.v, type: ty.v };
    }
    // ?c = term  — a named match
    if (t.t === 'site' && this.isSym('=', 1)) {
      this.next();
      this.next();
      return { k: 'member', key: null, named: t.v, value: this.value() };
    }
    // k = value
    const keyTok = this.peek();
    if ((keyTok.t === 'id' || keyTok.t === 'num' || keyTok.t === 'str') && this.isSym('=', 1)) {
      this.next();
      this.next();
      const key: Key =
        keyTok.t === 'num' ? { int: keyTok.v } : { text: keyTok.v as string };
      // k = ?c = term  — at key k, named
      if (this.peek().t === 'site' && this.isSym('=', 1)) {
        const s = this.next() as { v: string };
        this.next();
        return { k: 'member', key, named: s.v, value: this.value() };
      }
      return { k: 'member', key, named: null, value: this.value() };
    }
    return { k: 'member', key: null, named: null, value: this.value() };
  }

  value(): Value {
    const t = this.next();
    if (t.t === 'site') return { k: 'site', name: t.v };
    if (t.t === 'link') return { k: 'link', name: t.v };
    if (t.t === 'sym' && t.v === '!') return { k: 'free' };
    if (t.t === 'num') return { k: 'lit', v: t.float || !Number.isInteger(t.v) ? { float: t.v } : { int: t.v } };
    if (t.t === 'str') return { k: 'lit', v: { text: t.v } };
    if (t.t === 'id' && (t.v === 'true' || t.v === 'false')) return { k: 'lit', v: { bool: t.v === 'true' } };
    if (t.t !== 'id') throw new ReadError(`expected a term at ${t.at}`);
    let attrs: Item[] = [];
    let body: Item[] | null = null;
    if (this.isSym('[') && !this.peek().nl) {
      this.next();
      attrs = this.place();
      this.expect(']');
    }
    if (this.isSym('(') && !this.peek().nl) {
      this.next();
      body = this.place();
      this.expect(')');
    }
    return { k: 'term', head: t.v, attrs, body, at: t.at };
  }
}

// ── building carriers ──────────────────────────────────────────────────────────────────────────────────────

type Mode = 'state' | 'redex' | 'reactum' | 'negative';

interface Ids {
  node: number;
  edge: number;
  name: number;
}

const literalType = (s: Scalar) => ('int' in s ? 'Int' : 'float' in s ? 'Float' : 'text' in s ? 'Text' : 'Bool');

class Builder {
  nodes: Node[] = [];
  edges: Edge[] = [];
  sites: { parent: Parent; key: Member; name: string }[] = [];
  /** Named matches: `?c` → node. */
  named = new Map<string, Id>();
  /** Closed edges by name. */
  edgeNames = new Map<string, Id>();
  constructor(
    readonly sig: Signature,
    readonly mode: Mode,
    readonly ids: Ids,
    /** Outer names by name: shared by a rule's sides. */
    readonly outer: Map<string, Id>,
    /** In a negative: the redex's named nodes, which the negative extends rather than repeats. */
    readonly refer: Map<string, Id> = new Map(),
    readonly referSites: Set<string> = new Set(),
  ) {}

  region(items: Item[], r: number) {
    for (const it of items) if (it.k === 'edge') this.closedEdge(it.name, it.type);
    for (const it of items) if (it.k === 'member') this.member(it, { region: r }, false, null);
  }

  closedEdge(name: string, type: string): Id {
    let e = this.edgeNames.get(name);
    if (e === undefined) {
      e = this.ids.edge++;
      this.edgeNames.set(name, e);
      this.edges.push({ id: e, contract: this.sig.id(type), value: null });
    }
    return e;
  }

  freeEdge(contract: Id): Handle {
    const id = this.ids.edge++;
    this.edges.push({ id, contract, value: null });
    return { edge: id };
  }

  link(name: string, contract: Id): Handle {
    if (this.edgeNames.has(name)) return { edge: this.edgeNames.get(name)! };
    if (this.mode === 'state' || this.mode === 'negative') return { edge: this.closedEdge(name, this.sig.name(contract)) };
    if (this.mode === 'redex') {
      if (!this.outer.has(name)) this.outer.set(name, this.ids.name++);
      return { name: this.outer.get(name)! };
    }
    // reactum: the redex's outer name, else a fresh bond
    if (this.outer.has(name)) return { name: this.outer.get(name)! };
    return { edge: this.closedEdge(name, this.sig.name(contract)) };
  }

  member(it: Extract<Item, { k: 'member' }>, parent: Parent, attr: boolean, slotType: Id | null) {
    const member: Member = attr ? { attr: it.key } : { held: it.key };
    const v = it.value;
    if (v.k === 'site') {
      if (this.mode === 'negative' && this.referSites.has(v.name)) return;
      this.sites.push({ parent, key: it.key === null ? ANON : member, name: v.name });
      return;
    }
    if (v.k === 'link' || v.k === 'free') throw new ReadError(`a link stands only at a port`);
    if (v.k === 'lit') {
      const type = slotType ?? this.sig.id(literalType(v.v));
      this.nodes.push({ id: this.ids.node++, type, parent, member, payload: { scalar: v.v }, ports: [] });
      return;
    }
    this.term(v, parent, member, it.named);
  }

  term(v: Extract<Value, { k: 'term' }>, parent: Parent, member: Member, named: string | null) {
    const decl = this.sig.get(this.sig.id(v.head));
    // in a negative, a node the redex names is the redex's: what is written inside it extends it
    if (named && this.refer.has(named)) {
      const id = this.refer.get(named)!;
      for (const it of v.attrs) if (it.k === 'member' && !decl.ports.some((p) => it.key && 'text' in it.key && it.key.text === p.key)) this.member(it, { node: id }, true, this.attrType(decl.attrs, it.key));
      for (const it of v.body ?? []) if (it.k === 'member') this.member(it, { node: id }, false, null);
      return;
    }
    // a scalar node written T(v)
    if (decl.kind !== 'composite' && decl.kind !== 'place') {
      const lit = v.body?.[0];
      if (!lit || lit.k !== 'member' || lit.value.k !== 'lit') throw new ReadError(`${v.head} holds a scalar`);
      this.nodes.push({ id: this.ids.node++, type: decl.id, parent, member, payload: { scalar: lit.value.v }, ports: [] });
      return;
    }
    const id = this.ids.node++;
    if (named) {
      if (this.named.has(named)) throw new ReadError(`?${named} is named twice`);
      this.named.set(named, id);
    }
    const ports: PortGroup[] = [];
    const written = new Map<string, Value>();
    const attrItems: Extract<Item, { k: 'member' }>[] = [];
    for (const it of v.attrs) {
      if (it.k !== 'member') throw new ReadError('an edge is declared at a side\'s top level');
      const k = it.key && 'text' in it.key ? it.key.text : null;
      if (k !== null && decl.ports.some((p) => p.key === k)) written.set(k, it.value);
      else attrItems.push(it);
    }
    for (const p of decl.ports) {
      const w = written.get(p.key);
      const points: [Scalar, { contract: Id; target: Handle }][] = [];
      for (let j = 0; j < p.arity; j++) {
        let target: Handle;
        if (w?.k === 'link') target = this.link(p.arity > 1 ? `${w.name}` : w.name, p.contract);
        else if (w?.k === 'free' || (!w && this.mode !== 'redex' && !(this.mode === 'reactum' && named))) target = this.freeEdge(p.contract);
        else if (!w) target = this.link(named ? `_${named}_${p.key}` : `_${id}_${p.key}`, p.contract);
        else throw new ReadError(`port ${p.key} of ${v.head} takes a link`);
        points.push([{ int: j }, { contract: p.contract, target }]);
      }
      ports.push({ key: { text: p.key }, contract: p.contract, points });
    }
    this.nodes.push({ id, type: decl.id, parent, member, payload: 'composite', ports });
    for (const it of attrItems) this.member(it, { node: id }, true, this.attrType(decl.attrs, it.key));
    // an attribute left unwritten: in a redex, whatever it is (a site at its key); on a kept node in the
    // reactum, what it was (that same site)
    const keptHere = this.mode === 'reactum' && named !== null;
    if (this.mode === 'redex' || keptHere)
      for (const a of decl.attrs)
        if (!attrItems.some((it) => it.key && 'text' in it.key && it.key.text === a.key))
          this.sites.push({ parent: { node: id }, key: { attr: { text: a.key } }, name: `_${named ?? id}_${a.key}` });
    for (const it of v.body ?? []) {
      if (it.k !== 'member') throw new ReadError('an edge is declared at a side\'s top level');
      this.member(it, { node: id }, false, null);
    }
  }

  attrType(attrs: { key: string; type: Id }[], key: Scalar | null): Id | null {
    if (!key || !('text' in key)) return null;
    return attrs.find((a) => a.key === key.text)?.type ?? null;
  }

  carrier(regions: number, outerNames: [Id, Id][]): Carrier {
    return {
      inner: { places: this.sites.map(() => this.sig.id('Place')), names: [], locality: [] },
      outer: { places: Array.from({ length: regions }, () => this.sig.id('Place')), names: outerNames, locality: [] },
      nodes: this.nodes,
      edges: this.edges,
      sites: this.sites.map((s) => s.parent),
      names: [],
      siteKeys: this.sites.map((s) => s.key),
    };
  }
}

/** A side: regions joined by `||`; a side written `(A | B)` is that place. */
function sideOf(p: Parser): Item[][] {
  const one = (): Item[] => {
    if (p.isSym('(')) {
      p.next();
      const items = p.place();
      p.expect(')');
      return items;
    }
    return p.place();
  };
  const regions = [one()];
  while (p.isSym('||')) {
    p.next();
    regions.push(one());
  }
  return regions;
}

/** A ground state: every link an edge. */
export function readState(src: string, sig: Signature): Carrier {
  const p = new Parser(lex(src));
  const regions = sideOf(p);
  if (p.peek().t !== 'eof') throw new ReadError(`unexpected text at ${p.peek().at}`);
  const b = new Builder(sig, 'state', { node: 0, edge: 0, name: 0 }, new Map());
  regions.forEach((items, r) => b.region(items, r));
  return b.carrier(regions.length, []);
}

export interface RuleOptions {
  rate?: number;
}

/** A rule, `redex => reactum unless negative …`. */
export function readRule(name: string, src: string, sig: Signature, opts: RuleOptions = {}): Rule {
  const p = new Parser(lex(src));
  const ids: Ids = { node: 0, edge: 0, name: 0 };
  const outer = new Map<string, Id>();
  const lhs = sideOf(p);
  p.expect('=>');
  const rhs = sideOf(p);
  const negs: Item[][][] = [];
  while (p.peek().t === 'id' && (p.peek() as { v: string }).v === 'unless') {
    p.next();
    negs.push(sideOf(p));
  }
  if (p.peek().t !== 'eof') throw new ReadError(`unexpected text at ${p.peek().at}`);
  if (lhs.length !== rhs.length) throw new ReadError('redex and reactum have different numbers of regions');

  const redex = new Builder(sig, 'redex', ids, outer);
  lhs.forEach((items, r) => redex.region(items, r));
  const reactum = new Builder(sig, 'reactum', ids, outer);
  rhs.forEach((items, r) => reactum.region(items, r));

  const outerNames: [Id, Id][] = [...outer.values()].map((x) => [x, sig.id('Link')]);
  const R = redex.carrier(lhs.length, outerNames);
  const X = reactum.carrier(rhs.length, outerNames);

  // the site map, by name
  const redexSite = new Map(redex.sites.map((s, i) => [s.name, i]));
  if (redexSite.size !== redex.sites.length) throw new ReadError('a redex site is written twice');
  const sites = reactum.sites.map((s) => {
    const i = redexSite.get(s.name);
    if (i === undefined) throw new ReadError(`?${s.name} in the reactum is no redex site`);
    return i;
  });

  // kept by name, nodes and edges
  const kept: [Id, Id][] = [];
  for (const [n, b] of reactum.named) {
    const a = redex.named.get(n);
    if (a === undefined) throw new ReadError(`?${n} is kept but the redex does not name it`);
    kept.push([a, b]);
  }
  const keptEdges: [Id, Id][] = [];
  for (const [n, b] of reactum.edgeNames) {
    const a = redex.edgeNames.get(n);
    if (a !== undefined) keptEdges.push([a, b]);
  }

  // a negative extends the redex: the redex's nodes, edges and sites, and what it adds
  const negatives = negs.map((regions) => {
    const nb = new Builder(sig, 'negative', ids, outer, redex.named, new Set(redex.sites.map((s) => s.name)));
    nb.edgeNames = new Map(redex.edgeNames);
    regions.forEach((items, r) => nb.region(items, r));
    return { ...R, nodes: [...R.nodes, ...nb.nodes], edges: [...R.edges, ...nb.edges] };
  });

  return { name, redex: R, reactum: X, sites, kept, keptEdges, negatives, rate: opts.rate };
}

// ── printing ───────────────────────────────────────────────────────────────────────────────────────────────

const keyText = (k: Scalar): string =>
  'text' in k ? (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.text) && !['true', 'false', 'unless'].includes(k.text) ? k.text : JSON.stringify(k.text)) : 'int' in k ? `${k.int}` : `${scalarText(k)}`;

const scalarText = (s: Scalar): string =>
  'int' in s ? `${s.int}` : 'float' in s ? (Number.isInteger(s.float) ? s.float.toFixed(1) : `${s.float}`) : 'text' in s ? JSON.stringify(s.text) : `${s.bool}`;

/**
 * A carrier written down, canonically: members ordered by their shape (links anonymous), links then named in the
 * order they are met, a free port `!`. Carriers alike up to identity print the same, so tests compare text.
 */
export function print(g: Carrier, sig: Signature): string {
  const ix = new Index(g);
  const siteAt = new Map<string, number[]>();
  g.sites.forEach((s, i) => {
    const k = 'node' in s ? `n${s.node}` : `r${s.region}`;
    (siteAt.get(k) ?? siteAt.set(k, []).get(k)!).push(i);
  });
  let names = new Map<string, string>();
  const linkName = (h: Handle): string => {
    if ('edge' in h && ix.pointsOn(h).length === 1) return '!';
    const k = 'edge' in h ? `e${h.edge}` : 'name' in h ? `x${h.name}` : `b${h.binder}`;
    if (!names.has(k)) names.set(k, `~${'name' in h ? 'x' : 'e'}${names.size}`);
    return names.get(k)!;
  };

  const shape = new Map<Id, string>();
  const shapeOf = (n: Node): string => {
    let s = shape.get(n.id);
    if (s === undefined) {
      const saved = names;
      names = new Map();
      s = node(n).replace(/~[ex]\d+/g, '~');
      names = saved;
      shape.set(n.id, s);
    }
    return s;
  };
  const kidsOf = (p: Parent): Node[] =>
    [...ix.children(p)].sort((a, b) => (shapeOf(a) < shapeOf(b) ? -1 : shapeOf(a) > shapeOf(b) ? 1 : 0));

  const node = (n: Node): string => {
    const head = sig.name(n.type);
    if (typeof n.payload === 'object') {
      const lit = scalarText(n.payload.scalar);
      return head === literalType(n.payload.scalar) ? lit : `${head}(${lit})`;
    }
    const kids = kidsOf({ node: n.id });
    const attrs = [
      ...n.ports.map(
        (grp) =>
          `${keyText(grp.key)} = ${grp.points.length === 1 ? linkName(grp.points[0][1].target) : `(${grp.points.map(([, p]) => linkName(p.target)).join(' ')})`}`,
      ),
      ...kids.filter((c) => isAttr(c.member)).map((c) => `${keyText(memberScalar(c.member)!)} = ${node(c)}`),
      ...sites(`n${n.id}`, true),
    ];
    const body = [...members(kids.filter((c) => !isAttr(c.member))), ...sites(`n${n.id}`, false)];
    return `${head}${attrs.length ? `[${attrs.join(' | ')}]` : ''}${body.length ? `(${body.join(' | ')})` : ''}`;
  };
  const members = (kids: Node[]) =>
    kids.map((c) => (memberScalar(c.member) === null ? node(c) : `${keyText(memberScalar(c.member)!)} = ${node(c)}`));
  const sites = (at: string, attr: boolean) =>
    (siteAt.get(at) ?? [])
      .filter((i) => isAttr(g.siteKeys[i] ?? ANON) === attr)
      .map((i) => {
        const k = memberScalar(g.siteKeys[i] ?? ANON);
        return k === null ? `?s${i}` : `${keyText(k)} = ?s${i}`;
      });
  const text = g.outer.places
    .map((_, r) => [...members(kidsOf({ region: r })), ...sites(`r${r}`, false)].join(' | ') || '()')
    .join(' || ');
  return text || '()';
}

export const emptyCarrier = (): Carrier => ({ inner: emptyFace(), outer: emptyFace(), nodes: [], edges: [], sites: [], names: [], siteKeys: [] });
