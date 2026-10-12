/**
 * A 3-D view of carriers: places nest, links join ports, and reactions animate.
 *
 * Layout is physics, run every frame: each body lives in its parent's frame; siblings push apart, a parent holds
 * its children inside it and grows to fit them, linked bodies pull together. So a reaction needs no choreography:
 * a node moved keeps its world position and drifts into its new parent, a fresh one grows in where the node it
 * replaces stood, a removed one shrinks away, a copy spawns from its original.
 *
 * One view shows one or more carriers side by side ("slots": the world, or a rule's redex and reactum), each
 * body keyed `slot:id`. Sites are drawn as dashed holes, outer names as labelled anchors.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { type Carrier, type Handle, type Id, Index, type Scalar, isAttr, memberScalar } from '../engine/carrier';
import type { Signature } from '../engine/signature';
import type { Transition } from '../engine/react';
import { type Visual, geometry, visualOf } from './style';

export interface Slot {
  key: string;
  carrier: Carrier;
  /** Where its regions are centred. */
  offset: THREE.Vector3;
  title?: string;
}

type Kind = 'node' | 'site' | 'region' | 'name';

interface Body {
  key: string;
  kind: Kind;
  parent: string | null;
  local: THREE.Vector3;
  vel: THREE.Vector3;
  world: THREE.Vector3;
  r: number;
  rTarget: number;
  grow: number; // 0..1, the fade in and out
  dying: boolean;
  visual?: Visual;
  group: THREE.Group;
  mesh?: THREE.Mesh;
  shell?: THREE.LineSegments;
  label?: CSS2DObject;
  labelText: string;
  flash: number;
  ports: { key: string; dir: THREE.Vector3; handle: string }[];
  container: boolean;
  /** Regions are pinned where their slot puts them. */
  pin?: THREE.Vector3;
}

const PORT_DIRS = (() => {
  const out: THREE.Vector3[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const rr = Math.sqrt(1 - y * y);
    const th = i * Math.PI * (3 - Math.sqrt(5));
    out.push(new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr));
  }
  return out;
})();

const LEAF = 0.9;
const FREE = new THREE.Color(0x56607a);
const BOUND = new THREE.Color(0x7ff6ff);
const GAP = 0.35;

