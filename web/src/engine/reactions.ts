/**
 * Rule values, native. PROPOSED (reactioncraft, 2026-10-28, for Spangler's answer 1: "Rule values, or any state, should
 * be something the system can generate itself. A rule is a redex and a reactum, so it is a value like any other").
 *
 * The design it follows is chrysalis DESIGN §Reactions (a8a3939):
 *  - a rule is a place, and rules are matter: a rule value is a node, `Reaction(Lhs(…) | Rhs(…))`, copied, moved,
 *    rewritten and lost as any node is;
 *  - a rule acts only where it is wired: a place has one `reactions` link, and a rule value on that link (its `at`
 *    port) acts in that place. Containment wires nothing, and a rule value on no place's link is matter only (inert:
 *    a seed's genome, a spore);
 *  - built at run time, a rule behaves as one written in the library: each structure met is sealed once, compiled to
 *    an ordinary `Rule` by the same reader every written rule goes through, and kept by its structure (content
 *    addressed), so a thousand copies of a value cost one compile, and each copy wired is its own spot.
 *
 * What a sealed rule is. For a rule value `Reaction[at = ~w](Lhs(A | A) | Rhs(B))` and a place type `Cell` with a
 * `reactions` port, the rule
 *
 *     ?p = Cell[reactions = ~w](A | A | ?rest) || ?r = Reaction[at = ~w | rate = ?k](?l = Lhs(…) | ?h = Rhs(…))
 *       => ?p = Cell[reactions = ~w](B | ?rest) || ?r = Reaction[at = ~w | rate = ?k](?l = Lhs(…) | ?h = Rhs(…))
 *
 * at rate `?k`, the value's own `rate` attribute where its type declares one. The rule value is in the redex, so each
 * copy wired is its own occurrence; `~w` is an outer name, so it meets a place's link whatever else is on it; the
 * value is kept node for node, so firing never remakes it. Its items are matched as direct members of the place.
 *
 * Where the value stands. Two regions cannot meet a value inside the place they meet (it would be in the place's site,
 * the parameter, and a region's root stands in the context), so each structure is sealed in two forms, which never
 * meet the same thing twice: the value outside the place (the two regions above), and the value a member of the place
 * (`?p = Cell[reactions = ~w](A | A | ?r = Reaction[…](…) | ?rest)`, one region), a genome in its cell. A value wired
 * to a place and standing deeper inside it (in a member of a member) meets nothing yet: that needs a pattern for
 * "anywhere within", which v004 does not have.
 *
 * The inside of a rule value is quoted (`match.ts` `quotes`): an ordinary rule's redex root meets nothing inside one,
 * so the `A` in a value's `Lhs` is not food. A rule that names the forms (`?l = Lhs(A | ?x) => ?l = Lhs(C | ?x)`)
 * reads and rewrites rule values, so the system makes its own rules from its own rules, and a value rewritten is the
 * new structure's rule at once.
 *
 * Refusals, each a code, the value carried as it is (matter, never a rule): `E-form` (not exactly one `Lhs` and one
 * `Rhs`), `E-linked` (an item on a link: v1 values are ground and link free), `E-empty` (nothing to meet: it would fire
 * forever), `still` (it changes nothing), `E-read` (the engine's reader refused the rule, with its message), and any
 * code the world's own judgement gives (`admit`: a model's books, like minted life's mass and energy, are the world's,
 * not the language's).
 *
 * Not yet: values with sites (a rule value is ground in v1, so it meets exact items), links in values, a value's
 * guard, wiring a value into its own place so rules meet each other (it reads; what it means is Spangler's), keyed
 * draws. `Discovery` is rebuilt when a new structure is sealed; a native `addRule` would keep it incremental.
 */

import { type Carrier, type Edge, type Id, Index, type Node, emptyFace, isAttr } from './carrier';
import { quotes } from './match';
import { Discovery, type LiveSpot } from './incremental';
import type { Program } from './program';
import { type Stepped, step } from './policy';
import type { Transition } from './react';
import type { Rule } from './rule';
import type { Signature } from './signature';
import { type Item, ReadError, itemText, parseState, print, readRule } from './text';

/** The names a program gives the rule value, its two sides, its wire, and a place's `reactions` port. */
export interface Forms {
  reaction: string;
  lhs: string;
  rhs: string;
  at: string;
  reactions: string;
}

export const FORMS: Forms = { reaction: 'Reaction', lhs: 'Lhs', rhs: 'Rhs', at: 'at', reactions: 'reactions' };

