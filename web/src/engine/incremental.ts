/**
 * Incremental discovery: the occurrences of a system's rules, kept across reactions.
 *
 * A reaction changes a few nodes. An occurrence depends on the nodes it meets and on everything they hold (its
 * sites' contents feed its guard and its rate), so after a reaction an occurrence is stale exactly when one of its
 * nodes is a changed node or an ancestor of one: the upward closure of what changed, in the state before and after.
 * Those are dropped. New ones are found by searching anchored at each node of that closure, one redex node at a
 * time, so the work is proportional to what changed and what stands beside it, not to the state.
 *
 * "What changed": the nodes the transition names (removed, created, moved, copied, kept, met), and every node that
 * shares a link with one of them, before or after (a closed bond meets its points exactly).
 *
 * A rule whose occurrences can depend on more than that is rediscovered whole, every step: one with several
 * regions, a site at a root, or an unless adding something beside the match (at a root).
 *
 * The spec's `discover_local` asks this of an implementation; the tests hold it to the full search.
 */

import { type Carrier, type Id, Index, isAttr, keyed, memberKey, scalarKey } from './carrier';
import { evaluate, sitesOf } from './expr';
import { type Occurrence, discover, siteEnv, spotKey } from './match';
import type { Transition } from './react';
import type { Rule } from './rule';
import type { Signature } from './signature';

export interface LiveSpot {
  rule: Rule;
  occurrences: Occurrence[];
  rate: number;
}

/** An occurrence's identity: its rule, and where it sends each redex node and edge (in the redex's order, whatever order it was found in). */
const pairs = (xs: [Id, Id][]) => [...xs].sort((a, b) => a[0] - b[0]).map(([p, s]) => `${p}:${s}`).join(',');
const occKey = (o: Occurrence, withSites: boolean) =>
  `${o.rule}|${pairs(o.nodes)}|${pairs(o.edges)}${withSites ? `|${o.sites.map((x) => [...x].sort((a, b) => a - b).join('.')).join('/')}` : ''}`;

/**
 * Whether a rule's occurrences may keep stale site contents, refreshed when it fires: nothing reads its sites (no
 * guard, rate or computed value, no unless, no inner names), and no node holds more than one anonymous site. Then a
 * change among what a node's one site holds cannot change whether the rule meets there; only what the site holds,
 * which is found again when it is used. Returns, for such a rule, the redex nodes holding such a site.
 */
export function lazySites(rule: Rule): Set<number> | null {
  if (!local(rule) || rule.negatives.length || rule.redex.names.length) return null;
  // the sites an expression reads (a guard, a rate, a computed value): what those hold matters
  const read = new Set<number>([rule.guard, rule.rateExpr, ...(rule.computed ?? []).map((c) => c.expr)].flatMap((e) => (e ? sitesOf(e) : [])));
  const anon = new Map<number, number[]>();
  rule.redex.sites.forEach((s, i) => {
    if ('node' in s && !keyed(rule.redex.siteKeys[i])) (anon.get(s.node) ?? anon.set(s.node, []).get(s.node)!).push(i);
  });
  // a node's one anonymous site, read by nothing, absorbs whatever changes among what it holds
  const passive = new Set<number>();
  for (const [node, sites] of anon) if (sites.length === 1 && !read.has(sites[0])) passive.add(node);
  return passive;
}

/** Whether a rule's occurrences depend only on the nodes they meet and what those hold. */
export function local(rule: Rule): boolean {
  const R = rule.redex;
  if (R.outer.places.length !== 1) return false;
  if (R.sites.some((s) => 'region' in s)) return false;
  // a negative adding beside the match is local where what it adds is linked to the match: a change to it is a
  // change to the links of the nodes it is linked to, which counts them changed
  const own = new Set(R.nodes.map((n) => n.id));
  const redexNames = new Set(R.outer.names.map(([x]) => x));
  const redexEdges = new Set(R.edges.map((e) => e.id));
  for (const ng of rule.negatives)
    for (const n of ng.nodes) {
      if (own.has(n.id) || !('region' in n.parent)) continue;
      const tied = n.ports.some((g) => g.points.some(([, p]) => ('name' in p.target && redexNames.has(p.target.name)) || ('edge' in p.target && redexEdges.has(p.target.edge))));
      if (!tied) return false;
    }
  return true;
}

export class Discovery {
  private state: Carrier | null = null;
  private occs = new Map<string, { occ: Occurrence; spot: string; rule: Rule }>();
  private spots = new Map<string, LiveSpot & { keys: Set<string> }>();
  private byNode = new Map<Id, Set<string>>();
  private readonly isLocal: boolean[];
  /** For each rule whose site contents may go stale: the redex nodes holding its one anonymous site. */
  private readonly lazy: (Set<number> | null)[];

