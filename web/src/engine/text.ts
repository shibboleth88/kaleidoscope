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
import { type Expr, FUNCTIONS, NO_SITES, type ScalarKind, evaluate, kindOf } from './expr';
import type { Signature } from './signature';

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'id'; v: string; nl: boolean; at: number }
  | { t: 'num'; v: number; float: boolean; nl: boolean; at: number }
  | { t: 'str'; v: string; nl: boolean; at: number }
  | { t: 'link'; v: string; nl: boolean; at: number }
  | { t: 'site'; v: string; attr?: string; nl: boolean; at: number }
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
      const two = src.slice(i, i + 2);
      const prev = out[out.length - 1];
      const afterValue = !!prev && (['id', 'num', 'str', 'site', 'link'].includes(prev.t) || (prev.t === 'sym' && (prev.v === ')' || prev.v === ']')));
      if (['||', '=>', '::', '==', '!=', '<=', '>=', '++', '<:'].includes(two)) push({ t: 'sym', v: two, nl, at }), (i += 2);
      else if (c === '-' && /[0-9]/.test(src[i + 1] ?? '') && !afterValue) {
        const m = /-\d+(\.\d+)?([eE][-+]?\d+)?/y;
        m.lastIndex = i;
        const r = m.exec(src)!;
        push({ t: 'num', v: Number(r[0]), float: r[1] !== undefined || r[2] !== undefined, nl, at });
        i = m.lastIndex;
      } else if ('()[]|=!+-*/%<>'.includes(c)) push({ t: 'sym', v: c, nl, at }), i++;
      else if (c === '~' || c === '?') {
        ident.lastIndex = i + 1;
        const m = ident.exec(src);
        if (!m) throw new ReadError(`a name must follow ${c} at ${i}`);
        i = ident.lastIndex;
        // `?ps.x`: in a fold over a rest of points, the far node's attribute x
        let attr: string | undefined;
        if (c === '?' && src[i] === '.') {
          ident.lastIndex = i + 1;
          const a = ident.exec(src);
          if (a) (attr = a[0]), (i = ident.lastIndex);
        }
        push(c === '~' ? { t: 'link', v: m[0], nl, at } : { t: 'site', v: m[0], ...(attr ? { attr } : {}), nl, at });
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
      } else if (/[0-9]/.test(c)) {
        const m = /\d+(\.\d+)?([eE][-+]?\d+)?/y;
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
export type Value =
  | { k: 'term'; head: string; attrs: Item[]; body: Item[] | null; at: number }
  | { k: 'lit'; v: Scalar }
  | { k: 'site'; name: string; attr?: string }
  /** A port's points: links, free points, and at most one rest (`(~c | ?ps)`). */
  | { k: 'points'; items: Value[] }
  | { k: 'link'; name: string }
  | { k: 'free' }
  /** An expression: an operator (or a function) applied to values. */
  | { k: 'expr'; op: string; args: Value[] };
export type Item =
  | { k: 'member'; key: Key | null; named: string | null; value: Value }
  | { k: 'edge'; name: string; type: string };
export type MemberItem = Extract<Item, { k: 'member' }>;
export type Term = Extract<Value, { k: 'term' }>;
/** A rule as written: its sides, each a list of regions. */
export interface RuleAst {
  lhs: Item[][];
  /** `where …`: the rule meets only where this holds. */
  guard?: Value | null;
  rhs: Item[][];
  negs: Item[][][];
}

class Parser {
  i = 0;
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
    return t.t === 'eof' || (t.t === 'id' && (t.v === 'unless' || t.v === 'where')) || (t.t === 'sym' && ['=>', '||', ')', ']'].includes(t.v));
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

  /** A value, perhaps an expression: operators bind by precedence, and never across a line break. */
  value(min = 0): Value {
    let lhs = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.nl) break;
      const op = t.t === 'sym' || (t.t === 'id' && (t.v === 'and' || t.v === 'or')) ? (t as { v: string }).v : null;
      const bp = op ? BP[op] : undefined;
      if (bp === undefined || bp < min) break;
      this.next();
      lhs = { k: 'expr', op: op!, args: [lhs, this.value(bp + 1)] };
    }
    return lhs;
  }

  /** `(~a | ! | ?rest)`: a port's points, where the brackets hold only those; else nothing (and nothing read). */
  points(): Value | null {
    const start = this.i;
    this.next();
    const items: Value[] = [];
    for (;;) {
      const t = this.peek();
      if (t.t === 'link') items.push({ k: 'link', name: (this.next() as { v: string }).v });
      else if (t.t === 'site' && !t.attr) items.push({ k: 'site', name: (this.next() as { v: string }).v });
      else if (t.t === 'sym' && t.v === '!') this.next(), items.push({ k: 'free' });
      else if (t.t === 'sym' && t.v === '|') this.next();
      else if (t.t === 'sym' && t.v === ')' && items.length) {
        this.next();
        return { k: 'points', items };
      } else break;
    }
    this.i = start;
    return null;
  }

  primary(): Value {
    const t = this.peek();
    if (t.t === 'sym' && t.v === '(') {
      const pts = this.points();
      if (pts) return pts.k === 'points' && pts.items.length === 1 && pts.items[0].k === 'site' ? pts.items[0] : pts;
      this.next();
      const v = this.value();
      this.expect(')');
      return v;
    }
    if (t.t === 'sym' && t.v === '-') {
      this.next();
      return { k: 'expr', op: 'neg', args: [this.value(7)] };
    }
    if (t.t === 'id' && t.v === 'not') {
      this.next();
      return { k: 'expr', op: 'not', args: [this.value(7)] };
    }
    if (t.t === 'id' && t.v in FUNCTIONS && this.isSym('[', 1)) {
      this.next();
      this.next();
      const args: Value[] = [];
      while (!this.isSym(']')) {
        if (this.isSym('|')) {
          this.next();
          continue;
        }
        if (this.peek().t === 'eof') throw new ReadError(`an unclosed ${t.v}[`);
        args.push(this.value());
      }
      this.next();
      const [lo, hi] = FUNCTIONS[t.v];
      if (args.length < lo || args.length > hi) throw new ReadError(`${t.v} takes ${lo === hi ? lo : `${lo} or ${hi}`} value${hi > 1 ? 's' : ''}`);
      return { k: 'expr', op: t.v, args };
    }
    // `?p.f[a b]`: a method call, `f[?p a b]`, the receiver first (SYNTAX §9)
    if (t.t === 'site' && t.attr && this.isSym('[', 1) && !this.peek(1).nl) {
      this.next();
      this.next();
      const args: Value[] = [{ k: 'site', name: t.v }];
      while (!this.isSym(']')) {
        if (this.isSym('|')) {
          this.next();
          continue;
        }
        if (this.peek().t === 'eof') throw new ReadError(`an unclosed ?${t.v}.${t.attr}[`);
        args.push(this.value());
      }
      this.next();
      if (!(t.attr in FUNCTIONS)) throw new ReadError(`?${t.v}.${t.attr}[…]: no operation ${t.attr}`);
      const [lo, hi] = FUNCTIONS[t.attr];
      if (args.length < lo || args.length > hi) throw new ReadError(`?${t.v}.${t.attr}[…] takes ${lo - 1}${hi > lo ? ` to ${hi - 1}` : ''} values`);
      return { k: 'expr', op: t.attr, args };
    }
    return this.atom();
  }

  atom(): Value {
    const t = this.next();
    if (t.t === 'site') return { k: 'site', name: t.v, ...(t.attr ? { attr: t.attr } : {}) };
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

  // ── programs (v004 `Program(module = (…) | world = (…) | run = (…))`) ───────────────────────────────────────

  /** Skip `|` and line breaks between a body's entries; true while there is another before `)` or the end. */
  more(): boolean {
    while (this.isSym('|')) this.next();
    const t = this.peek();
    return !(t.t === 'eof' || (t.t === 'sym' && t.v === ')'));
  }

  ident(what: string): string {
    const t = this.next();
    if (t.t !== 'id') throw new ReadError(`${what} must be a name, at ${t.at}`);
    return t.v;
  }

  /** A type as written in a slot: a name, perhaps `* n` points (a port group's arity, kaleidoscope's). */
  slotType(): { type: string; arity?: number } {
    const type = this.ident('a slot\'s type');
    if (this.isSym('*') && !this.peek().nl) {
      this.next();
      const n = this.peek();
      if (n.t === 'num' && !n.nl) return this.next(), { type, arity: n.v };
      return { type, arity: 0 };
    }
    return { type };
  }

  /** One entry of a type's binder or body: `<: S`, `~p :: T`, `in p :: T`, `out p :: T`, `k :: T`, `k :: T = v`. */
  slot(into: TypeAst) {
    if (this.isSym('<:')) {
      this.next();
      into.supers.push(this.ident('a supertype'));
      return;
    }
    const t = this.peek();
    if (t.t === 'link') {
      this.next();
      this.expect('::');
      into.slots.push({ key: t.v, port: true, ...this.slotType() });
      return;
    }
    if (t.t === 'id' && (t.v === 'in' || t.v === 'out') && this.peek(1).t === 'id' && this.isSym('::', 2)) {
      this.next();
      const key = this.ident('a port');
      this.next();
      into.slots.push({ key, port: true, direction: t.v, ...this.slotType() });
      return;
    }
    const key = this.ident('a slot');
    if (this.isSym('[')) throw new ReadError(`${key}[…]: methods in a type's body are not read yet, at ${t.at}`);
    this.expect('::');
    const st = this.slotType();
    let dflt: Value | undefined;
    if (this.isSym('=')) {
      this.next();
      dflt = this.value();
    }
    into.slots.push({ key, port: false, ...st, ...(dflt ? { dflt } : {}) });
  }

  /** A rule side: one term, or a place in brackets, regions joined by `||`. A line break ends it (decision g12). */
  ruleSide(): Item[][] {
    const one = (): Item[] => {
      if (this.isSym('(')) {
        this.next();
        const items = this.place();
        this.expect(')');
        return items;
      }
      return [this.item()];
    };
    const regions = [one()];
    while (this.isSym('||')) {
      this.next();
      regions.push(one());
    }
    return regions;
  }

  ruleBody(): RuleAst {
    const lhs = this.ruleSide();
    let guard: Value | null = null;
    if (this.peek().t === 'id' && (this.peek() as { v: string }).v === 'where') {
      this.next();
      guard = this.value();
    }
    this.expect('=>');
    const rhs = this.ruleSide();
    const negs: Item[][][] = [];
    while (this.peek().t === 'id' && (this.peek() as { v: string }).v === 'unless') {
      this.next();
      negs.push(this.ruleSide());
    }
    return { lhs, guard, rhs, negs };
  }

  /** A module's declarations, up to `)` or the end. */
  declarations(into: ModuleAst) {
    while (this.more()) {
      const at = this.peek().at;
      const name = this.ident('a declaration');
      let attrs: Item[] = [];
      let binder: TypeAst | null = null;
      if (this.isSym('[')) {
        // `T[slots] = Type(…)` or `rule[rate = …] = …`: which one is told by what follows `=`
        const start = this.i;
        this.next();
        const typed = this.peek(1).t === 'sym' && (this.peek(1) as { v: string }).v === '::';
        const linked = this.peek().t === 'link' || (this.peek().t === 'id' && ['in', 'out'].includes((this.peek() as { v: string }).v));
        if (typed || linked) {
          const held: TypeAst = { name, binder: [], supers: [], slots: [], attrs: [], at };
          for (;;) {
            while (this.isSym('|')) this.next();
            if (this.isSym(']')) break;
            this.slot(held);
          }
          this.expect(']');
          binder = { name, binder: held.slots, supers: [], slots: [], attrs: [], at };
        } else {
          this.i = start;
          this.next();
          attrs = this.place();
          this.expect(']');
        }
      }
      this.expect('=');
      const head = this.peek();
      if (head.t === 'id' && head.v === 'Module' && this.isSym('[', 1)) {
        this.next();
        this.next();
        const p = this.next();
        if (p.t !== 'str') throw new ReadError(`Module["path"] names its module by a string, at ${p.at}`);
        this.expect(']');
        into.modules.push({ name, path: p.v, at });
        continue;
      }
      if (head.t === 'id' && head.v === 'Type' && !this.isSym('=>', 1)) {
        this.next();
        const ty: TypeAst = binder ?? { name, binder: [], supers: [], slots: [], attrs: [], at };
        if (this.isSym('[')) {
          this.next();
          ty.attrs = this.place();
          this.expect(']');
        }
        if (this.isSym('(')) {
          this.next();
          while (this.more()) this.slot(ty);
          this.expect(')');
        }
        into.types.push(ty);
        continue;
      }
      if (binder) throw new ReadError(`${name}[…] = …: a declaration with slots is a type, at ${at}`);
      const from = this.peek().at;
      const rule = this.ruleBody();
      into.rules.push({ name, attrs, rule, at, text: this.src.slice(from, this.peek().at).trim() });
    }
  }

  src = '';
}

