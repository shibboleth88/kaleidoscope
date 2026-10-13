/**
 * The world: the system running. One initial state, a set of reactions, one reaction at a time, forever — until
 * anything it is made of changes, when it starts again from the initial state.
 *
 * The simulation itself runs in a worker (`worker.ts`); this is its face on the page. It keeps a record of every
 * frame for the timeline (the rule that made it, its time, how many of each type), draws the state the worker
 * sends, and asks for past states when the timeline seeks.
 */

import * as THREE from 'three';
import type { Carrier, Rule, Signature, Transition } from './engine';
import { BigraphView } from './view/scene';
import type { FromWorker, ToWorker } from './worker';

export interface WorldSetup {
  sig: Signature;
  initial: Carrier | null;
  rules: Rule[];
  seed: number;
  problems: string[];
}

/** What the page keeps of a frame: not its state, which stays in the worker. */
export interface Frame {
  transition: { rule: string } | null;
  t: number;
  live: number;
  counts: Map<number, number>;
}

export class World {
  readonly view: BigraphView;
  private worker: Worker;
  frames: Frame[] = [];
  /** The frame shown. */
  at = 0;
  playing = true;
  private _pace: 'steps' | 'time' = 'steps';
  private _speed = 1.2;
  private resting = false;
  private problems: string[] = [];
  private showTimer = 0;
  /** The setup the worker is running: messages about an older one are let go. */
  private generation = 0;
  onStatus: (s: { steps: number; t: number; live: number; resting: boolean; problems: string[]; scrubbing: boolean }) => void = () => {};
  /** A frame came to be shown: by a reaction just now (`fresh`), or by seeking. */
  onFrame: (f: Frame, index: number, fresh: boolean) => void = () => {};

  constructor(host: HTMLElement, sig: Signature) {
    this.view = new BigraphView(host, sig);
    this.view.tapFocus = true;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
  }

  get frame(): Frame | undefined {
    return this.frames[this.at];
  }

  get pace() {
    return this._pace;
  }
  set pace(p: 'steps' | 'time') {
    this._pace = p;
    this.tell();
  }
  get speed() {
    return this._speed;
  }
  set speed(s: number) {
    this._speed = s;
    this.tell();
  }

  private send(m: ToWorker) {
    this.worker.postMessage(m);
  }

  private tell() {
    this.send({ kind: 'play', playing: this.playing, pace: this._pace, speed: this._speed });
  }

  /** Begin again, from the initial state, with whatever the system now is. */
  reset(setup: WorldSetup) {
    clearTimeout(this.showTimer);
    this.view.setSignature(setup.sig);
    this.frames = [];
    this.at = 0;
    this.resting = false;
    this.send({ kind: 'setup', gen: ++this.generation, types: setup.sig.toJSON(), initial: setup.initial, rules: setup.rules, seed: setup.seed, problems: setup.problems });
    this.tell();
    if (!setup.initial) {
      this.view.show([], undefined, { stable: true });
      this.problems = setup.problems;
      this.status();
    }
  }

  setPlaying(p: boolean) {
    this.playing = p;
    this.tell();
  }

  /** One reaction (from the frame shown). */
  advance(_manual = true) {
    this.send({ kind: 'step' });
  }

  /** Show frame `i`: one step forward animates the reaction; anything else goes straight there. */
  seek(i: number) {
    i = Math.max(0, Math.min(this.frames.length - 1, i));
    if (i === this.at || !this.frames.length) return;
    this.send({ kind: 'seek', i });
  }

  /** What is to be drawn at the next animation frame: however many messages came, the page draws once a frame. */
  private next: { state: Carrier; transition: Transition | null; fresh: boolean } | null = null;
  private later(state: Carrier, transition: Transition | null, fresh: boolean) {
    const first = !this.next;
    this.next = { state, transition, fresh: fresh || !!this.next?.fresh };
    if (!first) return;
    requestAnimationFrame(() => {
      const n = this.next;
      this.next = null;
      if (!n) return;
      this.draw(n.state, n.transition, n.fresh);
      this.status();
      if (this.frame) this.onFrame(this.frame, this.at, n.fresh);
    });
  }

  private draw(state: Carrier, transition: Transition | null, animate: boolean) {
    this.view.show([{ key: 'w', carrier: state, offset: new THREE.Vector3() }], animate && transition ? { slot: 'w', t: transition } : undefined, { stable: true });
    if (!animate && transition) for (const id of [...transition.kept, ...transition.created]) this.view.highlight('w', [id]);
  }

  private receive(m: FromWorker) {
    if (m.gen !== this.generation) return;
    switch (m.kind) {
      case 'frames': {
        this.problems = m.problems;
        this.resting = false;
        this.frames.length = m.base + 1;
        for (const r of m.metas) this.frames.push({ transition: r.rule ? { rule: r.rule } : null, t: r.t, live: r.live, counts: new Map(r.counts) });
        this.at = m.at;
        clearTimeout(this.showTimer);
        const one = m.fresh && m.metas.length === 1 && m.transition;
        if (one && this._pace === 'steps') {
          // by steps: light up what the reaction meets, then rewrite
          this.view.highlight('w', m.transition!.occurrence.nodes.map(([, id]) => id));
          const lead = Math.min(450, 380 / Math.max(0.5, this._speed / 1.2));
          this.showTimer = window.setTimeout(() => this.draw(m.state, m.transition, true), lead);
          this.status();
          if (this.frame) this.onFrame(this.frame, this.at, m.fresh);
        } else this.later(m.state, m.transition, m.fresh);
        break;
      }
      case 'seeked': {
        const forward = m.at === this.at + 1;
        this.at = m.at;
        clearTimeout(this.showTimer);
        this.draw(m.state, m.transition, forward);
        this.status();
        if (this.frame) this.onFrame(this.frame, this.at, false);
        break;
      }
      case 'rest':
        this.problems = m.problems;
        this.resting = true;
        if (this.frame) this.frame.live = 0;
        this.status();
        break;
    }
  }

  private status() {
    const f = this.frame;
    this.onStatus({
      steps: this.at,
      t: f?.t ?? 0,
      live: f?.live ?? 0,
      resting: !!f && (this.resting || f.live === 0) && this.at === this.frames.length - 1,
      problems: this.problems,
      scrubbing: this.at < this.frames.length - 1,
    });
  }
}
