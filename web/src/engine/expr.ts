/**
 * Expressions: guards on rules and values computed in reactums.
 *
 * PROVISIONAL. In the spec, `?a + 1` is sugar for a call, `add[?a 1]`, answered by the kernel's rules for
 * operations (`docs/SYNTAX.md` §9), and guards are a planned part (`rules.guard`). Until those exist this engine
 * evaluates an expression in place, over what a rule's sites hold: a site holding exactly one scalar is that
 * scalar; `count[?x]` is how many things a site holds.
 */

import type { Scalar } from './carrier';

export type Expr = { lit: Scalar } | { site: number } | { type: string } | { op: string; args: Expr[] };

export class EvalError extends Error {}

/** What an expression can ask about the occurrence it is evaluated at. */
export interface Env {
  /** The scalar a site holds, if it holds exactly one. */
  scalar(site: number): Scalar | null;
  /** How many things a site holds; of a type (or a subtype of it), if one is given. */
  count(site: number, type?: string): number;
}

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
  if ('type' in e) return false;
  if ('site' in e) {
    const s = env.scalar(e.site);
    return !!s && 'int' in s;
  }
  if (['+', '-', '*', '%', 'neg', 'abs', 'min', 'max', 'clamp'].includes(e.op)) return e.args.every((a) => isInt(a, env));
  if (e.op === 'if') return isInt(e.args[1], env) && isInt(e.args[2], env);
  return ['count', 'floor', 'round'].includes(e.op);
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
};
export const BINARY = ['or', 'and', '==', '!=', '<', '<=', '>', '>=', '++', '+', '-', '*', '/', '%'];

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
  if ('lit' in e) return 'int' in e.lit ? 'int' : 'float' in e.lit ? 'float' : 'text' in e.lit ? 'text' : 'bool';
  if ('site' in e) return 'float';
  if (['==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not'].includes(e.op)) return 'bool';
  if (e.op === '++') return 'text';
  if (e.op === 'if') return kindOf(e.args[1]);
  if (e.op === 'count' || e.op === 'floor' || e.op === 'round') return 'int';
  return 'float';
}

/** Every site an expression reads. */
export function sitesOf(e: Expr): number[] {
  if ('lit' in e || 'type' in e) return [];
  if ('site' in e) return [e.site];
  return e.args.flatMap(sitesOf);
}
