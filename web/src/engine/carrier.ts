/**
 * The carrier: one structure for every graph — a state, a redex, a reactum.
 *
 * A transcription of chrysalis `Spec/Carrier.lean`: Milner's bigraph with interfaces, typed.
 * - the place graph is a forest: every node has one parent, a node or a region (a root of the outer face);
 *   a site is a hole of the inner face, with a parent of its own;
 * - the link graph is apart: an edge has no parent; a port, owned by a node, is a point on an edge, an outer
 *   name, or a binder;
 * - a node's type is the identity of a type node. Here type nodes live in the `Signature` beside the carrier
 *   (they are what the spec calls a carrier's `refs`), so type ids and node ids are separate namespaces.
 *
 * Everything is plain JSON so a carrier can be stored, sent and diffed as it is.
 */

export type Id = number;

export type Scalar = { int: number } | { text: string } | { bool: boolean } | { float: number };

export type Parent = { node: Id } | { region: number };

export type Handle = { edge: Id } | { name: Id } | { binder: Id };

/** How a node stands in its parent: an attribute (what the parent is) or held (what it holds); keyed or not. */
export type Member = { attr: Scalar | null } | { held: Scalar | null };

export type Payload = 'composite' | 'binder' | { scalar: Scalar };

export interface Port {
  contract: Id;
  target: Handle;
}

export interface PortGroup {
  key: Scalar;
  contract: Id;
  points: [Scalar, Port][];
  /**
   * In a pattern only (kaleidoscope's, PROVISIONAL; spec finding F28): the rest of the group's points, by name.
   * A redex group with a rest meets a group holding its points and any more; the rest is what more there is. A
   * reactum group with that rest puts those points back.
   */
  rest?: string;
  /**
   * In a reactum only (kaleidoscope's, PROVISIONAL; finding F84): further rests the group puts back, after `rest`'s
   * points: the union of several groups' points in one, as a victor taking over the loser's links. A redex group has
   * one rest at most, since with two, which points each held would be ambiguous.
   */
  more?: string[];
}

export interface Node {
  id: Id;
  type: Id;
  parent: Parent;
  member: Member;
  payload: Payload;
  ports: PortGroup[];
}

export interface Edge {
  id: Id;
  contract: Id;
  value: Id | null;
}

/** A face: its places (each typed), its names (each typed), and which names are local to which place. */
export interface Interface {
  places: Id[];
  names: [Id, Id][];
  locality: [number, Id][];
}

export interface Carrier {
  inner: Interface;
  outer: Interface;
  nodes: Node[];
  edges: Edge[];
  /** Each inner place's parent. */
  sites: Parent[];
  /** Each inner name's handle. */
  names: Handle[];
  /** Each site's member key: keyed, it holds exactly what stands at that key; anonymous, whatever is besides. */
  siteKeys: Member[];
}

// ── keys: canonical strings, so identities and scalars can index maps ──────────────────────────────────────

// keys are asked for constantly while matching, and built on the spot: a cache keyed by the scalar or member object
// (a WeakMap, once) cost more than building the string, and grew slower with every carrier cloned, its dead keys held
// until a full collection (F81). A text's key alone is kept, by its value: a program's texts are few
const textKeys = new Map<string, string>();
const textKey = (t: string): string => {
  let k = textKeys.get(t);
  if (k === undefined) textKeys.set(t, (k = `t${JSON.stringify(t)}`));
  return k;
};
export const scalarKey = (s: Scalar): string =>
  'int' in s ? `i${s.int}` : 'text' in s ? textKey(s.text) : 'bool' in s ? `b${s.bool}` : `f${s.float}`;

export const parentKey = (p: Parent): string => ('node' in p ? `n${p.node}` : `r${p.region}`);

export const handleKey = (h: Handle): string => ('edge' in h ? `e${h.edge}` : 'name' in h ? `x${h.name}` : `b${h.binder}`);

export const memberKey = (m: Member): string => {
  const k = 'attr' in m ? m.attr : m.held;
  return `${'attr' in m ? 'a' : 'h'}${k === null ? '_' : scalarKey(k)}`;
};

