---
name: chrysalis
description: Write, read, and run chrysalis (.ys) programs — the surface language for the prism process-bigraph runtime (cellular biology, quantum, audio synthesis, adaptive networks, distributed mesh simulation). Use whenever a task involves `.ys` files, the `chrysalis` CLI, process-bigraphs, or modeling a system as processes / steps / reactions / composites / links over a shared bigraph state.
---

# Chrysalis (`.ys`) — quick on-ramp

Chrysalis is a small, homoiconic language that compiles to **prism**, a Rust runtime
implementing Milner process-bigraphs. **One engine, many sciences:** biology, quantum,
audio synthesis, adaptive networks, and distributed mesh simulation are all
specializations of the *same* substrate. Learning `.ys` is learning the system.

**Get the full reference from the binary itself** (it ships with the language, version-matched):

```sh
chrysalis primer                 # the table of contents — start here
chrysalis primer reactions       # one section (composites · links · mesh · units · …)
chrysalis primer all             # the whole executable reference
```

The canonical source is `docs/chrysalis-primer.md` in the prism repo — every `ys` block in
it is run by a test (`primer_doctest.rs`), so it cannot drift. **This skill is the map; the
primer is the territory** — read a topic before you write that kind of program.

## Mental model — state is a bigraph

Two orthogonal structures:

- **Place graph** — nesting / containment. A tree of named values (`{a: {b: …}}`) or
  anonymous lists. `cell.cytoplasm.mek` is a place-graph path.
- **Link graph** — wiring. Ports (`~{inputs} ->{outputs}`) connected by shared names.

Almost every *"how do I say X?"* is answered by *"which graph is X about?"*

## The one idea: three activations

Everything active emits the same currency — a **delta** into the shared bigraph state.
They differ only in *what activates them*:

| | **process** | **step** | **reaction** |
|---|---|---|---|
| fires on | **TIME** — its interval elapses | **CHANGE** — an input changed | **PRESENCE** — its pattern matches |
| adds | dynamics (ODEs, growth, physics) | derived values (dataflow, analysis) | structure (rewrite / generation) |

A **`composite`** wires these into a sub-bigraph — and a composite *is* a process, so it
nests anywhere a process fits. Their compositions (Gillespie = reaction×time, temporal
dataflow = step×process, …) *emerge*; they are not special-cased.

## The third thing: the schema drives the engine

A type in `.ys` is not an erased annotation — it is a **`Schema` the engine consults at
runtime**, for every structural operation:

| you write | the engine asks the schema |
|---|---|
| `{ mass: 0.5 }` | **`apply`** — additive (accumulate) or overwrite (replace)? |
| two children write one slot in a tick | **`reconcile`** — how do co-writes combine? |
| a cell divides | **`divide`** — extensive (splits) or intensive (copies)? |
| a value crosses a boundary | **`serialize`/`realize`** — the codec |
| two mesh peers gossip | **`merge`** — is the join a semilattice? (if not: *compile error*) |

So **choosing a type is choosing a behaviour**. `float` accumulates; `overwrite[float]`
replaces; same body, opposite meaning. When a model misbehaves, look at the type first.
See `docs/type-primer.md` for the full treatment (declaring data, methods, and adding a
new sort in Rust).

## Types must FLOW — schema+++value (the rule that costs the most hours)

A value doesn't just *have* a type — it **carries** it (a paired `Value::Typed`), and that type has to
reach **every node at every depth** or a structural op silently degrades. On a real place-graph project
(a nested world of typed nodes you create/edit at runtime), this is *the* discipline:

- **A `map[T]` colony types its elements — recursively.** `type Project = { sections: map[Project] }`
  says every child under `sections` is a `Project`, whose `sections` is again `map[Project]`, forever —
  one declared type flowing down a whole tree. An **untyped / `any` colony has no `apply`**, so
  `{ sections: { _add: { id: … } } }` is stored *literally* as `sections._add.id` and the child never
  appears: a write that "succeeds" with nothing to show ("bug 3b"). Keep the type unbroken from the root.
