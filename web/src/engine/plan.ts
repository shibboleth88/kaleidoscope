/**
 * The matcher, compiled: each pattern turned once into a plan, and run without generators, closures or maps in its
 * inner loop.
 *
 * A plan fixes the order the pattern's nodes are met in (parents before children; a seeded root first) and, for
 * each node, where its candidates come from: its seed; the points on a link an earlier node bound
 * (link-directed); its parent's members; its region's place; or, for a first root, every node. A later root none of
 * whose own points is on a link already bound, but which holds a node that is, is met from that node upward (F85): the
 * node first, by the link, then each of its ancestors as the one parent of what was met, up to the root. Two
 * siblings joined only through their members (`P(A[l = ~e]) | Q(B[l = ~e])`) then cost the points on the link, not
 * the pairs of siblings. Keys (member, payload,
 * port group, point) are worked out once. Bindings are arrays indexed by the pattern's nodes, edges and names, undone
 * by popping stacks back to a mark.
 *
 * What it finds is what `Spec/Match.lean` says an occurrence is (see `match.ts`), and the tests hold it to that.
 */

import {
  type Carrier,
  type Handle,
  type Port,
  type Id,
  type Index,
  type Node,
  type Parent,
  handleKey,
  isAttr,
  keyed,
  memberKey,
  parentKey,
  scalarKey,
} from './carrier';
import type { Signature } from './signature';

export interface Found {
  nodes: [Id, Id][];
  edges: [Id, Id][];
  sites: Id[][];
  places: Parent[];
  names: [Id, Handle][];
  /** Each rest of points: whose group it is, and the points it holds. */
  rests: [string, { owner: Id; ports: Port[] }][];
  /** In variadic groups, which state point each pattern point met: [pattern node, group key, pattern point, state point]. */
  points: [Id, string, string, string][];
}

const NONE = -1;
const EDGE = 0, NAME = 1;

interface PointPlan {
  key: string;
  contract: Id;
  kind: number; // EDGE or NAME (binders refuse)
  target: number; // index of the pattern edge or name
}
interface GroupPlan {
  key: string;
  contract: Id;
  points: PointPlan[];
  /** Points matched as a multiset, any of the group's for any of the pattern's (a group of any arity). */
  variadic: boolean;
  /** The rest of points, if the pattern has one: then the group may hold more. */
  rest: string | null;
}
interface Step {
  pn: Node;
  /** The step of its parent, or NONE for a root. */
  parent: number;
  region: number;
  member: string;
  /** Whether it stands at a key: then its parent's child at that key is its one candidate. */
  keyed: boolean;
  payload: string;
  ports: GroupPlan[];
  /** A point on a link some earlier step binds: candidates are the nodes on it. */
  via: PointPlan | null;
  /** Whether it is a root of its region (its place is the region's). */
  root: boolean;
  /** Met upward (F85): the step of its child met before it, whose parent is its one candidate; else NONE. */
  up: number;
}
interface Plan {
  steps: Step[];
  /** Pattern node id → step. */
  stepOf: Map<Id, number>;
  edgeIds: Id[];
  edgeIndex: Map<Id, number>;
  nameIds: Id[];
  pointsOnEdge: number[];
  joined: boolean[];
  /** Each site: the step of its parent (NONE: a region), its region, and its member key (null: anonymous). */
  sites: { parent: number; region: number; key: string | null; attr: boolean }[];
  /** Each step: whether a site stands in it. */
  holdsSite: boolean[];
  regions: number;
}

const payloadKey = (n: Node) => (typeof n.payload === 'string' ? n.payload : `s${scalarKey(n.payload.scalar)}`);

const planCache = new WeakMap<Carrier, Map<string, Plan>>();

/** The plan for a pattern, with the roots holding `firstRoots` met first in each region. */
/**
 * A node's port groups by key, worked out once per node object (F96): the matcher looks a group up for every point it
 * binds, and building each group's key to compare was a tenth of a search. A node changed in place is a new object,
 * so what is kept for the old one is never read again.
 */
