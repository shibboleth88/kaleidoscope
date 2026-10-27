/**
 * Expressions: guards on rules and values computed in reactums.
 *
 * PROVISIONAL. In the spec, `?a + 1` is sugar for a call, `add[?a 1]`, answered by the kernel's rules for
 * operations (`docs/SYNTAX.md` §9), and guards are a planned part (`rules.guard`). Until those exist this engine
 * evaluates an expression in place, over what a rule's sites hold: a site holding exactly one scalar is that
 * scalar; `count[?x]` is how many things a site holds.
 */

import type { Scalar } from './carrier';

export type Expr =
  | { lit: Scalar }
  | { site: number }
  | { type: string }
  /** A rest of points (as `sum`, `count` and `shared` take it). */
  | { rest: string }
  /** Within `sum[?ps …]`: the attribute `key` of the node at the far end of the point being summed over. */
  | { restAttr: string; key: string }
  /** A node the redex names (`?p` where `?p = Cell[…]`): a host type's receiver or argument (host.ts). */
  | { node: number }
  /**
   * A field of the value a redex link holds (F97): `?v` where the redex has `~t :: T = V[k = ?v]`, or `~t.k`. The link
   * by its handle in the redex, as `handleKey` writes it (`e3` a closed edge, `x1` an outer name).
   */
  | { link: string; key: string }
  /** Within `sum[?ps …]`: the field `key` of the value held by the link of the point being summed over (`~ps.k`, F97). */
  | { restLink: string; key: string }
  /** An operation on its arguments; `let[name E]`, a value a rule names in its header (F104), read once per `Env`. */
  | { op: string; args: Expr[] };

export class EvalError extends Error {}

/** What an expression can ask about the occurrence it is evaluated at. */
export interface Env {
  /** The scalar a site holds, if it holds exactly one. */
  scalar(site: number): Scalar | null;
  /** How many things a site holds; of a type (or a subtype of it), if one is given. */
  count(site: number, type?: string): number;
  /** The nodes at the far ends of a rest's points (a point on a hyperedge: each other node on it). */
  far?(rest: string): number[];
  /** How many points a rest holds. */
  points?(rest: string): number;
  /** How many links two rests have in common. */
  shared?(a: string, b: string): number;
  /** The scalar attribute `key` of a node, if it has one. */
  attr?(node: number, key: string): Scalar | null;
  /** A field of the value held by the state link a redex link (by its handle in the redex, `e3` or `x1`) met (F97). */
  link?(handle: string, key: string): Scalar | null;
  /** Each point of a rest: the far node, and the edge the point is on (a point on a hyperedge: each other node on it). */
  farPoints?(rest: string): [number, number][];
  /** A field of the value an edge of the state holds. */
  edgeField?(edge: number, key: string): Scalar | null;
  /** The state node a redex node (by its identity in the redex) met. */
  nodeOf?(redexNode: number): number;
  /** The state and its signature, for a host type's arms (host.ts). */
  index?: import('./carrier').Index;
  sig?: import('./signature').Signature;
}

/** The pass of rating now under way (`withinPass`), numbered, or 0 outside one: an amount read in it is kept for it. */
let pass = 0, passes = 0;
/**
 * Runs `fn`, a pass of rating in which the state does not change, with each amount it reads worked out once: thousands
 * of occurrences reading the same place's classes (every translating ribosome's draws) then cost one reading (F78).
 */
export function withinPass<T>(fn: () => T): T {
  if (pass) return fn();
  pass = ++passes;
  try {
    return fn();
  } finally {
    pass = 0;
  }
}

/** What `?ps.x` reads: the far node being summed over, for each rest (set by `sum`). */
const current = new Map<string, number>();
/** What `~ps.k` reads: the edge of the point being summed over, for each rest (set by `sum`, where its body reads it). */
const currentEdge = new Map<string, number>();
/**
 * The sums already worked out at an occurrence (its `Env`), by what is summed. A state does not change while an
 * occurrence's expressions are evaluated, so a sum repeated within a guard or across a reactum's values (as there is
 * no `let` to name it, F36) is worked out once.
 */