- **`:: any` at a slot / port / output face ERASES the type** for any walker that dispatches on the
  *slot* schema — **even when the value under it is a perfectly good `Project`**. An `:: any` seed face
  means realize/apply won't descend into its colonies; the type is present on the value and thrown away at
  the slot. **Name the real type** (`world :: Project`, not `world :: any`). `any` is never "unknown" — it
  is "additive-for-floats and structurally opaque," and it is the single most common way the chain breaks.
- **Write THROUGH the type, never around it.** A write method returns a delta over the `_add`/`_remove`
  basis: `add_section(id, name) = { sections: { _add: { '{id}': Project[…, sections: {}, discussion: {}] } } }`.
  Do NOT hand-roll `{ sections: { _add: { id: { _type: 'Project', … } } } }` with a manual `_type` stamp —
  that dodges the type and re-opens the untyped-colony trap. A created child must **carry its own empty
  colonies** (`sections: {}, …`) so it is immediately navigable AND extensible for the next write.
- **Symptom → cause.** "The write lands but the thing never shows / can't be nested into" → dump the LIVE
  state (`chrysalis view`, or a `/scene` frame) and look for a literal **`_add`** key sitting inside a
  colony. That key *is* an untyped colony — the type stopped flowing somewhere above it. Fix the type
  (declare the colony / the slot), never reach into `_add` from the reader.

## The forms you'll write