/** A rule value's structure: each side's items as canonical text (alike up to identity, alike as text). */
export interface Structure {
  key: string;
  lhs: string;
  rhs: string;
}

export type Read = Structure | { refused: string; detail?: string };

export interface ReactionOptions {
  forms?: Forms;
  /** The world's judgement of a structure: a code to refuse it, or null to let it be sealed. */
  admit?: (s: Structure) => string | null;
}

/**
 * The rule values of one signature: which structures have been met, sealed (to which rules) or refused (why), and
 * how many compiles that took. Registering quotes the forms (`match.ts` `quotes`).
 */
export class Reactions {
  readonly forms: Forms;
  readonly sealed = new Map<string, Rule[]>();
  readonly refused = new Map<string, string>();
  /** Every structure met, in the order met. */
  readonly met: string[] = [];
  /** Structures compiled so far (each to two rules per place type: the value outside its place, and in it). */
  compiles = 0;
  /** The place types with a `reactions` port. */
  readonly places: string[];
  private readonly valueType: Id;
  private readonly rated: boolean;

  constructor(
    readonly sig: Signature,
    private readonly opts: ReactionOptions = {},
  ) {
    this.forms = opts.forms ?? FORMS;
    const f = this.forms;
    for (const n of [f.reaction, f.lhs, f.rhs]) if (!sig.has(n)) throw new ReadError(`rule values: the program declares no type ${n}`);
    this.valueType = sig.id(f.reaction);
    this.rated = sig.get(this.valueType).attrs.some((a) => a.key === 'rate');
    if (!sig.get(this.valueType).ports.some((p) => p.key === f.at)) throw new ReadError(`rule values: ${f.reaction} has no ${f.at} port`);
    this.places = sig.types.filter((t) => t.ports.some((p) => p.key === f.reactions)).map((t) => t.name);
    quotes.set(sig, { value: this.valueType, forms: new Set([f.reaction, f.lhs, f.rhs].map((n) => sig.id(n))) });
  }

  /** Every sealed rule, in the order sealed. */
  rules(): Rule[] {
    return [...this.sealed.values()].flat();
  }

  /** A rule value's structure, or why it is refused as a form (the world's judgement is `seal`'s). */
  read(ix: Index, value: Node): Read {
    const f = this.forms;
    const kids = ix.children({ node: value.id }).filter((c) => !isAttr(c.member));
    const lhs = kids.filter((c) => this.sig.name(c.type) === f.lhs);
    const rhs = kids.filter((c) => this.sig.name(c.type) === f.rhs);
    if (kids.length !== 2 || lhs.length !== 1 || rhs.length !== 1) return { refused: 'E-form' };
    const side = (s: Node): string | null => {
      const items = ix.children({ node: s.id });
      const ids = new Set(items.flatMap((c) => ix.subtree(c.id)));
      const nodes: Node[] = [];
      const edges = new Map<Id, Edge>();
      for (const id of ids) {
        const n = ix.node.get(id)!;
        for (const grp of n.ports)
          for (const [, pt] of grp.points) {
            if (!('edge' in pt.target)) return null;
            const e = ix.edge.get(pt.target.edge)!;
            if (e.held || ix.pointsOn(pt.target).length !== 1) return null;
            edges.set(e.id, e);
          }
        nodes.push('node' in n.parent && n.parent.node === s.id ? { ...n, parent: { region: 0 } } : n);
      }
      const sub: Carrier = { inner: emptyFace(), outer: { places: [this.sig.id('Place')], names: [], locality: [] }, nodes, edges: [...edges.values()], sites: [], names: [], siteKeys: [] };
      return nodes.length ? print(sub, this.sig) : '';
    };
    const l = side(lhs[0]), r = side(rhs[0]);
    if (l === null || r === null) return { refused: 'E-linked' };
    const s: Structure = { key: `${l} => ${r}`, lhs: l, rhs: r };
    if (!l) return { refused: 'E-empty', detail: s.key };
    if (l === r) return { refused: 'still', detail: s.key };
    return s;
  }

  /** Seal a structure once: compile its rule for each place type, or refuse it with a code. Returns whether it is new. */
  seal(s: Read): boolean {
    const key = 'refused' in s ? `!${s.refused} ${s.detail ?? ''}` : s.key;
    if (this.sealed.has(key) || this.refused.has(key)) return false;
    this.met.push(key);
    if ('refused' in s) return this.refused.set(key, s.refused), true;
    const judged = this.opts.admit?.(s) ?? null;
    if (judged) return this.refused.set(key, judged), true;
    try {
      this.compiles++;
      this.sealed.set(key, this.places.flatMap((p) => [this.compile(s, p, false), this.compile(s, p, true)]));
    } catch (e) {
      this.refused.set(key, `E-read ${(e as Error).message}`);
    }
    return true;
  }

