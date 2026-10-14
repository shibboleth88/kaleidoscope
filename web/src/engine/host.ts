/**
 * Host types: types whose arms are natives a package supplies (chrysalis D-host-types-have-a-public-face, ALGEBRA §1.3).
 * PROVISIONAL, wyrm's (wyrm docs/HOST-TYPES.md, which lists what the spec has yet to settle: H1–H8).
 *
 * A host type is declared like any type, naming its host in its own attributes:
 *
 *   Cell[x :: Float | … ] = Type[host = "laguerre" | a = 25.0]()
 *
 * Its instance is a node whose declared slots are its **public face**: rules match it, react to it and write it. What
 * the host keeps beyond the face (a mesh, say) is the instance's **internal state**, held here per state node.
 *
 * - **Methods** answer calls, `?p.volume[]` (sugar for `volume[?p]`), dispatched on the receiver's type. Each method
 *   may name a derivation, worked out once per what it reads and shared by the methods that use it.
 * - **The read set** is declared: the receiver's fields, whether its state is read, and for each port group the far
 *   nodes' fields and whether their states are read. A derivation is memoised by exactly what the read set names (the
 *   fields' values, the far nodes and their values, each state's revision), so an answer is asked again when, and
 *   only when, something it declared it reads changes (R-host-answered-operations .4–.6).
 * - **A stateful type** also supplies `make` (a fresh instance from its face), `apply` (the fields a reaction wrote,
 *   carried into the host), `project` (the face fields the host writes back), `serialize` and `realize`. A world calls
 *   them after each reaction (`World.apply`):
 *   - for a fresh node, `make`;
 *   - for a kept node whose face changed, `apply`;
 *   - for a copied node, `realize ∘ serialize`;
 *   - for a removed node, the state is dropped.
 *   A face field named as the type's `channel` carries a whole serialized state in: written, it is realized, and
 *   `project` clears it. Division goes this way (H1, H2).
 */

import type { Carrier, Id, Index } from './carrier';
import { scalarKey } from './carrier';
import { type Env, EvalError, type Expr, FUNCTIONS, HOST_CALL } from './expr';
import type { Signature } from './signature';

export type HostValue = number | string | boolean;
export type Face = Record<string, HostValue>;

/** What an arm reads (R-host-answered-operations .5). */
export interface ReadSet {
  /** The receiver's face fields. */
  fields: string[];
  /** Whether the receiver's internal state is read. */
  state?: boolean;
  /** Port groups whose far nodes are read: their fields, and whether their internal states are. */
  across?: Record<string, { fields: string[]; state?: boolean }>;
}

/** What an arm may ask of the state, all of it within its declared read set. */
export interface HostCtx {
  /** The type's own attributes, beside `host`. */
  readonly config: Record<string, HostValue>;
  field(node: Id, key: string): HostValue | undefined;
  /** The nodes at the far ends of a node's port group's points. */
  far(node: Id, port: string): Id[];
  /** A host node's internal state (undefined for a node of no stateful host type). */
  state<S>(node: Id): S | undefined;
  /** The host instances within a node (its members, at any depth), in the state's order. */
  members(node: Id): Id[];
  /**
   * In `apply` only: a new state for an instance within the receiver (its member): a change of the place's members,
   * within the reaction's footprint, as a place's operation makes (ALGEBRA §1.2 `AtPlace`; H5). The member's face is
   * then projected as its own.
   */
  setState<S>(node: Id, s: S): void;
}

export interface HostMethod {
  /** How many values it takes beside the receiver. */
  arity: [number, number];
  /** The derivation it reads (`HostArms.derive`), worked out once per what it reads. */
  derive?: string;
  /** How many of its leading values the derivation takes (a division's plane, say): part of what it reads. */
  deriveArgs?: number;
  answer(q: { self: Id; nodes: Id[]; args: HostValue[]; ctx: HostCtx; derived: unknown }): HostValue;
}