export const isAttr = (m: Member): boolean => 'attr' in m;
export const memberScalar = (m: Member): Scalar | null => ('attr' in m ? m.attr : m.held);
export const keyed = (m: Member): boolean => memberScalar(m) !== null;
export const ANON: Member = { held: null };

export const sameScalar = (a: Scalar, b: Scalar) => scalarKey(a) === scalarKey(b);
export const sameMember = (a: Member, b: Member) => memberKey(a) === memberKey(b);
export const sameParent = (a: Parent, b: Parent) => parentKey(a) === parentKey(b);
export const sameHandle = (a: Handle, b: Handle) => handleKey(a) === handleKey(b);
export const samePayload = (a: Payload, b: Payload) =>
  typeof a === 'string' || typeof b === 'string' ? a === b : sameScalar(a.scalar, b.scalar);

export const emptyFace = (): Interface => ({ places: [], names: [], locality: [] });

export const sameFace = (a: Interface, b: Interface): boolean =>
  a.places.length === b.places.length &&
  a.places.every((t, i) => t === b.places[i]) &&
  a.names.length === b.names.length &&
  a.names.every(([x, t], i) => x === b.names[i][0] && t === b.names[i][1]) &&
  a.locality.length === b.locality.length &&
  a.locality.every(([k, x]) => b.locality.some(([k2, x2]) => k === k2 && x === x2));

export const clone = <T>(x: T): T => structuredClone(x);

// ── an index over a carrier: what the spec's list searches become ──────────────────────────────────────────

export interface PointRef {
  node: Id;
  group: Scalar;
  point: Scalar;
}

const indexes = new WeakMap<Carrier, Index>();

/**
 * Put `x` into `list` in its place by node id, ascending (a world's lists, F82): at the end when its id is the newest, as
 * a made node's is; else where it belongs, as a node made again under its own id (a replacement) does.
 */
export function insertById<T>(list: T[], x: T, idOf: (y: T) => Id) {
  const id = idOf(x);
  if (!list.length || idOf(list[list.length - 1]) <= id) {
    list.push(x);
    return;
  }
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (idOf(list[mid]) <= id) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, x);
}

export class Index {
  /** The index of a carrier, built once: a carrier is never changed once made, so its index can be shared. */
  static of(g: Carrier): Index {
    let ix = indexes.get(g);
    if (!ix) indexes.set(g, (ix = new Index(g)));
    return ix;
  }

  readonly node = new Map<Id, Node>();
  readonly edge = new Map<Id, Edge>();
  readonly kids = new Map<string, Node[]>();
  /** The points on each handle. */
  readonly points = new Map<string, PointRef[]>();
  /** Each node's place in `g.nodes`. */
  readonly pos = new Map<Id, number>();
  /**
   * The nodes of each type (exactly), in `g.nodes` order: where a pattern's first root finds its candidates. (A world's
   * index keeps each of its lists by node id instead, `orderById`: F82.)
   */
  readonly byType = new Map<Id, Node[]>();

  constructor(readonly g: Carrier) {
    g.nodes.forEach((n, i) => this.pos.set(n.id, i));
    for (const n of g.nodes) {
      this.node.set(n.id, n);
      (this.byType.get(n.type) ?? this.byType.set(n.type, []).get(n.type)!).push(n);
      const pk = parentKey(n.parent);
      (this.kids.get(pk) ?? this.kids.set(pk, []).get(pk)!).push(n);
      for (const grp of n.ports)
        for (const [pt, port] of grp.points) {
          const hk = handleKey(port.target);
          (this.points.get(hk) ?? this.points.set(hk, []).get(hk)!).push({ node: n.id, group: grp.key, point: pt });
        }
    }
    for (const e of g.edges) this.edge.set(e.id, e);
  }

