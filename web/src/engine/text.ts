/**
 * Text: a reader and printer for the bigraph part of chrysalis's v004 syntax (`docs/SYNTAX.md`).
 *
 *   P | Q            merge: two places side by side in one region (a line break between items is `|` too)
 *   P || Q           two regions
 *   H[A](B)          a node of type H: ports and attributes A, members B
 *   k = t            a member at key k (in `[]`, an attribute; or, where H declares port k, a port)
 *   ~b               a link        ~b :: T   at a side's top level, a closed edge
 *   ~b :: T = V[k = v]   a closed edge holding a value (SYNTAX §8); in a pattern `k = ?x` binds a field, `k = 3`
 *                    meets it; `~b = V[…]`, in a rule's side, the value of a link the side names (§11; F97)
 *   ~b.k   ~ps.k     in an expression: a field of a redex link's value; within sum[?ps …], of each point's link's
 *   ?x   k = ?x      a site, anonymous or at key k (written twice in a reactum it copies; left out it drops)
 *   ?c = t           a matched node, named: named on both sides it is kept
 *   L => R unless N  a rule; each negative names the redex's nodes it extends
 *   R[x = E] = …     a rule's header: `rate`, `accept`, …, and values it names, read as ?x (F104)
 *   count[T(k = v) in ?p]   sum[T(k = ?x) in ?p -> E]   a query over the place ?p, a node the redex names (F105)
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
  type LinkValue,
  type Id,
  Index,
  type Member,
  type Node,
  type Parent,
  type PortGroup,
  type Scalar,
  emptyFace,
  handleKey,
  linkValue,
  isAttr,
  keyed,
  memberKey,
  scalarKey,
  memberScalar,
} from './carrier';
import type { Draw, LinkPattern, LinkWrite, Rule } from './rule';
import { TARGET } from './keyed';
import { type Expr, FUNCTIONS, NO_SITES, type ScalarKind, evaluate, keyedCountOf, kindOf, queriesOf, realDivision, sitesOf } from './expr';
import type { Signature } from './signature';

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'id'; v: string; nl: boolean; at: number }
  | { t: 'num'; v: number; float: boolean; nl: boolean; at: number }
  | { t: 'str'; v: string; nl: boolean; at: number }
  | { t: 'link'; v: string; attr?: string; nl: boolean; at: number }
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
      if (['||', '=>', '::', '==', '!=', '<=', '>=', '++', '<:', '->'].includes(two)) push({ t: 'sym', v: two, nl, at }), (i += 2);
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
        // `?ps.x`: in a fold over a rest of points, the far node's attribute x; `~t.k`, a field of a link's value, and
        // `~ps.k` in a fold, of the value of each point's link (F97)
        let attr: string | undefined;
        if (src[i] === '.') {
          ident.lastIndex = i + 1;
          const a = ident.exec(src);
          if (a) (attr = a[0]), (i = ident.lastIndex);
        }
        push(c === '~' ? { t: 'link', v: m[0], ...(attr ? { attr } : {}), nl, at } : { t: 'site', v: m[0], ...(attr ? { attr } : {}), nl, at });
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
  /** A link at a port; with `attr`, in an expression, a field of the value it holds (`~t.k`, F97). */
  | { k: 'link'; name: string; attr?: string }
  | { k: 'free' }
  /** An expression: an operator (or a function) applied to values. */
  | { k: 'expr'; op: string; args: Value[] }
  /**
   * A query (F105; SYNTAX §7, "A pattern in code is a query"): `count[T(…) in ?p]`, `sum[T(k = ?x) in ?p -> E]`, the
   * one-node pattern's occurrences within the place a redex node names, counted or each folded into a sum.
   */
  | { k: 'query'; fold: 'sum' | 'count'; pattern: Value; place: Value; body: Value | null };
