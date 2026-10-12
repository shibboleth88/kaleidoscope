/**
 * Kaleidoscope: a bigraphical reactive system editor.
 *
 * Left, the library: the types the world is made of, states built from them, reactions. Right, the world: the
 * system (an initial state and a set of reactions) running, one reaction at a time. Click a pane to fill the
 * screen with it; Escape to split again. Any change to what the system is made of starts it over.
 */

import './style.css';
import * as THREE from 'three';
import { type Carrier, type Rule, Signature } from './engine';
import { type Compiled, type Library, type RuleEntry, type StateEntry, compile, load, mapk, save, uid } from './library';
import { BigraphView } from './view/scene';
import { World } from './world';

type Mode = 'split' | 'library' | 'world';
type Selection = { kind: 'types' } | { kind: 'state'; id: string } | { kind: 'rule'; id: string };

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

document.querySelector('#app')!.innerHTML = `
  <section class="pane" id="library">
    <header>
      <h1>Library</h1>
      <span class="hint">states · reactions · the types they are made of</span>
      <button class="ghost" id="lib-reset" title="Replace the library with the MAPK example">example</button>
      <button class="mode" data-mode="library" title="Fill the screen">⤢</button>
    </header>
    <div class="lib-body">
      <nav id="lib-list"></nav>
      <div id="lib-editor">
        <div class="editor-head"></div>
        <div class="preview"></div>
        <div class="editor-text">
          <textarea spellcheck="false"></textarea>
          <div class="problems"></div>
        </div>
      </div>
    </div>
  </section>
  <section class="pane" id="world">
    <header>
      <h1>World</h1>
      <label class="initial">from <select id="initial"></select></label>
      <button id="reset" class="big" title="Start again from the initial state (R)">↺ reset</button>
      <button id="play" title="Play / pause (Space)">❚❚</button>
      <button id="step" title="One reaction (→)">step ▸</button>
      <label class="speed" title="Reactions per second"><input id="speed" type="range" min="0.2" max="8" step="0.1" value="1.2"><span></span></label>
      <button class="mode" data-mode="world" title="Fill the screen">⤢</button>
    </header>
    <div class="system" id="system"></div>
    <div class="stage" id="world-stage"></div>
    <div class="status" id="status"></div>
    <ol class="ticker" id="ticker"></ol>
  </section>
  <div class="esc-hint">Esc · split</div>
`;

const app = document.querySelector('#app') as HTMLElement;
let mode: Mode = 'split';
function setMode(m: Mode) {
  mode = m;
  app.dataset.mode = m;
}
setMode('split');

