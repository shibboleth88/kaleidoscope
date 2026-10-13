import { it } from 'vitest';
import { type Carrier, Index, discover, readState } from '../src/engine';
import { compile, mapk } from '../src/library';

it('per rule', () => {
  const lib = mapk();
  const c = compile(lib);
  const g = readState(`Cell(Cytoplasm(${Array(120).fill('MEK').join(' | ')} | ${Array(120).fill('ERK[name = "e"]').join(' | ')} | Nucleus() | ERLumen()))`, c.sig) as Carrier;
  const ix = new Index(g);
  for (const r of lib.rules) {
    const rule = c.rules.get(r.id) as never;
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 5; i++) n = discover(g, rule, c.sig, { index: ix }).length;
    console.log(`${r.name.padEnd(16)} ${String(n).padStart(6)} occurrences  ${((performance.now() - t0) / 5).toFixed(2)} ms  ${(((performance.now() - t0) / 5 / Math.max(1, n)) * 1000).toFixed(1)} µs each`);
  }
});