/** A type declared: `Name[binder] = Type[attrs](body)`. */
export interface SlotAst {
  key: string;
  type: string;
  /** A port (a link slot): `~p :: T`, `in p :: T`, `out p :: T`. */
  port: boolean;
  direction?: string;
  /** Points in a port group (kaleidoscope's `* n`); 0 for any number. */
  arity?: number;
  /** `k :: T = v`: the slot's default (spec `types.defaults`). */
  dflt?: Value;
}
export interface TypeAst {
  name: string;
  /** The slots in `[]`: attributes and ports. */
  binder: SlotAst[];
  supers: string[];
  /** The slots in `()`: members (kaleidoscope reads them; a composite node holds anything). */
  slots: SlotAst[];
  /** `Type[…]`: the type's own attributes (here, how its instances look). */
  attrs: Item[];
  at: number;
}
/** A rule declared: `name = lhs where g => rhs unless n`, its node's attributes in `name[…]` (rate, label: gap G7). */
export interface RuleDeclAst {
  name: string;
  attrs: Item[];
  rule: RuleAst;
  text: string;
  at: number;
}
export interface ModuleAst {
  types: TypeAst[];
  rules: RuleDeclAst[];
  modules: { name: string; path: string; at: number }[];
}
export interface ProgramAst extends ModuleAst {
  world: Item[][];
  run: Item[];
}

