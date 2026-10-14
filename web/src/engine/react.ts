/**
 * Reaction: an occurrence replaced (chrysalis `Spec/Axes/Reaction.lean`).
 *
 * `decompose` writes the state as context ∘ met ∘ parameter around an occurrence (`Occurrence.Meets`), and
 * `react` is `apply_spec` taken literally: what the sites held, instantiated by the site map (`Instantiates`),
 * composed into the reactum put in fresh but for what it keeps (`Rule.Fresh`), composed into the context. So a
 * reaction is correct by construction wherever composition is, and the tests check the decomposition composes
 * back to the state it came from.
 *
 * Links that leave what a site holds, to anything the redex does not close, pass through names the rule is
 * tensored with: R ⊗ id_X, Milner's parametric rule taken with the idle names it needs (`implicit`).
 */

import {
  ANON,
  type Carrier,
  type Edge,
  type Handle,
  type Id,
  Index,
  type Interface,
  type Node,
  type PortGroup,
  handleKey,
  scalarKey,
  keyed,
  nextIds,
  relabel,
} from './carrier';
import { compose } from './compose';
import { type Occurrence, siteEnv } from './match';
import { evaluate } from './expr';
import type { Rule } from './rule';
import type { Signature } from './signature';

export interface Decomposition {
  context: Carrier;
  met: Carrier;
  parameter: Carrier;
  /** The names the rule is tensored with: each a name and the state handle it carries. */
  implicit: [Id, Handle][];
}

const NAME_TYPE = 0;