const sums = new WeakMap<Env, Map<string, number>>();
/** The named values already worked out at an occurrence (its `Env`), by the `let` node naming them (F104). */
const lets = new WeakMap<Env, Map<Expr, V>>();

export const NO_SITES: Env = {
  scalar: () => {
    throw new EvalError('no sites here: a value written in a state is a constant');
  },
  count: () => {
    throw new EvalError('no sites here');
  },
};

type V = number | string | boolean;

const toV = (s: Scalar): V => ('int' in s ? s.int : 'float' in s ? s.float : 'text' in s ? s.text : s.bool);

/** A link value's field as an expression reads it, or null where the link holds none. */
const linkField = (e: { link: string; key: string } | { restLink: string; key: string }, env: Env): Scalar | null => {
  if ('link' in e) return env.link?.(e.link, e.key) ?? null;
  const edge = currentEdge.get(e.restLink);
  return edge === undefined ? null : (env.edgeField?.(edge, e.key) ?? null);
};

/** Whether a value is a whole number held as such (an Int), so arithmetic on Ints stays whole. */
const isInt = (e: Expr, env: Env): boolean => {
  if ('lit' in e) return 'int' in e.lit;
  if ('type' in e || 'rest' in e || 'node' in e) return false;
  if ('link' in e || 'restLink' in e) {
    const s = linkField(e, env);
    return !!s && 'int' in s;
  }
  if ('restAttr' in e) {
    const n = current.get(e.restAttr);
    const s = n === undefined ? null : (env.attr?.(n, e.key) ?? null);
    return !!s && 'int' in s;
  }
  if ('site' in e) {
    const s = env.scalar(e.site);
    return !!s && 'int' in s;
  }
  if (['+', '-', '*', '%', 'neg', 'abs', 'min', 'max', 'clamp'].includes(e.op)) return e.args.every((a) => isInt(a, env));
  if (e.op === 'if') return isInt(e.args[1], env) && isInt(e.args[2], env);
  if (e.op === 'let') return isInt(e.args[1], env);
  if (e.op === 'query') return (e.args[0] as { lit: { text: string } }).lit.text === 'count';
  if (e.op === 'qattr') {
    const n = current.get((e.args[0] as { lit: { text: string } }).lit.text);
    const s = n === undefined ? null : (env.attr?.(n, (e.args[1] as { lit: { text: string } }).lit.text) ?? null);
    return !!s && 'int' in s;
  }
  return ['count', 'floor', 'round', 'shared'].includes(e.op);
};

const num = (v: V, op: string): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new EvalError(`${op} takes numbers, not "${v}"`);
};

/**
 * A rate is real-valued (chrysalis D-a-rate-is-real, kaleidoscope F64): division in a rate is the true quotient, never
 * floored, the same on the graph as on a flow's relaxed counts. Each division's dividend is made real (`1.0 * a`), so
 * every evaluator (this one, a policy's compiled form) reads it so; a reactum's integer arithmetic keeps its floor.
 */
export function realDivision(e: Expr): Expr {
  if (!('op' in e)) return e;
  const args = e.args.map(realDivision);
  if (e.op === '/') return { ...e, args: [{ op: '*', args: [{ lit: { float: 1 } }, args[0]] }, args[1]] };
  return args.every((a, i) => a === e.args[i]) ? e : { ...e, args };
}

/** The count attribute of a keyed type (`Type[keyed = "n"]`, on it or a supertype), or null (F69). */
export function keyedCountOf(sig: import('./signature').Signature, type: number): string | null {
  for (const t of sig.ups(type)) {
    const k = sig.types.find((x) => x.id === t)?.style?.keyed;
    if (typeof k === 'string') return k;
  }
  return null;
}

/**
 * The queries an expression makes (F105): each `count[T(…) in ?p]` or `sum[T(…) in ?p -> E]`, by the redex node naming
 * its place, the type its pattern meets, and the attribute keys it reads of each occurrence (its literals and bindings).
 */