// a click (not a drag) on a pane, while split, fills the screen with it
for (const pane of ['library', 'world'] as const) {
  const el = $(`#${pane}`);
  let down: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  el.addEventListener('pointerup', (e) => {
    if (mode !== 'split' || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
    down = null;
    const t = e.target as HTMLElement;
    if (moved || t.closest('button, input, select, textarea, label, nav, .chip')) return;
    setMode(pane);
  });
}
document.querySelectorAll<HTMLButtonElement>('button.mode').forEach((b) =>
  b.addEventListener('click', () => setMode(mode === b.dataset.mode ? 'split' : (b.dataset.mode as Mode))),
);

// ── the library and the system ─────────────────────────────────────────────────────────────────────────────

let lib: Library = load();
let compiled: Compiled = compile(lib);
let selection: Selection = lib.rules[0] ? { kind: 'rule', id: lib.rules[0].id } : { kind: 'types' };

const world = new World($('#world-stage'), compiled.sig);
const preview = new BigraphView($('#lib-editor .preview'), compiled.sig);
preview.autoRotate = false;

function systemSetup() {
  const problems: string[] = [];
  if (compiled.typeError) problems.push(`types: ${compiled.typeError}`);
  const init = compiled.states.get(lib.system.initial);
  const initial = init instanceof Error || !init ? null : init;
  if (!init) problems.push('no initial state chosen');
  else if (init instanceof Error) problems.push(`initial state: ${init.message}`);
  const rules: Rule[] = [];
  for (const id of lib.system.rules) {
    const r = compiled.rules.get(id);
    const name = lib.rules.find((x) => x.id === id)?.name ?? id;
    if (r instanceof Error) problems.push(`${name}: ${r.message}`);
    else if (r) rules.push(r);
  }
  return { sig: compiled.sig, initial, rules, seed: lib.system.seed, problems };
}

let changeTimer = 0;
/** Anything changed: compile, redraw the library, and (soon, so typing is not interrupted) start the world over. */
function changed(opts: { now?: boolean; list?: boolean } = {}) {
  save(lib);
  compiled = compile(lib);
  if (opts.list !== false) renderList();
  renderEditor(false);
  renderSystem();
  clearTimeout(changeTimer);
  changeTimer = window.setTimeout(() => world.reset(systemSetup()), opts.now ? 0 : 450);
}

// ── the world's controls ───────────────────────────────────────────────────────────────────────────────────

const ticker = $('#ticker');
world.onEvent = ({ step, t, rule }) => {
  const li = document.createElement('li');
  li.innerHTML = `<b>${esc(rule)}</b><span>#${step} · t ${t.toFixed(2)}</span>`;
  ticker.prepend(li);
  while (ticker.children.length > 8) ticker.lastElementChild!.remove();
};
world.onStatus = ({ steps, t, live, resting, problems }) => {
  $('#status').innerHTML =
    `<span>${steps} reactions</span><span>t ${t.toFixed(2)}</span><span>${resting ? '<b>resting</b>: nothing can react' : `${live} places a reaction can happen`}</span>` +
    problems.map((p) => `<div class="problem">${esc(p)}</div>`).join('');
};

function renderSystem() {
  const sel = $<HTMLSelectElement>('#initial');
  sel.innerHTML = lib.states.map((s) => `<option value="${s.id}" ${s.id === lib.system.initial ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#system').innerHTML = lib.rules
    .map((r) => {
      const on = lib.system.rules.includes(r.id);
      const bad = compiled.rules.get(r.id) instanceof Error;
      return `<span class="chip ${on ? 'on' : ''} ${bad ? 'bad' : ''}" data-rule="${r.id}" title="${on ? 'In the system: click to take it out' : 'Click to put it in the system'}">${esc(r.name)}</span>`;
    })
    .join('');
}
$('#initial').addEventListener('change', (e) => {
  lib.system.initial = (e.target as HTMLSelectElement).value;
  changed({ now: true });
});
$('#system').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('.chip')?.dataset.rule;
  if (!id) return;
  lib.system.rules = lib.system.rules.includes(id) ? lib.system.rules.filter((x) => x !== id) : [...lib.system.rules, id];
  changed({ now: true });
});
$('#reset').addEventListener('click', () => {
  ticker.innerHTML = '';
  world.reset(systemSetup());
});
const playBtn = $('#play');
const setPlay = (p: boolean) => {
  world.setPlaying(p);
  playBtn.textContent = p ? '❚❚' : '▶';
};
playBtn.addEventListener('click', () => setPlay(!world.playing));
$('#step').addEventListener('click', () => {
  setPlay(false);
  world.advance(true);
});
const speed = $<HTMLInputElement>('#speed');
const showSpeed = () => ($('.speed span').textContent = `${Number(speed.value).toFixed(1)}/s`);
speed.addEventListener('input', () => ((world.speed = Number(speed.value)), showSpeed()));
showSpeed();

// ── the library's list and editor ──────────────────────────────────────────────────────────────────────────

function renderList() {
  const item = (kind: 'state' | 'rule', e: StateEntry) => {
    const sel = selection.kind === kind && selection.id === e.id;
    const c = kind === 'state' ? compiled.states.get(e.id) : compiled.rules.get(e.id);
    const mark =
      kind === 'state'
        ? lib.system.initial === e.id ? '<i title="the initial state">★</i>' : ''
        : lib.system.rules.includes(e.id) ? '<i title="in the system">●</i>' : '<i class="off">○</i>';
    return `<a class="${sel ? 'sel' : ''} ${c instanceof Error ? 'bad' : ''}" data-kind="${kind}" data-id="${e.id}">${mark}${esc(e.name)}</a>`;
  };
  $('#lib-list').innerHTML = `
    <a class="${selection.kind === 'types' ? 'sel' : ''} ${compiled.typeError ? 'bad' : ''}" data-kind="types">types</a>
    <h2>states <button data-add="state" title="New state">+</button></h2>
    ${lib.states.map((s) => item('state', s)).join('')}
    <h2>reactions <button data-add="rule" title="New reaction">+</button></h2>
    ${lib.rules.map((r) => item('rule', r)).join('')}`;
}

$('#lib-list').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>('[data-add]')?.dataset.add;
  if (add === 'state') {
    const s: StateEntry = { id: uid(), name: `state ${lib.states.length + 1}`, text: '' };
    lib.states.push(s);
    selection = { kind: 'state', id: s.id };
    changed();
    return;
  }
  if (add === 'rule') {
    const r: RuleEntry = { id: uid(), name: `reaction ${lib.rules.length + 1}`, text: '\n  => ', rate: 1 };
    lib.rules.push(r);
    selection = { kind: 'rule', id: r.id };
    changed();
    return;
  }
  const a = t.closest<HTMLElement>('a[data-kind]');
  if (!a) return;
  selection = a.dataset.kind === 'types' ? { kind: 'types' } : { kind: a.dataset.kind as 'state' | 'rule', id: a.dataset.id! };
  renderList();
  renderEditor(true);
});

const textarea = $<HTMLTextAreaElement>('#lib-editor textarea');
const entryOf = (): StateEntry | RuleEntry | undefined => {
  const s = selection;
  return s.kind === 'state' ? lib.states.find((x) => x.id === s.id) : s.kind === 'rule' ? lib.rules.find((x) => x.id === s.id) : undefined;
};

function renderEditor(fresh: boolean) {
  const head = $('#lib-editor .editor-head');
  const problems = $('#lib-editor .problems');
  const e = entryOf();
  if (selection.kind === 'types') {
    if (fresh) {
      head.innerHTML = `<h3>types</h3><span class="hint">Name[port :: Link | attr :: Float] &lt;: Super {color: "#f80", shape: "torus", sizeBy: "attr"}</span>`;
      textarea.value = lib.types;
    }
    problems.textContent = compiled.typeError ?? '';
    showTypes();
    return;
  }
  if (!e) {
    selection = { kind: 'types' };
    return renderEditor(true);
  }
  if (fresh) {
    const isRule = selection.kind === 'rule';
    head.innerHTML = `
      <input class="name" value="${esc(e.name)}" spellcheck="false">
      ${isRule ? `<label>rate <input class="rate" type="number" min="0" step="0.1" value="${(e as RuleEntry).rate}"></label>` : ''}
      ${isRule ? `<button class="toggle">${lib.system.rules.includes(e.id) ? 'in the system ●' : 'not in the system ○'}</button>` : `<button class="toggle">${lib.system.initial === e.id ? 'the initial state ★' : 'make initial ☆'}</button>`}
      <button class="ghost del" title="Delete">delete</button>`;
    textarea.value = e.text;
    $('.name', head).addEventListener('input', (ev) => {
      e.name = (ev.target as HTMLInputElement).value;
      changed();
    });
    $('.rate', head)?.addEventListener('input', (ev) => {
      (e as RuleEntry).rate = Number((ev.target as HTMLInputElement).value) || 0;
      changed();
    });
    $('.toggle', head).addEventListener('click', () => {
      if (selection.kind === 'rule')
        lib.system.rules = lib.system.rules.includes(e.id) ? lib.system.rules.filter((x) => x !== e.id) : [...lib.system.rules, e.id];
      else lib.system.initial = e.id;
      changed({ now: true });
      renderEditor(true);
    });
    $('.del', head).addEventListener('click', () => {
      lib.states = lib.states.filter((s) => s.id !== e.id);
      lib.rules = lib.rules.filter((r) => r.id !== e.id);
      lib.system.rules = lib.system.rules.filter((x) => x !== e.id);
      selection = { kind: 'types' };
      changed({ now: true });
      renderEditor(true);
    });
  }
  const c = selection.kind === 'state' ? compiled.states.get(e.id) : compiled.rules.get(e.id);
  problems.textContent = c instanceof Error ? c.message : '';
  if (c && !(c instanceof Error)) showEntry(c);
}

function showEntry(c: Carrier | Rule) {
  preview.setSignature(compiled.sig);
  if ('redex' in c) {
    const w = 4 + 2.2 * Math.max(c.redex.nodes.length, c.reactum.nodes.length) ** 0.5;
    preview.show([
      { key: 'L', carrier: c.redex, offset: new THREE.Vector3(-w, 0, 0), title: 'redex' },
      { key: 'R', carrier: c.reactum, offset: new THREE.Vector3(w, 0, 0), title: 'reactum' },
    ]);
  } else preview.show([{ key: 'S', carrier: c, offset: new THREE.Vector3() }]);
  preview.frame();
}

/** The types, each an instance, side by side: a palette. */
function showTypes() {
  preview.setSignature(compiled.sig);
  const user = compiled.sig.user();
  const sig: Signature = compiled.sig;
  const nodes = user.map((t, i) => ({
    id: i,
    type: t.id,
    parent: { region: 0 },
    member: { held: null },
    payload: 'composite' as const,
    ports: [],
  }));
  preview.show([{ key: 'T', carrier: { inner: { places: [], names: [], locality: [] }, outer: { places: [sig.id('Place')], names: [], locality: [] }, nodes, edges: [], sites: [], names: [], siteKeys: [] }, offset: new THREE.Vector3() }]);
  preview.frame();
}

textarea.addEventListener('input', () => {
  if (selection.kind === 'types') lib.types = textarea.value;
  else {
    const e = entryOf();
    if (e) e.text = textarea.value;
  }
  changed({ list: true });
});

$('#lib-reset').addEventListener('click', () => {
  if (!confirm('Replace the library with the MAPK example? Your entries will be lost.')) return;
  lib = mapk();
  selection = { kind: 'rule', id: lib.rules[0].id };
  changed({ now: true });
  renderEditor(true);
});

// ── keys ───────────────────────────────────────────────────────────────────────────────────────────────────

addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select');
  if (e.key === 'Escape') {
    if (typing) (e.target as HTMLElement).blur();
    setMode('split');
    return;
  }
  if (typing) return;
  if (e.key === ' ') (e.preventDefault(), setPlay(!world.playing));
  else if (e.key === 'ArrowRight') (setPlay(false), world.advance(true));
  else if (e.key === 'r' || e.key === 'R') $('#reset').click();
});

renderList();
renderEditor(true);
renderSystem();
world.reset(systemSetup());
