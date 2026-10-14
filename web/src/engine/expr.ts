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
  /** The state node a redex node (by its identity in the redex) met. */
  nodeOf?(redexNode: number): number;
  /** The state and its signature, for a host type's arms (host.ts). */
  index?: import('./carrier').Index;
  sig?: import('./signature').Signature;
}

/** What `?ps.x` reads: the far node being summed over, for each rest (set by `sum`). */
const current = new Map<string, number>();
/**
 * The sums already worked out at an occurrence (its `Env`), by what is summed. A state does not change while an
 * occurrence's expressions are evaluated, so a sum repeated within a guard or across a reactum's values (as there is
 * no `let` to name it, F36) is worked out once.
 */
const sums = new WeakMap<Env, Map<string, number>>();

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

/** Whether a value is a whole number held as such (an Int), so arithmetic on Ints stays whole. */
const isInt = (e: Expr, env: Env): boolean => {
  if ('lit' in e) return 'int' in e.lit;
  if ('type' in e || 'rest' in e || 'node' in e) return false;
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
  return ['count', 'floor', 'round', 'shared'].includes(e.op);
};

const num = (v: V, op: string): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new EvalError(`${op} takes numbers, not "${v}"`);
};

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
  } else if (e.op === 'sum') {
    const [over, body] = e.args;
    if (!('rest' in over)) throw new EvalError('sum[?ps E]: the first is a rest of points');
    const r = over.rest;
    const b = compileExpr(body);
    const key = JSON.stringify(e);
    f = (env) => {
      // a sum not within another is the same wherever it is written: worked out once per occurrence
      const top = current.size === 0;
      if (top) {
        const hit = sums.get(env)?.get(key);
        if (hit !== undefined) return hit;
      }
      const outer = current.get(r);
      let total = 0;
      try {
        for (const n of env.far?.(r) ?? []) {
          current.set(r, n);
          total += num(b(env), 'sum');
        }
      } finally {
        if (outer === undefined) current.delete(r);
        else current.set(r, outer);
      }
      if (top) {
        let m = sums.get(env);
        if (!m) sums.set(env, (m = new Map()));
        m.set(key, total);
      }
      return total;
    };
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
  if ('rest' in e || 'restAttr' in e || 'node' in e) return compileExpr(e)(env);
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
  if ('rest' in e || 'restAttr' in e || 'node' in e) return 'float';
  if ('lit' in e) return 'int' in e.lit ? 'int' : 'float' in e.lit ? 'float' : 'text' in e.lit ? 'text' : 'bool';
  if ('site' in e) return 'float';
  if (['==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not'].includes(e.op)) return 'bool';
  if (e.op === '++') return 'text';
  if (e.op === 'if') return kindOf(e.args[1]);
  if (e.op === 'count' || e.op === 'floor' || e.op === 'round' || e.op === 'shared') return 'int';
  return 'float';
}

/** Every site an expression reads. */
export function sitesOf(e: Expr): number[] {
  if ('lit' in e || 'type' in e || 'rest' in e || 'restAttr' in e || 'node' in e) return [];
  if ('site' in e) return [e.site];
  return e.args.flatMap(sitesOf);
}

/** Whether an expression reads the nodes at the far ends of a rest's points (their attributes). */
export function readsAcross(e: Expr | undefined): boolean {
  if (!e || 'lit' in e || 'site' in e || 'type' in e || 'rest' in e || 'node' in e) return false;
  if ('restAttr' in e) return true;
  // a host method reads what its type declares, across the receiver's links among it
  if (HOST_CALL.methods.has(e.op)) return true;
  if (NATIVE.has(e.op) && e.args.some((a) => 'rest' in a)) return true;
  return e.args.some(readsAcross);
}
