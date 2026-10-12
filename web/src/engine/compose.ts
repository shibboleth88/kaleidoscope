/**
 * Composition and tensor: chrysalis `Impl/Compose.lean`, line for line.
 *
 * Composing puts the inside's nodes where the outside's sites are and joins the inside's outer names to what the
 * outside's inner names are joined to. Nothing is renamed: colliding identities are refused.
 */

import {
  ANON,
  type Carrier,
  type Handle,
  type Interface,
  type Member,
  type Node,
  type Parent,
  formedProblems,
  keyed,
  sameFace,
} from './carrier';

export class Refusal extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

const placeIn = (outside: Carrier, p: Parent): Parent => ('region' in p ? (outside.sites[p.region] ?? p) : p);

function linkIn(outside: Carrier, h: Handle): Handle {
  if (!('name' in h)) return h;
  const i = outside.inner.names.findIndex(([x]) => x === h.name);
  return i >= 0 ? outside.names[i] : h;
}

const siteKey = (g: Carrier, i: number): Member => g.siteKeys[i] ?? ANON;

/** The key what stands at an inside root takes once the inside fills the outside: a keyed site's key, else its own. */
function keyIn(outside: Carrier, p: Parent, m: Member): Member {
  if ('region' in p && keyed(siteKey(outside, p.region))) return siteKey(outside, p.region);
  return m;
}

const moveNode = (outside: Carrier, n: Node): Node => ({
  ...n,
  parent: placeIn(outside, n.parent),
  member: keyIn(outside, n.parent, n.member),
  ports: n.ports.map((grp) => ({
    ...grp,
    points: grp.points.map(([k, p]) => [k, { ...p, target: linkIn(outside, p.target) }]),
  })),
});

export const candidate = (inside: Carrier, outside: Carrier): Carrier => ({
  inner: inside.inner,
  outer: outside.outer,
  nodes: [...inside.nodes.map((n) => moveNode(outside, n)), ...outside.nodes],
  edges: [...inside.edges, ...outside.edges],
  sites: inside.sites.map((s) => placeIn(outside, s)),
  names: inside.names.map((h) => linkIn(outside, h)),
  siteKeys: inside.sites.map((p, i) => keyIn(outside, p, siteKey(inside, i))),
});

const disjoint = (a: number[], b: number[]) => {
  const s = new Set(b);
  return a.every((x) => !s.has(x));
};

/** `compose inside outside`, checked: each refusal says which check failed. */
export function compose(inside: Carrier, outside: Carrier): Carrier {
  const pi = formedProblems(inside);
  if (pi.length) throw new Refusal('E-compose', `the inside is not formed: ${pi[0]}`);
  const po = formedProblems(outside);
  if (po.length) throw new Refusal('E-compose', `the outside is not formed: ${po[0]}`);
  if (!sameFace(inside.outer, outside.inner)) throw new Refusal('E-compose', 'the faces differ');
  if (!disjoint(inside.nodes.map((n) => n.id), outside.nodes.map((n) => n.id)))
    throw new Refusal('E-compose', 'node identities collide');
  if (!disjoint(inside.edges.map((e) => e.id), outside.edges.map((e) => e.id)))
    throw new Refusal('E-compose', 'edge identities collide');
  const c = candidate(inside, outside);
  const pc = formedProblems(c);
  if (pc.length) throw new Refusal('E-compose', `two members stand as one: ${pc[0]}`);
  return c;
}

/** The identity on a face: no nodes, no edges, each site its root and each inner name its outer name. */
export const identity = (f: Interface): Carrier => ({
  inner: f,
  outer: f,
  nodes: [],
  edges: [],
  sites: f.places.map((_, i) => ({ region: i })),
  names: f.names.map(([x]) => ({ name: x })),
  siteKeys: f.places.map(() => ANON),
});

const shift = (k: number, p: Parent): Parent => ('region' in p ? { region: p.region + k } : p);

const tensorFace = (a: Interface, b: Interface): Interface => ({
  places: [...a.places, ...b.places],
  names: [...a.names, ...b.names],
  locality: [...a.locality, ...b.locality.map(([k, x]) => [k + a.places.length, x] as [number, number])],
});

/** Side by side, checked: no identity collides and no name is shared. */
export function tensor(a: Carrier, b: Carrier): Carrier {
  const k = a.outer.places.length;
  if (!disjoint(a.nodes.map((n) => n.id), b.nodes.map((n) => n.id))) throw new Refusal('E-compose', 'node identities collide');
  if (!disjoint(a.edges.map((e) => e.id), b.edges.map((e) => e.id))) throw new Refusal('E-compose', 'edge identities collide');
  if (!disjoint(a.outer.names.map(([x]) => x), b.outer.names.map(([x]) => x))) throw new Refusal('E-compose', 'outer names are shared');
  if (!disjoint(a.inner.names.map(([x]) => x), b.inner.names.map(([x]) => x))) throw new Refusal('E-compose', 'inner names are shared');
  return {
    inner: tensorFace(a.inner, b.inner),
    outer: tensorFace(a.outer, b.outer),
    nodes: [...a.nodes, ...b.nodes.map((n) => ({ ...n, parent: shift(k, n.parent) }))],
    edges: [...a.edges, ...b.edges],
    sites: [...a.sites, ...b.sites.map((s) => shift(k, s))],
    names: [...a.names, ...b.names],
    siteKeys: [...a.siteKeys, ...b.siteKeys],
  };
}
