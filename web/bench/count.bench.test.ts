import { it } from 'vitest';
import { type Carrier, Discovery, rng, step } from '../src/engine';
import * as match from '../src/engine/match';
import { compile, embryo } from '../src/library';

it('searches per step (embryo)', () => {
  const lib = embryo();
  const c = compile(lib);
  const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
  let g = c.states.get(lib.states[0].id) as Carrier;
  const d = new Discovery(rules, c.sig);
  const random = rng(1);
  for (let i = 0; i < 2500; i++) g = step(g, rules, c.sig, random, d)!.state;
  const calls = { n: 0, found: 0 };
  const orig = match.discover;
  (match as unknown as { counting: unknown }).counting = calls;
  let n = 0;
  const t0 = performance.now();
  match.stats.calls = 0; match.stats.found = 0;
  for (let i = 0; i < 200; i++, n++) g = step(g, rules, c.sig, random, d)!.state;
  console.log(`${((performance.now() - t0) / n).toFixed(2)} ms/step at ${g.nodes.filter((x) => x.type === c.sig.id('Cell')).length} cells; discover calls/step ${(match.stats.calls / n).toFixed(0)}, occurrences found/step ${(match.stats.found / n).toFixed(0)}`);
  void orig;
});