export class BigraphView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly controls: OrbitControls;
  private bodies = new Map<string, Body>();
  private links: THREE.LineSegments;
  private linkGeo = new THREE.BufferGeometry();
  private portMeshes: THREE.InstancedMesh;
  private edges: { slot: string; points: string[]; key: string; free: boolean; name: boolean }[] = [];
  private slots: Slot[] = [];
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private observer: ResizeObserver;
  /** Seconds the layout keeps settling at full strength after a change. */
  private heat = 3;
  autoRotate = true;
  /** Keep everything in view, until whoever is looking takes the camera. */
  private autoFrame = true;

  constructor(
    readonly host: HTMLElement,
    private sig: Signature,
  ) {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(0, 6, 30);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    host.appendChild(this.labels.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.addEventListener('start', () => (this.autoFrame = false));

    this.scene.fog = new THREE.FogExp2(0x05070d, 0.006);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a1030, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(10, 20, 14);
    this.scene.add(key);
    this.scene.add(this.stars());

    this.links = new THREE.LineSegments(
      this.linkGeo,
      new THREE.LineBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.85 }),
    );
    this.links.frustumCulled = false;
    this.scene.add(this.links);
    this.portMeshes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      2048,
    );
    this.portMeshes.frustumCulled = false;
    this.scene.add(this.portMeshes);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.loop();
  }

  setSignature(sig: Signature) {
    this.sig = sig;
    for (const b of this.bodies.values()) b.visual = undefined;
  }

  private stars() {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(400 + Math.random() * 500);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8899bb, size: 1.2, sizeAttenuation: false }));
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  /** Show these carriers; bodies are matched by key, so what persists animates rather than jumps. */
  show(slots: Slot[], transition?: { slot: string; t: Transition }) {
    this.slots = slots;
    this.heat = 3;
    const seen = new Set<string>();
    const spawnAt = new Map<string, THREE.Vector3>();
    if (transition) {
      const k = (id: Id) => `${transition.slot}:n${id}`;
      for (const [orig, copy] of transition.t.copied) {
        const b = this.bodies.get(k(orig));
        if (b) spawnAt.set(k(copy), b.world.clone());
      }
      // a fresh node appears where a removed one of the same place stood (ERK becomes pERK in place)
      const removedBy = new Map<string, Body[]>();
      for (const id of transition.t.removed) {
        const b = this.bodies.get(k(id));
        if (b) (removedBy.get(b.parent ?? '') ?? removedBy.set(b.parent ?? '', []).get(b.parent ?? '')!).push(b);
      }
      const slot = slots.find((s) => s.key === transition.slot);
      if (slot) {
        const ix = new Index(slot.carrier);
        for (const id of transition.t.created) {
          const n = ix.node.get(id);
          if (!n) continue;
          const pk = this.parentKey(slot, n.parent);
          const pool = removedBy.get(pk);
          const b = pool?.shift();
          if (b) spawnAt.set(k(id), b.world.clone());
        }
      }
      for (const id of [...transition.t.kept, ...transition.t.created]) this.flashKey(k(id), 1);
    }

    for (const slot of slots) this.place(slot, seen, spawnAt);
    for (const [key, b] of this.bodies) if (!seen.has(key) && !b.dying) this.kill(b);
    this.rebuildEdges();
  }

  /** Light up what a rule is about to rewrite. */
  highlight(slot: string, ids: Id[]) {
    for (const id of ids) this.flashKey(`${slot}:n${id}`, 1.6);
  }

  private flashKey(key: string, v: number) {
    const b = this.bodies.get(key);
    if (b) b.flash = Math.max(b.flash, v);
  }

  private parentKey(slot: Slot, p: { node: Id } | { region: number }) {
    return 'node' in p ? `${slot.key}:n${p.node}` : `${slot.key}:r${p.region}`;
  }

  private place(slot: Slot, seen: Set<string>, spawnAt: Map<string, THREE.Vector3>) {
    const g = slot.carrier;
    const ix = new Index(g);
    const regions = Math.max(1, g.outer.places.length);
    g.outer.places.forEach((_, r) => {
      const key = `${slot.key}:r${r}`;
      seen.add(key);
      const pin = slot.offset.clone().add(new THREE.Vector3((r - (regions - 1) / 2) * 16, 0, 0));
      const b = this.bodies.get(key) ?? this.make(key, 'region', null, pin);
      b.pin = pin;
      b.labelText = r === 0 && slot.title ? slot.title : '';
      this.setLabel(b, b.labelText, 'region');
    });

    for (const n of g.nodes) {
      if (typeof n.payload === 'object') continue; // a scalar is shown on its holder's label
      const key = `${slot.key}:n${n.id}`;
      seen.add(key);
      const parent = this.parentKey(slot, n.parent);
      let b = this.bodies.get(key);
      if (!b) {
        const p = this.bodies.get(parent);
        const at = spawnAt.get(key) ?? (p ? p.world.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(p.r * 0.3)) : slot.offset.clone());
        b = this.make(key, 'node', parent, at);
      } else if (b.parent !== parent) {
        b.parent = parent; // keeps its world position: drifts into its new place
        const p = this.bodies.get(parent);
        if (p) b.local.copy(b.world).sub(p.world);
      }
      b.dying = false;
      const attrs = new Map<string, Scalar>();
      const words: string[] = [];
      for (const c of ix.children({ node: n.id })) {
        if (!isAttr(c.member) || typeof c.payload !== 'object') continue;
        const k = memberScalar(c.member);
        if (k && 'text' in k) attrs.set(k.text, c.payload.scalar);
        const v = c.payload.scalar;
        words.push('text' in v ? v.text : 'float' in v ? v.float.toFixed(2) : `${'int' in v ? v.int : v.bool}`);
      }
      const held = ix.children({ node: n.id }).some((c) => !isAttr(c.member));
      const vis = visualOf(this.sig, n.type, attrs);
      const container = vis.container ?? (held || b.container || this.sig.get(n.type).ports.length === 0 && held);
      this.dress(b, vis, container);
      const k = memberScalar(n.member);
      const keyWord = k && 'text' in k ? `${k.text}: ` : '';
      this.setLabel(b, `${keyWord}${this.sig.name(n.type)}${words.length ? ` <i>${words.join(' ')}</i>` : ''}`, container ? 'place' : 'node');
      b.ports = n.ports.flatMap((grp, gi) =>
        grp.points.map(([pt], pi) => ({
          key: `${JSON.stringify(grp.key)}/${JSON.stringify(pt)}`,
          dir: PORT_DIRS[(gi * 3 + pi) % PORT_DIRS.length],
          handle: this.handleKey(slot, grp.points[pi][1].target),
        })),
      );
    }

    g.sites.forEach((s, i) => {
      const key = `${slot.key}:s${i}`;
      seen.add(key);
      const parent = this.parentKey(slot, s);
      const p = this.bodies.get(parent);
      const b = this.bodies.get(key) ?? this.make(key, 'site', parent, p ? p.world.clone() : slot.offset.clone());
      b.parent = parent;
      this.dressSite(b);
      const sk = memberScalar(g.siteKeys[i] ?? { held: null });
      this.setLabel(b, `${sk ? `${'text' in sk ? sk.text : JSON.stringify(sk)} = ` : ''}?${i}`, 'site');
    });

    g.outer.names.forEach(([x], i) => {
      const key = `${slot.key}:x${x}`;
      seen.add(key);
      const at = slot.offset.clone().add(new THREE.Vector3((i - (g.outer.names.length - 1) / 2) * 3, 9, 0));
      const b = this.bodies.get(key) ?? this.make(key, 'name', null, at);
      b.pin = at;
      this.setLabel(b, `~${x}`, 'name');
    });
  }

  private handleKey(slot: Slot, h: Handle) {
    return 'edge' in h ? `${slot.key}:e${h.edge}` : 'name' in h ? `${slot.key}:x${h.name}` : `${slot.key}:b${h.binder}`;
  }

  private make(key: string, kind: Kind, parent: string | null, at: THREE.Vector3): Body {
    const p = parent ? this.bodies.get(parent) : undefined;
    const b: Body = {
      key,
      kind,
      parent,
      local: p ? at.clone().sub(p.world) : at.clone(),
      vel: new THREE.Vector3(),
      world: at.clone(),
      r: kind === 'region' ? 4 : 0.3,
      rTarget: LEAF,
      grow: 0,
      dying: false,
      group: new THREE.Group(),
      labelText: '',
      flash: 0,
      ports: [],
      container: false,
    };
    b.group.position.copy(at);
    this.scene.add(b.group);
    this.bodies.set(key, b);
    return b;
  }

  private dress(b: Body, vis: Visual, container: boolean) {
    const same = b.visual && b.visual.shape === vis.shape && b.visual.color.equals(vis.color) && b.container === container;
    b.visual = vis;
    b.container = container;
    if (same && b.mesh) return;
    if (b.mesh) b.group.remove(b.mesh);
    if (b.shell) b.group.remove(b.shell);
    const geo = geometry(container ? 'sphere' : vis.shape);
    const mat = new THREE.MeshStandardMaterial({
      color: vis.color,
      emissive: vis.color,
      emissiveIntensity: container ? 0.05 : 0.22,
      roughness: 0.35,
      metalness: 0.15,
      transparent: true,
      opacity: container ? 0.1 : 0.95,
      depthWrite: !container,
      side: container ? THREE.BackSide : THREE.FrontSide,
    });
    b.mesh = new THREE.Mesh(geo, mat);
    b.mesh.userData.key = b.key;
    b.group.add(b.mesh);
    if (container) {
      b.shell = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 2)),
        new THREE.LineBasicMaterial({ color: vis.color, transparent: true, opacity: 0.28 }),
      );
      b.group.add(b.shell);
    }
  }

  private dressSite(b: Body) {
    if (b.mesh) return;
    b.rTarget = 1.1;
    b.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    b.group.add(b.mesh);
    const dash = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)),
      new THREE.LineDashedMaterial({ color: 0xffd36e, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.8 }),
    );
    dash.computeLineDistances();
    b.shell = dash;
    b.group.add(dash);
  }

  private setLabel(b: Body, html: string, cls: string) {
    if (!html) {
      if (b.label) b.group.remove(b.label), (b.label = undefined);
      return;
    }
    if (!b.label) {
      const el = document.createElement('div');
      b.label = new CSS2DObject(el);
      b.group.add(b.label);
    }
    b.label.element.className = `label ${cls}`;
    if (b.label.element.innerHTML !== html) b.label.element.innerHTML = html;
  }

  private kill(b: Body) {
    b.dying = true;
    // its children die with it, from where they stand
    for (const c of this.bodies.values()) if (c.parent === b.key && !c.dying) this.kill(c);
  }

  private rebuildEdges() {
    this.edges = [];
    for (const slot of this.slots) {
      const g = slot.carrier;
      const on = new Map<string, string[]>();
      for (const b of this.bodies.values()) {
        if (!b.key.startsWith(`${slot.key}:`) || b.dying) continue;
        for (const p of b.ports) (on.get(p.handle) ?? on.set(p.handle, []).get(p.handle)!).push(`${b.key}|${p.key}`);
      }
      for (const [h, points] of on) {
        const isName = h.includes(':x');
        if (isName) points.push(`${h}|anchor`);
        this.edges.push({ slot: slot.key, points, key: h, free: points.length < 2, name: isName });
      }
      void g;
    }
  }

  private portWorld(ref: string, out: THREE.Vector3): boolean {
    const [key, port] = ref.split('|');
    const b = this.bodies.get(key);
    if (!b) return false;
    if (port === 'anchor') return out.copy(b.world), true;
    const p = b.ports.find((x) => x.key === port);
    if (!p) return false;
    out.copy(p.dir).multiplyScalar(b.r * b.grow * (b.container ? 1 : 0.95)).add(b.world);
    return true;
  }

  /** Keep everything in view again (as it grows and settles). */
  frame() {
    this.autoFrame = true;
  }

  private follow(dt: number) {
    const box = new THREE.Box3();
    for (const b of this.bodies.values())
      if (!b.dying && b.kind !== 'region') box.expandByPoint(b.world.clone().addScalar(b.r * b.grow)).expandByPoint(b.world.clone().subScalar(b.r * b.grow));
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const want = Math.max(8, (sphere.radius * 1.15) / Math.sin(fit / 2));
    const k = Math.min(1, dt * 2.5);
    this.controls.target.lerp(sphere.center, k);
    const dir = this.camera.position.clone().sub(this.controls.target);
    const dist = dir.length() || 1;
    dir.multiplyScalar((dist + (want - dist) * k) / dist);
    this.camera.position.copy(this.controls.target).add(dir);
  }

  // ── the loop ─────────────────────────────────────────────────────────────────────────────────────────────

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.simulate(dt);
    if (this.autoFrame) this.follow(dt);
    this.controls.autoRotate = this.autoRotate;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  private simulate(dt: number) {
    this.heat = Math.max(0.35, this.heat - dt);
    const kids = new Map<string, Body[]>();
    for (const b of this.bodies.values()) if (b.parent && !b.dying) (kids.get(b.parent) ?? kids.set(b.parent, []).get(b.parent)!).push(b);

    // radii, from the leaves up
    const radius = (b: Body): number => {
      const cs = kids.get(b.key) ?? [];
      const base = b.kind === 'site' ? 1.1 : b.kind === 'name' ? 0.25 : LEAF * (b.visual?.size ?? 1);
      if (b.kind === 'region') {
        for (const c of cs) radius(c);
        b.rTarget = 1;
        return b.rTarget;
      }
      if (!cs.length) b.rTarget = b.container ? Math.max(base * 1.6, 1.6) : base;
      else {
        const vol = cs.reduce((a, c) => a + Math.pow(radius(c) + GAP, 3), 0);
        b.rTarget = Math.max(base * 1.6, Math.cbrt(vol) * 1.18 + 0.45);
      }
      return b.rTarget;
    };
    for (const b of this.bodies.values()) if (!b.parent || !this.bodies.has(b.parent)) radius(b);

    for (const b of this.bodies.values()) {
      b.r += (b.rTarget - b.r) * Math.min(1, dt * 4);
      b.grow += ((b.dying ? 0 : 1) - b.grow) * Math.min(1, dt * (b.dying ? 5 : 3));
      b.flash = Math.max(0, b.flash - dt * 1.5);
    }

    // forces, in each parent's frame
    const k = this.heat;
    for (const [pk, cs] of kids) {
      const p = this.bodies.get(pk);
      if (!p) continue;
      const room = p.kind === 'region' ? Infinity : p.r;
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i];
        const f = new THREE.Vector3();
        // gentle pull to the centre; held inside the parent
        f.addScaledVector(a.local, -1.2);
        const d = a.local.length();
        const over = d + a.r - (room - 0.25);
        if (over > 0 && d > 1e-6) f.addScaledVector(a.local, (-over * 30) / d);
        for (let j = 0; j < cs.length; j++) {
          if (i === j) continue;
          const b = cs[j];
          const v = a.local.clone().sub(b.local);
          let dist = v.length();
          if (dist < 1e-4) v.randomDirection(), (dist = 1e-4);
          const want = a.r + b.r + GAP;
          if (dist < want) f.addScaledVector(v, ((want - dist) * 40) / dist);
          else f.addScaledVector(v, 0.8 / (dist * dist));
        }
        a.vel.addScaledVector(f, dt * k);
      }
    }
    // links pull their ends together, a little
    const pa = new THREE.Vector3();
    for (const e of this.edges) {
      if (e.free || e.points.length < 2) continue;
      const ends = e.points.map((ref) => this.bodies.get(ref.split('|')[0])).filter((b): b is Body => !!b && b.kind === 'node');
      for (let i = 0; i + 1 < ends.length; i++) {
        const a = ends[i], b = ends[i + 1];
        if (a.parent !== b.parent) continue;
        pa.copy(b.world).sub(a.world);
        const dist = pa.length(), want = a.r + b.r + 0.8;
        if (dist > want) {
          pa.multiplyScalar(((dist - want) * 2.5 * dt * k) / dist);
          a.vel.add(pa);
          b.vel.sub(pa);
        }
      }
    }

    // integrate, then place in the world, parents first
    for (const b of this.bodies.values()) {
      b.vel.multiplyScalar(Math.pow(0.04, dt));
      b.local.addScaledVector(b.vel, dt);
    }
    const placed = new Set<string>();
    const put = (b: Body) => {
      if (placed.has(b.key)) return;
      placed.add(b.key);
      if (b.pin) {
        b.local.copy(b.pin);
        b.world.copy(b.pin);
      } else {
        const p = b.parent ? this.bodies.get(b.parent) : undefined;
        if (p) put(p), b.world.copy(p.world).add(b.local);
        else b.world.copy(b.local);
      }
      b.group.position.copy(b.world);
      const s = Math.max(1e-3, b.r * b.grow);
      if (b.mesh) b.mesh.scale.setScalar(s);
      if (b.shell) b.shell.scale.setScalar(s * 1.002);
      if (b.mesh) {
        b.mesh.rotation.y += dt * 0.25;
        const m = b.mesh.material as THREE.MeshStandardMaterial;
        if ('emissiveIntensity' in m) m.emissiveIntensity = (b.container ? 0.05 : 0.22) + b.flash * 1.4;
      }
      if (b.label && b.kind === 'region') {
        let low = 0;
        for (const c of kids.get(b.key) ?? []) low = Math.min(low, c.local.y - c.r);
        b.label.position.set(0, low - 1.2, 0);
      } else if (b.label) {
        b.label.position.set(0, b.container ? s * 1.02 : s + 0.5, 0);
        b.label.element.style.opacity = `${b.grow}`;
      }
    };
    for (const b of this.bodies.values()) put(b);

    // the dead, once faded, go
    for (const [key, b] of this.bodies)
      if (b.dying && b.grow < 0.02) {
        this.scene.remove(b.group);
        b.label?.element.remove();
        this.bodies.delete(key);
      }

    this.drawLinks();
  }

  private drawLinks() {
    const pos: number[] = [];
    let ports = 0;
    const m = new THREE.Matrix4();
    const a = new THREE.Vector3(), c = new THREE.Vector3();
    for (const e of this.edges) {
      const pts: THREE.Vector3[] = [];
      for (const ref of e.points) if (this.portWorld(ref, a)) pts.push(a.clone());
      for (const ref of e.points) {
        if (ref.endsWith('|anchor') || ports >= 2048) continue;
        if (this.portWorld(ref, a)) {
          this.portMeshes.setColorAt(ports, e.free ? FREE : BOUND);
          this.portMeshes.setMatrixAt(ports++, m.makeTranslation(a.x, a.y, a.z));
        }
      }
      if (pts.length < 2) continue;
      if (pts.length === 2) pos.push(...pts[0].toArray(), ...pts[1].toArray());
      else {
        c.set(0, 0, 0);
        for (const p of pts) c.add(p);
        c.divideScalar(pts.length);
        for (const p of pts) pos.push(...p.toArray(), ...c.toArray());
      }
    }
    this.portMeshes.count = ports;
    this.portMeshes.instanceMatrix.needsUpdate = true;
    if (this.portMeshes.instanceColor) this.portMeshes.instanceColor.needsUpdate = true;
    this.linkGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.linkGeo.computeBoundingSphere();
  }

  /** The node key under a screen point, if any. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const meshes = [...this.bodies.values()].filter((b) => b.mesh && !b.dying).map((b) => b.mesh!);
    const hit = ray.intersectObjects(meshes, false).find((h) => !(h.object as THREE.Mesh).userData.container);
    return hit ? (hit.object.userData.key as string) : null;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
