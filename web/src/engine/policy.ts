/**
 * Policy: which occurrence fires next.
 *
 * PROVISIONAL. The spec's scheduling axis makes the policy rules in the program's run part, and its one fixed
 * part takes every independent occurrence as a round (`Scheduling.choose`). The library's default policy is not
 * written yet. The editor wants to watch reactions unfold one at a time, so this policy takes ONE occurrence per
 * step: a spot (`Occurrence.SameSpot`) chosen with probability proportional to its rule's rate, then one of the
 * spot's occurrences uniformly. Time advances as in Gillespie's direct method: dt ~ Exp(total propensity).
 */

import { type Carrier, Index } from './carrier';
import { evaluate } from './expr';
import { type Occurrence, discover, siteEnv, spotKey } from './match';
import { type Transition, react } from './react';
import type { Rule } from './rule';
import type { Signature } from './signature';
import type { Discovery } from './incremental';

/** A small, seedable random source (mulberry32), so a run is reproducible from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Spot {
  rule: Rule;
  occurrences: Occurrence[];
  /** How fast it fires: the rule's rate, or its rate expression evaluated here. */
  rate: number;
}

/** Every spot each rule meets now, each with its rate; a spot whose rate is not positive is not one. */
export function spots(g: Carrier, rules: Rule[], sig: Signature): Spot[] {
  const out: Spot[] = [];
  const ix = Index.of(g);
  for (const rule of rules) {
    const bySpot = new Map<string, Occurrence[]>();
    for (const o of discover(g, rule, sig)) {
      const k = spotKey(o);
      (bySpot.get(k) ?? bySpot.set(k, []).get(k)!).push(o);
    }
    for (const occurrences of bySpot.values()) {
      let rate = rule.rate ?? 1;
      if (rule.rateExpr) {
        try {
          rate = (evaluate(rule.rateExpr, siteEnv(ix, occurrences[0].sites, sig), 'float') as { float: number }).float;
        } catch {
          rate = 0;
        }
      }
      if (rate > 0 && Number.isFinite(rate)) out.push({ rule, occurrences, rate });
    }
  }
  return out;
}

export interface Stepped {
  state: Carrier;
  transition: Transition;
  /** Time this step took. */
  dt: number;
  /** How many spots were live when it was chosen. */
  live: number;
}

/**
 * One reaction, chosen at random; null where nothing can fire (the system rests). Given a `Discovery`, the
 * occurrences are kept across steps rather than found afresh.
 */
export function step(g: Carrier, rules: Rule[], sig: Signature, random: () => number, discovery?: Discovery): Stepped | null {
  const live = discovery ? discovery.live(g) : spots(g, rules, sig);
  const rate = (s: Spot) => s.rate;
  const total = live.reduce((a, s) => a + rate(s), 0);
  if (!live.length || total <= 0) return null;
  let u = random() * total;
  let chosen = live[live.length - 1];
  for (const s of live) {
    u -= rate(s);
    if (u < 0) {
      chosen = s;
      break;
    }
  }
  const picked = chosen.occurrences[Math.floor(random() * chosen.occurrences.length)];
  const occ = discovery ? discovery.fresh(g, chosen.rule, picked) : picked;
  const { state, transition } = react(g, chosen.rule, occ, sig);
  discovery?.advance(g, state, transition);
  const dt = -Math.log(1 - random()) / total;
  return { state, transition, dt, live: live.length };
}
