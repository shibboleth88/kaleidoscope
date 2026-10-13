# Spec findings from kaleidoscope

Kaleidoscope (`web/`) is a second implementation of the chrysalis spec (`../chrysalis`, Lean): a 3-D bigraphical
reactive system editor, in TypeScript, in the browser. Building an application on the spec shows requirements that
reading the spec does not. This document collects them for the spec effort. Each entry says what came up in
practice, what the spec says, what kaleidoscope does now, and the question for the spec.

Spec references are to `../chrysalis` as of 2026-10-12. Kaleidoscope references are to `web/src/`. Entries marked
**PROVISIONAL** in the code are places where kaleidoscope runs ahead of the spec and should follow it once settled.

The F-numbers are stable: entries are added, never renumbered.

---

## Matching

### F1. A redex node must account for every attribute, so unwritten attributes need a meaning

**Came up:** the first MAPK port. `dissociate` never fired, because its redex wrote `pERK[s = ~b]` and every pERK
carries a `name` attribute. A node with no site under it holds exactly what the redex says
(`Occurrence.Meets`: the state is context ∘ met ∘ parameter, and an attribute is never cut from its node,
`Carrier.formed_root_not_param`). So a rule that does not mention an attribute cannot meet a node that has it.

**Spec:** correct as stated, but every rule must then name every attribute of every node it touches, which nobody
writes.

**Kaleidoscope:** in its text form (`engine/text.ts` header), a declared attribute left unwritten in a redex is a
site at that attribute's key. On a kept node in the reactum, it is that same site, so the value is kept. A fresh
node gets no default, following v004 decision 6.

**Question:** should the spec's sugar (`text.sugar.rules`) say this, so that `Cat(age = ?a)` means "a Cat, whatever
else it is"? Or should matching treat unmentioned keyed attributes as context? The first keeps the kernel exact and
puts the convenience in the reader.

### F2. A port has to be "on something": "free" and "any link" are both needed, and neither is first-class

**Came up:** every rule with ports. A port's target is an edge, a name or a binder (`Handle`), so there is no
unlinked port. "Free" is a closed edge with one point. "Any link" in a redex is an outer name with one point.

**Kaleidoscope:** `!` is a free port: a closed edge of its own, in a state, redex or reactum. A port left unwritten
in a redex is "any link": a fresh outer name, kept by a kept node. In 3-D, free is a dim ring, "any" a gold ring,
linked a lit ring with a core.

**Question:** should v004 give `!` (free) a spelling, and say what an unwritten port means in a pattern? Both are
needed constantly.

### F3. Redex roots match members exactly, keyed or anonymous

**Came up:** `Occurrence.Meets` requires `Node.Narrowed`, which keeps `member` equal. So an anonymous redex root
(`Cat`) never meets a keyed state node (`tom = Cat`). Keyed sites (`k = ?x`) exist for reaching by key; there is no
way to say "any key".

**Kaleidoscope:** states and rules built in the editor default to anonymous members, Milner's multisets, so this
rarely bites. It will as soon as anyone keys their states.

**Question:** is "a node at any key" a pattern the spec wants (a key site, `?k = ?c = Cat`)?

### F4. An anonymous site directly in a redex region admits every subset of what is beside the match

**Came up:** writing `A | ?x => …` with the site at a root. The context can hold any subset of the place's other
members, so `discover_complete` asks for 2ⁿ occurrences that differ only in what `?x` holds.

**Kaleidoscope:** the matcher refuses such rules (`engine/rule.ts`, `matcherProblems`). A keyed site at a root is
fine.

**Question:** should `Rule.formed` (or the reaction axis) rule these out, or define the decomposition (say, the
site takes everything beside the match)?

### F5. A redex outer name with no point in the redex is undetermined

**Came up:** an outer name the redex never uses is joined by the context to anything in the state, so occurrences
multiply over every handle.

**Kaleidoscope:** refused by `matcherProblems`.

**Question:** require every redex outer name to have a point, in `Rule.formed`?

### F6. Links leaving what a site holds need inner names the rule never writes

**Came up:** `Box(?x) => Star(?x)` where what `?x` holds is linked to something outside the box. The parameter's
links to the context must pass through the redex's inner names (composition), and a rule written in text has none.

**Spec:** `Instantiates` and `apply_spec` are stated for the rule's own faces. Milner's parametric rules are
applied as R ⊗ id_X for the idle names X they need, but the spec does not say so.

**Kaleidoscope:** `engine/react.ts` tensors the rule with identities on exactly the names the parameter needs
(`implicit`), so every such link passes through untouched. The tests check each decomposition composes back to its
state (`discover_sound`).

