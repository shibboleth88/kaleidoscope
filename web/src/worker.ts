/**
 * The engine's thread: the simulation runs here, so a busy system never stalls the drawing.
 *
 * In:  setup · play · step · seek · pace
 * Out: frames (what was taken: their records, and the state after the last) · seeked · rest
 *
 * The page keeps the records (for the timeline) and draws the state it is sent; the states themselves stay here.
 */

import type { Carrier, Rule, Transition, TypeDecl } from './engine';
import { Signature } from './engine';
import { type FrameMeta, Simulation, meta } from './sim';

export type ToWorker =
  | { kind: 'setup'; gen: number; types: TypeDecl[]; initial: Carrier | null; rules: Rule[]; seed: number; problems: string[] }
  | { kind: 'play'; playing: boolean; pace: 'steps' | 'time'; speed: number; skipQuiet?: boolean }
  | { kind: 'step'; skipQuiet?: boolean }
  | { kind: 'seek'; i: number };

/** Every message out carries the setup it is about (`gen`), so the page can let go of one about an older setup. */
export type FromWorker = { gen: number } & (
  /** Frames after `base`, the state the last leaves, and the reaction that made it. */
  | { kind: 'frames'; base: number; metas: FrameMeta[]; at: number; state: Carrier; transition: Transition | null; fresh: boolean; problems: string[] }
  | { kind: 'rest'; at: number; problems: string[] }
  /** Gone back (or forward) to frame `at`, without letting anything go. */
  | { kind: 'seeked'; at: number; state: Carrier; transition: Transition | null }
);
type Out = FromWorker extends infer T ? (T extends { gen: number } ? Omit<T, 'gen'> : never) : never;

const sim = new Simulation();
let playing = false;
let pace: 'steps' | 'time' = 'steps';
let speed = 1.2;
/** By steps, go on through reactions that change no link. */
let skipQuiet = false;
let timer = 0;
let simClock = 0;
let generation = 0;
/** The setup being run, as the page numbered it. */
let setupGen = 0;

const post = (m: Out) => (self as unknown as Worker).postMessage({ ...m, gen: setupGen });

let lastSent = 0;
/** The frame after which the page has not yet been told (Infinity: told of everything). */
let unsentFrom = Infinity;

/** Tell the page about frames from `base` on, and where the last leaves the world. */
function send(base: number, fresh: boolean) {
  const f = sim.frame;
  if (!f) return;
  post({ kind: 'frames', base, metas: sim.frames.slice(base + 1, sim.at + 1).map(meta), at: sim.at, state: f.state, transition: f.transition, fresh, problems: sim.problems });
}

function schedule() {
  clearTimeout(timer);
  if (!playing) return;
  const g = generation;
  if (pace === 'time') {
    timer = self.setTimeout(() => g === generation && tickTime(), 16);
  } else timer = self.setTimeout(() => g === generation && tickStep(), 1000 / speed);
}

/** By steps: one reaction, then wait. */
function tickStep() {
  const base = sim.at;
  if (sim.stepOnce(skipQuiet)) send(base, true);
  else post({ kind: 'rest', at: sim.at, problems: sim.problems });
  schedule();
}

/** By time: every reaction fallen due since the last tick, then wait a frame. */
function tickTime() {
  const f = sim.frame;
  if (!f) return;
  simClock = Math.max(simClock, f.t) + 0.016 * speed;
  const base = sim.at;
  const { taken, resting, behind } = sim.runUntil(simClock);
  // more fell due than a tick affords: the clock waits for the world
  if (behind) simClock = sim.frame!.t;
  // what was taken, sent at most every other frame: the page draws no faster than that
  if (taken) {
    unsentFrom = Math.min(unsentFrom, base);
    if (performance.now() - lastSent > 30) {
      send(unsentFrom, true);
      unsentFrom = Infinity;
      lastSent = performance.now();
    }
  }
  if (resting) post({ kind: 'rest', at: sim.at, problems: sim.problems });
  clearTimeout(timer);
  const g = generation;
  if (playing) timer = self.setTimeout(() => g === generation && tickTime(), resting ? 500 : 16);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (unsentFrom !== Infinity && m.kind !== 'setup') {
    send(unsentFrom, true);
    unsentFrom = Infinity;
  }
  switch (m.kind) {
    case 'setup':
      unsentFrom = Infinity;
      setupGen = m.gen;
      generation++;
      clearTimeout(timer);
      sim.reset(Signature.fromJSON(m.types), m.initial, m.rules, m.seed, m.problems);
      simClock = 0;
      if (sim.frame) post({ kind: 'frames', base: -1, metas: [meta(sim.frame)], at: 0, state: sim.frame.state, transition: null, fresh: false, problems: sim.problems });
      else post({ kind: 'rest', at: 0, problems: sim.problems });
      schedule();
      break;
    case 'play':
      playing = m.playing;
      pace = m.pace;
      speed = m.speed;
      skipQuiet = !!m.skipQuiet;
      simClock = sim.frame?.t ?? 0;
      generation++;
      schedule();
      break;
    case 'step': {
      const base = sim.at;
      if (sim.stepOnce(m.skipQuiet ?? skipQuiet)) send(base, true);
      else post({ kind: 'rest', at: sim.at, problems: sim.problems });
      break;
    }
    case 'seek': {
      sim.seek(m.i);
      simClock = sim.frame?.t ?? 0;
      const f = sim.frame;
      if (f) post({ kind: 'seeked', at: sim.at, state: f.state, transition: f.transition });
      break;
    }
  }
};
