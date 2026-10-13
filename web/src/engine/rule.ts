/**
 * Rules: chrysalis `Spec/Rule.lean`.
 *
 * - a redex and a reactum, sharing their outer face and their inner names;
 * - a site map: the reactum's site `j` takes what the redex's site `sites[j]` held — used twice it is copied with
 *   fresh identities, never used it is dropped (Milner's instantiation);
 * - what is kept: a redex node and the reactum node that is it, by identity (double-pushout style);
 * - negative patterns, each extending the redex: an occurrence holds only where none of them meets the state.
 */

import { type Carrier, type Id, formedProblems, keyed, sameFace } from './carrier';

import type { Signature } from './signature';
import type { Expr, ScalarKind } from './expr';

export interface Rule {
  name: string;
  redex: Carrier;
  reactum: Carrier;
  sites: number[];
  kept: [Id, Id][];
  keptEdges: [Id, Id][];
  negatives: Carrier[];
  /**
   * PROVISIONAL (spec gap G7: rate, priority and label as rule attributes are `proposed`). A propensity
   * coefficient: the random policy weighs each spot this rule meets by it. Defaults to 1.
   */
  rate?: number;
  /** PROVISIONAL (spec part `rules.guard`, planned): the rule meets only where this holds, over its sites. */
  guard?: Expr;
  /** PROVISIONAL (operations answered in place): reactum scalar nodes whose value is computed from the sites. */
  computed?: { node: Id; expr: Expr; kind: ScalarKind }[];
}

const nodup = (xs: number[]) => new Set(xs).size === xs.length;

/** `Rule.formed`, each failure named. */
export function ruleProblems(r: Rule): string[] {
  const out: string[] = [];
  for (const p of formedProblems(r.redex)) out.push(`redex: ${p}`);
  for (const p of formedProblems(r.reactum)) out.push(`reactum: ${p}`);
  if (!sameFace(r.redex.outer, r.reactum.outer)) out.push('redex and reactum differ on their outer face');
  const rn = r.redex.inner.names, xn = r.reactum.inner.names;
  if (rn.length !== xn.length || rn.some(([x, t], i) => x !== xn[i][0] || t !== xn[i][1]))
    out.push('redex and reactum differ on their inner names');
  if (r.sites.length !== r.reactum.inner.places.length) out.push('the site map does not cover the reactum sites');
  r.sites.forEach((i, j) => {
    if (i >= r.redex.inner.places.length) out.push(`reactum site ${j} takes redex site ${i}, which is not one`);
    else if (r.redex.inner.places[i] !== r.reactum.inner.places[j]) out.push(`reactum site ${j} and redex site ${i} differ in type`);
  });
  const rx = new Map(r.redex.nodes.map((n) => [n.id, n]));
  const xx = new Map(r.reactum.nodes.map((n) => [n.id, n]));
  if (!nodup(r.kept.map(([a]) => a)) || !nodup(r.kept.map(([, b]) => b))) out.push('a node is kept twice');
  for (const [a, b] of r.kept)
    if (!rx.has(a) || !xx.has(b) || rx.get(a)!.type !== xx.get(b)!.type)
      out.push(`kept pair ${a}→${b}: not a redex node and a reactum node of one type`);
  const re = new Map(r.redex.edges.map((e) => [e.id, e]));
  const xe = new Map(r.reactum.edges.map((e) => [e.id, e]));
  if (!nodup(r.keptEdges.map(([a]) => a)) || !nodup(r.keptEdges.map(([, b]) => b))) out.push('an edge is kept twice');
  for (const [a, b] of r.keptEdges)
    if (!re.has(a) || !xe.has(b) || re.get(a)!.contract !== xe.get(b)!.contract)
      out.push(`kept edge ${a}→${b}: not a redex edge and a reactum edge of one contract`);
  r.negatives.forEach((ng, k) => {
    for (const p of formedProblems(ng)) out.push(`negative ${k}: ${p}`);
    // PROVISIONAL: the spec asks the redex's faces exactly; here a negative may add sites and names after them
    const prefix = <T>(a: T[], b: T[]) => a.length <= b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
    if (
      JSON.stringify(ng.outer.places) !== JSON.stringify(r.redex.outer.places) ||
      !prefix(r.redex.outer.names, ng.outer.names) ||
      !prefix(r.redex.inner.places, ng.inner.places) ||
      !prefix(r.redex.sites, ng.sites) ||
      !prefix(r.redex.siteKeys, ng.siteKeys)
    )
      out.push(`negative ${k}: its faces do not extend the redex's`);
    const nn = new Map(ng.nodes.map((n) => [n.id, JSON.stringify(n)]));
    if (!r.redex.nodes.every((n) => nn.get(n.id) === JSON.stringify(n))) out.push(`negative ${k}: does not extend the redex's nodes`);
    const ne = new Map(ng.edges.map((e) => [e.id, JSON.stringify(e)]));
    if (!r.redex.edges.every((e) => ne.get(e.id) === JSON.stringify(e))) out.push(`negative ${k}: does not extend the redex's edges`);
  });
  // its parts apart: no identity shared by the redex, the reactum and what each negative adds
  const extras = (ng: Carrier) => ng.nodes.filter((n) => !rx.has(n.id)).map((n) => n.id);
  if (!nodup([...r.redex.nodes.map((n) => n.id), ...r.reactum.nodes.map((n) => n.id), ...r.negatives.flatMap(extras)]))
    out.push('the parts share a node identity');
  const extraEdges = (ng: Carrier) => ng.edges.filter((e) => !re.has(e.id)).map((e) => e.id);
  if (!nodup([...r.redex.edges.map((e) => e.id), ...r.reactum.edges.map((e) => e.id), ...r.negatives.flatMap(extraEdges)]))
    out.push('the parts share an edge identity');
  return out;
}

/**
 * What this matcher asks beyond `Rule.formed` (kaleidoscope's, each a place where the spec admits more than a
 * finite search should enumerate):
 * - each redex region holds a node, so it meets the state somewhere definite;
 * - no anonymous site stands directly in a redex region (it would hold any subset of what is beside the match);
 * - each redex outer name has a point in the redex, so the state decides what it is;
 * - no binders (not yet).
 */
export function matcherProblems(r: Rule): string[] {
  const out: string[] = [];
  r.redex.outer.places.forEach((_, i) => {
    if (!r.redex.nodes.some((n) => 'region' in n.parent && n.parent.region === i)) out.push(`redex region ${i} holds no node`);
  });
  r.redex.sites.forEach((s, i) => {
    if ('region' in s && !keyed(r.redex.siteKeys[i])) out.push(`redex site ${i} stands anonymous at a root`);
  });
  const used = new Set(r.redex.nodes.flatMap((n) => n.ports.flatMap((g) => g.points.map(([, p]) => p.target))).filter((h) => 'name' in h).map((h) => (h as { name: Id }).name));
  for (const [x] of r.redex.outer.names) if (!used.has(x)) out.push(`redex outer name ${x} has no point in the redex`);
  if ([r.redex, r.reactum, ...r.negatives].some((g) => g.nodes.some((n) => n.payload === 'binder'))) out.push('binders are not supported yet');
  // an unless adding nothing is the redex itself: it would block every occurrence, and the rule could never fire
  r.negatives.forEach((ng, k) => {
    if (ng.nodes.length === r.redex.nodes.length && ng.edges.length === r.redex.edges.length) out.push(`unless ${k + 1} adds nothing, so the rule could never fire`);
  });
  return out;
}

export function checkRule(r: Rule, _sig?: Signature): string[] {
  return [...ruleProblems(r), ...matcherProblems(r)];
}
