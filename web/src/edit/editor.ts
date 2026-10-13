/**
 * The direct editor: a state or a reaction, edited in place in 3-D.
 *
 *   drag a type from the palette into a place     a new node there (onto empty space: the top, or where you stand)
 *   drag a node into another place                it moves; from the redex into the reactum, it is KEPT
 *   drag from a port to a port                    they are linked     click a port: freed (in a redex: any ↔ free)
 *   drag ◌ into the redex                         a new site; drag a site into the reactum to use it there
 *   click a node                                  inspect it: type, key, attributes, ports     Delete removes it
 *   double-click a place                          go inside it (Esc to come out)
 *
 * Every edit is an edit to the text (`ops.ts`), written back and read again.
 */

import * as THREE from 'three';
import type { Carrier, Id } from '../engine/carrier';
import type { Rule } from '../engine/rule';
import type { Signature } from '../engine/signature';
import {
  type Item,
  type MemberItem,
  type RuleAst,
  type Sources,
  type Term,
  type Value,
  buildRule,
  buildState,
  parseRule,
  parseState,
  readState,
  ruleText,
  stateText,
  valueText,
} from '../engine/text';
import type { BigraphView } from '../view/scene';
import * as ops from './ops';

type Doc = { kind: 'state'; regions: Item[][] } | { kind: 'rule'; ast: RuleAst };
type Built = { kind: 'state'; carrier: Carrier; sources: Sources } | { kind: 'rule'; rule: Rule; redex: Sources; reactum: Sources };

