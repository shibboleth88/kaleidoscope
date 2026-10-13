import { it } from 'vitest';
import { type Carrier, Discovery, readState, rng, step } from '../src/engine';
import { compile, growth, lacOperon, mapk, yinYang } from '../src/library';

function run(name: string, lib: ReturnType<typeof mapk>, steps: number, state?: string) {
  const c = compile(lib);
  const rules = lib.rules.map((r) => c.rules.get(r.id) as never);
  let g = (state ? readState(state, c.sig) : c.states.get(lib.states[0].id)) as Carrier;
  const random = rng(1);
  // warm up
  for (let i = 0; i < 5; i++) g = step(g, rules, c.sig, random)?.state ?? g;
  const g0 = g;
  const time = (d?: Discovery) => {
    g = g0;
    const random = rng(1);
    const t0 = performance.now();
    let n = 0;
    for (; n < steps; n++) {
      const s = step(g, rules, c.sig, random, d);
      if (!s) break;
      g = s.state;
    }
    return (performance.now() - t0) / n;
  };
  const full = time();
  const inc = time(new Discovery(rules, c.sig));
  console.log(`${name.padEnd(28)} nodes ${String(g.nodes.length).padStart(4)}  full ${full.toFixed(2).padStart(7)} ms/step   incremental ${inc.toFixed(2).padStart(6)} ms/step  ×${(full / inc).toFixed(1)}`);
}

it('bench', () => {
  run('MAPK', mapk(), 200);
  run('Growth', growth(), 200);
  run('lac operon', lacOperon(), 200);
  run('yin yang', yinYang(), 200);
  const yins = (k: number, j: number) => `Taiji(Dark(${Array(k).fill('Yin').join(' | ')}) | Light(${Array(j).fill('Yang').join(' | ')}))`;
  run('yin yang ×10 (200 tokens)', yinYang(), 50, yins(120, 80));
  const cells = (k: number) => `Cell(Cytoplasm(${Array(k).fill('MEK').join(' | ')} | ${Array(k).fill('ERK[name = "e"]').join(' | ')} | Nucleus()))`;
  run('MAPK ×10 (≈60 molecules)', mapk(), 50, cells(30));
  run('MAPK ×40 (≈240 molecules)', mapk(), 40, cells(120));
}, 120_000);
