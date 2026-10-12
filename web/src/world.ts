/**
 * The world: the system running. One initial state, a set of reactions, one reaction at a time, forever — until
 * anything it is made of changes, when it starts again from the initial state.
 */

import { type Carrier, type Rule, type Signature, type Stepped, discover, rng, step } from './engine';
import * as THREE from 'three';
import { BigraphView } from './view/scene';

export interface WorldSetup {
  sig: Signature;
  initial: Carrier | null;
  rules: Rule[];
  seed: number;
  problems: string[];
}

export class World {
  readonly view: BigraphView;
  private g: Carrier | null = null;
  private setup: WorldSetup | null = null;
  private random = rng(1);
  private timer = 0;
  private steps = 0;
  private t = 0;
  playing = true;
  /** Reactions per second. */
  speed = 1.2;
  onStatus: (s: { steps: number; t: number; live: number; resting: boolean; last: string | null; problems: string[] }) => void = () => {};
  onEvent: (e: { step: number; t: number; rule: string }) => void = () => {};
  private live = 0;
  private last: string | null = null;

  constructor(host: HTMLElement, sig: Signature) {
    this.view = new BigraphView(host, sig);
  }

  /** Begin again, from the initial state, with whatever the system now is. */
  reset(setup: WorldSetup = this.setup!) {
    this.setup = setup;
    clearTimeout(this.timer);
    this.view.setSignature(setup.sig);
    this.random = rng(setup.seed);
    this.steps = 0;
    this.t = 0;
    this.last = null;
    this.g = setup.initial;
    this.view.show(this.g ? [{ key: 'w', carrier: this.g, offset: new THREE.Vector3() }] : []);
    this.live = this.g ? setup.rules.reduce((a, r) => a + discover(this.g!, r, setup.sig, { limit: 1000 }).length, 0) : 0;
    this.status();
    this.schedule(900);
  }

  private status() {
    this.onStatus({ steps: this.steps, t: this.t, live: this.live, resting: !!this.g && this.live === 0, last: this.last, problems: this.setup?.problems ?? [] });
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

  /** One reaction: light up what it meets, then rewrite. */
  advance(manual = false) {
    const setup = this.setup;
    if (!setup || !this.g) return;
    let s: Stepped | null;
    try {
      s = step(this.g, setup.rules, setup.sig, this.random);
    } catch (e) {
      setup.problems = [...setup.problems, `reaction failed: ${(e as Error).message}`];
      this.status();
      return;
    }
    if (!s) {
      this.live = 0;
      this.status();
      if (!manual) this.schedule(1500); // resting; look again later in case nothing changes
      return;
    }
    const stepped = s;
    const lead = Math.min(450, 380 / Math.max(0.5, this.speed / 1.2));
    this.view.highlight('w', stepped.transition.occurrence.nodes.map(([, id]) => id));
    window.setTimeout(() => {
      if (this.setup !== setup) return; // reset since
      this.g = stepped.state;
      this.steps++;
      this.t += stepped.dt;
      this.live = stepped.live;
      this.last = stepped.transition.rule;
      this.view.show([{ key: 'w', carrier: this.g, offset: new THREE.Vector3() }], { slot: 'w', t: stepped.transition });
      this.onEvent({ step: this.steps, t: this.t, rule: stepped.transition.rule });
      this.status();
      if (!manual) this.schedule(Math.max(0, 1000 / this.speed - lead));
    }, lead);
  }
}
