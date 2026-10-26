/**
 * A rate is real-valued (chrysalis D-a-rate-is-real; F64, F67): division in a rate is the true quotient, never floored;
 * a reactum's integer arithmetic keeps its floor. Boundary's suite case B6 (docs/36).
 */
import { describe, expect, it } from 'vitest';
import { Discovery, World, readProgram } from '../src/engine';

const p = readProgram(`
Program(
  module = (
    P[a :: Int | b :: Int] = Type()
    L[l :: Int | h :: Int = 0] = Type()
    r[rate = ?a / (?a + ?b)] = (?p = P[a = ?a | b = ?b]) => (?p = P[a = ?a - 1 | b = ?b + 1])
    half[rate = 1.0] = (?q = L[l = ?l | h = 0]) => (?q = L[l = ?l | h = ?l / 2])
    nested[rate = 1.0 * (?a / ?b) + ?a % ?b / 2] = (?p = P[a = ?a | b = ?b]) => (?p = P[a = ?a | b = ?b])
  )
  world = (P[a = 3 | b = 1] | L[l = 7])
)`);
const rate = (name: string) => new Discovery(p.rules, p.sig).all(p.world).filter((s) => s.rule.name === name).reduce((a, s) => a + s.rate, 0);

describe('a rate is real-valued', () => {
  it('divides whole numbers in a rate as real numbers', () => {
    expect(rate('r')).toBeCloseTo(0.75, 12);
    // every division in a rate, nested or not: 3 / 1 + (3 % 1) / 2
    expect(rate('nested')).toBeCloseTo(3, 12);
  });

  it('keeps the floor of whole-number division in a reactum', () => {
    const rule = p.rules.find((r) => r.name === 'half')!;
    const w = new World(p.world);
    const d = new Discovery(p.rules, p.sig);
    w.apply(rule, d.fresh(w.g, rule, d.all(w.g).find((s) => s.rule.name === 'half')!.occurrences[0]), p.sig);
    const g = w.snapshot();
    const h = g.nodes.find((n) => 'attr' in n.member && n.member.attr && 'text' in n.member.attr && n.member.attr.text === 'h')!;
    expect((h.payload as { scalar: { int: number } }).scalar.int).toBe(3);
  });
});