type Drag =
  | { kind: 'new'; type: string; ghost: HTMLElement }
  | { kind: 'site'; name: string | null; ghost: HTMLElement }
  | { kind: 'move'; key: string; x: number; y: number; active: boolean; ghost?: HTMLElement }
  | { kind: 'link'; from: { body: string; port: string } };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Editor {
  private doc: Doc | null = null;
  private built: Built | null = null;
  private sig: Signature;
  private drag: Drag | null = null;
  private selected: string | null = null;
  /** What is selected, as written: it outlives the identities each rebuild gives. */
  private selectedItem: MemberItem | null = null;
  private palette: HTMLElement;
  private inspector: HTMLElement;
  private hint: HTMLElement;
  /** What was last written, so the text box echoing it back does not re-read it. */
  private lastText = '';

  constructor(
    private view: BigraphView,
    private host: HTMLElement,
    sig: Signature,
    /** The text changed by an edit here. */
    private onEdit: (text: string) => void,
  ) {
    this.sig = sig;
    this.palette = this.overlay('palette');
    this.inspector = this.overlay('inspector');
    this.hint = this.overlay('edit-hint');
    host.addEventListener('pointerdown', this.down, true);
    addEventListener('pointermove', this.moveHandler);
    addEventListener('pointerup', this.up);
    addEventListener('keydown', this.key);
    this.palette.addEventListener('pointerdown', this.paletteDown);
  }

  private overlay(cls: string) {
    const el = document.createElement('div');
    el.className = cls;
    this.host.appendChild(el);
    return el;
  }

  // ── what is open ───────────────────────────────────────────────────────────────────────────────────────

  /** Open a state or a rule from its text. Returns the reader's complaint, if any. */
  open(kind: 'state' | 'rule', text: string, sig: Signature): string | null {
    this.sig = sig;
    if (text === this.lastText && this.doc?.kind === kind) return this.build();
    this.lastText = text;
    try {
      this.doc = kind === 'state' ? { kind, regions: parseState(text) } : { kind, ast: parseRule(text) };
    } catch (e) {
      this.doc = null;
      return (e as Error).message;
    }
    this.selected = null;
    this.selectedItem = null;
    return this.build();
  }

  /** The types, side by side: a showroom. */
  openTypes(sig: Signature) {
    this.sig = sig;
    this.doc = null;
    this.built = null;
    this.selected = null;
    const user = sig.user().filter((t) => t.kind === 'composite');
    const carrier: Carrier = {
      inner: { places: [], names: [], locality: [] },
      outer: { places: [sig.id('Place')], names: [], locality: [] },
      nodes: user.map((t, i) => ({ id: i, type: t.id, parent: { region: 0 }, member: { held: null }, payload: 'composite' as const, ports: [] })),
      edges: [],
      sites: [],
      names: [],
      siteKeys: [],
    };
    this.view.setSignature(sig);
    this.view.setPairs([]);
    this.view.show([{ key: 'T', carrier, offset: new THREE.Vector3() }]);
    this.view.frame();
    this.palette.innerHTML = '';
    this.inspector.innerHTML = '';
    this.inspector.classList.remove('open');
    this.hint.textContent = user.length ? 'every type · select one on the left to edit it' : '';
  }

  /** One type, shown off: three instances, linked if it has ports, varying by what it is styled by. */
  openType(sig: Signature, name: string) {
    this.sig = sig;
    this.doc = null;
    this.built = null;
    this.selected = null;
    this.palette.innerHTML = '';
    this.inspector.innerHTML = '';
    this.inspector.classList.remove('open');
    this.view.setSignature(sig);
    this.view.setPairs([]);
    if (!sig.has(name) || sig.get(sig.id(name)).kind !== 'composite') {
      this.view.show([]);
      this.hint.textContent = sig.has(name) ? `${name} is a kind of ${sig.get(sig.id(name)).kind}: nodes do not take it as a type` : '';
      return;
    }
    const t = sig.get(sig.id(name));
    const style = (t.style ?? {}) as { sizeBy?: string; colorBy?: string };
    const kindOf = (a: { type: number }) => sig.get(a.type).kind;
    const varied = style.sizeBy ?? style.colorBy ?? t.attrs.find((a) => ['int', 'float'].includes(kindOf(a)))?.key;
    const one = (i: number) => {
      const parts = [
        ...(t.ports[0] && i < 2 ? [`${t.ports[0].key} = ~p`] : []),
        ...t.attrs.map((a) => {
          const k = kindOf(a);
          const v = k === 'int' ? `${a.key === varied ? [1, 3, 8][i] : 0}` : k === 'float' ? `${a.key === varied ? [1, 3, 8][i] : 0}.0` : k === 'bool' ? 'true' : `"${'abc'[i]}"`;
          return `${a.key} = ${v}`;
        }),
      ];
      return `${name}${parts.length ? `[${parts.join(' | ')}]` : ''}`;
    };
    try {
      const carrier = readState([0, 1, 2].map(one).join(' | '), sig);
      this.view.show([{ key: 'T', carrier, offset: new THREE.Vector3() }]);
      this.hint.textContent = varied && (style.sizeBy || style.colorBy) ? `three ${name}s, ${varied} = 1, 3, 8` : `three ${name}s`;
    } catch (e) {
      this.view.show([]);
      this.hint.textContent = (e as Error).message;
    }
    this.view.frame();
  }

  private build(): string | null {
    const doc = this.doc;
    if (!doc) return null;
    let err: string | null = null;
    try {
      if (doc.kind === 'state') {
        const { carrier, sources } = buildState(doc.regions, this.sig);
        this.built = { kind: 'state', carrier, sources };
      } else {
        const r = buildRule('edit', doc.ast, this.sig);
        this.built = { kind: 'rule', rule: r.rule, redex: r.redex, reactum: r.reactum };
      }
    } catch (e) {
      err = (e as Error).message; // keep showing the last that built
    }
    this.show();
    return err;
  }

  private show() {
    const b = this.built;
    this.view.setSignature(this.sig);
    if (!b) return;
    if (b.kind === 'state') {
      this.view.setPairs([]);
      this.view.show([{ key: 'S', carrier: b.carrier, offset: new THREE.Vector3() }]);
    } else {
      const r = b.rule;
      const w = 4 + 2.2 * Math.max(r.redex.nodes.length, r.reactum.nodes.length) ** 0.5;
      const quiet = (src: Sources) => new Set(src.sites.flatMap((it, i) => (it === null ? [i] : [])));
      const siteNames = (src: Sources) => src.sites.map((it, i) => (it?.value.k === 'site' ? it.value.name : `${i}`));
      this.view.show([
        { key: 'L', carrier: r.redex, offset: new THREE.Vector3(-w, 0, 0), title: 'redex', names: b.redex.names, quietSites: quiet(b.redex), siteNames: siteNames(b.redex) },
        { key: 'R', carrier: r.reactum, offset: new THREE.Vector3(w, 0, 0), title: 'reactum', names: b.reactum.names, quietSites: quiet(b.reactum), siteNames: siteNames(b.reactum) },
      ]);
      // what is one thing on both sides: kept nodes, and each site and its uses
      this.view.setPairs([
        ...r.kept.map(([a, c]) => [`L:n${a}`, `R:n${c}`] as [string, string]),
        ...r.sites.flatMap((i, j) => (b.reactum.sites[j] === null ? [] : [[`L:s${i}`, `R:s${j}`] as [string, string]])),
      ]);
    }
    this.reselect();
    this.renderPalette();
    this.renderInspector();
  }

  /** Write the tree back as text, and show what it now is. */
  private commit() {
    const doc = this.doc;
    if (!doc) return;
    const text = doc.kind === 'state' ? stateText(doc.regions) : ruleText(doc.ast);
    this.lastText = text;
    this.build();
    this.onEdit(text);
  }

  // ── what the bodies are ────────────────────────────────────────────────────────────────────────────────

  private sideOf(slot: string): ops.Side {
    return slot === 'S' ? 'state' : slot === 'L' ? 'redex' : 'reactum';
  }

  private regionsOf(slot: string): Item[][] | null {
    const d = this.doc;
    if (!d) return null;
    if (d.kind === 'state') return slot === 'S' ? d.regions : null;
    return slot === 'L' ? d.ast.lhs : slot === 'R' ? d.ast.rhs : null;
  }

  private sourcesOf(slot: string): Sources | null {
    const b = this.built;
    if (!b) return null;
    if (b.kind === 'state') return slot === 'S' ? b.sources : null;
    return slot === 'L' ? b.redex : slot === 'R' ? b.reactum : null;
  }

  /** The item a body was read from. */
  private itemOf(key: string): { slot: string; item: MemberItem; site: boolean; id: Id } | null {
    const m = /^(\w+):([ns])(\d+)$/.exec(key);
    if (!m) return null;
    const src = this.sourcesOf(m[1]);
    const id = Number(m[3]);
    const item = m[2] === 'n' ? src?.nodes.get(id) : src?.sites[id];
    return item ? { slot: m[1], item, site: m[2] === 's', id } : null;
  }

  /** Where a drop at a screen point lands. */
  private targetAt(x: number, y: number, skip: (k: string) => boolean): { slot: string; target: ops.Target; key: string | null } | null {
    let key = this.view.pick(x, y, (k) => skip(k) || /:s\d+$/.test(k) || /:x\d+$/.test(k));
    while (key) {
      const it = this.itemOf(key);
      if (it && it.item.value.k === 'term' && this.sig.has(it.item.value.head) && this.sig.get(this.sig.id(it.item.value.head)).kind === 'composite')
        return { slot: it.slot, target: { term: it.item.value }, key };
      key = null;
    }
    // empty space: where we stand, or the top of the nearest side
    const f = this.view.focused;
    const fi = f ? this.itemOf(f) : null;
    const slot = this.view.slotAt(x, y);
    if (fi && fi.item.value.k === 'term' && (!slot || fi.slot === slot)) return { slot: fi.slot, target: { term: fi.item.value }, key: f };
    const regions = slot ? this.regionsOf(slot) : null;
    return regions && slot ? { slot, target: { region: regions[0] }, key: null } : null;
  }

  // ── the palette ────────────────────────────────────────────────────────────────────────────────────────

  private renderPalette() {
    const types = this.sig.user().filter((t) => t.kind === 'composite');
    const sites =
      this.built?.kind === 'rule'
        ? [...new Set(this.redexSiteNames())].map((n) => `<span class="chip site" data-site="${esc(n)}" title="Drag into the reactum to use what it holds there">?${esc(n)}</span>`).join('')
        : '';
    this.palette.innerHTML =
      types
        .map((t) => {
          const c = (t.style as { color?: string } | undefined)?.color;
          return `<span class="chip type" data-type="${esc(t.name)}" title="Drag into a place"><i style="${c ? `background:${c}` : ''}"></i>${esc(t.name)}</span>`;
        })
        .join('') +
      (this.built?.kind === 'rule' ? `<span class="chip site new" data-site="" title="Drag into the redex: a hole that matches whatever is there">◌ site</span>${sites}` : '');
    this.hint.textContent =
      this.built?.kind === 'rule'
        ? 'drag types in · drag redex → reactum to keep · port → port to link · click a port to free it · dbl-click to go inside'
        : this.built
          ? 'drag types in · drag to move · port → port to link · click a port to free it · dbl-click to go inside'
          : '';
  }

  private redexSiteNames(): string[] {
    const d = this.doc;
    if (d?.kind !== 'rule') return [];
    return [...ops.walk(d.ast.lhs)].filter(({ item }) => item.value.k === 'site').map(({ item }) => (item.value as { name: string }).name);
  }

  private ghost(text: string, x: number, y: number) {
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    g.textContent = text;
    document.body.appendChild(g);
    g.style.left = `${x}px`;
    g.style.top = `${y}px`;
    return g;
  }

  private paletteDown = (e: PointerEvent) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip');
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
    if (chip.dataset.type) this.drag = { kind: 'new', type: chip.dataset.type, ghost: this.ghost(chip.dataset.type, e.clientX, e.clientY) };
    else if (chip.dataset.site !== undefined)
      this.drag = { kind: 'site', name: chip.dataset.site || null, ghost: this.ghost(chip.dataset.site ? `?${chip.dataset.site}` : '◌ site', e.clientX, e.clientY) };
  };

  // ── pointer ────────────────────────────────────────────────────────────────────────────────────────────

  /** Whether the last press was the editor's (a node, a port): not a click to fill the screen. */
  tookPointer = false;

  private down = (e: PointerEvent) => {
    this.tookPointer = false;
    if (!this.built || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.palette, .inspector, .crumbs')) return;
    // a port, if the pointer is nearer it than the middle of its body (small bodies' ports sit close to it)
    let port = this.view.pickPort(e.clientX, e.clientY);
    if (port) {
      const p = this.view.screenOf(`${port.body}|${port.port}`), c = this.view.screenOf(port.body);
      if (p && c && Math.hypot(c.x - e.clientX, c.y - e.clientY) < Math.hypot(p.x - e.clientX, p.y - e.clientY)) port = null;
    }
    if (port && this.itemOf(port.body)) {
      this.drag = { kind: 'link', from: port };
      this.view.controls.enabled = false;
      this.tookPointer = true;
      return;
    }
    const key = this.view.pick(e.clientX, e.clientY);
    if (key && this.itemOf(key)) {
      this.drag = { kind: 'move', key, x: e.clientX, y: e.clientY, active: false };
      this.view.controls.enabled = false;
      this.tookPointer = true;
    }
  };

  private moveHandler = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'link') {
      this.view.setDragLine(`${d.from.body}|${d.from.port}`, e.clientX, e.clientY);
      return;
    }
    if (d.kind === 'move' && !d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.active = true;
      const it = this.itemOf(d.key)!;
      d.ghost = this.ghost(it.item.value.k === 'term' ? it.item.value.head : valueText(it.item.value), e.clientX, e.clientY);
    }
    const ghost = 'ghost' in d ? d.ghost : undefined;
    if (ghost) (ghost.style.left = `${e.clientX}px`), (ghost.style.top = `${e.clientY}px`);
    this.view.clearMarks(2);
    if (!this.inside(e)) return;
    const skip = d.kind === 'move' ? (k: string) => this.view.within(d.key, k) : () => false;
    const t = this.targetAt(e.clientX, e.clientY, skip);
    if (t?.key) this.view.mark(t.key, 2);
  };

  private inside(e: PointerEvent) {
    const r = this.host.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  private up = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.view.controls.enabled = true;
    this.view.clearMarks(2);
    if ('ghost' in d && d.ghost) d.ghost.remove();
    if (d.kind === 'link') {
      this.view.setDragLine(null);
      const to = this.view.pickPort(e.clientX, e.clientY);
      if (to && (to.body !== d.from.body || to.port !== d.from.port)) this.linkPorts(d.from, to);
      else if (to) this.freePort(d.from);
      return;
    }
    if (d.kind === 'move' && !d.active) return this.select(d.key);
    if (!this.inside(e)) return;
    const skip = d.kind === 'move' ? (k: string) => this.view.within(d.key, k) : () => false;
    const t = this.targetAt(e.clientX, e.clientY, skip);
    if (!t) return;
    const doc = this.doc!;
    const side = this.sideOf(t.slot);
    if (d.kind === 'new') {
      ops.add(t.target, ops.newTerm(this.sig, d.type, side));
    } else if (d.kind === 'site') {
      if (doc.kind !== 'rule') return;
      if (d.name === null) {
        if (side !== 'redex') return this.say('a new site goes in the redex: it says what may stand there');
        ops.addSite(doc.ast, t.target);
      } else {
        if (side !== 'reactum') return this.say('drag a site into the reactum to put what it holds there');
        ops.useSite(d.name, t.target);
      }
    } else if (d.kind === 'move') {
      const from = this.itemOf(d.key)!;
      if (from.slot === t.slot) {
        if (!ops.move(this.regionsOf(t.slot)!, from.item, t.target)) return;
      } else if (doc.kind === 'rule' && from.slot === 'L' && t.slot === 'R') {
        if (from.site) ops.useSite((from.item.value as { name: string }).name, t.target);
        else ops.keep(doc.ast, from.item, t.target);
      } else return this.say('the reactum is made from the redex: drag from left to right');
    }
    this.commit();
  };

  private say(msg: string) {
    this.hint.textContent = msg;
    this.hint.classList.add('warn');
    setTimeout(() => (this.hint.classList.remove('warn'), this.renderPalette()), 2600);
  }

  // ── ports ──────────────────────────────────────────────────────────────────────────────────────────────

  /** The term owning a port, and the port's key. */
  private portOf(ref: { body: string; port: string }) {
    const it = this.itemOf(ref.body);
    if (!it || it.item.value.k !== 'term') return null;
    const key = JSON.parse(ref.port.split('/')[0]) as { text: string };
    const t = this.sig.get(this.sig.id(it.item.value.head));
    const decl = t.ports.find((p) => p.key === key.text);
    return { slot: it.slot, t: it.item.value, port: key.text, contract: decl ? this.sig.name(decl.contract) : 'Link' };
  }

  private linkPorts(a: { body: string; port: string }, b: { body: string; port: string }) {
    const pa = this.portOf(a), pb = this.portOf(b);
    if (!pa || !pb || !this.doc) return;
    if (pa.slot !== pb.slot) return this.say('a link joins ports on one side');
    const doc = this.doc.kind === 'state' ? this.doc.regions : this.doc.ast;
    ops.link(doc, this.sideOf(pa.slot), pa, pb);
    this.commit();
  }

  private freePort(a: { body: string; port: string }) {
    const pa = this.portOf(a);
    if (!pa) return;
    ops.unlink(pa.t, pa.port, this.sideOf(pa.slot));
    this.commit();
  }

  // ── selection and the inspector ────────────────────────────────────────────────────────────────────────

  private select(key: string | null) {
    this.view.clearMarks(1);
    this.selected = key;
    this.selectedItem = key ? (this.itemOf(key)?.item ?? null) : null;
    if (key) this.view.mark(key, 1);
    this.renderInspector();
  }

  /** After a rebuild: the selection's new key. */
  private reselect() {
    this.view.clearMarks(1);
    this.selected = null;
    if (!this.selectedItem) return;
    for (const slot of ['S', 'L', 'R']) {
      const src = this.sourcesOf(slot);
      if (!src) continue;
      for (const [id, item] of src.nodes) if (item === this.selectedItem) this.selected = `${slot}:n${id}`;
      src.sites.forEach((item, i) => {
        if (item === this.selectedItem) this.selected = `${slot}:s${i}`;
      });
    }
    if (this.selected) this.view.mark(this.selected, 1);
    else this.selectedItem = null;
  }

  private renderInspector() {
    const key = this.selected;
    const it = key ? this.itemOf(key) : null;
    if (!it) {
      this.inspector.innerHTML = '';
      this.inspector.classList.remove('open');
      return;
    }
    this.inspector.classList.add('open');
    const side = this.sideOf(it.slot);
    const v = it.item.value;
    if (v.k !== 'term') {
      this.inspector.innerHTML = `<h4>${esc(valueText(v))}</h4><div class="row">${v.k === 'site' ? 'a site: whatever stands here' : ''}</div><button class="del">delete</button>`;
      this.inspector.querySelector('.del')!.addEventListener('click', () => this.remove());
      return;
    }
    const t = this.sig.get(this.sig.id(v.head));
    const typeOpts = this.sig
      .user()
      .filter((x) => x.kind === 'composite')
      .map((x) => `<option ${x.name === v.head ? 'selected' : ''}>${esc(x.name)}</option>`)
      .join('');
    const keyText = it.item.key ? ('text' in it.item.key ? it.item.key.text : JSON.stringify(it.item.key)) : '';
    const attrRow = (a: { key: string }) => {
      const cur = ops.attrValue(v, a.key);
      const shown = cur ? valueText(cur) : '';
      return `<label class="row"><span>${esc(a.key)}</span><input data-attr="${esc(a.key)}" value="${esc(shown)}" placeholder="${side === 'redex' ? 'any' : ''}"></label>`;
    };
    const portRow = (p: { key: string }) => {
      const cur = ops.portValue(v, p.key);
      const shown = cur ? valueText(cur) : side === 'redex' ? 'any' : '!';
      return `<div class="row"><span>${esc(p.key)}</span><code>${esc(shown)}</code><button data-free="${esc(p.key)}" title="${side === 'redex' ? 'any ↔ free' : 'free it'}">${side === 'redex' ? '↻' : '✕'}</button></div>`;
    };
    this.inspector.innerHTML = `
      <h4><select class="type">${typeOpts}</select></h4>
      ${it.item.named ? `<div class="row kept">${side === 'state' ? '' : 'kept as'} <code>?${esc(it.item.named)}</code></div>` : ''}
      <label class="row"><span>key</span><input class="key" value="${esc(keyText)}" placeholder="anonymous"></label>
      ${t.attrs.map(attrRow).join('')}
      ${t.ports.map(portRow).join('')}
      <button class="del">delete</button>`;
    const q = <T extends HTMLElement>(s: string) => this.inspector.querySelector(s) as T;
    q<HTMLSelectElement>('.type').addEventListener('change', (e) => {
      v.head = (e.target as HTMLSelectElement).value;
      this.commit();
    });
    q<HTMLInputElement>('.key').addEventListener('change', (e) => {
      const k = (e.target as HTMLInputElement).value.trim();
      it.item.key = k === '' ? null : /^\d+$/.test(k) ? { int: Number(k) } : { text: k };
      this.commit();
    });
    this.inspector.querySelectorAll<HTMLInputElement>('input[data-attr]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const a = t.attrs.find((x) => x.key === inp.dataset.attr)!;
        ops.setAttr(v, a.key, this.parseValue(inp.value, this.sig.get(a.type).kind));
        this.commit();
      }),
    );
    this.inspector.querySelectorAll<HTMLButtonElement>('button[data-free]').forEach((b) =>
      b.addEventListener('click', () => {
        ops.unlink(v, b.dataset.free!, side);
        this.commit();
      }),
    );
    q('.del').addEventListener('click', () => this.remove());
  }

  private parseValue(s: string, kind: string): Value | null {
    s = s.trim();
    if (s === '') return null;
    if (s.startsWith('?')) return { k: 'site', name: s.slice(1) };
    if (kind === 'int' && /^-?\d+$/.test(s)) return { k: 'lit', v: { int: Number(s) } };
    if (kind === 'float' && !Number.isNaN(Number(s))) return { k: 'lit', v: { float: Number(s) } };
    if (kind === 'bool') return { k: 'lit', v: { bool: s === 'true' } };
    return { k: 'lit', v: { text: s.replace(/^"(.*)"$/, '$1') } };
  }

  private remove() {
    const it = this.selected ? this.itemOf(this.selected) : null;
    const d = this.doc;
    if (!it || !d) return;
    if (d.kind === 'state') ops.drop(d.regions, it.item);
    else if (it.slot === 'L') ops.dropFromRedex(d.ast, it.item);
    else ops.drop(d.ast.rhs, it.item);
    this.select(null);
    this.commit();
  }

  private key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && this.host.offsetParent !== null) {
      e.preventDefault();
      this.remove();
    }
  };

  /** Bodies by node id, for a slot: what the inspector's selection follows across rebuilds. */
  keyOf(slot: string, id: Id) {
    return `${slot}:n${id}`;
  }

  /** The term a selected key edits (for tests). */
  termAt(key: string): Term | null {
    const it = this.itemOf(key);
    return it && it.item.value.k === 'term' ? it.item.value : null;
  }
}
