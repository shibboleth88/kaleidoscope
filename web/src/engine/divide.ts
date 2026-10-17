/**
 * Division (PROVISIONAL; Boundary's docs/32 R4 amendment, spec finding F61): a rule with `split` names a redex site
 * that its reactum writes twice. Written twice, a site is copied (Milner's instantiation); split, its contents are
 * partitioned between the two places instead, in the same commit:
 * - a node holding counts (an int attribute whose type, or a supertype, declares `divide`) stands in both places, each
 *   count partitioned by its type's policy: `binomial` (each molecule independently, p = 1/2) or `half` (⌊n/2⌋ and
 *   ⌈n/2⌉, the odd one at random);
 * - a node whose type declares `divide = "copy"` (a constant of the composite, holding no material) stands in both;
 * - any other node goes whole to one place or the other, uniformly at random, with all it holds.
 * Every count's two parts sum to it and every other node lands in exactly one place, so conservation holds as it did.
 *
 * `divide` takes the state just after the reaction ran as a copy (`World.apply`): the roots the site held, and the
 * transition's `copied` pairs (each node of the site and its copy). It returns the state with the copy made a partition.
 */
import type { Carrier, Id, Node } from './carrier';
import type { Signature } from './signature';

/** How a count of this type divides, where its type or a supertype declares it. */
export function divisionOf(sig: Signature, type: Id): 'binomial' | 'half' | null {
  for (const t of sig.ups(type)) {
    const d = sig.types.find((x) => x.id === t)?.style?.divide;
    if (d === 'binomial' || d === 'half') return d;
  }
  return null;
}

/** A binomial(n, 1/2) draw: exact below 64 trials; above, the normal approximation, rounded and held within [0, n]. */
function binomialHalf(n: number, random: () => number): number {
  if (n < 64) {
    let k = 0;
    for (let i = 0; i < n; i++) if (random() < 0.5) k++;
    return k;
  }
  // Box-Muller
  const u = Math.max(random(), Number.MIN_VALUE), v = random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(n, Math.max(0, Math.round(n / 2 + z * Math.sqrt(n) / 2)));
}

export function divide(g: Carrier, sig: Signature, roots: Id[], copied: [Id, Id][], random: () => number): Carrier {
  const copyOf = new Map(copied);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const children = new Map<Id, Node[]>();
  for (const n of g.nodes) if ('node' in n.parent) (children.get(n.parent.node) ?? children.set(n.parent.node, []).get(n.parent.node)!).push(n);
  const subtree = (id: Id): Id[] => [id, ...(children.get(id) ?? []).flatMap((c) => subtree(c.id))];
  const counts = (id: Id) =>
    (children.get(id) ?? []).filter((c) => 'attr' in c.member && typeof c.payload === 'object' && 'scalar' in c.payload && 'int' in c.payload.scalar && divisionOf(sig, c.type) !== null);

  const gone = new Set<Id>();
  const values = new Map<Id, number>();
  for (const root of roots) {
    const copy = copyOf.get(root);
    if (copy === undefined || !byId.has(root)) throw new Error(`divide: site root ${root} has no copy`);
    // a constant of the composite (its type declares `divide = "copy"`) stands in both places, as the copy left it
    if (sig.types.find((t) => t.id === byId.get(root)!.type)?.style?.divide === 'copy') continue;
    const held = counts(root);
    if (held.length) {
      // a count holder stands in both places: each count partitioned between the original and its copy
      for (const c of held) {
        const n = (c.payload as { scalar: { int: number } }).scalar.int;
        const k = divisionOf(sig, c.type) === 'half' ? Math.floor(n / 2) + (n % 2 && random() < 0.5 ? 1 : 0) : binomialHalf(n, random);
        values.set(c.id, k);
        values.set(copyOf.get(c.id)!, n - k);
      }
    } else for (const id of subtree(random() < 0.5 ? root : copy)) gone.add(id);
  }

  const nodes = g.nodes
    .filter((n) => !gone.has(n.id))
    .map((n) => (values.has(n.id) ? { ...n, payload: { scalar: { int: values.get(n.id)! } } } : n));
  // an edge no node is left on (and no name holds) goes with them
  const used = new Set<Id>();
  for (const n of nodes) for (const grp of n.ports) for (const [, p] of grp.points) if ('edge' in p.target) used.add(p.target.edge);
  for (const h of g.names) if ('edge' in h) used.add(h.edge);
  const left = new Set(nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => used.has(e.id) || (e.value !== null && left.has(e.value)));
  return { ...g, nodes, edges };
}
