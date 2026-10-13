/**
 * Edits, as changes to the text's tree: add a node, move it, keep it across a rule, link two ports, add a site, set
 * an attribute. Each works on the items the reader built the carrier from (`Sources`), so what the 3-D editor does
 * is always also a text, with the names the author chose.
 */

import type { Item, MemberItem, RuleAst, Term, Value } from '../engine/text';
import type { Signature } from '../engine/signature';
import type { Scalar } from '../engine/carrier';

export type Side = 'state' | 'redex' | 'reactum';

/** Where an item stands: the list holding it, and the term whose body (or attributes) that list is. */
export interface Place {
  list: Item[];
  owner: Term | null;
}

/** Every term in a tree, each with the list it stands in. */
export function* walk(regions: Item[][]): Generator<{ item: MemberItem; list: Item[]; owner: Term | null }> {
  function* go(list: Item[], owner: Term | null): Generator<{ item: MemberItem; list: Item[]; owner: Term | null }> {
    for (const it of list) {
      if (it.k !== 'member') continue;
      yield { item: it, list, owner };
      if (it.value.k === 'term') {
        yield* go(it.value.attrs, it.value);
        if (it.value.body) yield* go(it.value.body, it.value);
      }
    }
  }
  for (const r of regions) yield* go(r, null);
}

export function locate(regions: Item[][], item: Item): Place | null {
  for (const r of regions) if (r.includes(item)) return { list: r, owner: null };
  for (const { item: it } of walk(regions))
    if (it.value.k === 'term') {
      if (it.value.attrs.includes(item)) return { list: it.value.attrs, owner: it.value };
      if (it.value.body?.includes(item)) return { list: it.value.body, owner: it.value };
    }
  return null;
}

const remove = (list: Item[], item: Item) => {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
};

/** Where a drop lands: inside a term, or at a region's top. */
export type Target = { term: Term } | { region: Item[] };

function put(target: Target, item: Item) {
  if ('term' in target) (target.term.body ??= []).push(item);
  else target.region.push(item);
}

const literalOf = (sig: Signature, type: number): Scalar => {
  const k = sig.get(type).kind;
  return k === 'int' ? { int: 0 } : k === 'float' ? { float: 0 } : k === 'bool' ? { bool: false } : { text: '' };
};

/** A fresh node of a type: in a state or a reactum with its attributes at their zero; in a redex, matching any. */
export function newTerm(sig: Signature, typeName: string, side: Side): MemberItem {
  const t = sig.get(sig.id(typeName));
  const attrs: Item[] =
    side === 'redex' ? [] : t.attrs.map((a) => ({ k: 'member', key: { text: a.key }, named: null, value: { k: 'lit', v: literalOf(sig, a.type) } }));
  return { k: 'member', key: null, named: null, value: { k: 'term', head: typeName, attrs, body: null, at: 0 } };
}

export function add(target: Target, item: MemberItem) {
  put(target, item);
}

/** Move an item into a new place, unless that would put it inside itself. */
export function move(regions: Item[][], item: MemberItem, target: Target): boolean {
  if ('term' in target && item.value.k === 'term' && (target.term === item.value || contains(item.value, target.term))) return false;
  const from = locate(regions, item);
  if (!from) return false;
  remove(from.list, item);
  put(target, item);
  return true;
}

function contains(t: Term, inner: Term): boolean {
  for (const it of [...t.attrs, ...(t.body ?? [])])
    if (it.k === 'member' && it.value.k === 'term' && (it.value === inner || contains(it.value, inner))) return true;
  return false;
}

export function drop(regions: Item[][], item: Item) {
  const from = locate(regions, item);
  if (from) remove(from.list, item);
}

/** Every name a rule's nodes, sites or links use, so a fresh one can be chosen apart from them. */
function namesIn(ast: RuleAst | Item[][]): Set<string> {
  const out = new Set<string>();
  const sides = Array.isArray(ast) ? [ast] : [ast.lhs, ast.rhs, ...ast.negs];
  const val = (v: Value) => {
    if (v.k === 'site' || v.k === 'link') out.add(v.name);
  };
  for (const side of sides) {
    for (const r of side) for (const it of r) if (it.k === 'edge') out.add(it.name);
    for (const { item } of walk(side)) {
      if (item.named) out.add(item.named);
      val(item.value);
    }
  }
  return out;
}

export function fresh(ast: RuleAst | Item[][], stem: string): string {
  const used = namesIn(ast);
  for (let i = 1; ; i++) if (!used.has(`${stem}${i}`)) return `${stem}${i}`;
}

function cloneItem(it: MemberItem): MemberItem {
  return structuredClone(it);
}

