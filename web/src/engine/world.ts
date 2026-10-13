/**
 * A world: one state, changed in place, for long runs of large systems.
 *
 * `react` makes each new state by decomposing the old one and composing the pieces again (`apply_spec`, taken
 * literally), so a reaction costs time in proportion to the whole state. That suits the editor, which keeps every
 * frame. A cell does not: its genome alone is thousands of nodes, and a reaction touches a handful. A world applies
 * the same reaction as a local rewrite (the matched nodes, what moved, was copied or dropped, and the reactum's fresh
 * nodes), and keeps its index current by exactly those changes. So a reaction costs time in proportion to what it
 * touches.
 *
 * It is a fast path, and a fast path is a proved equality with the plain one or it does not exist (chrysalis
 * CLAUDE.md). Here the proof is a test: `test/world.test.ts` applies every reaction of every system both ways and
 * requires the states to be the same carrier, identities included (`react` given the world's identity counters), and
 * incremental discovery over the world to find what a full search finds after every step.
 *
 * What it reports as changed is sharper than `react`'s transition. A site's contents put back where they stood (the
 * same parent, at the same key) did not move, so they are not reported. Without that, a rule meeting a cell through
 * `Cell(… | ?rest)` would report the whole genome moved by every reaction.
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
  type PointRef,
  type PortGroup,
  handleKey,
  isAttr,
  keyed,
  memberKey,
  nextIds,
  parentKey,
  scalarKey,
} from './carrier';
import { evaluate } from './expr';
import { type Occurrence, siteEnv } from './match';
import type { Transition } from './react';
import type { Rule } from './rule';
import type { Signature } from './signature';

/** What discovery needs to see of a state: its nodes by identity, and the points on each handle. */
export interface View {
  node: { get(id: Id): Node | undefined };
  pointsOn(h: Handle): PointRef[];
}

/** The part of the state before a reaction that the reaction could have changed, kept for discovery. */
export class Before implements View {
  readonly nodes = new Map<Id, Node>();
  private readonly points = new Map<string, PointRef[]>();
  readonly node = { get: (id: Id) => this.nodes.get(id) };
  constructor(private readonly ix: Index) {}
  /** Keep a node, everything holding it, and what shares a link with it. */
  keep(id: Id, linked = true) {
    let n = this.ix.node.get(id);
    while (n && !this.nodes.has(n.id)) {
      this.nodes.set(n.id, n);
      if (linked) for (const g of n.ports) for (const [, p] of g.points) this.handle(p.target);
      n = 'node' in n.parent ? this.ix.node.get(n.parent.node) : undefined;
    }
  }
  /** Keep the points on a handle, and the nodes they are on (with what holds them). */
  handle(h: Handle) {
    const k = handleKey(h);
    if (this.points.has(k)) return;
    const pts = [...this.ix.pointsOn(h)];
    this.points.set(k, pts);
    for (const p of pts) this.keep(p.node, false);
  }
  pointsOn(h: Handle): PointRef[] {
    return this.points.get(handleKey(h)) ?? [];
  }
  /** Take in what another view kept, where this one has not kept it already (the earlier view wins). */
  absorb(other: Before) {
    for (const [id, n] of other.nodes) if (!this.nodes.has(id)) this.nodes.set(id, n);
    for (const [k, pts] of other.points) if (!this.points.has(k)) this.points.set(k, pts);
  }
}

export interface Applied {
  transition: Transition;
  /** The state before, as far as the reaction could have changed it. */
  before: Before;
}

export class World {
  /** The state: the same object throughout, its lists and index changed in place. */
  readonly g: Carrier;
  readonly ix: Index;
  next: { node: Id; edge: Id; name: Id };
  private readonly edgePos = new Map<Id, number>();

  constructor(start: Carrier) {
    this.g = structuredClone(start);
    this.ix = Index.of(this.g);
    this.next = nextIds(this.g);
    this.g.edges.forEach((e, i) => this.edgePos.set(e.id, i));
  }

  /** The state as an ordinary, unchanging carrier. */
  snapshot(): Carrier {
    return structuredClone(this.g);
  }

  // ── the state's lists and index, changed together ─────────────────────────────────────────────────────────