export function queriesOf(e: Expr | undefined, out: { place: number; type: string; keys: string[] }[] = []): { place: number; type: string; keys: string[] }[] {
  if (!e || !('op' in e)) return out;
  if (e.op === 'query') {
    const [, , p, t, filters, binds] = e.args as [Expr, Expr, { node: number }, { type: string }, { op: string; args: Expr[] }, { op: string; args: { lit: { text: string } }[] }];
    out.push({ place: p.node, type: t.type, keys: [...filters.args.map((f) => ((f as { args: Expr[] }).args[0] as { lit: { text: string } }).lit.text), ...binds.args.map((b) => b.lit.text)] });
  }
  for (const a of e.args) queriesOf(a, out);
  return out;
}
export const readsQuery = (e: Expr | undefined): boolean => queriesOf(e).length > 0;

/** Whether an expression reads an amount of a class (F71): what its place holds, beyond its sites. */
export function readsAmount(e: Expr | undefined): boolean {
  if (!e || !('op' in e)) return false;
  return e.op === 'amount' || e.args.some(readsAmount);
}

/** Each function and how many values it takes (count: a site, and perhaps a type). */
export const FUNCTIONS: Record<string, [number, number]> = {
  min: [2, 2], max: [2, 2], abs: [1, 1], sqrt: [1, 1], floor: [1, 1], round: [1, 1], exp: [1, 1], log: [1, 1], count: [1, 2],
  /** if[c a b]: a where c holds, else b (only the one taken is worked out). */
  if: [3, 3],
  /** clamp[v lo hi]. */
  clamp: [3, 3],
  /** hypot[x y] or hypot[x y z]: the length of a vector. */
  hypot: [2, 3],
  /** sum[?ps E]: E summed over the node at the far end of each point of the rest ?ps, ?ps.x its x. */
  sum: [2, 2],
  /** shared[?ps ?qs]: how many links two rests of points have in common. */
  shared: [2, 2],
  /**
   * amount[?p Type[k = v | …]]: the molecules of a class (F71; chrysalis R-aggregates-in-rates-maintained, boundary's
   * B3): the counts of the keyed entries of Type (or a subtype) that the redex's node ?p holds, whose attributes k equal
   * v, summed. Entries are `Type[keyed = "n"]` (F69).
   */
  amount: [2, 2],
  /** take[?p Type[…] k Type[…]]: a draw of a class, written only as a rule's `draw` (F72); no value. */
  take: [4, 4],
};
export const BINARY = ['or', 'and', '==', '!=', '<', '<=', '>', '>=', '++', '+', '-', '*', '/', '%'];

/**
 * Native operations, registered by a program's host (PROVISIONAL; wyrm's ask, "folds over a node's links"): a name the
 * reader accepts as a call, answered by host code given the call's arguments unevaluated, the occurrence's `Env` (so a
 * rest of points can be folded: `env.far`, `env.attr`) and a way to evaluate an argument. A native given a rest reads
 * across links (`readsAcross`), as `sum` does. Its answer is a value like any other; it should be a pure function of
 * what it reads, and it may memoise per `Env` (a state does not change while an occurrence is evaluated).
 */
export type Native = (args: Expr[], env: Env, value: (e: Expr) => number | string | boolean) => number | string | boolean;
export const NATIVE = new Map<string, Native>();
/** Host types' methods (host.ts): a call dispatched on its receiver's type, answered by the type's arm. */
export const HOST_CALL: { methods: Set<string>; call: ((op: string, args: Expr[], env: Env, value: (e: Expr) => V) => V) | null } = { methods: new Set(), call: null };
export function registerNative(name: string, arity: [number, number], fn: Native) {
  if (name in FUNCTIONS && !NATIVE.has(name)) throw new EvalError(`${name} is an operation already`);
  FUNCTIONS[name] = arity;
  NATIVE.set(name, fn);
}

/** An expression compiled: a closure per node of it, built once (expressions are evaluated constantly). */
type Compiled = (env: Env) => V;
const compiledCache = new WeakMap<Expr, Compiled>();