/** A module's text: its declarations, one after another. */
export function parseModule(src: string): ModuleAst {
  const p = new Parser(lex(src));
  p.src = src;
  const m: ModuleAst = { types: [], rules: [], modules: [] };
  p.declarations(m);
  if (p.peek().t !== 'eof') throw new ReadError(`unexpected text at ${p.peek().at}`);
  return m;
}

/** A program: `Program(module = (…) | world = (…) | run = (…))`, each part optional. */
export function parseProgram(src: string): ProgramAst {
  const p = new Parser(lex(src));
  p.src = src;
  const out: ProgramAst = { types: [], rules: [], modules: [], world: [[]], run: [] };
  if (p.ident('a program') !== 'Program') throw new ReadError('a program is written Program(…)');
  p.expect('(');
  while (p.more()) {
    const part = p.ident('a program\'s part');
    p.expect('=');
    p.expect('(');
    if (part === 'module') p.declarations(out);
    else if (part === 'world') {
      const regions = [p.place()];
      while (p.isSym('||')) p.next(), regions.push(p.place());
      out.world = regions;
    } else if (part === 'run') out.run = p.place();
    else throw new ReadError(`a program's parts are module, world and run, not ${part}`);
    p.expect(')');
  }
  p.expect(')');
  if (p.peek().t !== 'eof') throw new ReadError(`unexpected text at ${p.peek().at}`);
  return out;
}

