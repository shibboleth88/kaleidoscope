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
  handleKey,
  isAttr,
  keyed,
  memberKey,
  parentKey,
  sameMember,
  samePayload,
  sameScalar,
} from './carrier';
import type { Rule } from './rule';
import { type Env, evaluate, holds } from './expr';
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
}

export interface MatchOptions {
  /** Stop after this many occurrences. */
  limit?: number;
  /** Redex nodes already decided (a negative's search, seeded with the occurrence it might block). */
  seed?: Map<Id, Id>;
  seedEdges?: Map<Id, Id>;
}

interface Bound {
  nodes: Map<Id, Id>;
  edges: Map<Id, Id>;
  names: Map<Id, string>;
  nameHandles: Map<Id, Handle>;
  places: (Parent | undefined)[];
}

/** Every occurrence of the rule's redex in `g`, not blocked by its negatives. */
export function discover(g: Carrier, rule: Rule, sig: Signature, opts: MatchOptions = {}): Occurrence[] {
  const ix = new Index(g);
  const found: Occurrence[] = [];
  const limit = opts.limit ?? 10_000;
  for (const occ of search(ix, rule.redex, sig, opts.seed, opts.seedEdges)) {
    if (blocked(ix, rule, occ, sig)) continue;
    if (!computable(ix, rule, occ)) continue;
    found.push({ ...occ, rule: rule.name });
    if (found.length >= limit) break;
  }
  return found;
}

/** What an occurrence's sites hold, for expressions to read. */
export function siteEnv(ix: Index, sites: Id[][]): Env {
  return {
    scalar(i) {
      const roots = sites[i] ?? [];
      const n = roots.length === 1 ? ix.node.get(roots[0]) : undefined;
      return n && typeof n.payload === 'object' ? n.payload.scalar : null;
    },
    count: (i) => (sites[i] ?? []).length,
  };
}

/** The guard holds here, and every computed value can be computed here. */
function computable(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>): boolean {
  if (!rule.guard && !rule.computed?.length) return true;
  const env = siteEnv(ix, occ.sites);
  try {
    if (rule.guard && !holds(rule.guard, env)) return false;
    for (const c of rule.computed ?? []) evaluate(c.expr, env, c.kind);
    return true;
  } catch {
    return false;
  }
}

function blocked(ix: Index, rule: Rule, occ: Omit<Occurrence, 'rule'>, sig: Signature): boolean {
  if (!rule.negatives.length) return false;
  const seed = new Map(occ.nodes);
  const seedEdges = new Map(occ.edges);
  for (const ng of rule.negatives) {
    const it = search(ix, ng, sig, seed, seedEdges);
    if (!it.next().done) return true;
  }
  return false;
}

/** Every way `pattern` meets the state: its nodes, edges, sites, places and names. */
function* search(
  ix: Index,
  pattern: Carrier,
  sig: Signature,
  seed?: Map<Id, Id>,
  seedEdges?: Map<Id, Id>,
): Generator<Omit<Occurrence, 'rule'>> {
  const P = new Index(pattern);
  // parents before children, one region's roots at a time, each root followed by what it holds
  const order: Node[] = [];
  pattern.outer.places.forEach((_, i) => {
    for (const root of P.children({ region: i })) for (const id of P.subtree(root.id)) order.push(P.node.get(id)!);
  });
  const pointsOnPatternEdge = new Map<Id, number>();
  for (const n of pattern.nodes)
    for (const grp of n.ports)
      for (const [, p] of grp.points)
        if ('edge' in p.target) pointsOnPatternEdge.set(p.target.edge, (pointsOnPatternEdge.get(p.target.edge) ?? 0) + 1);
  const joinedEdges = new Set(pattern.names.filter((h): h is { edge: Id } => 'edge' in h).map((h) => h.edge));

  const b: Bound = { nodes: new Map(), edges: new Map(), names: new Map(), nameHandles: new Map(), places: pattern.outer.places.map(() => undefined) };
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
        const c = leftover.find((x) => !taken.has(x.id) && memberKey(x.member) === memberKey(key));
        fixed.set(i, c ? [c.id] : []);
        if (c) taken.add(c.id);
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