function compileExpr(e: Expr): Compiled {
  const hit = compiledCache.get(e);
  if (hit) return hit;
  let f: Compiled;
  if ('lit' in e) {
    const v = toV(e.lit);
    f = () => v;
  } else if ('site' in e) {
    const i = e.site;
    f = (env) => {
      const s = env.scalar(i);
      if (!s) throw new EvalError('a site in an expression must hold one value');
      return toV(s);
    };
  } else if ('type' in e) {
    f = () => interpret(e, NO_SITES);
  } else if ('rest' in e) {
    const r = e.rest;
    f = () => {
      throw new EvalError(`?${r} is a rest of points: sum[?${r} …], count[?${r}] or shared[?${r} …] read it`);
    };
  } else if ('restAttr' in e) {
    const { restAttr: r, key } = e;
    f = (env) => {
      const n = current.get(r);
      if (n === undefined) throw new EvalError(`?${r}.${key} is read within sum[?${r} …]`);
      const v = env.attr?.(n, key);
      if (!v) throw new EvalError(`a node at the far end of ?${r} has no ${key}`);
      return toV(v);
    };
  } else if ('node' in e) {
    f = () => {
      throw new EvalError('a named node stands only as a host method\'s receiver or argument');
    };
  } else if ('link' in e || 'restLink' in e) {
    const x = e;
    f = (env) => {
      if ('restLink' in x && !currentEdge.has(x.restLink)) throw new EvalError(`~${x.restLink}.${x.key} is read within sum[?${x.restLink} …]`);
      const v = linkField(x, env);
      if (!v) throw new EvalError(`a link holds no value with ${x.key}`);
      return toV(v);
    };
  } else if (e.op === 'sum') {
    const [over, body] = e.args;
    if (!('rest' in over)) throw new EvalError('sum[?ps E]: the first is a rest of points');
    const r = over.rest;
    const b = compileExpr(body);
    const key = JSON.stringify(e);
    // (each point's link worked out only where the body reads its value, `~ps.k`: a sum of far attributes costs as it did)
    const byPoint = readsRestLink(body, r);
    f = (env) => {
      // a sum not within another is the same wherever it is written: worked out once per occurrence
      const top = current.size === 0;
      if (top) {
        const hit = sums.get(env)?.get(key);
        if (hit !== undefined) return hit;
      }
      const outer = current.get(r), outerEdge = currentEdge.get(r);
      let total = 0;
      try {
        if (byPoint)
          for (const [n, edge] of env.farPoints?.(r) ?? []) {
            current.set(r, n);
            currentEdge.set(r, edge);
            total += num(b(env), 'sum');
          }
        else
          for (const n of env.far?.(r) ?? []) {
            current.set(r, n);
            total += num(b(env), 'sum');
          }
      } finally {
        if (outer === undefined) current.delete(r);
        else current.set(r, outer);
        if (byPoint) {
          if (outerEdge === undefined) currentEdge.delete(r);
          else currentEdge.set(r, outerEdge);
        }
      }
      if (top) {
        let m = sums.get(env);
        if (!m) sums.set(env, (m = new Map()));
        m.set(key, total);
      }
      return total;
    };
  } else if (e.op === 'query') {
    // a query over a place (F105): the nodes of the pattern's type (or below it) within the place a redex node names, at
    // any depth (but no node's attributes), whose attributes meet the pattern's: counted, or each folded into the sum
    const [fold, qid, p, t, filters, binds, body] = e.args as [{ lit: { text: string } }, { lit: { text: string } }, { node: number }, { type: string }, { args: { args: Expr[] }[] }, { args: { lit: { text: string } }[] }, Expr | undefined];
    const keys = filters.args.map((x) => (x.args[0] as { lit: { text: string } }).lit.text);
    const wants = filters.args.map((x) => compileExpr(x.args[1]));
    const needs = binds.args.map((b) => b.lit.text);
    const each = body ? compileExpr(body) : null;
    const q = qid.lit.text, memo = JSON.stringify(e);
    // (a body reading only what the query met is the same at every occurrence meeting the place: within a pass of
    // rating that changes nothing, worked out once a place and its literals' values, as an amount is, F78)
    const own = (x: Expr): boolean => 'lit' in x || ('op' in x && x.op !== 'query' && x.op !== 'amount' && x.op !== 'let' && !HOST_CALL.methods.has(x.op) && !NATIVE.has(x.op) && x.args.every(own));
    const shared = !body || own(body);
    const kept = Object.assign(new Map<string, number>(), { pass: 0 });
    f = (env) => {
      const ix = env.index, sig = env.sig;
      if (!ix || !sig || !env.nodeOf || !env.attr) throw new EvalError(`${fold.lit.text}[… in ?p]: no state here`);
      // (worked out once per occurrence, as a sum is, where no fold's term is under way)
      const top = current.size === 0;
      if (top) {
        const hit = sums.get(env)?.get(memo);
        if (hit !== undefined) return hit;
      }
      if (!sig.has(t.type)) return 0;
      const T = sig.id(t.type), want = wants.map((w) => w(env));
      const pk = pass && shared ? `${env.nodeOf(p.node)}|${want.map(String).join('|')}` : '';
      if (pk) {
        if (kept.pass !== pass) kept.clear(), (kept.pass = pass);
        const hit = kept.get(pk);
        if (hit !== undefined) return hit;
      }
      let total = 0;
      const outer = current.get(q);
      try {
        const stack = [...ix.children({ node: env.nodeOf(p.node) })];
        while (stack.length) {
          const c = stack.pop()!;
          if ('attr' in c.member) continue;
          for (const k of ix.children({ node: c.id })) stack.push(k);
          if (!sig.sub(c.type, T)) continue;
          let ok = true;
          for (let i = 0; i < keys.length && ok; i++) {
            const v = env.attr(c.id, keys[i]);
            ok = !!v && toV(v) === want[i];
          }
          for (let i = 0; i < needs.length && ok; i++) ok = !!env.attr(c.id, needs[i]);
          if (!ok) continue;
          if (!each) total += 1;
          else {
            current.set(q, c.id);
            total += num(each(env), 'sum');
          }
        }
      } finally {
        if (outer === undefined) current.delete(q);
        else current.set(q, outer);
      }
      if (top) {
        let m = sums.get(env);
        if (!m) sums.set(env, (m = new Map()));
        m.set(memo, total);
      }
      if (pk) kept.set(pk, total);
      return total;
    };
  } else if (e.op === 'qattr') {
    const q = (e.args[0] as { lit: { text: string } }).lit.text, key = (e.args[1] as { lit: { text: string } }).lit.text;
    f = (env) => {
      const n = current.get(q);
      if (n === undefined) throw new EvalError(`a query's variable is read within its query`);
      const v = env.attr?.(n, key);
      if (!v) throw new EvalError(`a node a query met has no ${key}`);
      return toV(v);
    };
  } else if (e.op === 'let') {
    // a value the rule names in its header, `R[x = E]` (F104): worked out once where it is first read at an occurrence,
    // then read as worked out (an occurrence's state does not change while its expressions are evaluated). Not within a
    // fold's term, where it could read the point being summed.
    const inner = compileExpr(e.args[1]);
    f = (env) => {
      if (current.size) return inner(env);
      let m = lets.get(env);
      if (!m) lets.set(env, (m = new Map()));
      let v = m.get(e);
      if (v === undefined) m.set(e, (v = inner(env)));
      return v;
    };
  } else if (e.op === 'amount') {
    const [p, cls] = e.args;
    if (!('node' in p) || !('op' in cls) || cls.op !== 'class') throw new EvalError('amount[?p Type[…]]: a node the redex names, and a class');
    const [t, ...filters] = cls.args as [{ type: string }, ...{ op: string; args: Expr[] }[]];
    const keys = filters.map((x) => (x.args[0] as { lit: { text: string } }).lit.text);
    const vals = filters.map((x) => compileExpr(x.args[1]));
    // (this amount's readings in the pass under way, by place and its filters' values)
    const kept = Object.assign(new Map<number | string, number>(), { pass: 0 });
    f = (env) => {
      const ix = env.index, sig = env.sig;
      if (!ix || !sig || !env.nodeOf || !env.attr) throw new EvalError('amount: no state here');
      if (!sig.has(t.type)) return 0;
      const T = sig.id(t.type), want = vals.map((v) => v(env)), place = env.nodeOf(p.node);
      // (within a pass of rating that changes nothing, a place's amount of a class is read once, F78)
      const mk = pass && (keys.length ? `${place}|${want.map(String).join('|')}` : place);
      if (pass) {
        const hit = kept.get(mk);
        if (kept.pass === pass && hit !== undefined) return hit;
        if (kept.pass !== pass) kept.clear(), (kept.pass = pass);
      }
      let total = 0;
      // (the class's entries in the place, listed once until one joins or leaves it, F78)
      for (const c of ix.childrenOf({ node: place }, sig, t.type, (c) => sig.sub(c.type, T) && keyedCountOf(sig, c.type) !== null)) {
        const ck = keyedCountOf(sig, c.type)!;
        let ok = true;
        for (let i = 0; i < keys.length && ok; i++) {
          const v = env.attr(c.id, keys[i]);
          ok = !!v && toV(v) === want[i];
        }
        if (!ok) continue;
        const n = env.attr(c.id, ck);
        if (n) total += num(toV(n), 'amount');
      }
      if (pass) kept.set(mk, total);
      return total;
    };
  } else if (e.op === 'take' || e.op === 'class' || e.op === 'is') {
    throw new EvalError(`${e.op}[…] is no value: a draw is a rule's \`draw\` (F72)`);
  } else if (e.op === 'shared') {
    const [a, b] = e.args;
    if (!('rest' in a) || !('rest' in b)) throw new EvalError('shared[?ps ?qs] takes two rests of points');
    f = (env) => env.shared?.(a.rest, b.rest) ?? 0;
  } else if (e.op === 'count' && 'rest' in e.args[0]) {
    const r = e.args[0].rest;
    f = (env) => env.points?.(r) ?? 0;
  } else if (HOST_CALL.methods.has(e.op)) {
    const op = e.op, args = e.args;
    f = (env) => HOST_CALL.call!(op, args, env, (x) => value(x, env));
  } else if (NATIVE.has(e.op)) {
    const fn = NATIVE.get(e.op)!;
    const args = e.args;
    f = (env) => fn(args, env, (x) => value(x, env));
  } else {
    const op = e.op;
    const a = e.args.map(compileExpr);
    const n2 = (x: V, y: V, o: (p: number, q: number) => V): V => o(num(x, op), num(y, op));
    switch (op) {
      case '+': f = (env) => n2(a[0](env), a[1](env), (p, q) => p + q); break;
      case '-': f = (env) => n2(a[0](env), a[1](env), (p, q) => p - q); break;
      case '*': f = (env) => n2(a[0](env), a[1](env), (p, q) => p * q); break;
      case '<': f = (env) => n2(a[0](env), a[1](env), (p, q) => p < q); break;
      case '<=': f = (env) => n2(a[0](env), a[1](env), (p, q) => p <= q); break;
      case '>': f = (env) => n2(a[0](env), a[1](env), (p, q) => p > q); break;
      case '>=': f = (env) => n2(a[0](env), a[1](env), (p, q) => p >= q); break;
      case 'and': f = (env) => Boolean(a[0](env)) && Boolean(a[1](env)); break;
      case 'or': f = (env) => Boolean(a[0](env)) || Boolean(a[1](env)); break;
      case 'not': f = (env) => !a[0](env); break;
      case 'neg': f = (env) => -num(a[0](env), op); break;
      case 'if': f = (env) => (a[0](env) ? a[1](env) : a[2](env)); break;
      case 'hypot':
        f = a.length === 3 ? (env) => Math.hypot(num(a[0](env), op), num(a[1](env), op), num(a[2](env), op)) : (env) => Math.hypot(num(a[0](env), op), num(a[1](env), op));
        break;
      case 'sqrt': f = (env) => Math.sqrt(num(a[0](env), op)); break;
      case 'max': f = (env) => Math.max(num(a[0](env), op), num(a[1](env), op)); break;
      case 'min': f = (env) => Math.min(num(a[0](env), op), num(a[1](env), op)); break;
      case 'clamp': f = (env) => Math.min(Math.max(num(a[0](env), op), num(a[1](env), op)), num(a[2](env), op)); break;
      case '/': {
        // division compiled too (it is in most rate laws): a whole number where both sides are, as `interpret` says
        const [ea, eb] = e.args;
        f = (env) => {
          const p = num(a[0](env), op), q = num(a[1](env), op);
          if (q === 0) throw new EvalError('division by zero');
          // (a fractional side is no whole number: no need to ask the kinds)
          return Number.isInteger(p) && Number.isInteger(q) && isInt(ea, env) && isInt(eb, env) ? Math.floor(p / q) : p / q;
        };
        break;
      }
      // the rest (division's whole-number rule, count, text) as written below
      default: f = (env) => interpret(e, env);
    }
  }
  compiledCache.set(e, f);
  return f;
}

