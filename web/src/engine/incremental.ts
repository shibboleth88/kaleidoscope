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

import { type Carrier, type Handle, type Id, Index, type Node, handleKey, isAttr, keyed, memberKey, parentKey, scalarKey } from './carrier';
import { type Expr, acrossReads, foldsRest, keyedCountOf, queriesOf, readsQuery, readsAcross, readsAmount, readsLinks, sitesOf, withinPass } from './expr';
import { eventRates, eventSizes } from './events';
import { type Occurrence, discover, guardHolds, guardParts, spotKey } from './match';
import type { Transition } from './react';
import type { View, World } from './world';
import { type Rule, stillSites } from './rule';
import type { Signature } from './signature';
import { type Encounter, composeEncounter, encounter } from './encounter';
import { parentKey as placeKey } from './carrier';

export interface LiveSpot {
  rule: Rule;
  occurrences: Occurrence[];
  rate: number;
  /** Each occurrence's share of the rate, where the spot has several (F83, `events.ts`). */
  weights?: number[];
  /** Where it has several: each occurrence's event's size, kept until its occurrences change (`eventSizes`). */
  sizes?: number[];
  /** Its place in discovery's sum tree of rates (F91). */
  slot?: number;
  /** Its spot (`spotKey`), worked out once: what a policy orders spots by without working it out again. */
  key?: string;
  /**
   * An encounter rule's spots in one place, held as their components (F57): `rate` is their total, `occurrences` is
   * empty, and `Discovery.sample` composes one occurrence, chosen in proportion to its rate.
   */
  factored?: { encounter: Encounter; place: string; parts: LiveSpot[][] };
}

export interface DiscoveryOptions {
  /**
   * Which rules to hold factored where they are encounter rules (F57): their occurrences counted as the product of
   * their components' matches, never listed. A policy that reads occurrences one by one (the editor) asks for none.
   */
  factor?: (rule: Rule) => boolean;
}

/**
 * An occurrence's identity: its rule, and where it sends each redex node, edge and outer name (in the redex's order,
 * whatever order it was found in). Two occurrences meeting the same nodes by different links of an open name (a town's
 * two trade links, `~t = Flow[…]`, F102) are two.
 */
const pairs = (xs: [Id, Id][]) => [...xs].sort((a, b) => a[0] - b[0]).map(([p, s]) => `${p}:${s}`).join(',');
const namePairs = (xs: [Id, Handle][]) => (xs.length ? `|${[...xs].sort((a, b) => a[0] - b[0]).map(([x, h]) => `${x}:${handleKey(h)}`).join(',')}` : '');
const occKey = (o: Occurrence, withSites: boolean) =>
  `${o.rule}|${pairs(o.nodes)}|${pairs(o.edges)}${namePairs(o.names)}${withSites ? `|${o.sites.map((x) => [...x].sort((a, b) => a - b).join('.')).join('/')}` : ''}`;

/**
 * Whether a rule's occurrences may keep stale site contents, refreshed when it fires: nothing reads its sites (no
 * guard, rate or computed value, no unless, no inner names), and no node holds more than one anonymous site. Then a
 * change among what a node's one site holds cannot change whether the rule meets there; only what the site holds,
 * which is found again when it is used. Returns, for such a rule, the redex nodes holding such a site.
 */