const groupsCache = new WeakMap<Node, Map<string, Node['ports'][number]>>();
function groupsOf(n: Node) {
  let m = groupsCache.get(n);
  if (!m) {
    m = new Map();
    for (const g of n.ports) m.set(scalarKey(g.key), g);
    groupsCache.set(n, m);
  }
  return m;
}

function planFor(pattern: Carrier, seeded: Set<Id> | null, sig: Signature): Plan {
  let byOrder = planCache.get(pattern);
  if (!byOrder) planCache.set(pattern, (byOrder = new Map()));
  // (the plan depends on which nodes are seeded: a seeded node is met from its seed, and an unseeded one may be met
  // upward from a linked member, F85; so plans are kept per seeding, and found before anything is worked out, F96)
  const cacheKey = seeded ? [...seeded].sort((a, b) => a - b).join(',') : '-';
  const cached = byOrder.get(cacheKey);
  if (cached) return cached;
  // which roots go first depends only on which of them hold a seeded node
  const kids = new Map<string, Node[]>();
  for (const n of pattern.nodes) {
    const k = parentKey(n.parent);
    (kids.get(k) ?? kids.set(k, []).get(k)!).push(n);
  }
  const subtree = (n: Node): Node[] => {
    const out = [n];
    for (let i = 0; i < out.length; i++) out.push(...(kids.get(parentKey({ node: out[i].id })) ?? []));
    return out;
  };
  const regionRoots = pattern.outer.places.map((_, i) => kids.get(parentKey({ region: i })) ?? []);
  const firsts = regionRoots.map((roots) => (seeded ? roots.findIndex((r) => subtree(r).some((n) => seeded.has(n.id))) : -1));

  const order: { n: Node; region: number; upFrom?: Node }[] = [];
  // the links the nodes ordered so far have points on: a later node on one is met by it
  const onLink = new Set<string>();
  const linksOf = (n: Node) => n.ports.flatMap((g) => g.points.flatMap(([, p]) => ('edge' in p.target ? [`e${p.target.edge}`] : 'name' in p.target ? [`n${p.target.name}`] : [])));
  const byId = new Map(pattern.nodes.map((n) => [n.id, n]));
  const placed = new Set<Id>();
  const put = (n: Node, region: number, upFrom?: Node) => {
    order.push({ n, region, upFrom });
    placed.add(n.id);
    for (const l of linksOf(n)) onLink.add(l);
  };
  // a subtree, breadth first: each node once its parent is; but a node no link of its own reaches, holding one that a
  // bound link does reach, is met from that one upward (F85): it, by the link, then each ancestor as the one parent
  // of what was met, up to the node. So siblings joined only through their members (two polities by their border
  // cells; a realm beside a lone cell in Earth) cost the points on the link, not the pairs of siblings.
  // the order within a subtree (F94): of the nodes whose parent is met, a seeded one first; then one a bound link
  // reaches; then one holding a node a bound link reaches (met upward from it, F85); else the one whose parent is
  // deepest, nearest the seed, whose candidates are the fewest (a seeded realm's cells before Earth's members)
  const depth = (n: Node): number => ('node' in n.parent ? 1 + depth(byId.get(n.parent.node)!) : 0);
  const walk = (r: Node, region: number) => {
    const ready: Node[] = [r];
    while (ready.length) {
      const linked = (n: Node) => linksOf(n).some((l) => onLink.has(l));
      const entryOf = (n: Node) => (seeded?.has(n.id) || linked(n) ? undefined : subtree(n).find((x) => x !== n && !placed.has(x.id) && linked(x)));
      const score = (n: Node) => (seeded?.has(n.id) ? 4 : linked(n) ? 3 : entryOf(n) ? 2 : 1);
      let best = 0;
      for (let i = 1; i < ready.length; i++) {
        const a = ready[i], b = ready[best];
        if (score(a) > score(b) || (score(a) === score(b) && score(a) === 1 && depth(a) > depth(b))) best = i;
      }
      const [n] = ready.splice(best, 1);
      const entry = entryOf(n);
      const met: Node[] = [];
      if (entry) {
        const chain: Node[] = [entry];
        while (chain[chain.length - 1] !== n) chain.push(byId.get((chain[chain.length - 1].parent as { node: Id }).node)!);
        chain.forEach((x, j) => put(x, region, j ? chain[j - 1] : undefined));
        met.push(...chain);
      } else {
        put(n, region);
        met.push(n);
      }
      // what is now ready: the unmet children of what was met
      for (const m of met) for (const c of kids.get(parentKey({ node: m.id })) ?? []) if (!placed.has(c.id) && !ready.includes(c)) ready.push(c);
    }
  };
  // a region holding a seeded node is met first (F86): the others are then met from it by their links, not from
  // every node of their roots' types; and in a region, the root holding a seed first
  const regionOrder = regionRoots.map((_, i) => i).sort((a, b) => Number(firsts[b] >= 0) - Number(firsts[a] >= 0));
  for (const i of regionOrder) {
    const roots = regionRoots[i];
    const ordered = firsts[i] > 0 ? [roots[firsts[i]], ...roots.filter((_, j) => j !== firsts[i])] : roots;
    for (const r of ordered) walk(r, i);
  }

  const edgeIds = pattern.edges.map((e) => e.id);
  const edgeIndex = new Map(edgeIds.map((id, i) => [id, i]));
  const nameIds = [...new Set(pattern.nodes.flatMap((n) => n.ports.flatMap((g) => g.points.flatMap(([, p]) => ('name' in p.target ? [p.target.name] : [])))))];
  const nameIndex = new Map(nameIds.map((id, i) => [id, i]));
  const pointsOnEdge = edgeIds.map(() => 0);
  for (const n of pattern.nodes) for (const g of n.ports) for (const [, p] of g.points) if ('edge' in p.target) pointsOnEdge[edgeIndex.get(p.target.edge)!]++;
  const joinedSet = new Set(pattern.names.filter((h): h is { edge: Id } => 'edge' in h).map((h) => h.edge));

  const stepOf = new Map<Id, number>();
  const bound = new Set<string>(); // `${kind}:${target}` bound by an earlier step
  const steps: Step[] = order.map(({ n, region, upFrom }, i) => {
    stepOf.set(n.id, i);
    const decl = sig.has(sig.name(n.type)) ? sig.get(n.type) : undefined;
    const ports: GroupPlan[] = n.ports.map((g) => ({
      key: scalarKey(g.key),
      contract: g.contract,
      variadic: g.rest !== undefined || decl?.ports.find((p) => 'text' in g.key && p.key === g.key.text)?.arity === 0,
      rest: g.rest ?? null,
      points: g.points.map(([k, p]) => ({
        key: scalarKey(k),
        contract: p.contract,
        kind: 'edge' in p.target ? EDGE : 'name' in p.target ? NAME : 2,
        target: 'edge' in p.target ? edgeIndex.get(p.target.edge)! : 'name' in p.target ? nameIndex.get(p.target.name)! : NONE,
      })),
    }));
    let via: PointPlan | null = null;
    for (const g of ports) for (const p of g.points) if (!via && p.kind !== 2 && bound.has(`${p.kind}:${p.target}`)) via = p;
    for (const g of ports) for (const p of g.points) if (p.kind !== 2) bound.add(`${p.kind}:${p.target}`);
    return {
      pn: n,
      // (a node met before its parent, F85, has its parent checked by meeting the parent: it is the one candidate)
      parent: 'node' in n.parent ? (stepOf.get(n.parent.node) ?? NONE) : NONE,
      root: !('node' in n.parent),
      up: upFrom ? stepOf.get(upFrom.id)! : NONE,
      region,
      member: memberKey(n.member),
      keyed: keyed(n.member),
      payload: payloadKey(n),
      ports,
      via,
    };
  });
  const sites = pattern.sites.map((s, i) => {
    const k = pattern.siteKeys[i];
    return {
      parent: 'node' in s ? stepOf.get(s.node)! : NONE,
      region: 'region' in s ? s.region : NONE,
      key: k && keyed(k) ? memberKey(k) : null,
      attr: !!k && isAttr(k),
    };
  });
  const holdsSite = steps.map((_, i) => sites.some((s) => s.parent === i));
  const plan: Plan = {
    steps,
    stepOf,
    edgeIds,
    edgeIndex,
    nameIds,
    pointsOnEdge,
    joined: edgeIds.map((id) => joinedSet.has(id)),
    sites,
    holdsSite,
    regions: pattern.outer.places.length,
  };
  byOrder.set(cacheKey, plan);
  return plan;
}

