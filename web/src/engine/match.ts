/**
 * Matching: finding every occurrence of a redex in a state (chrysalis `Spec/Match.lean`, `Reaction.discover`).
 *
 * The spec says what an occurrence is — a decomposition of the state into context ∘ redex ∘ parameter, the redex
 * met under `≤`, not blocked by a negative — and leaves how to find them to the implementation (`reaction.impl`).
 * This is a backtracking search over the redex's nodes, parents before children, binding links as it goes; then
 * the sites partition what is left at each place the redex reaches; then the negatives, each matched seeded with
 * the occurrence. `react.ts` builds the decomposition itself from an occurrence, and the tests compose it back to
 * the state: that is `discover_sound`, checked.
 *
 * Where the spec admits more decompositions than a finite search should list, `matcherProblems` refuses the rule
 * (an anonymous site at a redex root; an outer name with no point). Otherwise the search is complete.
 */

import {
  type Carrier,
  type Handle,
  type Id,
  Index,
  type Node,
  type Parent,
  type Port,
  fieldOf,
  handleKey,
  scalarKey,
  isAttr,
  keyed,
  memberKey,
  parentKey,
  sameMember,
  samePayload,
  sameScalar,
} from './carrier';
import type { Rule } from './rule';
import { runPlan } from './plan';
import { type Env, EvalError, type Expr, evaluate, holds, readsLinks } from './expr';
import type { Signature } from './signature';

/** One place a rule meets the state. */
export interface Occurrence {
  rule: string;
  /** Each redex node, and the state node it meets. */
  nodes: [Id, Id][];
  /** Each redex edge, and the state edge it meets. */
  edges: [Id, Id][];
  /** Each redex site: the roots of what it holds. */
  sites: Id[][];
  /** Each redex region: where its roots stand in the state (the context's site). */
  places: Parent[];
  /** Each redex outer name: the state handle the context joins it to. */
  names: [Id, Handle][];
  /** Each rest of points (kaleidoscope's, F28): whose group it is, and the points it holds. */
  rests?: [string, { owner: Id; ports: Port[] }][];
  /** In variadic groups, which state point each redex point met: [redex node, group key, redex point, state point]. */
  points?: [Id, string, string, string][];
}

export interface MatchOptions {
  /** Stop after this many occurrences. */
  limit?: number;
  /** Redex nodes already decided (a negative's search, seeded with the occurrence it might block). */
  seed?: Map<Id, Id>;
  seedEdges?: Map<Id, Id>;
  /** Only occurrences sending this redex node to this state node (incremental discovery's anchor). */
  anchor?: { pattern: Id; state: Id };
  /** An index of `g` already built. */
  index?: Index;
  /** Redex nodes whose one anonymous site is left unworked (`runPlan`'s `lazy`). */
  lazy?: Set<Id>;
  /**
   * Match the structure, link values and negatives only; the guard and the computed values are the rate's (F99): an
   * occurrence whose guard fails is kept, dormant, at a rate of zero (`guardHolds`, `occurrenceRate`).
   */
  deferGuard?: boolean;
}

/**
 * The rules part of whose guard incremental discovery has made the rate's (F99), with the part still matched (`match`,
 * absent where none is): their occurrences are matched with that part alone and rated zero where the whole guard fails.
 * A rule is put here by `Discovery` once, by what its guard's conjuncts read; a full search (`spots`) still applies the
 * whole guard in matching, and the rate agrees with it there.
 */
export const guardParts = new WeakMap<Rule, { match?: Expr }>();

/** Whether an occurrence's guard holds and its computed values can be computed: whether it could fire (F99). */
export function guardHolds(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  return computable(ix, rule, occ, sig);
}

interface Bound {
  nodes: Map<Id, Id>;
  edges: Map<Id, Id>;
  names: Map<Id, string>;
  nameHandles: Map<Id, Handle>;
  places: (Parent | undefined)[];
}

/** How much searching there has been (for profiling). */
export const stats = { calls: 0, found: 0 };

