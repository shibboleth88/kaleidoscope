/**
 * Programs: a whole text in v004's syntax (`docs/SYNTAX.md` in `../chrysalis`), read into what the engine runs.
 *
 *   Program(
 *     module = (                                   # what names mean
 *       lib = Module["lib"]                        # another module's declarations, loaded beside these
 *       Cell[mass :: Float = 1.0] = Type(<: Thing) # a type: attributes and ports in [], supertypes and slots in ()
 *       grow[rate = 0.5 * ?m] =                    # a rule; its node's attributes in [] (gap G7: rate, label)
 *         ?c = Cell[mass = ?m] => ?c = Cell[mass = ?m + 0.1]
 *     )
 *     world = ( Cell[mass = 2.0] )                 # the state the run starts from
 *     run = ( seed = 7 | horizon = 100.0 )         # the run's values, read by whatever runs it
 *   )
 *
 * Kaleidoscope's readings, beyond what the spec has settled (each a finding in docs/SPEC-FINDINGS.md):
 * - a rule's rate is the attribute `rate` of its node, written `name[rate = …] = rule` (G7 is `proposed`);
 * - a slot in a type's body (`()`) is read but not enforced: a composite node here holds anything;
 * - a default is a constant, filled where a node is made (a state's nodes, a reactum's fresh ones);
 * - a module is a text of declarations; `Module["p"]` is answered as it is read, by the caller's `load`.
 */

import { splitKeyed } from './keyed';
import type { Carrier, Scalar } from './carrier';
import { type Rule, checkRule } from './rule';
import { Signature, type TypeSpec } from './signature';
import {
  type Item,
  type ModuleAst,
  type ProgramAst,
  ReadError,
  type TypeAst,
  type Value,
  buildRule,
  buildState,
  parseModule,
  parseProgram,
  valueText,
} from './text';
import { NO_SITES, evaluate, kindOf } from './expr';

export interface Program {
  sig: Signature;
  rules: Rule[];
  /** Each rule's node attributes beside its rate (a label, say), as written. */
  ruleAttrs: Map<string, Record<string, string>>;
  world: Carrier;
  /** The run part's members: a scalar where one is written, else its text. */
  run: Record<string, Scalar | string>;
  /** Every type declared, with where it came from. */
  types: (TypeAst & { module: string })[];
}

/** Read a program's text, loading the modules it names by `load` (a path to that module's text). */
export function readProgram(src: string, load: (path: string) => string = () => {
  throw new ReadError('this program loads modules, and no loader was given');
}): Program {
  const ast = parseProgram(src);
  const types: (TypeAst & { module: string })[] = ast.types.map((t) => ({ ...t, module: '' }));
  const rules = [...ast.rules];
  const seen = new Set<string>();
  const visit = (m: ModuleAst) => {
    for (const ref of m.modules) {
      if (seen.has(ref.path)) continue;
      seen.add(ref.path);
      let mod: ModuleAst;
      try {
        mod = parseModule(load(ref.path));
      } catch (e) {
        throw new ReadError(`module ${ref.path}: ${(e as Error).message}`);
      }
      types.push(...mod.types.map((t) => ({ ...t, module: ref.path })));
      rules.push(...mod.rules);
      visit(mod);
    }
  };
  visit(ast);
  return buildProgram({ ...ast, rules }, types);
}

const constant = (v: Value, kind?: 'int' | 'float' | 'text' | 'bool'): Scalar => {
  if (v.k === 'lit' && !kind) return v.v;
  if (v.k === 'lit' || v.k === 'expr') {
    const e = toConst(v);
    return evaluate(e, NO_SITES, kind ?? kindOf(e));
  }
  throw new ReadError(`a default is a constant, not ${valueText(v)}`);
};

function toConst(v: Value): import('./expr').Expr {
  if (v.k === 'lit') return { lit: v.v };
  if (v.k === 'expr') return { op: v.op, args: v.args.map(toConst) };
  throw new ReadError(`a constant is made of literals and operations, not ${valueText(v)}`);
}