  /**
   * Each list (a type's nodes, a place's children, a handle's points) put in node-id order, for a world that changes
   * its state in place (F82). A world's lists would otherwise follow its history (each made node appended, each removal
   * swapping the last node into its place in `g.nodes`), so a world resumed from a checkpoint, its lists built from
   * `g.nodes`, would list them otherwise than the world that made the checkpoint, and meet its occurrences in another
   * order. By id, they are the state's alone. (A stable sort keeps a node's own points in order; most lists already are.)
   */
  orderById() {
    const byId = <T>(l: T[], id: (x: T) => Id) => {
      for (let i = 1; i < l.length; i++) if (id(l[i - 1]) > id(l[i])) return void l.sort((a, b) => id(a) - id(b));
    };
    for (const l of this.byType.values()) byId(l, (n) => n.id);
    for (const l of this.kids.values()) byId(l, (n) => n.id);
    for (const l of this.points.values()) byId(l, (p) => p.node);
  }

  /** The nodes of these types, in `g.nodes` order: a pattern's first root's candidates, by its type's `downs`. */
  ofType(types: Id[]): readonly Node[] {
    if (types.length === 1) return this.byType.get(types[0]) ?? [];
    const out: Node[] = [];
    for (const t of types) for (const n of this.byType.get(t) ?? []) out.push(n);
    return out.sort((a, b) => this.pos.get(a.id)! - this.pos.get(b.id)!);
  }

  children(p: Parent): Node[] {
    return this.kids.get(parentKey(p)) ?? [];
  }

  private keyedKids = new Map<string, Map<string, Node>>();
  /** The child standing at a key (a member key), if one does; each place's keyed children mapped once. */
  childAt(p: Parent, member: string): Node | undefined {
    const pk = parentKey(p);
    let m = this.keyedKids.get(pk);
    if (!m) {
      m = new Map();
      for (const c of this.children(p)) if (keyed(c.member)) m.set(memberKey(c.member), c);
      this.keyedKids.set(pk, m);
    }
    return m.get(member);
  }

  pointsOn(h: Handle): PointRef[] {
    return this.points.get(handleKey(h)) ?? [];
  }

  /** Each place's count of nodes joining or leaving it, so what is cached of its children knows it is stale. */
  private kidsVersion = new Map<string, number>();
  private classKids = new WeakMap<object, Map<string, { version: number; nodes: Node[] }>>();
  /**
   * A place's children of one class (`cls`, its name under `owner`, a signature), those `keep` takes: listed once, and
   * again only once a node has joined or left the place. An amount reads its class's few entries this way, not every
   * child of its place (F78).
   */
  childrenOf(p: Parent, owner: object, cls: string, keep: (n: Node) => boolean): readonly Node[] {
    const pk = parentKey(p), version = this.kidsVersion.get(pk) ?? 0, key = `${pk}|${cls}`;
    let m = this.classKids.get(owner);
    if (!m) this.classKids.set(owner, (m = new Map()));
    const hit = m.get(key);
    if (hit && hit.version === version) return hit.nodes;
    const nodes = this.children(p).filter(keep);
    m.set(key, { version, nodes });
    return nodes;
  }

  /** A node joined or left its place (a world's in-place reaction): the place's map of keyed children follows. */
  rekey(n: Node, present: boolean) {
    const pk = parentKey(n.parent);
    this.kidsVersion.set(pk, (this.kidsVersion.get(pk) ?? 0) + 1);
    if (!keyed(n.member)) return;
    const m = this.keyedKids.get(parentKey(n.parent));
    if (!m) return;
    if (present) m.set(memberKey(n.member), n);
    else if (m.get(memberKey(n.member))?.id === n.id) m.delete(memberKey(n.member));
  }

  /** Whether `id` stands within `ancestor` (itself included). */
  within(ancestor: Id, id: Id): boolean {
    let cur: Id | undefined = id;
    for (let fuel = this.g.nodes.length + 1; cur !== undefined && fuel > 0; fuel--) {
      if (cur === ancestor) return true;
      const p: Parent | undefined = this.node.get(cur)?.parent;
      cur = p && 'node' in p ? p.node : undefined;
    }
    return false;
  }

  /** Every node within `root`, itself first. */
  subtree(root: Id): Id[] {
    const out = [root];
    for (let i = 0; i < out.length; i++) for (const c of this.children({ node: out[i] })) out.push(c.id);
    return out;
  }

