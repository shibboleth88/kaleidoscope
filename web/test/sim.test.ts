import { Simulation } from '../src/sim';
import { compile, yinYang } from '../src/library';
import type { Carrier, Rule } from '../src/engine';

describe('the simulation', () => {
  it('runs by time, keeps every frame, seeks, and goes on from where it is', () => {
    const lib = yinYang();
    const c = compile(lib);
    const sim = new Simulation();
    sim.reset(c.sig, c.states.get(lib.states[0].id) as Carrier, lib.rules.map((r) => c.rules.get(r.id) as Rule), 3, []);
    const { taken } = sim.runUntil(5, Infinity, Infinity); // no budget: what a test asks is what is due, not what fits in a frame
    expect(taken).toBeGreaterThan(4);
    expect(sim.frame!.t).toBeLessThanOrEqual(5);
    expect(sim.frames.length).toBe(taken + 1);
    sim.seek(3);
    expect(sim.at).toBe(3);
    sim.stepOnce();
    // what came after frame 3 is let go
    expect(sim.frames.length).toBe(5);
    expect(sim.frames[4].t).toBeGreaterThan(sim.frames[3].t);
  });
});