A file is **definitions** then an optional **trailing term** (the program's value).
Comments are `#` to end of line. `'single quotes'` for strings; `'{x}'` interpolates.

```ys
def rate = 0.7
type Cell = { mass: float, alive: bool }     # `type` names a record schema
def double(x) = x * 2.0                       # functions are first-class values
def scaled(xs) = [ x * 2.0 for x in xs ]      # comprehensions (list + map forms)
```

**process / step** — the two leaf morphisms. Three knobs: `[config]` set once,
`~{inputs}` per tick, `->{outputs}` what it writes. The body is a `|`-parallel of
bindings; the final line *without* `|` is the value (the delta the engine applies).

```ys
process Grow[rate :: float = 0.2] ~{mass :: float} ->{mass :: float} (
  delta = mass * rate |
  { mass: delta }                  # a DELTA on `mass` (accumulates for additive types)
)

step Threshold[limit :: float = 2.0] ~{mass :: float} ->{over :: bool} (
  { over: mass > limit }           # a step caches; recomputes only when inputs change
)
```

**composite** — slots (`name: value`) wired to keyed children with `|`. A *wire* is a
named edge: what one child writes, any child reading that name sees. Wire roots: `name`
(sibling slot), `^` (parent), `%` (this node's own face), `@` (in a port decl: bridge the
interface port to an inner path).

```ys
composite Main ->{count :: float @ count} (
  count: 0.0 |
  tick: Grow ~{mass: count} ->{mass: count}   # keyed child, wired to the slot
)
```

**reaction** — a redex `=>` reactum, fired eagerly whenever its pattern is present. `?x`
is a binder, `~e` a shared link/bond, a `where` guards, `rate ( expr )` gives a propensity.
A **`Reactor`** runs a set of reactions over a state slot. A reactum may be *structural*
(pattern substitution) or *computed* (a quoted call like `?c.divide()`).

```ys
reaction repair  ( ?b :: B => F ) rate ( 1.0 )
reaction degrade ( ?f :: F => B ) rate ( 1.0 )

composite Balance ->{ world :: any @ world } (
  world: { b0: B, b1: B, b2: B, b3: B } |
  brs: Reactor[reactions: [repair, degrade], mode: 'gillespie', seed: 7] ~{state: world}
)
```

A redex is **`is_a`-aware** — `?p :: Predator` matches every `Cat`/`Wolf is_a Predator` through the schema
lattice, never a brand-string `==`, so model with subtypes freely (on *every* match path — eager, gillespie,
`select`). Declare a subtype by naming its supertype: `type Circle = Shape`. A reactum can **spawn a live
process/composite**, wired exactly like a body child — `=> Stage[k: 3] ~{in: shared} ->{done: %.done}`
adds a *running* node at runtime (bare name = a sibling slot, `%` = the new node's own face, `^` = parent);
put a shared handle in the soup so successive stages wire it by name. Brand a container-redex site or it
over-matches every member — `(seed: ?s | _rest: …)` needs `?s :: Seed`.

**link** — a first-class, value-bearing hyperedge. Declare once; any node attaches a port
by name (`~{port: ~name}`); all attached ports share the one slot. Depth-independent (the
engine resolves `~name` up to the nearest `link`). A **`mesh`** link is a `link` the engine
replicates across peers and converges with no coordinator — its schema's `merge` must be a
join-semilattice (the compiler *refuses* an unsafe one).

```ys
composite Dish ->{glucose :: float @ glucose} (
  link glucose :: float = 100.0 |                       # ONE shared pool
  a: Eat ~{glucose: ~glucose} ->{glucose: ~glucose} |
  b: Eat ~{glucose: ~glucose} ->{glucose: ~glucose}     # both attach by NAME
)
```

Also live: **methods** (`type … with { m(x) = … }`, `self` is the receiver, reads return
values / writes return deltas over `_add`/`_remove`), **units** (`unit pg : [mass] = 1e-12 kg`;
`Mass = Quantity[unit: pg, extensive]`) and **contexts** (`context concentration (volume: Volume) (…)`
bridges two dimensions), **contracts** (`fulfills` — a process's *meaning*), **patterns**
(`pattern Catalysis[enzyme, substrate] (…)` — a named, parameterized redex fragment),
**functors** (`Name :: S -> T ( Gen => constr )` — structure-preserving maps), **protocols**
(`local:`/`stream:`/`rest:`/`parallel:`/`mesh:` — where a component runs, transparently),
**imports** (`from .file import X` = sibling file, `from name import X` = native/registry),
and **staging** (`` `expr `` quotes, `generate(rep)` runs it, `splice(e)` folds at build
time). Run `chrysalis primer <topic>` for any of these.

## Running

```sh
chrysalis run <file.ys> [--time T] [--<port> VALUE ...]   # run offline; final PUBLISHED state prints as JSON
chrysalis test <file.ys | dir> [--time T]                 # run as a TEST — ok iff no assertion fails
chrysalis check <file.ys>                                 # parse + contract/connection checks, no run
chrysalis explain <CODE>                                  # long-form for a diagnostic (20 codes registered)
chrysalis view <file.ys>                                  # render the bigraph (the OBSERVATION axis)
chrysalis run <file.ys> --emit out.json --sample-dt N     # per-tick frames — the first debugging move
chrysalis run <file.ys> --time T --trace --out t.arrow    # published-output trajectory as an Arrow delta-log
chrysalis repl                                            # interactive eval (:type, :env)
chrysalis primer [topic|all]                              # the language reference
chrysalis format <file.ys> [-w] | chrysalis new <dir>
```

Every `process` / `step` / `composite` is runnable on its own — a bare process gets a
synthesized harness (seed its inputs with `--<port> VALUE`). The *invocation* chooses where
it runs (in-process, a child OS process, an HTTP server), never the source.

Errors are **structured and located** — `error[E-compile-unknown-type]` with a span, a
note, a help line and an `explain`. When one is unclear, run `chrysalis explain <CODE>`
before guessing.

(If `chrysalis` isn't on PATH: in the prism repo use the launcher `coord/chrysalis` — it
resolves/builds the right binary for the machine — or `cargo install --path crates/chrysalis`.)

**Self-checking runs (witnesses).** Wire an `Assert` onto a composite's PUBLISHED face:

```ys
witness: Assert[ holds: `(world.count_type('A') > 0.0), msg: 'A is sustained' ]
  ~{world: world} ->{verdict: checks.sustained}
```

The predicate is **quoted**, so it re-evaluates every tick against the wired state; `chrysalis run`
**exits non-zero** with `ASSERTION FAILED` if it is false **in the settled/final state** — the verdict
is read off the state after the run, not accumulated over ticks (a predicate false at t=0 and true at
settle passes). To claim "X never exceeded N at any tick", make the observable MONOTONE (a running
max / a latch) so the final-state verdict IS a whole-trajectory claim. So a `.ys` file *is* a hard test (the
repo's `ys_files_run` sweep gates every one). Write **antagonistic** witnesses that go RED unless the
semantics are honest — config threads to a spawned process, `is_a` subsumes a supertype redex, a
composite boundary holds. Bridge the Assert OUT; an assert on private interior state isn't seen.

## Projects and packages

A project is a directory with a `project.ys` manifest (`.ys`-as-data) and sources
under `ys/`. `chrysalis new <dir>` scaffolds one; `chrysalis new <dir> --coord` also
scaffolds a multi-agent coordination board.

```ys
def package = {
  name: 'my-model',
  version: '0.1.0',
  dependencies: {},
}
```

Dependencies are added by the tool, not by hand — it round-trips the manifest
good → good (comments inside the record are dropped; the header survives):

```sh
chrysalis add bio --path ../bio          # a local .ys package
chrysalis add sf  --native ../crate      # link a native Rust crate's Core
chrysalis add bio --version '^0.3'       # from a registry (set `registry:` first)
chrysalis remove bio | chrysalis install | chrysalis update [--deps]
```

**Imports state their origin.** `from .file import X` is a sibling *file*;
`from name import X` is a *package* (native or registry). There is no implicit
search order — if it has a dot it's a path, otherwise it's a package.

**To make a project importable BY others**, give it a source root and a public face:

```ys
def package = {
  name: 'bio', version: '0.1.0',
  src: 'ys',                            # roots relative imports at ys/
  exports: ['Cell', 'Grow', 'Divide'],  # what `from bio import X` can see
}

from .cell import Cell                  # re-export: the manifest IS the public face
```

Then `chrysalis publish` (and `chrysalis registry …` to inspect one). An empty
`dependencies` keeps `chrysalis run` on the fast std-only path — no resolve, no
codegen — so a fresh project runs with zero setup.

## Gotchas (the ones that bite first)

- **Subprocesses are auto-keyed by lowercased control name.** Two of the same control must
  be **keyed explicitly** (`a: Tick | b: Tick`) or one silently shadows the other. When in
  doubt, key.
- **Updates are DELTAS, not overwrites** — `{ mass: x }` *adds* `x` for additive types. A
  `step` output almost always wants `->{out :: overwrite[float]}`.
- **`any` is not "unknown" — it is "additive for floats."** An `any` slot that should
  replace will silently accumulate. Give it a real type.
- **Field separator asymmetry:** `type X = { f: float }` declares with `:`; bindings ascribe
  with `::`. `type X = { f :: float }` is a parse error.
- **Composite state is private.** Expose values through an output port/bridge to a parent
  slot; never read `inner.field` across a boundary. (This is *why* cross-composite matching
  is link-graph, not place-graph.)
- **Default wires SHARE — that is the feature; declare when you want isolation.** Two
  processes in one composite with no port declarations write the SAME slot (`a: Add | b: Add`
  over five ticks leaves `n = 10`, not 5). A wire is a named edge, so writing the name IS the
  wiring — that is what lets `Grow` write `mass` and `Divide` read it without saying so twice.
  The corollary bites in ENSEMBLES: N sibling composites all default-wire their faces to the same
  parent slot and sum — measured, four organisms whose individual `heat` was 1.5 gave a parent
  `heat` of 6.0, each child correct and the parent's view the total. When members must stay
  SEPARATE, route each face to its own node (`->{mass: %.mass}`), which is why
  `grow-divide-glucose.ys` writes `'0': Cell[…] ->{mass: %.mass}`. Sharing is a default, not a
  guess — but it is a default about ONE body.
- **Default wires SHARE — that is the feature; declare when you want isolation.** Two
  processes in one composite with no port declarations write the SAME slot (`a: Add | b: Add`
  over five ticks leaves `n = 10`, not 5). A wire is a named edge, so writing the name IS the
  wiring — that is what lets `Grow` write `mass` and `Divide` read it without saying so twice.
  The corollary bites in ENSEMBLES: N sibling composites all default-wire their faces to the same
  parent slot and sum — measured, four organisms whose individual `heat` was 1.5 gave a parent
  `heat` of 6.0, each child correct and the parent's view the total. When members must stay
  SEPARATE, route each face to its own node (`->{mass: %.mass}`), which is why
  `grow-divide-glucose.ys` writes `'0': Cell[…] ->{mass: %.mass}`. Sharing is a default, not a
  guess — but it is a default about ONE body.
- **Config ≠ state — two axes on a node.** `Foo[p: v]` sets a construction CONFIG param (a declared
  `[p :: T = …]`, read once at build); the fields a redex matches (`?w :: W[done: true]` or `where ?w.done`)
  are top-level STATE — what the node's *own outputs* wrote (`->{done: %.done}`). Don't try to match a config
  param, and don't expect `[field: v]` on a fresh mint to seed runtime state. (A `[flag: true]` redex where a
  `where` guard reads cleaner is the smell you're conflating them.)
- **`run`'s default JSON is the FROZEN construction config for composite interiors, not live
  state.** A nested composite's `…/config/state` shows its *born* `default()` values — a running
  inner cell looks frozen if you read it there. The LIVE interior is `Engine::snapshot()`, surfaced
  via `chrysalis view`; `--trace` samples published outputs, not interiors. Don't debug a
  "stuck" sim before checking this.
- **`--time` is run duration; the per-step `dt` is `interval`** — don't confuse them.
- **Records vs maps disambiguate by key syntax:** bare-ident keys `{a: 1}` → record;
  quoted/interpolated keys `{'a': 1}` / `{'{id}': v}` → map.

## When nothing happens — the silent-failure checklist

The expensive failures in `.ys` are **silent**: no error, no warning, an empty soup or an inert
reactor that looks like a modelling problem and isn't. Work this list top-down BEFORE touching
rates or mechanism. (Every item below cost real hours at least once.)

1. **Is the soup actually populated?** Emit it and count. `--emit out.json --sample-dt N`, then
   look at `frames[i].state.<soup>`. An empty map here means the problem is construction, not
   kinetics — stop debugging the model.
2. **Record or map?** Bare-ident keys `{a: 1}` → **record**; quoted/interpolated `{'a': 1}` /
   `{'{id}': v}` → **map**. Folds registered only for `Map`/`List` (e.g. `histogram(sort, field, n)`)
   silently return zeros over a record.
3. **Are the fields DECLARED?** `type X = node { pos: int }` gives `pos` a real schema. An
   *undeclared* field still rides along, but as untyped `any` — so `divide` won't split it,
   units won't check it, and `merge` is last-write-wins. Declare what you set.
4. **Does the reactor's output carry the ports the reactum emits to?** A reactum writing
   `-> weave: {_op: …}` needs `weave` in the reactor's `->{…}`, or the emit is dropped *while the
   reaction still fires* — you see reaction products but no side effect.
5. **Is the reaction pool wired where the reactor reads?** `Reactor[reactions: […]]` takes the
   list directly. A pool wired through a port is a different arrangement; don't mix the two
   half-way. A bare `Reaction` with no reactor over it is dormant data.
6. **Importing a composite does NOT import the processes it references.** `from x import MyComposite`
   brings the composite; its body's references to `MyProcess` silently fail to instantiate and
   you get a composite missing some or all of its subprocesses, with no error. Import them too:
   `from x import MyComposite, MyProcess, …`. Symptom: the emitted state lacks slots the
   composite clearly declares.
7. **The reactor is endomorphic.** `~{state: soup}` is sufficient — the output wire is auto-derived.
   `->{state: soup}` is redundant (harmless, but it hides the intent).
8. **`BRS[rules: …]` is RETIRED — and loud.** It was never a working alias after the
   slice-6 rename: an unknown `BRS` control realizes as an inert data node, and the
   `rules:` key now PANICS at the decode door naming the rename (it silently decoded
   to zero reactions for seven weeks — the organism-silence incident). Always
   `Reactor[reactions: …]`.
9. **Don't `grep -v "^   "` over the JSON output** — it eats indented lines and makes a full map
   look empty. A "suspiciously empty" result is usually the filter, not the engine.

## Gillespie is for chemistry, not transport

Per-particle hop reactions across compartments are a propensity explosion: N tokens × a fast hop
rate dominates the event stream and starves the chemistry you care about. A few hundred tokens at
a realistic diffusion rate is already tens of thousands of events per simulated second, and the run
simply never finishes.

**Split it.** Transport and dense fields belong in a native typed solver (state + methods in Rust);
the reaction network stays in `.ys` and operates on a *coarse* aggregate the native layer publishes.
The rule of thumb: **if a species' count scales with resolution, it is a field, not a token.**

## Writing it well

Grow programs like **go / wei qi**, not Twilight Imperium — capability through
emergence/composition, not a rule per feature. Before reaching for a new construct, check
it isn't already derivable from the kernel (process/step/reaction/composite/link + the
delta algebra).

**Extending prism itself** (not just writing `.ys`)? Read the prism repo's
`docs/agent-primer.md` (the full on-ramp) and `CLAUDE.md`. The load-bearing rules:

- **chrysalis is a THIN layer** — never reimplement prism's matching / firing / BRS /
  scheduling / structural-diff. Grep prism and call it; if prism's mechanism is missing
  something, **fix or extend prism in place**, then call it.
- **The schema layer is a closed ALGEBRA** — never hand-roll a merge/diff/apply, never
  stamp `Schema::Any` to dodge a type. If a behaviour isn't expressible, add a *named*
  operation with laws and property tests. Its walkers must stay **symmetric**: every one
  (`apply` / `realize` / `reconcile` / `serialize` / `divide`) peels `Value::Typed` at entry
  and — under an `any` slot — dispatches on the value's OWN carried schema (`&t.schema`), and
  a no-methods `type_*` chases the declared repr and RECURSES (never `encoded.clone()`). One
  walker that skips the peel is a silent split: `_add` merges (apply peeled) while a fresh
  colony is never seeded (realize didn't), so its first add literal-stores. Mirror
  `apply_with_reg`'s Typed-peel entry exactly. See `docs/schema-algebra.md`.
- **No parallel paths.** Before adding a mechanism, ask what the existing infrastructure
  already gives you and whether you can use it *symmetrically*. This repo's biggest wins
  were deletions of first-draft parallel channels.
- **Rust = primitives, `.ys` = compositions.** A new base sort / irreducible generator /
  hot loop is Rust; everything composed from them is `.ys`, including the tests.
  See `docs/rust-ys-boundary.md` and `docs/type-primer.md`.
- **"Built" is not "done."** A fix is complete only when the OLD path is *deleted* and a
  test exercises the new one *through the real surface* (an actual `.ys` run). Ship a
  one-door guard + a real-surface witness with the fix. See `docs/completing-work.md`.
  A `--serve` surface is testable **headlessly**: run the binary, drive its `/scene` WebSocket
  with a tiny client (send `{kind:'write', at, update}`, read the next frame), and dump the
  resulting state — the fastest way to prove a create/edit actually *merged* (a colony key,
  not a literal `_add`). A real browser view is drivable with Playwright/Firefox when needed.

Before touching reaction **lowering, matching, or engine drive**, read
`docs/reaction-paths-and-agreement.md` — the machinery has parallel paths (body vs reactum
lowering; the four match paths; `run` vs `tick`) that MUST agree, and a break in one is silent.

## Pointers

- `chrysalis primer` / `chrysalis primer <topic>` — the executable reference (the source of truth).
- `docs/type-primer.md` — declaring types, methods, and adding a new sort (executable).
- `docs/agent-primer.md` — working *on* prism: the map, the commands, the disciplines.
- `docs/README.md` — the doc index, including the primer family (category · bigraph ·
  reaction · homoiconicity · type · biology · quantum · synchrony · mesh · synthesis ·
  inference · database), all doctest-pinned.
- `docs/NEXT-SESSION.md` — where the project actually is.
- **The `.ys` corpus lives in `packages/<domain>/ys/`** — one package per domain
  (`base` · `bio` · `graph` · `inference` · `manifold` · `mesh` · `quantum` · `query` ·
  `ratchet` · `reflection` · `staging` · `synth`), each with `project.ys` + `ys/` +
  sometimes `examples/`. Start with `packages/bio/ys/grow-divide-glucose.ys`,
  `packages/manifold/ys/kuramoto.ys`, `packages/synth/examples/`, `packages/quantum/ys/`.
  Mechanism-level (non-domain) `.ys` stays in `crates/chrysalis/ys/`.