export interface HostArms<S = unknown> {
  reads: ReadSet;
  /** Derivations, by name: what several methods read, worked out once per what they read. */
  derive?: Record<string, (self: Id, nodes: Id[], ctx: HostCtx, args: HostValue[]) => unknown>;
  methods: Record<string, HostMethod>;
  make?(self: Id, ctx: HostCtx): S;
  /** The face fields a reaction wrote, carried into the host. */
  apply?(s: S, self: Id, changed: string[], ctx: HostCtx): S;
  /** The face fields the host owns, from the state. */
  project?(s: S, self: Id, ctx: HostCtx): Face;
  serialize?(s: S): string;
  realize?(e: string, self: Id, ctx: HostCtx): S;
  /** A face field whose written value is a serialized state, realized into the instance. */
  channel?: string;
}

const HOSTS = new Map<string, HostArms<any>>();

/** Register a host package's arms. Its methods become operations the reader accepts. */
export function registerHost<S>(name: string, arms: HostArms<S>) {
  HOSTS.set(name, arms as HostArms<any>);
  for (const [m, def] of Object.entries(arms.methods)) {
    const [lo, hi] = def.arity;
    const prev = FUNCTIONS[m];
    if (prev && !HOST_CALL.methods.has(m)) throw new EvalError(`${m} is an operation already`);
    // one operation, dispatched by type: its arity is what every host's arm allows
    FUNCTIONS[m] = prev ? [Math.min(prev[0], lo + 1), Math.max(prev[1], hi + 1)] : [lo + 1, hi + 1];
    HOST_CALL.methods.add(m);
  }
  HOST_CALL.call = call;
}

// ── instances: per state ────────────────────────────────────────────────────────────────────────────────────

interface Instance {
  host: string;
  state: unknown;
  /** Bumped at every change, so what read the state is asked again. */
  rev: number;
  /** The face as the host last saw it. */
  seen: Face;
}

const STORES = new WeakMap<Carrier, Map<Id, Instance>>();
const store = (g: Carrier) => {
  let s = STORES.get(g);
  if (!s) STORES.set(g, (s = new Map()));
  return s;
};
let REV = 0;

/** The host arms a type answers by: its own, or the nearest along its supertypes. */
const armsCache = new WeakMap<Signature, Map<Id, { name: string; arms: HostArms<any>; config: Record<string, HostValue> } | null>>();
export function hostOf(sig: Signature, type: Id): { name: string; arms: HostArms<any>; config: Record<string, HostValue> } | null {
  let m = armsCache.get(sig);
  if (!m) armsCache.set(sig, (m = new Map()));
  if (m.has(type)) return m.get(type)!;
  let out: { name: string; arms: HostArms<any>; config: Record<string, HostValue> } | null = null;
  for (const t of sig.ups(type)) {
    const h = sig.get(t).host;
    if (!h) continue;
    const arms = HOSTS.get(h.name);
    if (!arms) throw new EvalError(`${sig.name(type)}: no host package "${h.name}" is registered`);
    out = { name: h.name, arms, config: h.config };
    break;
  }
  m.set(type, out);
  return out;
}

const attrKey = (k: string) => `a${scalarKey({ text: k })}`;

function context(ix: Index, config: Record<string, HostValue>, sig?: Signature, owner?: Id, set?: (node: Id, s: unknown) => void): HostCtx {
  const inst = store(ix.g);
  return {
    members(node) {
      return ix.subtree(node).filter((n) => n !== node && inst.has(n));
    },
    setState(node, s) {
      if (owner === undefined || !set || !sig) throw new EvalError('setState: only a place\'s apply changes its members');
      if (node === owner || !ix.within(owner, node)) throw new EvalError(`setState: node ${node} is not a member of ${owner}`);
      set(node, s);
    },
    config,
    field(node, key) {
      const c = ix.childAt({ node }, attrKey(key));
      return c && typeof c.payload === 'object' ? (Object.values(c.payload.scalar)[0] as HostValue) : undefined;
    },
    far(node, port) {
      const n = ix.node.get(node);
      const out: Id[] = [];
      for (const g of n?.ports ?? []) {
        if (!('text' in g.key) || g.key.text !== port) continue;
        for (const [, p] of g.points) for (const pt of ix.pointsOn(p.target)) if (pt.node !== node) out.push(pt.node);
      }
      return out;
    },
    state: <S>(node: Id) => inst.get(node)?.state as S | undefined,
  };
}