  /** The rule a structure is sealed into at places of type `place`, for a value outside the place or held in it. */
  compile(s: Structure, place: string, held: boolean): Rule {
    const f = this.forms;
    let n = 0;
    // the value matched node for node, every member named so it is kept, never remade
    const name = (items: Item[]): Item[] =>
      items.map((it) => (it.k === 'member' && it.value.k === 'term' ? { ...it, named: `q${n++}`, value: { ...it.value, body: it.value.body && name(it.value.body) } } : it));
    const named = (text: string) => (text ? name(parseState(text)[0]).map(itemText).join(' | ') : '');
    const value = `?r = ${f.reaction}[${f.at} = ~w${this.rated ? ' | rate = ?k' : ''}](?l = ${f.lhs}(${named(s.lhs)}) | ?h = ${f.rhs}(${named(s.rhs)}))`;
    const inPlace = (items: string) => `?p = ${place}[${f.reactions} = ~w](${[items, held ? value : '', '?rest'].filter(Boolean).join(' | ')})`;
    const side = (items: string) => (held ? inPlace(items) : `${inPlace(items)} || ${value}`);
    return readRule(`${f.reaction}@${place}${held ? ' held' : ''}: ${s.key}`, `${side(s.lhs)}\n  => ${side(s.rhs)}`, this.sig, this.rated ? { rate: '?k' } : {});
  }

  /** Read every rule value in a state and seal what is new. Returns the structures sealed or refused for the first time. */
  scan(g: Carrier): string[] {
    const ix = Index.of(g);
    const before = this.met.length;
    for (const n of g.nodes) if (n.type === this.valueType) this.seal(this.read(ix, n));
    return this.met.slice(before);
  }

  /**
   * The same after one reaction, reading only the values it could have changed: those at or above a node it made,
   * moved, copied, kept or rewrote. A value nothing touched is as it was. That is enough because of the quote: a rule
   * reaches inside a value only through a root of the value's forms, at or inside the value, which it keeps or makes
   * anew, so a node it removes there always has one of those above it.
   */
  scanAfter(after: Carrier, t: Transition): string[] {
    const ix = Index.of(after);
    const values = new Set<Id>();
    for (const id of [...t.created, ...t.moved, ...t.kept, ...t.copied.map(([, c]) => c), ...(t.revalued ?? [])])
      for (let n = ix.node.get(id); n; n = 'node' in n.parent ? ix.node.get(n.parent.node) : undefined) if (n.type === this.valueType) values.add(n.id);
    const start = this.met.length;
    for (const id of values) {
      const n = ix.node.get(id);
      if (n) this.seal(this.read(ix, n));
    }
    return this.met.slice(start);
  }
}

/**
 * A program run with its rule values: after each reaction the state's values are read, and a structure met for the
 * first time is sealed and its rules join the program's. One occurrence per step, by `policy.step`.
 */
export class Run {
  readonly reactions: Reactions;
  g: Carrier;
  t = 0;
  private discovery: Discovery;
  private rules: Rule[];

  constructor(
    readonly program: Program,
    opts: ReactionOptions = {},
  ) {
    this.reactions = new Reactions(program.sig, opts);
    this.g = program.world;
    this.reactions.scan(this.g);
    this.rules = [...program.rules, ...this.reactions.rules()];
    this.discovery = new Discovery(this.rules, program.sig);
  }

  /** Every rule live now: the program's, then each sealed structure's, in the order sealed. */
  get live(): Rule[] {
    return this.rules;
  }

  /** The spots the next step chooses among, as discovery holds them. */
  spots(): LiveSpot[] {
    return this.discovery.live(this.g);
  }

  step(random: () => number): Stepped | null {
    const s = step(this.g, this.rules, this.program.sig, random, this.discovery);
    if (!s) return null;
    this.g = s.state;
    this.t += s.dt;
    if (this.reactions.scanAfter(this.g, s.transition).some((k) => this.reactions.sealed.has(k))) {
      this.rules = [...this.program.rules, ...this.reactions.rules()];
      this.discovery = new Discovery(this.rules, this.program.sig);
    }
    return s;
  }
}