/**
 * PROPOSED (rule values, `reactions.ts`): the inside of a rule value is quoted. Where a signature names its rule value
 * and its forms (`quote` there), a redex root meets no node inside a rule value unless the root is one of those forms:
 * a rule reads or rewrites a rule value only by naming it as one, so the `A` a rule value's redex holds is never the
 * `A` an ordinary rule eats. Signatures that name none (every program written so far) are unchanged.
 */
export const quotes = new WeakMap<Signature, { value: Id; forms: Set<Id> }>();

function quoted(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  const q = quotes.get(sig);
  if (!q) return false;
  const P = patternIndex(rule.redex);
  for (const [pn, sn] of occ.nodes) {
    const p = P.node.get(pn)!;
    if (!('region' in p.parent) || q.forms.has(p.type)) continue;
    const above = (n: Node | undefined) => (n && 'node' in n.parent ? ix.node.get(n.parent.node) : undefined);
    for (let up = above(ix.node.get(sn)); up; up = above(up)) if (up.type === q.value) return true;
  }
  return false;
}

/** Every occurrence of the rule's redex in `g`, not blocked by its negatives. */
export function discover(g: Carrier, rule: Rule, sig: Signature, opts: MatchOptions = {}): Occurrence[] {
  stats.calls++;
  const ix = opts.index ?? Index.of(g);
  const found: Occurrence[] = [];
  const limit = opts.limit ?? Infinity;
  let seed = opts.seed;
  let places: (Parent | undefined)[] | undefined;
  if (opts.anchor) {
    // the anchor fixes its redex ancestors to the state node's, and its region's place to where they stand
    seed = new Map(seed ?? []);
    const P = patternIndex(rule.redex);
    let pn = P.node.get(opts.anchor.pattern);
    let sn = ix.node.get(opts.anchor.state);
    while (pn && sn) {
      seed.set(pn.id, sn.id);
      if ('region' in pn.parent) {
        places = rule.redex.outer.places.map(() => undefined);
        places[pn.parent.region] = sn.parent;
        break;
      }
      pn = P.node.get(pn.parent.node);
      sn = 'node' in sn.parent ? ix.node.get(sn.parent.node) : undefined;
    }
    if (!pn || !sn) return [];
  }
  runPlan(
    ix,
    rule.redex,
    sig,
    (occ) => {
      // the guard first: it is cheap, and a negative is a search (a deferred guard is the rate's, F99)
      if (opts.deferGuard ? !matchedPart(ix, rule, occ, sig) : !computable(ix, rule, occ, sig)) return;
      if (quoted(ix, rule, occ, sig)) return;
      if (blocked(ix, rule, occ, sig)) return;
      found.push({ ...occ, rule: rule.name });
      stats.found++;
      if (found.length >= limit) return false;
    },
    seed,
    opts.seedEdges,
    places,
    opts.lazy,
  );
  return found;
}

/**
 * The same, by the first matcher (a generator, uncompiled): kept as the reference the compiled one is tested
 * against.
 */
export function discoverReference(g: Carrier, rule: Rule, sig: Signature): Occurrence[] {
  const ix = Index.of(g);
  const found: Occurrence[] = [];
  for (const occ of search(ix, rule.redex, sig)) {
    if (!computable(ix, rule, occ, sig)) continue;
    if (quoted(ix, rule, occ, sig)) continue;
    if (blockedReference(ix, rule, occ, sig)) continue;
    found.push({ ...occ, rule: rule.name });
  }
  return found;
}

function blockedReference(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  const seed = new Map(occ.nodes);
  const seedEdges = new Map(occ.edges);
  for (const [k, ng] of rule.negatives.entries()) {
    const g = rule.negativeGuards?.[k];
    for (const n of search(ix, ng, sig, seed, seedEdges)) if (!g || holds(g, siteEnv(ix, [...occ.sites, ...n.sites.slice(occ.sites.length)], sig, n.rests, n.nodes))) return true;
  }
  return false;
}