/** What a node's read set reads, as a key: equal keys, equal answers. */
function readKey(ix: Index, ctx: HostCtx, reads: ReadSet, node: Id): string {
  const inst = store(ix.g);
  const parts: unknown[] = [node, reads.fields.map((f) => ctx.field(node, f))];
  if (reads.state) parts.push(inst.get(node)?.rev ?? -1);
  for (const [port, r] of Object.entries(reads.across ?? {}))
    for (const f of ctx.far(node, port)) {
      parts.push(f, r.fields.map((k) => ctx.field(f, k)));
      if (r.state) parts.push(inst.get(f)?.rev ?? -1);
    }
  return JSON.stringify(parts);
}

const MEMO = new WeakMap<Carrier, Map<string, unknown>>();

function call(op: string, args: Expr[], env: Env, value: (e: Expr) => HostValue): HostValue {
  const ix = env.index, sig = env.sig;
  if (!ix || !sig || !env.nodeOf) throw new EvalError(`${op}[…]: a host method is asked at an occurrence`);
  const [recv, ...rest] = args;
  if (!recv || !('node' in recv)) throw new EvalError(`${op}[…]: the receiver is a node the redex names (?p.${op}[…])`);
  const self = env.nodeOf(recv.node);
  const type = ix.node.get(self)!.type;
  const h = hostOf(sig, type);
  const m = h?.arms.methods[op];
  if (!h || !m) throw new EvalError(`E-no-arm: ${sig.name(type)} has no arm for ${op}`);
  const nodes: Id[] = [];
  const vals: HostValue[] = [];
  for (const a of rest) if ('node' in a) nodes.push(env.nodeOf(a.node));
  else vals.push(value(a));
  const ctx = context(ix, h.config);
  let derived: unknown;
  if (m.derive) {
    const fn = h.arms.derive?.[m.derive];
    if (!fn) throw new EvalError(`${h.name}: no derivation ${m.derive}`);
    let memo = MEMO.get(ix.g);
    if (!memo) MEMO.set(ix.g, (memo = new Map()));
    const dargs = vals.slice(0, m.deriveArgs ?? 0);
    const key = `${h.name}|${m.derive}|${JSON.stringify(dargs)}|${readKey(ix, ctx, h.arms.reads, self)}|${nodes.map((n) => readKey(ix, ctx, h.arms.reads, n)).join('|')}`;
    if (memo.has(key)) derived = memo.get(key);
    else {
      derived = fn(self, nodes, ctx, dargs);
      if (memo.size > 100_000) memo.clear();
      memo.set(key, derived);
    }
  }
  return m.answer({ self, nodes, args: vals, ctx, derived });
}

// ── a world's instances, kept by its reactions ───────────────────────────────────────────────────────────────

function faceOf(ctx: HostCtx, sig: Signature, type: Id, node: Id): Face {
  const f: Face = {};
  for (const t of sig.ups(type))
    for (const a of sig.get(t).attrs) {
      const v = ctx.field(node, a.key);
      if (v !== undefined && !(a.key in f)) f[a.key] = v;
    }
  return f;
}

/** What a world must do to a node's face after the host has changed (in place: these nodes' payloads). */
export type WriteFace = (node: Id, face: Face) => Id[];

/**
 * After a reaction: make, apply, copy and drop the host instances it touched, then write each changed instance's
 * projection. Returns the scalar nodes written, which the world reports as revalued.
 */
