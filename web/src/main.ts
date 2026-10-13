/**
 * Kaleidoscope: a bigraphical reactive system editor.
 *
 * Left, the library: the types the world is made of, states built from them, reactions. Right, the world: the
 * system (an initial state and a set of reactions) running, one reaction at a time, every step kept on a
 * timeline. Click empty space in a pane to fill the screen with it; Escape to come back out. Any change to what
 * the system is made of starts it over.
 */

import './style.css';
import { type Rule, parseRule, parseValue, ruleText, valueText } from './engine';
import { SHAPES } from './view/style';
import {
  type Compiled,
  type Library,
  type RuleEntry,
  type StateEntry,
  type TypeDef,
  type TypeEntry,
  EXAMPLES,
  compile,
  empty,
  loadShelf,
  parseType,
  saveShelf,
  upgrade,
  working,
  typeName,
  typeText,
  uid,
} from './library';
import { BigraphView } from './view/scene';
import { World } from './world';
import { Editor } from './edit/editor';
import { Timeline, ruleColor } from './timeline';

type Mode = 'split' | 'library' | 'world';
type Selection = { kind: 'none' } | { kind: 'type'; id: string } | { kind: 'state'; id: string } | { kind: 'rule'; id: string };

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

document.querySelector('#app')!.innerHTML = `
  <section class="pane" id="library">
    <header>
      <h1>Library</h1>
      <select id="shelf" title="Your saved libraries, and the examples (always fresh)"></select>
      <button id="save-as" title="Save this library under a name">save as…</button>
      <button class="ghost" id="lib-new" title="An empty library">new</button>
      <button class="ghost" id="lib-del" title="Delete this saved library">delete</button>
      <button class="ghost" id="lib-down" title="Download this library as a file">⤓</button>
      <label class="ghost file" title="Open a library file">⤒<input type="file" id="lib-open" accept=".json,application/json"></label>
      <button class="mode" data-mode="library" title="Fill the screen">⤢</button>
    </header>
    <div class="lib-body">
      <nav id="lib-list"></nav>
      <div id="lib-editor">
        <div class="editor-head"></div>
        <div class="type-form"></div>
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
      <button id="step" title="One reaction (→); ← goes back">step ▸</button>
      <label class="speed" title="How fast it plays"><input id="speed" type="range" min="0.2" max="8" step="0.1" value="1.2"><span></span></label>
      <button id="pace" class="ghost" title="Steps: every reaction takes the same while. Time: each waits as long as the time it took, so a busy system rushes and a quiet one dawdles."></button>
      <button class="mode" data-mode="world" title="Fill the screen">⤢</button>
    </header>
    <div class="system" id="system"></div>
    <div class="stage" id="world-stage"></div>
    <div class="status" id="status"></div>
    <div class="timeline" id="timeline"></div>
  </section>
  <div class="esc-hint">Esc · back</div>
`;

const app = document.querySelector('#app') as HTMLElement;
/** The pane last touched: where Escape steps out of a place. */
let lastPane: 'library' | 'world' = 'world';
$('#library').addEventListener('pointerdown', () => (lastPane = 'library'));
$('#world').addEventListener('pointerdown', () => (lastPane = 'world'));
let mode: Mode = 'split';
function setMode(m: Mode) {
  mode = m;
  app.dataset.mode = m;
}
setMode('split');
document.querySelectorAll<HTMLButtonElement>('button.mode').forEach((b) =>
  b.addEventListener('click', () => setMode(mode === b.dataset.mode ? 'split' : (b.dataset.mode as Mode))),
);

// ── the library and the system ─────────────────────────────────────────────────────────────────────────────

const shelf = loadShelf();
let lib: Library = working(shelf);
let compiled: Compiled = compile(lib);
let selection: Selection = lib.rules[0] ? { kind: 'rule', id: lib.rules[0].id } : { kind: 'none' };

const world = new World($('#world-stage'), compiled.sig);
const preview = new BigraphView($('#lib-editor .preview'), compiled.sig);
preview.autoRotate = false;
const textarea = $<HTMLTextAreaElement>('#lib-editor textarea');
/** Edits made in 3-D come back as text: the entry's, and the text box's. */
const editor = new Editor(preview, $('#lib-editor .preview'), compiled.sig, (text) => {
  const e = entryOf();
  if (!e) return;
  e.text = text;
  textarea.value = text;
  changed();
});
const timeline = new Timeline($('#timeline'));