export function buildProgram(ast: ProgramAst, types: (TypeAst & { module: string })[]): Program {
  // types: a slot is a port where it is written as one, or where its type is a link (Link, or within it)
  const names = new Set(types.map((t) => t.name));
  for (const t of types) if (types.filter((x) => x.name === t.name).length > 1) throw new ReadError(`${t.name} is declared twice`);
  const linkish = new Set(['Link']);
  for (let more = true; more; ) {
    more = false;
    for (const t of types) if (!linkish.has(t.name) && t.supers.some((s) => linkish.has(s))) linkish.add(t.name), (more = true);
  }
  const KIND: Record<string, 'int' | 'float' | 'text' | 'bool'> = { Int: 'int', Float: 'float', Text: 'text', Bool: 'bool' };
  const kindOfType = (name: string): 'int' | 'float' | 'text' | 'bool' | undefined => {
    for (let n: string | undefined = name; n; n = types.find((t) => t.name === n)?.supers[0]) if (KIND[n]) return KIND[n];
    return undefined;
  };
  const specs: Record<string, TypeSpec> = {};
  for (const t of types) {
    const spec: TypeSpec = { supers: t.supers, ports: {}, attrs: {}, style: {} };
    if (linkish.has(t.name)) spec.kind = 'link';
    const k = scalarKindOf(t, types);
    if (k) spec.kind = k;
    for (const s of t.binder) {
      if (!names.has(s.type) && !['Link', 'Int', 'Float', 'Text', 'Bool', 'Place'].includes(s.type))
        throw new ReadError(`${t.name}: no type named ${s.type}`);
      if (s.port || linkish.has(s.type)) spec.ports![s.key] = s.arity !== undefined && s.arity !== 1 ? [s.type, s.arity] : s.type;
      else spec.attrs![s.key] = s.dflt ? { type: s.type, dflt: constant(s.dflt, kindOfType(s.type)) } : s.type;
    }
    for (const it of t.attrs) if (it.k === 'member' && it.key && 'text' in it.key && it.value.k === 'lit') spec.style![it.key.text] = Object.values(it.value.v)[0];
    // a host type: `Type[host = "name" | …]`, its other attributes the host's configuration (host.ts)
    if (typeof spec.style!.host === 'string') {
      const { host, ...config } = spec.style! as Record<string, number | string | boolean>;
      spec.host = { name: host as string, config };
    }
    specs[t.name] = spec;
  }
  const sig = Signature.of(specs);

  const rules: Rule[] = [];
  const ruleAttrs = new Map<string, Record<string, string>>();
  for (const r of ast.rules) {
    if (ruleAttrs.has(r.name)) throw new ReadError(`the rule ${r.name} is declared twice`);
    const attrs: Record<string, string> = {};
    for (const it of r.attrs) if (it.k === 'member' && it.key && 'text' in it.key) attrs[it.key.text] = valueText(it.value);
    const { rate, split, ...rest } = attrs;
    // draws of a class (F72): `draw`, `draw2`, … each `take[?p Class ?k Rewrite]`
    const draws = Object.keys(rest).filter((k) => /^draw\d*$/.test(k)).sort((a, b) => Number(a.slice(4) || 1) - Number(b.slice(4) || 1));
    const drawTexts = draws.map((k) => rest[k]);
    for (const k of draws) delete rest[k];
    const opts = { ...(rate !== undefined ? { rate } : {}), ...(split !== undefined ? { split } : {}), ...(drawTexts.length ? { draws: drawTexts } : {}) };
    // a rule making one keyed entry is read as its merge and its make (F73), so the merge can flow
    const two = split === undefined ? splitKeyed(r.rule, sig) : null;
    const readings: [string, typeof r.rule][] = two ? [[r.name, two.merge], [`${r.name}+`, two.make]] : [[r.name, r.rule]];
    for (const [name, ast] of readings) {
      let rule: Rule;
      try {
        rule = buildRule(name, ast, sig, opts).rule;
      } catch (e) {
        throw new ReadError(`rule ${name}: ${(e as Error).message}`);
      }
      const problems = checkRule(rule, sig);
      if (problems.length) throw new ReadError(`rule ${name}: ${problems.join('; ')}`);
      rules.push(rule);
    }
    ruleAttrs.set(r.name, rest);
  }

  let world: Carrier;
  try {
    world = buildState(ast.world, sig).carrier;
  } catch (e) {
    throw new ReadError(`world: ${(e as Error).message}`);
  }

  const run: Record<string, Scalar | string> = {};
  for (const it of ast.run as Item[])
    if (it.k === 'member' && it.key && 'text' in it.key)
      run[it.key.text] = it.value.k === 'lit' ? it.value.v : it.value.k === 'expr' ? constant(it.value) : valueText(it.value);
  return { sig, rules, ruleAttrs, world, run, types };
}

/** A type whose kind is a scalar's: `Mass = Type[kind = "float"](<: Float)`, or within one by its supertypes. */
function scalarKindOf(t: TypeAst, types: TypeAst[]): 'int' | 'float' | 'text' | 'bool' | undefined {
  const kind = t.attrs.find((it) => it.k === 'member' && it.key && 'text' in it.key && it.key.text === 'kind');
  if (kind && kind.k === 'member' && kind.value.k === 'lit' && 'text' in kind.value.v) {
    const k = kind.value.v.text;
    if (k === 'int' || k === 'float' || k === 'text' || k === 'bool') return k;
  }
  const KIND: Record<string, 'int' | 'float' | 'text' | 'bool'> = { Int: 'int', Float: 'float', Text: 'text', Bool: 'bool' };
  for (const s of t.supers) {
    if (KIND[s]) return KIND[s];
    const up = types.find((x) => x.name === s);
    if (up) {
      const k = scalarKindOf(up, types);
      if (k) return k;
    }
  }
  return undefined;
}