/**
 * Every way `pattern` meets the state, each handed to `found` (return false to stop). `seed` fixes pattern nodes,
 * `seedEdges` pattern edges, `places0` regions' places.
 */
export function runPlan(
  ix: Index,
  pattern: Carrier,
  sig: Signature,
  found: (f: Found) => boolean | void,
  seed?: Map<Id, Id>,
  seedEdges?: Map<Id, Id>,
  places0?: (Parent | undefined)[],
  /**
   * Redex nodes whose one anonymous site nothing reads (`lazySites`): what that site holds is left unworked (an empty
   * list), to be found when the occurrence is used (`Discovery.fresh`). Ignored where a closed edge of the redex is
   * joined to an inner name, whose check reads what sites hold (F90).
   */
  lazy?: Set<Id>,
): void {
  const plan = planFor(pattern, seed?.size ? new Set(seed.keys()) : null, sig);
  const { steps, edgeIds } = plan;
  const S = steps.length;
  const nodeOf = new Array<Id>(S).fill(NONE);
  const edgeOf = new Array<Id>(edgeIds.length).fill(NONE);
  const nameOf = new Array<Handle | null>(plan.nameIds.length).fill(null);
  const nameKeyOf = new Array<string>(plan.nameIds.length).fill('');
  const places = places0 ? [...places0] : new Array<Parent | undefined>(plan.regions).fill(undefined);
  const placeSetBy = new Array<number>(plan.regions).fill(NONE);
  const used = new Set<Id>();
  const usedEdges = new Map<Id, number>(); // state edge → pattern edge index
  const nameUses = new Map<string, number>();
  const edgeStack: number[] = [];
  const nameStack: number[] = [];
  let stopped = false;

  const seedFor = steps.map((st) => seed?.get(st.pn.id) ?? NONE);
  const anyJoined = plan.joined.some(Boolean);

  const groupOf = (gn: Node, key: string) => groupsOf(gn).get(key);

  /** Bind one pattern point to a state handle; false where it cannot be (what it bound is undone by the caller). */
  const bindPoint = (pp: PointPlan, h: Handle): boolean => {
    if (pp.kind === EDGE) {
      if (!('edge' in h)) return false;
      const have = edgeOf[pp.target];
      if (have !== NONE) return h.edge === have;
      if (usedEdges.has(h.edge) || nameUses.has(handleKey(h))) return false;
      edgeOf[pp.target] = h.edge;
      usedEdges.set(h.edge, pp.target);
      edgeStack.push(pp.target);
      return true;
    }
    if (pp.kind === NAME) {
      const hk = handleKey(h);
      if (nameOf[pp.target]) return nameKeyOf[pp.target] === hk;
      if ('edge' in h && usedEdges.has(h.edge)) return false;
      nameOf[pp.target] = h;
      nameKeyOf[pp.target] = hk;
      nameUses.set(hk, (nameUses.get(hk) ?? 0) + 1);
      nameStack.push(pp.target);
      return true;
    }
    return false; // binders: not yet
  };

  const restStack: [string, { owner: Id; ports: Port[] }][] = [];
  const pointStack: [Id, string, string, string][] = [];

  /**
   * Bind a step's port groups to `gn`'s, from group `gi` on, and go on (`done`) for every way they bind. A group of
   * fixed arity binds point by key; a variadic one binds each pattern point to any state point not yet taken, and
   * its rest (if any) takes what is left.
   */
  const bindGroups = (st: Step, gn: Node, gi: number, done: () => void): void => {
    if (stopped) return;
    if (gi === st.ports.length) return done();
    const pg = st.ports[gi];
    const gg = groupOf(gn, pg.key);
    if (!gg || !sig.sub(gg.contract, pg.contract)) return;
    const em = edgeStack.length, nm = nameStack.length;
    if (!pg.variadic) {
      if (gg.points.length !== pg.points.length) return;
      let ok = true;
      for (const pp of pg.points) {
        let gp: (typeof gg.points)[number] | undefined;
        for (const x of gg.points) if (scalarKey(x[0]) === pp.key) { gp = x; break; }
        if (!gp || !sig.sub(gp[1].contract, pp.contract) || !bindPoint(pp, gp[1].target)) { ok = false; break; }
      }
      if (ok) bindGroups(st, gn, gi + 1, done);
      undo(em, nm);
      return;
    }
    if (pg.rest === null ? gg.points.length !== pg.points.length : gg.points.length < pg.points.length) return;
    const taken = new Array<boolean>(gg.points.length).fill(false);
    const place = (pi: number): void => {
      if (stopped) return;
      if (pi === pg.points.length) {
        if (pg.rest !== null) restStack.push([pg.rest, { owner: gn.id, ports: gg.points.filter((_, j) => !taken[j]).map(([, p]) => p) }]);
        bindGroups(st, gn, gi + 1, done);
        if (pg.rest !== null) restStack.pop();
        return;
      }
      const pp = pg.points[pi];
      for (let j = 0; j < gg.points.length; j++) {
        if (taken[j] || !sig.sub(gg.points[j][1].contract, pp.contract)) continue;
        const e2 = edgeStack.length, n2 = nameStack.length;
        if (bindPoint(pp, gg.points[j][1].target)) {
          taken[j] = true;
          pointStack.push([st.pn.id, pg.key, pp.key, scalarKey(gg.points[j][0])]);
          place(pi + 1);
          pointStack.pop();
          taken[j] = false;
        }
        undo(e2, n2);
      }
    };
    place(0);
    undo(em, nm);
  };

  const undo = (edgeMark: number, nameMark: number) => {
    while (edgeStack.length > edgeMark) {
      const t = edgeStack.pop()!;
      usedEdges.delete(edgeOf[t]);
      edgeOf[t] = NONE;
    }
    while (nameStack.length > nameMark) {
      const t = nameStack.pop()!;
      const hk = nameKeyOf[t];
      const c = nameUses.get(hk)! - 1;
      if (c) nameUses.set(hk, c);
      else nameUses.delete(hk);
      nameOf[t] = null;
      nameKeyOf[t] = '';
    }
  };

  const candidates = (k: number, st: Step): readonly Node[] => {
    const s = seedFor[k];
    if (s !== NONE) {
      const n = ix.node.get(s);
      return n ? [n] : [];
    }
    // met upward (F85): the parent of the child met before it
    if (st.up !== NONE) {
      const c = ix.node.get(nodeOf[st.up])!;
      const p = 'node' in c.parent ? ix.node.get(c.parent.node) : undefined;
      return p ? [p] : [];
    }
    if (st.via) {
      const h: Handle | null = st.via.kind === EDGE ? (edgeOf[st.via.target] !== NONE ? { edge: edgeOf[st.via.target] } : null) : nameOf[st.via.target];
      if (h) {
        const pts = ix.pointsOn(h);
        const out: Node[] = [];
        for (const p of pts) {
          const n = ix.node.get(p.node)!;
          if (!out.includes(n)) out.push(n);
        }
        return out;
      }
    }
    // a keyed member is found by its key, not among all its siblings
    if (st.parent !== NONE) {
      if (st.keyed) {
        const c = ix.childAt({ node: nodeOf[st.parent] }, st.member);
        return c ? [c] : [];
      }
      return ix.children({ node: nodeOf[st.parent] });
    }
    const place = places[st.region];
    if (place && st.keyed) {
      const c = ix.childAt(place, st.member);
      return c ? [c] : [];
    }
    return place ? ix.children(place) : ix.ofType(sig.downs(st.pn.type));
  };

  const assign = (k: number): void => {
    if (k === S) return finish();
    const st = steps[k];
    for (const gn of candidates(k, st)) {
      if (stopped) return;
      if (used.has(gn.id)) continue;
      if (!sig.sub(gn.type, st.pn.type) || payloadKey(gn) !== st.payload || memberKey(gn.member) !== st.member || gn.ports.length !== st.ports.length) continue;
      if (st.parent !== NONE) {
        if (!('node' in gn.parent) || gn.parent.node !== nodeOf[st.parent]) continue;
      }
      let placed = false;
      if (st.root) {
        const place = places[st.region];
        if (place) {
          if (parentKey(place) !== parentKey(gn.parent)) continue;
        } else {
          places[st.region] = gn.parent;
          placeSetBy[st.region] = k;
          placed = true;
        }
      }
      const em = edgeStack.length, nm = nameStack.length;
      nodeOf[k] = gn.id;
      used.add(gn.id);
      bindGroups(st, gn, 0, () => assign(k + 1));
      undo(em, nm);
      used.delete(gn.id);
      nodeOf[k] = NONE;
      if (placed) {
        places[st.region] = undefined;
        placeSetBy[st.region] = NONE;
      }
    }
  };

  const finish = (): void => {
    if (seedEdges) for (const [pe, ge] of seedEdges) {
      const i = plan.edgeIndex.get(pe);
      if (i !== undefined && edgeOf[i] !== NONE && edgeOf[i] !== ge) return;
    }
    // the context stands outside the redex
    for (const place of places) {
      if (!place) return;
      for (let cur: Parent = place; 'node' in cur; cur = ix.node.get(cur.node)!.parent) if (used.has(cur.node)) return;
    }
    // a closed edge holds exactly its points (and, joined to an inner name, what its sites hold)
    for (let i = 0; i < edgeIds.length; i++) {
      const ge = edgeOf[i];
      if (ge === NONE) continue;
      const pEdge = pattern.edges[i];
      const gEdge = ix.edge.get(ge)!;
      if (!sig.sub(gEdge.contract, pEdge.contract)) return;
      const want = pEdge.value === null ? null : plan.stepOf.has(pEdge.value) ? nodeOf[plan.stepOf.get(pEdge.value)!] : pEdge.value;
      if (gEdge.value !== want) return;
      const n = ix.pointsOn({ edge: ge }).length;
      const p = plan.pointsOnEdge[i];
      if (plan.joined[i] ? n < p : n !== p) return;
    }
    // a matched node holding no site holds exactly what the pattern says
    for (let k = 0; k < S; k++) {
      if (plan.holdsSite[k]) continue;
      for (const c of ix.children({ node: nodeOf[k] })) if (!used.has(c.id)) return;
    }
    siteChoices();
  };

  /** What the sites hold: worked out directly where each node holds at most one anonymous site, else every split. */
  const siteChoices = (): void => {
    const sites: Id[][] = plan.sites.map(() => []);
    const taken = new Set<Id>();
    // keyed sites: exactly what stands at the key
    plan.sites.forEach((s, i) => {
      if (s.key === null) return;
      const at: Parent = s.parent !== NONE ? { node: nodeOf[s.parent] } : places[s.region]!;
      const c = ix.childAt(at, s.key);
      if (c && !used.has(c.id) && !taken.has(c.id)) {
        sites[i] = [c.id];
        taken.add(c.id);
      }
    });
    // anonymous sites in nodes: what is left there (attributes never), split among them
    const splits: { site: number[]; rest: Id[] }[] = [];
    for (let k = 0; k < S; k++) {
      if (!plan.holdsSite[k]) continue;
      const anon: number[] = [];
      plan.sites.forEach((s, i) => s.parent === k && s.key === null && anon.push(i));
      // a lazy node's one site: whatever is left is its, worked out only when the occurrence is used. Not where a
      // closed edge is joined to an inner name: what the sites hold may then be on it, and that is checked (F90); a
      // closed edge not joined holds exactly the points the redex binds, all on nodes it meets, so nothing a site
      // holds is on it and there is nothing to check
      if (lazy && anon.length === 1 && !anyJoined && lazy.has(steps[k].pn.id)) continue;
      const rest: Id[] = [];
      for (const c of ix.children({ node: nodeOf[k] })) {
        if (used.has(c.id) || taken.has(c.id)) continue;
        if (isAttr(c.member)) return; // an attribute is never cut from its node, nor held by an anonymous site
        rest.push(c.id);
      }
      if (!anon.length) {
        if (rest.length) return;
      } else if (anon.length === 1) sites[anon[0]] = rest;
      else splits.push({ site: anon, rest });
    }
    if (!splits.length) return emit(sites);
    // several anonymous sites in one node: every way to share out what is left
    const go = (g: number): void => {
      if (stopped) return;
      if (g === splits.length) return emit(sites.map((x) => [...x]));
      const { site, rest } = splits[g];
      const bins = site.map(() => [] as Id[]);
      const put = (i: number): void => {
        if (stopped) return;
        if (i === rest.length) {
          site.forEach((si, j) => (sites[si] = bins[j]));
          return go(g + 1);
        }
        for (const bin of bins) {
          bin.push(rest[i]);
          put(i + 1);
          bin.pop();
        }
      };
      put(0);
    };
    go(0);
  };

  const emit = (sites: Id[][]): void => {
    if (!paramLinksOk(sites)) return;
    const f: Found = {
      nodes: steps.map((st, k) => [st.pn.id, nodeOf[k]] as [Id, Id]),
      edges: edgeIds.flatMap((id, i) => (edgeOf[i] !== NONE ? [[id, edgeOf[i]] as [Id, Id]] : [])),
      sites,
      places: places.map((p) => p!),
      names: plan.nameIds.flatMap((id, i) => (nameOf[i] ? [[id, nameOf[i]!] as [Id, Handle]] : [])),
      rests: restStack.map(([n, r]) => [n, { owner: r.owner, ports: [...r.ports] }]),
      points: [...pointStack],
    };
    if (found(f) === false) stopped = true;
  };

  /** What the sites hold reaches a closed redex edge only through an inner name joined to it. */
  const paramLinksOk = (sites: Id[][]): boolean => {
    if (usedEdges.size === 0) return true;
    const inParam = new Set<Id>();
    for (const roots of sites) for (const r of roots) for (const id of ix.subtree(r)) inParam.add(id);
    for (const id of inParam)
      for (const grp of ix.node.get(id)!.ports)
        for (const [, p] of grp.points)
          if ('edge' in p.target && usedEdges.has(p.target.edge) && !plan.joined[usedEdges.get(p.target.edge)!]) return false;
    for (let i = 0; i < edgeIds.length; i++) {
      if (!plan.joined[i] || edgeOf[i] === NONE) continue;
      for (const pt of ix.pointsOn({ edge: edgeOf[i] })) if (!used.has(pt.node) && !inParam.has(pt.node)) return false;
    }
    return true;
  };

  assign(0);
}