  private addNode(n: Node) {
    this.ix.pos.set(n.id, this.g.nodes.length);
    this.g.nodes.push(n);
    this.ix.node.set(n.id, n);
    (this.ix.byType.get(n.type) ?? this.ix.byType.set(n.type, []).get(n.type)!).push(n);
    const pk = parentKey(n.parent);
    (this.ix.kids.get(pk) ?? this.ix.kids.set(pk, []).get(pk)!).push(n);
    this.ix.rekey(n, true);
    for (const grp of n.ports)
      for (const [pt, port] of grp.points) {
        const hk = handleKey(port.target);
        (this.ix.points.get(hk) ?? this.ix.points.set(hk, []).get(hk)!).push({ node: n.id, group: grp.key, point: pt });
      }
  }

  private dropNode(id: Id) {
    const n = this.ix.node.get(id)!;
    const i = this.ix.pos.get(id)!;
    const last = this.g.nodes.pop()!;
    if (last.id !== id) {
      this.g.nodes[i] = last;
      this.ix.pos.set(last.id, i);
    }
    this.ix.pos.delete(id);
    this.ix.node.delete(id);
    const same = this.ix.byType.get(n.type)!;
    same.splice(same.indexOf(n), 1);
    const pk = parentKey(n.parent);
    const kids = this.ix.kids.get(pk)!;
    kids.splice(kids.indexOf(n), 1);
    if (!kids.length) this.ix.kids.delete(pk);
    this.ix.rekey(n, false);
    for (const grp of n.ports)
      for (const [, port] of grp.points) {
        const hk = handleKey(port.target);
        const pts = this.ix.points.get(hk)!;
        const j = pts.findIndex((p) => p.node === id && scalarKey(p.group) === scalarKey(grp.key));
        pts.splice(j, 1);
        if (!pts.length) this.ix.points.delete(hk);
      }
  }

  private replaceNode(n: Node) {
    this.dropNode(n.id);
    this.addNode(n);
  }

  private addEdge(e: Edge) {
    this.edgePos.set(e.id, this.g.edges.length);
    this.g.edges.push(e);
    this.ix.edge.set(e.id, e);
  }

  private dropEdge(id: Id) {
    const i = this.edgePos.get(id);
    if (i === undefined) return;
    const last = this.g.edges.pop()!;
    if (last.id !== id) {
      this.g.edges[i] = last;
      this.edgePos.set(last.id, i);
    }
    this.edgePos.delete(id);
    this.ix.edge.delete(id);
  }