function value(e: Expr, env: Env): V {
  return compileExpr(e)(env);
}

function interpret(e: Expr, env: Env): V {
  if ('lit' in e) return toV(e.lit);
  if ('site' in e) {
    const s = env.scalar(e.site);
    if (!s) throw new EvalError('a site in an expression must hold one value');
    return toV(s);
  }
  if ('type' in e) throw new EvalError(`${e.type} is a type: count[?x ${e.type}] counts them`);
  if ('rest' in e || 'restAttr' in e || 'node' in e || 'link' in e || 'restLink' in e) return compileExpr(e)(env);
  const { op, args } = e;
  if (op === 'count') {
    const [a, t] = args;
    if (!a || !('site' in a)) throw new EvalError('count takes a site: count[?x], or count[?x Type]');
    if (t && !('type' in t)) throw new EvalError('count[?x Type]: the second is a type');
    return env.count(a.site, t && 'type' in t ? t.type : undefined);
  }
  if (op === 'if') return value(args[0], env) ? value(args[1], env) : value(args[2], env);
  const vs = args.map((a) => value(a, env));
  const [a, b] = vs;
  switch (op) {
    case 'neg': return -num(a, op);
    case 'not': return !a;
    case 'and': return Boolean(a) && Boolean(b);
    case 'or': return Boolean(a) || Boolean(b);
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return num(a, op) < num(b, op);
    case '<=': return num(a, op) <= num(b, op);
    case '>': return num(a, op) > num(b, op);
    case '>=': return num(a, op) >= num(b, op);
    case '++': return `${a}${b}`;
    case '+': return num(a, op) + num(b, op);
    case '-': return num(a, op) - num(b, op);
    case '*': return num(a, op) * num(b, op);
    case '/': {
      if (num(b, op) === 0) throw new EvalError('division by zero');
      const q = num(a, op) / num(b, op);
      return isInt(args[0], env) && isInt(args[1], env) ? Math.floor(q) : q;
    }
    case '%': {
      if (num(b, op) === 0) throw new EvalError('division by zero');
      return num(a, op) % num(b, op);
    }
    case 'min': return Math.min(num(a, op), num(b, op));
    case 'max': return Math.max(num(a, op), num(b, op));
    case 'abs': return Math.abs(num(a, op));
    case 'sqrt': return Math.sqrt(num(a, op));
    case 'floor': return Math.floor(num(a, op));
    case 'round': return Math.round(num(a, op));
    case 'exp': return Math.exp(num(a, op));
    case 'clamp': return Math.min(Math.max(num(a, op), num(b, op)), num(vs[2], op));
    case 'hypot': return Math.hypot(...vs.map((v) => num(v, op)));
    case 'log': return Math.log(num(a, op));
  }
  throw new EvalError(`no operation ${op}`);
}