  regionOf(id: Id): number | null {
    let n = this.node.get(id);
    for (let fuel = this.g.nodes.length + 1; n && fuel > 0; fuel--) {
      if ('region' in n.parent) return n.parent.region;
      n = this.node.get(n.parent.node);
    }
    return null;
  }
}

// ── well-formedness: `Carrier.formed`, clause by clause, each failure named ────────────────────────────────

export function formedProblems(g: Carrier): string[] {
  const out: string[] = [];
  const ix = new Index(g);
  if (ix.node.size !== g.nodes.length) out.push('node identities repeat');
  if (ix.edge.size !== g.edges.length) out.push('edge identities repeat');

  const keyedPlaces = new Set<string>();
  const place = (p: Parent, m: Member, what: string) => {
    if (!keyed(m)) return;
    const k = `${parentKey(p)}/${memberKey(m)}`;
    if (keyedPlaces.has(k)) out.push(`two members stand as one at ${k} (${what})`);
    keyedPlaces.add(k);
  };

  const parentFormed = (p: Parent) => ('node' in p ? ix.node.has(p.node) : p.region < g.outer.places.length);
  const outerNames = new Set(g.outer.names.map(([x]) => x));
  const handleFormed = (h: Handle) =>
    'edge' in h ? ix.edge.has(h.edge) : 'name' in h ? outerNames.has(h.name) : ix.node.get(h.binder)?.payload === 'binder';
  const inScope = (b: Id, id: Id) => {
    const bn = ix.node.get(b);
    if (!bn) return false;
    return 'node' in bn.parent ? id !== bn.parent.node && ix.within(bn.parent.node, id) : ix.regionOf(id) === bn.parent.region;
  };

  for (const n of g.nodes) {
    place(n.parent, n.member, `node ${n.id}`);
    if (!parentFormed(n.parent)) out.push(`node ${n.id}: its parent ${parentKey(n.parent)} is not one`);
    else if (ix.regionOf(n.id) === null) out.push(`node ${n.id}: not rooted`);
    if (isAttr(n.member) && 'region' in n.parent) out.push(`node ${n.id}: an attribute at a root`);
    if (n.payload !== 'composite' && (n.ports.length > 0 || ix.children({ node: n.id }).length > 0))
      out.push(`node ${n.id}: an atom holding something or owning ports`);
    if (n.payload === 'binder' && isAttr(n.member)) out.push(`node ${n.id}: a binder as an attribute`);
    for (const grp of n.ports)
      for (const [, p] of grp.points) {
        if (!handleFormed(p.target)) out.push(`node ${n.id}: port on ${handleKey(p.target)}, not a handle`);
        else if ('binder' in p.target && !inScope(p.target.binder, n.id))
          out.push(`node ${n.id}: point on binder ${p.target.binder} outside its scope`);
      }
  }
  for (const e of g.edges) if (e.value !== null && !ix.node.has(e.value)) out.push(`edge ${e.id}: value not a node`);
  if (g.sites.length !== g.inner.places.length) out.push('sites and inner places differ in number');
  for (const s of g.sites) {
    if (!parentFormed(s)) out.push(`site at ${parentKey(s)}: not a parent`);
    else if ('node' in s && ix.node.get(s.node)!.payload !== 'composite') out.push(`site at ${parentKey(s)}: in an atom`);
  }
  if (g.names.length !== g.inner.names.length) out.push('inner names and their handles differ in number');
  for (const h of g.names) if (!handleFormed(h)) out.push(`inner name joined to ${handleKey(h)}, not a handle`);
  for (const [face, f] of [['inner', g.inner], ['outer', g.outer]] as const) {
    if (new Set(f.names.map(([x]) => x)).size !== f.names.length) out.push(`${face} names repeat`);
    for (const [k, x] of f.locality)
      if (k >= f.places.length || !f.names.some(([y]) => y === x)) out.push(`${face} locality names no place or name`);
  }
  if (g.siteKeys.length !== g.sites.length) out.push('site keys and sites differ in number');
  g.sites.forEach((s, i) => {
    const k = g.siteKeys[i];
    if (!k) return;
    if (isAttr(k) && memberScalar(k) === null) out.push(`site ${i}: an attribute site unkeyed`);
    if (isAttr(k) && 'region' in s) out.push(`site ${i}: an attribute site at a root`);
    place(s, k, `site ${i}`);
  });
  return out;
}