/** Whether a rule reads the values links hold anywhere (F97): its patterns, its writes, or an expression of it. */
const linkRules = new WeakMap<Rule, boolean>();
export function readsLinkValues(rule: Rule): boolean {
  let v = linkRules.get(rule);
  if (v === undefined) {
    v =
      !!rule.linkPatterns?.length ||
      !!rule.linkWrites?.length ||
      [rule.guard, rule.rateExpr, rule.accept, ...(rule.computed ?? []).map((c) => c.expr), ...(rule.draws ?? []).flatMap((d) => [d.count, ...d.filters.map(([, x]) => x), ...d.set.map(([, x]) => x)])].some(readsLinks);
    linkRules.set(rule, v);
  }
  return v;
}

/**
 * What an occurrence holds, for expressions to read: its sites, rests and nodes, and, for a rule that reads them, the
 * values its links hold (F97). (A rule reading none gets the environment it always had, at the cost it always had.)
 */
export const occEnv = (ix: Index, o: Omit<Occurrence, 'rule'>, sig: Signature | undefined, rule: Rule): Env =>
  readsLinkValues(rule) ? siteEnv(ix, o.sites, sig, o.rests, o.nodes, o.edges, o.names, true) : siteEnv(ix, o.sites, sig, o.rests, o.nodes);

/** The state edge a redex link met: by its handle in the redex (`e3` a closed edge, `x1` an outer name). */
export function linkMet(handle: string, edges?: [Id, Id][], names?: [Id, Handle][]): Id | undefined {
  const id = Number(handle.slice(1));
  if (handle[0] === 'e') return edges?.find(([p]) => p === id)?.[1];
  const h = names?.find(([x]) => x === id)?.[1];
  return h && 'edge' in h ? h.edge : undefined;
}

/** What an occurrence's sites hold, for expressions to read. */
export function siteEnv(ix: Index, sites: Id[][], sig?: Signature, rests?: [string, { owner: Id; ports: Port[] }][], nodes?: [Id, Id][], edges?: [Id, Id][], names?: [Id, Handle][], links = false): Env {
  const rest = (name: string) => rests?.find(([n]) => n === name)?.[1];
  const env: Env = {
    index: ix,
    sig,
    nodeOf(r) {
      const hit = nodes?.find(([a]) => a === r);
      if (!hit) throw new EvalError(`the redex's node ${r} met nothing here`);
      return hit[1];
    },
    far(name) {
      const r = rest(name);
      if (!r) return [];
      const out: Id[] = [];
      for (const p of r.ports) for (const pt of ix.pointsOn(p.target)) if (pt.node !== r.owner) out.push(pt.node);
      return out;
    },
    points: (name) => rest(name)?.ports.length ?? 0,
    shared(a, b) {
      const ka = new Set((rest(a)?.ports ?? []).map((p) => handleKey(p.target)));
      return (rest(b)?.ports ?? []).filter((p) => ka.has(handleKey(p.target))).length;
    },
    attr(node, key) {
      const c = ix.childAt({ node }, `a${scalarKey({ text: key })}`);
      return c && typeof c.payload === 'object' ? c.payload.scalar : null;
    },
    scalar(i) {
      const roots = sites[i] ?? [];
      const n = roots.length === 1 ? ix.node.get(roots[0]) : undefined;
      return n && typeof n.payload === 'object' ? n.payload.scalar : null;
    },
    // what a site holds is its roots: the members it captured, not what they hold in turn
    count(i, type) {
      const roots = sites[i] ?? [];
      if (!type) return roots.length;
      if (!sig?.has(type)) return 0;
      const t = sig.id(type);
      return roots.filter((r) => sig.sub(ix.node.get(r)!.type, t)).length;
    },
  };
  if (links) {
    // the values links hold (F97): a redex link's, and each point's link's within a fold
    env.link = (handle, key) => {
      const e = linkMet(handle, edges, names);
      return e === undefined ? null : fieldOf(ix.edge.get(e)?.held, key);
    };
    env.edgeField = (edge, key) => fieldOf(ix.edge.get(edge)?.held, key);
    env.farPoints = (name) => {
      const r = rest(name);
      if (!r) return [];
      const out: [Id, Id][] = [];
      for (const p of r.ports) {
        if (!('edge' in p.target)) continue;
        for (const pt of ix.pointsOn(p.target)) if (pt.node !== r.owner) out.push([pt.node, p.target.edge]);
      }
      return out;
    };
  }
  return env;
}