/** A guard holds. */
export function holds(e: Expr, env: Env): boolean {
  return Boolean(value(e, env));
}

export type ScalarKind = 'int' | 'float' | 'text' | 'bool';

/** An expression's value, as a scalar of the kind its slot takes. */
export function evaluate(e: Expr, env: Env, kind: ScalarKind): Scalar {
  const v = value(e, env);
  switch (kind) {
    case 'int': {
      const n = num(v, 'an Int');
      if (!Number.isFinite(n)) throw new EvalError('not a number');
      return { int: Math.floor(n) };
    }
    case 'float': {
      const n = num(v, 'a Float');
      if (!Number.isFinite(n)) throw new EvalError('not a number');
      return { float: n };
    }
    case 'text': return { text: String(v) };
    case 'bool': return { bool: Boolean(v) };
  }
}

/** The kind an expression gives where nothing else says (no slot declares it). */
export function kindOf(e: Expr): ScalarKind {
  if ('type' in e) return 'text';
  if ('rest' in e || 'restAttr' in e || 'node' in e || 'link' in e || 'restLink' in e) return 'float';
  if ('lit' in e) return 'int' in e.lit ? 'int' : 'float' in e.lit ? 'float' : 'text' in e.lit ? 'text' : 'bool';
  if ('site' in e) return 'float';
  if (['==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not'].includes(e.op)) return 'bool';
  if (e.op === '++') return 'text';
  if (e.op === 'if' || e.op === 'let') return kindOf(e.args[1]);
  if (e.op === 'count' || e.op === 'floor' || e.op === 'round' || e.op === 'shared') return 'int';
  if (e.op === 'query') return (e.args[0] as { lit: { text: string } }).lit.text === 'count' ? 'int' : 'float';
  return 'float';
}