/** How tightly each operator binds. */
const BP: Record<string, number> = { or: 1, and: 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '++': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

// ── building carriers ──────────────────────────────────────────────────────────────────────────────────────

type Mode = 'state' | 'redex' | 'reactum' | 'negative';

interface Ids {
  node: number;
  edge: number;
  name: number;
}

const KIND_TYPE: Record<ScalarKind, string> = { int: 'Int', float: 'Float', text: 'Text', bool: 'Bool' };
const ZERO: Record<ScalarKind, Scalar> = { int: { int: 0 }, float: { float: 0 }, text: { text: '' }, bool: { bool: false } };

/** An expression as the engine evaluates it: sites by their index in the redex. */
function toExpr(v: Value, sites: Map<string, number> | null, rests: Set<string> = new Set(), named: Map<string, Id> | null = null): Expr {
  switch (v.k) {
    case 'lit':
      return { lit: v.v };
    case 'site': {
      if (rests.has(v.name)) return v.attr ? { restAttr: v.name, key: v.attr } : { rest: v.name };
      // a node the redex names: a host method's receiver or argument
      if (!v.attr && named?.has(v.name) && !sites?.has(v.name)) return { node: named.get(v.name)! };
      if (v.attr) throw new ReadError(`?${v.name}.${v.attr}: ?${v.name} is no rest of points`);
      if (!sites) throw new ReadError(`?${v.name}: a site is read only in a reactum or a guard`);
      const i = sites.get(v.name);
      if (i === undefined) throw new ReadError(`?${v.name} is no site of the redex`);
      return { site: i };
    }
    case 'expr':
      return { op: v.op, args: v.args.map((a) => toExpr(a, sites, rests, named)) };
    case 'term':
      // a bare type name: what count[?x Type] counts
      if (!v.attrs.length && v.body === null) return { type: v.head };
      throw new ReadError(`${v.head}[…]: only a bare type name stands in an expression`);
    default:
      throw new ReadError('an expression is made of values, sites and operations');
  }
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
  /** The item each node was read from: so an edit to the node is an edit to the text. */
  source = new Map<Id, MemberItem>();
  /** In a reactum: the redex's sites, by name, which expressions read. */
  readSites: Map<string, number> | null = null;
  /** Rests of points this part names (each once), and in a reactum the redex's, which expressions fold over. */
  rests = new Set<string>();
  readRests: Set<string> | null = null;
  /** In a reactum: the redex's named nodes, which host methods take. */
  readNamed: Map<string, Id> | null = null;
  /** In a reactum: the scalar nodes whose values are computed. */
  computed: { node: Id; expr: Expr; kind: ScalarKind }[] = [];
  /** The item each site was read from (null for an unwritten attribute's). */
  siteSource: (MemberItem | null)[] = [];
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

  /** In a negative: the names it adds to the redex's (a port it leaves unwritten, a link of its own). */
  negOuter = new Map<string, Id>();

  link(name: string, contract: Id): Handle {
    if (this.edgeNames.has(name)) return { edge: this.edgeNames.get(name)! };
    if (this.mode === 'state') return { edge: this.closedEdge(name, this.sig.name(contract)) };
    if (this.mode === 'negative') {
      // the redex's name, or one of its own: open, like a redex's
      if (this.outer.has(name)) return { name: this.outer.get(name)! };
      if (!this.negOuter.has(name)) this.negOuter.set(name, this.ids.name++);
      return { name: this.negOuter.get(name)! };
    }
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
      this.siteSource.push(it);
      return;
    }
    if (v.k === 'link' || v.k === 'free' || v.k === 'points') throw new ReadError(`a link stands only at a port`);
    if (v.k === 'expr') {
      const kinds: ScalarKind[] = ['int', 'float', 'text', 'bool'];
      const slotKind = slotType !== null && (kinds as string[]).includes(this.sig.get(slotType).kind) ? (this.sig.get(slotType).kind as ScalarKind) : null;
      if (this.mode === 'reactum') {
        // a value computed from what the redex's sites hold, when the rule fires
        const expr = toExpr(v, this.readSites ?? new Map(), this.readRests ?? new Set(), this.readNamed);
        const kind = slotKind ?? kindOf(expr);
        const type = slotType ?? this.sig.id(KIND_TYPE[kind]);
        this.source.set(this.ids.node, it);
        this.computed.push({ node: this.ids.node, expr, kind });
        this.nodes.push({ id: this.ids.node++, type, parent, member, payload: { scalar: ZERO[kind] }, ports: [] });
        return;
      }
      // elsewhere a constant, folded as it is read
      const expr = toExpr(v, null);
      const kind = slotKind ?? kindOf(expr);
      let lit: Scalar;
      try {
        lit = evaluate(expr, NO_SITES, kind);
      } catch (e) {
        throw new ReadError((e as Error).message);
      }
      this.source.set(this.ids.node, it);
      this.nodes.push({ id: this.ids.node++, type: slotType ?? this.sig.id(KIND_TYPE[kind]), parent, member, payload: { scalar: lit }, ports: [] });
      return;
    }
    if (v.k === 'lit') {
      const type = slotType ?? this.sig.id(literalType(v.v));
      this.source.set(this.ids.node, it);
      this.nodes.push({ id: this.ids.node++, type, parent, member, payload: { scalar: v.v }, ports: [] });
      return;
    }
    this.term(v, parent, member, it.named, it);
  }

  term(v: Term, parent: Parent, member: Member, named: string | null, item: MemberItem) {
    const decl = this.sig.get(this.sig.id(v.head));
    // in a negative, a node the redex names is the redex's: what is written inside it extends it
    if (named && this.refer.has(named)) {
      const id = this.refer.get(named)!;
      for (const it of v.attrs) {
        if (it.k !== 'member') continue;
        if (decl.ports.some((p) => it.key && 'text' in it.key && it.key.text === p.key))
          throw new ReadError(`an unless only adds: ?${named}'s ports are the redex's (name the link there, ~l, and use it here)`);
        this.member(it, { node: id }, true, this.attrType(decl.attrs, it.key));
      }
      for (const it of v.body ?? []) if (it.k === 'member') this.member(it, { node: id }, false, null);
      return;
    }
    // a scalar node written T(v)
    if (decl.kind !== 'composite' && decl.kind !== 'place') {
      const lit = v.body?.[0];
      if (!lit || lit.k !== 'member' || lit.value.k !== 'lit') throw new ReadError(`${v.head} holds a scalar`);
      this.source.set(this.ids.node, item);
      this.nodes.push({ id: this.ids.node++, type: decl.id, parent, member, payload: { scalar: lit.value.v }, ports: [] });
      return;
    }
    const id = this.ids.node++;
    this.source.set(id, item);
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
      if (p.arity === 0) {
        // any number of points: those written, and perhaps a rest
        const items = !w ? [] : w.k === 'points' ? w.items : [w];
        let rest: string | undefined;
        for (const it of items) {
          if (it.k === 'site') {
            if (rest) throw new ReadError(`port ${p.key} of ${v.head}: one rest of points at most`);
            rest = it.name;
          } else if (it.k === 'link') points.push([{ int: points.length }, { contract: p.contract, target: this.link(it.name, p.contract) }]);
          else if (it.k === 'free') points.push([{ int: points.length }, { contract: p.contract, target: this.freeEdge(p.contract) }]);
          else throw new ReadError(`port ${p.key} of ${v.head} takes links, ! and a rest`);
        }
        // unwritten: in a pattern, whatever points there are; on a kept node, those same points
        if (!w && (this.mode === 'redex' || this.mode === 'negative' || (this.mode === 'reactum' && named))) rest = `_${named ?? id}_${p.key}`;
        if (rest && (this.mode === 'state' || (this.mode === 'reactum' && !this.readRests?.has(rest))))
          throw new ReadError(`?${rest}: a rest of points is met in a redex, and put back in its reactum`);
        if (rest && this.mode !== 'reactum') {
          if (this.rests.has(rest)) throw new ReadError(`?${rest} is a rest of points twice`);
          this.rests.add(rest);
        }
        ports.push({ key: { text: p.key }, contract: p.contract, points, ...(rest ? { rest } : {}) });
        continue;
      }
      for (let j = 0; j < p.arity; j++) {
        let target: Handle;
        if (w?.k === 'link') target = this.link(p.arity > 1 ? `${w.name}` : w.name, p.contract);
        else if (w?.k === 'free' || (!w && this.mode !== 'redex' && this.mode !== 'negative' && !(this.mode === 'reactum' && named))) target = this.freeEdge(p.contract);
        else if (!w) target = this.link(named ? `_${named}_${p.key}` : `_${id}_${p.key}`, p.contract);
        else throw new ReadError(`port ${p.key} of ${v.head} takes a link`);
        points.push([{ int: j }, { contract: p.contract, target }]);
      }
      ports.push({ key: { text: p.key }, contract: p.contract, points });
    }
    this.nodes.push({ id, type: decl.id, parent, member, payload: 'composite', ports });
    for (const it of attrItems) this.member(it, { node: id }, true, this.attrType(decl.attrs, it.key));
    // an attribute left unwritten on a node made here (a state's, or a reactum's fresh one) holds its default
    if (this.mode === 'state' || (this.mode === 'reactum' && named === null))
      for (const a of decl.attrs)
        if (a.dflt && !attrItems.some((it) => it.key && 'text' in it.key && it.key.text === a.key))
          this.nodes.push({ id: this.ids.node++, type: a.type, parent: { node: id }, member: { attr: { text: a.key } }, payload: { scalar: a.dflt }, ports: [] });
    // an attribute left unwritten: in a redex, whatever it is (a site at its key); on a kept node in the
    // reactum, what it was (that same site)
    const keptHere = this.mode === 'reactum' && named !== null;
    if (this.mode === 'redex' || this.mode === 'negative' || keptHere)
      for (const a of decl.attrs)
        if (!attrItems.some((it) => it.key && 'text' in it.key && it.key.text === a.key))
          this.sites.push({ parent: { node: id }, key: { attr: { text: a.key } }, name: `_${named ?? id}_${a.key}` }),
            this.siteSource.push(null);
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

export function parseState(src: string): Item[][] {
  const p = new Parser(lex(src));
  const regions = sideOf(p);
  if (p.peek().t !== 'eof') throw new ReadError(`unexpected text at ${p.peek().at}`);
  return regions;
}

/** One value as written: a literal, a site, an expression (what an inspector's field holds). */
export function parseValue(src: string): Value {
  const p = new Parser(lex(src));
  const v = p.value();
  if (p.peek().t !== 'eof') throw new ReadError(`unexpected text at ${p.peek().at}`);
  return v;
}

export function parseRule(src: string): RuleAst {
  const p = new Parser(lex(src));
  const lhs = sideOf(p);
  let guard: Value | null = null;
  if (p.peek().t === 'id' && (p.peek() as { v: string }).v === 'where') {
    p.next();
    guard = p.value();
  }
  p.expect('=>');
  const rhs = sideOf(p);
  const negs: Item[][][] = [];
  while (p.peek().t === 'id' && (p.peek() as { v: string }).v === 'unless') {
    p.next();
    negs.push(sideOf(p));
  }
  if (p.peek().t !== 'eof') throw new ReadError(`unexpected text at ${p.peek().at}`);
  return { lhs, guard, rhs, negs };
}

/** Where a carrier's nodes and sites were written. */
export interface Sources {
  nodes: Map<Id, MemberItem>;
  sites: (MemberItem | null)[];
  /** Each outer name, as written (`_…` for a port left unwritten: any link). */
  names: Map<Id, string>;
  /** Each computed value, as written. */
  formulas?: Map<Id, string>;
}

/** A ground state: every link an edge. */
export function buildState(regions: Item[][], sig: Signature): { carrier: Carrier; sources: Sources } {
  const b = new Builder(sig, 'state', { node: 0, edge: 0, name: 0 }, new Map());
  regions.forEach((items, r) => b.region(items, r));
  return { carrier: b.carrier(regions.length, []), sources: { nodes: b.source, sites: b.siteSource, names: new Map() } };
}

export const readState = (src: string, sig: Signature): Carrier => buildState(parseState(src), sig).carrier;

export interface RuleOptions {
  /** A number, or an expression over the redex's sites, evaluated at each spot (as text). */
  rate?: number | string;
  /** A redex site, by name, that the reactum writes twice and divides between its places (F61). */
  split?: string;
}

/** A rule, `redex => reactum unless negative …`. */
export function buildRule(
  name: string,
  ast: RuleAst,
  sig: Signature,
  opts: RuleOptions = {},
): { rule: Rule; redex: Sources; reactum: Sources; negatives: Sources[] } {
  const { lhs, rhs, negs } = ast;
  const ids: Ids = { node: 0, edge: 0, name: 0 };
  const outer = new Map<string, Id>();
  if (lhs.length !== rhs.length) throw new ReadError('redex and reactum have different numbers of regions');

  const redex = new Builder(sig, 'redex', ids, outer);
  lhs.forEach((items, r) => redex.region(items, r));
  const reactum = new Builder(sig, 'reactum', ids, outer);
  reactum.readSites = new Map(redex.sites.map((x, i) => [x.name, i]));
  reactum.readRests = redex.rests;
  reactum.readNamed = redex.named;
  rhs.forEach((items, r) => reactum.region(items, r));
  const guard = ast.guard ? toExpr(ast.guard, reactum.readSites, redex.rests, redex.named) : undefined;
  let rate: number | undefined;
  let rateExpr: Expr | undefined;
  if (typeof opts.rate === 'number') rate = opts.rate;
  else if (typeof opts.rate === 'string' && opts.rate.trim()) {
    const n = Number(opts.rate);
    if (Number.isFinite(n)) rate = n;
    else {
      try {
        rateExpr = toExpr(parseValue(opts.rate), reactum.readSites, redex.rests, redex.named);
      } catch (e) {
        throw new ReadError(`rate: ${(e as Error).message}`);
      }
    }
  }

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

  // a site divided between its two places (F61): written exactly twice in the reactum
  let split: number | undefined;
  if (opts.split !== undefined) {
    const name = opts.split.replace(/^"|"$/g, '').replace(/^\?/, '');
    split = redexSite.get(name);
    if (split === undefined) throw new ReadError(`split: ?${name} is no redex site`);
    const uses = sites.filter((i) => i === split).length;
    if (uses !== 2) throw new ReadError(`split: ?${name} is written ${uses} times in the reactum, not twice`);
  }

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

  // a negative extends the redex: the redex's nodes, edges, sites and names, and what it adds. PROVISIONAL: the
  // spec has a negative keep the redex's faces exactly; here it may add sites and names of its own, so what it
  // adds can leave attributes and ports unwritten (anything there), as a redex can.
  const negSources: Sources[] = [];
  const negatives = negs.map((regions) => {
    const nb = new Builder(sig, 'negative', ids, outer, redex.named, new Set(redex.sites.map((s) => s.name)));
    nb.edgeNames = new Map(redex.edgeNames);
    regions.forEach((items, r) => nb.region(items, r));
    negSources.push({ nodes: nb.source, sites: [...R.sites.map(() => null), ...nb.siteSource], names: new Map([...nb.negOuter].map(([n, x]) => [x, n])) });
    return {
      ...R,
      inner: { ...R.inner, places: [...R.inner.places, ...nb.sites.map(() => sig.id('Place'))] },
      outer: { ...R.outer, names: [...R.outer.names, ...[...nb.negOuter.values()].map((x) => [x, sig.id('Link')] as [Id, Id])] },
      nodes: [...R.nodes, ...nb.nodes],
      edges: [...R.edges, ...nb.edges],
      sites: [...R.sites, ...nb.sites.map((x) => x.parent)],
      siteKeys: [...R.siteKeys, ...nb.sites.map((x) => x.key)],
    };
  });

  const nameOf = new Map([...outer].map(([n, x]) => [x, n]));
  return {
    rule: { name, redex: R, reactum: X, sites, kept, keptEdges, negatives, rate, rateExpr, guard, computed: reactum.computed, ...(split !== undefined ? { split } : {}) },
    redex: { nodes: redex.source, sites: redex.siteSource, names: nameOf },
    reactum: {
      nodes: reactum.source,
      sites: reactum.siteSource,
      names: nameOf,
      formulas: new Map(reactum.computed.map((c) => [c.node, valueText(reactum.source.get(c.node)!.value)])),
    },
    negatives: negSources,
  };
}

export const readRule = (name: string, src: string, sig: Signature, opts: RuleOptions = {}): Rule =>
  buildRule(name, parseRule(src), sig, opts).rule;

// ── writing the tree back ──────────────────────────────────────────────────────────────────────────────────

const keyOut = (k: Scalar): string =>
  'text' in k ? (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.text) && !['true', 'false', 'unless'].includes(k.text) ? k.text : JSON.stringify(k.text)) : 'int' in k ? `${k.int}` : JSON.stringify(k);