/**
 * Keep a redex node: the same node, named on both sides, put into the reactum where it is dropped. What it holds
 * comes along, fresh (its own names cleared; its sites, the same sites: a use in the reactum).
 */
export function keep(ast: RuleAst, item: MemberItem, target: Target) {
  if (item.value.k !== 'term') return;
  item.named ??= fresh(ast, 'k');
  const copy = cloneItem(item);
  for (const { item: inner } of walk([[copy]])) if (inner !== copy) inner.named = null;
  // a node already kept is moved, not doubled
  for (const { item: other, list } of walk(ast.rhs)) if (other.named === item.named) remove(list, other);
  put(target, copy);
}

/** Take a redex node out; its kept counterpart in the reactum becomes a fresh node. */
export function dropFromRedex(ast: RuleAst, item: MemberItem) {
  drop(ast.lhs, item);
  if (item.named) for (const { item: other } of walk(ast.rhs)) if (other.named === item.named) other.named = null;
  // sites it held, and their uses
  const gone = new Set<string>();
  for (const { item: it } of walk([[item]])) if (it.value.k === 'site') gone.add(it.value.name);
  if (item.value.k === 'site') gone.add(item.value.name);
  for (const { item: it, list } of [...walk(ast.rhs)]) if (it.value.k === 'site' && gone.has(it.value.name)) remove(list, it);
}

/** A new site in the redex, at a target; its name. */
export function addSite(ast: RuleAst, target: Target): string {
  const name = fresh(ast, 'x');
  put(target, { k: 'member', key: null, named: null, value: { k: 'site', name } });
  return name;
}

/** A use of a redex site in the reactum. */
export function useSite(name: string, target: Target) {
  put(target, { k: 'member', key: null, named: null, value: { k: 'site', name } });
}

// ── ports ──────────────────────────────────────────────────────────────────────────────────────────────────

const portItem = (t: Term, port: string): MemberItem | undefined =>
  t.attrs.find((a): a is MemberItem => a.k === 'member' && !!a.key && 'text' in a.key && a.key.text === port);

/** What a port is written as: a link, free, or unwritten. */
export function portValue(t: Term, port: string): Value | null {
  return portItem(t, port)?.value ?? null;
}

/** Write a port (first among the attributes) or, `last`, an attribute (after them). */
export function setPort(t: Term, port: string, v: Value | null, last = false) {
  const it = portItem(t, port);
  if (v === null) {
    if (it) remove(t.attrs, it);
  } else if (it) it.value = v;
  else t.attrs[last ? 'push' : 'unshift']({ k: 'member', key: { text: port }, named: null, value: v });
}

function renameLink(sides: Item[][][], from: string, to: string) {
  for (const side of sides) {
    for (const r of side) for (let i = r.length - 1; i >= 0; i--) {
      const it = r[i];
      if (it.k === 'edge' && it.name === from) r.splice(i, 1);
    }
    for (const { item } of walk(side)) if (item.value.k === 'link' && item.value.name === from) item.value = { k: 'link', name: to };
  }
}

/**
 * Join two ports on one link. Joined already to links of their own, the two links become one. A new link in a
 * redex is a closed edge (these points and no others); elsewhere a link is an edge anyway.
 */
export function link(doc: Item[][] | RuleAst, side: Side, a: { t: Term; port: string; contract: string }, b: { t: Term; port: string }) {
  const sides = Array.isArray(doc) ? [doc] : [doc.lhs, doc.rhs, ...doc.negs];
  const here = Array.isArray(doc) ? doc : side === 'redex' ? doc.lhs : doc.rhs;
  const va = portValue(a.t, a.port), vb = portValue(b.t, b.port);
  const na = va?.k === 'link' ? va.name : null, nb = vb?.k === 'link' ? vb.name : null;
  let name = na ?? nb;
  if (na && nb && na !== nb) renameLink(sides, nb, na);
  if (!name) {
    name = fresh(doc, side === 'state' ? 'e' : 'b');
    if (side === 'redex') here[0].unshift({ k: 'edge', name, type: a.contract });
  }
  setPort(a.t, a.port, { k: 'link', name });
  setPort(b.t, b.port, { k: 'link', name });
}

/** Free a port: in a redex, cycling unwritten (any link) → free → unwritten. */
export function unlink(t: Term, port: string, side: Side) {
  const v = portValue(t, port);
  if (side === 'redex') setPort(t, port, v?.k === 'free' ? null : { k: 'free' });
  else setPort(t, port, { k: 'free' });
}

// ── attributes ─────────────────────────────────────────────────────────────────────────────────────────────

export function setAttr(t: Term, key: string, v: Value | null) {
  setPort(t, key, v, true); // attributes and ports are both written in `[]`, by key
}

export function attrValue(t: Term, key: string): Value | null {
  return portValue(t, key);
}