/** Every site an expression reads. */
export function sitesOf(e: Expr): number[] {
  if ('lit' in e || 'type' in e || 'rest' in e || 'restAttr' in e || 'node' in e || 'link' in e || 'restLink' in e) return [];
  if ('site' in e) return [e.site];
  return e.args.flatMap(sitesOf);
}

/** Whether an expression reads a link's value (F97): a redex link's field, or within a sum each point's link's. */
export function readsLinks(e: Expr | undefined): boolean {
  if (!e || 'lit' in e || 'site' in e || 'type' in e || 'rest' in e || 'node' in e || 'restAttr' in e) return false;
  if ('link' in e || 'restLink' in e) return true;
  return e.args.some(readsLinks);
}

/** Whether an expression reads, as `~r.k`, the link of the point of rest `r` being summed over. */
function readsRestLink(e: Expr, r: string): boolean {
  if ('restLink' in e) return e.restLink === r;
  if (!('op' in e)) return false;
  return e.args.some((a) => readsRestLink(a, r));
}

/**
 * What an expression reads across links (F101): for each rest of points, the attribute keys it reads of the far nodes
 * (`?ps.x` within `sum[?ps …]`), or 'all' where a native folds the rest and may read any. 'unknown' where what is read
 * is not known by rest (a host method reads across its receiver's links, whichever its type declares).
 */
