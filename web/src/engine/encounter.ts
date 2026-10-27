/**
 * Encounter rules (spec finding F57; F53's question): a rule whose redex is two or more motifs that share nothing,
 * meeting wherever each can in one place. Its occurrences are the product of its components' matches, and so is its
 * propensity: k × ∏ (each component's factor summed over its matches). It is held as its components, each discovered
 * and kept like a rule of its own; an occurrence is composed only when one is chosen. Kappa's simulators count a
 * disconnected left-hand side the same way (Danos et al. 2007; KaSim).
 *
 * Exact under conditions checked here, each a reason to leave a rule enumerated:
 * - one region; every node, edge and site belongs to one root's component; no outer or inner names, no rests;
 * - no guard and no negative (they could read across components);
 * - the rate a product (`*` and `/`) of factors that each read one component's sites;
 * - the reactum's computed values cannot fail (`+`, `-`, `*` of sites and literals), so every tuple is an occurrence;
 * - no state node can be met by the roots of two components (no type below two of their root types). A spot is the
 *   set of nodes an occurrence meets, so tuples and spots then correspond one to one: a symmetric product (`A | A`)
 *   would count each spot twice, and is left enumerated.
 *
 * A factor that is not positive at a match leaves that match out (no tuple through it fires), as an enumerated spot
 * with a rate that is not positive does not fire. (Two negative factors would make a positive product there; a rate
 * law like that is not a propensity.)
 */
import type { Carrier, Id, Node } from './carrier';
import { type Expr, readsLinks } from './expr';
import type { Occurrence } from './match';
import type { Rule } from './rule';
import type { Signature } from './signature';

export interface Encounter {
  rule: Rule;
  /** Each component as a rule of its own: its nodes (the same ids), its sites renumbered, its factor its rate. */
  parts: Rule[];
  /** For each part, its sites' indices in the rule's. */
  siteMaps: number[][];
  /** The rate's constant factor (`k`): the factors that read no site. */
  k: number;
}

const SAFE = new Set(['+', '-', '*']);
const safe = (e: Expr): boolean => 'lit' in e || 'site' in e || ('op' in e && SAFE.has(e.op) && e.args.every(safe));

/** The rate's factors: each with whether it divides. Null where the rate is not a product at its top. */
function factors(e: Expr, inverted = false, out: { e: Expr; div: boolean }[] = []): { e: Expr; div: boolean }[] {
  if ('op' in e && e.op === '*' && e.args.length === 2) {
    factors(e.args[0], inverted, out);
    factors(e.args[1], inverted, out);
  } else if ('op' in e && e.op === '/' && e.args.length === 2) {
    factors(e.args[0], inverted, out);
    factors(e.args[1], !inverted, out);
  } else out.push({ e, div: inverted });
  return out;
}

function sitesOf(e: Expr): number[] {
  if ('site' in e) return [e.site];
  if ('op' in e) return e.args.flatMap(sitesOf);
  return [];
}

const renumber = (e: Expr, m: Map<number, number>): Expr =>
  'site' in e ? { site: m.get(e.site)! } : 'op' in e ? { op: e.op, args: e.args.map((a) => renumber(a, m)) } : e;

const literal = (e: Expr): number | null => {
  if ('lit' in e) return 'int' in e.lit ? e.lit.int : 'float' in e.lit ? e.lit.float : null;
  if ('op' in e && e.args.length === 2) {
    const a = literal(e.args[0]), b = literal(e.args[1]);
    if (a === null || b === null) return null;
    return e.op === '*' ? a * b : e.op === '/' ? a / b : e.op === '+' ? a + b : e.op === '-' ? a - b : null;
  }
  return null;
};