/**
 * The values the occurrence's links hold meet the rule's patterns on them (F97): each of the pattern's type or below it,
 * with its literal fields. (A link the redex writes no value pattern on meets whatever value it holds.)
 */
export function linkValuesMeet(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  for (const p of rule.linkPatterns ?? []) {
    const e = linkMet(handleKey(p.link), occ.edges, occ.names);
    const v = e === undefined ? undefined : ix.edge.get(e)?.held;
    if (!v || !sig.sub(v.type, p.type)) return false;
    for (const [k, want] of p.fields) {
      const have = fieldOf(v, k);
      if (!have || scalarKey(have) !== scalarKey(want)) return false;
    }
  }
  return true;
}

/** The guard holds here, and every computed value can be computed here. */
function computable(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  if (rule.linkPatterns && !linkValuesMeet(ix, rule, occ, sig)) return false;
  if (!rule.guard && !rule.computed?.length && !rule.linkWrites) return true;
  const env = occEnv(ix, occ, sig, rule);
  try {
    if (rule.guard && !holds(rule.guard, env)) return false;
    for (const c of rule.computed ?? []) evaluate(c.expr, env, c.kind);
    // (and every value written on a link, F97)
    for (const w of rule.linkWrites ?? []) for (const [, x, kind] of w.fields) evaluate(x, env, kind);
    return true;
  } catch {
    return false;
  }
}

/** The part of a deferred guard still matched (F99), and the link values: what a dormant occurrence must meet. */
function matchedPart(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  if (rule.linkPatterns && !linkValuesMeet(ix, rule, occ, sig)) return false;
  const m = guardParts.get(rule)?.match;
  if (!m) return true;
  try {
    return holds(m, occEnv(ix, occ, sig, rule));
  } catch {
    return false;
  }
}

function blocked(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  if (!rule.negatives.length) return false;
  const seed = new Map(occ.nodes);
  const seedEdges = new Map(occ.edges);
  for (const [k, ng] of rule.negatives.entries()) {
    let hit = false;
    const g = rule.negativeGuards?.[k];
    // (a negative joined to the redex's values meets only where they agree: its own sites against the occurrence's)
    const holdsHere = (n: Omit<Occurrence, 'rule'>) => !g || holds(g, siteEnv(ix, [...occ.sites, ...n.sites.slice(occ.sites.length)], sig, n.rests, n.nodes));
    runPlan(ix, ng, sig, (n) => (holdsHere(n) ? ((hit = true), false) : undefined), seed, seedEdges);
    if (hit) return true;
  }
  return false;
}

/** What a search of a pattern needs that the pattern alone decides, worked out once per pattern. */
interface Prepared {
  /** Each region's roots, each with its subtree (parents first). */
  roots: { nodes: Node[] }[][];
  pointsOnPatternEdge: Map<Id, number>;
  joinedEdges: Set<Id>;
}
const preparedCache = new WeakMap<Carrier, Prepared>();
const indexCache = new WeakMap<Carrier, Index>();
const patternIndex = (g: Carrier) => indexCache.get(g) ?? indexCache.set(g, new Index(g)).get(g)!;
function prepared(pattern: Carrier): Prepared {
  let p = preparedCache.get(pattern);
  if (p) return p;
  const P = new Index(pattern);
  const roots = pattern.outer.places.map((_, i) => P.children({ region: i }).map((r) => ({ nodes: P.subtree(r.id).map((id) => P.node.get(id)!) })));
  const pointsOnPatternEdge = new Map<Id, number>();
  for (const n of pattern.nodes)
    for (const grp of n.ports)
      for (const [, pt] of grp.points)
        if ('edge' in pt.target) pointsOnPatternEdge.set(pt.target.edge, (pointsOnPatternEdge.get(pt.target.edge) ?? 0) + 1);
  const joinedEdges = new Set(pattern.names.filter((h): h is { edge: Id } => 'edge' in h).map((h) => h.edge));
  p = { roots, pointsOnPatternEdge, joinedEdges };
  preparedCache.set(pattern, p);
  return p;
}