export function lazySites(rule: Rule): Set<number> | null {
  if (!local(rule) || rule.negatives.length || rule.redex.names.length) return null;
  // the sites an expression reads (a guard, a rate, a computed value): what those hold matters
  const read = new Set<number>([rule.guard, rule.rateExpr, rule.accept, ...(rule.computed ?? []).map((c) => c.expr)].flatMap((e) => (e ? sitesOf(e) : [])));
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
/**
 * Whether a redex's regions are all joined by its closed edges (F86): then every occurrence is one connected match,
 * met from any node of it by its links, as a one-region redex is from any node by its places; a commit can make or
 * break one only by changing a node it meets (or what holds one), so it is found again by anchored search, as a
 * one-region redex is.
 */
function regionsLinked(R: Carrier): boolean {
  const byId = new Map(R.nodes.map((n) => [n.id, n]));
  const regionOf = (n: Carrier['nodes'][number]): number => ('node' in n.parent ? regionOf(byId.get(n.parent.node)!) : n.parent.region);
  const up = R.outer.places.map((_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
  // a closed edge joins the regions its points stand in, and so does an open name met in more than one (F98): a name
  // binds every point on it to one link of the state, so the match is as connected as by an edge, though the link's
  // other points stand outside it
  const firstOn = new Map<string, number>();
  for (const n of R.nodes)
    for (const g of n.ports)
      for (const [, p] of g.points) {
        const key = 'edge' in p.target ? `e${p.target.edge}` : 'name' in p.target ? `n${p.target.name}` : null;
        if (key === null) continue;
        const r = regionOf(n), seen = firstOn.get(key);
        if (seen === undefined) firstOn.set(key, r);
        else up[find(seen)] = find(r);
      }
  return R.outer.places.every((_, i) => find(i) === find(0));
}

export function local(rule: Rule): boolean {
  const R = rule.redex;
  if (R.outer.places.length !== 1 && !regionsLinked(R)) return false;
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

/**
 * What a rule reads across links (F101): for each rest its expressions fold over the far nodes' attributes of, the redex
 * group the rest stands on (its owner's type, the group's key and contract) and the attribute keys read there (member
 * keys), or 'all'. 'unknown' where that is not known by rest (a host method reading across its receiver's links).
 */
export interface AcrossRead {
  owner: Id;
  group: string;
  contract: Id;
  keys: Set<string> | 'all';
}
export function acrossOf(rule: Rule): AcrossRead[] | 'unknown' {
  const reads = new Map<string, Set<string> | 'all'>();
  for (const e of [rule.guard, rule.rateExpr, ...(rule.computed ?? []).map((c) => c.expr)]) if (acrossReads(e, reads) === 'unknown') return 'unknown';
  const out: AcrossRead[] = [];
  for (const [rest, keys] of reads) {
    let at: AcrossRead | undefined;
    for (const pn of rule.redex.nodes)
      for (const g of pn.ports)
        if (g.rest === rest)
          at = { owner: pn.type, group: scalarKey(g.key), contract: g.contract, keys: keys === 'all' ? 'all' : new Set([...keys].map((k) => memberKey({ attr: { text: k } }))) };
    if (!at) return 'unknown';
    out.push(at);
  }
  return out;
}

/**
 * The links a node's points joined or left between two of its states (F103), each with how many more points the node
 * has on it after than before: each point counted by its group's key and its link, a node absent having none. A point
 * renumbered in its group (F89) is no change; one moved to another group touches its link, by nothing.
 */
function touchedLinks(a: Node | undefined, b: Node | undefined): [Handle, number][] {
  const count = new Map<string, number>();
  const handles = new Map<string, Handle>();
  for (const [n, sign] of [[a, -1], [b, 1]] as const)
    for (const g of n?.ports ?? [])
      for (const [, pt] of g.points) {
        const hk = handleKey(pt.target), k = `${scalarKey(g.key)}|${hk}`;
        count.set(k, (count.get(k) ?? 0) + sign);
        handles.set(hk, pt.target);
      }
  // each link touched, and how many points the node has on it now more than before
  const out = new Map<string, number>();
  for (const [k, c] of count) {
    if (c === 0) continue;
    const hk = k.slice(k.indexOf('|') + 1);
    out.set(hk, (out.get(hk) ?? 0) + c);
  }
  return [...out].map(([hk, d]) => [handles.get(hk)!, d]);
}

/** The sites an expression reads the values of: `sitesOf`, less a site read only as what `count` counts (F99). */
function valueSitesOf(e: Expr): number[] {
  if (!('op' in e)) return sitesOf(e);
  if (e.op === 'count') return e.args.slice(1).flatMap(valueSitesOf);
  return e.args.flatMap(valueSitesOf);
}

/** A node's payload as matching compares it (`plan.ts`). */
const payloadKey = (n: { payload: Carrier['nodes'][number]['payload'] }) => (typeof n.payload === 'string' ? n.payload : `s${scalarKey(n.payload.scalar)}`);

/**
 * A sum tree (Fenwick) over spots' rates (F91): a spot's rate changed in O(log n), the total read in O(1), and the
 * spot holding a point of the total found in O(log n), so a policy drawing one reaction a step need not list every
 * live spot each step. A rate that is not positive and finite weighs nothing. Rebuilt exactly every so many changes,
 * so the float sums do not drift.
 */
class RateTree {
  private n = 1024;
  private tree = new Float64Array(this.n + 1);
  private w = new Float64Array(this.n);
  private changes = 0;
  readonly spots: (LiveSpot | undefined)[] = [];
  private free: number[] = [];
  sum = 0;

  clear() {
    this.tree.fill(0);
    this.w.fill(0);
    this.spots.length = 0;
    this.free.length = 0;
    this.sum = 0;
  }

  /** A slot for a spot, its weight zero until set. */
  place(spot: LiveSpot): number {
    let i = this.free.pop();
    if (i === undefined) {
      i = this.spots.length;
      if (i >= this.n) this.grow();
    }
    this.spots[i] = spot;
    return i;
  }

  release(i: number) {
    this.set(i, 0);
    this.spots[i] = undefined;
    this.free.push(i);
  }

  set(i: number, rate: number) {
    const v = rate > 0 && Number.isFinite(rate) ? rate : 0;
    const d = v - this.w[i];
    if (d === 0) return;
    this.w[i] = v;
    this.sum += d;
    for (let j = i + 1; j <= this.n; j += j & -j) this.tree[j] += d;
    if (++this.changes >= 1 << 16) this.rebuild();
  }

  /** The slot whose share of the total holds `u` (0 ≤ u < sum). */
  find(u: number): number {
    let i = 0;
    for (let step = this.n; step > 0; step >>= 1) {
      const j = i + step;
      if (j <= this.n && this.tree[j] <= u) {
        i = j;
        u -= this.tree[j];
      }
    }
    // (u at the very top of the total, or a slot of no weight met by rounding: the nearest weighed slot below)
    let k = Math.min(i, this.n - 1);
    while (k > 0 && this.w[k] === 0) k--;
    return k;
  }

  private grow() {
    const w = this.w;
    this.n *= 2;
    this.w = new Float64Array(this.n);
    this.w.set(w);
    this.rebuild();
  }

  private rebuild() {
    this.changes = 0;
    this.tree = new Float64Array(this.n + 1);
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      sum += this.w[i];
      for (let j = i + 1; j <= this.n; j += j & -j) this.tree[j] += this.w[i];
    }
    this.sum = sum;
  }
}

/** How many occurrences a local rule must lose in one commit before it is found again whole rather than anchored (F87). */
const WHOLE_AFTER = 16;

export class Discovery {
  private state: Carrier | null = null;
  // (an occurrence of a deferred guard's rule that could not fire is held dormant: in no spot, found again by its nodes, F99)
  private occs = new Map<string, { occ: Occurrence; spot: string; rule: Rule; dormant?: boolean }>();
  private spots = new Map<string, LiveSpot & { keys: Set<string> }>();
  private byNode = new Map<Id, Set<string>>();
  /** Of `byNode`, the occurrences that do not absorb a change below a node they meet (F95): a rule not lazy, or met there by a node holding no lazy site. */
  private byNodeStrict = new Map<Id, Set<string>>();
  private readonly isLocal: boolean[];
  /** For each rule whose site contents may go stale: the redex nodes holding its one anonymous site. */
  private readonly lazy: (Set<number> | null)[];
  /** Rules whose expressions read the far ends of a rest of points (`?ps.x`): a change there is a change to them. */
  private readonly across: boolean[];
  /** What each such rule reads across links, by the group its rest stands on (F101); null for a rule reading none. */
  private readonly acrossSpec: (AcrossRead[] | 'unknown' | null)[];
  /** Whether it reads across links where that decides what meets (a guard, a computed value), not only in its rate. */
  private readonly acrossMatch: boolean[];
  /** Every closed edge of every rule's patterns: its contract, its points, and whether it is joined (F103). */
  private readonly closedEdges: { contract: Id; points: number; joined: boolean }[] = [];
  /**
   * For each rule making queries over places (F105): each query's place (the redex node naming it), the type its pattern
   * meets, the member keys it reads of each node it meets, and whether it decides what meets (a guard, a computed value)
   * or only the rate. Null for a rule making none.
   */
  private readonly querySpecs: ({ place: Id; type: Id; keys: Set<string>; match: boolean }[] | null)[];
  /** The occurrences of rules making queries, by the state node each meets as a query's place. */
  private readonly queryAt = new Map<Id, Set<string>>();
  /**
   * For each rule, the types of the nodes its negatives add at a root, tied to the redex by a link (F103): a change at
   * or under such a node can block or free an occurrence met at the link's other end.
   */
  private readonly negativeRoots: Id[][];
  /**
   * Rules whose occurrences do not depend on values: no guard, no negative, no literal value in the redex. Where
   * only values change (a count moves, nothing is made, moved or broken), such a rule's occurrences all stand, and
   * only their rates need working out again.
   */
  private readonly valueFree: boolean[];
  /**
   * How each rule reads the values links hold (F97): `match` where they decide what meets (a pattern's literal field, or
   * a guard's conjunct or a value the reactum computes, matched, reading one); `types` where a pattern tests only the
   * value's type (its fields variables); `rate` where its rate reads one, or a deferred guard or computed value does
   * (F102); null where it reads none. A link's value rewritten in place stales exactly what reads it: found again
   * (`match`; `types` where the value's type changed), or put in or out of its spot and rated again (`rate`).
   */
  private readonly linkReads: ({ match: boolean; types: boolean; rate: boolean } | null)[];
  /** The plain spots' rates, summed (F91). */
  private readonly tree = new RateTree();
  /** Spots that lost an occurrence and kept others: rated again once the update is done (F83). */
  private readonly toRate = new Set<string>();
  /** How many occurrences each rule has: kept as they are added and removed. */
  private readonly held = new Map<Rule, number>();

  readonly rules: Rule[];
  /** The encounter rules, held factored, and the discovery of their components. */
  readonly encounters: Encounter[] = [];
  private readonly parts: Discovery | null = null;
  private readonly partOf = new Map<string, { enc: Encounter; index: number }>();
  /** For each rule, whether its guard is the rate's (F99). */
  private defer: boolean[] = [];

  constructor(
    rules: Rule[],
    readonly sig: Signature,
    opts: DiscoveryOptions = {},
  ) {
    if (opts.factor) {
      const plain: Rule[] = [];
      for (const r of rules) {
        const e = opts.factor(r) ? encounter(r, sig) : null;
        if (e && typeof e !== 'string') {
          this.encounters.push(e);
          e.parts.forEach((p, index) => this.partOf.set(p.name, { enc: e, index }));
        } else plain.push(r);
      }
      rules = plain;
      if (this.encounters.length) this.parts = new Discovery(this.encounters.flatMap((e) => e.parts), sig);
    }
    this.rules = rules;
    this.isLocal = rules.map(local);
    // a rule reading an amount (F71) reads its place's entries beyond its sites: never lazy, and a change to any keyed
    // entry is a change that can touch it (so its place, holding the change, is affected and searched again)
    // (an amount in a rate is re-rated where its place's entries change, F74; one in a guard or a computed value decides
    // what meets, and is found again)
    this.amountRates = rules.some((r) => readsAmount(r.rateExpr));
    this.amounts = rules.some((r) => [r.guard, ...(r.computed ?? []).map((c) => c.expr)].some(readsAmount));
    // (and one making a query over a place reads that place's members at any depth, whatever its sites hold: F105)
    this.lazy = rules.map((r) => ([r.guard, ...(r.computed ?? []).map((c) => c.expr)].some(readsAmount) || [r.guard, r.rateExpr, ...(r.computed ?? []).map((c) => c.expr)].some(readsQuery) ? null : lazySites(r)));
    this.querySpecs = rules.map((r) => {
      const at = (e: Expr | undefined, match: boolean) =>
        queriesOf(e).map((q) => ({ place: q.place, type: sig.id(q.type), keys: new Set(q.keys.map((k) => memberKey({ attr: { text: k } }))), match }));
      const out = [...[r.guard, ...(r.computed ?? []).map((c) => c.expr), ...(r.linkWrites ?? []).flatMap((w) => w.fields.map(([, x]) => x))].flatMap((e) => at(e, true)), ...at(r.rateExpr, false)];
      return out.length ? out : null;
    });
    this.across = rules.map((r) => [r.guard, r.rateExpr, ...(r.computed ?? []).map((c) => c.expr)].some(readsAcross));
    this.acrossSpec = rules.map((r, i) => (this.across[i] || [r.guard, r.rateExpr, ...(r.computed ?? []).map((c) => c.expr)].some(foldsRest) ? acrossOf(r) : null));
    // what a link's points joining or leaving it can change beyond the nodes that joined or left (F103): a pattern's
    // closed edge, which meets a link of exactly its points (or, joined to an inner name, of at least them); and a
    // negative's node standing at a root, tied to the redex by a link, which the node that joined could now be
    for (const r of rules)
      for (const P of [r.redex, ...r.negatives]) {
        const joined = new Set(P.names.filter((h): h is { edge: Id } => 'edge' in h).map((h) => h.edge));
        for (const e of P.edges) {
          const p = P.nodes.reduce((a, n) => a + n.ports.reduce((b, g) => b + g.points.filter(([, pt]) => 'edge' in pt.target && pt.target.edge === e.id).length, 0), 0);
          this.closedEdges.push({ contract: e.contract, points: p, joined: joined.has(e.id) });
        }
      }
    this.negativeRoots = rules.map((r) => {
      const own = new Set(r.redex.nodes.map((n) => n.id));
      return r.negatives.flatMap((ng) => ng.nodes.filter((n) => !own.has(n.id) && 'region' in n.parent && n.ports.length).map((n) => n.type));
    });
    this.acrossMatch = rules.map((r) => [r.guard, ...(r.computed ?? []).map((c) => c.expr)].some(readsAcross));
    this.valueFree = rules.map((r, i) => !r.guard && !r.negatives.length && !this.across[i] && !r.redex.nodes.some((n) => typeof n.payload === 'object'));
    // a guard's conjuncts that read only keyed attributes of one redex node are the rate's (F99): its occurrences are
    // matched with the rest of the guard and kept dormant where the whole fails, so a value those conjuncts read,
    // rewritten in place, is rated again, not searched. A conjunct joining two nodes' values (`?a == ?b`) prunes pairs
    // and stays matched; so does one reading a rest, an amount, a link's value or across links.
    // (and so are a conjunct reading only one redex link's value, and the values a reactum computes or writes from link
    // values, F102: a link's value rewritten in place is then rated again, not searched)
    const writes = (r: Rule) => (r.linkWrites ?? []).flatMap((w) => w.fields.map(([, x]) => x));
    this.defer = rules.map((r, i) => {
      const g = r.guard;
      const linkComputed = [...(r.computed ?? []).map((c) => c.expr), ...writes(r)].some(readsLinks);
      if ((!g && !linkComputed) || this.across[i] || (r.computed ?? []).some((c) => readsAmount(c.expr) || readsAcross(c.expr) || readsQuery(c.expr))) return false;
      const conjuncts = (e: Expr): Expr[] => ('op' in e && e.op === 'and' ? e.args.flatMap(conjuncts) : [e]);
      const hasRest = (e: Expr): boolean => 'rest' in e || 'restAttr' in e || 'restLink' in e || ('op' in e && e.args.some(hasRest));
      const linksOf = (e: Expr, out = new Set<string>()): Set<string> => {
        if ('link' in e) out.add(e.link);
        else if ('op' in e) for (const a of e.args) linksOf(a, out);
        return out;
      };
      const deferrable = (e: Expr) => {
        if (readsAmount(e) || readsAcross(e) || hasRest(e) || readsQuery(e)) return false;
        const links = linksOf(e);
        if (links.size) return links.size === 1 && !sitesOf(e).length;
        const at = new Set<Id>(), sites = sitesOf(e);
        for (const si of sites) {
          const p = r.redex.sites[si];
          if (!p || !('node' in p) || !keyed(r.redex.siteKeys[si])) return false;
          at.add(p.node);
        }
        return at.size === 1;
      };
      const all = g ? conjuncts(g) : [], kept = all.filter((c) => !deferrable(c));
      if (kept.length === all.length && !linkComputed) return false;
      guardParts.set(r, { match: kept.length ? kept.reduce((a, b) => ({ op: 'and', args: [a, b] })) : undefined });
      return true;
    });
    this.linkReads = rules.map((r, i) => {
      const pats = r.linkPatterns ?? [];
      // what decides what meets: a pattern's literal field, or a guard's conjunct (or a computed value) still matched;
      // a pattern of variables alone binds without constraining, but for its type
      const matched = this.defer[i] ? [guardParts.get(r)?.match] : [r.guard, ...(r.computed ?? []).map((c) => c.expr), ...writes(r)];
      const match = pats.some((p) => p.fields.length) || matched.some(readsLinks);
      const types = pats.length > 0;
      const rate = readsLinks(r.rateExpr) || (this.defer[i] && [r.guard, ...(r.computed ?? []).map((c) => c.expr), ...writes(r)].some(readsLinks));
      return match || types || rate ? { match, types, rate } : null;
    });
  }

  /** The places holding these keyed entries, or the entries holding these scalars (an amount reads them there, F74). */
  private placesOf(ns: (Node | undefined)[], ix: { node: { get(id: Id): Node | undefined } }): Id[] {
    const out = new Set<Id>();
    for (let n of ns) {
      if (n && typeof n.payload === 'object' && 'node' in n.parent) n = ix.node.get(n.parent.node);
      if (n && keyedCountOf(this.sig, n.type) !== null && 'node' in n.parent) out.add(n.parent.node);
    }
    return [...out];
  }

  /**
   * Whether a change of value at key `key` of a node of this type could change what meets (F76): a rule's literal at
   * that key, a guard's or a joined negative's site there, or a rule whose dependence on values is not confined to
   * keys (one reading across links, or an amount in a guard). A negative that only adds nodes tests presence, not
   * values, and a count no rule tests but in its rate only re-rates.
   */
  private keyed?: { type: Id; key: string | 'all'; rule: number }[] | 'all';
  // (each type and key answered once: the rules, and so the keys they read, are fixed; a flow's realization asks it for
  // every key it moved at every step, F79)
  private sensitiveAtCache = new Map<string, boolean>();
  private sensitiveAt(type: Id, key: string): boolean {
    if (this.keyed === undefined) this.keyed = this.valueKeys();
    if (this.keyed === 'all') return this.sensitive(type);
    const k = `${type}|${key}`;
    let v = this.sensitiveAtCache.get(k);
    if (v === undefined) {
      const keyed = this.keyed;
      v = keyed.some((x) => this.sig.sub(type, x.type) && (x.key === 'all' || x.key === key));
      this.sensitiveAtCache.set(k, v);
    }
    return v;
  }
  private valueKeys(): { type: Id; key: string | 'all'; rule: number }[] | 'all' {
    const out: { type: Id; key: string | 'all'; rule: number }[] = [];
    for (const [i, r] of this.rules.entries()) {
      if (this.valueFree[i]) continue;
      // a rule whose dependence on values is not confined to keys: every value of every node it meets (a rule reading
      // across links by its rests is: what it reads of far nodes is staled by `acrossOwners`, F101)
      if (this.acrossSpec[i] === 'unknown' || (this.amounts && [r.guard, ...(r.computed ?? []).map((c) => c.expr)].some(readsAmount))) {
        for (const pn of [r.redex, ...r.negatives].flatMap((P) => P.nodes)) out.push({ type: pn.type, key: 'all', rule: i });
        continue;
      }
      // (a deferred guard reads values the rate reads, F99: a change to one rates again, it does not search)
      const patterns: [Carrier, Expr | undefined][] = [[r.redex, this.defer[i] ? guardParts.get(r)?.match : r.guard], ...r.negatives.map((ng, k): [Carrier, Expr | undefined] => [ng, r.negativeGuards?.[k]])];
      for (const [P, g] of patterns) {
        const byId = new Map(P.nodes.map((n) => [n.id, n]));
        // literals at a node's attributes
        for (const n of P.nodes) {
          if (typeof n.payload !== 'object') continue;
          const host = 'node' in n.parent ? byId.get(n.parent.node) : undefined;
          if (host) out.push({ type: host.type, key: isAttr(n.member) && keyed(n.member) ? memberKey(n.member) : 'all', rule: i });
          // (a literal standing on its own, no node's attribute: a value rewritten at a node of its type)
          else out.push({ type: n.type, key: 'all', rule: i });
        }
        // what a guard reads: its sites' values, but not a site only counted (`count[?ks Campaign]`): what a place
        // holds changes by nodes made, removed or moved, which are found again as such, never by a value in place
        for (const si of g ? valueSitesOf(g) : []) {
          const p = P.sites[si], k = P.siteKeys[si];
          const host = p && 'node' in p ? byId.get(p.node) : undefined;
          if (host) out.push({ type: host.type, key: k && keyed(k) ? memberKey(k) : 'all', rule: i });
          else for (const pn of P.nodes) out.push({ type: pn.type, key: 'all', rule: i });
        }
      }
    }
    return out;
  }

  /**
   * The rules a change of value at key `key` of a node of this type could change what meets (F88): those whose
   * literals or guards read that key there. 'all' where that is not known per rule.
   */
  private rulesAtCache = new Map<string, number[] | 'all'>();
  private rulesAt(type: Id, key: string): number[] | 'all' {
    if (this.keyed === undefined) this.keyed = this.valueKeys();
    if (this.keyed === 'all') return 'all';
    const k = `${type}|${key}`;
    let v = this.rulesAtCache.get(k);
    if (v === undefined) {
      v = [...new Set(this.keyed.filter((x) => this.sig.sub(type, x.type) && (x.key === 'all' || x.key === key)).map((x) => x.rule))];
      this.rulesAtCache.set(k, v);
    }
    return v;
  }

  /** Whether a rule that is not value-free could meet a node of this type: then a change to its values may change it. */
  private sensitiveTo = new Map<Id, boolean>();
  private amounts = false;
  private amountRates = false;
  private sensitive(type: Id): boolean {
    let v = this.sensitiveTo.get(type);
    if (v === undefined) {
      // (by the values each rule reads, F76: a negative that only adds tests presence, not a value)
      if (this.keyed === undefined) this.keyed = this.valueKeys();
      const k = this.keyed;
      v = (this.amounts && keyedCountOf(this.sig, type) !== null) || (k === 'all' ? this.rules.some((r) => r.redex.nodes.some((pn) => this.sig.sub(type, pn.type))) : k.some((x) => this.sig.sub(type, x.type)));
      this.sensitiveTo.set(type, v);
    }
    return v;
  }

  /**
   * The nodes whose occurrences, of each rule reading across links, read node `n`'s attribute at member key `key` ('all':
   * any; '+links': `n`'s being on the links `only` names, which every fold over them reads, F103) across a link (F101): each node on a link of `n` at a point of the group a rule's rest stands on, of its owner's
   * type. Only `n`'s links whose contract can type a point of that group are walked: a point's contract is within its
   * link's (SYNTAX §13, "a point whose contract is narrower than the one declared"), so the owner's point, within its
   * group's contract and the link's, makes the two meet (`meets`). A faith's link of hundreds of points is never walked
   * for a fold over a realm's `holds`. A rule whose reads are not known by rest ('unknown') reads everything on every
   * link of `n`, as before. `edges` is where the links' contracts are looked up; a link not there is walked.
   */
  private acrossOwners(ix: View, edges: Index, n: Node, key: string, into: Map<number, Set<Id>>, skip?: Set<Id>, only?: Set<string>) {
    const add = (i: number, m: Id) => {
      if (m === n.id || skip?.has(m)) return;
      (into.get(i) ?? into.set(i, new Set()).get(i)!).add(m);
    };
    this.acrossSpec.forEach((spec, i) => {
      if (!spec) return;
      if (spec === 'unknown') {
        for (const g of n.ports) for (const [, pt] of g.points) for (const p of ix.pointsOn(pt.target)) add(i, p.node);
        return;
      }
      for (const s of spec) {
        // (`+links`: n joined or left these links, which every fold over them reads; 'all': any of n's attributes)
        if (key === 'all' ? s.keys !== 'all' && !s.keys.size : key !== '+links' && s.keys !== 'all' && !s.keys.has(key)) continue;
        for (const g of n.ports)
          for (const [, pt] of g.points) {
            if (only && !only.has(handleKey(pt.target))) continue;
            const e = 'edge' in pt.target ? edges.edge.get(pt.target.edge) : undefined;
            if (e && !this.meets(e.contract, s.contract)) continue;
            for (const p of ix.pointsOn(pt.target)) {
              if (p.node === n.id || scalarKey(p.group) !== s.group) continue;
              const m = ix.node.get(p.node);
              if (m && this.sig.sub(m.type, s.owner)) add(i, p.node);
            }
          }
      }
    });
  }

  /**
   * The nodes on the links of `n`, for each rule a negative of which could add `n` at a root, tied to its redex by a link
   * (F103): an occurrence met there may be blocked or freed by what changed at or under `n`.
   */
  private negativeLinked(ix: View, n: Node | undefined, into: Map<number, Set<Id>>, skip?: Set<Id>) {
    if (!n?.ports.length) return;
    this.negativeRoots.forEach((types, i) => {
      if (!types.some((t) => this.sig.sub(n.type, t))) return;
      for (const g of n.ports)
        for (const [, pt] of g.points)
          for (const p of ix.pointsOn(pt.target)) if (p.node !== n.id && !skip?.has(p.node)) (into.get(i) ?? into.set(i, new Set()).get(i)!).add(p.node);
    });
  }

  /** Whether some rule's query reads, of a node of this type, a value at one of these keys (any, where none are given). */
  private queryReads(type: Id, keys?: Iterable<string>): boolean {
    const ks = keys ? [...keys] : null;
    return this.querySpecs.some((qs) => qs?.some((q) => this.sig.sub(type, q.type) && (!ks || ks.some((k) => q.keys.has(k)))));
  }

  /**
   * A value at key `key` of node `m` rewritten in place (F105): for each rule a query of which reads it, the occurrences
   * meeting, as that query's place, a node holding `m`: found again (where the query decides what meets) or rated again.
   */
  private queryStale(m: Node, key: string, ix: Index, into: Map<number, Set<string>>) {
    this.querySpecs.forEach((qs, i) => {
      const hits = qs?.filter((q) => q.keys.has(key) && this.sig.sub(m.type, q.type));
      if (!hits?.length) return;
      for (let up: Node | undefined = ('node' in m.parent ? ix.node.get(m.parent.node) : undefined); up; up = 'node' in up.parent ? ix.node.get(up.parent.node) : undefined)
        for (const k of this.queryAt.get(up.id) ?? []) {
          const v = this.occs.get(k);
          if (!v || v.rule !== this.rules[i]) continue;
          const at = up.id;
          if (hits.some((q) => v.occ.nodes.some(([pn, sn]) => pn === q.place && sn === at))) (into.get(i) ?? into.set(i, new Set()).get(i)!).add(k);
        }
    });
  }

  /** Whether some type is within both contracts: a point of the one could stand on a link of the other. */
  private meetsCache = new Map<string, boolean>();
  private meets(a: Id, b: Id): boolean {
    const k = `${a}|${b}`;
    let v = this.meetsCache.get(k);
    if (v === undefined) {
      v = this.sig.sub(a, b) || this.sig.sub(b, a) || this.sig.types.some((t) => this.sig.sub(t.id, a) && this.sig.sub(t.id, b));
      this.meetsCache.set(k, v);
    }
    return v;
  }

  /**
   * A world whose only change since the last step is to values: counts at the nodes `hosts` hold, moved in place
   * with their identities kept (`World.applyRepeated`). Where no rule that depends on values can meet those nodes,
   * every occurrence stands, and the rates of those meeting them are worked out again: work in proportion to what
   * reads the change, not a search. Otherwise, the full update. Rules in `unrated` keep their occurrences but not their
   * rates current: for a policy that does not read those rates (a flow working them out itself). Where `changed` names,
   * for a host, the member keys whose values changed, an occurrence whose rate reads none of them at that host is not
   * rated again: its rate is what it was.
   */
  advanceValues(world: World, before: View, t: Transition, hosts: Id[], unrated?: Set<Rule>, changed?: Map<Id, Set<string>>) {
    this.parts?.advanceValues(world, before, t, hosts, unrated, changed);
    if (world.g !== this.state) return this.rebuild(world.g);
    const ix = world.ix;
    // (where the keys that changed at a host are known, only a rule reading one of them there decides what meets, F76)
    // (and where a rule reads one of them across a link, F101: the update stales what folds over it)
    const anyAcross = this.acrossSpec.some(Boolean);
    if (hosts.some((h) => {
      const keys = changed?.get(h), n = ix.node.get(h)!, type = n.type;
      if (anyAcross && n.ports.length) {
        const owners = new Map<number, Set<Id>>();
        for (const k of keys ?? ['all']) this.acrossOwners(ix, ix, n, k, owners);
        if (owners.size) return true;
      }
      // (a value a query over a place holding the host reads: the update stales it, F105)
      if (this.queryReads(type, keys)) return true;
      return keys ? [...keys].some((k) => this.sensitiveAt(type, k)) : this.sensitive(type);
    })) return this.update(before, ix, world.g, t);
    // what a deferred guard reads changed at these hosts: occurrences put in or taken out of their spots (F99)
    this.recheck(hosts, ix);
    for (const k of this.toRate) {
      const spot = this.spots.get(k);
      if (spot) this.rateSpot(spot, ix, true);
    }
    this.toRate.clear();
    const done = new Set<string>();
    // a keyed entry's count changed: what reads an amount of its place is rated again (F74)
    const all = this.amountRates ? [...hosts, ...this.placesOf(hosts.map((h) => ix.node.get(h)!), ix)] : hosts;
    // (one pass, the state unchanged across it: each amount read once, F78)
    withinPass(() => {
      for (const h of all) {
        const keys = hosts.includes(h) ? changed?.get(h) : undefined;
        for (const e of this.ratedAt(h, unrated)) {
          if (done.has(e.spot)) continue;
          // where the keys that changed at this host are known: a rate that reads none of them there is as it was
          if (keys && (!e.reads || (e.reads !== 'all' && ![...keys].some((x) => (e.reads as Set<string>).has(x))))) continue;
          done.add(e.spot);
          const spot = this.spots.get(e.spot);
          if (spot) this.rateSpot(spot, ix);
        }
      }
    });
  }

  /**
   * The occurrences at a node whose rates discovery keeps (not `unrated`), each with what its rate reads there: made
   * once, and again only when the occurrences at that node change. A value change at a node met by thousands of
   * occurrences (a pool every flowing rule meets) then costs what reads it, not what meets it.
   */
  private ratedCache = new Map<Id, { version: number; unrated: Set<Rule> | undefined; list: { spot: string; reads: Set<string> | 'all' | undefined }[] }>();
  private nodeVersion = new Map<Id, number>();
  private ratedAt(h: Id, unrated: Set<Rule> | undefined) {
    const version = this.nodeVersion.get(h) ?? 0;
    const hit = this.ratedCache.get(h);
    if (hit && hit.version === version && hit.unrated === unrated) return hit.list;
    const list: { spot: string; reads: Set<string> | 'all' | undefined }[] = [];
    for (const k of this.byNode.get(h) ?? []) {
      const v = this.occs.get(k);
      // a policy that works these rules' rates out itself (a flow integrating them) asks that they be left as they were
      if (!v || unrated?.has(v.rule)) continue;
      const pn = v.occ.nodes.find(([, sn]) => sn === h)?.[0];
      list.push({ spot: v.spot, reads: pn === undefined ? 'all' : this.readsAt(v.rule).get(pn) });
    }
    this.ratedCache.set(h, { version, unrated, list });
    return list;
  }

  /**
   * What a rule's rate reads under each redex node: the member keys of the keyed sites its expression names, or 'all'
   * where it names an anonymous site there (whatever is held besides). A redex node absent from the map has nothing
   * under it that the rate reads.
   */
  private readsAtCache = new Map<Rule, Map<Id, Set<string> | 'all'>>();
  private readsAt(rule: Rule): Map<Id, Set<string> | 'all'> {
    let m = this.readsAtCache.get(rule);
    if (!m) {
      m = new Map();
      const R = rule.redex;
      // an amount reads what its place holds: everything there
      const places = (e: Expr | undefined): Id[] => (!e || !('op' in e) ? [] : e.op === 'amount' && 'node' in e.args[0] ? [e.args[0].node] : e.args.flatMap(places));
      for (const p of places(rule.rateExpr)) m.set(p, 'all');
      // (a deferred guard and the computed values it gates are read with the rate, F99)
      const rated = guardParts.has(rule) ? [rule.rateExpr, rule.guard, ...(rule.computed ?? []).map((c) => c.expr)] : [rule.rateExpr];
      for (const i of rated.flatMap((e) => (e ? sitesOf(e) : []))) {
        const parent = R.sites[i];
        if (!parent || !('node' in parent)) continue;
        const member = R.siteKeys[i];
        const now = m.get(parent.node);
        if (now === 'all') continue;
        if (!member || !keyed(member)) m.set(parent.node, 'all');
        else (now ?? m.set(parent.node, new Set()).get(parent.node) as Set<string>).add(memberKey(member));
      }
      this.readsAtCache.set(rule, m);
    }
    return m;
  }

  /**
   * A spot rated: the sum of its events' rates, each occurrence weighted by its event's (F83, `events.ts`). Its
   * occurrences are grouped into events again only where they changed (`regroup`); where only values did, only the
   * rates are worked out.
   */
  private rateSpot(spot: LiveSpot, ix: Index, regroup = false) {
    const many = spot.occurrences.length > 1;
    if (!many) spot.sizes = undefined;
    else if (regroup || !spot.sizes || spot.sizes.length !== spot.occurrences.length) spot.sizes = eventSizes(ix, spot.rule, spot.occurrences, this.sig);
    const { rate, weights } = eventRates(ix, spot.rule, spot.occurrences, this.sig, spot.sizes);
    spot.weights = many ? weights : undefined;
    this.setRate(spot, rate);
  }

  /** An occurrence as it stands now: where its rule's site contents may be stale, found again, from its nodes. */
  fresh(g: Carrier, rule: Rule, o: Occurrence, opts: { inPlace?: boolean } = {}): Occurrence {
    const lz = this.lazy[this.rules.indexOf(rule)];
    if (!lz) return o;
    // applied in place (`World.apply`), a site put back where it stood is never read (F93): where every lazy node's
    // site is one, nothing need be found again
    if (opts.inPlace) {
      const still = stillSites(rule);
      const R = rule.redex;
      if ([...lz].every((pn) => R.sites.some((s, i) => 'node' in s && s.node === pn && !keyed(R.siteKeys[i]) && still.has(i)))) return o;
    }
    const [now] = discover(g, rule, this.sig, { seed: new Map(o.nodes), seedEdges: new Map(o.edges), limit: 1 });
    return now ?? o;
  }

  /** Every live spot in `g`: kept from the last step where `g` is what it became, else found afresh. */
  live(g: Carrier): LiveSpot[] {
    if (g !== this.state) this.rebuild(g);
    return [...this.spots.values(), ...this.factoredSpots(g)].filter((s) => s.rate > 0 && Number.isFinite(s.rate));
  }

  /**
   * The total rate of `g`'s live spots, and the spot holding a point of it (F91): what a policy drawing one reaction
   * at a time needs, without listing every spot. Null where discovery holds encounter rules factored, whose spots are
   * not in the tree (`live` then).
   */
  totalRate(g: Carrier): number | null {
    if (this.encounters.length) return null;
    if (g !== this.state) this.rebuild(g);
    return this.tree.sum;
  }
  spotAt(g: Carrier, u: number): LiveSpot | null {
    if (this.encounters.length) return null;
    if (g !== this.state) this.rebuild(g);
    return this.tree.spots[this.tree.find(u)] ?? null;
  }

  /** Every spot in `g`, live or not (a rate of zero now): what a policy integrating rules needs, as a rate can rise. */
  all(g: Carrier): LiveSpot[] {
    if (g !== this.state) this.rebuild(g);
    return [...this.spots.values(), ...this.factoredSpots(g)];
  }

  /** How many occurrences are held: the components' matches for an encounter rule, never their product. */
  get occurrencesHeld(): number {
    return this.occs.size + (this.parts?.occurrencesHeld ?? 0);
  }

  /**
   * The encounter rules' spots: one per rule and place where every component meets, its rate k × ∏ (each component's
   * positive factors summed). Spots in a part are in the order of their keys.
   */
  private factoredSpots(g: Carrier): LiveSpot[] {
    if (!this.parts) return [];
    const at = new Map<string, { enc: Encounter; place: string; parts: LiveSpot[][] }>();
    for (const s of this.parts.all(g)) {
      const { enc, index } = this.partOf.get(s.rule.name)!;
      const place = placeKey(s.occurrences[0].places[0]);
      const key = `${enc.rule.name}|@${place}`;
      let f = at.get(key);
      if (!f) at.set(key, (f = { enc, place, parts: enc.parts.map(() => []) }));
      f.parts[index].push(s);
    }
    const out: LiveSpot[] = [];
    for (const [key, f] of at) {
      if (f.parts.some((p) => !p.length)) continue;
      let rate = f.enc.k;
      for (const p of f.parts) rate *= p.reduce((a, s) => a + (s.rate > 0 && Number.isFinite(s.rate) ? s.rate : 0), 0);
      for (const p of f.parts) p.sort((a, b) => (a.key! < b.key! ? -1 : a.key! > b.key! ? 1 : 0));
      // the same spot object while its rule meets in that place: a policy may keep it, as it keeps an enumerated one
      let spot = this.factoredHeld.get(key);
      if (!spot) this.factoredHeld.set(key, (spot = { rule: f.enc.rule, occurrences: [], rate, key, factored: { encounter: f.enc, place: f.place, parts: f.parts } }));
      else {
        spot.rate = rate;
        spot.factored!.parts = f.parts;
      }
      out.push(spot);
    }
    for (const key of [...this.factoredHeld.keys()]) if (!at.has(key) || at.get(key)!.parts.some((p) => !p.length)) this.factoredHeld.delete(key);
    return out;
  }
  private factoredHeld = new Map<string, LiveSpot>();

  /**
   * One occurrence of a factored spot, chosen in proportion to its rate: each component's match in proportion to its
   * factor (by `weight`: its rate as discovery has it, unless a policy reads it elsewhere, on a flow's state), `random`
   * giving uniform draws in [0, 1). Null where no component match has a positive factor.
   */
  sample(g: Carrier, spot: LiveSpot, random: () => number, weight: (s: LiveSpot) => number = (s) => s.rate): Occurrence | null {
    const f = spot.factored;
    if (!f) throw new Error(`${spot.rule.name}: not a factored spot`);
    const occs: Occurrence[] = [];
    for (const part of f.parts) {
      const w = part.map((s) => {
        const v = weight(s);
        return v > 0 && Number.isFinite(v) ? v : 0;
      });
      const total = w.reduce((a, b) => a + b, 0);
      if (!(total > 0)) return null;
      let u = random() * total, i = 0;
      while (i < part.length - 1 && (u -= w[i]) >= 0) i++;
      while (w[i] === 0 && i > 0) i--;
      const s = part[i];
      occs.push(this.parts!.fresh(g, s.rule, s.occurrences[Math.floor(random() * s.occurrences.length)]));
    }
    return composeEncounter(f.encounter, occs);
  }

  private rebuild(g: Carrier) {
    this.liveVersion++;
    this.occs.clear();
    this.held.clear();
    this.spots.clear();
    this.tree.clear();
    this.byNode.clear();
    this.byNodeStrict.clear();
    this.queryAt.clear();
    this.ratedCache.clear();
    this.toRate.clear();
    this.state = g;
    const ix = Index.of(g);
    this.rules.forEach((rule, i) => {
      for (const o of discover(g, rule, this.sig, { index: ix, lazy: this.lazy[i] ?? undefined, deferGuard: this.defer[i] })) this.add(o, rule, ix);
    });
  }

  /** `g` became `next` by `t`: keep what still holds, find what is new. */
  advance(g: Carrier, next: Carrier, t: Transition) {
    this.parts?.advance(g, next, t);
    if (g !== this.state) return this.rebuild(next);
    this.update(Index.of(g), Index.of(next), next, t);
  }

  /**
   * A world changed in place by `t`; `before` is what it could have changed, as it stood. Rules in `unrated` keep
   * their rates as they were where only values changed (as `advanceValues`).
   */
  advanceWorld(world: World, before: View, t: Transition, unrated?: Set<Rule>) {
    this.parts?.advanceWorld(world, before, t, unrated);
    if (world.g !== this.state) return this.rebuild(world.g);
    this.update(before, world.ix, world.g, t, unrated);
  }

  private update(before: View, after: Index, next: Carrier, t: Transition, unrated?: Set<Rule>) {

    // what changed; and where its links changed, what shares a link with it, before and after
    const changed = new Set<Id>([...t.removed, ...t.created, ...t.moved, ...t.kept, ...t.copied.map(([, c]) => c), ...t.occurrence.nodes.map(([, s]) => s)]);
    const relinked = new Set<Id>();
    for (const [ix, edges] of [[before, t.edgesRemoved], [after, t.edgesCreated]] as const) for (const e of edges) for (const p of ix.pointsOn({ edge: e })) relinked.add(p.node);
    // a node's links as they bear on what meets it: a group of any arity is a multiset of points (D-points-keyed-or-
    // anonymous), so its points are compared without their order or numbering, which a reactum putting a rest back
    // after its own points renumbers (F89); a group of fixed arity keeps its order
    const portsOf = (n: Node | undefined) => {
      if (!n) return '';
      const decl = this.sig.has(this.sig.name(n.type)) ? this.sig.get(n.type) : undefined;
      return JSON.stringify(n.ports.map((g) => {
        const variadic = decl?.ports.find((pd) => 'text' in g.key && pd.key === g.key.text)?.arity === 0;
        const pts = g.points.map(([k, p]) => (variadic ? JSON.stringify(p) : JSON.stringify([k, p])));
        return [g.key, g.contract, variadic ? pts.sort() : pts];
      }));
    };
    for (const id of changed) {
      const a = before.node.get(id), b = after.node.get(id);
      if ((a?.ports.length || b?.ports.length) && portsOf(a) !== portsOf(b)) relinked.add(id);
    }
    // what stood still: a node kept where it stood, as it stood (its type, place, key, links and value), changed in
    // nothing but perhaps what it holds, does not change what meets it, since whatever it holds that changed is
    // changed itself (and makes it affected, below). A scalar whose value only was rewritten where it stood
    // (`revalued`) changes only the rates of what meets its holder, where no rule that depends on values could meet
    // either.
    const gone = new Set(t.removed);
    const revalued = new Set(t.revalued ?? []);
    const rerate = new Set<Id>();
    // a scalar the redex met by a literal, still that literal's value and not rewritten, stood still (F89): in place, a
    // scalar is the same object before and after, so its value cannot be compared, but the literal says what it was
    const created = new Set(t.created);
    const literalStill = new Set<Id>();
    {
      const R = this.rules.find((r) => r.name === t.rule)?.redex;
      const byId = R ? new Map(R.nodes.map((n) => [n.id, n])) : undefined;
      for (const [pn, sn] of t.occurrence.nodes) {
        const lit = byId?.get(pn);
        if (!lit || typeof lit.payload !== 'object' || revalued.has(sn) || gone.has(sn) || created.has(sn)) continue;
        const now = after.node.get(sn);
        if (now && typeof now.payload === 'object' && scalarKey(now.payload.scalar) === scalarKey(lit.payload.scalar)) literalStill.add(sn);
      }
    }
    // for each rule, the holders of values it reads that changed in place (F88): searched again for it alone
    const valueOnly = new Map<number, Set<Id>>();
    // and for each rule reading across links, the nodes whose occurrences fold over a value that changed in place
    // (F101): found again there, or rated again where only its rate folds
    const acrossValue = new Map<number, Set<Id>>();
    const anyAcross = this.acrossSpec.some(Boolean);
    const anyNegative = this.negativeRoots.some((t) => t.length);
    const anyQuery = this.querySpecs.some(Boolean);
    const queryValue = new Map<number, Set<string>>();
    for (const id of [...changed]) {
      if (gone.has(id) || relinked.has(id)) continue;
      const a = before.node.get(id), b = after.node.get(id);
      if (!a || !b) continue;
      if (revalued.has(id)) {
        const host = 'node' in b.parent ? after.node.get(b.parent.node) : undefined;
        if (!host || this.sensitive(b.type)) continue;
        const key = memberKey(b.member);
        // (F88: a value read by some rules' literals or guards changes what meets those rules only; the others are
        // rated again, as where no rule reads it)
        const some = this.sensitiveAt(host.type, key) ? this.rulesAt(host.type, key) : [];
        if (some === 'all') continue;
        // (F101: a value read across a link, by a rule folding over the group of a node linked to the host, stales
        // that rule there; a rule reading across links costs what it folds, not every value at every linked node)
        if (anyAcross && host.ports.length) {
          if (this.acrossSpec.includes('unknown')) continue;
          this.acrossOwners(after, after, host, key, acrossValue);
        }
        // (F103: a value at or under a node a negative could add at a root, tied by a link: the rule is found again on
        // that node's links)
        if (anyNegative) for (let up: Node | undefined = host; up; up = 'node' in up.parent ? after.node.get(up.parent.node) : undefined) this.negativeLinked(after, up, valueOnly);
        // (F105: a value a query over a place holding the host reads: what met that place, by that query)
        if (anyQuery) this.queryStale(host, key, after, queryValue);
        changed.delete(id);
        rerate.add(host.id);
        for (const r of some) (valueOnly.get(r) ?? valueOnly.set(r, new Set()).get(r)!).add(host.id);
        continue;
      }
      if (literalStill.has(id)) {
        changed.delete(id);
        continue;
      }
      if (a === b && typeof b.payload === 'object') continue;
      if (a.type !== b.type || parentKey(a.parent) !== parentKey(b.parent) || memberKey(a.member) !== memberKey(b.member) || portsOf(a) !== portsOf(b)) continue;
      if (typeof a.payload === 'object' || typeof b.payload === 'object') {
        if (typeof a.payload !== 'object' || typeof b.payload !== 'object' || scalarKey(a.payload.scalar) !== scalarKey(b.payload.scalar)) continue;
      } else if (a.payload !== b.payload) continue;
      changed.delete(id);
    }
    // a relinked node changes what meets the nodes on the links it joined or left (their points, a closed edge's count,
    // an open name's), and on no other link of it: a realm declaring a war changes its foes, not its faith's link of
    // hundreds of points nor every community it holds (F103)
    // (and on those only where their points' joining or leaving can change what meets the others: a closed edge's
    // count, or a negative's root node; a fold over them is staled below, by its owners)
    const touchedOf = new Map<Id, Set<string>>();
    const delta = new Map<string, { h: Handle; d: number }>();
    for (const id of relinked) {
      changed.add(id);
      const a = before.node.get(id), b = after.node.get(id);
      const t = touchedLinks(a, b);
      touchedOf.set(id, new Set(t.map(([h]) => handleKey(h))));
      for (const [h, d] of t) {
        const k = handleKey(h), x = delta.get(k);
        if (x) x.d += d;
        else delta.set(k, { h, d });
      }
    }
    for (const { h, d } of delta.values()) {
      const now = after.pointsOn(h).length, was = now - d;
      const contract = 'edge' in h ? after.edge.get(h.edge)?.contract : undefined;
      const counts = this.closedEdges.some((e) => (contract === undefined || this.meets(e.contract, contract)) && (e.joined ? e.points <= Math.max(now, was) : e.points === now || e.points === was));
      if (!counts && !('name' in h)) continue;
      for (const ix of [before, after]) for (const p of ix.pointsOn(h)) changed.add(p.node);
    }
    // and everything that holds it
    // (walked in each state on its own: a node that moved has different holders before and after)
    const affected = new Set<Id>();
    for (const ix of [before, after]) {
      const walked = new Set<Id>();
      for (const id of changed) {
        let n = ix.node.get(id);
        while (n && !walked.has(n.id)) {
          walked.add(n.id);
          affected.add(n.id);
          n = 'node' in n.parent ? ix.node.get(n.parent.node) : undefined;
        }
        if (!ix.node.get(id)) affected.add(id);
      }
    }

    // what is linked to a changed node: a rule reading across links (`?ps.x`) reads them (and to a node whose
    // attributes changed: what is read across a link is an attribute). For each such rule, only the nodes on a link of
    // the group its rest stands on, and only where it reads the key that changed (F101)
    const linkedFor = new Map<number, Set<Id>>();
    // (and for a rule with a negative's node at a root, tied by a link: what stands on the links of a node changed at or
    // below that a negative could add, F103)
    if (this.negativeRoots.some((t) => t.length)) for (const ix of [before, after]) for (const id of affected) this.negativeLinked(ix, ix.node.get(id), linkedFor, changed);
    if (anyAcross)
      for (const ix of [before, after])
        for (const id of changed) {
          const n = ix.node.get(id);
          if (!n) continue;
          // (a node that joined or left links: every fold over them, F103; and any attribute of a node made or gone)
          const only = touchedOf.get(id);
          if (only?.size) this.acrossOwners(ix, after, n, '+links', linkedFor, changed, only);
          if (n.ports.length && (!before.node.get(id) || !after.node.get(id))) this.acrossOwners(ix, after, n, 'all', linkedFor, changed);
          const h = 'node' in n.parent && isAttr(n.member) ? ix.node.get(n.parent.node) : undefined;
          if (h?.ports.length) this.acrossOwners(ix, after, h, memberKey(n.member), linkedFor, changed);
        }

    // the changed nodes and their parents, before and after: where a lazy rule's new occurrences can be; and the
    // parents whose attributes changed (a change no site absorbs)
    const near = new Set<Id>(changed);
    const attrsChanged = new Set<Id>();
    for (const ix of [before, after])
      for (const c of changed) {
        const n = ix.node.get(c);
        if (n && 'node' in n.parent) {
          near.add(n.parent.node);
          if (isAttr(n.member)) attrsChanged.add(n.parent.node);
        }
      }
    // let go of what met them: for most rules, whatever met a changed node or anything holding one; for a rule
    // whose site contents may go stale, only what met a changed node, or met its parent where a change there
    // is not absorbed by that node's one site
    const had = new Map(this.held), lost = new Map<Rule, number>();
    const lazyOf = new Map(this.rules.map((r, i) => [r, this.lazy[i]]));
    const drop = (k: string) => {
      const r = this.occs.get(k)?.rule;
      if (r) lost.set(r, (lost.get(r) ?? 0) + 1);
      this.remove(k);
    };
    // each changed node's parents, before and after: what holds a change directly, and whether one is an attribute
    const kidsOf = new Map<Id, { any: boolean; attr: boolean }>();
    for (const c of changed)
      for (const ix of [before, after]) {
        const n = ix.node.get(c);
        if (!n || !('node' in n.parent)) continue;
        const k = kidsOf.get(n.parent.node) ?? { any: false, attr: false };
        k.any = true;
        if (isAttr(n.member)) k.attr = true;
        kidsOf.set(n.parent.node, k);
      }
    for (const id of affected) {
      const kids = kidsOf.get(id);
      // (F95: where a change below is one a lazy site absorbs, only what cannot absorb it is looked at: the
      // occurrences meeting this node by a node not holding a lazy site, or of a rule that is not lazy)
      const absorbable = !changed.has(id) && !kids?.attr;
      for (const k of [...((absorbable ? this.byNodeStrict : this.byNode).get(id) ?? [])]) {
        const v = this.occs.get(k);
        if (!v) continue;
        const lz = lazyOf.get(v.rule);
        if (!lz || changed.has(id)) {
          drop(k);
          continue;
        }
        // a lazy rule's node, holding a change: absorbed only by its one site, and only of what is not an attribute
        const pn = v.occ.nodes.find(([, s2]) => s2 === id)![0];
        if (kids?.any && (!lz.has(pn) || kids.attr)) drop(k);
      }
    }
    // a rule reading across links: what met a node linked to a change read the change
    for (const [i, ids] of linkedFor) {
      const rule = this.rules[i];
      for (const id of ids)
        for (const k of [...(this.byNode.get(id) ?? [])]) if (this.occs.get(k)?.rule === rule) drop(k);
    }
    // a rule that lost most of what it had is found again whole: one search, not one per anchor. Only where it lost
    // many: a rule holding one occurrence loses all it had whenever that one fires, and a search of the whole state
    // for it costs what the state holds, where the anchors cost what the change touched (F87)
    const whole = this.rules.map((rule, i) => !this.isLocal[i] || ((lost.get(rule) ?? 0) >= WHOLE_AFTER && (lost.get(rule) ?? 0) * 2 > (had.get(rule) ?? 0)));
    // (in one pass over what is held, whatever the number of rules found again whole)
    const wholeRules = new Set(this.rules.filter((_, i) => whole[i]).filter((r) => this.held.get(r)));
    if (wholeRules.size) for (const [k, v] of [...this.occs]) if (wholeRules.has(v.rule)) this.remove(k);

    this.state = next;
    // find again: anchored at each affected node, for each redex node it could be
    this.rules.forEach((rule, i) => {
      if (whole[i]) {
        for (const o of discover(next, rule, this.sig, { index: after, lazy: this.lazy[i] ?? undefined, deferGuard: this.defer[i] })) this.add(o, rule, after);
        return;
      }
      const linked = linkedFor.get(i);
      const anchors = linked ? new Set([...(this.lazy[i] ? near : affected), ...linked]) : this.lazy[i] ? near : affected;
      for (const id of anchors) {
        const n = after.node.get(id);
        if (!n) continue;
        const lz = this.lazy[i];
        // (searched from itself for every redex node: a changed node always is; an affected one, for a rule that is not lazy)
        const parentAnchored = 'node' in n.parent && (changed.has(n.parent.node) || (!this.lazy[i] && anchors.has(n.parent.node)));
        for (const pn of rule.redex.nodes) {
          if (!this.sig.sub(n.type, pn.type)) continue;
          // what a plan checks at every node it meets, checked at the anchor before searching: the same payload (a
          // literal its value) and the same member key. A value rewritten under a node otherwise anchors every rule
          // with a literal of that type (F58)
          if (payloadKey(pn) !== payloadKey(n) || memberKey(pn.member) !== memberKey(n.member)) continue;
          // an occurrence meeting this node below its parent meets the parent too, which is searched from itself
          if (parentAnchored && !('region' in pn.parent)) continue;
          if (!this.literalsAgree(rule, pn.id, after, id)) continue;
          // a parent anchored where its redex node has its one site: a change among what it holds is that site's,
          // so nothing new meets there (but a change to its attributes is no site's)
          if (lz && lz.has(pn.id) && !changed.has(id) && !attrsChanged.has(id)) continue;
          for (const o of discover(next, rule, this.sig, { index: after, anchor: { pattern: pn.id, state: id }, lazy: this.lazy[i] ?? undefined, deferGuard: this.defer[i] })) this.add(o, rule, after);
        }
      }
    });
    // where only values changed, what stands is rated again; and what reads an amount of a place whose entries changed
    if (this.amountRates) for (const ix of [before, after]) for (const p of this.placesOf([...t.removed, ...t.created, ...t.kept, ...(t.revalued ?? [])].map((c) => ix.node.get(c)), ix)) rerate.add(p);
    this.recheck(rerate, after);
    const done = new Set<string>();
    withinPass(() => {
      for (const h of rerate)
        for (const k of this.byNode.get(h) ?? []) {
          const v = this.occs.get(k);
          if (!v || done.has(v.spot) || unrated?.has(v.rule)) continue;
          done.add(v.spot);
          const spot = this.spots.get(v.spot);
          if (spot) this.rateSpot(spot, after);
        }
      for (const k of this.toRate) {
        const spot = this.spots.get(k);
        if (spot) this.rateSpot(spot, after, true);
      }
      this.toRate.clear();
    });
    for (const [i, hosts] of valueOnly) this.refind(i, hosts, after, next);
    for (const [i, keys] of queryValue) {
      const live = [...keys].filter((k) => this.occs.has(k));
      if (!live.length) continue;
      // (found again where the query decides what meets: at the places those occurrences met; else rated again)
      const qs = this.querySpecs[i]!;
      if (qs.some((q) => q.match)) this.refind(i, new Set(live.flatMap((k) => this.occs.get(k)!.occ.nodes.filter(([pn]) => qs.some((q) => q.place === pn)).map(([, sn]) => sn))), after, next);
      else if (!unrated?.has(this.rules[i])) {
        const done = new Set<string>();
        withinPass(() => {
          for (const k of live) {
            const v = this.occs.get(k);
            if (!v || done.has(v.spot)) continue;
            done.add(v.spot);
            const spot = this.spots.get(v.spot);
            if (spot) this.rateSpot(spot, after);
          }
        });
      }
    }
    for (const [i, owners] of acrossValue) {
      if (this.acrossMatch[i]) this.refind(i, owners, after, next);
      else if (!unrated?.has(this.rules[i])) this.rerateRule(i, owners, after);
    }
    if (t.edgesRevalued?.length) this.revalueLinks(t.edgesRevalued, t.edgesRetyped ?? [], after, next, whole, unrated);
  }

  /**
   * Links whose values a reaction rewrote in place (F97), and nothing else about them: what reads those values is
   * stale, and nothing else. Every occurrence reading a link's value meets a node on it (the link is the redex's, so a
   * node of the redex has a point on it; or it is a point of a rest, whose owner the occurrence meets), so a rule whose
   * matches read link values is found again at the nodes on those links, and one whose rate alone reads them is rated
   * again there. A rule reading no link's value is not looked at.
   */
  private revalueLinks(edges: Id[], retyped: Id[], after: Index, next: Carrier, whole: boolean[], unrated?: Set<Rule>) {
    const nodesOf = (es: Id[]) => {
      const on = new Set<Id>();
      for (const e of es) for (const p of after.pointsOn({ edge: e })) on.add(p.node);
      return on;
    };
    let on: Set<Id> | undefined;
    const nodesOn = () => (on ??= nodesOf(edges));
    this.rules.forEach((rule, i) => {
      const reads = this.linkReads[i];
      if (!reads || whole[i]) return;
      if (reads.match) return this.refind(i, nodesOn(), after, next);
      // (a pattern of variables alone meets whatever value of its type: found again only where the type changed, F102)
      if (reads.types && retyped.length) this.refind(i, nodesOf(retyped), after, next);
      if (!reads.rate) return;
      // (a deferred guard reading the value: each occurrence put in its spot or taken out as it now holds, F102)
      if (this.defer[i]) {
        this.recheck(nodesOn(), after, rule);
        for (const k of this.toRate) {
          const spot = this.spots.get(k);
          if (spot) this.rateSpot(spot, after, true);
        }
        this.toRate.clear();
      }
      if (unrated?.has(rule)) return;
      this.rerateRule(i, nodesOn(), after);
    });
  }

  /** A rule's spots at these nodes rated again: what its rate reads there changed, and nothing it meets by. */
  private rerateRule(i: number, at: Iterable<Id>, after: Index) {
    const rule = this.rules[i];
    const done = new Set<string>();
    withinPass(() => {
      for (const h of at)
        for (const k of this.byNode.get(h) ?? []) {
          const v = this.occs.get(k);
          if (!v || v.rule !== rule || done.has(v.spot)) continue;
          done.add(v.spot);
          const spot = this.spots.get(v.spot);
          if (spot) this.rateSpot(spot, after);
        }
    });
  }

  /**
   * A rule found again where values it reads changed in place, and nothing else did (F88): what it met at those
   * holders, or at what holds them, let go; then searched for, anchored at each.
   */
  private refind(i: number, hosts: Set<Id>, after: Index, next: Carrier) {
    const rule = this.rules[i];
    // (only nodes an occurrence of this rule could meet: of a type one of its redex nodes admits, F95; so a change
    // to a realm's size re-finds `collapse` at the realm, never walking what meets Earth above it)
    const types = rule.redex.nodes.map((pn) => pn.type);
    const meetable = (n: Node) => types.some((t) => this.sig.sub(n.type, t));
    const at = new Set<Id>();
    for (const h of hosts) for (let n = after.node.get(h); n && !at.has(n.id); n = 'node' in n.parent ? after.node.get(n.parent.node) : undefined) if (meetable(n)) at.add(n.id);
    for (const id of at)
      for (const k of [...(this.byNode.get(id) ?? [])]) if (this.occs.get(k)?.rule === rule) this.remove(k);
    for (const id of at) {
      const n = after.node.get(id)!;
      for (const pn of rule.redex.nodes) {
        if (!this.sig.sub(n.type, pn.type) || payloadKey(pn) !== payloadKey(n) || memberKey(pn.member) !== memberKey(n.member)) continue;
        if (!this.literalsAgree(rule, pn.id, after, id)) continue;
        for (const o of discover(next, rule, this.sig, { index: after, anchor: { pattern: pn.id, state: id }, lazy: this.lazy[i] ?? undefined, deferGuard: this.defer[i] })) this.add(o, rule, after);
      }
    }
    for (const k of this.toRate) {
      const spot = this.spots.get(k);
      if (spot) this.rateSpot(spot, after, true);
    }
    this.toRate.clear();
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
    this.held.set(rule, (this.held.get(rule) ?? 0) + 1);
    const lz = this.lazy[this.rules.indexOf(rule)];
    const qs = this.querySpecs[this.rules.indexOf(rule)];
    for (const [pn, s] of o.nodes) {
      (this.byNode.get(s) ?? this.byNode.set(s, new Set()).get(s)!).add(k);
      if (qs?.some((q) => q.place === pn)) (this.queryAt.get(s) ?? this.queryAt.set(s, new Set()).get(s)!).add(k);
      if (!lz || !lz.has(pn)) (this.byNodeStrict.get(s) ?? this.byNodeStrict.set(s, new Set()).get(s)!).add(k);
      this.nodeVersion.set(s, (this.nodeVersion.get(s) ?? 0) + 1);
    }
    if (this.defer[this.rules.indexOf(rule)] && !guardHolds(ix, rule, o, this.sig)) {
      this.occs.get(k)!.dormant = true;
      return;
    }
    this.attach(k, ix);
  }

  /** An occurrence put in its spot, which is rated again. */
  private attach(k: string, ix: Index) {
    const v = this.occs.get(k)!;
    v.dormant = false;
    const { occ: o, spot: sk, rule } = v;
    let spot = this.spots.get(sk);
    if (!spot) {
      spot = { rule, occurrences: [], rate: 0, keys: new Set(), key: sk };
      this.spots.set(sk, spot);
      spot.slot = this.tree.place(spot);
      this.liveVersion++;
    }
    spot.occurrences.push(o);
    spot.keys.add(k);
    // (a spot's rate is its events', so it is grouped and rated again whenever its occurrences change, F83)
    this.rateSpot(spot, ix, true);
  }

  private remove(k: string) {
    const v = this.occs.get(k);
    if (!v) return;
    this.occs.delete(k);
    this.held.set(v.rule, this.held.get(v.rule)! - 1);
    for (const [, s] of v.occ.nodes) {
      this.byNode.get(s)?.delete(k);
      this.byNodeStrict.get(s)?.delete(k);
      this.queryAt.get(s)?.delete(k);
      this.nodeVersion.set(s, (this.nodeVersion.get(s) ?? 0) + 1);
    }
    if (!v.dormant) this.detach(k, v);
  }

  /** An occurrence taken out of its spot (the spot let go where it holds no other, else rated again). */
  private detach(k: string, v: { occ: Occurrence; spot: string }) {
    const spot = this.spots.get(v.spot);
    if (!spot) return;
    spot.keys.delete(k);
    spot.occurrences = spot.occurrences.filter((o) => o !== v.occ);
    if (!spot.keys.size) {
      this.spots.delete(v.spot);
      if (spot.slot !== undefined) this.tree.release(spot.slot);
      this.liveVersion++;
    } else this.toRate.add(v.spot);
  }

  /**
   * Where values read by deferred guards changed at these nodes (F99): each occurrence of such a rule meeting one is
   * put in its spot if its guard now holds, or taken out if it no longer does. Its spot is then rated with the rest.
   */
  private recheck(hosts: Iterable<Id>, ix: Index, only?: Rule) {
    if (!this.defer.some(Boolean)) return;
    for (const h of hosts)
      for (const k of [...(this.byNode.get(h) ?? [])]) {
        const v = this.occs.get(k);
        if (!v || (only && v.rule !== only) || !this.defer[this.rules.indexOf(v.rule)]) continue;
        const holds = guardHolds(ix, v.rule, v.occ, this.sig);
        if (v.dormant && holds) this.attach(k, ix);
        else if (!v.dormant && !holds) {
          v.dormant = true;
          this.detach(k, v);
        }
      }
  }

  /**
   * Counts the changes to which spots are live (F80): one made or dropped, or a rate crossing what `live` takes
   * (positive and finite), here or in the parts' discovery a factored spot is made of. While it stands, `live` lists
   * the same spots (their rates may differ): a policy ordering them need not list them again.
   */
  get version(): number {
    return this.liveVersion + (this.parts?.version ?? 0);
  }
  private liveVersion = 0;
  private setRate(spot: LiveSpot, rate: number) {
    const was = spot.rate > 0 && Number.isFinite(spot.rate), now = rate > 0 && Number.isFinite(rate);
    spot.rate = rate;
    if (spot.slot !== undefined) this.tree.set(spot.slot, rate);
    if (was !== now) this.liveVersion++;
  }
}