  constructor(
    readonly rules: Rule[],
    readonly sig: Signature,
  ) {
    this.isLocal = rules.map(local);
    this.lazy = rules.map(lazySites);
  }

  /** An occurrence as it stands now: where its rule's site contents may be stale, found again, from its nodes. */
  fresh(g: Carrier, rule: Rule, o: Occurrence): Occurrence {
    if (!this.lazy[this.rules.indexOf(rule)]) return o;
    const [now] = discover(g, rule, this.sig, { seed: new Map(o.nodes), seedEdges: new Map(o.edges), limit: 1 });
    return now ?? o;
  }

  /** Every live spot in `g`: kept from the last step where `g` is what it became, else found afresh. */
  live(g: Carrier): LiveSpot[] {
    if (g !== this.state) this.rebuild(g);
    return [...this.spots.values()].filter((s) => s.rate > 0 && Number.isFinite(s.rate));
  }

  private rebuild(g: Carrier) {
    this.occs.clear();
    this.spots.clear();
    this.byNode.clear();
    this.state = g;
    const ix = Index.of(g);
    for (const rule of this.rules) for (const o of discover(g, rule, this.sig, { index: ix })) this.add(o, rule, ix);
  }

  /** `g` became `next` by `t`: keep what still holds, find what is new. */
  advance(g: Carrier, next: Carrier, t: Transition) {
    if (g !== this.state) return this.rebuild(next);
    const before = Index.of(g), after = Index.of(next);

    // what changed; and where its links changed, what shares a link with it, before and after
    const changed = new Set<Id>([...t.removed, ...t.created, ...t.moved, ...t.kept, ...t.copied.map(([, c]) => c), ...t.occurrence.nodes.map(([, s]) => s)]);
    const relinked = new Set<Id>();
    for (const [ix, edges] of [[before, t.edgesRemoved], [after, t.edgesCreated]] as const) for (const e of edges) for (const p of ix.pointsOn({ edge: e })) relinked.add(p.node);
    const portsOf = (n: { ports: unknown } | undefined) => (n ? JSON.stringify(n.ports) : '');
    for (const id of changed) {
      const a = before.node.get(id), b = after.node.get(id);
      if ((a?.ports.length || b?.ports.length) && portsOf(a) !== portsOf(b)) relinked.add(id);
    }
    for (const ix of [before, after])
      for (const id of relinked) {
        changed.add(id);
        const n = ix.node.get(id);
        if (!n) continue;
        for (const grp of n.ports) for (const [, pt] of grp.points) for (const p of ix.pointsOn(pt.target)) changed.add(p.node);
      }
    // and everything that holds it
    const affected = new Set<Id>();
    for (const ix of [before, after])
      for (const id of changed) {
        let n = ix.node.get(id);
        while (n && !affected.has(n.id)) {
          affected.add(n.id);
          n = 'node' in n.parent ? ix.node.get(n.parent.node) : undefined;
        }
        if (!ix.node.get(id)) affected.add(id);
      }

    // the changed nodes and their parents, before and after: where a lazy rule's new occurrences can be
    const near = new Set<Id>(changed);
    for (const ix of [before, after])
      for (const c of changed) {
        const n = ix.node.get(c);
        if (n && 'node' in n.parent) near.add(n.parent.node);
      }
    // let go of what met them: for most rules, whatever met a changed node or anything holding one; for a rule
    // whose site contents may go stale, only what met a changed node, or met its parent where a change there
    // is not absorbed by that node's one site
    const had = new Map<Rule, number>(), lost = new Map<Rule, number>();
    for (const v of this.occs.values()) had.set(v.rule, (had.get(v.rule) ?? 0) + 1);
    const lazyOf = new Map(this.rules.map((r, i) => [r, this.lazy[i]]));
    const drop = (k: string) => {
      const r = this.occs.get(k)?.rule;
      if (r) lost.set(r, (lost.get(r) ?? 0) + 1);
      this.remove(k);
    };
    for (const id of affected)
      for (const k of [...(this.byNode.get(id) ?? [])]) {
        const v = this.occs.get(k);
        if (!v) continue;
        const lz = lazyOf.get(v.rule);
        if (!lz || changed.has(id)) {
          drop(k);
          continue;
        }
        // a lazy rule's node, holding a change: absorbed only by its one site, and only of what is not an attribute
        const pn = v.occ.nodes.find(([, s2]) => s2 === id)![0];
        const kids = [...changed].filter((c) => [before, after].some((ix) => {
          const n = ix.node.get(c);
          return !!n && 'node' in n.parent && n.parent.node === id;
        }));
        if (kids.length && (!lz.has(pn) || kids.some((c) => [before, after].some((ix) => { const n = ix.node.get(c); return !!n && isAttr(n.member); }))))
          drop(k);
      }
    // a rule that lost most of what it had is found again whole: one search, not one per anchor
    const whole = this.rules.map((rule, i) => !this.isLocal[i] || (lost.get(rule) ?? 0) * 2 > (had.get(rule) ?? 0));
    this.rules.forEach((rule, i) => {
      if (whole[i]) for (const [k, v] of [...this.occs]) if (v.rule === rule) this.remove(k);
    });

    this.state = next;
    // find again: anchored at each affected node, for each redex node it could be
    this.rules.forEach((rule, i) => {
      if (whole[i]) {
        for (const o of discover(next, rule, this.sig, { index: after })) this.add(o, rule, after);
        return;
      }
      const anchors = this.lazy[i] ? near : affected;
      for (const id of anchors) {
        const n = after.node.get(id);
        if (!n) continue;
        const lz = this.lazy[i];
        // (searched from itself for every redex node: a changed node always is; an affected one, for a rule that is not lazy)
        const parentAnchored = 'node' in n.parent && (changed.has(n.parent.node) || (!this.lazy[i] && anchors.has(n.parent.node)));
        for (const pn of rule.redex.nodes) {
          if (!this.sig.sub(n.type, pn.type)) continue;
          // an occurrence meeting this node below its parent meets the parent too, which is searched from itself
          if (parentAnchored && !('region' in pn.parent)) continue;
          if (!this.literalsAgree(rule, pn.id, after, id)) continue;
          // a parent anchored where its redex node has its one site: a change among what it holds is that site's,
          // so nothing new meets there
          if (lz && lz.has(pn.id) && !changed.has(id)) continue;
          for (const o of discover(next, rule, this.sig, { index: after, anchor: { pattern: pn.id, state: id } })) this.add(o, rule, after);
        }
      }
    });
  }

