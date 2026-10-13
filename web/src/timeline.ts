/**
 * The timeline: every reaction the world has taken, one mark each in the colour of its rule, and above them how
 * many of each type there were. Click or drag anywhere on it to go to that moment.
 */

import type { Signature } from './engine';
import type { Frame } from './world';

export const ruleColor = (name: string): string => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return `hsl(${(h >>> 0) % 360} 70% 62%)`;
};

export class Timeline {
  private canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private frames: Frame[] = [];
  private at = 0;
  private sig: Signature | null = null;
  private typeColor: (type: number) => string = () => '#888';
  /** Along steps, or along simulated time. */
  axis: 'steps' | 'time' = 'steps';
  onSeek: (i: number) => void = () => {};
  private hover: number | null = null;

  constructor(readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.tip = document.createElement('div');
    this.tip.className = 'timeline-tip';
    host.append(this.canvas, this.tip);
    let dragging = false;
    const seekAt = (e: PointerEvent) => this.onSeek(this.indexAt(e.clientX));
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      seekAt(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      this.hover = this.indexAt(e.clientX);
      if (dragging) seekAt(e);
      this.draw();
    });
    this.canvas.addEventListener('pointerup', () => (dragging = false));
    this.canvas.addEventListener('pointerleave', () => ((this.hover = null), this.draw()));
    new ResizeObserver(() => this.draw()).observe(host);
  }

  set(frames: Frame[], at: number, sig: Signature, typeColor: (type: number) => string) {
    this.frames = frames;
    this.at = at;
    this.sig = sig;
    this.typeColor = typeColor;
    this.draw();
  }

  /** Where along the axis frame `i` is, 0..1. */
  private along(i: number): number {
    const n = this.frames.length;
    if (this.axis === 'time') {
      const end = this.frames[n - 1]?.t || 1;
      return this.frames[i].t / end;
    }
    return i / Math.max(1, n - 1);
  }

  private indexAt(clientX: number) {
    const r = this.canvas.getBoundingClientRect();
    const n = this.frames.length;
    const f = (clientX - r.left - 8) / Math.max(1, r.width - 16);
    if (this.axis === 'time') {
      // the last frame at or before that moment
      const t = f * (this.frames[n - 1]?.t ?? 0);
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.frames[mid].t <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
    return Math.max(0, Math.min(n - 1, Math.round(f * Math.max(1, n - 1))));
  }

  private draw() {
    const c = this.canvas;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio, 2);
    if (c.width !== w * dpr || c.height !== h * dpr) (c.width = w * dpr), (c.height = h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const n = this.frames.length;
    if (!n || !this.sig) return;
    const L = 8, R = w - 8, strip = 10, top = 6, bottom = h - strip - 6;
    const x = (i: number) => L + (R - L) * this.along(i);

    // how many of each type, over the steps
    const types = new Set<number>();
    let max = 1;
    for (const f of this.frames) for (const [t, k] of f.counts) types.add(t), (max = Math.max(max, k));
    g.lineWidth = 1.5;
    for (const t of types) {
      // lightened toward white, so a dark type still reads on the dark strip
      g.strokeStyle = `color-mix(in srgb, ${this.typeColor(t)} 70%, white)`;
      g.globalAlpha = 0.9;
      g.beginPath();
      // at most two points a pixel: a long history is sampled, not drawn whole
      const stride = Math.max(1, Math.floor(n / (2 * (R - L))));
      let lastY = 0;
      for (let i = 0; i < n; i += stride) {
        const y = bottom - ((bottom - top) * (this.frames[i].counts.get(t) ?? 0)) / max;
        if (i === 0) g.moveTo(x(i), y);
        else {
          if (this.axis === 'time') g.lineTo(x(i), lastY); // it held until now
          g.lineTo(x(i), y);
        }
        lastY = y;
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // each reaction, a mark in its rule's colour
    const bw = this.axis === 'time' ? 1.5 : Math.max(1, (R - L) / Math.max(1, n - 1) - 1);
    const markStride = Math.max(1, Math.floor(n / (R - L)));
    for (let i = 1; i < n; i += markStride) {
      const tr = this.frames[i].transition;
      if (!tr) continue;
      g.fillStyle = ruleColor(tr.rule);
      g.globalAlpha = i > this.at ? 0.35 : 0.95;
      g.fillRect(x(i) - bw / 2, h - strip - 2, bw, strip);
    }
    g.globalAlpha = 1;

    // where we are
    g.strokeStyle = '#ffd36e';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x(this.at), 2);
    g.lineTo(x(this.at), h - 2);
    g.stroke();

    const i = this.hover;
    const sig = this.sig;
    if (i !== null && i < n) {
      const f = this.frames[i];
      const counts = [...f.counts]
        .filter(([t]) => types.has(t))
        .map(([t, k]) => `<span style="color:${this.typeColor(t)}">${sig.name(t)} ${k}</span>`)
        .join(' ');
      this.tip.innerHTML = `<b>#${i}</b> ${f.transition ? `<i style="color:${ruleColor(f.transition.rule)}">${f.transition.rule}</i>` : 'start'} · t ${f.t.toFixed(2)}<br>${counts}`;
      this.tip.style.left = `${Math.min(w - 220, Math.max(0, x(i) - 60))}px`;
      this.tip.style.display = 'block';
    } else this.tip.style.display = 'none';
  }
}