  // ── a reaction, in place ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Apply `rule` at `occ`: the reaction `react` would make, made here.
   *
   * `inPlace`: a value the reactum writes at a key of a node it keeps (`?m = Pool[atp = ?a - 1]`), where the redex
   * held a lone scalar at that key in a site it drops, is written into that scalar where it stands, rather than the
   * scalar removed and a fresh one made. That is the reaction up to the identities of the scalars it rewrites (as
   * `applyRepeated`): every other identity is react's, since the identity a rewritten scalar would have taken is
   * used up all the same. The transition names them as `revalued`, so discovery can see that only values changed there,
   * and keep what met them.
   */
  apply(rule: Rule, occ: Occurrence, sig?: Signature, opts: { inPlace?: boolean } = {}): Applied {
    const ix = this.ix;
    const R = rule.redex, X = rule.reactum, σ = rule.sites;
    const nmap = new Map(occ.nodes);
    const emap = new Map(occ.edges);
    const imageEdges = new Set(emap.values());
    const redexEdgeOf = new Map([...emap].map(([p, s]) => [s, p]));
    const named = new Set(occ.names.map(([, h]) => handleKey(h)));
    const nameHandle = new Map(occ.names);

    // the state before, as far as this reaction reaches
    const before = new Before(ix);
    for (const [, s] of occ.nodes) before.keep(s);
    for (const roots of occ.sites) for (const r of roots) before.keep(r);
    for (const e of imageEdges) before.handle({ edge: e });

    // values computed from what the sites hold, read before anything changes
    const env = siteEnv(ix, occ.sites, sig, occ.rests);
    const computedOf = new Map((rule.computed ?? []).map((c) => [c.node, evaluate(c.expr, env, c.kind)]));

    // what each site holds, walked only where it is needed (a site dropped or copied, or one whose contents link
    // to a closed redex edge): a site put back where it stood costs nothing, however much it holds
    const ownCache = new Map<number, Id[]>();
    const own = (j: number): Id[] => {
      let ids = ownCache.get(j);
      if (!ids) ownCache.set(j, (ids = occ.sites[j].flatMap((r) => ix.subtree(r))));
      return ids;
    };
    const internalOf = (j: number): Edge[] => {
      const set = new Set(own(j));
      const out: Edge[] = [];
      const seen = new Set<Id>();
      for (const id of own(j))
        for (const grp of ix.node.get(id)!.ports)
          for (const [, p] of grp.points) {
            if (!('edge' in p.target) || seen.has(p.target.edge)) continue;
            const e = p.target.edge;
            seen.add(e);
            if (imageEdges.has(e) || named.has(handleKey({ edge: e }))) continue;
            const pts = ix.pointsOn({ edge: e });
            const edge = ix.edge.get(e)!;
            if (!pts.every((q) => set.has(q.node))) continue;
            if (edge.value !== null && !set.has(edge.value)) continue;
            out.push(edge);
          }
      // in the state's edge order, as `decompose` lists them
      return out.sort((a, b) => this.edgePos.get(a.id)! - this.edgePos.get(b.id)!);
    };

    // identities: copies first (as `react` mints them), then the reactum's fresh nodes and edges
    let nextNode = this.next.node, nextEdge = this.next.edge;
    const moved: Id[] = [], copied: [Id, Id][] = [], removed: Id[] = [], created: Id[] = [];
    const edgesRemoved: Id[] = [], edgesCreated: Id[] = [];

    // the reactum's nodes: kept ones are the state's, the rest fresh
    const keptTo = new Map(rule.kept.map(([a, b]) => [b, nmap.get(a)!]));
    const keptFrom = new Map(rule.kept.map(([a, b]) => [b, a]));
    const keptEdgeTo = new Map(rule.keptEdges.map(([a, b]) => [b, emap.get(a)!]));
    const redexType = new Map(R.nodes.map((n) => [n.id, n.type]));

    // where a reactum place stands in the state
    const fn = new Map<Id, Id>();
    const placeOf = (p: Parent): Parent => ('node' in p ? { node: fn.get(p.node)! } : occ.places[p.region]);

    // site uses: the first moves what the site held, a later one copies it, none drops it
    type Plan = { j: number; src: number; first: boolean };
    const plans: Plan[] = σ.map((src, j) => ({ j, src, first: σ.indexOf(src) === j }));
    const copies: { plan: Plan; nm: Map<Id, Id>; em: Map<Id, Id>; edges: Edge[] }[] = [];
    for (const plan of plans) {
      if (plan.first) continue;
      const edges = internalOf(plan.src);
      const nm = new Map(own(plan.src).map((id) => [id, nextNode++]));
      const em = new Map(edges.map((e) => [e.id, nextEdge++]));
      copies.push({ plan, nm, em, edges });
    }
    // values written in place (`inPlace`): reactum scalar → the state scalar it rewrites, and the sites they stood in
    const reuse = new Map<Id, Id>();
    const reusedSites = new Set<number>();
    if (opts.inPlace) {
      const used = new Set(σ);
      for (const n of X.nodes) {
        if (keptTo.has(n.id) || n.ports.length || !('node' in n.parent) || !isAttr(n.member) || !keyed(n.member)) continue;
        if (!computedOf.has(n.id) && typeof n.payload !== 'object') continue;
        const rp = keptFrom.get(n.parent.node);
        if (rp === undefined) continue;
        const mk = memberKey(n.member);
        const i = R.sites.findIndex((p, j) => !used.has(j) && !reusedSites.has(j) && 'node' in p && p.node === rp && memberKey(R.siteKeys[j]) === mk);
        if (i < 0 || occ.sites[i].length !== 1) continue;
        const at = ix.node.get(occ.sites[i][0])!;
        if (typeof at.payload !== 'object' || at.ports.length || at.type !== n.type || ix.subtree(at.id).length !== 1) continue;
        reuse.set(n.id, at.id);
        reusedSites.add(i);
      }
    }
    for (const n of X.nodes) {
      const k = keptTo.get(n.id);
      if (k !== undefined) fn.set(n.id, k);
      else if (reuse.has(n.id)) {
        // the identity `react` would mint is used up all the same, so every other fresh node has react's identity
        fn.set(n.id, reuse.get(n.id)!);
        nextNode++;
      } else {
        fn.set(n.id, nextNode);
        created.push(nextNode++);
      }
    }
    const fe = new Map<Id, Id>();
    for (const e of X.edges) {
      const k = keptEdgeTo.get(e.id);
      if (k !== undefined) fe.set(e.id, k);
      else {
        fe.set(e.id, nextEdge);
        edgesCreated.push(nextEdge++);
      }
    }

    // where a reactum point goes in the state
    const reactumHandle = (h: Handle): Handle => {
      if ('edge' in h) return { edge: fe.get(h.edge)! };
      if ('name' in h) {
        const s = nameHandle.get(h.name);
        if (!s) throw new Error(`reactum name ${h.name} met nothing`);
        return s;
      }
      return { binder: fn.get(h.binder)! };
    };
    // a point a site's contents had on a closed redex edge passes through the redex's inner name to whatever the
    // reactum joins that inner name to
    const innerTarget = (h: Handle): Handle => {
      if (!('edge' in h) || !imageEdges.has(h.edge)) return h;
      const pe = redexEdgeOf.get(h.edge)!;
      const y = R.names.findIndex((x) => 'edge' in x && x.edge === pe);
      const z = R.inner.names[y][0];
      const yi = X.inner.names.findIndex(([x]) => x === z);
      return reactumHandle(X.names[yi]);
    };
    const restPorts = new Map(occ.rests ?? []);
    const portsOf = (groups: PortGroup[]): PortGroup[] =>
      groups.map(({ rest, ...grp }) => {
        const mine = grp.points.map(([k, p]) => [k, { ...p, target: reactumHandle(p.target) }] as const);
        if (!rest) return { ...grp, points: mine.map(([k, p]) => [k, p]) };
        const held = restPorts.get(rest)?.ports ?? [];
        const points = [...mine.map(([, p]) => p), ...held.map((p) => ({ contract: p.contract, target: p.target }))];
        return { ...grp, points: points.map((p, i) => [{ int: i }, p]) };
      });
    const siteMember = (src: number, j: number, m: Member): Member =>
      keyed(X.siteKeys[j] ?? ANON) ? X.siteKeys[j] : keyed(R.siteKeys[src] ?? ANON) ? ANON : m;

    // 1. what nothing keeps: the redex's image but for kept nodes, and what unused sites held
    const keptState = new Set(keptTo.values());
    const dropped = new Set<number>(occ.sites.map((_, i) => i).filter((i) => !σ.includes(i) && !reusedSites.has(i)));
    for (const i of dropped) for (const id of own(i)) removed.push(id);
    const droppedEdges: Id[] = [];
    for (const i of dropped) for (const e of internalOf(i)) droppedEdges.push(e.id);
    for (const [, s] of occ.nodes) if (!keptState.has(s)) removed.push(s);

    // edges a removed node had points on: idle afterwards, perhaps
    const touchedEdges = new Set<Id>();
    for (const id of removed)
      for (const grp of ix.node.get(id)!.ports) for (const [, pt] of grp.points) if ('edge' in pt.target) touchedEdges.add(pt.target.edge);

    // the reactum's nodes, as they will stand
    const reactumNodes: Node[] = X.nodes.map((n) => {
      const id = fn.get(n.id)!;
      const from = keptFrom.get(n.id);
      const stateType = from !== undefined ? ix.node.get(nmap.get(from)!)!.type : n.type;
      const type = from !== undefined && redexType.get(from) === n.type ? stateType : n.type;
      return {
        id,
        type,
        parent: n.parent,
        member: n.member,
        payload: computedOf.has(n.id) ? { scalar: computedOf.get(n.id)! } : n.payload,
        ports: portsOf(n.ports),
      };
    });

    // 2. apply: removals, then the reactum, then what the sites held
    for (const id of removed) this.dropNode(id);
    for (const e of droppedEdges) if (this.ix.edge.has(e)) (this.dropEdge(e), edgesRemoved.push(e));
    for (const [p, s] of occ.edges) if (!rule.keptEdges.some(([a]) => a === p)) (this.dropEdge(s), edgesRemoved.push(s));
    for (const e of X.edges) if (!keptEdgeTo.has(e.id)) this.addEdge({ ...e, id: fe.get(e.id)!, value: e.value === null ? null : fn.get(e.value)! });
    const revalued = new Set(reuse.values());
    for (const n of reactumNodes) {
      // a value written where it stands: only its payload (`Before` keeps parents and links, never values)
      if (revalued.has(n.id)) {
        (ix.node.get(n.id) as { payload: Node['payload'] }).payload = n.payload;
        continue;
      }
      const node = { ...n, parent: placeOf(n.parent) };
      if (keptState.has(n.id)) this.replaceNode(node);
      else this.addNode(node);
    }
    for (const plan of plans) {
      const where = placeOf(X.sites[plan.j]);
      if (plan.first) {
        for (const r of occ.sites[plan.src]) {
          const n = this.ix.node.get(r)!;
          const member = siteMember(plan.src, plan.j, n.member);
          const ports = n.ports.map((grp) => ({ ...grp, points: grp.points.map(([k, p]) => [k, { ...p, target: innerTarget(p.target) }] as typeof grp.points[number]) }));
          const relinked = JSON.stringify(ports) !== JSON.stringify(n.ports);
          if (parentKey(n.parent) === parentKey(where) && memberKey(n.member) === memberKey(member) && !relinked) continue;
          this.replaceNode({ ...n, parent: where, member, ports });
          moved.push(r);
        }
        // a point inside, below the roots, on a closed redex edge (only a redex with closed edges can have one)
        if (imageEdges.size) for (const id of own(plan.src)) {
          if (occ.sites[plan.src].includes(id)) continue;
          const n = this.ix.node.get(id)!;
          if (!n.ports.some((g) => g.points.some(([, p]) => 'edge' in p.target && imageEdges.has(p.target.edge)))) continue;
          this.replaceNode({ ...n, ports: n.ports.map((grp) => ({ ...grp, points: grp.points.map(([k, p]) => [k, { ...p, target: innerTarget(p.target) }] as typeof grp.points[number]) })) });
          moved.push(id);
        }
      }
    }
    for (const { plan, nm, em, edges } of copies) {
      const where = placeOf(X.sites[plan.j]);
      for (const e of edges) {
        this.addEdge({ ...e, id: em.get(e.id)!, value: e.value === null ? null : (nm.get(e.value) ?? e.value) });
        edgesCreated.push(em.get(e.id)!);
      }
      const roots = new Set(occ.sites[plan.src]);
      for (const id of own(plan.src)) {
        // the original, as it stood before this reaction moved it
        const n = before.nodes.get(id) ?? this.ix.node.get(id)!;
        const isRoot = roots.has(id);
        this.addNode({
          ...n,
          id: nm.get(id)!,
          parent: isRoot ? where : { node: nm.get((n.parent as { node: Id }).node)! },
          member: isRoot ? siteMember(plan.src, plan.j, n.member) : n.member,
          ports: n.ports.map((grp) => ({
            ...grp,
            points: grp.points.map(([k, p]) => [
              k,
              { ...p, target: 'edge' in p.target && em.has(p.target.edge) ? { edge: em.get(p.target.edge)! } : innerTarget(p.target) },
            ]),
          })),
        });
        copied.push([id, nm.get(id)!]);
      }
    }

    // 3. states up to idle edges (F38): an edge whose last points went with what was removed goes too
    for (const e of touchedEdges) {
      const edge = this.ix.edge.get(e);
      if (edge && edge.value === null && this.ix.pointsOn({ edge: e }).length === 0) {
        this.dropEdge(e);
        edgesRemoved.push(e);
      }
    }

    this.next = { node: nextNode, edge: nextEdge, name: this.next.name };
    return {
      transition: {
        rule: rule.name,
        occurrence: occ,
        kept: [...keptState, ...revalued],
        removed,
        created,
        moved,
        copied,
        edgesRemoved,
        edgesCreated,
        ...(revalued.size ? { revalued: [...revalued] } : {}),
      },
      before,
    };
  }

