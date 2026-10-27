/**
 * Events: the occurrences of a spot that are one reaction, and those that are not (kaleidoscope's, PROVISIONAL;
 * spec finding F83).
 *
 * A spot (`spotKey`: a rule and the nodes and edges it meets) was the unit a policy weighs, so that a symmetric redex
 * (`A | A`) meeting two nodes twice, once each way round, fires at its rate and not twice it (F14). With rates read
 * from the occurrence (F13, F22), that is wrong wherever the two ways round are different reactions: in
 * `(~w :: War | ?a = P[s = ?x] | ?b = P[s = ?y]) => … ?a's s = ?x - 1 …` at rate `?y`, the redex is symmetric but the
 * rule is not, and the occurrences meeting a and b each way round wear down different sides at different rates. The
 * spot held one rate, its first occurrence's, and one of its two reactions was chosen uniformly.
 *
 * The rule here: two occurrences are one event where a symmetry of the whole rule (redex, reactum, guard and rate
 * together) takes one to the other. Whether the permutation of redex nodes relating them is one is decided by what they
 * do, the first time a rule's permutation is met: the reactum instantiated against the state (each kept node as the
 * state node it is, each fresh node by its type, each site by the roots it holds, each value as it is worked out,
 * each link as the state's). The answer is kept for the rule, so the comparison is made once per permutation, not per
 * spot. A spot's rate is the
 * sum of its events' rates, and an occurrence is drawn in proportion to its event's rate, shared among the event's
 * occurrences. A spot of one occurrence is as before.
 */

import { type Carrier, type Handle, type Index, type Node, memberKey, scalarKey } from './carrier';
import { evaluate } from './expr';
import { type Occurrence, guardHolds, guardParts, occEnv } from './match';
import type { Rule } from './rule';
import type { Signature } from './signature';

/** An occurrence's rate: the rule's rate expression evaluated there, or its constant rate (zero where it fails). */
export function occurrenceRate(ix: Index, rule: Rule, o: Occurrence, sig?: Signature): number {
  // a deferred guard (F99): an occurrence that could not fire, kept dormant, is rated zero
  if (sig && guardParts.has(rule) && !guardHolds(ix, rule, o, sig)) return 0;
  if (!rule.rateExpr) return rule.rate ?? 1;
  try {
    return (evaluate(rule.rateExpr, occEnv(ix, o, sig, rule), 'float') as { float: number }).float;
  } catch {
    return 0;
  }
}

/** An occurrence's acceptance (F92): the rule's `accept` evaluated there, within [0, 1]; 1 where it has none. */
export function occurrenceAccept(ix: Index, rule: Rule, o: Occurrence, sig?: Signature): number {
  if (!rule.accept) return 1;
  try {
    const v = (evaluate(rule.accept, occEnv(ix, o, sig, rule), 'float') as { float: number }).float;
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  } catch {
    return 0;
  }
}

/**
 * What an occurrence does, as text: the reactum's nodes as they would stand in the state, each line a node under
 * its parent, sorted. Two occurrences with one effect key make the same state from this one (up to the identities
 * of what is fresh), so they are one reaction.
 */
