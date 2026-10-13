/**
 * The world: the system running. One initial state, a set of reactions, one reaction at a time, forever — until
 * anything it is made of changes, when it starts again from the initial state.
 *
 * Every step is kept, a frame: the state, the reaction that made it, the time, and how many of each type there
 * were. The timeline seeks among them; playing (or stepping) from an earlier frame goes on from there, and what
 * had come after it is let go.
 */

import * as THREE from 'three';
import { type Carrier, type Rule, type Signature, type Transition, discover, rng, step } from './engine';
import { BigraphView } from './view/scene';

export interface WorldSetup {
  sig: Signature;
  initial: Carrier | null;
  rules: Rule[];
  seed: number;
  problems: string[];
}

export interface Frame {
  state: Carrier;
  /** The reaction that made this state (none for the initial one). */
  transition: Transition | null;
  t: number;
  /** How many places a reaction could happen, here. */
  live: number;
  /** How many nodes of each type. */
  counts: Map<number, number>;
}

const MAX_FRAMES = 20_000;

export class World {
  readonly view: BigraphView;
  private setup: WorldSetup | null = null;
  private random = rng(1);
  private timer = 0;
  frames: Frame[] = [];
  /** The frame shown. */
  at = 0;
  playing = true;
  /** Reactions per second. */
  speed = 1.2;
  onStatus: (s: { steps: number; t: number; live: number; resting: boolean; problems: string[]; scrubbing: boolean }) => void = () => {};
  /** A frame came to be shown: by a reaction just now (`fresh`), or by seeking. */
  onFrame: (f: Frame, index: number, fresh: boolean) => void = () => {};

  constructor(host: HTMLElement, sig: Signature) {
    this.view = new BigraphView(host, sig);
    this.view.tapFocus = true;
  }

  get frame(): Frame | undefined {
    return this.frames[this.at];
  }

  private counts(g: Carrier): Map<number, number> {
    const c = new Map<number, number>();
    for (const n of g.nodes) if (typeof n.payload !== 'object') c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }

  /** Begin again, from the initial state, with whatever the system now is. */
  reset(setup: WorldSetup = this.setup!) {
    this.setup = setup;
    clearTimeout(this.timer);
    this.view.setSignature(setup.sig);
    this.random = rng(setup.seed);
    this.frames = [];
    this.at = 0;
    const g = setup.initial;
    if (g) {
      const live = setup.rules.reduce((a, r) => a + discover(g, r, setup.sig, { limit: 1000 }).length, 0);
      this.frames.push({ state: g, transition: null, t: 0, live, counts: this.counts(g) });
    }
    this.view.show(g ? [{ key: 'w', carrier: g, offset: new THREE.Vector3() }] : [], undefined, { stable: true });
    this.status();
    if (this.frame) this.onFrame(this.frame, 0, false);
    this.schedule(900);
  }

  private status() {
    const f = this.frame;
    this.onStatus({
      steps: this.at,
      t: f?.t ?? 0,
      live: f?.live ?? 0,
      resting: !!f && f.live === 0,
      problems: this.setup?.problems ?? [],
      scrubbing: this.at < this.frames.length - 1,
    });
  }

  private schedule(ms = 1000 / this.speed) {
    clearTimeout(this.timer);
    if (this.playing) this.timer = window.setTimeout(() => this.advance(), ms);
  }

  setPlaying(p: boolean) {
    this.playing = p;
    if (p) this.schedule(200);
    else clearTimeout(this.timer);
  }

  /** Show frame `i`: one step forward animates the reaction; anything else goes straight there. */
  seek(i: number) {
    i = Math.max(0, Math.min(this.frames.length - 1, i));
    if (i === this.at || !this.frames.length) return;
    const f = this.frames[i];
    const t = i === this.at + 1 && f.transition ? { slot: 'w', t: f.transition } : undefined;
    this.at = i;
    this.view.show([{ key: 'w', carrier: f.state, offset: new THREE.Vector3() }], t, { stable: true });
    if (!t && f.transition) for (const id of [...f.transition.kept, ...f.transition.created]) this.view.highlight('w', [id]);
    this.status();
    this.onFrame(f, i, false);
  }

  /** One reaction from the frame shown: light up what it meets, then rewrite. What came after is let go. */
  advance(manual = false) {
    const setup = this.setup;
    const here = this.frame;
    if (!setup || !here) return;
    let s;
    try {
      s = step(here.state, setup.rules, setup.sig, this.random);
    } catch (e) {
      setup.problems = [...setup.problems, `reaction failed: ${(e as Error).message}`];
      this.status();
      return;
    }
    if (!s) {
      here.live = 0;
      this.status();
      if (!manual) this.schedule(1500); // resting; look again later in case nothing changes
      return;
    }
    const stepped = s;
    const lead = Math.min(450, 380 / Math.max(0.5, this.speed / 1.2));
    this.view.highlight('w', stepped.transition.occurrence.nodes.map(([, id]) => id));
    const from = this.at;
    window.setTimeout(() => {
      if (this.setup !== setup || this.at !== from) return; // reset, or moved, since
      this.frames.length = this.at + 1;
      this.frames.push({ state: stepped.state, transition: stepped.transition, t: here.t + stepped.dt, live: stepped.live, counts: this.counts(stepped.state) });
      if (this.frames.length > MAX_FRAMES) this.frames.splice(1, this.frames.length - MAX_FRAMES);
      this.at = this.frames.length - 1;
      this.view.show([{ key: 'w', carrier: stepped.state, offset: new THREE.Vector3() }], { slot: 'w', t: stepped.transition }, { stable: true });
      this.status();
      this.onFrame(this.frame!, this.at, true);
      if (!manual) this.schedule(Math.max(0, 1000 / this.speed - lead));
    }, lead);
  }
}