export function acrossReads(e: Expr | undefined, out: Map<string, Set<string> | 'all'> = new Map()): Map<string, Set<string> | 'all'> | 'unknown' {
  if (!e || !('op' in e || 'restAttr' in e)) return out;
  if ('restAttr' in e) {
    const now = out.get(e.restAttr);
    if (now !== 'all') (now ?? out.set(e.restAttr, new Set()).get(e.restAttr) as Set<string>).add(e.key);
    return out;
  }
  if (HOST_CALL.methods.has(e.op)) return 'unknown';
  if (NATIVE.has(e.op)) for (const a of e.args) if ('rest' in a) out.set(a.rest, 'all');
  // (a sum has a term for each far point: it reads the rest's links' points whatever its body reads of them, F103)
  if (e.op === 'sum' && 'rest' in e.args[0] && !out.has(e.args[0].rest)) out.set(e.args[0].rest, new Set());
  for (const a of e.args) if (acrossReads(a, out) === 'unknown') return 'unknown';
  return out;
}

/** Whether an expression folds over a rest of points (`sum[?ps …]`, or a native given one): it reads who is on its links. */
export function foldsRest(e: Expr | undefined): boolean {
  if (!e || !('op' in e)) return false;
  if ((e.op === 'sum' || NATIVE.has(e.op) || HOST_CALL.methods.has(e.op)) && e.args.some((a) => 'rest' in a)) return true;
  return e.args.some(foldsRest);
}

/** Whether an expression reads the nodes at the far ends of a rest's points (their attributes). */
export function readsAcross(e: Expr | undefined): boolean {
  // (a link's value read across a point, `~ps.k`, is no far node's attribute: discovery stales it by the edge, F97)
  if (!e || 'lit' in e || 'site' in e || 'type' in e || 'rest' in e || 'node' in e || 'link' in e || 'restLink' in e) return false;
  if ('restAttr' in e) return true;
  // a host method reads what its type declares, across the receiver's links among it
  if (HOST_CALL.methods.has(e.op)) return true;
  if (NATIVE.has(e.op) && e.args.some((a) => 'rest' in a)) return true;
  return e.args.some(readsAcross);
}
