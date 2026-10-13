/**
 * The signature: the type nodes a carrier refers to.
 *
 * In the spec, types are nodes and a node's `type` is a type node's identity; a state, a redex and a reactum all
 * refer to the same type nodes from outside themselves (`Carrier.refs`). Here those type nodes are held apart, in
 * one signature shared by every carrier of a library, with `≤` (`Carrier.sub`) the reflexive-transitive closure of
 * the declared supertypes. A type also declares what its instances are: their port groups and attribute slots
 * (the spec's type body: ports and attributes in `[]`), and how they look (`style`, the editor's own).
 */

import type { Id } from './carrier';

export type Kind = 'composite' | 'int' | 'float' | 'text' | 'bool' | 'link' | 'place';

export interface PortDecl {
  key: string;
  /** The contract (a link type) of the links its points may be on. */
  contract: Id;
  /** How many points the group has; 0: any number (a variadic group, `contacts :: Link *`). */
  arity: number;
}

export interface AttrDecl {
  key: string;
  type: Id;
}

export interface TypeDecl {
  id: Id;
  name: string;
  kind: Kind;
  supers: Id[];
  ports: PortDecl[];
  attrs: AttrDecl[];
  /** How instances look: the renderer's to read. Free-form, so it can grow without the engine knowing. */
  style?: Record<string, unknown>;
}

export interface TypeSpec {
  kind?: Kind;
  supers?: string[];
  /** Port group key → contract name (one point), or [contract name, arity]. */
  ports?: Record<string, string | [string, number]>;
  /** Attribute key → type name. */
  attrs?: Record<string, string>;
  style?: Record<string, unknown>;
}

export const BUILTIN = ['Place', 'Link', 'Int', 'Float', 'Text', 'Bool'] as const;

export class Signature {
  readonly types: TypeDecl[] = [];
  private byName = new Map<string, TypeDecl>();
  private byId = new Map<Id, TypeDecl>();
  private upCache = new Map<Id, Set<Id>>();

  constructor() {
    this.declare('Place', { kind: 'place' });
    this.declare('Link', { kind: 'link' });
    this.declare('Int', { kind: 'int' });
    this.declare('Float', { kind: 'float' });
    this.declare('Text', { kind: 'text' });
    this.declare('Bool', { kind: 'bool' });
  }

  static of(specs: Record<string, TypeSpec>): Signature {
    const s = new Signature();
    // declare every name first so supertypes and contracts may refer forward
    for (const name of Object.keys(specs)) s.reserve(name, specs[name].kind ?? 'composite');
    for (const [name, spec] of Object.entries(specs)) s.declare(name, spec);
    return s;
  }

  private reserve(name: string, kind: Kind): TypeDecl {
    let t = this.byName.get(name);
    if (!t) {
      t = { id: this.types.length + 1, name, kind, supers: [], ports: [], attrs: [] };
      this.types.push(t);
      this.byName.set(name, t);
      this.byId.set(t.id, t);
    }
    return t;
  }

  declare(name: string, spec: TypeSpec = {}): TypeDecl {
    const t = this.reserve(name, spec.kind ?? 'composite');
    t.kind = spec.kind ?? t.kind;
    t.supers = (spec.supers ?? []).map((s) => this.id(s));
    t.ports = Object.entries(spec.ports ?? {}).map(([key, c]) => {
      const [contract, arity] = typeof c === 'string' ? [c, 1] : c;
      return { key, contract: this.id(contract), arity };
    });
    t.attrs = Object.entries(spec.attrs ?? {}).map(([key, ty]) => ({ key, type: this.id(ty) }));
    if (spec.style) t.style = spec.style;
    this.upCache.clear();
    return t;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  id(name: string): Id {
    const t = this.byName.get(name);
    if (!t) throw new Error(`no type named ${name}`);
    return t.id;
  }

  get(id: Id): TypeDecl {
    const t = this.byId.get(id);
    if (!t) throw new Error(`no type ${id}`);
    return t;
  }

  name(id: Id): string {
    return this.byId.get(id)?.name ?? `#${id}`;
  }

  /** Every type `a` is within: itself and its supertypes, transitively. */
  ups(a: Id): Set<Id> {
    let s = this.upCache.get(a);
    if (s) return s;
    s = new Set([a]);
    const stack = [a];
    while (stack.length) for (const sup of this.byId.get(stack.pop()!)?.supers ?? []) if (!s.has(sup)) (s.add(sup), stack.push(sup));
    this.upCache.set(a, s);
    return s;
  }

  /** `a ≤ b`. */
  sub(a: Id, b: Id): boolean {
    return this.ups(a).has(b);
  }

  /** Every type declared, but the built-ins; for the editor's palette. */
  user(): TypeDecl[] {
    return this.types.filter((t) => !(BUILTIN as readonly string[]).includes(t.name));
  }

  toJSON(): TypeDecl[] {
    return this.types;
  }

  static fromJSON(types: TypeDecl[]): Signature {
    const s = new Signature();
    s.types.length = 0;
    s.byName.clear();
    s.byId.clear();
    for (const t of types) {
      const c = structuredClone(t);
      s.types.push(c);
      s.byName.set(c.name, c);
      s.byId.set(c.id, c);
    }
    return s;
  }
}
