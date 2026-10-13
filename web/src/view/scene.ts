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
  /** Outer names as written; a name beginning `_` is a port left unwritten (any link), drawn as such. */
  names?: Map<Id, string>;
  /** Sites drawn faintly and unlabelled (an attribute left unwritten). */
  quietSites?: Set<number>;
  /** Sites as written. */
  siteNames?: string[];
  /** Values computed when a rule fires, as written (shown in place of a value). */
  formulas?: Map<Id, string>;
  /** Shown beneath the title (a rule's guard). */
  subtitle?: string;
  /** Nodes drawn as a ghost (what an unless repeats of the redex) or as forbidden (what it adds). */
  tint?: Map<Id, 'ghost' | 'forbid'>;
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
  /** What the breadcrumbs call it. */
  name: string;
  flash: number;
  ports: { key: string; dir: THREE.Vector3; handle: string }[];
  container: boolean;
  tint?: 'ghost' | 'forbid';
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
/** A port a redex leaves unwritten: any link at all. */
const ANY = new THREE.Color(0xffd36e);
/** What an unless adds: if this is there, the rule does not fire. */
const FORBID = new THREE.Color(0xff3d6a);
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
  /** Ports are rings on a body's surface, facing out; a link comes in through the middle. */
  private portMeshes: THREE.InstancedMesh;
  private portCores: THREE.InstancedMesh;
  /** A hyperedge's meeting point: where its spokes join. */
  private hubs: THREE.InstancedMesh;
  private edges: { slot: string; points: string[]; key: string; free: boolean; name: boolean; any: boolean }[] = [];
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
  /** The place we are inside, if any: its contents fill the view, everything outside fades. */
  private focus: string | null = null;
  private crumbs: HTMLElement;
  private title: HTMLElement;
  /** Whether a tap on a body focuses it (the world), rather than leaving taps to an editor. */
  tapFocus = false;
  /** A tap: on a body, or on nothing. */
  onTap: (key: string | null, e: PointerEvent) => void = () => {};
  /** How visible each body is this frame (1 inside the focus, less outside). */
  private seenBy = new Map<string, number>();

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
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
    );
    this.links.frustumCulled = false;
    this.scene.add(this.links);
    this.portMeshes = new THREE.InstancedMesh(new THREE.TorusGeometry(0.2, 0.05, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffffff }), 2048);
    this.portCores = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 2048);
    this.hubs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }), 512);
    for (const im of [this.portMeshes, this.portCores, this.hubs]) {
      im.frustumCulled = false;
      im.count = 0;
      this.scene.add(im);
    }

    this.crumbs = document.createElement('nav');
    this.crumbs.className = 'crumbs';
    host.appendChild(this.crumbs);
    this.crumbs.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (k !== undefined) this.setFocus(k || null);
    });
    this.title = document.createElement('div');
    this.title.className = 'view-title';
    host.appendChild(this.title);
    // double-click a place to go inside it; double-click outside everything to come back out
    this.renderer.domElement.addEventListener('dblclick', (e) => {
      if (this.tapFocus) return;
      const key = this.pick(e.clientX, e.clientY);
      const b = key ? this.bodies.get(key) : undefined;
      if (!b) return this.up();
      if (b.container && b.key !== this.focus) this.setFocus(b.key);
      else if (b.parent && this.bodies.get(b.parent)?.kind === 'node' && b.parent !== this.focus) this.setFocus(b.parent);
    });
    // a tap (a click that is not a drag): focus what it hits, where taps focus; and tell whoever listens
    let press: { x: number; y: number } | null = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => (press = { x: e.clientX, y: e.clientY }));
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return (press = null);
      press = null;
      const key = this.pick(e.clientX, e.clientY);
      const b = key ? this.bodies.get(key) : undefined;
      if (this.tapFocus && b?.kind === 'node') this.setFocus(b.key);
      this.onTap(b ? b.key : null, e);
    });
    this.renderCrumbs();

    this.dragLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd36e }));
    this.dragLine.frustumCulled = false;
    this.scene.add(this.dragLine);
    const pairLines = new THREE.LineSegments(this.pairGeo, new THREE.LineDashedMaterial({ color: 0xffd36e, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.55 }));
    pairLines.frustumCulled = false;
    this.scene.add(pairLines);
    this.pairLines = pairLines;

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
  show(slots: Slot[], transition?: { slot: string; t: Transition }, opts: { stable?: boolean } = {}) {
    // a slot rebuilt from an edit has new identities for the same things: carry the bodies over
    if (!opts.stable)
      for (const slot of slots) {
        const prev = this.slots.find((x) => x.key === slot.key)?.carrier;
        if (prev && prev !== slot.carrier && transition?.slot !== slot.key) this.carryOver(slot.key, reconcile(prev, slot.carrier));
      }
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
    // the place we are in went away: stand in what held it
    while (this.focus && (!this.bodies.has(this.focus) || this.bodies.get(this.focus)!.dying)) {
      const p = this.bodies.get(this.focus)?.parent ?? null;
      this.focus = p && this.bodies.get(p)?.kind === 'node' ? p : null;
    }
    this.renderCrumbs();
    this.rebuildEdges();
  }

  /** Rename bodies `slot:n<old>` to `slot:n<new>`. */
  private carryOver(slot: string, map: Map<Id, Id>) {
    const rename = new Map<string, string>();
    for (const [nw, old] of map) rename.set(`${slot}:n${old}`, `${slot}:n${nw}`);
    const moving: Body[] = [];
    for (const [k, b] of this.bodies) if (k.startsWith(`${slot}:n`) && !b.dying) moving.push(b), this.bodies.delete(k);
    for (const b of moving) {
      const nk = rename.get(b.key);
      if (!nk) {
        // nothing it became: let it go
        b.key = `${b.key}~gone${Math.random()}`;
        this.bodies.set(b.key, b);
        this.kill(b);
        continue;
      }
      b.key = nk;
      if (b.mesh) b.mesh.userData.key = nk;
      this.bodies.set(nk, b);
    }
    for (const b of this.bodies.values()) if (b.parent && rename.has(b.parent)) b.parent = rename.get(b.parent)!;
    if (this.focus && rename.has(this.focus)) this.focus = rename.get(this.focus)!;
    for (const [k, v] of [...this.marks]) if (rename.has(k)) this.marks.delete(k), this.marks.set(rename.get(k)!, v);
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
      b.labelText = r === 0 && slot.title ? `${slot.title}${slot.subtitle ? `<br><small>${slot.subtitle.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</small>` : ''}` : '';
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
        const f = slot.formulas?.get(c.id);
        // a value not computed yet does not size or colour its node
        if (k && 'text' in k && !f) attrs.set(k.text, c.payload.scalar);
        const v = c.payload.scalar;
        if (f) {
          words.push(`${k && 'text' in k ? `${k.text} = ` : ''}${f}`);
          continue;
        }
        words.push('text' in v ? v.text : 'float' in v ? v.float.toFixed(2) : `${'int' in v ? v.int : v.bool}`);
      }
      const held = ix.children({ node: n.id }).some((c) => !isAttr(c.member));
      const vis = visualOf(this.sig, n.type, attrs);
      b.tint = slot.tint?.get(n.id);
      if (b.tint === 'forbid') vis.color.lerp(FORBID, 0.7);
      const container = vis.container ?? (held || b.container || this.sig.get(n.type).ports.length === 0 && held);
      this.dress(b, vis, container);
      const k = memberScalar(n.member);
      const keyWord = k && 'text' in k ? `${k.text}: ` : '';
      b.name = `${keyWord}${this.sig.name(n.type)}${words.length ? ` ${words.join(' ')}` : ''}`;
      this.setLabel(b, `${b.tint === 'forbid' ? '⊘ ' : ''}${keyWord}${this.sig.name(n.type)}${words.length ? ` <i>${words.join(' ')}</i>` : ''}`, container ? 'place' : 'node');
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
      if (slot.quietSites?.has(i)) {
        b.rTarget = 0.01;
        this.setLabel(b, '', 'site');
        if (b.mesh) b.mesh.visible = false;
        if (b.shell) b.shell.visible = false;
      } else this.setLabel(b, `${sk ? `${'text' in sk ? sk.text : JSON.stringify(sk)} = ` : ''}?${slot.siteNames?.[i] ?? i}`, 'site');
    });

    const shown = g.outer.names.filter(([x]) => !(slot.names?.get(x) ?? '').startsWith('_'));
    shown.forEach(([x], i) => {
      const key = `${slot.key}:x${x}`;
      seen.add(key);
      const at = slot.offset.clone().add(new THREE.Vector3((i - (shown.length - 1) / 2) * 3, 9, 0));
      const b = this.bodies.get(key) ?? this.make(key, 'name', null, at);
      b.pin = at;
      this.setLabel(b, `~${slot.names?.get(x) ?? x}`, 'name');
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
      name: '',
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
    const same = b.visual && b.visual.shape === vis.shape && b.visual.shaped === vis.shaped && b.visual.color.equals(vis.color) && b.container === container;
    b.visual = vis;
    b.container = container;
    if (same && b.mesh) return;
    if (b.mesh) b.group.remove(b.mesh);
    if (b.shell) b.group.remove(b.shell);
    const geo = geometry(container && !vis.shaped ? 'sphere' : vis.shape);
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
    b.mesh.userData.base = mat.opacity;
    b.group.add(b.mesh);
    if (container) {
      b.shell = new THREE.LineSegments(
        new THREE.EdgesGeometry(vis.shaped ? geo : new THREE.IcosahedronGeometry(1, 2)),
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
        const any = isName && !this.bodies.has(h);
        if (isName && !any) points.push(`${h}|anchor`);
        this.edges.push({ slot: slot.key, points, key: h, free: any || points.length < 2, name: isName, any });
      }
      void g;
    }
  }

  private portWorld(ref: string, out: THREE.Vector3, dir?: THREE.Vector3): boolean {
    const [key, port] = ref.split('|');
    const b = this.bodies.get(key);
    if (!b) return false;
    if (port === 'anchor') {
      dir?.set(0, -1, 0);
      return out.copy(b.world), true;
    }
    const p = b.ports.find((x) => x.key === port);
    if (!p) return false;
    dir?.copy(p.dir);
    // just off the surface, so the ring sits on it
    out.copy(p.dir).multiplyScalar(b.r * b.grow * (b.container ? 1 : 0.95) + 0.08 * b.grow).add(b.world);
    return true;
  }

  /** Go inside a place (null: the whole). */
  setFocus(key: string | null) {
    this.focus = key && this.bodies.has(key) ? key : null;
    this.autoFrame = true;
    this.renderCrumbs();
  }

  /** Come out one place; false if already at the top. */
  up(): boolean {
    if (!this.focus) return false;
    const p = this.bodies.get(this.focus)?.parent;
    this.setFocus(p && this.bodies.get(p)?.kind === 'node' ? p : null);
    return true;
  }

  get focused(): string | null {
    return this.focus;
  }

  private renderCrumbs() {
    const path: Body[] = [];
    for (let k = this.focus; k; ) {
      const b = this.bodies.get(k);
      if (!b || b.kind !== 'node') break;
      path.unshift(b);
      k = b.parent;
    }
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const here = path[path.length - 1];
    this.title.innerHTML = here ? `<b>${esc(here.name.split(' ')[0])}</b>${here.name.includes(' ') ? ` <span>${esc(here.name.slice(here.name.indexOf(' ') + 1))}</span>` : ''}` : '';
    this.crumbs.innerHTML = path.length
      ? `<a data-key="">⌂</a>${path.map((b, i) => `<span>›</span>${i === path.length - 1 ? `<b>${esc(b.name)}</b>` : `<a data-key="${b.key}">${esc(b.name)}</a>`}`).join('')}`
      : '';
  }

  /** Keep everything in view again (as it grows and settles). */
  frame() {
    this.autoFrame = true;
  }

  private follow(dt: number) {
    const f = this.focus ? this.bodies.get(this.focus) : undefined;
    if (f) return this.aim(new THREE.Sphere(f.world.clone(), Math.max(1, f.r * f.grow * 0.95)), dt);
    const box = new THREE.Box3();
    for (const b of this.bodies.values()) {
      if (b.dying) continue;
      // a region counts even empty: the side of a rule with nothing on it yet is still somewhere to drop
      const r = b.kind === 'region' ? 3 : b.r * b.grow;
      box.expandByPoint(b.world.clone().addScalar(r)).expandByPoint(b.world.clone().subScalar(r));
    }
    if (box.isEmpty()) return;
    this.aim(box.getBoundingSphere(new THREE.Sphere()), dt);
  }

  private aim(sphere: THREE.Sphere, dt: number) {
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
      const base = b.kind === 'site' ? (b.mesh?.visible === false ? 0.01 : 1.1) : b.kind === 'name' ? 0.25 : LEAF * (b.visual?.size ?? 1);
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
    // what is inside the focus is seen; its walls and what holds it, faintly; everything else, a ghost
    const depth = new Map<string, number>();
    const walk = (key: string, d: number) => {
      depth.set(key, d);
      for (const c of kids.get(key) ?? []) walk(c.key, d + 1);
    };
    if (this.focus) walk(this.focus, 0);
    else for (const b of this.bodies.values()) if (!b.parent) walk(b.key, b.kind === 'region' ? 0 : 1);
    const above = new Set<string>();
    for (let k = this.focus ? this.bodies.get(this.focus)?.parent : null; k; k = this.bodies.get(k)?.parent) above.add(k);
    const seen = (b: Body) => {
      const d = depth.get(b.key);
      const leaf = this.focus ? !this.bodies.get(this.focus)?.container : false;
      const v = d === undefined ? (above.has(b.key) ? 0.25 : leaf ? 0.12 : 0.05) : d === 0 && this.focus && !leaf ? 0.45 : 1;
      const t = b.tint === 'ghost' ? v * 0.28 : v;
      this.seenBy.set(b.key, t);
      return t;
    };

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
        m.opacity = (b.mesh.userData.base ?? m.opacity) * seen(b);
      }
      if (b.shell) (b.shell.material as THREE.LineBasicMaterial).opacity = (b.kind === 'site' ? 0.8 : 0.28) * seen(b);
      if (b.label && b.kind === 'region') {
        let low = 0;
        for (const c of kids.get(b.key) ?? []) low = Math.min(low, c.local.y - c.r);
        b.label.position.set(0, low - 1.2, 0);
        b.label.element.style.opacity = this.focus ? '0' : '1';
      } else if (b.label) {
        b.label.position.set(0, b.container ? s * 1.02 : s + 0.5, 0);
        // labels for the two levels below where we stand
        const d = depth.get(b.key);
        const leafFocus = d === 0 && !b.container;
        const shown = (d !== undefined && d >= 1 && d <= 2) || leafFocus ? 1 : 0;
        b.label.element.style.opacity = `${b.grow * shown}`;
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
    this.drawOverlays();
  }

  private drawOverlays() {
    for (const [k, v] of this.marks) {
      const b = this.bodies.get(k);
      if (!b?.mesh) continue;
      const m = b.mesh.material as THREE.MeshStandardMaterial;
      if ('emissiveIntensity' in m) m.emissiveIntensity += v === 2 ? 0.6 : 0.9;
      if (b.container) m.opacity = Math.max(m.opacity, v === 2 ? 0.28 : 0.2);
      if (b.shell) (b.shell.material as THREE.LineBasicMaterial).opacity = 0.9;
    }
    const a = new THREE.Vector3();
    if (this.dragFrom && this.portWorld(this.dragFrom, a)) {
      this.dragLine.geometry.setFromPoints([a, this.dragTo]);
      this.dragLine.visible = true;
    } else this.dragLine.visible = false;
    const pts: THREE.Vector3[] = [];
    for (const [x, y] of this.pairs) {
      const p = this.bodies.get(x), q = this.bodies.get(y);
      if (!p || !q || p.dying || q.dying) continue;
      // an arc, rising between them
      const mid = p.world.clone().add(q.world).multiplyScalar(0.5);
      mid.y += p.world.distanceTo(q.world) * 0.3;
      let prev = p.world;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const pt = new THREE.Vector3()
          .addScaledVector(p.world, (1 - t) * (1 - t))
          .addScaledVector(mid, 2 * t * (1 - t))
          .addScaledVector(q.world, t * t);
        pts.push(prev, pt);
        prev = pt;
      }
    }
    this.pairGeo.setFromPoints(pts);
    this.pairLines.computeLineDistances();
  }

  private drawLinks() {
    const pos: number[] = [];
    const col: number[] = [];
    const tmp = new THREE.Color();
    const seenOf = (ref: string) => this.seenBy.get(ref.split('|')[0]) ?? 1;
    let rings = 0, cores = 0, hubs = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), z = new THREE.Vector3(0, 0, 1);
    const a = new THREE.Vector3(), n = new THREE.Vector3(), hub = new THREE.Vector3();
    const curve = (p0: THREE.Vector3, c0: THREE.Vector3, c1: THREE.Vector3, p1: THREE.Vector3, rgb: number[]) => {
      let prev = p0;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        const pt = new THREE.Vector3()
          .addScaledVector(p0, u * u * u)
          .addScaledVector(c0, 3 * u * u * t)
          .addScaledVector(c1, 3 * u * t * t)
          .addScaledVector(p1, t * t * t);
        pos.push(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z);
        col.push(...rgb, ...rgb);
        prev = pt;
      }
    };
    for (const e of this.edges) {
      const ends: { p: THREE.Vector3; n: THREE.Vector3; ref: string }[] = [];
      for (const ref of e.points) if (this.portWorld(ref, a, n)) ends.push({ p: a.clone(), n: n.clone(), ref });
      const linked = !e.free && ends.length >= 2;
      for (const end of ends) {
        if (end.ref.endsWith('|anchor') || rings >= 2048) continue;
        const v = Math.max(0.08, seenOf(end.ref));
        q.setFromUnitVectors(z, end.n);
        m.compose(end.p, q, one);
        this.portMeshes.setColorAt(rings, tmp.copy(e.any ? ANY : linked ? BOUND : FREE).multiplyScalar(v));
        this.portMeshes.setMatrixAt(rings++, m);
        if (linked) {
          this.portCores.setColorAt(cores, tmp.copy(BOUND).multiplyScalar(v));
          this.portCores.setMatrixAt(cores++, m);
        }
      }
      if (!linked) continue;
      const lit = tmp.copy(BOUND).multiplyScalar(Math.max(0.06, Math.max(...e.points.map(seenOf)))).toArray();
      if (ends.length === 2) {
        // a bond: out of each ring, round, and into the other
        const [x, y] = ends;
        const k = Math.max(0.6, x.p.distanceTo(y.p) * 0.4);
        curve(x.p, x.p.clone().addScaledVector(x.n, k), y.p.clone().addScaledVector(y.n, k), y.p, lit);
      } else {
        // a hyperedge: every point to one meeting place, lifted a little off their middle
        hub.set(0, 0, 0);
        const lift = new THREE.Vector3();
        for (const end of ends) hub.add(end.p), lift.add(end.n);
        hub.divideScalar(ends.length).addScaledVector(lift.normalize(), 0.8);
        for (const end of ends) {
          const k = Math.max(0.5, end.p.distanceTo(hub) * 0.45);
          curve(end.p, end.p.clone().addScaledVector(end.n, k), hub.clone().lerp(end.p, 0.3), hub, lit);
        }
        if (hubs < 512) {
          this.hubs.setColorAt(hubs, tmp.fromArray(lit));
          this.hubs.setMatrixAt(hubs++, m.makeTranslation(hub.x, hub.y, hub.z));
        }
      }
    }
    for (const [im, count] of [[this.portMeshes, rings], [this.portCores, cores], [this.hubs, hubs]] as const) {
      im.count = count;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.linkGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.linkGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.linkGeo.computeBoundingSphere();
  }

  /** The node key under a screen point, if any. */
  private ray(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    return ray;
  }

  /** The body under a screen point (the nearest, so the innermost place), passing over those `skip` refuses. */
  pick(clientX: number, clientY: number, skip: (key: string) => boolean = () => false): string | null {
    const meshes = [...this.bodies.values()]
      .filter((b) => b.mesh && !b.dying && b.kind !== 'region' && (this.seenBy.get(b.key) ?? 1) > 0.2 && !skip(b.key))
      .map((b) => b.mesh!);
    const hit = this.ray(clientX, clientY).intersectObjects(meshes, false)[0];
    return hit ? (hit.object.userData.key as string) : null;
  }

  /** The port nearest a screen point, within `px` pixels. */
  pickPort(clientX: number, clientY: number, px = 12): { body: string; port: string } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best: { body: string; port: string } | null = null;
    let bestD = px;
    for (const b of this.bodies.values()) {
      if (b.dying || (this.seenBy.get(b.key) ?? 1) < 0.25) continue;
      for (const p of b.ports) {
        this.portWorld(`${b.key}|${p.key}`, v);
        v.project(this.camera);
        if (v.z > 1) continue;
        const d = Math.hypot(((v.x + 1) / 2) * rect.width + rect.left - clientX, ((1 - v.y) / 2) * rect.height + rect.top - clientY);
        if (d < bestD) (bestD = d), (best = { body: b.key, port: p.key });
      }
    }
    return best;
  }

  /** The slot nearest the ray under a screen point: where a drop on empty space lands. */
  slotAt(clientX: number, clientY: number): string | null {
    const ray = this.ray(clientX, clientY).ray;
    let best: string | null = null;
    let bestD = Infinity;
    for (const s of this.slots) {
      const d = ray.distanceSqToPoint(s.offset);
      if (d < bestD) (bestD = d), (best = s.key);
    }
    return best;
  }

  /** Where a body (`slot:n3`) or a port (`slot:n3|"e"/0`) is on screen, if it is. */
  screenOf(ref: string): { x: number; y: number } | null {
    const v = new THREE.Vector3();
    if (ref.includes('|')) {
      if (!this.portWorld(ref, v)) return null;
    } else {
      const b = this.bodies.get(ref);
      if (!b) return null;
      v.copy(b.world);
    }
    v.project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width + r.left, y: ((1 - v.y) / 2) * r.height + r.top };
  }

  /** Body keys, and their ports, for whoever drives the view from outside (tests). */
  inventory(): { key: string; name: string; ports: string[] }[] {
    return [...this.bodies.values()].filter((b) => !b.dying).map((b) => ({ key: b.key, name: b.name, ports: b.ports.map((p) => `${b.key}|${p.key}`) }));
  }

  /** Whether `key` stands within `ancestor` (itself included). */
  within(ancestor: string, key: string): boolean {
    for (let k: string | null = key; k; k = this.bodies.get(k)?.parent ?? null) if (k === ancestor) return true;
    return false;
  }

  private marks = new Map<string, number>();
  /** Mark bodies: 1 selected, 2 a drop target. */
  mark(key: string, kind: number | null) {
    if (kind === null) this.marks.delete(key);
    else this.marks.set(key, kind);
  }
  clearMarks(kind?: number) {
    for (const [k, v] of [...this.marks]) if (kind === undefined || v === kind) this.marks.delete(k);
  }

  private dragFrom: string | null = null;
  private dragTo = new THREE.Vector3();
  private dragLine: THREE.Line;
  /** A line from a port to the pointer, while linking. */
  setDragLine(from: string | null, clientX = 0, clientY = 0) {
    this.dragFrom = from;
    if (!from) return;
    const a = new THREE.Vector3();
    this.portWorld(from, a);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), a);
    this.ray(clientX, clientY).ray.intersectPlane(plane, this.dragTo);
  }

  private pairs: [string, string][] = [];
  private pairLines!: THREE.LineSegments;
  private pairGeo = new THREE.BufferGeometry();
  /** Arcs between bodies that are one thing on two sides (a kept node, a site and its uses). */
  setPairs(pairs: [string, string][]) {
    this.pairs = pairs;
  }

  /** The slots shown now. */
  currentSlots(): Slot[] {
    return this.slots;
  }

  /** The body keys of a slot's node ids. */
  keyOf(slot: string, id: Id) {
    return `${slot}:n${id}`;
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

/**
 * Which node of `b` each node of `a` became, where `b` is `a` rebuilt (same things, new identities): matched place
 * by place, by type and key first, then by type, in order.
 */
export function reconcile(a: Carrier, b: Carrier): Map<Id, Id> {
  const ia = new Index(a), ib = new Index(b);
  const out = new Map<Id, Id>();
  const go = (pa: { node: Id } | { region: number }, pb: { node: Id } | { region: number }) => {
    const xs = ia.children(pa).filter((n) => typeof n.payload !== 'object');
    const ys = ib.children(pb).filter((n) => typeof n.payload !== 'object');
    const used = new Set<Id>();
    const take = (y: (typeof ys)[number], same: (x: (typeof xs)[number]) => boolean) => {
      const x = xs.find((x) => !used.has(x.id) && same(x));
      if (!x) return false;
      used.add(x.id);
      out.set(y.id, x.id);
      go({ node: x.id }, { node: y.id });
      return true;
    };
    const rest = ys.filter((y) => !take(y, (x) => x.type === y.type && JSON.stringify(x.member) === JSON.stringify(y.member)));
    const rest2 = rest.filter((y) => !take(y, (x) => x.type === y.type));
    for (const y of rest2) take(y, () => true);
  };
  b.outer.places.forEach((_, r) => go({ region: r }, { region: r }));
  return out;
}