export function decompose(g: Carrier, rule: Rule, occ: Occurrence): Decomposition {
  const R = rule.redex;
  const ix = Index.of(g);
  const nmap = new Map(occ.nodes);
  const emap = new Map(occ.edges);
  const image = new Set(nmap.values());
  const imageEdges = new Set(emap.values());
  const redexEdgeOf = new Map([...emap].map(([p, s]) => [s, p]));
  const nameHandles = new Map(occ.names);
  const named = new Set([...nameHandles.values()].map(handleKey));

  // what each site holds, by region of the parameter
  const regionOf = new Map<Id, number>();
  occ.sites.forEach((roots, j) => {
    for (const r of roots) for (const id of ix.subtree(r)) regionOf.set(id, j);
  });

  // the parameter's own edges: every point in one of its regions, and no redex name standing on it
  const internal = new Set<Id>();
  for (const e of g.edges) {
    if (imageEdges.has(e.id) || named.has(handleKey({ edge: e.id }))) continue;
    const pts = ix.pointsOn({ edge: e.id });
    if (!pts.length) continue;
    const j = regionOf.get(pts[0].node);
    if (j === undefined || !pts.every((p) => regionOf.get(p.node) === j)) continue;
    if (e.value !== null && regionOf.get(e.value) !== j) continue;
    internal.add(e.id);
  }

  // the name each outside handle a site's contents point at passes through
  const fresh = nextIds(g).name;
  let nextName = Math.max(fresh, ...[...R.inner.names, ...R.outer.names].map(([x]) => x + 1));
  const implicit: [Id, Handle][] = [];
  const implicitOf = new Map<string, Id>();
  const innerNameFor = (h: Handle): Id => {
    if ('edge' in h && imageEdges.has(h.edge)) {
      const pe = redexEdgeOf.get(h.edge)!;
      const y = R.names.findIndex((x) => 'edge' in x && x.edge === pe);
      if (y < 0) throw new Error('a site holds a point on a closed redex edge with no inner name');
      return R.inner.names[y][0];
    }
    const k = handleKey(h);
    let z = implicitOf.get(k);
    if (z === undefined) {
      z = nextName++;
      implicitOf.set(k, z);
      implicit.push([z, h]);
    }
    return z;
  };

  const paramNodes: Node[] = [];
  for (const [id, j] of regionOf) {
    const n = ix.node.get(id)!;
    const isRoot = occ.sites[j].includes(id);
    paramNodes.push({
      ...n,
      parent: isRoot ? { region: j } : n.parent,
      member: isRoot && keyed(R.siteKeys[j]) ? ANON : n.member,
      ports: n.ports.map((grp) => ({
        ...grp,
        points: grp.points.map(([k, p]) => [
          k,
          { ...p, target: 'edge' in p.target && internal.has(p.target.edge) ? p.target : { name: innerNameFor(p.target) } },
        ]),
      })),
    });
  }

  // what a rest of points holds is linked outside the redex: through names of its own, as a site's contents are
  for (const [, r] of occ.rests ?? []) for (const p of r.ports) innerNameFor(p.target);

  const extend = (f: Interface): Interface => ({ ...f, names: [...f.names, ...implicit.map(([z]) => [z, NAME_TYPE] as [Id, Id])] });
  const metInner = extend(R.inner);
  const metOuter = extend(R.outer);

  // the redex as it stands in the state: its nodes and edges sent where the occurrence sends them, narrowed
  const redexPoint = new Map<string, Handle>();
  for (const pn of R.nodes)
    for (const grp of pn.ports) for (const [k, p] of grp.points) redexPoint.set(`${pn.id}/${scalarKey(grp.key)}/${scalarKey(k)}`, p.target);
  // in a group of any arity, the state point a redex point met (by key, elsewhere)
  const pointMet = new Map((occ.points ?? []).map(([pn, g, pp, sp]) => [`${pn}/${g}/${sp}`, pp]));
  const metNodes: Node[] = R.nodes.map((pn) => {
    const gn = ix.node.get(nmap.get(pn.id)!)!;
    return {
      ...gn,
      parent: 'node' in pn.parent ? { node: nmap.get(pn.parent.node)! } : pn.parent,
      member: pn.member,
      ports: gn.ports.map((grp) => ({
        ...grp,
        points: grp.points.map(([k, p]) => {
          const gk = scalarKey(grp.key), sk = scalarKey(k);
          const t = redexPoint.get(`${pn.id}/${gk}/${pointMet.get(`${pn.id}/${gk}/${sk}`) ?? sk}`);
          // a point the redex does not write is its rest's: through its name
          if (!t) return [k, { ...p, target: { name: innerNameFor(p.target) } }];
          return [k, { ...p, target: 'edge' in t ? { edge: emap.get(t.edge)! } : t }];
        }),
      })),
    };
  });

  const met: Carrier = {
    inner: metInner,
    outer: metOuter,
    nodes: metNodes,
    edges: [...imageEdges].map((e) => ix.edge.get(e)!),
    sites: R.sites.map((s) => ('node' in s ? { node: nmap.get(s.node)! } : s)),
    names: [...R.names.map((h) => ('edge' in h ? { edge: emap.get(h.edge)! } : h)), ...implicit.map(([z]) => ({ name: z }))],
    siteKeys: [...R.siteKeys],
  };

  const parameter: Carrier = {
    inner: { places: [], names: [], locality: [] },
    outer: { ...metInner },
    nodes: paramNodes,
    edges: [...internal].map((e) => ix.edge.get(e)!),
    sites: [],
    names: [],
    siteKeys: [],
  };

  const outerHandle = (x: Id): Handle => {
    const h = nameHandles.get(x);
    if (!h) throw new Error(`redex outer name ${x} met nothing`);
    return h;
  };
  const context: Carrier = {
    inner: metOuter,
    outer: g.outer,
    nodes: g.nodes.filter((n) => !image.has(n.id) && !regionOf.has(n.id)),
    edges: g.edges.filter((e) => !imageEdges.has(e.id) && !internal.has(e.id)),
    sites: occ.places,
    names: [...R.outer.names.map(([x]) => outerHandle(x)), ...implicit.map(([, h]) => h)],
    siteKeys: occ.places.map(() => ANON),
  };

  return { context, met, parameter, implicit };
}