const litOut = (s: Scalar): string =>
  'int' in s ? `${s.int}` : 'float' in s ? (Number.isInteger(s.float) ? s.float.toFixed(1) : `${s.float}`) : 'text' in s ? JSON.stringify(s.text) : `${s.bool}`;

export function valueText(v: Value): string {
  switch (v.k) {
    case 'site': return `?${v.name}${v.attr ? `.${v.attr}` : ''}`;
    case 'points': return `(${v.items.map(valueText).join(' | ')})`;
    case 'link': return `~${v.name}`;
    case 'free': return '!';
    case 'lit': return litOut(v.v);
    case 'expr':
      return exprText(v, 0);
    case 'term':
      return `${v.head}${v.attrs.length ? `[${v.attrs.map(itemText).join(' | ')}]` : ''}${v.body !== null ? `(${v.body.map(itemText).join(' | ')})` : ''}`;
  }
}

function exprText(v: Value, outer: number): string {
  if (v.k !== 'expr') return valueText(v);
  if (v.op in FUNCTIONS) return `${v.op}[${v.args.map((a) => exprText(a, 0)).join(' ')}]`;
  if (v.op === 'neg') return `-${exprText(v.args[0], 7)}`;
  if (v.op === 'not') return `not ${exprText(v.args[0], 7)}`;
  const bp = BP[v.op];
  const text = `${exprText(v.args[0], bp)} ${v.op} ${exprText(v.args[1], bp + 1)}`;
  return bp < outer ? `(${text})` : text;
}