  /**
   * Apply an affine count rule `k` times at once: each count it changes moves by `k` times its step. This is the
   * reaction applied k times over, up to the identities of the scalar nodes it rewrites (here kept, there fresh),
   * wherever every intermediate state is one the rule meets (each count moves one way, so: wherever the end is).
   * Proved so by `test/world.test.ts`. It is what a τ-leaping policy needs: many firings in one step.
   */
  applyRepeated(rule: Rule, occ: Occurrence, k: number, steps: Affine[]): Applied {
    const nmap = new Map(occ.nodes);
    const before = new Before(this.ix);
    const kept: Id[] = [];
    for (const s of steps) {
      const host = nmap.get(s.node)!;
      const at = this.ix.childAt({ node: host }, stepKey(s));
      if (!at || typeof at.payload !== 'object' || !('int' in at.payload.scalar)) throw new Error(`${rule.name}: no whole number at ${s.key}`);
      before.keep(at.id);
      // only the count's value: the node stays where it is in every list and index, so it is changed where it stands
      // (a world's nodes are its own; `Before` keeps parents and links, never values)
      (at as { payload: Node['payload'] }).payload = { scalar: { int: at.payload.scalar.int + k * s.step } };
      kept.push(host, at.id);
    }
    return {
      transition: { rule: rule.name, occurrence: occ, kept, removed: [], created: [], moved: [], copied: [], edgesRemoved: [], edgesCreated: [], revalued: kept.filter((_, i) => i % 2 === 1) },
      before,
    };
  }
}