**Question:** state this in the reaction axis: an occurrence of R is an occurrence of R ⊗ id_X for any X, and
`apply` is taken there.

### F7. Copying a site: which of its links are copied and which are shared

**Came up:** `Box(?x) => Box(?x) | Box(?x)` where `?x` holds two linked things, and one also linked outside.

**Spec:** `Instantiates` requires a non-identity site map's parameter to share no edge between regions. That is
which decomposition is chosen, and the spec leaves the choice open.

**Kaleidoscope:** an edge whose points all lie in one site's contents belongs to the parameter and is copied with
it (fresh). Any other edge goes to the context and is shared by every copy.

**Question:** adopt this as the canonical decomposition, so copying has one meaning?

### F8. Idle edges

**Came up:** an edge whose last points are removed stays in the state, unobservable. MAPK's `dissociate` avoids
this only by matching the bond closed (`~b :: Link`), so the edge goes with the redex.

**Kaleidoscope:** keeps them, as the spec does. The MAPK test checks none accumulate. A rule written with an open
name instead of a closed bond would leak them.

**Question:** should states be taken up to idle edges, as Milner's often are, or should authors be steered to
closed bonds?

---

## Rules

### F9. Kept nodes must keep their type, so a change of type loses identity

**Came up:** phosphorylation, ERK → pERK. `Rule.formed` requires each kept pair to be of one type, so the pERK is a
fresh node. Identity (and the animation's continuity) is lost, though biologically it is "the same molecule,
modified".

**Kaleidoscope:** treats it as a removal and a creation. The renderer guesses that a fresh node replaces a removed
one in the same place and grows it from there.

**Question:** allow a kept node to change type within some bound (a common supertype, `ERK ≤ Kinase ≥ pERK`)? Or is
a modified molecule properly a state attribute (`Kinase[phospho = true]`)? The second is expressible today, so this
is a modelling-guide entry as much as a spec one.

### F10. Negatives that may add sites and names (PROVISIONAL extension)

**Came up:** `unless ?c = Cat(Collar)`. A negative must have the redex's faces exactly (`Rule.formed`: `ng.outer
== r.redex.outer && ng.inner == r.redex.inner`). So what it adds can have no sites and no names of its own: the
Collar must have no attributes and only free ports. "Unless there is a collar" is inexpressible.

**Kaleidoscope:** a negative's faces may extend the redex's: its sites and outer names come first, and its own come
after. What a negative adds can then leave attributes and ports unwritten, meaning anything, as in a redex.
Blocking matches the negative seeded with the occurrence (`Occurrence.Blocked`), so its own sites and names are
existentially bound. `engine/text.ts` (`buildRule`), `engine/rule.ts`.

**Question:** relax `Rule.formed` to "each negative's faces extend the redex's", with `Occurrence.Blocked`
unchanged?

### F11. A negative cannot constrain the redex's own ports

**Came up:** "unless this Tag is linked to that Collar", written by adding a port to the redex's Tag in the
negative. A negative extends; the redex's nodes are in it exactly, ports included.

**Spec:** correct. The way to say it is to name the link in the redex (`?t = Tag[t = ~l]`) and use `~l` in the
negative.

**Kaleidoscope:** the reader refuses the first spelling and says how to write the second.

**Question:** none for the kernel, but it is a modelling-guide entry: negatives only add; links are named in the
redex.

### F12. Guards and computed values (PROVISIONAL)

**Came up:** growth and division (`Cell[mass = ?m] where ?m >= 2 => Cell[mass = ?m / 2] | Cell[mass = ?m / 2]`),
crowding (`where count[?x] < 40`), birthdays (`age = ?a + 1`).

**Spec:** guards are a planned part (`rules.guard`), and `?a + 1` is sugar for a call, `add[?a 1]`, answered by
the kernel's operation rules (`docs/SYNTAX.md` §9).

**Kaleidoscope:** evaluates expressions in place, over what the sites hold (`engine/expr.ts`). These choices
should be the spec's:
- A site read in an expression must hold exactly one scalar. Otherwise the rule does not meet there; it is not
  refused.
- `count[?x]` is how many roots a site holds. It is very useful and has no spec counterpart.
- A rule meets only where its guard holds and its computed values compute. A division by zero means no
  occurrence; nothing fails at apply.
- Numbers take their slot's kind: an `Int` slot floors (7 / 2 → 3), and Int ∘ Int stays Int.
- Constant expressions in a state fold as read (`mass = 1.5 * 2` is `3.0`).

**Question:** when `rules.guard` lands, does a guard see sites' contents directly, or only through calls? Is an
uncomputable value "no occurrence" or a refusal? And `count`.

### F13. Rates (PROVISIONAL)

**Came up:** every system. MAPK and Growth are stochastic.

**Spec:** G7 (rate, priority and label as rule-node attributes) is `proposed`.

**Kaleidoscope:** a rule has a numeric `rate`. The random policy weighs each spot (`Occurrence.SameSpot`) by its
rule's rate, and time advances as in Gillespie's direct method.

**Question:** rates as expressions over the occurrence (eat faster when hungrier)? That wants the same evaluation
as F12.

---

## Scheduling

### F14. Watching a system needs one reaction at a time, not rounds

**Came up:** the editor's whole point is to watch reactions unfold.

**Spec:** the scheduling axis's one fixed part takes every independent occurrence as a round, and refuses on
overlap (`Scheduling.choose`). The library's default policy is unwritten.

**Kaleidoscope:** a policy that takes one occurrence per step: a spot chosen with probability proportional to its
rule's rate, then one of the spot's occurrences uniformly. Grouping by spot matters: a symmetric redex (`A | A`)
has two occurrences per spot, and counting occurrences would double its rate. `engine/policy.ts`, PROVISIONAL.

**Question:** should the library's default policy be this (stochastic, one at a time), with rounds a different
library policy? And should `SameSpot` be the unit of choice?

---

## Text (v004)

### F15. A minus sign or a minus operator

`?a -1` and `?a - 1` must both subtract, and `-1` alone is a literal. Kaleidoscope reads `-` before a digit as a
sign only where a value may start (after an operator, `=`, `(` or the start), and as an operator after a value.
v004 does not say.

### F16. Parentheses group in expressions

v004 decision 5 says "Parentheses never group". Arithmetic needs grouping (`(?a + 1) * 2`). Kaleidoscope lets `(`
group where a value starts, which is otherwise unused there. Calls use `f[a b]`, as v004 says.

### F17. `Head()` and `Head`

These are one node (v004 §5). The printer writes `Head` for an empty node, but authors write `Nucleus()` for a
place and `MEK` for a thing. Should the printer keep the author's spelling, or should types say they are places?

---

## Interchange

### F18. No data form of a carrier

**Came up:** the editor and the engine exchange carriers constantly. The spec has only `Repr` and the v004 text.

**Kaleidoscope:** a JSON mirror of `Carrier` (`engine/carrier.ts`). Types live in a signature beside it (the
carrier's `refs`), so type ids and node ids are separate namespaces. The text, with its names, is the source of
truth for what an author writes, and the JSON is what runs.

**Question:** a canonical JSON form of the carrier, for tools, round-tripping like `read_print`?

---

## Found building `unless` in 3-D (the lac operon)

### F19. A negative that adds nothing kills its rule

**Came up:** starting a new `unless` in the editor. Before anything has been dropped into it, the negative *is* the
redex. `Occurrence.Blocked` then holds at every occurrence, so the rule can never fire. `Rule.formed` admits it,
because a carrier extends itself.

**Kaleidoscope:** refused (`matcherProblems`: "unless N adds nothing"). The editor never writes one: a clause
exists only once something is dropped into it, and goes when the last thing is taken out.

**Question:** should `Rule.formed` require each negative to be a *proper* extension of the redex?

### F20. Cardinality: "at most one" is a negative, and counting by type is missing

**Came up:** the lac operon's `repress`: a repressor binds the operator *unless one already does*. That is a
negative, and it reads well. The same need written as a guard would be `count of the Repressors in ?x < 1`, but
`count[?x]` (F12) counts everything a site holds, of any type, so a guard cannot say it.

**Kaleidoscope:** the negative is the way to write it. `count` stays untyped.

**Question:** a typed count (`count[?x Repressor]`, through `≤`) would make occupancy limits ("at most 3
receptors") writable as guards, where a negative per number would be clumsy. Is that a library operation, and how
does it read under quotation?

### F21. Two uses of a negative that recur: repression and occupancy

**Came up:** the lac operon needs negatives for two different patterns, which suggests they deserve a place in a
modelling guide:
- **Repression:** a process is blocked by the presence of an inhibitor (`transcribe … unless ?o = Operon(Repressor)`).
- **Occupancy:** a site takes one occupant at a time (`repress … unless ?o = Operon(Repressor)`). The same negative
  serves both rules here.

Both are about the *place* the redex reaches into, which is where negatives are cheap: the occurrence fixes the
place, and the negative only asks what else stands there.