/** What one reaction did, by identity: what the renderer animates. */
export interface Transition {
  rule: string;
  occurrence: Occurrence;
  /** State nodes the rule kept: the same identity before and after. */
  kept: Id[];
  /** Nodes gone: met and not kept, and what dropped sites held. */
  removed: Id[];
  /** The reactum's fresh nodes. */
  created: Id[];
  /** What sites held, put back by their first use: the same identity, perhaps a new parent. */
  moved: Id[];
  /** Copies made by sites used more than once: [original, copy]. */
  copied: [Id, Id][];
  edgesRemoved: Id[];
  edgesCreated: Id[];
  /** Scalars kept where they stood with only their values rewritten (`World.apply`'s `inPlace`; also in `kept`). */
  revalued?: Id[];
}

export interface Reacted {
  state: Carrier;
  transition: Transition;
}

/** The occurrence replaced: `apply_spec`, as composition. */
export function react(g: Carrier, rule: Rule, occ: Occurrence, sig?: Signature, opts: { ids?: { node: Id; edge: Id } } = {}): Reacted {
  const { context, parameter, implicit } = decompose(g, rule, occ);
  // fresh identities from one past the largest in use, or from where a caller's own counters stand (a world's)
  const ids = opts.ids ?? nextIds(g);
  let nextNode = ids.node;
  let nextEdge = ids.edge;
  const σ = rule.sites;

  // what the sites held, instantiated by the site map
  const moved: Id[] = [];
  const copied: [Id, Id][] = [];
  const dropped: Id[] = [];
  const edgesCreated: Id[] = [];
  const identityMap = σ.length === parameter.outer.places.length && σ.every((i, j) => i === j);
  let inst: Carrier;
  if (identityMap) {
    inst = parameter;
    moved.push(...parameter.nodes.map((n) => n.id));
  } else {
    const pix = Index.of(parameter);
    const regionNodes = (j: number) => pix.children({ region: j }).flatMap((r) => pix.subtree(r.id));
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    σ.forEach((src, j) => {
      const own = regionNodes(src);
      const ownSet = new Set(own);
      const ownEdges = parameter.edges.filter((e) => pix.pointsOn({ edge: e.id }).some((p) => ownSet.has(p.node)));
      if (σ.indexOf(src) === j) {
        for (const id of own) {
          const n = pix.node.get(id)!;
          nodes.push('region' in n.parent ? { ...n, parent: { region: j } } : n);
          moved.push(id);
        }
        edges.push(...ownEdges);
      } else {
        const nm = new Map(own.map((id) => [id, nextNode++]));
        const em = new Map(ownEdges.map((e) => [e.id, nextEdge++]));
        const part: Carrier = { ...parameter, nodes: own.map((id) => pix.node.get(id)!), edges: ownEdges };
        const c = relabel(part, (x) => nm.get(x) ?? x, (x) => em.get(x) ?? x);
        for (const n of c.nodes) nodes.push('region' in n.parent ? { ...n, parent: { region: j } } : n);
        edges.push(...c.edges);
        for (const [a, b] of nm) copied.push([a, b]);
        edgesCreated.push(...em.values());
      }
    });
    parameter.outer.places.forEach((_, i) => {
      if (!σ.includes(i)) dropped.push(...regionNodes(i));
    });
    inst = {
      inner: { places: [], names: [], locality: [] },
      outer: { places: σ.map((i) => parameter.outer.places[i]), names: parameter.outer.names, locality: rule.reactum.inner.locality },
      nodes,
      edges,
      sites: [],
      names: [],
      siteKeys: [],
    };
  }

  // the reactum put in fresh, but for what it keeps
  const nmap = new Map(occ.nodes);
  const emap = new Map(occ.edges);
  const keptTo = new Map(rule.kept.map(([a, b]) => [b, nmap.get(a)!]));
  const keptEdgeTo = new Map(rule.keptEdges.map(([a, b]) => [b, emap.get(a)!]));
  const created: Id[] = [];
  const fn = new Map<Id, Id>();
  for (const n of rule.reactum.nodes) {
    const k = keptTo.get(n.id);
    if (k !== undefined) fn.set(n.id, k);
    else {
      fn.set(n.id, nextNode);
      created.push(nextNode++);
    }
  }
  const fe = new Map<Id, Id>();
  for (const e of rule.reactum.edges) {
    const k = keptEdgeTo.get(e.id);
    if (k !== undefined) fe.set(e.id, k);
    else {
      fe.set(e.id, nextEdge);
      edgesCreated.push(nextEdge++);
    }
  }
  const ix = Index.of(g);
  const redexType = new Map(rule.redex.nodes.map((n) => [n.id, n.type]));
  const keptRetype = new Map<Id, Id>();
  for (const [a, b] of rule.kept) {
    const reactumNode = rule.reactum.nodes.find((n) => n.id === b)!;
    if (redexType.get(a) === reactumNode.type) keptRetype.set(nmap.get(a)!, ix.node.get(nmap.get(a)!)!.type);
  }
  const relabelled = relabel(rule.reactum, (x) => fn.get(x) ?? x, (x) => fe.get(x) ?? x);
  const extend = (f: Interface): Interface => ({ ...f, names: [...f.names, ...implicit.map(([z]) => [z, NAME_TYPE] as [Id, Id])] });
  // values computed from what the sites held
  const env = siteEnv(ix, occ.sites, sig, occ.rests, occ.nodes);
  const computed = new Map((rule.computed ?? []).map((c) => [fn.get(c.node)!, evaluate(c.expr, env, c.kind)]));
  // a group with a rest of points: its own points, then the rest's, through the names the decomposition gave them
  const nameOfHandle = new Map(implicit.map(([z, h]) => [handleKey(h), z]));
  const withRests = (groups: PortGroup[]): PortGroup[] =>
    groups.map(({ rest, ...g }) => {
      if (!rest) return g;
      const held = occ.rests?.find(([n]) => n === rest)?.[1].ports ?? [];
      const points = [...g.points.map(([, p]) => p), ...held.map((p) => ({ contract: p.contract, target: { name: nameOfHandle.get(handleKey(p.target))! } }))];
      return { ...g, points: points.map((p, i) => [{ int: i }, p] as [{ int: number }, typeof p]) };
    });
  const freshReactum: Carrier = {
    ...relabelled,
    inner: extend(relabelled.inner),
    outer: extend(relabelled.outer),
    nodes: relabelled.nodes.map((n) => ({
      ...n,
      ports: withRests(n.ports),
      type: keptRetype.get(n.id) ?? n.type,
      ...(computed.has(n.id) ? { payload: { scalar: computed.get(n.id)! } } : {}),
    })),
    names: [...relabelled.names, ...implicit.map(([z]) => ({ name: z }))],
  };

  // the pieces are this function's own, built formed: composed without checking them again (the tests compose
  // every decomposition back, checked)
  const composed = compose(compose(inst, freshReactum, { trusted: true }), context, { trusted: true });

  const keptIds = new Set(keptTo.values());
  const removed = [...occ.nodes.map(([, s]) => s).filter((s) => !keptIds.has(s)), ...dropped];
  // states up to idle edges (F8): an edge whose last points went with what was removed goes too
  const before = Index.of(g);
  const touched = new Set<Id>();
  for (const id of removed)
    for (const pg of before.node.get(id)?.ports ?? []) for (const [, pt] of pg.points) if ('edge' in pt.target) touched.add(pt.target.edge);
  const after = Index.of(composed);
  const idle = [...touched].filter((e) => after.pointsOn({ edge: e }).length === 0 && composed.edges.some((x) => x.id === e && x.value === null));
  const idleSet = new Set(idle);
  const state = idle.length ? { ...composed, edges: composed.edges.filter((e) => !idleSet.has(e.id)) } : composed;
  const keptEdgeIds = new Set(keptEdgeTo.values());
  const droppedSet = new Set(dropped);
  const edgesRemoved = [
    ...occ.edges.map(([, s]) => s).filter((s) => !keptEdgeIds.has(s)),
    ...parameter.edges.filter((e) => Index.of(parameter).pointsOn({ edge: e.id }).every((p) => droppedSet.has(p.node))).map((e) => e.id),
    ...idle,
  ];
  return {
    state,
    transition: { rule: rule.name, occurrence: occ, kept: [...keptIds], removed, created, moved, copied, edgesRemoved, edgesCreated },
  };
}