export type Item =
  | { k: 'member'; key: Key | null; named: string | null; value: Value }
  /** `~b :: T`, a closed edge; `~b :: T = V[k = v | …]`, holding the value V (SYNTAX §8, F97). */
  | { k: 'edge'; name: string; type: string; value?: Term }
  /** `~b = V[…]`: in a pattern, the value of a link the side names (SYNTAX §11, `~l = ?v`); in a reactum, written on it. */
  | { k: 'linkValue'; name: string; value: Term };
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
    // ~b :: T  — a closed edge; ~b :: T = V — holding a value
    if (t.t === 'link' && !t.attr && this.isSym('::', 1)) {
      this.next();
      this.next();
      const ty = this.next();
      if (ty.t !== 'id') throw new ReadError(`a type must follow :: at ${ty.at}`);
      if (this.isSym('=') && !this.peek().nl) {
        this.next();
        return { k: 'edge', name: t.v, type: ty.v, value: this.linkValue(t.v) };
      }
      return { k: 'edge', name: t.v, type: ty.v };
    }
    // ~b = V  — the value a link holds
    if (t.t === 'link' && !t.attr && this.isSym('=', 1)) {
      this.next();
      this.next();
      return { k: 'linkValue', name: t.v, value: this.linkValue(t.v) };
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

  /** A link's value: a record, `V[k = v | …]` (F97: kaleidoscope's links hold records of scalars). */
  linkValue(name: string): Term {
    const at = this.peek().at;
    const v = this.value();
    if (v.k !== 'term' || v.body !== null) throw new ReadError(`~${name} = …: a link holds a record, written V[k = v | …], at ${at}`);
    return v;
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
      if (t.t === 'link' && !t.attr) items.push({ k: 'link', name: (this.next() as { v: string }).v });
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
        // `count[T(…) in ?p]`, `sum[T(k = ?x) in ?p -> E]`: a query over a place (F105)
        const q = this.peek();
        if (args.length === 1 && q.t === 'id' && q.v === 'in' && (t.v === 'sum' || t.v === 'count')) {
          this.next();
          const place = this.value();
          let body: Value | null = null;
          if (t.v === 'sum') {
            if (!this.isSym('->')) throw new ReadError(`sum[T(…) in ?p -> E]: what each occurrence adds follows ->, at ${this.peek().at}`);
            this.next();
            body = this.value();
          }
          while (this.isSym('|')) this.next();
          this.expect(']');
          return { k: 'query', fold: t.v, pattern: args[0], place, body };
        }
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
    if (t.t === 'link') return { k: 'link', name: t.v, ...(t.attr ? { attr: t.attr } : {}) };
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

/**
 * What a rule's expressions read of its links' values (F97): each variable a redex link's value pattern binds
 * (`~t :: T = V[k = ?v]`), and each redex link by name, as its handle in the redex (`e3`, `x1`), for `~t.k`.
 */
interface LinkScope {
  vars: Map<string, Expr>;
  handles: Map<string, string>;
  /**
   * The values a rule names in its header (F104; SYNTAX §7, `tally[g = …] = … => … ?g …`): `R[x = E] = …`, read as `?x`
   * wherever the rule's expressions read, each built once and shared, so it is worked out once per occurrence.
   */
  lets?: { values: Map<string, Value>; built: Map<string, Expr>; building: string[] };
}

/** A value the rule names, `?x` where its header has `x = E` (F104): `let[x E]`, built once. */
function letOf(name: string, sites: Map<string, number> | null, rests: Set<string>, named: Map<string, Id> | null, links: LinkScope): Expr {
  const L = links.lets!;
  const hit = L.built.get(name);
  if (hit) return hit;
  if (L.building.includes(name)) throw new ReadError(`the rule's values ${[...L.building.slice(L.building.indexOf(name)), name].join(' → ')} name each other`);
  L.building.push(name);
  let inner: Expr;
  try {
    inner = toExpr(L.values.get(name)!, sites, rests, named, links);
  } finally {
    L.building.pop();
  }
  const e: Expr = { op: 'let', args: [{ lit: { text: name } }, inner] };
  L.built.set(name, e);
  return e;
}

/** Within a query's body (F105): each variable its pattern binds, as the attribute it reads of the occurrence's node. */
let queryVars: Map<string, Expr> | null = null;
let queries = 0;

/** An expression as the engine evaluates it: sites by their index in the redex. */
function toExpr(v: Value, sites: Map<string, number> | null, rests: Set<string> = new Set(), named: Map<string, Id> | null = null, links: LinkScope | null = null): Expr {
  const sub = (x: Value) => toExpr(x, sites, rests, named, links);
  switch (v.k) {
    case 'lit':
      return { lit: v.v };
    case 'link': {
      if (!v.attr) break;
      // `~ps.k`: in a fold over a rest of points, the value of each point's link; `~t.k`, of a link the redex names
      if (rests.has(v.name)) return { restLink: v.name, key: v.attr };
      const h = links?.handles.get(v.name);
      if (h === undefined) throw new ReadError(`~${v.name}.${v.attr}: ~${v.name} is no link of the redex, nor a rest of points`);
      return { link: h, key: v.attr };
    }
    case 'site': {
      if (!v.attr && queryVars?.has(v.name)) return queryVars.get(v.name)!;
      if (rests.has(v.name)) return v.attr ? { restAttr: v.name, key: v.attr } : { rest: v.name };
      // a node the redex names: a host method's receiver or argument
      if (!v.attr && named?.has(v.name) && !sites?.has(v.name)) return { node: named.get(v.name)! };
      if (v.attr) throw new ReadError(`?${v.name}.${v.attr}: ?${v.name} is no rest of points`);
      // a field of a link's value, bound by the redex's pattern on the link (F97)
      if (links?.vars.has(v.name) && !sites?.has(v.name)) return links.vars.get(v.name)!;
      // a value the rule names in its header (F104)
      if (links?.lets?.values.has(v.name) && !sites?.has(v.name)) return letOf(v.name, sites, rests, named, links);
      if (!sites) throw new ReadError(`?${v.name}: a site is read only in a reactum or a guard`);
      const i = sites.get(v.name);
      if (i === undefined) throw new ReadError(`?${v.name} is no site of the redex`);
      return { site: i };
    }
    case 'query': {
      // a query over the place a redex node names (F105): its pattern one node, each attribute a literal, a value of the
      // occurrence (a join), or a variable it binds for the body
      if (v.place.k !== 'site' || v.place.attr || !named?.has(v.place.name)) throw new ReadError(`${v.fold}[… in ?p]: ?p is a node the redex names`);
      const pat = v.pattern;
      if (pat.k !== 'term') throw new ReadError(`${v.fold}[T(…) in ?p]: a query's pattern is one node, T(k = ?x | …)`);
      const qid = `#q${queries++}`;
      const filters: Expr[] = [], binds: Expr[] = [];
      const vars = new Map<string, Expr>();
      for (const it of [...pat.attrs, ...(pat.body ?? [])]) {
        if (it.k !== 'member' || !it.key || !('text' in it.key) || it.named || it.value.k === 'term')
          throw new ReadError(`${v.fold}[${pat.head}(…) in ?p]: a query's pattern is one node, each of its attributes k = ?x or k = a value`);
        const key = it.key.text, x = it.value;
        const fresh = x.k === 'site' && !x.attr && !sites?.has(x.name) && !named?.has(x.name) && !rests.has(x.name) && !links?.vars.has(x.name) && !links?.lets?.values.has(x.name) && !queryVars?.has(x.name);
        if (fresh) {
          if (vars.has(x.name)) throw new ReadError(`${v.fold}[${pat.head}(…) in ?p]: ?${x.name} is bound twice`);
          const at: Expr = { op: 'qattr', args: [{ lit: { text: qid } }, { lit: { text: key } }] };
          vars.set(x.name, at);
          binds.push({ lit: { text: key } });
        } else filters.push({ op: 'is', args: [{ lit: { text: key } }, sub(x)] });
      }
      let body: Expr | undefined;
      if (v.body) {
        const outer = queryVars;
        queryVars = new Map([...(outer ?? []), ...vars]);
        try {
          body = sub(v.body);
        } finally {
          queryVars = outer;
        }
      }
      return {
        op: 'query',
        args: [{ lit: { text: v.fold } }, { lit: { text: qid } }, { node: named.get(v.place.name)! }, { type: pat.head }, { op: 'class', args: filters }, { op: 'keys', args: binds }, ...(body ? [body] : [])],
      };
    }
    case 'expr':
      if (v.op === 'amount') {
        // amount[?p Type[k = v | …]] (F71): a node the redex names, and a class written as a pattern of literals and sites
        const [p, cls] = v.args;
        if (!p || p.k !== 'site' || !named?.has(p.name)) throw new ReadError('amount[?p Type[…]]: ?p is a node the redex names');
        if (!cls || cls.k !== 'term' || cls.body !== null) throw new ReadError('amount[?p Type[…]]: a type and its attributes');
        const filters: Expr[] = cls.attrs.map((it) => {
          if (it.k !== 'member' || !it.key || !('text' in it.key)) throw new ReadError('amount: each filter is `key = value`');
          return { op: 'is', args: [{ lit: { text: it.key.text } }, sub(it.value)] };
        });
        return { op: 'amount', args: [{ node: named.get(p.name)! }, { op: 'class', args: [{ type: cls.head }, ...filters] }] };
      }
      return { op: v.op, args: v.args.map(sub) };
    case 'term':
      // a bare type name: what count[?x Type] counts
      if (!v.attrs.length && v.body === null) return { type: v.head };
      throw new ReadError(`${v.head}[…]: only a bare type name stands in an expression`);
    default:
  }
  throw new ReadError('an expression is made of values, sites and operations');
}

// ── link values (F97) ──────────────────────────────────────────────────────────────────────────────────────

/** A link value's type: a declared type, its head. */
function valueType(sig: Signature, v: Term): Id {
  if (!sig.has(v.head)) throw new ReadError(`${v.head}[…]: no type ${v.head}`);
  return sig.id(v.head);
}

/** A field of a link value as written: `k = v`, its key a name. */
function fieldKey(it: Item, link: string): string {
  if (it.k !== 'member' || !it.key || !('text' in it.key) || it.named) throw new ReadError(`~${link}: each field of its value is written k = v`);
  return it.key.text;
}

/** The kind a field's declaration gives it (on the type or a supertype), or null where it declares none. */
function fieldKind(sig: Signature, type: Id, key: string): ScalarKind | null {
  for (const t of sig.ups(type)) {
    const a = sig.get(t).attrs.find((x) => x.key === key);
    if (a) {
      const k = sig.get(a.type).kind;
      return k === 'int' || k === 'float' || k === 'text' || k === 'bool' ? k : null;
    }
  }
  return null;
}

/** The defaults a link value's type declares for its fields. */
function fieldDefaults(sig: Signature, type: Id): [string, Scalar][] {
  const out = new Map<string, Scalar>();
  for (const t of [...sig.ups(type)].reverse()) for (const a of sig.get(t).attrs) if (a.dflt) out.set(a.key, a.dflt);
  return [...out];
}

/** A literal as the kind its field declares: a whole number written in a Float field is a float. */
function asKind(s: Scalar, kind: ScalarKind | null): Scalar {
  if (kind === 'float' && 'int' in s) return { float: s.int };
  if (kind && !(kind in s)) throw new ReadError(`a ${kind} field holds ${scalarKey(s)}`);
  return s;
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
  /** In a negative: its sites joined to a redex value by name (its own index, the redex site's name). */
  negJoins: [number, string][] = [];
  /** In a redex or a reactum: the values written on links (F97), resolved to handles once the side is built. */
  linkItems: { name: string; value: Term }[] = [];
  /** In a reactum: what its expressions read of the redex's links' values. */
  readLinks: LinkScope | null = null;
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

  /**
   * A side, its regions joined by `||`. Its closed edges are declared first, whichever region each is written in (F100):
   * an edge stands at the carrier's top level, beside the faces and outside every place (SYNTAX §13, "Edges are declared
   * at the top level"), so a link a region uses is the edge another region declares, not an outer name of its own.
   */
  side(regions: Item[][]) {
    for (const items of regions)
      for (const it of items) {
        if (it.k === 'edge') {
          const e = this.closedEdge(it.name, it.type);
          if (it.value) this.linkItem(it.name, it.value, e);
        } else if (it.k === 'linkValue') this.linkItem(it.name, it.value, null);
      }
    regions.forEach((items, r) => {
      for (const it of items) if (it.k === 'member') this.member(it, { region: r }, false, null);
    });
  }

  /** A link written with its value (F97): in a state, held by its edge now; in a rule's side, resolved once it is built. */
  linkItem(name: string, value: Term, edge: Id | null) {
    if (this.mode === 'negative') throw new ReadError(`~${name} = …: an unless meets no link's value (not yet)`);
    if (this.mode !== 'state') return void this.linkItems.push({ name, value });
    if (edge === null) throw new ReadError(`~${name} = …: a state's link is declared with its value, ~${name} :: T = V[…]`);
    const type = valueType(this.sig, value);
    const fields = new Map(fieldDefaults(this.sig, type));
    for (const it of value.attrs) {
      const k = fieldKey(it, name);
      const v = (it as MemberItem).value;
      const kind = fieldKind(this.sig, type, k);
      let lit: Scalar;
      try {
        lit = v.k === 'lit' ? v.v : evaluate(toExpr(v, null), NO_SITES, kind ?? kindOf(toExpr(v, null)));
      } catch (e) {
        throw new ReadError(`~${name}: ${k}: ${(e as Error).message}`);
      }
      fields.set(k, asKind(lit, kind));
    }
    this.edges.find((e) => e.id === edge)!.held = linkValue(type, [...fields]);
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
    // (in a reactum, `k = ?x` where ?x is no site of the redex but a value the rule names or a field of a link's value
    // is that value, computed: F104)
    const valueName = v.k === 'site' && !v.attr && this.mode === 'reactum' && !this.readSites?.has(v.name) && it.key !== null && (!!this.readLinks?.lets?.values.has(v.name) || !!this.readLinks?.vars.has(v.name));
    if (v.k === 'site' && !valueName) {
      if (this.mode === 'negative' && this.referSites.has(v.name)) {
        // a redex value named at an attribute of what a negative adds: a join (F68, F73), its own site equal to it
        if (!attr || it.key === null) return;
        this.negJoins.push([this.sites.length, v.name]);
        this.sites.push({ parent, key: member, name: `${v.name}#neg${this.sites.length}` });
        this.siteSource.push(it);
        return;
      }
      this.sites.push({ parent, key: it.key === null ? ANON : member, name: v.name });
      this.siteSource.push(it);
      return;
    }
    if (v.k === 'link' || v.k === 'free' || v.k === 'points') throw new ReadError(`a link stands only at a port`);
    if (v.k === 'expr' || v.k === 'query' || valueName) {
      const kinds: ScalarKind[] = ['int', 'float', 'text', 'bool'];
      const slotKind = slotType !== null && (kinds as string[]).includes(this.sig.get(slotType).kind) ? (this.sig.get(slotType).kind as ScalarKind) : null;
      if (this.mode === 'reactum') {
        // a value computed from what the redex's sites hold, when the rule fires
        const expr = toExpr(v, this.readSites ?? new Map(), this.readRests ?? new Set(), this.readNamed, this.readLinks);
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
    if (v.k !== 'term') throw new ReadError(`${valueText(v)}: no site here`);
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
        // (a reactum puts back as many rests as it names, their points one after another, F84; a redex meets one)
        const more: string[] = [];
        for (const it of items) {
          if (it.k === 'site') {
            if (rest && this.mode !== 'reactum') throw new ReadError(`port ${p.key} of ${v.head}: one rest of points at most in a pattern (which points each held would be ambiguous)`);
            if (rest) more.push(it.name);
            else rest = it.name;
          } else if (it.k === 'link') points.push([{ int: points.length }, { contract: p.contract, target: this.link(it.name, p.contract) }]);
          else if (it.k === 'free') points.push([{ int: points.length }, { contract: p.contract, target: this.freeEdge(p.contract) }]);
          else throw new ReadError(`port ${p.key} of ${v.head} takes links, ! and a rest`);
        }
        // unwritten: in a pattern, whatever points there are; on a kept node, those same points
        if (!w && (this.mode === 'redex' || this.mode === 'negative' || (this.mode === 'reactum' && named))) rest = `_${named ?? id}_${p.key}`;
        for (const r of rest ? [rest, ...more] : [])
          if (this.mode === 'state' || (this.mode === 'reactum' && !this.readRests?.has(r)))
            throw new ReadError(`?${r}: a rest of points is met in a redex, and put back in its reactum`);
        if (rest && this.mode !== 'reactum') {
          if (this.rests.has(rest)) throw new ReadError(`?${rest} is a rest of points twice`);
          this.rests.add(rest);
        }
        ports.push({ key: { text: p.key }, contract: p.contract, points, ...(rest ? { rest } : {}), ...(more.length ? { more } : {}) });
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
  b.side(regions);
  return { carrier: b.carrier(regions.length, []), sources: { nodes: b.source, sites: b.siteSource, names: new Map() } };
}

export const readState = (src: string, sig: Signature): Carrier => buildState(parseState(src), sig).carrier;

export interface RuleOptions {
  /** A number, or an expression over the redex's sites, evaluated at each spot (as text). */
  rate?: number | string;
  /** An acceptance probability over the redex's sites, evaluated when an occurrence is chosen (as text; F92). */
  accept?: string;
  /** A redex site, by name, that the reactum writes twice and divides between its places (F61). */
  split?: string;
  /** Draws of a class (F72), each `take[?p Type[filters] ?count Type[rewrites]]` (as text). */
  draws?: string[];
  /**
   * The values the rule names in its header (F104), `R[x = E] = …`: each read as `?x` by its guard, rate, acceptance,
   * draws and reactum (as text, or as read). A name its expressions never read is only a label.
   */
  lets?: Record<string, string | Value>;
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
  redex.side(lhs);
  // a join on a value (F60, F68): a variable written at two attribute sites of the redex meets only where they hold
  // equal values. Each later writing is its own site, renamed, and an equality joins it to the first; the reactum and
  // the rate read the first. (No index by value: the equality is tested on what the redex's structure meets, B5.)
  const joins: [number, number][] = [];
  const first = new Map<string, number>();
  redex.sites.forEach((x, i) => {
    const j = first.get(x.name);
    if (j === undefined) return void first.set(x.name, i);
    if (!('attr' in x.key) || !('attr' in redex.sites[j].key)) throw new ReadError('a redex site is written twice');
    joins.push([j, i]);
    x.name = `${x.name}#${i}`;
  });
  // the values the redex's links hold (F97): each met by a pattern on its link, `~t :: T = V[k = 5 | j = ?v]`, its
  // literal fields tested where the redex meets, its variables read by the guard, the rate and the reactum. A variable
  // written at two fields is a join, as at two attributes (F60)
  const handleOf = (b: Builder, name: string, side: string): Handle => {
    const e = b.edgeNames.get(name);
    if (e !== undefined) return { edge: e };
    const x = outer.get(name);
    if (x !== undefined) return { name: x };
    throw new ReadError(`~${name} = …: ~${name} is no link of the ${side}${side === 'reactum' ? ` (a link it keeps or makes is declared there, ~${name} :: T = V[…])` : ''}`);
  };
  const links: LinkScope = {
    vars: new Map(),
    handles: new Map([...[...redex.edgeNames].map(([n, e]): [string, string] => [n, `e${e}`]), ...[...outer].map(([n, x]): [string, string] => [n, `x${x}`])]),
  };
  if (opts.lets && Object.keys(opts.lets).length) {
    const values = new Map<string, Value>();
    for (const [k, x] of Object.entries(opts.lets)) {
      try {
        values.set(k, typeof x === 'string' ? parseValue(x) : x);
      } catch (e) {
        throw new ReadError(`${k}: ${(e as Error).message}`);
      }
    }
    links.lets = { values, built: new Map(), building: [] };
  }
  const linkPatterns: LinkPattern[] = [];
  const linkJoins: Expr[] = [];
  {
    const siteNames = new Set(redex.sites.map((x) => x.name));
    for (const { name, value } of redex.linkItems) {
      const link = handleOf(redex, name, 'redex');
      const hk = handleKey(link);
      if (linkPatterns.some((q) => handleKey(q.link) === hk)) throw new ReadError(`~${name}'s value is met twice`);
      const type = valueType(sig, value);
      const fields: [string, Scalar][] = [];
      for (const it of value.attrs) {
        const k = fieldKey(it, name), v = (it as MemberItem).value, kind = fieldKind(sig, type, k);
        if (v.k === 'site' && !v.attr) {
          if (siteNames.has(v.name) || redex.named.has(v.name) || redex.rests.has(v.name)) throw new ReadError(`?${v.name}: named in the redex already`);
          const x: Expr = { link: hk, key: k };
          const was = links.vars.get(v.name);
          if (was) linkJoins.push({ op: '==', args: [was, x] });
          else links.vars.set(v.name, x);
          continue;
        }
        let lit: Scalar;
        try {
          lit = v.k === 'lit' ? v.v : evaluate(toExpr(v, null), NO_SITES, kind ?? kindOf(toExpr(v, null)));
        } catch (e) {
          throw new ReadError(`~${name}: ${k}: a pattern's field is a literal or a variable (${(e as Error).message})`);
        }
        fields.push([k, asKind(lit, kind)]);
      }
      linkPatterns.push({ link, type, fields });
    }
  }
  // (a name the header gives a value is no name of the redex too: which one `?x` read would be ambiguous)
  for (const k of links.lets?.values.keys() ?? [])
    if (redex.sites.some((x) => x.name === k) || redex.named.has(k) || redex.rests.has(k) || links.vars.has(k))
      throw new ReadError(`?${k} is named in the redex and given a value in the rule's header (${k} = …): one name, one meaning`);
  const reactum = new Builder(sig, 'reactum', ids, outer);
  reactum.readSites = new Map(redex.sites.map((x, i) => [x.name, i]));
  reactum.readRests = redex.rests;
  reactum.readNamed = redex.named;
  reactum.readLinks = links;
  reactum.side(rhs);
  // the values the reactum writes on links (F97): a link it keeps or makes (`~t :: T = V[…]`), or an outer name's
  const linkWrites: LinkWrite[] = [];
  for (const { name, value } of reactum.linkItems) {
    const link = handleOf(reactum, name, 'reactum');
    if (linkWrites.some((w) => handleKey(w.link) === handleKey(link))) throw new ReadError(`~${name}'s value is written twice`);
    const type = valueType(sig, value);
    const fields = value.attrs.map((it): [string, Expr, ScalarKind] => {
      const k = fieldKey(it, name), v = (it as MemberItem).value, kind = fieldKind(sig, type, k);
      if (v.k === 'lit') {
        const lit = asKind(v.v, kind);
        return [k, { lit }, kind ?? kindOf({ lit })];
      }
      const x = toExpr(v, reactum.readSites, redex.rests, redex.named, links);
      return [k, x, kind ?? kindOf(x)];
    });
    const defaults = fieldDefaults(sig, type);
    linkWrites.push({ link, type, fields, ...(defaults.length ? { defaults } : {}) });
  }
  const written = ast.guard ? toExpr(ast.guard, reactum.readSites, redex.rests, redex.named, links) : undefined;
  const guard = [...joins.map(([a, b]): Expr => ({ op: '==', args: [{ site: a }, { site: b }] })), ...linkJoins].reduce<Expr | undefined>(
    (g, eq) => (g ? { op: 'and', args: [g, eq] } : eq),
    written,
  );
  let rate: number | undefined;
  let rateExpr: Expr | undefined;
  if (typeof opts.rate === 'number') rate = opts.rate;
  else if (typeof opts.rate === 'string' && opts.rate.trim()) {
    const n = Number(opts.rate);
    if (Number.isFinite(n)) rate = n;
    else {
      try {
        rateExpr = realDivision(toExpr(parseValue(opts.rate), reactum.readSites, redex.rests, redex.named, links));
      } catch (e) {
        throw new ReadError(`rate: ${(e as Error).message}`);
      }
    }
  }
  let accept: Expr | undefined;
  if (typeof opts.accept === 'string' && opts.accept.trim()) {
    try {
      accept = realDivision(toExpr(parseValue(opts.accept), reactum.readSites, redex.rests, redex.named, links));
    } catch (e) {
      throw new ReadError(`accept: ${(e as Error).message}`);
    }
  }

  // a rate is per spot (chrysalis D-a-rate-is-per-spot; boundary's B2; F70): a keyed entry of count n met by the redex
  // is n spots, so the rate as written is per molecule, multiplied here by each keyed node's count
  const perSpot: Expr[] = [];
  const target = redex.named.get(TARGET);
  // (a rate reading an entry's count is that entry's whole propensity as written, F75: not multiplied again)
  const readByRate = new Set(rateExpr ? sitesOf(rateExpr) : []);
  for (const nd of redex.nodes) {
    const ck = keyedCountOf(sig, nd.type);
    // (the entry a merge adds to is no reactant, F73)
    if (ck === null || nd.id === target) continue;
    const i = redex.sites.findIndex((x) => 'node' in x.parent && x.parent.node === nd.id && 'attr' in x.key && x.key.attr !== null && 'text' in x.key.attr && x.key.attr.text === ck);
    if (i >= 0 && readByRate.has(i)) continue;
    if (i >= 0) perSpot.push({ site: i });
    else {
      const lit = redex.nodes.find((c) => 'node' in c.parent && c.parent.node === nd.id && 'attr' in c.member && c.member.attr !== null && 'text' in c.member.attr && c.member.attr.text === ck);
      if (lit && typeof lit.payload === 'object') perSpot.push({ lit: lit.payload.scalar });
    }
  }
  if (perSpot.length) {
    const base: Expr = rateExpr ?? { lit: { float: rate ?? 1 } };
    rateExpr = perSpot.reduce<Expr>((a, x) => ({ op: '*', args: [a, x] }), base);
    rate = undefined;
  }

  // draws of a class (F72): each read as `take[?p Type[filters] count Type[rewrites]]`; the rule meets only where the
  // class holds the count (its amount, F71, guards it)
  const draws: Draw[] = [];
  let drawGuard: Expr | undefined;
  for (const text of opts.draws ?? []) {
    let v: Value;
    try {
      v = parseValue(text);
    } catch (e) {
      throw new ReadError(`draw: ${(e as Error).message}`);
    }
    if (v.k !== 'expr' || v.op !== 'take' || v.args.length !== 4) throw new ReadError('draw: take[?p Type[…] count Type[…]]');
    const [pv, cls, kv, rw] = v.args;
    if (pv.k !== 'site' || !redex.named.has(pv.name)) throw new ReadError('draw: ?p is a node the redex names');
    if (cls.k !== 'term' || rw.k !== 'term' || cls.body !== null || rw.body !== null) throw new ReadError('draw: a class and its rewrite, each Type[…]');
    // (put back as the class's type, or another keyed type: each attribute it keeps, and its rewrites)
    const pairs = (t: Term) => t.attrs.map((it): [string, Expr] => {
      if (it.k !== 'member' || !it.key || !('text' in it.key)) throw new ReadError('draw: each attribute is `key = value`');
      return [it.key.text, toExpr(it.value, reactum.readSites, redex.rests, redex.named, links)];
    });
    // (put back by each molecule's own type, where the rewrite names a style key no type has: `uncharged[]` puts a
    // molecule back as the keyed type its type's `uncharged` names, F77; every keyed type of the class must name one)
    let intoBy: string | undefined;
    if (!sig.has(rw.head)) {
      if (!sig.has(cls.head)) throw new ReadError(`draw: no type ${cls.head}`);
      const C = sig.id(cls.head);
      for (const t of sig.types.filter((x) => sig.sub(x.id, C) && keyedCountOf(sig, x.id) !== null)) {
        const to = t.style?.[rw.head];
        if (typeof to !== 'string' || !sig.has(to) || keyedCountOf(sig, sig.id(to)) === null) throw new ReadError(`draw: ${t.name} names no keyed type as its ${rw.head}`);
      }
      intoBy = rw.head;
    } else if (keyedCountOf(sig, sig.id(rw.head)) === null) throw new ReadError(`draw: ${rw.head} is no keyed type`);
    const d: Draw = {
      place: redex.named.get(pv.name)!, type: cls.head, filters: pairs(cls), count: toExpr(kv, reactum.readSites, redex.rests, redex.named, links), set: pairs(rw),
      ...(intoBy ? { intoBy } : rw.head !== cls.head ? { into: rw.head } : {}),
    };
    draws.push(d);
    const amount: Expr = { op: 'amount', args: [{ node: d.place }, { op: 'class', args: [{ type: d.type }, ...d.filters.map(([k, x]): Expr => ({ op: 'is', args: [{ lit: { text: k } }, x] }))] }] };
    const enough: Expr = { op: '>=', args: [amount, d.count] };
    drawGuard = drawGuard ? { op: 'and', args: [drawGuard, enough] } : enough;
  }
  // (the class holding enough is a factor of the rate, not a guard: an occurrence stands whatever the counts, so a change
  // of count re-rates it rather than finding it again, F74)
  if (drawGuard) {
    rateExpr = { op: '*', args: [rateExpr ?? { lit: { float: rate ?? 1 } }, { op: 'if', args: [drawGuard, { lit: { float: 1 } }, { lit: { float: 0 } }] }] };
    rate = undefined;
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
  // a literal the redex meets at a key of a kept node and the reactum writes there again, the same, is that same
  // scalar, kept (F89): a reaction restating `active = true` changes nothing there, and neither path makes it afresh
  {
    const computedIds = new Set((reactum.computed ?? []).map((c) => c.node));
    const literalAt = (g: Carrier, holder: Id) => {
      const m = new Map<string, Carrier['nodes'][number]>();
      for (const n of g.nodes)
        if ('node' in n.parent && n.parent.node === holder && isAttr(n.member) && keyed(n.member) && typeof n.payload === 'object' && !n.ports.length) m.set(memberKey(n.member), n);
      return m;
    };
    const hasKids = (g: Carrier, id: Id) => g.nodes.some((n) => 'node' in n.parent && n.parent.node === id);
    for (const [a, b] of [...kept]) {
      const before = literalAt(R, a), after = literalAt(X, b);
      for (const [key, x] of after) {
        const r = before.get(key);
        if (!r || computedIds.has(x.id) || r.type !== x.type || hasKids(R, r.id) || hasKids(X, x.id)) continue;
        if (typeof r.payload === 'object' && typeof x.payload === 'object' && scalarKey(r.payload.scalar) === scalarKey(x.payload.scalar)) kept.push([r.id, x.id]);
      }
    }
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
  const negGuards: (Expr | undefined)[] = [];
  const negatives = negs.map((regions) => {
    const nb = new Builder(sig, 'negative', ids, outer, redex.named, new Set(redex.sites.map((s) => s.name)));
    nb.edgeNames = new Map(redex.edgeNames);
    nb.side(regions);
    negSources.push({ nodes: nb.source, sites: [...R.sites.map(() => null), ...nb.siteSource], names: new Map([...nb.negOuter].map(([n, x]) => [x, n])) });
    negGuards.push(
      nb.negJoins.reduce<Expr | undefined>((g, [i, name]) => {
        const eq: Expr = { op: '==', args: [{ site: R.sites.length + i }, { site: redexSite.get(name)! }] };
        return g ? { op: 'and', args: [g, eq] } : eq;
      }, undefined),
    );
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

  // a query's pattern names a type, and attributes it declares (F105): a misspelling would count nothing, silently
  for (const e of [guard, rateExpr, accept, ...reactum.computed.map((c) => c.expr), ...linkWrites.flatMap((w) => w.fields.map(([, x]) => x)), ...draws.flatMap((d) => [d.count, ...d.filters.map(([, x]) => x), ...d.set.map(([, x]) => x)])])
    for (const q of queriesOf(e)) {
      if (!sig.has(q.type)) throw new ReadError(`a query's pattern: no type ${q.type}`);
      for (const k of q.keys) if (!fieldKind(sig, sig.id(q.type), k) && ![...sig.ups(sig.id(q.type))].some((t) => sig.get(t).attrs.some((a) => a.key === k))) throw new ReadError(`a query's pattern: ${q.type} has no attribute ${k}`);
    }
  const nameOf = new Map([...outer].map(([n, x]) => [x, n]));
  return {
    rule: {
      name, redex: R, reactum: X, sites, kept, keptEdges, negatives, rate, rateExpr, ...(accept ? { accept } : {}),
      guard,
      computed: reactum.computed,
      ...(split !== undefined ? { split } : {}),
      ...(draws.length ? { draws } : {}),
      ...(negGuards.some(Boolean) ? { negativeGuards: negGuards } : {}),
      ...(linkPatterns.length ? { linkPatterns } : {}),
      ...(linkWrites.length ? { linkWrites } : {}),
    },
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
    case 'link': return `~${v.name}${v.attr ? `.${v.attr}` : ''}`;
    case 'free': return '!';
    case 'lit': return litOut(v.v);
    case 'expr':
      return exprText(v, 0);
    case 'query':
      return `${v.fold}[${valueText(v.pattern)} in ${valueText(v.place)}${v.body ? ` -> ${valueText(v.body)}` : ''}]`;
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
  if (it.k === 'edge') return `~${it.name} :: ${it.type}${it.value ? ` = ${valueText(it.value)}` : ''}`;
  if (it.k === 'linkValue') return `~${it.name} = ${valueText(it.value)}`;
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
    // (a link of one point is free, `!`, unless it holds a value, which is written where it is declared: F97)
    if ('edge' in h && ix.pointsOn(h).length === 1 && !ix.edge.get(h.edge)?.held) return '!';
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
  const regions = g.outer.places.map((_, r) => [...members(kidsOf({ region: r })), ...sites(`r${r}`, false)]);
  // the links holding values, declared with them where they are first met, in the order they were named (F97)
  const declared: string[] = [];
  const heldText = (v: LinkValue) => {
    const fields = v.fields.map(([k, x]) => `${keyText({ text: k })} = ${scalarText(x)}`);
    return `${sig.name(v.type)}${fields.length ? `[${fields.join(' | ')}]` : ''}`;
  };
  for (const [k, name] of names) {
    if (k[0] !== 'e') continue;
    const e = ix.edge.get(Number(k.slice(1)));
    if (e?.held) declared.push(`${name} :: ${sig.name(e.contract)} = ${heldText(e.held)}`);
  }
  if (declared.length && regions.length) regions[0] = [...declared, ...regions[0]];
  const text = regions.map((items) => items.join(' | ') || '()').join(' || ');
  return text || '()';
}

export const emptyCarrier = (): Carrier => ({ inner: emptyFace(), outer: emptyFace(), nodes: [], edges: [], sites: [], names: [], siteKeys: [] });
