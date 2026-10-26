/**
 * Keyed moves that flow (F73; boundary's plan H9a). A rule whose reactum makes a keyed entry (F69) finds the entry at
 * that key or makes it: when the entry is there, the rule only adds to its count; when it is not, it makes a node. Read
 * as one rule it is structural every time, so a runtime that integrates affine rules as a flow can never flow it. So a
 * rule making one keyed entry, its key written in literals and the redex's own values, is read as two:
 *
 * - **merge** (the rule's own name): the entry at that key is in the redex (`?__t`, joined on its key, F68), and the
 *   reactum adds the count to it. Every node kept, only counts changed: affine where the rest of the rule is.
 * - **make** (`name+`): the rule as written, `unless` an entry stands at that key, making it.
 *
 * Exactly one of the two meets wherever the rule as written would, and each does what it would do there. The entry met
 * as the target is no reactant: its count does not multiply the rule's rate (F70).
 */
import type { Item, RuleAst, Value } from './text';
import type { Signature } from './signature';
import { keyedCountOf } from './expr';

/** The name the merge variant gives the entry it adds to. */
export const TARGET = '__t';

type Member = Extract<Item, { k: 'member' }>;
type Term = Extract<Value, { k: 'term' }>;

/** Where a fresh entry stands in the reactum: a top-level region, or inside a node the redex names. */
type Where = { region: number } | { named: string };

/** The two readings of a rule making one keyed entry, or null where it makes none (or more, or a key it cannot join). */
export function splitKeyed(ast: RuleAst, sig: Signature): { merge: RuleAst; make: RuleAst } | null {
  const fresh: { item: Member; where: Where; list: Item[]; i: number }[] = [];
  const walk = (items: Item[], where: Where) =>
    items.forEach((it, i) => {
      if (it.k !== 'member' || it.value.k !== 'term') return;
      const t = it.value;
      if (it.named === null && sig.has(t.head) && keyedCountOf(sig, sig.id(t.head)) !== null) fresh.push({ item: it, where, list: items, i });
      if (t.body && it.named !== null) walk(t.body, { named: it.named });
    });
  ast.rhs.forEach((items, r) => walk(items, { region: r }));
  if (fresh.length !== 1) return null;
  const { item, where } = fresh[0];
  const t = item.value as Term;
  const decl = sig.get(sig.id(t.head));
  const ck = keyedCountOf(sig, decl.id)!;

  // the key: every attribute but the count, as written (a literal or a site the redex binds) or as its default
  const written = new Map<string, Value>();
  for (const a of t.attrs) {
    if (a.k !== 'member' || !a.key || !('text' in a.key)) return null;
    written.set(a.key.text, a.value);
  }
  const key: [string, Value][] = [];
  for (const a of decl.attrs) {
    if (a.key === ck) continue;
    const v = written.get(a.key);
    if (v) {
      if (v.k !== 'lit' && !(v.k === 'site' && !v.attr)) return null;
      key.push([a.key, v]);
    } else if (a.dflt) key.push([a.key, { k: 'lit', v: a.dflt }]);
    else return null;
  }
  const count = written.get(ck);
  if (!count) return null;

  const attr = (k: string, value: Value): Item => ({ k: 'member', key: { text: k }, named: null, value });
  const entry = (named: string | null, extra: Item[]): Member => ({
    k: 'member',
    key: null,
    named,
    value: { k: 'term', head: t.head, attrs: [...key.map(([k, v]) => attr(k, v)), ...extra], body: null, at: t.at },
  });
  const clone = (x: RuleAst): RuleAst => structuredClone(x);
  // the redex's list of items where the entry would stand: a region's, or the body of the node it names
  const redexList = (side: Item[][], w: Where): Item[] | null => {
    if ('region' in w) return side[w.region] ?? null;
    let found: Item[] | null = null;
    const look = (items: Item[]) => {
      for (const it of items)
        if (it.k === 'member' && it.value.k === 'term') {
          if (it.named === w.named) found = it.value.body ?? (it.value.body = []);
          else if (it.value.body) look(it.value.body);
          if (found) return;
        }
    };
    side.forEach(look);
    return found;
  };
  // the region the named node stands in, for a negative naming it
  const regionOf = (side: Item[][], name: string): number => {
    const has = (items: Item[]): boolean => items.some((it) => it.k === 'member' && it.value.k === 'term' && (it.named === name || (it.value.body ? has(it.value.body) : false)));
    return side.findIndex(has);
  };

  // merge: the entry in the redex, its count added to. Its key: each literal as written, each of the redex's values
  // a variable of its own joined to it (`where`), so the reactum puts every site back once and only the count moves
  const merge = clone(ast);
  const mList = redexList(merge.lhs, where);
  if (!mList) return null;
  const own = key.map(([k, v]): [string, Value] => (v.k === 'site' ? [k, { k: 'site', name: `${TARGET}_${k}` }] : [k, v]));
  const joins = key.filter(([, v]) => v.k === 'site').map(([k, v]): Value => ({ k: 'expr', op: '==', args: [{ k: 'site', name: `${TARGET}_${k}` }, v] }));
  const target = (n: Value): Member => ({ k: 'member', key: null, named: TARGET, value: { k: 'term', head: t.head, attrs: [...own.map(([k, v]) => attr(k, v)), attr(ck, n)], body: null, at: t.at } });
  mList.push(target({ k: 'site', name: `${TARGET}n` }));
  const mFresh = findFresh(merge.rhs, item);
  if (!mFresh) return null;
  mFresh.list[mFresh.i] = target({ k: 'expr', op: '+', args: [{ k: 'site', name: `${TARGET}n` }, count] });
  merge.guard = [...(merge.guard ? [merge.guard] : []), ...joins].reduce<Value | null>((g, x) => (g ? { k: 'expr', op: 'and', args: [g, x] } : x), null);

  // make: as written, unless the entry stands there
  const make = clone(ast);
  const negative: Item[][] = make.lhs.map(() => []);
  if ('region' in where) negative[where.region].push(entry(null, []));
  else {
    const r = regionOf(make.lhs, where.named);
    if (r < 0) return null;
    const host = findNamed(make.lhs, where.named)!;
    negative[r].push({ k: 'member', key: null, named: where.named, value: { k: 'term', head: host.head, attrs: [], body: [entry(null, [])], at: host.at } });
  }
  make.negs = [...make.negs, negative];
  return { merge, make };
}

/** The same fresh entry in a copy of the reactum: by its place in the walk. */
function findFresh(side: Item[][], like: Member): { list: Item[]; i: number } | null {
  const target = JSON.stringify(like);
  let out: { list: Item[]; i: number } | null = null;
  const walk = (items: Item[]) =>
    items.forEach((it, i) => {
      if (out || it.k !== 'member' || it.value.k !== 'term') return;
      if (it.named === null && JSON.stringify(it) === target) out = { list: items, i };
      else if (it.value.body) walk(it.value.body);
    });
  side.forEach(walk);
  return out;
}

function findNamed(side: Item[][], name: string): Term | null {
  let out: Term | null = null;
  const walk = (items: Item[]) =>
    items.forEach((it) => {
      if (out || it.k !== 'member' || it.value.k !== 'term') return;
      if (it.named === name) out = it.value;
      else if (it.value.body) walk(it.value.body);
    });
  side.forEach(walk);
  return out;
}
