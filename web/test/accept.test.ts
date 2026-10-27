/**
 * Acceptance (F92): a rule firing at `rate` and accepted with probability `accept` is the process with rate × accept
 * (thinning), whether `accept` is a constant or reads a value that changes.
 */
import { describe, expect, it } from 'vitest';
import { Discovery, readProgram, rng, step } from '../src/engine';

const run = (rule: string, horizon: number, seed: number) => {
  const p = readProgram(`Program(
  module = (
    C[n :: Int] = Type()
    ${rule}
  )
  world = (C[n = 0])
)`);
  const d = new Discovery(p.rules, p.sig);
  const random = rng(seed);
  let g = p.world, t = 0, n = 0;
  for (;;) {
    const s = step(g, p.rules, p.sig, random, d);
    if (!s || t + s.dt > horizon) break;
    (g = s.state), (t += s.dt), n++;
  }
  return n;
};

describe('acceptance: thinning', () => {
  it('fires at rate × accept', () => {
    // 4,000 time units at 0.5: 2,000 firings, sd about 45
    const thinned = run('tick[rate = 2.0 | accept = 0.25] = (?c = C[n = ?n]) => (?c = C[n = ?n + 1])', 4000, 1);
    const plain = run('tick[rate = 0.5] = (?c = C[n = ?n]) => (?c = C[n = ?n + 1])', 4000, 2);
    expect(Math.abs(thinned - 2000)).toBeLessThan(150);
    expect(Math.abs(plain - 2000)).toBeLessThan(150);
  });

  it('reads the occurrence, as a rate would', () => {
    // accepted with probability 1/(1 + n): the count grows as the square root of 2·rate·t, as at rate 1/(1 + n)
    const thinned = run('tick[rate = 1.0 | accept = 1.0 / (1 + ?n)] = (?c = C[n = ?n]) => (?c = C[n = ?n + 1])', 5000, 3);
    const plain = run('tick[rate = 1.0 / (1 + ?n)] = (?c = C[n = ?n]) => (?c = C[n = ?n + 1])', 5000, 4);
    expect(Math.abs(thinned - plain)).toBeLessThan(10);
    expect(Math.abs(thinned - Math.sqrt(2 * 5000))).toBeLessThan(10);
  });
});