export function itemText(it: Item): string {
  if (it.k === 'edge') return `~${it.name} :: ${it.type}`;
  return `${it.key ? `${keyOut(it.key)} = ` : ''}${it.named ? `?${it.named} = ` : ''}${valueText(it.value)}`;
}

/** A side written out: regions by `||`, a region's items a line each. */
export function sideText(regions: Item[][], indent = ''): string {
  return regions.map((items) => items.map(itemText).join(`\n${indent}`) || '()').join(`\n${indent}|| `);
}

export const stateText = (regions: Item[][]) => sideText(regions);

export function ruleText(ast: RuleAst): string {
  const one = (side: Item[][]) => side.map((items) => items.map(itemText).join(' | ') || '()').join(' || ');
  return `${one(ast.lhs)}${ast.guard ? ` where ${valueText(ast.guard)}` : ''}\n  => ${one(ast.rhs)}${ast.negs.map((n) => `\n  unless ${one(n)}`).join('')}`;
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

  /** A node; `slot`, the type its attribute slot declares, so a scalar of exactly that type is written bare. */
  const node = (n: Node, slot?: Id): string => {
    const head = sig.name(n.type);
    if (typeof n.payload === 'object') {
      const lit = scalarText(n.payload.scalar);
      return head === literalType(n.payload.scalar) || n.type === slot ? lit : `${head}(${lit})`;
    }
    const kids = kidsOf({ node: n.id });
    const attrs = [
      // a group of no points is written as nothing (unwritten, a port of any arity holds none)
      ...n.ports.filter((grp) => grp.points.length > 0).map(
        (grp) =>
          `${keyText(grp.key)} = ${grp.points.length === 1 ? linkName(grp.points[0][1].target) : `(${grp.points.map(([, p]) => linkName(p.target)).join(' ')})`}`,
      ),
      ...kids.filter((c) => isAttr(c.member)).map((c) => {
        const k = memberScalar(c.member)!;
        const slot = 'text' in k ? sig.get(n.type).attrs.find((a) => a.key === k.text)?.type : undefined;
        return `${keyText(k)} = ${node(c, slot)}`;
      }),
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