export function settleHosts(
  ix: Index,
  sig: Signature,
  t: { created: Id[]; kept: Id[]; removed: Id[]; copied: [Id, Id][] },
  write: WriteFace,
): Id[] {
  const inst = store(ix.g);
  for (const id of t.removed) inst.delete(id);
  const changed: Id[] = [];
  // a member's state set by its place's apply (AtPlace): bumped, and projected with the rest
  const setMember = (node: Id, s: unknown) => {
    const i = inst.get(node);
    if (!i) throw new EvalError(`setState: node ${node} holds no host instance`);
    inst.set(node, { ...i, state: s, rev: ++REV });
    if (!changed.includes(node)) changed.push(node);
  };
  const touch = (id: Id, fresh: boolean, from?: Id) => {
    const n = ix.node.get(id);
    if (!n) return;
    const h = hostOf(sig, n.type);
    if (!h || !h.arms.make) return;
    const ctx = context(ix, h.config, sig, id, setMember);
    const face = faceOf(ctx, sig, n.type, id);
    const ch = h.arms.channel;
    const prev = inst.get(id);
    let state: unknown;
    if (ch && typeof face[ch] === 'string' && face[ch] !== '') state = h.arms.realize!(face[ch] as string, id, ctx);
    else if (from !== undefined && inst.has(from)) state = h.arms.realize!(h.arms.serialize!(inst.get(from)!.state), id, ctx);
    else if (fresh || !prev) state = h.arms.make(id, ctx);
    else {
      const diff = Object.keys(face).filter((k) => face[k] !== prev.seen[k]);
      if (!diff.length) return;
      state = h.arms.apply ? h.arms.apply(prev.state, id, diff, ctx) : prev.state;
    }
    inst.set(id, { host: h.name, state, rev: ++REV, seen: face });
    if (!changed.includes(id)) changed.push(id);
  };
  for (const id of t.created) touch(id, true);
  for (const [from, to] of t.copied) touch(to, true, from);
  for (const id of t.kept) touch(id, false);
  // the projections, after every instance has changed (a projection may read a neighbour)
  const written: Id[] = [];
  for (const id of changed) {
    const n = ix.node.get(id)!;
    const h = hostOf(sig, n.type)!;
    const ctx = context(ix, h.config);
    const i = inst.get(id)!;
    const out = h.arms.project ? h.arms.project(i.state, id, ctx) : {};
    if (h.arms.channel) out[h.arms.channel] = '';
    written.push(...write(id, out));
    i.seen = faceOf(ctx, sig, n.type, id);
  }
  return written;
}

/** Make every host instance a state holds (a world's start): realized from its channel where one is written. */
export function startHosts(ix: Index, sig: Signature, write: WriteFace): Id[] {
  const ids = ix.g.nodes.filter((n) => hostOf(sig, n.type)?.arms.make).map((n) => n.id);
  return settleHosts(ix, sig, { created: ids, kept: [], removed: [], copied: [] }, write);
}

/** The state with every host instance's whole state written to its channel: a value to print, keep or resume. */
export function serializeHosts(g: Carrier, ix: Index, sig: Signature): Carrier {
  const out = structuredClone(g);
  const inst = store(g);
  const at = new Map(out.nodes.map((n) => [n.id, n]));
  for (const [id, i] of inst) {
    const n = ix.node.get(id);
    const h = n && hostOf(sig, n.type);
    if (!h?.arms.channel || !h.arms.serialize) continue;
    const c = ix.childAt({ node: id }, attrKey(h.arms.channel));
    if (!c) throw new EvalError(`${sig.name(n!.type)}: no ${h.arms.channel} slot to serialize into`);
    (at.get(c.id) as { payload: unknown }).payload = { scalar: { text: h.arms.serialize(i.state) } };
  }
  return out;
}

/** A node's internal state, for observers (a viewer, a test). */
export function hostState<S>(g: Carrier, node: Id): S | undefined {
  return STORES.get(g)?.get(node)?.state as S | undefined;
}
