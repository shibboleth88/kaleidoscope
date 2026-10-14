/**
 * The simulation: a system's states, one reaction after another, every one kept. No DOM: it runs in a worker
 * (`worker.ts`), and in tests as it is.
 */

import { type Carrier, Discovery, type Rule, type Signature, type Stepped, type Transition, rng, step } from './engine';

export interface SimFrame {
  state: Carrier;
  transition: Transition | null;
  t: number;
  live: number;
  counts: [number, number][];
}

/** A frame without its state: what the timeline draws. */
export interface FrameMeta {
  /** The rule whose reaction made it (none for the initial state). */
  rule: string | null;
  t: number;
  live: number;
  counts: [number, number][];
}

export const meta = (f: SimFrame): FrameMeta => ({ rule: f.transition?.rule ?? null, t: f.t, live: f.live, counts: f.counts });

const MAX_FRAMES = 20_000;
const QUIET_MAX = 5_000;

/** A reaction that changes no link: values rewritten, unlinked things made or let go (a photon, a pool drawn down). */
export const quiet = (t: Transition): boolean => !t.edgesCreated.length && !t.edgesRemoved.length;

export class Simulation {
  frames: SimFrame[] = [];
  at = 0;
  problems: string[] = [];
  private random = rng(1);
  private discovery: Discovery | null = null;
  private pending: { s: Stepped; from: number } | null = null;
  private sig: Signature | null = null;
  private rules: Rule[] = [];

  reset(sig: Signature, initial: Carrier | null, rules: Rule[], seed: number, problems: string[]) {
    this.sig = sig;
    this.rules = rules;
    this.problems = [...problems];
    this.random = rng(seed);
    this.discovery = new Discovery(rules, sig);
    this.frames = [];
    this.at = 0;
    this.pending = null;
    if (initial) this.frames.push({ state: initial, transition: null, t: 0, live: this.discovery.live(initial).length, counts: counts(initial) });
  }

  get frame(): SimFrame | undefined {
    return this.frames[this.at];
  }

  /** Draw the next reaction from the frame shown (not yet applied); null where nothing can react. */
  private draw(): Stepped | null {
    const here = this.frame;
    if (!here || !this.sig) return null;
    if (this.pending && this.pending.from === this.at) return this.pending.s;
    let s: Stepped | null;
    try {
      s = step(here.state, this.rules, this.sig, this.random, this.discovery ?? undefined);
    } catch (e) {
      this.problems = [...this.problems, `reaction failed: ${(e as Error).message}`];
      s = null;
    }
    this.pending = s ? { s, from: this.at } : null;
    if (!s) here.live = 0;
    return s;
  }

  /** Apply the drawn reaction: a new frame after the one shown (what came after it is let go). */
  private apply(s: Stepped) {
    const here = this.frame!;
    this.frames.length = this.at + 1;
    this.frames.push({ state: s.state, transition: s.transition, t: here.t + s.dt, live: s.live, counts: counts(s.state) });
    if (this.frames.length > MAX_FRAMES) this.frames.splice(1, this.frames.length - MAX_FRAMES);
    this.at = this.frames.length - 1;
    this.pending = null;
  }

  /**
   * One reaction; false where the system rests. `skipQuiet`: go on through reactions that change no link (`quiet`) to
   * the next that does, up to `QUIET_MAX`; every one is still a frame.
   */
  stepOnce(skipQuiet = false): boolean {
    for (let i = 0; i < QUIET_MAX; i++) {
      const s = this.draw();
      if (!s) return i > 0;
      this.apply(s);
      if (!skipQuiet || !quiet(s.transition)) return true;
    }
    return true;
  }

  /**
   * Every reaction due by simulated time `until`, within a budget of time and count. Returns how many were taken
   * and whether the system rests.
   */
  runUntil(until: number, budgetMs = 12, max = 500): { taken: number; resting: boolean; behind: boolean } {
    const t0 = performance.now();
    let taken = 0;
    while (taken < max && performance.now() - t0 < budgetMs) {
      const s = this.draw();
      if (!s) return { taken, resting: true, behind: false };
      if (this.frame!.t + s.dt > until) return { taken, resting: false, behind: false };
      this.apply(s);
      taken++;
    }
    return { taken, resting: false, behind: true };
  }

  seek(i: number) {
    this.at = Math.max(0, Math.min(this.frames.length - 1, i));
    this.pending = null;
  }
}

function counts(g: Carrier): [number, number][] {
  const c = new Map<number, number>();
  for (const n of g.nodes) if (typeof n.payload !== 'object') c.set(n.type, (c.get(n.type) ?? 0) + 1);
  return [...c];
}