/** Every way `pattern` meets the state: its nodes, edges, sites, places and names. */
function* search(
  ix: Index,
  pattern: Carrier,
  sig: Signature,
  seed?: Map<Id, Id>,
  seedEdges?: Map<Id, Id>,
  places0?: (Parent | undefined)[],
): Generator<Omit<Occurrence, 'rule'>> {
  const { roots: rootsOf, pointsOnPatternEdge, joinedEdges } = prepared(pattern);
  // parents before children, one region's roots at a time, each root followed by what it holds
  const order: Node[] = [];
  pattern.outer.places.forEach((_, i) => {
    // roots holding a seeded node first: then links bound from it direct the rest
    let roots = rootsOf[i];
    if (seed?.size) roots = [...roots].sort((a, b) => Number(b.nodes.some((n) => seed.has(n.id))) - Number(a.nodes.some((n) => seed.has(n.id))));
    for (const r of roots) for (const n of r.nodes) order.push(n);
  });

  const b: Bound = {
    nodes: new Map(),
    edges: new Map(),
    names: new Map(),
    nameHandles: new Map(),
    places: places0 ? [...places0] : pattern.outer.places.map(() => undefined),
  };
  const used = new Set<Id>();
  const usedEdges = new Map<Id, Id>(); // state edge → pattern edge
  const nameUses = new Map<string, number>(); // state handle key → how many pattern names stand on it
  const trail: (() => void)[] = [];
  const undoTo = (mark: number) => {
    while (trail.length > mark) trail.pop()!();
  };

  const compatible = (pn: Node, gn: Node) =>
    sig.sub(gn.type, pn.type) && samePayload(pn.payload, gn.payload) && sameMember(pn.member, gn.member) && pn.ports.length === gn.ports.length;

  /** Bind `pn`'s points to `gn`'s, or refuse. Pushes undo steps on the trail. */
  const bindLinks = (pn: Node, gn: Node): boolean => {
    for (const pg of pn.ports) {
      const gg = gn.ports.find((x) => sameScalar(x.key, pg.key));
      if (!gg || !sig.sub(gg.contract, pg.contract) || gg.points.length !== pg.points.length) return false;
      for (const [pk, pp] of pg.points) {
        const gp = gg.points.find(([k]) => sameScalar(k, pk));
        if (!gp || !sig.sub(gp[1].contract, pp.contract)) return false;
        const t = pp.target, h = gp[1].target;
        if ('edge' in t) {
          const have = b.edges.get(t.edge);
          if (have !== undefined) {
            if (!('edge' in h) || h.edge !== have) return false;
          } else {
            if (!('edge' in h) || usedEdges.has(h.edge) || nameUses.has(handleKey(h))) return false;
            b.edges.set(t.edge, h.edge);
            usedEdges.set(h.edge, t.edge);
            trail.push(() => (b.edges.delete(t.edge), usedEdges.delete(h.edge)));
          }
        } else if ('name' in t) {
          const have = b.names.get(t.name);
          const hk = handleKey(h);
          if (have !== undefined) {
            if (have !== hk) return false;
          } else {
            if ('edge' in h && usedEdges.has(h.edge)) return false;
            b.names.set(t.name, hk);
            b.nameHandles.set(t.name, h);
            nameUses.set(hk, (nameUses.get(hk) ?? 0) + 1);
            trail.push(() => {
              b.names.delete(t.name);
              b.nameHandles.delete(t.name);
              const c = nameUses.get(hk)! - 1;
              if (c) nameUses.set(hk, c);
              else nameUses.delete(hk);
            });
          }
        } else return false; // binders: not yet
      }
    }
    return true;
  };

  const candidates = (pn: Node): Node[] => {
    const s = seed?.get(pn.id);
    if (s !== undefined) {
      const n = ix.node.get(s);
      return n ? [n] : [];
    }
    // link-directed: a point on a link already bound narrows the candidates to the nodes on that link
    for (const grp of pn.ports)
      for (const [, pt] of grp.points) {
        const t = pt.target;
        const h: Handle | undefined =
          'edge' in t && b.edges.has(t.edge) ? { edge: b.edges.get(t.edge)! } : 'name' in t && b.nameHandles.has(t.name) ? b.nameHandles.get(t.name) : undefined;
        if (h) {
          const seen = new Set<Id>();
          const out: Node[] = [];
          for (const p of ix.pointsOn(h)) if (!seen.has(p.node)) seen.add(p.node), out.push(ix.node.get(p.node)!);
          return out;
        }
      }
    if ('node' in pn.parent) return ix.children({ node: b.nodes.get(pn.parent.node)! });
    const place = b.places[pn.parent.region];
    return place ? ix.children(place) : ix.g.nodes;
  };

  function* assign(k: number): Generator<Omit<Occurrence, 'rule'>> {
    if (k === order.length) {
      yield* finish();
      return;
    }
    const pn = order[k];
    for (const gn of candidates(pn)) {
      if (used.has(gn.id) || !compatible(pn, gn)) continue;
      if ('node' in pn.parent && !('node' in gn.parent && gn.parent.node === b.nodes.get(pn.parent.node))) continue;
      const mark = trail.length;
      if ('region' in pn.parent) {
        const r = pn.parent.region;
        const place = b.places[r];
        if (place) {
          if (parentKey(place) !== parentKey(gn.parent)) continue;
        } else {
          b.places[r] = gn.parent;
          trail.push(() => (b.places[r] = undefined));
        }
      }
      b.nodes.set(pn.id, gn.id);
      used.add(gn.id);
      trail.push(() => (b.nodes.delete(pn.id), used.delete(gn.id)));
      if (bindLinks(pn, gn)) yield* assign(k + 1);
      undoTo(mark);
    }
  }

  function* finish(): Generator<Omit<Occurrence, 'rule'>> {
    // a seeded edge must be met where the seed says
    if (seedEdges) for (const [pe, ge] of seedEdges) if (b.edges.has(pe) && b.edges.get(pe) !== ge) return;
    // the context stands outside the redex: no region's place within what the redex met
    for (const place of b.places) {
      if (!place) return; // a region holding no node: refused by matcherProblems
      for (let cur: Parent = place; 'node' in cur; cur = ix.node.get(cur.node)!.parent) if (used.has(cur.node)) return;
    }
    // a closed edge of the redex holds exactly its points (and, joined to an inner name, what its sites hold)
    for (const [pe, ge] of b.edges) {
      const pEdge = pattern.edges.find((e) => e.id === pe)!;
      const gEdge = ix.edge.get(ge)!;
      if (!sig.sub(gEdge.contract, pEdge.contract)) return;
      const want = pEdge.value === null ? null : (b.nodes.get(pEdge.value) ?? pEdge.value);
      if (gEdge.value !== want) return;
      const n = ix.pointsOn({ edge: ge }).length;
      const p = pointsOnPatternEdge.get(pe) ?? 0;
      if (joinedEdges.has(pe) ? n < p : n !== p) return;
    }
    // what the sites hold
    for (const sites of siteChoices()) {
      if (!parameterLinksOk(sites)) continue;
      yield {
        nodes: [...b.nodes],
        edges: [...b.edges],
        sites,
        places: b.places.map((p) => p!),
        names: [...b.nameHandles],
      };
    }
  }

  /** Every way the sites may hold what is left beside the redex's nodes. */
  function* siteChoices(): Generator<Id[][]> {
    const groups = new Map<string, { parent: Parent; sites: number[]; stateParents: Parent[] }>();
    pattern.sites.forEach((s, i) => {
      const at: Parent = 'node' in s ? { node: b.nodes.get(s.node)! } : b.places[s.region]!;
      const k = parentKey(at);
      (groups.get(k) ?? groups.set(k, { parent: at, sites: [], stateParents: [] }).get(k)!).sites.push(i);
    });
    // a matched node with no site in it holds exactly what the redex says it holds
    for (const gid of b.nodes.values()) {
      if (groups.has(parentKey({ node: gid }))) continue;
      if (ix.children({ node: gid }).some((c) => !used.has(c.id))) return;
    }
    const perGroup: Id[][][][] = []; // group → choices → per site in group → roots
    const groupSites: number[][] = [];
    for (const { parent, sites } of groups.values()) {
      const leftover = ix.children(parent).filter((c) => !used.has(c.id));
      const atNode = 'node' in parent;
      const taken = new Set<Id>();
      const fixed = new Map<number, Id[]>();
      for (const i of sites) {
        const key = pattern.siteKeys[i];
        if (!keyed(key)) continue;
        const c = ix.childAt(parent, memberKey(key));
        const free = c && !taken.has(c.id) && !used.has(c.id) ? c : undefined;
        fixed.set(i, free ? [free.id] : []);
        if (free) taken.add(free.id);
      }
      const rest = leftover.filter((c) => !taken.has(c.id));
      const anon = sites.filter((i) => !keyed(pattern.siteKeys[i]));
      const choices: Id[][][] = [];
      if (!atNode) {
        // at a root of the redex, what is left is the context's
        choices.push(sites.map((i) => fixed.get(i) ?? []));
      } else if (rest.some((c) => isAttr(c.member))) {
        return; // an attribute is never cut from its node, nor held by an anonymous site
      } else if (anon.length === 0) {
        if (rest.length) return;
        choices.push(sites.map((i) => fixed.get(i) ?? []));
      } else {
        // each of what is left goes to one of the anonymous sites
        for (const split of partitions(rest.map((c) => c.id), anon.length)) {
          choices.push(sites.map((i) => fixed.get(i) ?? split[anon.indexOf(i)]));
        }
      }
      perGroup.push(choices);
      groupSites.push(sites);
    }
    for (const combo of product(perGroup)) {
      const sites: Id[][] = pattern.sites.map(() => []);
      combo.forEach((choice, gi) => groupSites[gi].forEach((si, k) => (sites[si] = choice[k])));
      yield sites;
    }
  }

  /** What the sites hold reaches a closed redex edge only through an inner name joined to it. */
  function parameterLinksOk(sites: Id[][]): boolean {
    // with no closed redex edge met, what the sites hold cannot reach one
    if (usedEdges.size === 0) return true;
    const inParam = new Set<Id>();
    for (const roots of sites) for (const r of roots) for (const id of ix.subtree(r)) inParam.add(id);
    for (const id of inParam)
      for (const grp of ix.node.get(id)!.ports)
        for (const [, p] of grp.points)
          if ('edge' in p.target && usedEdges.has(p.target.edge) && !joinedEdges.has(usedEdges.get(p.target.edge)!)) return false;
    for (const pe of joinedEdges) {
      const ge = b.edges.get(pe);
      if (ge === undefined) continue;
      if (ix.pointsOn({ edge: ge }).some((pt) => !used.has(pt.node) && !inParam.has(pt.node))) return false;
    }
    return true;
  }

  yield* assign(0);
}

/** Every way to give each item to one of `k` bins. */
function* partitions<T>(items: T[], k: number): Generator<T[][]> {
  if (k === 1) {
    yield [items];
    return;
  }
  const bins: T[][] = Array.from({ length: k }, () => []);
  function* go(i: number): Generator<T[][]> {
    if (i === items.length) {
      yield bins.map((x) => [...x]);
      return;
    }
    for (let j = 0; j < k; j++) {
      bins[j].push(items[i]);
      yield* go(i + 1);
      bins[j].pop();
    }
  }
  yield* go(0);
}

function* product<T>(lists: T[][]): Generator<T[]> {
  if (!lists.length) {
    yield [];
    return;
  }
  const [head, ...tail] = lists;
  for (const x of head) for (const rest of product(tail)) yield [x, ...rest];
}

/** Two occurrences at one spot: they meet the same nodes and edges (`Occurrence.SameSpot`). */
export function spotKey(o: Occurrence): string {
  return `${o.rule}|${o.nodes.map(([, g]) => g).sort((a, b) => a - b).join(',')}|${o.edges.map(([, g]) => g).sort((a, b) => a - b).join(',')}`;
}