/** Each affine step's member key, worked out once (a step is asked for it on every firing). */
const stepKeys = new WeakMap<Affine, string>();
const stepKey = (s: Affine): string => {
  let k = stepKeys.get(s);
  if (k === undefined) stepKeys.set(s, (k = memberKey({ attr: { text: s.key } })));
  return k;
};

/** One count an affine rule changes: the redex node holding it, its key, and how far one firing moves it. */
export interface Affine {
  node: Id;
  key: string;
  step: number;
}

/**
 * Whether a rule only adds constants to whole-number attributes of the nodes it meets, and if so which and by how
 * much. That means:
 * - every redex node is kept, and none is linked;
 * - the reactum's only fresh nodes are those attributes, each `?x + c` or `?x - c` of the attribute's own value;
 * - every other site is put back where it stood.
 *
 * Such a rule's k firings are one step of k (`World.applyRepeated`), the basis of τ-leaping.
 */
export function affine(rule: Rule): Affine[] | null {
  const R = rule.redex, X = rule.reactum;
  if (R.outer.places.length !== 1 || rule.kept.length !== R.nodes.length) return null;
  const keptTo = new Map(rule.kept.map(([a, b]) => [b, a]));
  // links: a node may be linked, so long as the reaction leaves its links as they were (the same names, the same points)
  const portsOf = (n: Node) => JSON.stringify(n.ports.map((g) => [g.key, g.contract, g.points, g.rest ?? null]));
  for (const n of X.nodes) {
    const from = keptTo.get(n.id);
    if (from === undefined) {
      if (n.ports.length) return null;
      continue;
    }
    const r = R.nodes.find((x) => x.id === from)!;
    if (portsOf(r) !== portsOf(n) || r.ports.some((g) => g.points.some(([, p]) => 'edge' in p.target))) return null;
  }
  const computed = new Map((rule.computed ?? []).map((c) => [c.node, c]));
  const used = new Set<number>();
  const out: Affine[] = [];
  for (const n of X.nodes) {
    if (keptTo.has(n.id)) {
      const r = R.nodes.find((x) => x.id === keptTo.get(n.id))!;
      const rp = 'node' in n.parent ? { node: keptTo.get(n.parent.node) } : n.parent;
      if (r.type !== n.type || JSON.stringify(r.parent) !== JSON.stringify(rp)) return null;
      continue;
    }
    const c = computed.get(n.id);
    if (!c || c.kind !== 'int' || !('node' in n.parent) || !keptTo.has(n.parent.node)) return null;
    if (!('attr' in n.member) || !n.member.attr || !('text' in n.member.attr)) return null;
    const e = c.expr;
    if (!('op' in e) || (e.op !== '+' && e.op !== '-') || e.args.length !== 2) return null;
    const [a, b] = e.args;
    const lit = (x: (typeof e.args)[number]) => ('lit' in x && 'int' in x.lit ? x.lit.int : null);
    let site: number, step: number;
    if ('site' in a && lit(b) !== null) (site = a.site), (step = e.op === '+' ? lit(b)! : -lit(b)!);
    else if (e.op === '+' && 'site' in b && lit(a) !== null) (site = b.site), (step = lit(a)!);
    else return null;
    // the site read is the attribute's own value: at this key, on this node, in the redex
    const host = keptTo.get(n.parent.node)!;
    const sp = R.sites[site], sk = R.siteKeys[site];
    if (!('node' in sp) || sp.node !== host || !('attr' in sk) || !sk.attr || !('text' in sk.attr) || sk.attr.text !== n.member.attr.text) return null;
    if (rule.sites.includes(site) || used.has(site)) return null;
    used.add(site);
    out.push({ node: host, key: n.member.attr.text, step });
  }
  // every other site put back where it stood, once
  for (let j = 0; j < X.sites.length; j++) {
    const i = rule.sites[j];
    const rp = R.sites[i], xp = X.sites[j];
    if (used.has(i) || rule.sites.indexOf(i) !== j) return null;
    if (!('node' in rp) || !('node' in xp) || keptTo.get(xp.node) !== rp.node || memberKey(R.siteKeys[i]) !== memberKey(X.siteKeys[j])) return null;
  }
  if (R.sites.some((_, i) => !used.has(i) && !rule.sites.includes(i))) return null;
  return out.length ? out : null;
}