export const formed = (g: Carrier) => formedProblems(g).length === 0;

// ── relabelling ────────────────────────────────────────────────────────────────────────────────────────────

export type Relabel = (id: Id) => Id;
const same: Relabel = (x) => x;

export function relabelParent(p: Parent, fn: Relabel): Parent {
  return 'node' in p ? { node: fn(p.node) } : p;
}

export function relabelHandle(h: Handle, fn: Relabel, fe: Relabel, fx: Relabel = same): Handle {
  return 'edge' in h ? { edge: fe(h.edge) } : 'name' in h ? { name: fx(h.name) } : { binder: fn(h.binder) };
}

/** Relabel node, edge and name identities. Types and contracts are the signature's, never relabelled. */
export function relabel(g: Carrier, fn: Relabel, fe: Relabel, fx: Relabel = same): Carrier {
  const face = (i: Interface): Interface => ({
    places: [...i.places],
    names: i.names.map(([x, t]) => [fx(x), t]),
    locality: i.locality.map(([k, x]) => [k, fx(x)]),
  });
  return {
    inner: face(g.inner),
    outer: face(g.outer),
    nodes: g.nodes.map((n) => ({
      ...n,
      id: fn(n.id),
      parent: relabelParent(n.parent, fn),
      ports: n.ports.map((grp) => ({
        ...grp,
        points: grp.points.map(([k, p]) => [k, { ...p, target: relabelHandle(p.target, fn, fe, fx) }]),
      })),
    })),
    edges: g.edges.map((e) => ({ ...e, id: fe(e.id), value: e.value === null ? null : fn(e.value) })),
    sites: g.sites.map((s) => relabelParent(s, fn)),
    names: g.names.map((h) => relabelHandle(h, fn, fe, fx)),
    siteKeys: [...g.siteKeys],
  };
}

/** Two carriers the same but for the order their lists are in (`Carrier.Same`). */
export function sameCarrier(a: Carrier, b: Carrier): boolean {
  const nodeKey = (n: Node) =>
    JSON.stringify([
      n.id,
      n.type,
      parentKey(n.parent),
      memberKey(n.member),
      typeof n.payload === 'string' ? n.payload : scalarKey(n.payload.scalar),
      n.ports
        .map((g) =>
          JSON.stringify([scalarKey(g.key), g.contract, g.points.map(([k, p]) => `${scalarKey(k)}:${p.contract}:${handleKey(p.target)}`).sort()]),
        )
        .sort(),
    ]);
  const bag = (xs: string[]) => [...xs].sort().join('\n');
  return (
    sameFace(a.inner, b.inner) &&
    sameFace(a.outer, b.outer) &&
    a.sites.length === b.sites.length &&
    a.sites.every((s, i) => sameParent(s, b.sites[i])) &&
    a.names.length === b.names.length &&
    a.names.every((h, i) => sameHandle(h, b.names[i])) &&
    a.siteKeys.length === b.siteKeys.length &&
    a.siteKeys.every((k, i) => sameMember(k, b.siteKeys[i])) &&
    bag(a.nodes.map(nodeKey)) === bag(b.nodes.map(nodeKey)) &&
    bag(a.edges.map((e) => JSON.stringify(e))) === bag(b.edges.map((e) => JSON.stringify(e)))
  );
}

/** One past the largest identity in use, for minting fresh ones. */
export function nextIds(g: Carrier): { node: Id; edge: Id; name: Id } {
  const max = (xs: number[]) => xs.reduce((m, x) => Math.max(m, x), -1) + 1;
  return {
    node: max(g.nodes.map((n) => n.id)),
    edge: max(g.edges.map((e) => e.id)),
    name: max([...g.inner.names, ...g.outer.names].map(([x]) => x)),
  };
}