  /** Each redex node's literal attributes (`founder = "ab"`): what an anchor must have to be worth a search. */
  private literals = new Map<Rule, Map<Id, [string, string][]>>();

  private literalsAgree(rule: Rule, pn: Id, ix: Index, sn: Id): boolean {
    let byNode = this.literals.get(rule);
    if (!byNode) {
      byNode = new Map();
      const P = Index.of(rule.redex);
      for (const n of rule.redex.nodes) {
        const lits: [string, string][] = [];
        for (const c of P.children({ node: n.id }))
          if (isAttr(c.member) && keyed(c.member) && typeof c.payload === 'object') lits.push([memberKey(c.member), scalarKey(c.payload.scalar)]);
        byNode.set(n.id, lits);
      }
      this.literals.set(rule, byNode);
    }
    const lits = byNode.get(pn);
    if (!lits?.length) return true;
    const kids = ix.children({ node: sn });
    return lits.every(([mk, sk]) => kids.some((k) => memberKey(k.member) === mk && typeof k.payload === 'object' && scalarKey(k.payload.scalar) === sk));
  }

  private add(o: Occurrence, rule: Rule, ix: Index) {
    const k = occKey(o, !this.lazy[this.rules.indexOf(rule)]);
    if (this.occs.has(k)) return;
    const sk = spotKey(o);
    this.occs.set(k, { occ: o, spot: sk, rule });
    for (const [, s] of o.nodes) (this.byNode.get(s) ?? this.byNode.set(s, new Set()).get(s)!).add(k);
    let spot = this.spots.get(sk);
    if (!spot) {
      let rate = rule.rate ?? 1;
      if (rule.rateExpr) {
        try {
          rate = (evaluate(rule.rateExpr, siteEnv(ix, o.sites, this.sig), 'float') as { float: number }).float;
        } catch {
          rate = 0;
        }
      }
      spot = { rule, occurrences: [], rate, keys: new Set() };
      this.spots.set(sk, spot);
    }
    spot.occurrences.push(o);
    spot.keys.add(k);
  }

  private remove(k: string) {
    const v = this.occs.get(k);
    if (!v) return;
    this.occs.delete(k);
    for (const [, s] of v.occ.nodes) this.byNode.get(s)?.delete(k);
    const spot = this.spots.get(v.spot);
    if (!spot) return;
    spot.keys.delete(k);
    spot.occurrences = spot.occurrences.filter((o) => o !== v.occ);
    if (!spot.keys.size) this.spots.delete(v.spot);
  }
}