/** A rule as an encounter of components, or the reason it is not one. */
export function encounter(rule: Rule, sig: Signature): Encounter | string {
  const R = rule.redex;
  if (R.outer.places.length !== 1) return 'more than one region';
  if (R.outer.names.length || R.inner.names.length || R.names.length) return 'names';
  if (rule.guard) return 'a guard';
  if (rule.negatives.length) return 'a negative';
  if (rule.linkPatterns?.length || rule.linkWrites?.length || readsLinks(rule.rateExpr) || readsLinks(rule.accept)) return 'link values (F97)';
  if ((rule.computed ?? []).some((c) => !safe(c.expr))) return 'a computed value that can fail';
  const byId = new Map(R.nodes.map((n) => [n.id, n]));
  const rootOf = (n: Node): Id => ('node' in n.parent ? rootOf(byId.get(n.parent.node)!) : n.id);
  const roots = R.nodes.filter((n) => 'region' in n.parent);
  if (roots.length < 2) return 'one component';
  const comp = new Map(roots.map((r, i) => [r.id, i]));
  const compOf = (n: Node) => comp.get(rootOf(n))!;
  for (const n of R.nodes) for (const g of n.ports) {
    if (g.rest) return 'a rest of points';
    for (const [, p] of g.points) if (!('edge' in p.target)) return 'a port on a name or binder';
  }
  // an edge's points all in one component
  const edgeComp = new Map<Id, number>();
  for (const n of R.nodes)
    for (const g of n.ports)
      for (const [, p] of g.points) {
        const e = (p.target as { edge: Id }).edge, c = compOf(n);
        if (edgeComp.has(e) && edgeComp.get(e) !== c) return 'an edge between components';
        edgeComp.set(e, c);
      }
  const siteComp = R.sites.map((s) => ('node' in s ? compOf(byId.get(s.node)!) : -1));
  if (siteComp.includes(-1)) return 'a site at the root';
  // no state node met by two components' roots: no type below both
  for (let a = 0; a < roots.length; a++)
    for (let b = a + 1; b < roots.length; b++)
      if (sig.types.some((t) => sig.sub(t.id, roots[a].type) && sig.sub(t.id, roots[b].type))) return 'components that could meet one node';
  // the rate: a product of factors each reading one component
  let k = rule.rateExpr ? 1 : (rule.rate ?? 1);
  const own: { e: Expr; div: boolean }[][] = roots.map(() => []);
  if (rule.rateExpr)
    for (const f of factors(rule.rateExpr)) {
      const cs = new Set(sitesOf(f.e).map((s) => siteComp[s]));
      if (cs.size > 1) return 'a factor reading two components';
      if (cs.size === 0) {
        const v = literal(f.e);
        if (v === null) return 'a factor reading nothing that is not a number';
        k = f.div ? k / v : k * v;
      } else own[[...cs][0]].push(f);
    }
  const parts: Rule[] = [];
  const siteMaps: number[][] = [];
  roots.forEach((_, c) => {
    const nodes = R.nodes.filter((n) => compOf(n) === c);
    const sites = R.sites.map((_, i) => i).filter((i) => siteComp[i] === c);
    const m = new Map(sites.map((s, j) => [s, j]));
    const redex: Carrier = {
      inner: { places: sites.map((i) => R.inner.places[i]), names: [], locality: [] },
      outer: R.outer,
      nodes,
      edges: R.edges.filter((e) => edgeComp.get(e.id) === c),
      sites: sites.map((i) => R.sites[i]),
      names: [],
      siteKeys: sites.map((i) => R.siteKeys[i]),
    };
    const fs = own[c];
    let rateExpr: Expr | undefined;
    // each component's factors as a real product, seeded with 1.0: regrouped, two whole-number factors would otherwise
    // divide as whole numbers (floored) where the rule as written divides a fractional product (F59)
    for (const f of fs) {
      const e = renumber(f.e, m);
      rateExpr = { op: f.div ? '/' : '*', args: [rateExpr ?? { lit: { float: 1 } }, e] };
    }
    parts.push({ name: `${rule.name}#${c}`, redex, reactum: redex, sites: [], kept: [], keptEdges: [], negatives: [], rateExpr, rate: rateExpr ? undefined : 1 });
    siteMaps.push(sites);
  });
  return { rule, parts, siteMaps, k };
}

/** The rule's occurrence composed from one occurrence of each part (all in one place). */
export function composeEncounter(enc: Encounter, occs: Occurrence[]): Occurrence {
  const sites: Id[][] = enc.rule.redex.sites.map(() => []);
  occs.forEach((o, c) => enc.siteMaps[c].forEach((s, j) => (sites[s] = o.sites[j])));
  const points = occs.flatMap((o) => o.points ?? []);
  return {
    rule: enc.rule.name,
    nodes: occs.flatMap((o) => o.nodes),
    edges: occs.flatMap((o) => o.edges),
    sites,
    places: occs[0].places,
    names: [],
    ...(points.length ? { points } : {}),
  };
}