// a tap on empty space, while split, fills the screen with that pane; anything else is the pane's own
world.view.onTap = (key) => {
  if (!key && mode === 'split') setMode('world');
};
preview.onTap = (key) => {
  if (!key && mode === 'split' && !editor.tookPointer) setMode('library');
};

/** A rule's entry, by the name the world knows it by. */
const ruleIdByName = () => new Map(lib.rules.map((r) => [r.name, r.id]));

function systemSetup() {
  const problems: string[] = [];
  for (const [id, msg] of compiled.typeErrors) problems.push(`type ${typeName(lib.types.find((t) => t.id === id)?.text ?? '')}: ${msg}`);
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
function changed(opts: { now?: boolean } = {}) {
  saveShelf(shelf);
  compiled = compile(lib);
  renderList();
  renderEditor(false);
  renderSystem();
  clearTimeout(changeTimer);
  changeTimer = window.setTimeout(() => world.reset(systemSetup()), opts.now ? 0 : 450);
}

// ── the world's controls ───────────────────────────────────────────────────────────────────────────────────

const typeColor = (t: number) => {
  const st = (compiled.sig.get(t).style ?? {}) as { color?: string };
  return st.color ?? ruleColor(compiled.sig.name(t));
};

world.onStatus = ({ steps, t, live, resting, problems, scrubbing }) => {
  const f = world.frame;
  const what = f?.transition ? `<i style="color:${ruleColor(f.transition.rule)}">${esc(f.transition.rule)}</i>` : 'the initial state';
  $('#status').innerHTML =
    `<span>#${steps} · ${what}</span><span>t ${t.toFixed(2)}</span>` +
    (scrubbing ? `<span><b>looking back</b>: play or step to go on from here</span>` : `<span>${resting ? '<b>resting</b>: nothing can react' : `${live} places a reaction can happen`}</span>`) +
    problems.map((p) => `<div class="problem">${esc(p)}</div>`).join('');
};

/** The reaction a frame came from, lit in the list and the system: a flash as it happens, steady while looked at. */
world.onFrame = (f, i, fresh) => {
  timeline.set(world.frames, i, compiled.sig, typeColor);
  const id = f.transition ? ruleIdByName().get(f.transition.rule) : undefined;
  document.querySelectorAll('.current-rule').forEach((el) => el.classList.remove('current-rule'));
  if (!id) return;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-id="${id}"], [data-rule="${id}"]`)) {
    el.classList.add('current-rule');
    if (fresh) {
      el.classList.remove('fired');
      void el.offsetWidth; // restart the animation
      el.classList.add('fired');
    }
  }
};
timeline.onSeek = (i) => {
  setPlay(false);
  world.seek(i);
};

function renderSystem() {
  const sel = $<HTMLSelectElement>('#initial');
  sel.innerHTML = lib.states.map((s) => `<option value="${s.id}" ${s.id === lib.system.initial ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#system').innerHTML = lib.rules
    .map((r) => {
      const on = lib.system.rules.includes(r.id);
      const bad = compiled.rules.get(r.id) instanceof Error;
      return `<span class="chip ${on ? 'on' : ''} ${bad ? 'bad' : ''}" data-rule="${r.id}" style="--rule:${ruleColor(r.name)}" title="${on ? 'In the system: click to take it out' : 'Click to put it in the system'}">${esc(r.name)}</span>`;
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
$('#reset').addEventListener('click', () => world.reset(systemSetup()));
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
const showSpeed = () =>
  ($('.speed span').textContent = world.pace === 'time' ? `${Number(speed.value).toFixed(1)} t/s` : `${Number(speed.value).toFixed(1)}/s`);
speed.addEventListener('input', () => ((world.speed = Number(speed.value)), showSpeed()));
/** Play by steps or by time: the world's pace, the timeline's axis, and the library's to remember. */
function setPace(p: 'steps' | 'time') {
  world.pace = p;
  if (world.playing) world.setPlaying(true); // carry on, in the new manner
  timeline.axis = p;
  $('#pace').textContent = p === 'time' ? '⏱ by time' : '⏵ by steps';
  $('#pace').classList.toggle('on', p === 'time');
  showSpeed();
  if (world.frame) timeline.set(world.frames, world.at, compiled.sig, typeColor);
}
$('#pace').addEventListener('click', () => {
  lib.system.pace = world.pace === 'time' ? 'steps' : 'time';
  saveShelf(shelf);
  setPace(lib.system.pace);
});
setPace(lib.system.pace ?? 'steps');

// ── the library's list ─────────────────────────────────────────────────────────────────────────────────────

function renderList() {
  const isSel = (kind: string, id: string) => selection.kind === kind && 'id' in selection && selection.id === id;
  const typeItem = (t: TypeEntry) => {
    const name = typeName(t.text);
    let color = '#7d8db0';
    try {
      color = (parseType(t.text).style.color as string) ?? color;
    } catch {
      /* a type that does not read: grey */
    }
    return `<a class="${isSel('type', t.id) ? 'sel' : ''} ${compiled.typeErrors.has(t.id) ? 'bad' : ''}" data-kind="type" data-id="${t.id}"><i class="dot" style="background:${color}"></i>${esc(name)}</a>`;
  };
  const item = (kind: 'state' | 'rule', e: StateEntry) => {
    const c = kind === 'state' ? compiled.states.get(e.id) : compiled.rules.get(e.id);
    const mark =
      kind === 'state'
        ? lib.system.initial === e.id ? '<i title="the initial state">★</i>' : '<i></i>'
        : `<i class="dot ${lib.system.rules.includes(e.id) ? '' : 'off'}" style="--rule:${ruleColor(e.name)}" title="${lib.system.rules.includes(e.id) ? 'in the system' : 'not in the system'}"></i>`;
    return `<a class="${isSel(kind, e.id) ? 'sel' : ''} ${c instanceof Error ? 'bad' : ''}" data-kind="${kind}" data-id="${e.id}">${mark}${esc(e.name)}</a>`;
  };
  $('#lib-list').innerHTML = `
    <h2>types <button data-add="type" title="New type">+</button></h2>
    ${lib.types.map(typeItem).join('')}
    <h2>states <button data-add="state" title="New state">+</button></h2>
    ${lib.states.map((s) => item('state', s)).join('')}
    <h2>reactions <button data-add="rule" title="New reaction">+</button></h2>
    ${lib.rules.map((r) => item('rule', r)).join('')}`;
  // keep the world's current reaction lit across redraws
  const f = world.frame;
  const id = f?.transition ? ruleIdByName().get(f.transition.rule) : undefined;
  if (id) $(`#lib-list [data-id="${id}"]`)?.classList.add('current-rule');
}

$('#lib-list').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>('[data-add]')?.dataset.add;
  if (add) {
    if (add === 'type') {
      const names = new Set(lib.types.map((x) => typeName(x.text)));
      let n = 1;
      while (names.has(`Thing${n}`)) n++;
      const ty: TypeEntry = { id: uid(), text: `Thing${n}` };
      lib.types.push(ty);
      selection = { kind: 'type', id: ty.id };
    } else if (add === 'state') {
      const s: StateEntry = { id: uid(), name: `state ${lib.states.length + 1}`, text: '' };
      lib.states.push(s);
      selection = { kind: 'state', id: s.id };
    } else {
      const r: RuleEntry = { id: uid(), name: `reaction ${lib.rules.length + 1}`, text: '()\n  => ()', rate: 1 };
      lib.rules.push(r);
      selection = { kind: 'rule', id: r.id };
    }
    changed();
    renderEditor(true);
    return;
  }
  const a = t.closest<HTMLElement>('a[data-kind]');
  if (!a) return;
  const kind = a.dataset.kind as 'type' | 'state' | 'rule';
  // the selected one again: let go of it
  selection = 'id' in selection && selection.kind === kind && selection.id === a.dataset.id ? { kind: 'none' } : { kind, id: a.dataset.id! };
  renderList();
  renderEditor(true);
});

// ── the editor: a type, a state or a reaction ──────────────────────────────────────────────────────────────

const entryOf = (): TypeEntry | StateEntry | RuleEntry | undefined => {
  const s = selection;
  if (s.kind === 'type') return lib.types.find((x) => x.id === s.id);
  if (s.kind === 'state') return lib.states.find((x) => x.id === s.id);
  if (s.kind === 'rule') return lib.rules.find((x) => x.id === s.id);
  return undefined;
};

function renderEditor(fresh: boolean) {
  const head = $('#lib-editor .editor-head');
  const form = $('#lib-editor .type-form');
  const problems = $('#lib-editor .problems');
  const e = entryOf();
  $('#lib-editor').dataset.kind = selection.kind;
  if (selection.kind === 'none' || !e) {
    selection = { kind: 'none' };
    head.innerHTML = `<h3>the library</h3><span class="hint">every type, as it looks · select a type, a state or a reaction to edit it</span>`;
    form.innerHTML = '';
    textarea.value = '';
    problems.textContent = '';
    editor.openTypes(compiled.sig);
    if (fresh) preview.frame();
    return;
  }
  if (selection.kind === 'type') {
    const t = e as TypeEntry;
    if (fresh) {
      head.innerHTML = `<h3>type</h3><span class="hint">Name[port :: Link | attr :: Float] &lt;: Super {color, shape, size, sizeBy, colorBy, container}</span><button class="ghost del" title="Delete">delete</button>`;
      $('.del', head).addEventListener('click', () => {
        lib.types = lib.types.filter((x) => x.id !== t.id);
        selection = { kind: 'none' };
        changed({ now: true });
        renderEditor(true);
      });
    }
    if (fresh || document.activeElement !== textarea) textarea.value = t.text;
    renderTypeForm(t, fresh);
    problems.textContent = compiled.typeErrors.get(t.id) ?? '';
    editor.openType(compiled.sig, typeName(t.text));
    if (fresh) preview.frame();
    return;
  }
  form.innerHTML = '';
  const se = e as StateEntry;
  if (fresh) {
    const isRule = selection.kind === 'rule';
    head.innerHTML = `
      <input class="name" value="${esc(se.name)}" spellcheck="false">
      ${isRule ? `<label title="A number, or an expression over the redex's sites, worked out at each place it can fire: max[count[?x Yang] - 12 0]">rate <input class="rate" spellcheck="false" value="${esc(String((se as RuleEntry).rate))}"></label>` : ''}
      ${isRule ? `<label class="guard" title="Fires only where this holds, over the redex's sites: ?m >= 2, count[?x] < 10, …">where <input class="guard-in" spellcheck="false" placeholder="always" value="${esc(guardOf(se.text))}"></label>` : ''}
      ${isRule ? `<button class="toggle">${lib.system.rules.includes(se.id) ? 'in the system ●' : 'not in the system ○'}</button>` : `<button class="toggle">${lib.system.initial === se.id ? 'the initial state ★' : 'make initial ☆'}</button>`}
      <button class="ghost del" title="Delete">delete</button>`;
    textarea.value = se.text;
    $('.name', head).addEventListener('input', (ev) => {
      se.name = (ev.target as HTMLInputElement).value;
      changed();
    });
    $('.guard-in', head)?.addEventListener('change', (ev) => {
      const input = ev.target as HTMLInputElement;
      try {
        const ast = parseRule(se.text);
        ast.guard = input.value.trim() ? parseValue(input.value) : null;
        se.text = ruleText(ast);
        textarea.value = se.text;
        input.classList.remove('bad');
        changed();
      } catch (err) {
        input.classList.add('bad');
        $('#lib-editor .problems').textContent = `where: ${(err as Error).message}`;
      }
    });
    $('.rate', head)?.addEventListener('change', (ev) => {
      const v = (ev.target as HTMLInputElement).value.trim();
      (se as RuleEntry).rate = v === '' ? 1 : Number.isFinite(Number(v)) ? Number(v) : v;
      changed();
    });
    $('.toggle', head).addEventListener('click', () => {
      if (selection.kind === 'rule')
        lib.system.rules = lib.system.rules.includes(se.id) ? lib.system.rules.filter((x) => x !== se.id) : [...lib.system.rules, se.id];
      else lib.system.initial = se.id;
      changed({ now: true });
      renderEditor(true);
    });
    $('.del', head).addEventListener('click', () => {
      lib.states = lib.states.filter((s) => s.id !== se.id);
      lib.rules = lib.rules.filter((r) => r.id !== se.id);
      lib.system.rules = lib.system.rules.filter((x) => x !== se.id);
      selection = { kind: 'none' };
      changed({ now: true });
      renderEditor(true);
    });
  }
  const gi = $<HTMLInputElement>('.guard-in', head);
  if (gi && document.activeElement !== gi) gi.value = guardOf(se.text);
  // the editor reads the text itself, so what it shows is what is written, edited in place
  const err = editor.open(selection.kind, se.text, compiled.sig, selection.kind === 'rule' ? String((se as RuleEntry).rate) : undefined);
  $('.rate', head)?.classList.toggle('bad', compiled.rules.get(se.id) instanceof Error && /^rate:/.test((compiled.rules.get(se.id) as Error).message));
  const c = selection.kind === 'state' ? compiled.states.get(se.id) : compiled.rules.get(se.id);
  problems.textContent = err ?? (c instanceof Error ? c.message : '');
  if (fresh) preview.frame();
}

/** The type as a form: its name, what it is within, its slots, and how it looks. Each change rewrites its line. */
function renderTypeForm(t: TypeEntry, fresh: boolean) {
  const form = $('#lib-editor .type-form');
  let d: TypeDef;
  try {
    d = parseType(t.text);
  } catch {
    form.innerHTML = '<div class="hint">fix the text below and the form comes back</div>';
    return;
  }
  // while typing in the form, leave it be: only the text and the preview follow
  if (!fresh && form.contains(document.activeElement) && form.dataset.for === t.id) return;
  form.dataset.for = t.id;
  const others = lib.types.map((x) => typeName(x.text)).filter((n) => n !== d.name);
  const slotTypes = ['Link', ...others.filter((n) => compiled.sig.has(n) && compiled.sig.get(compiled.sig.id(n)).kind === 'link'), 'Int', 'Float', 'Text', 'Bool'];
  const numeric = d.slots.filter((x) => x.type === 'Int' || x.type === 'Float').map((x) => x.key);
  const st = d.style as { color?: string; shape?: string; size?: number; sizeBy?: string; colorBy?: string; container?: boolean };
  const opt = (v: string, cur: string | undefined, label = v) => `<option value="${esc(v)}" ${v === (cur ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
  form.innerHTML = `
    <div class="row"><label>name <input data-f="name" value="${esc(d.name)}" spellcheck="false"></label>
      <label>within <select data-f="super">${opt('', d.supers[0], '—')}${['Link', ...others].map((n) => opt(n, d.supers[0])).join('')}</select></label></div>
    <div class="slots">
      ${d.slots
        .map(
          (x, i) => `<div class="row slot">
        <input data-slot="${i}" data-k="key" value="${esc(x.key)}" spellcheck="false">
        <span>::</span>
        <select data-slot="${i}" data-k="type">${slotTypes.map((n) => opt(n, x.type)).join('')}</select>
        ${slotTypes.slice(0, slotTypes.length - 4).includes(x.type) ? `<label title="points">× <input data-slot="${i}" data-k="arity" type="number" min="1" max="8" value="${x.arity ?? 1}"></label><em>port</em>` : '<em>attribute</em>'}
        <button data-del-slot="${i}" title="Remove">✕</button></div>`,
        )
        .join('')}
      <div class="row"><button data-add-slot="port">+ port</button><button data-add-slot="attr">+ attribute</button></div>
    </div>
    <div class="row look">
      <label>colour <input data-f="color" type="color" value="${esc(st.color ?? '#7d8db0')}"></label>
      <label>shape <select data-f="shape">${opt('', st.shape, 'auto')}${SHAPES.map((x) => opt(x, st.shape)).join('')}</select></label>
      <label>size <input data-f="size" type="range" min="0.3" max="3" step="0.1" value="${st.size ?? 1}"></label>
      <label>size by <select data-f="sizeBy">${opt('', st.sizeBy, '—')}${numeric.map((n) => opt(n, st.sizeBy)).join('')}</select></label>
      <label>hue by <select data-f="colorBy">${opt('', st.colorBy, '—')}${numeric.map((n) => opt(n, st.colorBy)).join('')}</select></label>
      <label>a place <select data-f="container">${opt('', st.container === undefined ? '' : String(st.container), 'when it holds')}${opt('true', String(st.container), 'always')}${opt('false', String(st.container), 'never')}</select></label>
    </div>`;

  const write = (rename?: [string, string]) => {
    t.text = typeText(d);
    textarea.value = t.text;
    if (rename) renameType(...rename);
    changed();
  };
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((el) => {
    const ev = el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'color' && (el as HTMLInputElement).type !== 'range' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const f = el.dataset.f!;
      const v = el.value;
      if (f === 'name') {
        const old = d.name;
        if (!/^[A-Za-z_]\w*$/.test(v) || v === old) return;
        d.name = v;
        return write([old, v]);
      }
      if (f === 'super') d.supers = v ? [v] : [];
      else if (f === 'size') d.style.size = Number(v) === 1 ? undefined : Number(v);
      else if (f === 'container') d.style.container = v === '' ? undefined : v === 'true';
      else d.style[f] = v || undefined;
      write();
    });
  });
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-slot]').forEach((el) =>
    el.addEventListener('change', () => {
      const x = d.slots[Number(el.dataset.slot)];
      const k = el.dataset.k!;
      if (k === 'key') x.key = el.value.replace(/\W/g, '') || x.key;
      else if (k === 'type') x.type = el.value;
      else x.arity = Math.max(1, Number(el.value) || 1);
      write();
      renderTypeForm(t, true);
    }),
  );
  form.querySelectorAll<HTMLButtonElement>('[data-del-slot]').forEach((b) =>
    b.addEventListener('click', () => {
      d.slots.splice(Number(b.dataset.delSlot), 1);
      write();
      renderTypeForm(t, true);
    }),
  );
  form.querySelectorAll<HTMLButtonElement>('[data-add-slot]').forEach((b) =>
    b.addEventListener('click', () => {
      const port = b.dataset.addSlot === 'port';
      const used = new Set(d.slots.map((x) => x.key));
      let n = 1;
      const stem = port ? 'p' : 'a';
      while (used.has(`${stem}${n}`)) n++;
      d.slots.push({ key: `${stem}${n}`, type: port ? 'Link' : 'Float' });
      write();
      renderTypeForm(t, true);
    }),
  );
}

/** A rule's guard, as written (empty where it has none, or does not read). */
function guardOf(text: string): string {
  try {
    const g = parseRule(text).guard;
    return g ? valueText(g) : '';
  } catch {
    return '';
  }
}

/** A type renamed: everything written in its name follows. */
function renameType(old: string, now: string) {
  const re = new RegExp(`\\b${old}\\b`, 'g');
  for (const s of [...lib.states, ...lib.rules]) s.text = s.text.replace(re, now);
  for (const t of lib.types) if (typeName(t.text) !== now) t.text = t.text.replace(re, now);
}

// a type renamed in its text: when the text is left, everything written in the old name follows
let nameAtFocus: string | null = null;
textarea.addEventListener('focus', () => (nameAtFocus = selection.kind === 'type' ? typeName(textarea.value) : null));
textarea.addEventListener('change', () => {
  if (selection.kind !== 'type' || !nameAtFocus) return;
  const now = typeName(textarea.value);
  if (now !== nameAtFocus && now !== '?') {
    renameType(nameAtFocus, now);
    nameAtFocus = now;
    changed({ now: true });
  }
});

textarea.addEventListener('input', () => {
  const e = entryOf();
  if (!e) return;
  e.text = textarea.value;
  changed();
});

// ── the shelf: libraries saved by name, and the examples ───────────────────────────────────────────────────

function renderShelf() {
  const names = Object.keys(shelf.saved).sort();
  const scratchTitle = (shelf.scratch as Library & { title?: string }).title ?? 'library';
  $('#shelf').innerHTML =
    `<option value="__scratch" ${shelf.current === null ? 'selected' : ''}>${esc(scratchTitle)}${shelf.current === null ? ' (unsaved)' : ''}</option>` +
    (names.length ? `<optgroup label="saved">${names.map((n) => `<option value="s:${esc(n)}" ${shelf.current === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="examples (fresh copy)">${Object.keys(EXAMPLES).map((n) => `<option value="x:${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>`;
  $('#lib-del').style.display = shelf.current ? '' : 'none';
}

/** Work on another library: everything follows, and the world starts over. */
function switchTo(next: Library) {
  lib = next;
  setPace(lib.system.pace ?? 'steps');
  selection = lib.rules[0] ? { kind: 'rule', id: lib.rules[0].id } : { kind: 'none' };
  renderShelf();
  changed({ now: true });
  renderEditor(true);
}

const unsavedWork = () => shelf.current === null && (shelf.scratch.rules.length > 0 || shelf.scratch.types.length > 0);

$('#shelf').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (v === '__scratch') {
    shelf.current = null;
    return switchTo(shelf.scratch);
  }
  if (v.startsWith('s:')) {
    shelf.current = v.slice(2);
    return switchTo(shelf.saved[shelf.current]);
  }
  const name = v.slice(2);
  if (unsavedWork() && !confirm(`Replace your unsaved library with a fresh ${name}? (Save it first to keep it.)`)) return renderShelf();
  shelf.current = null;
  shelf.scratch = Object.assign(EXAMPLES[name](), { title: name });
  switchTo(shelf.scratch);
});

$('#save-as').addEventListener('click', () => {
  const suggestion = shelf.current ?? (shelf.scratch as Library & { title?: string }).title ?? 'my library';
  const name = prompt('Save this library as:', suggestion)?.trim();
  if (!name) return;
  if (shelf.saved[name] && name !== shelf.current && !confirm(`Replace the saved library "${name}"?`)) return;
  shelf.saved[name] = structuredClone(lib);
  shelf.current = name;
  switchTo(shelf.saved[name]);
});

$('#lib-new').addEventListener('click', () => {
  if (unsavedWork() && !confirm('Start an empty library? Your unsaved one will be replaced. (Save it first to keep it.)')) return;
  shelf.current = null;
  shelf.scratch = Object.assign(empty(), { title: 'new library' });
  switchTo(shelf.scratch);
});

$('#lib-del').addEventListener('click', () => {
  const name = shelf.current;
  if (!name || !confirm(`Delete the saved library "${name}"? This cannot be undone.`)) return;
  delete shelf.saved[name];
  shelf.current = null;
  switchTo(shelf.scratch);
});

$('#lib-down').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(lib, null, 2)], { type: 'application/json' }));
  a.download = `${(shelf.current ?? (shelf.scratch as Library & { title?: string }).title ?? 'library').replace(/[^\w.-]+/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$<HTMLInputElement>('#lib-open').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const next = upgrade(JSON.parse(await file.text()));
    if (!Array.isArray(next.states) || !Array.isArray(next.rules)) throw new Error('not a library');
    if (unsavedWork() && !confirm('Replace your unsaved library with this file? (Save it first to keep it.)')) return;
    shelf.current = null;
    shelf.scratch = Object.assign(next, { title: file.name.replace(/\.json$/, '') });
    switchTo(shelf.scratch);
  } catch (err) {
    alert(`Could not open ${file.name}: ${(err as Error).message}`);
  }
});

// ── keys ───────────────────────────────────────────────────────────────────────────────────────────────────

addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select');
  if (e.key === 'Escape') {
    if (typing) return (e.target as HTMLElement).blur();
    // out of the place we are in first; out of full screen once at the top
    const view = (mode === 'split' ? lastPane : mode) === 'world' ? world.view : preview;
    if (!view.up()) setMode('split');
    return;
  }
  if (typing) return;
  const inWorld = mode === 'world' || (mode === 'split' && lastPane === 'world');
  if (e.key === ' ') (e.preventDefault(), setPlay(!world.playing));
  else if (e.key === 'ArrowRight' && inWorld) {
    setPlay(false);
    if (world.at < world.frames.length - 1) world.seek(world.at + 1);
    else world.advance(true);
  } else if (e.key === 'ArrowLeft' && inWorld) (setPlay(false), world.seek(world.at - 1));
  else if (e.key === 'r' || e.key === 'R') $('#reset').click();
});

renderShelf();
renderList();
renderEditor(true);
renderSystem();
world.reset(systemSetup());

// for scripts driving the page (tests, demos)
(window as unknown as { kaleidoscope: unknown }).kaleidoscope = { preview, world, editor };