export function effectKey(ix: Index, rule: Rule, o: Occurrence, sig?: Signature): string {
  const R: Carrier = rule.reactum;
  const meets = new Map(o.nodes);
  const meetsEdge = new Map(o.edges);
  const keptOf = new Map(rule.kept.map(([a, b]) => [b, a]));
  const keptEdgeOf = new Map(rule.keptEdges.map(([a, b]) => [b, a]));
  const computed = new Map((rule.computed ?? []).map((c) => [c.node, c]));
  const env = rule.computed?.length || rule.linkWrites?.length ? occEnv(ix, o, sig, rule) : null;
  const byId = new Map(R.nodes.map((n) => [n.id, n]));
  // a node's name: the state node it is, where kept; else fresh, by its type
  const label = (n: Node) => (keptOf.has(n.id) ? `s${meets.get(keptOf.get(n.id)!)}` : `f${n.type}`);
  const where = (p: Node['parent']) => ('node' in p ? label(byId.get(p.node)!) : `r${JSON.stringify(o.places[p.region])}`);
  const handle = (h: Handle) =>
    'edge' in h ? (keptEdgeOf.has(h.edge) ? `e${meetsEdge.get(keptEdgeOf.get(h.edge)!)}` : 'e+') : 'name' in h ? `n${JSON.stringify(o.names.find(([x]) => x === h.name)?.[1] ?? h.name)}` : `b${h.binder}`;
  const lines: string[] = [];
  for (const n of R.nodes) {
    let value = '';
    const c = computed.get(n.id);
    if (c && env) {
      try {
        value = scalarKey(evaluate(c.expr, env, c.kind));
      } catch {
        value = '!';
      }
    } else if (typeof n.payload === 'object') value = scalarKey(n.payload.scalar);
    else value = n.payload;
    const ports = n.ports
      .map((g) => {
        const rest = g.rest
          ? [g.rest, ...(g.more ?? [])].flatMap((r) => o.rests?.find(([x]) => x === r)?.[1].ports.map((p) => JSON.stringify(p.target)) ?? []).sort().join(',')
          : '';
        return `${scalarKey(g.key)}:${g.points.map(([, p]) => handle(p.target)).sort().join(',')}|${rest ?? ''}`;
      })
      .join(';');
    lines.push(`${where(n.parent)}>${label(n)}[${memberKey(n.member)}=${value}](${ports})`);
  }
  // each value written on a link (F97): the link, and what it is written
  for (const w of rule.linkWrites ?? []) {
    let value: string;
    try {
      value = w.fields.map(([k, x, kind]) => `${k}=${scalarKey(evaluate(x, env!, kind))}`).join('|');
    } catch {
      value = '!';
    }
    lines.push(`~${handle(w.link)}=${w.type}[${value}]`);
  }
  // each site: the roots it holds, under where it stands
  R.sites.forEach((p, j) => lines.push(`${where(p)}>site${JSON.stringify(R.siteKeys[j])}{${[...(o.sites[rule.sites[j]] ?? [])].sort((a, b) => a - b).join(',')}}`));
  return lines.sort().join('\n');
}

/**
 * Whether two occurrences meeting the same nodes are one event depends only on the permutation of the redex's nodes
 * that takes one to the other: on whether it is a symmetry of the rule. Each rule's permutations are answered once,
 * by comparing the two occurrences' effects the first time the permutation is met, and the answer kept.
 */
const symmetric = new WeakMap<Rule, Map<string, boolean>>();
function permutation(a: Occurrence, b: Occurrence): string {
  const at = new Map(b.nodes.map(([pn, sn]) => [sn, pn]));
  return a.nodes.map(([pn, sn]) => `${pn}>${at.get(sn)}`).join(',');
}

/**
 * A spot's occurrences grouped into events: for each occurrence, how many of the spot's occurrences are its event
 * (itself included).
 */
export function eventSizes(ix: Index, rule: Rule, occurrences: Occurrence[], sig?: Signature): number[] {
  const n = occurrences.length;
  if (n === 1) return [1];
  let known = symmetric.get(rule);
  if (!known) symmetric.set(rule, (known = new Map()));
  const keys: (string | undefined)[] = new Array(n);
  const key = (i: number) => (keys[i] ??= effectKey(ix, rule, occurrences[i], sig));
  // occurrences a symmetry of the rule relates, as classes (a union by the permutations' answers)
  const up = occurrences.map((_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const pi = permutation(occurrences[i], occurrences[j]);
      let same = known.get(pi);
      if (same === undefined) known.set(pi, (same = key(i) === key(j)));
      if (same) up[find(j)] = find(i);
    }
  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  return occurrences.map((_, i) => size.get(find(i))!);
}

/**
 * A spot's rate (the sum of its events' rates), and each occurrence's weight (its event's rate shared among the
 * event's occurrences), the weights summing to the rate. `sizes` (from `eventSizes`), where given, is the grouping
 * already worked out.
 */
export function eventRates(ix: Index, rule: Rule, occurrences: Occurrence[], sig?: Signature, sizes?: number[]): { rate: number; weights: number[] } {
  if (occurrences.length === 1) {
    const r = occurrenceRate(ix, rule, occurrences[0], sig);
    return { rate: r, weights: [r] };
  }
  const n = sizes ?? eventSizes(ix, rule, occurrences, sig);
  const weights = occurrences.map((o, i) => {
    const r = occurrenceRate(ix, rule, o, sig);
    return r > 0 && Number.isFinite(r) ? r / n[i] : 0;
  });
  return { rate: weights.reduce((a, b) => a + b, 0), weights };
}

/** One of a spot's occurrences, drawn in proportion to its weight (uniformly where it has none). */
export function pickOccurrence(spot: { occurrences: Occurrence[]; weights?: number[] }, random: () => number): Occurrence {
  const { occurrences: os, weights: w } = spot;
  if (!w || w.length !== os.length) return os[Math.floor(random() * os.length)];
  const total = w.reduce((a, b) => a + b, 0);
  let u = random() * total;
  for (let i = 0; i < os.length; i++) if ((u -= w[i]) < 0) return os[i];
  return os[os.length - 1];
}

