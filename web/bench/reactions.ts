import { Discovery, type Program, World, pickOccurrence, rng } from '../src/engine';

/** ms a reaction, values written in place (as cycle's runner). */
export function msPerReaction(p: Program, steps: number, seed = 1): { ms: number; fired: Record<string, number> } {
  const random = rng(seed);
  const d = new Discovery(p.rules, p.sig);
  const w = new World(p.world, p.sig);
  d.totalRate(w.g);
  const fired: Record<string, number> = {};
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    const total = d.totalRate(w.g)!;
    const chosen = d.spotAt(w.g, random() * total)!;
    const occ = d.fresh(w.g, chosen.rule, pickOccurrence(chosen, random), { inPlace: true });
    const { transition, before } = w.apply(chosen.rule, occ, p.sig, { inPlace: true });
    d.advanceWorld(w, before, transition);
    fired[chosen.rule.name] = (fired[chosen.rule.name] ?? 0) + 1;
  }
  return { ms: (performance.now() - t0) / steps, fired };
}
