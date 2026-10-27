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

---

## Found building rates as expressions (yin and yang)

### F22. A rate is per spot (mass action), and a channel rate has to be divided back out

**Came up:** "Yang unmakes a Yin, at a rate set by how far Yang is below equilibrium". The redex picks one Yin, so
the rule has a spot at *every* Yin, and the channel's total rate is the per-spot rate times the number of Yins.
The equation wanted the channel to run at k·(12 − Yang), so the rate had to be written
`max[12 - count[?y Yang] 0] * 0.5 / (count[?x Yin] + 1)`.

**Kaleidoscope:** a rate expression is evaluated at each spot, and the spot is weighted by it: mass action, the
same as a numeric rate (F13, F14). The division is the author's.

**Question:** both meanings are wanted. Mass action is right for "each Yin decays at rate r". A channel rate is
right for "one Yin is unmade at rate f(state)". Should G7 offer both, for example `rate` (per spot) and
`flux` (per rule, shared among its spots)?

### F23. A typed count (provisional), and what a site's count counts

**Came up:** every rate here counts Yin or Yang. `count[?x Yang]` counts the roots a site holds whose type is
`≤ Yang`, and `count[?x]` counts all of them. This answers the need in F20.

**Question:** roots or every node within? Kaleidoscope counts roots (a place's members), which is cheap and local.
A deep count is sometimes wanted ("molecules anywhere in this cell"). And is `count` a library operation, a kernel
primitive, or a form of the guard part?

### F24. Global quantities are reachable only through a place that holds them

**Came up:** the yin–yang equations are about system-wide counts. A rule can only read what its redex reaches, so
the system needs a place that holds everything (the Taiji's two halves), and every rule's redex reaches it. This is
the spec's locality (`discover_local`: what is beside the state and not asked about costs nothing) showing up as a
modelling rule: whatever you want to read, you must reach.

**Question:** none for the kernel. A modelling-guide entry: to make a rate depend on a population, put the
population in a place and reach the place.

### F25. A trace has no times

**Came up:** playing by time, where each reaction waits as long as the Gillespie time it took, needs every step's
time. The policy draws it, and `Trace`/`Commit` (`Spec/Step.lean`) do not record it, so a replayed trace cannot be
played by time.

**Kaleidoscope:** each frame keeps its time `t`, beside the state.

**Question:** when `composites.time` lands, does a commit carry its time (or the clock's value after it), so a
trace replays in time?

---

## Found making it fast

### F26. Discovery across commits: what an occurrence depends on

**Came up:** a crowded cell (240 molecules) spent 80 ms a step rediscovering every rule. `discover_local` states a
cost law within one state ("what is beside the state and never asked about costs nothing"). Nothing says what
can be *kept* from one commit's discovery to the next, and that is where the time goes. Kaleidoscope's
incremental discovery (`engine/incremental.ts`) is 5–14× faster on crowded systems. It is checked against full
discovery at every step of every example, and rests on two claims the spec could state and prove:

1. An occurrence of a rule with one region, no site at a root, and no negative adding beside the match depends
   only on the nodes it meets and on what they hold. A commit whose changes (with everything linked to them) stand
   outside the upward closure of those nodes leaves it an occurrence.
2. If additionally nothing reads the rule's sites (no guard, rate or computed value, no negative) and each node holds
   at most one anonymous site, a change among what such a node's site holds leaves it an occurrence: only its site
   contents differ, and they are determined by its node map (refound when it fires).

New occurrences after a commit all meet a changed node or its parent, so searching anchored there (link-directed,
from the anchor's ancestors) finds them all.

**Question:** state these as laws of the reaction axis (an incremental `discover` alongside `discover_local`), so
every implementation can rely on them.

### F27. Matching must be link-directed

**Came up:** `dissociate` (`~b :: Link | MEK[e = ~b] | pERK[s = ~b]`) tried every MEK against every sibling for
its partner: 3.5 ms to find nothing. Once a link is bound, the partner is one of the few points on it. Following the
link cut it to 0.3 ms.

**Spec:** `Plan.lean` already plans "one matcher, keyed and link-directed" (`reaction.impl`). This confirms the
plan on a real system, and adds that the anchor should seed its ancestors and its region's place, so an
anchored search costs what stands near the anchor.

---

## Found porting wyrm (the C. elegans embryo)

### F28. A relation of any arity needs a rest of points

**Came up:** a cell touches some number of others, from 0 to about 8. wyrm (spec1) holds them as a port family
matched with a rest: `contacts: {Var[e] | Rest(as: ra)}`. In the carrier, a port group's points are listed and a
match meets them exactly (`PortGroup.Narrowed`: `Along` over the points), so a pattern cannot say "one of its
contacts is e, whatever the others are".

**Kaleidoscope:** contacts are reified, as nodes (`Contact[a, b]`) joining two cells' identity links. That works
and draws well (a contact is a curve), but every rule about a contact meets three nodes instead of two, and a
symmetric relation needs two rules (F30).

**Question:** a site for points, a "rest" in a port group (`contacts = (~e | ?more)`), as sites are a rest for
members? It is the link graph's counterpart of the place graph's anonymous site.

### F29. Mechanics wants sums over neighbours, or rounds

**Came up:** wyrm moves each cell by the sum of its contact forces, once per tick (pool deposits, then a draw).
One reaction at a time cannot sum. Kaleidoscope relaxes contact by contact instead, moving both cells along the
line between them (Gauss–Seidel on the same energy).

**Question:** two routes the spec could take. A fold over a node's links in an expression
(`sum[contacts ~e (?x - ?bx)]`), or the scheduling axis's rounds (`Scheduling.choose`), which already take every
independent occurrence at once. Rounds refuse where occurrences overlap, though, and every contact of a cell
overlaps at the cell, so a round alone does not give a synchronous sweep. Accumulators (wyrm's pools) may be the
missing piece.

### F30. A symmetric relation, written twice

**Came up:** "Notch: an AB daughter in contact with the signalling cell". A Contact's ends are `a` and `b`, so the
rule is written once for the cell at `a` and once for it at `b`. The same happens for Wnt, and for "unless a
contact already joins them" (two negatives).

**Question:** an unordered port group (points with no keys, matched as a multiset) would make a symmetric relation
one rule. This is the same multiset the place graph has for anonymous members.

### F31. Conditionals in expressions

**Came up:** wyrm's rules use `If` throughout (periods by lineage class, the force law by distance). Kaleidoscope
added `if[c a b]`, which works out only the branch taken, along with `clamp` and `hypot`. v004 has
`if c then a else b` as sugar for a call that unquotes a branch (§9). The two agree on laziness, which matters
(`if[?a == 0 1 10 / ?a]`).

### F32. "No rule reads a name"

**Came up:** wyrm's discipline is that names (`ABalp`) are readouts, written at each division and never matched.
In kaleidoscope's port, names are attributes that rules write (`name = ?n ++ "a"`) and no redex mentions. The
discipline holds, but nothing enforces it.

**Question:** a write-only attribute (an "annotation") that matching ignores, so the discipline is checked rather
than kept by convention? It would also make annotated nodes match plain patterns without implicit sites (F1).

### F33. What profiling a stress test taught the matcher (the embryo, 13.5× faster)

The wyrm embryo (28 cells, about 450 nodes, 30 rules, 6,000 reactions) took 270 s at first and 20 s after. Each
change is a claim about what a reaction can and cannot affect, and so a candidate law for the spec (F26):

1. **Only a change of links reaches along links.** A node that moved, or changed an attribute, does not change its
   link-neighbours' occurrences. Only a node whose ports changed (or that was created or removed) does.
   639 → 372 searches per reaction.
2. **A site no expression reads absorbs change.** Even in a guarded rule (divisions read `?t` and `?b`, not
   `?rest`), a node's one anonymous site that nothing reads lets what it holds change without disturbing the
   occurrence. This is per site, not per rule.
3. **A search from a node's parent covers it.** An occurrence meeting a changed node below the redex's root also
   meets that node's parent, so where the parent is searched from, the child need not be. 372 → 32 searches per
   reaction.
4. **Literal attributes first.** A redex node with `founder = "ab"` cannot meet a cell whose founder differs, and
   checking that costs nothing next to a search.
5. **Seed first, then follow links.** An anchored search should assign the anchored root first. Link-directed
   candidates (F27) then reach everything else through the anchor's links, instead of trying every sibling.
6. **Guards before negatives.** A guard is arithmetic; a negative is a search.

The rest is the same per-search cost spread thin (site bookkeeping, garbage). A Lean implementation's
`reaction.impl` would want 1–3 as lemmas, since they are what make discovery cost what changed rather than what
is there.

### F34. Whitespace-separated arguments and minus collide

**Came up:** `clamp[F -1.0 1.0]` and `if[c a -0.02 * x b]`. v004 separates a call's arguments by whitespace
(`add[3 4]`), and has infix `-`. After a value, `-1.0` reads as "minus 1.0", so the arguments run together:
`F - 1.0` and `1.0` (two values, not three). The reader cannot tell `[a -b]` (two arguments) from `[a - b]`
(one).

**Kaleidoscope:** a minus after a value is subtraction, and it is a sign only where a value may start. Authors
write `(-1.0)` or rearrange the term. The reader refuses the wrong count (`if takes 3 values`), so the mistake is
caught, not silently miscomputed.

**Question:** v004 decision 2 makes juxtaposition sequence. Should a negative literal argument need brackets, or
should `-` with no space after it before a number always be a sign (`[a -1]` two arguments, `[a - 1]` one, `[a-1]`
one?), as some languages decide by spacing?

### F35. A rest of points, built (F28), and what it settled (F30)

Kaleidoscope now has F28's rest of points, PROVISIONAL:
- A port may hold any number of points (`contacts :: Link *`).
- A pattern names a rest: `contacts = ?ps` (whatever is there), or `contacts = (~c | ?ps)` (a point on `~c`, and
  the rest).
- In the redex, an explicit point meets *any* of the group's points (a branch per choice), and the rest holds the
  others. In the reactum, `?ps` puts them back, and leaving it out lets them go.
- In the carrier, a rest is a field of a pattern's port group (`PortGroup.rest`). Its points pass through the
  decomposition as F6's implicit names, so `discover_sound` (decompose, then compose back) still holds, and is
  tested.
- Expressions fold over it: `sum[?ps E]` with `?ps.x` the far node's `x`, `count[?ps]`, and `shared[?ps ?qs]` (how
  many links two rests share, which is "not already in contact" as a guard rather than a negative).

What it settled:
- **F30 goes away.** A link has no direction, so "an AB daughter in contact with the signaller" is one rule
  (`contacts = (~k | ?as)` on both), not two.
- **Reified contacts go away.** Contacts are links again, and the embryo is simpler.
- **Mechanics in a fold** (F29, the first route): `settle` moves a cell by its net force over all its contacts.
  Reaching 28 cells takes 4,568 reactions (2,701 of them `settle`), against more than 6,000 for 26 cells with one
  reaction per contact.

What it costs, and the spec questions:
- **A fold reads across links.** An occurrence of `settle` depends on its neighbours' attributes, so a neighbour that
  moves makes it stale. Incremental discovery has to know which rules read across links (`readsAcross`), and stale
  them when a linked node changes. Is "an occurrence depends on what its rests reach" part of `Occurrence`, so the
  F26 laws can account for it?
- **Choice of a point is an occurrence.** `(~c | ?ps)` meets a cell once per contact. Each choice is a distinct
  occurrence, with different name bindings and the same `SameSpot` (same nodes, same edges). Under the random
  policy these share one spot, so "part a contact" fires per pair of cells, not per contact. Is `SameSpot` the
  right unit when the choice is a link? (Here the contact's closed edge puts it in the spot, so it does fire per
  contact. With an open name it would not.)
- **A rest is not a site:** it holds points, not places, and nothing in `Rule.formed` or `Instantiates` knows it.
  Adopting it means a site map for points beside the one for places.

### F36. No way to name a value within a rule

**Came up:** folding the eggshell into `settle` (as wyrm's mechanics does: move by the net force, then project back
inside the shell). The new position is `?x + clamp[FX (-1.0) 1.0]`, and the projection divides it by the square root
of where the moved point lies in the shell, which reads all three new coordinates, twice each. With no way to name
a value, each coordinate's expression spells out every force sum again: the rule's text is about 30 copies of
`sum[?ps …]`.

**Kaleidoscope:** the library builds the text from helpers, and the engine works out a top-level `sum` once per
occurrence (memoised by its structure, as the state cannot change while an occurrence's expressions are evaluated).
Folding the shell in took the embryo from 4,568 reactions to 28 cells (1,425 of them `eggshell`, undoing what
`settle` had just done) to 2,759, and 12.9 s to 7.9 s.

**Question:** a `let` in a rule (`let FX = sum[…] in …`, or named values beside `where`) shared by the guard, the
rate and the reactum. In v004 terms it is a binding whose scope is the whole rule; the spec would have to say it is
evaluated once per occurrence, over the redex's sites, before the guard.

### F37. Subtypes and ports: a supertype's pattern cannot meet a node with more ports

**Came up:** ember · moss · mist wanted one rule for "a kind breeds inside whatever creature holds it", written
over a supertype (`?h = Creature(?x = Moss(?i) | ?s)`). Ember, Moss and Mist each declare a port (`pact`), so they
are not met by a `Creature` pattern unless `Creature` declares the same ports. Two things combine:
- **Ports are not inherited.** `Ember[pact :: Link] <: Creature` declares `pact` itself; `Creature` does not give it.
- **A pattern node meets a node with exactly its ports** (the same groups). A subtype that adds a port is not met
  by its supertype's pattern, though `≤` says it is one.

**Kaleidoscope:** the matcher compares port groups exactly, so the example writes each rule per kind (generated)
and keeps rules that need "any parent" parentless (siblings in a region), avoiding the question.

**Question:** width subtyping for ports. Either a subtype inherits its supertypes' ports (and may add more), and a
pattern of type T meets a node of type S ≤ T on T's ports alone, S's extra ports being "any link" as an unwritten
port is; or ports stay exact and supertypes are only for kinds with the same shape. The first is what `<:` reads
as, and what an author reaches for.

### F38. Idle edges, decided (F8)

**Came up:** ember · moss · mist lets a creature die with a pact (`Ember(?i) => ?i`, its port unwritten: any link).
The pact edge loses its last point when the partner dies too, and stays. Over 39,000 reactions, 2,800 idle edges
accumulated, invisible but carried in every state (and costing every index).

**Kaleidoscope:** states are now taken up to idle edges. After a reaction, an edge with no points that had a point
on a removed node, and no value, is dropped (`react`, listed in `edgesRemoved`). Nothing could match it: a redex's
closed edge has points.

**Question for the spec:** the same as F8, now with an answer to weigh. Dropping idle edges makes reaction
congruent up to them; `discover_sound` still holds (the occurrence composes back to the state before), but the
result is the composition *minus* idle edges, which the reaction theorem would have to say.

---

## Found building a whole cell (Boundary, `../boundary/cell`)

Boundary's organism is written as v004 programs and run on this engine. These entries come from that work.

### F39. A whole program, read: `Program(module = (…) | world = (…) | run = (…))`

**Came up:** a cell is hundreds of declarations across modules. The editor's library (types as lines, rules as
separate texts) cannot hold it, and a model kept in a TypeScript object is not in the language.

**Kaleidoscope:** `engine/program.ts` reads a program as v004 writes it. The module holds type declarations
`Name[binder] = Type[attrs](<: S | slot :: T)`, rules `name = lhs where g => rhs unless n` and modules
`m = Module["path"]`, which the caller's loader answers (each loaded once). The world is the starting state, and the run
holds the run's values. A type's own attributes in `Type[…]` become its style. A type whose kind is a scalar's,
`Mass = Type[kind = "float"](<: Float)` or one within it by `<:`, is a scalar type.

A rule side is one term or a bracketed place, and a line break ends it (decision 12, g12). This differs from the
editor's single-rule reader, where a side is a whole place. In a module it has to be this way, or a reactum would run
on into the next declaration.

**Question:** none for the grammar. Slots in a type's body `()` are read but not enforced here: a composite node
holds anything. Should the reader refuse a member a type does not declare once `types.defaults` and admission land?

### F40. A rule's rate written as its node's attribute (G7), PROVISIONAL

**Came up:** every rule in a cell has a rate law (`kcat · E · S/(Km + S)`), and LEGACY.md's G7 puts rate, priority
and label among the rule node's attributes, with no sugar decided.

**Kaleidoscope:** `name[rate = expr | label = "…"] = lhs => rhs`. The `[]` of a declaration's name holds the rule
node's attributes. It is told apart from a type's binder (`T[x :: Int] = Type(…)`) and a function's
(`f[x :: Int] :: Int = …`) by what follows: `k = v` rather than `k :: T`. The rate is evaluated per spot over the
redex's sites (F22).

**Question:** is `name[attrs] = rule` the sugar for a rule node with attributes? It reads as `H[A](B)` does: the
rule node `name`, its attributes `A`.

### F41. Slot defaults, constants, filled where a node is made

**Came up:** a cytosol is about 30 counts, most of them zero at first. Writing every one in every state and every
fresh reactum node is noise.

**Kaleidoscope:** `k :: T = v` in a type's binder declares a default (spec `types.defaults`, done). A state's nodes
and a reactum's fresh nodes are given the defaults of attributes they leave unwritten, when they are read. So it
costs nothing as the system runs. Kept reactum nodes keep what they had, as before. Defaults are constants here,
and are not inherited along `<:`.

### F42. Print writes a bare literal where its slot fixes its type (decision 13)

**Came up:** `Cell[mass :: Mass = 1.0]` printed `mass = Mass(1.0)`.

**Kaleidoscope:** an attribute's scalar whose type is exactly the slot's declared type is written bare, as decision
13 asks. Core is still written where they differ.

### F43. A run that resumes exactly: candidates in a canonical order, chance as a value

**Came up:** Boundary checkpoints long runs, saving the state as data and continuing later. The policy here
(`policy.ts`) takes spots in the order discovery keeps them, and that order depends on the history of incremental
updates. A resumed run, which rediscovers from scratch, draws the same random numbers against a different order and
diverges.

**Boundary's scheduler:** it takes live spots in a canonical order (rule, then spot key) and keeps the random
source's whole state as one number. A checkpoint is the carrier as data (identities kept), the clock, the random
state and the tallies. A run resumed from one reaches the state the uninterrupted run reaches, and Boundary's tests
check this exactly.

**Question:** R3 in Boundary's `docs/32`. With identities kept, a canonical order by spot is enough. Across a print
and read, identities change (Alike), so exact resume from text needs an order by value, not by identity. Should the
policy library order candidates by a canonical form of each occurrence?

### F44. Reaction in place: a world whose reactions cost what they touch

**Came up:** a cell's state holds its genome, thousands of nodes, and most reactions change a count or two. `react`
makes each new state by decomposing and composing the whole state, which is `apply_spec` taken literally, so a
reaction cost about 2.2 µs per node in the state: 27 ms per reaction at genome size (12,294 nodes).

**Kaleidoscope:** `engine/world.ts`. A `World` holds one state and changes it in place by the same reaction, applied
as a local rewrite:
- removes what nothing keeps;
- puts in the reactum's nodes, kept ones by identity;
- moves what the first use of a site held, copies it for each later use, and drops it for none;
- drops idle edges.

The index is kept by exactly those changes. `react` takes the world's identity counters (`opts.ids`), so the proof
can demand identity. The proof is `test/world.test.ts`: every reaction of eight systems, applied both ways, gives
`sameCarrier` states, identities included. Incremental discovery over the world (`Discovery.advanceWorld`, given what
the reaction could have changed as it stood: `Before`) finds what a full search finds after every step. Counts,
moves, drops, copies, fresh nodes, links and nesting are all exercised.

**Also found:** `react`'s transition reports every node a kept site held as moved, even contents put back exactly
where they stood. With `Cell(… | ?rest)` that is the whole genome on every reaction, and incremental discovery then
re-searches everything. The world reports only roots whose parent, key or links changed. The test above holds
discovery to a full search under that sharper report.

**Question:** the spec's cost law (`discover_local`) is about discovery. Should there be one for reaction too: a
commit costs what its occurrence and its site contents' moves touch, not the state? `Conforms` could state it as
`react` agreeing with a local rewrite.

### F45. A pattern's first root finds its candidates by type

**Came up:** the matcher found a first root's candidates, where nothing placed it, among every node in the state,
filtered by type. A rule that loses its only occurrence on each reaction (a count pool rule, whose one node changes
every time) is re-searched whole every step, and each search walked the whole state. That was most of the remaining
time.

**Kaleidoscope:** the index keeps nodes by type (`byType`, in state order) and the signature each type's subtypes
(`downs`). A first root's candidates are the nodes of its type and those within it, in state order, so results and
trajectories are unchanged (all existing tests, the stochastic simulations included). A world keeps the type index in
place.

Result, with both F44 and F45, on Boundary's cell with an inert genome: 44 nodes 338 µs, 1,294 nodes 306 µs,
5,044 nodes 264 µs, 12,294 nodes 239 µs per reaction. Cost no longer grows with the state. The editor's own
benchmark is unchanged.

### F46. Affine count rules, and many firings in one step (τ-leaping)

**Came up:** a cell pays about 4 ATP per amino acid, so a 350-residue protein costs about 700 glucose of glycolysis,
some 9,000 metabolic reactions for each protein made. Exact one-at-a-time simulation of metabolism cannot keep pace
with expression at real stoichiometry. Whole-cell models leap the high-count chemistry and keep the structural events
exact.

**Kaleidoscope:** `affine(rule)` recognizes a rule that only adds constants to whole-number attributes of the nodes
it meets: every redex node kept and unlinked, the reactum fresh only in those attributes (`?x ± c` of the
attribute's own value), and every other site put back where it stood. It returns each count's step.
`World.applyRepeated(rule, occ, k, steps)` applies k firings at once. The proof (`test/world.test.ts`): it prints the
same as k single applications, and incremental discovery stays a full search. Boundary's scheduler builds hybrid
τ-leaping on it:
- Cao–Gillespie–Petzold step selection;
- critical reactions (any that could use up a reactant within 10 firings) fire exactly;
- Poisson draws (Knuth, PTRS);
- a leap that would drive a count below zero is halved.

Counts move by whole steps, so conservation stays exact. Only timing is approximated.

**Question:** SPEC.md's scheduling section keeps "an approximation, which carries its own error contract" apart from
a model's law. τ-leaping is such an approximation, and it needs a kernel-recognizable property of rules (affinity in
counts) and an operation applying k firings. Is "affine in its counts" a declared property of a rule, checked by
admission, and `fire[k]` an operation the kernel offers for such rules, with the leap's error contract (ε, critical
threshold) a policy value in the run part?

### F47. Where only values change, occurrences stand: work out rates, do not search

**Came up:** in a cell, hundreds of occurrences read shared pools: every ribosome at work, every protein that could
be turned over, every gene. A leap changes only counts, yet incremental discovery treated each changed pool as a
structural change. It dropped and re-searched every occurrence meeting it, about 100 µs each, a thousand per leap.

**Kaleidoscope:** `Discovery.advanceValues(world, before, t, hosts)`. When a change is only to values (counts moved
in place, identities kept, nothing made, moved or broken), a rule whose occurrences cannot depend on values keeps
every occurrence, and their rates are worked out again. Such a rule has no guard, no negative and no literal value
in its redex. If a rule that does depend on values could meet a changed node, the full update runs. Affine rules
fired one at a time take the same path. The proof is `test/world.test.ts`: after every leap, the live spots, rates
included, are a full search's. On Boundary's cell, a simulated second went from 246 s to 2 s of wall time. The
trajectory was identical event for event, which the exactness requires.

**Modelling consequence (Boundary):** a guard that reads a pool makes every occurrence of its rule depend on that
pool's values. Writing the condition into the rate (`rate = if[enough … k 0.0]`) instead keeps the occurrence
standing, and the rule's effect is the same: a spot whose rate is zero does not fire.

**Question:** the spec separates a rule's guard (whether it meets) from its rate (the policy's weight). The
distinction has a cost model: guards are part of matching and rates are not. Should the spec say so, and should a
modelling guide prefer rate factors over guards where a condition reads a quantity that changes often?

### F48. Two links made one in a reaction

**Came up (lotus, 2026-10-13):** porting lotus's operations world, interaction combinators under conservation
(`~/code/lotus/v004`). When a γγ or δδ pair annihilates, the auxiliary links of the two agents must become one:
whatever was on the first agent's `l` is joined to whatever was on the second's `l`, and likewise for `r`. This is
the core of interaction-net reduction.

**Spec:** a rule's redex and reactum share one outer face, so two outer names of the redex stay two names. A reactum
can re-point a matched node's port, but it cannot say "u and w are now one link". That holds for standard bigraphical
reactive systems too. A DPO rule with a non-injective right morphism can merge, and so can a reactum composed with a
substitution.

**Lotus:** annihilation leaves a `Join[a = ~u | b = ~w]` node, which has no mass and no energy. Fast rules splice it
out: the neighbour on `u` has its port re-pointed to `w`. Because a neighbour must be matched by type and port (F49),
that takes one rule per (type, port) a neighbour can be on, for each side: 22 splice rules, plus one for a Join
closed on itself and one for a Join between two free ports. Generated by `lotus/v004/tools/gen_ops.py`. Correct, and
it keeps the books exact. The same need arises when a wire is contracted or any structure is cut out of a chain.

**Question:** is there a reactum form identifying two outer names: a linear substitution `u/w` composed with the
reactum, or a reactum outer face that is a quotient of the redex's? If not, is "a Join and its splices" the idiom the
spec recommends, and should the suite carry a case for it?

### F49. A bond matched whatever ports its ends are on

**Came up (lotus, 2026-10-13):** thermal detachment. Any bond lets go at a rate, whatever the types and ports at its
two ends. In ys (spec1) lotus wrote it once, matching two generic nodes and testing that they share a link
(`term.links` in a `where`). That was correct but quadratic, at 60–80 s CPU for a small world.

**Spec / kaleidoscope:** a pattern binds a link only at a named port of a named type (F37 for supertypes), so "the
two ends of link u, whatever they are" has no pattern.

**Lotus:** one detach rule per unordered pair of end kinds. With 8 kinds (γ and δ on p, l or r, ε on p, a Cap) that
is 36 rules, plus 22 splices (F48). The whole O2 world runs about 50× faster than in ys, so the cost is not in
running. It is in the text: a change to the elements means regenerating.

**Question:** could a redex name an edge rather than its ends? For example, `~u` with two points of any type and any
port, `(?a = Node[?q = ~u] | ?b = Node[?q2 = ~u])`, with the port as a variable. Link-directed matching (F27) would
make that cheap, and it is the natural form of any law about bonds as such: breaking, energy per bond, a bond's age.

### F50. A model's books cannot be stated in the program

**Came up (lotus, 2026-10-13):** every lotus witness asserts its books: mass (agents plus stock) and energy (bonds,
activations, sun, quanta, heat) constant. In spec1 that was an `Assert` computed in the program from folds over the
state. In v004 there is no `Assert`, `Fold` or `def`, so the books live in TypeScript (`lotus/v004/src/observe.ts`),
as boundary's do (`cell/src/observe.ts`). The same holds for the outcome of every one of lotus's 20 requirements in
`conformance/inherited/lotus/`.

**Question:** the suite's outcome format ("every `Assert` holds at the horizon") needs a way to state an invariant
over a whole state in the language. That means a sum over all nodes of a type, a count of edges with a property,
and a comparison with the initial state. Is that the planned observation axis (traces as data, G11), and until it
exists, how should a downstream state its outcomes so the suite can judge them?

### F51. A piecewise-deterministic policy: count rules integrated as a flow, structure jumping exactly

**Came up (Boundary, 2026-10-13):** the faithful Syn3A metabolism (Thornburg et al. 2022: 171 reactions, 272 rules
of reversible Michaelis–Menten and convenience kinetics) is stiff. Its fastest reactions (PGK, PYK, triose and
hexose isomerases) fire 10^5–10^6 times a simulated second over pools of a few hundred molecules. Exact simulation
and τ-leaping (F46) both stall on them. Hybrid leaping keeps them critical and fires them one at a time. The
published model is itself hybrid: CME for expression, ODE for metabolism (CME-ODE). That is a piecewise-deterministic
Markov process (PDMP), the same split as JumpProcesses.jl's `VariableRateJump` over an ODE.

**Kaleidoscope plus Boundary:** a rule is continuous when it is affine in counts (F46) and has no guard and no
negative. Its occurrences become reactions in extent space. Everything else jumps exactly.
- **Integrator:** ROS2 Rosenbrock, L-stable, with an embedded linearly-implicit Euler error estimate. It integrates
  the extents, with species y = y₀ + S·extent and a finite-difference Jacobian restricted to the sites a rate reads.
- **Realization:** the whole part of each extent is realized as firings through `World.applyRepeated`. Along a
  pathway one reaction's products feed the next reaction's reactants, so realization runs in passes over a working
  copy of the counts. A reaction is limited only by its own reactants. What does not fit stays pending.
- **Why this matters:** counts move only by whole firings, so conservation is exact, as under exact simulation.
- **Jumps:** a discrete event fires when the integrated discrete hazard reaches an Exp(1) draw. The flow then takes
  its count changes and is rebuilt over the new graph.
- **Result:** on the whole organism (421 rules: metabolism, expression, turnover), 85 simulated seconds take
  85 s of wall time: 3,000 flow steps standing for 7.7×10^7 firings, with carbon and phosphorus books exact
  throughout. Under exact SSA the same metabolism could not pass a second. `test/flow.test.ts` (Boundary) checks
  three things:
  - a reversible pair reaches its equilibrium with exact conservation, in < 1% as many steps as firings;
  - a discrete process reading a flowing pool produces events at the rate the analytic ∫ a(t) dt says, within
    4 standard errors over 6 seeds;
  - native compiled rates equal `evaluate` to 1e-12 on every affine rule of the organism.

**Engine support added:**
- **`Discovery.all(g)`:** every spot, rated zero or not. A flow must integrate a reaction whose rate is zero now but
  can rise. `live` drops such spots, and a flow built from `live` silently leaves reactions out.
- **`advanceValues(…, unrated)`:** a policy that works some rules' rates out itself (here, on the flow's real-valued
  state) asks discovery to keep their occurrences and skip their rates. Discovery then pays only for the jumps' rates.
- **Rates outside the graph:** the flow evaluates a rule's rate expression on a real-valued state vector, not on the
  graph. Boundary compiles `Expr` to a native function (`cell/src/native.ts`), where each site reads either a species
  index or a fixed graph value. Whole-number `/` stays integer division. Through `evaluate`, environment allocation
  dominated the Jacobian.

**Known limit:** the discrete hazard is held at its value from the start of each flow step (first order in h). Step
control bounds the error, but an exact PDMP integrates the hazard alongside the flow, as one more ODE component.

**Questions:**
1. SPEC.md's scheduling section allows "an approximation, which carries its own error contract". Is a PDMP split a
   policy the run part can name? It would need:
   - the continuous set: affine, unguarded, no negatives;
   - an integrator and tolerance;
   - whole-firing realization as the conservation rule.
2. Is "a rate expression is a pure function of its sites' values" a stated property, so that an implementation may
   evaluate rates off-graph and compile them?
3. Should the suite carry a PDMP case? An outline:
   - a reversible pair at equilibrium, plus a jump channel reading the flowing pool;
   - outcome: the jump count's mean within a stated tolerance of the analytic integral, and books exact at every
     observation.

### F52. A value rewritten where it stands: structure and value told apart in a transition

**Came up (Boundary, 2026-10-13):** most discrete events in the cell also spend from a shared pool. A protein finished
takes charged tRNAs and GTP from the cell's pools. A transcript broken returns its nucleotides. The transition
reported that pool as changed in two ways:
- the pool node itself, as kept;
- each count the reactum wrote (`Metabolites[gtp = ?g - 2 * ?l - 2]`), as a scalar removed and a fresh one created
  (`apply_spec` taken literally).

Incremental discovery then dropped and searched again every occurrence meeting the pool. That is the whole
metabolism, 272 rules, at about 50 ms an event: half the organism's run time. F47's value-only path did not apply,
because the same reaction also makes or removes nodes.

**Kaleidoscope (performance only, no change to what a reaction does):**
1. **`World.apply(…, { inPlace: true })`, opt-in.** A value the reactum writes at a key of a node it keeps, where
   the redex held a lone scalar at that key in a site it drops, is written into that scalar where it stands.
   - The identity `react` would mint is used up all the same, so every other identity is react's.
   - The transition lists such scalars as `revalued` (also in `kept`).
   - `applyRepeated` (F46) now reports its counts as `revalued` too.
   - Proof, `test/world.test.ts` ("values written in place"), for every library system and the pools program:
     - after every step, the state is `react`'s, the same carrier once each revalued scalar is identified with
       react's fresh one at the same holder and key;
     - incremental discovery over it is a full search.
2. **`Discovery.update`.** A kept node that stands as it stood (type, place, key, links and value) is no longer
   "changed". What it holds that changed is changed itself, and makes it affected.
   - A revalued scalar re-rates what meets its holder, unless a rule that depends on values could meet either.
   - `advanceWorld(…, unrated)` leaves a flow's own rules for the flow to rate (as `advanceValues`, F51).
3. **Three latent gaps, found by the full-search proofs once kept nodes stopped being over-reported.** Each had been
   masked by the over-reporting, and each is fixed:
   - The holder walk stopped at a node already reached in the other state, so a moved node's new holders were never
     visited (the lac operon's `repress`).
   - A rule with one passive rest site skipped re-search from a holder whose attribute changed. Dropping already
     told attributes apart; finding again did not (the embryo's clock).
   - A rule reading across links (`?ps.x`) missed a neighbour whose attributes changed (the embryo's `settle`).

**Results:**
- **Benchmark:** the embryo goes from 4.1 to 2.7 ms a step, and from 17 to 11 searches a step. The rest is within
  noise. The suite is 95/95.
- **Boundary:** 10 simulated seconds of the whole organism took 25 s of wall time and now take 3.5 s.
  - Discovery's share fell from 49% to 7%.
  - The rest came from Boundary's own scheduler, without engine changes:
    - the flow is kept across events that leave its reactions as they were;
    - compiled rates take their constants as parameters;
    - the flow's linear systems use a sparse LU with a static Markowitz order (KPP's method), every solve checked by
      its backward error, with dense pivoting as the fallback.

**Questions:**
1. **Identity of a rewritten value.** Does `n = ?n + 1` make a fresh scalar node, or rewrite the one standing at
   `n`? `apply_spec` mints a fresh one.
   - An attribute scalar has no ports and holds nothing, so its identity is observable only through identity
     counters.
   - May an implementation keep it? Is trajectory equivalence then "up to the identities of rewritten scalars"
     (as `applyRepeated` already assumes, F46)?
2. **Structure and value in a transition.** Should a transition distinguish a structural change from a value change
   (here, `revalued`)? `discover_local` could then state its obligation separately for each: occurrences meeting a
   node whose values alone changed stand, and are only re-rated where no value-dependent rule meets them.
3. **A suite case.** One reaction that both creates a node and spends from a shared pool, beside many value-free
   rules on that pool.
   - **Outcome:** incremental discovery equals full search after every step.
   - A case where a kept node's holder changes (a move into a kept container) and one where only a kept node's
     attribute changes, under a rule with a passive rest site. Those were the two places the obligation was easy to
     get wrong.

### F53. A law over two bonds at once costs a rule per port combination, and a law between any two motifs has quadratically many instances

**Came up (lotus, 2026-10-13):** bond exchange, two bonds swapping partners in one step. That is how a replicated γδ
loop separates into two copies (lotus `docs/o3-searching-for-persistence.md` §10–§11). The general law matches four
agents X, Y, Z, W: context bonds X–Y and Z–W, crossing bonds X–Z and Y–W, any ports. Its detailed-balance reverse
(fuse) joins any two doubly bonded pairs anywhere in the place.

**Kaleidoscope:** a supertype matches every subtype (`sig.sub` in `match.ts`), so one rule covers γ and every δ. That
works and helped. Ports, though, must be named (F49), so the general law is 6⁴ = 1,296 resolve rules plus 1,296 fuse
rules. With 10 loops it runs at about 5 s a step (resolve alone, 1.8 s; the bare interactions, 6 ms). Fuse also has
O(D²) instances in D doubly bonded pairs, whatever its syntax, and incremental discovery tracks every one.

**Lotus:** the law is restricted to active pairs as the context (16 rules, 34 ms a step) and driven by an activation,
so its reverse is suppressed by e^(−9) and lives only in a control arm.

**Questions:**
- Port variables (F49's question) would make the general law 2 rules.
- Could a rule whose redex is two disconnected motifs be sampled in aggregate, at a rate from their counts, without
  enumerating pairs? That is the mass-action form of a bimolecular law between structures, and the natural one for
  attach, fuse and any encounter in a well-mixed place.

### F54. A value change re-rates only what reads the changed keys

**Came up (Boundary, 2026-10-13):** under a piecewise-deterministic policy whose low-count reactions jump exactly
(Boundary's plan step D2), every jump moves a few counts in a pool that thousands of occurrences meet. Every flowing
reaction meets the metabolite pool, and so do every ribosome at work and every finishing transcript. F47's
value-only path re-rated every occurrence meeting the changed node, though most jumps change keys their rates never
read (a rare deoxynucleotide, an acyl-carrier form).

**Kaleidoscope (performance only):**
- **`Discovery.advanceValues(…, unrated, changed)`.** `changed` names, per host, the member keys whose values
  changed. An occurrence whose rate reads none of them there keeps its rate.
  - What a rate reads under each redex node is worked out once per rule: the keyed sites its expression names, or
    "all" where it names an anonymous site.
  - The proof (`test/world.test.ts`, "only what reads them is rated again"):
    - a three-key pool with leaps moving different key pairs and readers of each key equals a full search, rates
      included, after every leap;
    - a control told the wrong keys diverges, which shows the keys decide.
- **A cache of what discovery rates at each node** (excluding the `unrated` rules a flow rates itself), rebuilt only
  when the occurrences at that node change. A value change at a node met by thousands of flowing occurrences then
  costs what discovery actually re-rates.
- The suite passes 97/97. The benchmark is unchanged in what it counts; it does not use this path.

**What it did not do:** in Boundary, the organism's wall time per simulated second under D2 is unchanged within noise.
The cost is the number of flow steps: every exact jump ends one, and each step realizes, re-rates and refactors. That
cost belongs to exactness, not to bookkeeping. Boundary records it as the price of exact low-count chemistry (R7's
error contract: exact where it jumps).

**Question:** F52 asked whether a transition should tell value from structure. This adds which keys: a transition's
`revalued` could carry the member keys it rewrote, so that `discover_local`'s value-only obligation reads "occurrences
whose rate or guard reads a changed key at a changed node". Should the spec state rate dependence at the level of
keys?

### F55. F51's known limit closed: the jump hazard integrated with the flow

**Came up (Boundary, 2026-10-13, plan step D1):** F51's piecewise-deterministic policy held the jumps' total rate at
its value from the start of each flow step (first order). A jump whose rate reads a flowing pool (a ribosome finishing
reads GTP) then fired at a rate that was already out of date.

**Boundary (no engine change):**
- Every jump rate, structural ones included, is evaluated on the flow's continuous state. Each is compiled once per
  occurrence (Boundary `cell/src/native.ts`), its sites reading the state where they are flow species.
- The hazard is integrated across each accepted step by the trapezoid (second order, matching ROS2). Where it would
  pass the Exp(1) draw, the crossing is solved for (a quadratic in the step) and the step is taken again to that
  moment, where the event fires.
- **Measured** (`cell/test/flow.test.ts`): a pool decaying smoothly, with a jump channel reading it that is too rare
  to fire. The accumulated hazard, against its exact integral ∫ k a(t) dt:
  - integrated: within 0.12%;
  - held: 1.8% at the default tolerance.

  At a loose tolerance they are 2.9% against 12.6%; the integrated error there is the flow's own.
- **Cost:** about 1.4-1.6× the held mode's wall time in the whole organism, after keeping the compiled rates across
  structural events and summing once the rates that read nothing the flow moves. The held mode stays available as a
  stated first-order policy.

**For the spec (R7 in Boundary's `docs/32`):** a piecewise-deterministic policy's error contract should say how the jump
hazard is integrated. "Held per step" is first order in the step; "integrated with the flow" is the flow integrator's
order. Both keep conservation exact.

**Found on the way (Boundary only):** compiled rate laws were cached by rule name and the shape of their sites. Two
programs in one process with a rule of the same name and different laws then shared a compiled function, which carries
its literals. They are now keyed by the expression itself. Any implementation compiling rates should key by
expression identity, which matters as soon as variants of one model run together (an inference ensemble).

### F56. A literal in a redex made a rule value-sensitive at every node it meets, and molecule pairs are listed one by one

**Came up (Boundary, 2026-10-13, plan step R2):** Boundary unfolded four proteins (about 1,900 molecules) from counts
into one node per molecule. Each molecule carries its phosphoryl group as an attribute, and the per-molecule rules match
on it as a literal (`Mol_ptsI[P = 0]`). A rule like that also meets a pool of counts (`Metabolites[pep = ?x]`), whose
values only feed its rate.

**Engine change (`web/src/engine/incremental.ts`):**
- `Discovery` judged value sensitivity per rule: any literal anywhere in the redex made every node the rule meets
  sensitive to value changes. A count moving in the metabolite pool then took the full update instead of re-rating,
  and every occurrence meeting the pool was dropped and searched again, at every event and every flow realization.
- **Now:** for a rule whose only value dependence is literal attributes (no guard, no negative, no reading across
  links), sensitivity is confined to the redex nodes holding those literals. A value changing under any other node
  re-rates what meets it, as for a value-free rule.
- **Also:** each rule's occurrence count is kept as occurrences are added and removed, instead of counted over every
  occurrence at each update. Rules found again whole are cleared in one pass, instead of one pass per rule.
- **Measured:** in Boundary's organism with the PTS unfolded, one update went from 3.6 s to 16 ms. Benchmark before and
  after (incremental ms/step): MAPK 0.53 → 0.46, Growth 0.35 → 0.28, lac 0.29 → 0.27, yin yang 0.52 → 0.57,
  ×10 5.25 → 4.43, MAPK ×10 0.72 → 0.85, MAPK ×40 6.07 → 5.20; embryo 3.26 → 2.59. The machine was loaded (load about
  9), so the differences are within its noise. The suite passes 97/97.

**Still open (the next finding's motivation, Boundary R2b):** a rule meeting two molecules that share nothing
(`Mol_ptsH[P = 0] | Mol_ptsI[P = 1]`) has one occurrence per pair. In the PTS that is 77,000 occurrences, and a
scheduler that works over occurrences pays for all of them at every event. Its propensity is the product of each
component's matches. Kappa's simulators (KaSim) count the embeddings of a disconnected left-hand side as the product of
its components' embeddings, and choose each component's match independently. That is exact and never lists the pairs.

**For the spec:**
- Occurrence identity and the rate of a disconnected redex should be stated so that an implementation may factor them.
  An occurrence is a tuple of component matches, and the propensity is the rate summed over the product.
- A literal in a redex constrains where a rule matches. It should not make values elsewhere in the match structural.

### F57. Encounter rules held factored: a disconnected redex counted as the product of its components (F53's question)

**Came up:**
- **Lotus F53:** fuse joins any two doubly bonded pairs, O(D²) instances.
- **Boundary R2:** the PTS unfolded into molecule nodes. A phosphotransfer `(Mol_ptsH[P = 0] | Mol_ptsI[P = 1])` has
  one occurrence per pair: 77,000 in all, about 3,800 molecule matches.

**Engine change (opt-in; `web/src/engine/encounter.ts`, `incremental.ts`):**
- **The option:** `new Discovery(rules, sig, { factor })` holds factored each rule the predicate accepts that is an
  encounter rule. Without it, nothing changes, so the editor's one-at-a-time policy is as it was.
- **What counts as an encounter rule:** one region; two or more root components sharing no edge, name or site; no
  guard, negative or rest. The rate is a product (`*`, `/`) of factors that each read one component. The reactum's
  computed values cannot fail (`+ - *`). No type lies below two components' root types.
- **How it is held:** each component becomes a rule of its own, with the same node ids and its sites renumbered, and
  is discovered and kept incrementally by an inner `Discovery`.
- **Its spots:** one spot per rule and place, rate k × ∏ (each component's positive factors summed), with
  `occurrences` empty. `Discovery.sample(g, spot, random)` chooses each component's match by its factor and composes
  the occurrence. `occurrencesHeld` reports what is held.
- **Why the last condition:** a spot is the set of nodes an occurrence meets. Where no state node can be met by two
  components' roots, tuples of component matches and spots correspond one to one, so the product is exact.
  A symmetric product (`A | A`) would count each spot twice and is left enumerated. That is simpler than KaSim's
  null events and exact without them. Each non-encounter rule's reason is returned by `encounter()`.
- **Tests (`web/test/encounter.test.ts`):**
  - over 300-step runs on 3 seeds, each factored spot equals the full search summed for its rule and place at every
    step, and every sampled occurrence is one the full search has;
  - sampling frequencies match the rates (χ²);
  - 300 factored runs against 300 full ones agree in distribution;
  - with four times the molecules, the factored hold about four times as many occurrences and the listed sixteen;
  - Boundary checks the PTS: the same rates at the seed, and held occurrences reduced by exactly ∏ − Σ of the
    components (75,604 pairs against 3,826 matches).
- **Result:** the suite passes 102/102. Benchmark (incremental ms/step): MAPK 0.49, Growth 0.30, lac 0.21, yin yang
  0.35, ×10 4.02, MAPK ×10 0.55, MAPK ×40 3.70, embryo 2.50. That is no degradation against F56.

**Not yet:** the factored spots are rebuilt from the components each time they are asked for (linear in the
components' matches, with a sort per part). A scheduler wanting cost per event that follows only what changed needs
them kept incrementally, which is Boundary's R2b2.

**For the spec:**
- **The propensity:** a disconnected redex's propensity is a sum over tuples of component matches, which the spec can
  state as the product of sums where the rate factors.
- **Occurrence identity:** whether symmetric tuples are one spot or two (Boundary reads them as one, as `spotKey`
  does) must be stated. The rate of a homodimerisation depends on it (n(n−1)/2 against n(n−1)).

### F58. A value rewritten in place anchored a search for every rule with a literal of its type

**Came up (Boundary, 2026-10-14, plan step R3):** one gene unfolded to one rule per nucleotide and per codon (519
rules), each matching its machine by a literal position (`Translating_rpsK[pos = 12]`). A step rewrites the machine's
attributes in place (`pos`, and its atoms). The machine itself counts as unchanged (only what it holds changed), so
each rewritten attribute anchored a search on its own. Every rule's literal pattern node is of type `Int`, so each
passed the type test against it: 2,075 anchored searches per event, 17 ms a step on a world of 248 nodes.

**Engine change (`web/src/engine/incremental.ts`):** before an anchored search, the pattern node and the state node
must have the same payload (a literal, its value) and the same member key. A plan checks exactly these at every node
it meets (`plan.ts`), so the filter drops only searches that would find nothing. Searches per event went from 2,075 to
5, with the same trajectory, and a 129-codon elongation sample from 2.3 s to 0.29 s. The suite passes 102/102.
Benchmark (incremental ms/step): MAPK 0.36, Growth 0.28, lac 0.22, yin yang 0.44, ×10 3.96, MAPK ×10 0.56, MAPK ×40
3.88, embryo 2.50, level with F57.

**For the spec:** none; an implementation matter. Implementations should index or pre-filter anchors by payload and
member as well as type. A program written per position (residue-level elongation; any positional state as literals)
otherwise costs per event in proportion to its number of rules.

### F59. A factored rate regrouped two whole-number factors, and their quotient floored

**Came up (Boundary, 2026-10-15, plan step E2a):** the cell's concentrations inside now read a live volume, so a
mass-action rate became `0.327058 * ?x0 * ?x1 / ((?x4 / 61131000.0) * sqrt[(?x4 / 61131000.0)])`. As written it
divides a fractional product. F57 holds an encounter rule as its components, each with the rate's factors that read
it. That regrouped `?x1` and `?x4` (both whole numbers) into `?x1 / ?x4`, and the language divides two whole numbers as
whole numbers (floored, `expr.ts`). Every factored PTS rule then had rate 0, against 5,127/s listed.

**Engine change (`web/src/engine/encounter.ts`):** each component's product is seeded with `1.0`, so it stays a real
product, as the rule's rate is. A new test (`test/encounter.test.ts`): `2.0 * ?x / ?y` at x = 3, y = 4 is 1.5 per
match, listed and factored (it was 0 factored). The suite passes 109/109.
Benchmark (incremental ms/step): MAPK 0.41, Growth 0.22, lac 0.27, yin yang 0.40, ×10 3.87, MAPK ×10 0.58, MAPK ×40
3.95, embryo 2.61, level with F58 (one earlier run under load read MAPK ×40 at 7.7).

**For the spec:** a rate is a real number. Whole-number division in rate expressions is a trap: it makes a rate's value
depend on how its factors are grouped, so any rewriting (factoring, folding, simplification) must keep the grouping
or work in reals. Either rate expressions are evaluated in reals throughout, or the spec says where whole-number
division applies (attributes, not propensities).

### F60. No join on a value: a variable written at two sites is refused

**Came up (Boundary, 2026-10-16, plan step F1b):** a replication fork at segment k should step over the gene node whose
index is k. The natural rule is one rule for every segment:
`(?f = Fork[at = ?k] | ?s = Seg[seg = ?k | rep = 0]) => (?f = Fork[at = ?k + 1] | ?s = Seg[seg = ?k | rep = 1] | …)`.
The reader refuses it: "a redex site is written twice". A minimal program reproduces it (two node types, that rule,
three segments).

**Worked around, no engine change:** one rule per segment, each matching its gene by a literal index
(`Fork[dir = 1 | at = 12]`, `Gene[seg = 12 | rep = 0 | …]`). F58's payload filter keeps the 486 literal-anchored rules
cheap. The cost is rule count: one per position, as R3's elongation has.

**For the spec:** whether a variable may name two sites in one redex, meaning equal values (a join on a value), as a
link name already joins nodes. If yes, its matching semantics: an equality constraint checked after binding, or an
index on the value. Without it, a positional process (a fork, a ribosome at codon k, a polymerase at base k) needs one
rule per position.

### F61. Division: a site divided between two places

**Came up (Boundary, 2026-10-16, plan F2b; the requirement in Boundary's docs/32 R4 amendment):** a cell divides, and both
daughters run on in one world. That needs one rule to turn a composite into two of its type, its contents partitioned,
not copied.

**Engine change (`web/src/engine/divide.ts`, `rule.ts`, `text.ts`, `program.ts`):**
- A rule attribute `split = "r"` names a redex site that the reactum writes exactly twice (refused otherwise). Written
  twice a site is copied, as before. `divide(state, sig, roots, copied, random)` turns that copy into a partition, using
  the transition's own `copied` pairs:
  - a node holding counts (an int attribute whose type, or a supertype, declares `divide`) stands in both places, each
    count split by its policy: `binomial` (p = 1/2; exact below 64, the normal approximation above, held in [0, n]) or
    `half` (⌊n/2⌋ and ⌈n/2⌉, the odd one at random);
  - any other node goes whole to one place, uniformly at random, with all it holds; an edge left on no node goes too.
- The runner applies it after the reaction (it needs the site worked out, `Discovery.fresh`) and rebuilds what it caches.
- Tests (`test/divide.test.ts`): over five seeds, a pool's binomial count sums exactly, a `half` count of 11 is 5 and 6,
  and 20 tokens land once each; a split site written once or three times is refused. Suite 111/111; bench level with
  F59 (MAPK ×40 3.78, embryo 2.54 ms/step).

**For the spec:** the semantics of a divided site (the policies and what counts as a count) and its spelling. A rule
attribute is kaleidoscope's provisional spelling; Boundary's docs/32 proposes `?r/1`, `?r/2`. Conservation across a
division is a theorem of the definition: each count's parts sum to it, and each other node lands once.

### F62. Division: a constant kept in both halves

**Came up (Boundary, 2026-10-16, plan F2d):** a cell holds constants of its own, its stable RNAs' templates (each
RNA's base counts, which the rule that breaks it down reads). Divided as molecules, each template went to one daughter
only, and the other could no longer break that RNA down.

**Engine change (`divide.ts`):** a node whose type declares `divide = "copy"` stands in both places, as the copy left it.
It is for constants that hold no material, so copying conserves everything; the engine does not check that, its
declarer does. Test: a `Template` in a divided box is in both halves. Suite as before.

**For the spec:** division policies at the node level beside the count level (F61): `copy` for a composite's
constants.

### F63. A supertype pattern filtered by a literal attribute value is very slow to keep current (observed; no change)

**Came up (Boundary, 2026-10-17, plan C5):** two rules matched `Protein[client = 1 | n = ?n | u = ?u]`, meaning every
`Protein` subtype node, about 455 of them, filtered by a literal value of one of its attributes. The whole organism then
ran a 2 s window in 358 s of wall time, against 13 s for the same tree before. With the clients given a subtype of
their own (`ClientProtein <: Protein`) and the rules matching `ClientProtein[n = ?n | u = ?u]`, the same window took
13.4 s, with the same number of events.

**Not yet reduced to a small case.** The guess is that a literal-valued site on a supertype pattern defeats the
incremental discovery's indexed path, so the rule's occurrences are searched again across all subtype nodes on each
change. A fixture with a few hundred subtype nodes, one rule filtered by a literal and one by a subtype, timed against
each other, is the reproduction to write before any engine change.

**For the spec:** a literal attribute value in a redex is a filter that a matcher may index or may not. If the spec
promises nothing, a model author needs to know which spelling is cheap. Boundary now uses subtypes for such
classifications.

### F64. Integer division in a rate: floored on the graph, real on the flow (observed; no change)

**Came up (Boundary, 2026-10-17, plan H14c):** a rate held a ratio of counts, `?w / (?w + ?s1 + … )`, water over water
and solutes. On the graph v004 reads integer over integer as floor division, so the rate was exactly 0 and Discovery
dropped the spot. The PDMP flow, though, evaluates the same expression on its real-valued state, where the ratio is a
fraction, so the water flowed: about 10¹¹ per second each way. The same rule had two meanings in the two regimes, and
nothing said so. The model now writes `1.0 * ?w / (…)`.

**Reproduction to write:** a rule `r[rate = ?a / (?a + ?b)] = (P[a = ?a | b = ?b]) => (P[a = ?a - 1 | b = ?b + 1])`
with a = 3 and b = 1. Discovery gives rate 0. A run with the rule forced to flow moves `a`.

**For the spec:** either the flow keeps integer semantics where the spec has them (floor on the relaxed state), or the
spec says a rate is real-valued and `/` in a rate is real division. Integer floor in a reactum (a count's step) is
another matter, where the floor is meant (`?l / 10`). A checker could at least flag an integer ratio in a rate.

### F65. A supertype's pattern meets no node of a subtype declaring more attributes (observed; no change)

**Came up (Boundary, 2026-10-18, plan H8):** boundary's turnover of inserted membrane proteins matched
`InsertedProtein[n = ?n | …]`, a supertype. Its subtypes (`Ins_<gene>`) declare attributes the supertype does not, their
codon counts. The rule found no occurrence at all, though the signature holds each `Ins_<gene> <: InsertedProtein`. So
inserted proteins were never turned over, from boundary's H12c until a census test found it. Lipoproteins' uncut forms
(`Dag_<gene>`, declaring their signal peptides' residues) were missed by `Lipoprotein[…]` the same way.

**Reproduction:** `Sup[n :: Count = 0] = Type()`, `A[n :: Count = 0 | y :: Int = 1] = Type(<: Sup)`, the world `A[n = 3]`,
and `t[rate = 1.0] = (?k = Sup[n = ?n]) => (?k = Sup[n = ?n])`.
- **Observed:** Discovery finds no occurrence.
- **With `y` declared on `Sup` too, or not on `A`:** it finds 1.
- **A supertype attribute without a default, defaulted on the subtype:** it matches. Only an attribute the supertype
  does not know defeats it.

**Worked around, no engine change:** each supertype now declares every attribute its subtypes do, with defaults.

**For the spec:** whether a pattern on a supertype ignores the attributes a subtype adds, as partial attribute matching
ignores the declared attributes it does not name. That is open-world record subtyping, the reading boundary assumed.
Today they make the match fail silently. Either way, a refusal at read time ("this pattern can meet no node of these
subtypes") would have caught it at once.

### F66. Division: a node holding one count is copied whole, its other attributes with it (observed; no change)

**Came up (Boundary, 2026-10-18, plan H1/F2d):** boundary gave each message `Mrna[… | C :: Int | … | load :: Count]`, the
ribosomes on it. Because `Count` declares `divide = "binomial"`, `divide` (F61) took every message for a count holder:
it stood in both daughters, its `load` partitioned and its plain `Int` attributes (its atoms, `C`, `H`, …) copied. The
daughters held about 1.3 M more carbon than the mother. Boundary's division law caught it; `load` is now a plain `Int`.

**Reproduction:** `Count = Type[kind = "int" | divide = "binomial"](<: Int)`, `M[x :: Int | k :: Count = 0] = Type()`,
a world `Cell(M[x = 5 | k = 2])` and a rule splitting `Cell`. **Observed:** both daughters hold an `M` with `x = 5`.

**For the spec:** a node is either a pool (all of its counts divide) or a thing (it goes whole to one side). A node mixing
dividing counts with other int attributes is ambiguous, and today it is resolved by copying, which conserves nothing.
A checker could refuse such a type at read time, or `divide` could refuse to copy a non-dividing int attribute.

**Related, also observed:** nodes joined by a link (a ribosome and its message, on one `Message` bond) go to the two
daughters independently, so a bond can end up spanning them. Whether `split` keeps a linked group together is open.

### F67. A rate is real-valued: division in a rate is the true quotient (changed; closes F64 here)

**Decided upstream:** chrysalis `D-a-rate-is-real` (2026-10-18, boundary's B6): a rate is real, its division the true
quotient, never floored, the same under exact and hybrid policies; a reactum's Integer arithmetic keeps its floor.

**Changed:** `realDivision` (`expr.ts`) rewrites each division in a rule's rate as `(1.0 * a) / b` when the rule is read
(`text.ts`), so every evaluator, the engine's and a policy's own compiled form, reads it as real. Guards and reactum
computations are untouched: their whole-number division still floors. A rate meaning a floor writes `floor[a / b]`.

**Test:** `test/rate.test.ts`: `?a / (?a + ?b)` at 3, 1 is 0.75 (was 0); nested divisions too; a reactum's `?l / 2` at 7
writes 3. **Bench:** unchanged within noise (MAPK×40 incremental 3.70 → 3.58 ms/step; embryo 2.62 → 2.72 ms/step).

**Boundary:** six rate families that meant a floor (subunits available per copy, the ribosome footprint, the unfold
threshold) now write `floor[...]`; its water law's `1.0 *` workaround is now redundant.

### F68. A join on a value: a variable written at two attribute sites (changed; closes F60)

**Changed:** the reader (`text.ts` `buildRule`) takes a variable written at a second attribute site of a redex as a join:
the later site is its own, renamed (`?k#i`), and the rule's guard gains `?k == ?k#i`. The reactum, the rate and the
guard read the first. A structural site (one holding nodes) written twice is still refused.

**Semantics and cost:** the equality is tested on the occurrences the redex's structure meets, after binding, as
chrysalis `interp.patterns` (docs/QUERIES.md C4) has it. There is no index by value (B5's open question): a join over
N × M candidates costs N × M where the structure alone meets them all. Incremental discovery keeps it current, since a
guard's sites are read sites (a change of value at either side re-rates the occurrence).

**Test:** `test/join.test.ts`: a fork at segment k meets only the segment whose index is k, one rule for all segments,
the fork stepping along all three in order; incremental discovery equal to a full search over 200 steps of a two-
attribute join whose values move on both sides; a structural site written twice refused.

### F69. Keyed counts: one entry per place, type and key; find or make, merge, a zero leaving (changed)

**Decided upstream:** chrysalis `D-keyed-counts-are-a-place-keyed-by-a-record` (2026-10-18, boundary's B1).

**Changed (PROVISIONAL surface):** a type declares `Type[keyed = "n"]`: its nodes are entries, keyed by their type and
every attribute but `n`, their count. After every reaction (`World.reconcile`, from `World.apply` and from `react`),
an entry the reaction made, moved, copied or rewrote merges into its place's entry of the same key, the counts summed,
and an entry at count 0 leaves. So a reactum writes `Rna[a = 1 | b = ?y | n = 1]` to add one molecule at that key,
whether or not the place holds it. The transition names the merged entry as removed and the survivor's count scalar as
removed and made, so discovery is told exactly what changed. Each place's entries are mapped by key once, kept as
entries are reconciled and checked on use; a key held twice when the map is built (a state not yet reconciled) is looked
up in the place. Division needs nothing new: an entry's count is a `Count` (F61's count holder, F66), so it is split
between the daughters and its key kept in both.

**The spec's shape and this one:** the decision is a map place keyed by an attribute record, its values counts. Here the
entries are ordinary nodes and the key is their attributes; matching is the engine's partial attribute match. The
equivalence with the molecule-per-node form is stated, not yet checked as a fold (B4).

**Not done:** an entry at 0 under a flow (a PDMP's relaxed count) stays until a reaction touches it; uniqueness is not
affected. A redex cannot take two molecules from one entry (matching is injective); write the count down by 2.

**Test:** `test/keyed.test.ts` (boundary's suite case B1): an RNA with sites a and b, an enzyme for each, degradation of
any; over seeds, in place with incremental discovery and as pure reactions: the books exact, one entry per key, none at
0, discovery equal to a fresh search after every merge; the mean count with a made at t = 10 against the closed form
within three standard errors.

### F70. A rate is per spot: a keyed entry of count n is n spots (changed)

**Decided upstream:** chrysalis `D-a-rate-is-per-spot` (2026-10-18, boundary's B2; F22): a rule's rate is each
occurrence's propensity, a rule meeting a count of n molecules being n spots, each molecule equally likely.

**Changed:** for each keyed node in a redex, the reader multiplies the rule's rate by that node's count (the site at
its count, written or implicit, or the literal written there). The rate as written is per molecule; every evaluator
reads the product, a policy's compiled form and a flow's relaxed counts included. Non-keyed counts are untouched: a
pool's attribute (`Metabolites[atp = ?a]`) is a value, and its mass action stays written in the rate.

**Not done:** a draw of several molecules of a class in one event (a library draw without replacement, multivariate
hypergeometric, per the decision). One event meets one entry per keyed redex node.

**Test:** `test/keyed.test.ts`: entries of 30 and 70, a consumer at rate 1 per molecule: propensities 30 and 70 (35 for
a rule at 0.5 not writing the count); the first molecule taken over 400 seeds from the larger entry 0.7 of the time
within three standard errors.

### F71. An amount of a class in an expression: a keyed class's counts summed (changed; part of B3)

**Asked:** boundary's B3 (`docs/36`; chrysalis R-aggregates-in-rates-maintained, planned). The spec's form is a fold,
`sum[P(n = ?c) -> ?c]`; boundary needed the case of a keyed class first: how many charged tRNAs of a species there are,
over every modification state.

**Changed (PROVISIONAL surface):** `amount[?p Type[k = v | …]]` in a rate, guard or computed value: the counts of the
keyed entries (F69) of Type, or a subtype, that the redex's node `?p` holds, whose attributes `k` equal `v` (literals or
the redex's values), summed. It is worked out where it is read, over what `?p` holds (keep a class's entries in a place
of their own, so the scan is the class's size). Incremental discovery keeps it current: a rule reading an amount is
never lazy, and a change to any keyed entry is a change that touches it (its place, holding the change, is affected).

**Fixed beside it:** an occurrence's rate was evaluated with no map from redex nodes to the state's (`siteEnv` without
`nodes`, in discovery and the policy, and in boundary's runtime), so a rate could read no named node; it can now.

**Not done:** the general fold (`sum[P(…) -> E]` over any pattern), and a maintained sum (O(1) per change): the amount
is a scan of the place, B3's cost question open. Under a flow, an amount reads the world's values unless the flow's
environment gives its own `attr`.

**Test:** `test/keyed.test.ts`: a reader's rate 0.01 × the charged of its species over every mark, equal to the law at
every one of 300 steps while entries are made, merged and drawn down, and discovery equal to a fresh search throughout.

### F72. A draw of several molecules of a class in one event (changed; closes B2)

**Decided upstream:** chrysalis `D-a-rate-is-per-spot`: drawing several molecules of a class in one event is a library
draw without replacement (multivariate hypergeometric over the class's entries).

**Changed (PROVISIONAL surface):** a rule option `draw = take[?p Type[filters] count Type[rewrites]]` (and `draw2`, …):
when the rule fires, `count` molecules are taken from the keyed entries of Type that `?p` holds and whose attributes equal
the filters, one at a time without replacement, each equally likely, and put back beside their entries with the rewrites
applied, then merged by key (F69). The values are read before the reaction. The rule meets only where the class holds
`count` (an implicit guard on its amount, F71). `World.apply` and `react` take a source of chance for it (`random`);
`step` passes its own.

**Test:** `test/keyed.test.ts` (boundary's B2 E3): three charged tRNAs of a species drawn from marks 0 and 1 (30 and 70)
and put back uncharged: the books exact, one entry per key, another species untouched; over 400 seeds the number from
mark 1 has the hypergeometric mean 2.1 and variance 3 · 0.7 · 0.3 · 97/99 within three standard errors; in place, with
discovery current; a class holding fewer than the draw is not met.

### F73. A keyed move read as its merge and its make, so the merge can flow; joins in negatives (changed)

**Came up (Boundary, plan H9a):** a rule writing a keyed entry (F69) finds it or makes it. Read as one rule it makes a
node every time, so it is never affine (`affine`), and a runtime integrating affine rules as a flow (boundary's PDMP)
must jump it. tRNA charging, written on keyed entries, is ~10⁵ firings a second: it has to flow.

**Changed:** `keyed.ts` `splitKeyed`, from the program reader. A rule whose reactum makes one keyed entry, its key
written in literals and the redex's values, is read as two rules:
- **merge** (its own name): the entry at that key is in the redex (`?__t`, each value of its key a variable of its
  own joined to the redex's by `where`, F68), and the reactum adds the count to it. Every node kept, only counts
  changed: affine where the rest of the rule is.
- **make** (`name+`): the rule as written, `unless` an entry stands at that key.
Exactly one meets where the rule as written would, and does what it would. The target is no reactant: its count does
not multiply the rate (F70). A rule making more than one keyed entry, or one whose key is an expression, is not split.

**Two engine changes it needed:**
- **A join in a negative:** a negative naming a redex value at an attribute of what it adds (`unless Rna[a = 1 |
  b = ?y]`) took no constraint from it (the site was skipped), so it blocked wherever any such node stood, or nowhere.
  It is now its own site, joined by an equality checked when the negative is met (`negativeGuards`).
- **`affine` and literals:** a rule matching a literal at a kept node's attribute (`Rna[a = 0 | …]`) writes it back in
  its reactum, a fresh scalar node, and its redex holds that literal as an unkept node; so no such rule was affine.
  Now a literal written back unchanged at the same key of a kept node is no change. (Boundary's organism: no rule
  changes regime, 545 of 1396 affine before and after; it has no negatives.)

**Test:** `test/keyed.test.ts`: the B1 program reads as five rules, the two merges affine and the makes not; at the
seed only the makes meet (rates per molecule of the source: 10 and 5), and once the entry stands only the merge meets,
at the same rate; the laws and the closed-form marginal hold as before.

### F74. An amount in a rate is re-rated, not found again; a draw's availability is a rate factor (changed)

**Came up (Boundary, plan H9b):** coarse translation, the rescue and the stringent response read every tRNA species'
charged amount, at every ribosome at work (hundreds of occurrences), while charging changes those entries ~10⁵ times
a second. F71 kept amounts current by making every keyed type value-sensitive, so each change found every occurrence
meeting the place again: a search where a pool's value change costs a re-rating.

**Changed:**
- **An amount in a rate** is read as the rate reading everything its place holds (`readsAt`: 'all' at that redex
  node). Where a keyed entry is made, removed or its count changes (a reaction, or values moved in place), what meets
  its place is rated again, not found again. Only an amount in a guard or a computed value (which decides what meets)
  keeps the full search, and its rule is never lazy.
- **A draw's "the class holds k"** (F72) is now a factor of the rate, `if[amount >= k 1.0 0.0]`, not a guard: the
  occurrence stands whatever the counts, at rate 0 while the class is short. A policy firing it must still see the
  class hold k (boundary's runtime checks the graph's entries before a jump, as it does a jump's decrements).

**Test:** `test/keyed.test.ts` (F71's: the amount equal to the law at each of 300 steps, discovery equal to a fresh
search after every merge, make and draw-down; a short class met at rate 0).

### F75. A rate reading an entry's count is that entry's propensity as written (changed; amends F70)

**Came up (Boundary, plan H9b):** every tRNA law boundary had was written over a pool's count, saturating in it
(`?f / (K + ?f)`). Made keyed entries, F70 multiplied each again by the entry's count, `f²`.

**Changed:** the per-spot multiplication (F70) applies to a keyed redex node only where the rate does not read that
node's count. A rate reading it is the entry's whole propensity, as its author wrote it: a saturating law over a class
is `?f / (K + amount[…])`, the entry's count over the class's (F71). A rate not reading it is per molecule.

**Test:** `test/keyed.test.ts`: at an entry of 30, `rate = 0.5` meets at 15, `rate = 2.0 * ?k / (10 + ?k)` at 1.5.

### F76. Value sensitivity by attribute key; keyed counts rewritten in place (changed; performance)

**Came up (Boundary, plan H9b):** with its tRNAs as keyed entries, boundary's organism ran 2× slower than with them as a
pool, then (after F74) still ~5× in its discovery: every structural event found ~65 single-occurrence rules again whole.
Two causes:
- **Reconcile and draw replaced count scalars** with fresh nodes, so a merge was a structural change. Now they write
  the count where it stands, named `revalued` (as `World.apply`'s `inPlace` does): a merge is a change of value.
- **Whether a value change can change what meets was decided by type:** any rule with a negative (each keyed make,
  F73: 111 in the organism) made every type its redex meets value-sensitive, `Metabolites` and `Machines` among them,
  so every count changed there was structural, and every lazy rule meeting them was dropped. Now each rule's value
  dependence is read by attribute key (`valueKeys`): its literals' hosts and keys, the sites its guard and joined
  negatives read, and every node of a rule reading across links or an amount in a guard. A negative that only adds
  nodes tests presence, not values. `sensitive(type)` reads the same map. (A first version also counted every
  attribute literal's own type, `Int`, which made every count sensitive: a literal's own type counts only where it
  stands as no node's attribute.)

**Measured (boundary's organism, seed 3, 3 s, PDMP, one engine):** pool-form tRNAs 33.2 s (searches 0.3 s);
keyed, before: 170 s per 0.3 s at first, then 64–66 s (searches 15.7 s); after: 40.3 s (searches 1.1 s). The rest is
in the flow: the same 870 steps, each law reading its class's entries (charging's amounts), 1.3–1.4× the rate
evaluations' cost. **Bench:** unchanged (MAPK×40 incremental 3.52 ms/step, embryo 2.58).

**Test:** the engine's incremental-against-full tests (`incremental.test.ts`, `keyed.test.ts`, `join.test.ts`).

### F77. A draw across types, each molecule put back by its own type (changed; boundary H9c)

**Asked upstream:** boundary `docs/37` §C; chrysalis `R-a-draw-across-types-puts-back-by-type` (open; the provisional
form's test sent as `boundary/upstream-contracts/spec5-asks/h9c-draw-across-types.ys`).

**Changed (PROVISIONAL surface):** a draw's class is any type, its keyed subtypes its entries (a codon class: a supertype
each reading tRNA species declares, `<: ReadsGGA`; a type may declare several). Its rewrite may name, in place of a type,
a style key no type has (`uncharged[]`): each drawn molecule is put back as the keyed type its own type's style names
there (`Type[… | uncharged = "T_freeA"]`), keeping its other attributes, and merged by key (F69). The reader refuses a
class one of whose keyed types names no keyed type at that key.

**Test:** `test/keyed.test.ts`: 10 drawn from readers A (30) and B (70, mark 1): each species conserved, B's put back at
mark 1, one entry per key; over 300 seeds the number from B has the hypergeometric mean 7 within three standard errors.

### F78. An amount read once per pass of rating, from its class's entries (changed; performance)

**Found (boundary, 2026-10-20):** the organism's cost per simulated second grew with the number of translating
ribosomes, 7.6 s at 2 s to 24 s at 5 s, and a 60 s test run had not finished after 90 minutes. Each translating
ribosome has three occurrences (finishing, the tmRNA rescue, the stringent response). Each reads the amounts of
the 28 codon classes, in its rate or its draws' availability (F74). Charging changes the tRNA entries at every flow
step, so every one of those occurrences was rated again at every step. Each amount walked every child of its place,
a few hundred entries, to find its class's few.

**Changed (no surface):**
- `Index.childrenOf(place, owner, class, keep)` lists a place's children of one class once, and again only after a
  node joins or leaves the place (a version per place, bumped in `rekey`, which every add and drop calls).
- `withinPass(fn)` (expr.ts) runs one pass of rating, in which the state does not change. Each `amount` expression
  keeps its readings for that pass, by place and its filters' values. Both of discovery's re-rating loops
  (`advanceValues`, and the values pass of `update`) run in one. Outside a pass, nothing is kept.
- Exact: the same trajectory, step for step (boundary, seed 7, 6 s: 833,657,327 steps before and after).

**Measured (boundary's organism, seed 7, PDMP, one engine):**
- 6 s: 110.5 s before, 78.4 s after.
- Rate evaluation from 4 s to 5 s, with 43 ribosomes translating: 9.4 s before (47,000 calls), 1.1 s after (81,000
  calls). What remains is the flow's integration.
- 10 s on a quiet machine: flat at 9–13 s a simulated second from 2 s on, where before the fix it grew past 24 s by
  5 s. (A 30 s run under heavy load from other jobs on the shared machine looked as if it climbed again. Repeated on a
  quiet machine, it did not.)

**Bench:** unchanged (MAPK×40 incremental 3.52 ms/step). **Engine tests:** 127/127.

**Test:** the engine's incremental-against-full tests, which compare every rate after every step with a full
re-evaluation (`incremental.test.ts`, `keyed.test.ts`).

### F79. A change of value's sensitivity, answered once per type and key (changed; performance)

**Found (boundary, profiling, 2026-10-20):** of 10 simulated seconds of the organism (110.7 s), the flow's realization
took 43.4 s. Nearly all of that was discovery's check of whether a change of value could change what meets
(`sensitiveAt`, F76). A realization moves hundreds of keys on the metabolite pool every flow step. For each one, the
check scanned every rule's value key with a subtype test.

**Changed (no surface):** the answer for a type and a key is kept for the run. The rules, and so the keys they read,
are fixed once read.

**Measured (boundary's organism, seed 7, PDMP, 10 s):**
- 110.7 s before, 70.0 s after (11.1 → 7.0 s per simulated second); the realization 43.4 → 6.6 s.
- Exact: the same 3,284 flow steps, the books exact.

**Bench:** MAPK×40 incremental 3.59 ms/step (3.52 before, within the shared machine's noise; it does not realize a
flow). **Engine tests:** 127/127.

### F80. Discovery counts the changes to which spots are live (changed; performance)

**Found (boundary, profiling, 2026-10-20):** the organism orders its live spots for its events, and kept that order only
until the next write into the graph. A flow writes every step, so the order was listed again before almost every event:
`live()` alone took 4.2 s of 65 s (10 simulated seconds), and the hazard's cache, keyed on the order, was rebuilt as
often.

**Changed (an addition):**
- `Discovery.version` counts each change to the set `live()` returns: a spot made or dropped, a rate crossing what
  `live` takes (positive and finite), the rebuild, and, through the parts' discovery, a factored spot's.
- While it stands, `live()` lists the same spots. A policy may keep its ordering of them.
- Every rate discovery assigns goes through `setRate`, which checks the crossing.

**Measured (boundary, seed 7, PDMP, 10 s):** 65.2 s before, 58.1 s after (5.8 s per simulated second); the hazard's
evaluation 14.0 → 10.9 s, its cache now kept across realizations. Exact: the same 3,284 flow steps and 840,486,988
steps.

**Bench:** MAPK×40 incremental 3.64–3.81 ms/step over three runs, against 3.52–3.59 earlier today. The same code runs
±5% apart on the shared machine. `setRate` adds two comparisons to each rate assigned. **Engine tests:** 127/127.

### F81. A scalar's and a member's key built on the spot, not cached by object (changed; performance)

**Found (boundary, profiling, 2026-10-20):** a test file of four tests took over 12 minutes, though each test alone
took 8–120 s. The fourth test's run did the same work after the others (the same firings per simulated second) at a
fifth to an eighth of the speed. Profiled, `memberKey` took 92.5 s of 145 s (1.5 s when the test ran alone) and
`scalarKey` 16.6 s (1.2 s). Both cached their key in a `WeakMap` keyed by the scalar or member object. Every cloned
carrier (`structuredClone`, a `World`, every withdrawal a test builds) brings a million new member objects, and their
dead entries stay in the table until a full collection. Measured alone, a `WeakMap` cache cost more than building the
key at any size (2 M objects: 1,591 ms, against 199 ms with no cache), and it grew slower with size.

**Changed:** `scalarKey` and `memberKey` build their string each time. A text scalar's key alone is kept, in a `Map`
keyed by the text itself (a program's texts are few and fixed). Keys are unchanged, so nothing that indexes by them
changes.

**Measured (boundary):** after F81, `test/replication.test.ts`'s four tests run as their parts do (see boundary's
PROGRESS, 2026-10-20). **Bench:** MAPK×40 incremental, old and new back to back, twice each: old 3.93, 3.96, 3.73,
3.79 ms/step; new 3.92, 3.51, 4.00, 3.84 (parity, within the shared machine's ±5%). Without the text cache, new read
3.82–4.35, perhaps 5% slower, hence the text cache. **Engine tests:** 127/127.

### F82. A world's lists kept by node id, so a resumed world is the world that made it (changed; determinism)

**Found (boundary, C4a, 2026-10-21):** boundary's `test/parallel.test.ts` resumes a run from a worker's checkpoint and
asks that it go on exactly as the uninterrupted run does. Seed 4 (with the Jacobian reused) began to fail after a
model change, though the checkpoint was exact (state, clock, random state, tallies all equal). Stepped side by side, the
two runs fired the same events with the same occurrences; after a keyed make (`rnaseP_IleCAU+`, F73) the states held the
same nodes with the same identities, in a different order in `g.nodes`, and the order then decided later matches.

**Cause:** a `World` changes its state in place. It appends each made node to `g.nodes` and to its index's lists (a
type's nodes, `byType`; a place's children, `kids`; a handle's points), and removes a node by swapping the last into its
place in `g.nodes`. So its lists follow its history, and after removals they no longer follow `g.nodes`. A world built
from a snapshot of that state builds its lists from `g.nodes`, in another order. Discovery meets a place's children,
and a type's candidates, in list order, so the two worlds met occurrences, and removed subtrees (a keyed merge drops an
entry's children in list order), in different orders: the same graph, written differently, and in time different draws.
The model change only made a run meet it within the test's window. Every resumed world was open to it.

**Changed:** a world keeps each of its lists in node-id order, which is the state's alone (`Index.orderById` when the
world is made; `insertById` as it makes a node: at the end, as a new node's id is the newest, else in its place, as for
a node made again under its own id). A carrier's own index, as functional reaction builds it, is unchanged: its lists
follow `g.nodes`, which a snapshot carries exactly. (Ordering every index by id was tried first: the embryo bench slowed
1.83 → 2.4 ms/step, sorting each functional step's fresh index, for nothing, so it is the world's alone.)

**Tests:** `test/world.test.ts`, "a world resumed from its snapshot": each library system, 120 steps in place, then a
world made from its snapshot (its next identities carried, as a checkpoint carries them) and the original step on with
the same draws, taking the live spots in the order the search meets them, unsorted; same rule, same occurrence, the
same state, list for list, at every step. Before F82, 7 of 8 systems fail at their first step; after, 8 of 8 pass.
**Engine tests:** 135/135. **Bench**, three runs each: embryo old 1.82, 1.83, 1.85 ms/step, new 1.81, 1.85, 1.78;
MAPK×40 incremental old 3.72, 3.94, 5.04, new 3.65, 3.79, 3.74 (parity).

**For the spec:** a checkpoint must determine the run that follows it, so nothing an implementation orders by its own
history may decide which occurrence a draw takes. A state's canonical order (here, identities) is one way to say so.

---

## Found modelling history (cycle, `../cycle`)

### F83. A spot's occurrences can be different reactions: rate a spot by its events (changed; semantics)

**Came up:** cycle's 鹬蚌相争 (`../cycle/stories/yu-bang-xiang-zheng.ys`). Two polities at war wear each other down,
each in proportion to the other's strength:
`(~w :: War | ?a = P[wars = (~w | ?as) | s = ?x] | ?b = P[wars = (~w | ?bs) | s = ?y]) => (… ?a's s = ?x - 1 …)` at
rate `0.05 * ?y`. The redex is symmetric, so both ways round (a wears, b wears) meet the same nodes and edge: one spot.
The spot was rated by its first occurrence alone and fired one of its two occurrences uniformly. So the war ran at
half its written rate, and the rate it ran at was whichever side's the discovery happened to list first. The
incremental and the plain discovery list them in different orders, so the two paths gave different distributions:
over 300 runs, from a world symmetric between the two belligerents, one path had them win 91 : 47 and the other 48 : 44.
The cause was not stale rates, though it first looked like it.

**Why spots were the unit (F14):** a symmetric rule `A | A => B` meets one pair of As twice, each way round, and the
two are one reaction. Counting occurrences would double its rate. With a constant rate that was enough. With rates read
from the occurrence (F13, F22) and a reactum that tells the two ways round apart, it is not.

**Changed (`engine/events.ts`):** two occurrences of a spot are one event where what they do is the same: the reactum
instantiated against the state (each kept node as the state node it is, each fresh node by its type, each site by the
roots it holds, each computed value worked out, each link as the state's), and their rates are equal. That is so
exactly where a symmetry of the whole rule (redex, reactum, guard and rate together) takes one to the other: the
symmetry factor of rule-based modelling (Kappa, BioNetGen), worked out per spot rather than per rule. A spot's rate is
the sum of its events' rates. An occurrence is drawn in proportion to its event's rate, shared among the event's
occurrences (`pickOccurrence`). A spot of one occurrence (nearly every spot) is rated as before, at no extra cost.
`policy.spots` and `Discovery` both rate spots by `eventRates`. `Discovery` rates a spot again whenever an occurrence
joins it, and once at the end of an update for a spot that lost one.

**Tests:** `test/events.test.ts`: `A | A => B` at rate 2 rates 2 (one event); the war above, sides at 3 and 5, rates
3 + 5 = 8 (two events); and the rates stay right as the world changes in place, step for step against a plain
discovery. **Engine tests:** 141/141. cycle's `run/same.ts`: the incremental and plain paths now agree over 300 runs
(214 : 46 : 40 and 216 : 45 : 39), and the belligerents are symmetric.

**Cost (changed, same day):** grouping a spot's occurrences by their effects on every re-rate was a quarter of a
TCTG13 step, where nearly every spot holds two occurrences (a border, each way round). Whether two occurrences are one
event depends only on the permutation of redex nodes relating them (a symmetry of the rule or not), so the answer is
kept per rule and permutation (`eventSizes`): the effects are compared once per permutation, and a spot's grouping is
worked out only where its occurrences change, never where only values do. The same firings, step for step.

**Not covered:** fresh nodes are named by type in the effect, so two effects differing only in how fresh nodes are
arranged among themselves would be taken as one. No rule here does that. A canonical form of the instantiated
reactum (`Spec/Basis/Canon.lean`) would close it.

**For the spec:** G7 (rates) and the scheduling axis's unit of choice (F14's question) need a statement of when two
occurrences are the same reaction. Proposed: two occurrences are one event iff a symmetry of the rule (an automorphism
of redex and reactum together, fixing the faces, under which guard and rate are invariant) takes one to the other. A
policy weighs events, never occurrences or spots. The per-spot test above is a decision procedure for it.

### F84. Several rests of points put back in one reactum port: the union of link groups (changed; expressiveness)

**Came up:** cycle's 鹬蚌相争 again. A polity worn to nothing is conquered, and the victor takes over its other wars:
`?a = P[wars = (?as | ?bs)]`, the victor's own fronts and the loser's. The reader refused it ("one rest of points at
most"). The workaround was one rule per number of fronts the loser had, naming each extra link. That works for three
polities and not on a grid, where a polity has up to eight neighbours. The same shape is every *transfer of links* in
history: conquest (the conquered's alliances and wars), merger (two firms' or two cities' trade partners), succession
(an heir takes the house's marriages and debts), and in biology, fusion (a merged cell's contacts).

**Changed:** a reactum's port group may name several rests: `rest` as before and `more` (`PortGroup.more`,
`carrier.ts`). It holds the points of each in turn, after its own. A redex group still has one rest at most, since with
two, which points each held would be ambiguous; the reader says so. `react` and `World.apply` put the union back
alike, and the effect key of F83 reads it.

**Tests:** `test/rests.test.ts`: a conquered polity at war with three others; after conquest the victor is at war with
those three, and it is the same reaction in place as functional; a redex with two rests is refused. **Engine
tests:** 141/141.

**Open:** where two of the rests hold points on one edge (the victor and the loser were both at war with a third), the
union holds both, so the victor has two points on that edge. It is a well-formed bigraph, and a multiset union. A
set union (one point per edge) is sometimes wanted (one war, not two), and would need either a law in the reactum
or an idempotent link type. The spec should say which a port's union is, or let the link type say (F28's port types).

**For the spec:** a reactum port's points are a list of named rests and links, and the composed group is their
concatenation. This is the reactum-side dual of F28's rest: redexes split a group into named points and one rest;
reactums join any number of rests.

### F85. A later root is met from a linked member, upward (changed; performance)

**Came up:** cycle's replication of Turchin et al. 2013 (`../cycle/stories/tctg13.ys`): 2,647 cells, each in a polity
of its own at the start, and conquest across a border:
`(~e :: Adj | ?p = Polity(?c = Cell[adj = (~e | ?ca)] | ?pr) | ?q = Polity(?d = Cell[adj = (~e | ?da)] | ?qr))`.
The plan met the pattern's nodes root by root in written order: ?p, ?c, then ?q from all of Earth's 2,647 children,
and only then ?d by the link. That is every pair of polities: 6 s to find this one rule's 6,150 occurrences.

**Changed (`plan.ts`):** a root none of whose own points is on a link already bound, but which holds a node that is,
is met from that node upward: the node first, by the link, then each of its ancestors as the one parent of what was
met (`Step.up`), up to the root, then the rest of the root's subtree as before. Two siblings joined only through their
members then cost the points on the link: 6,033 ms → 214 ms for the rule, the same occurrences.

**Tests:** `test/upward.test.ts`: the pattern above in a world of four polities finds each of the eight
cross-border adjacencies, each way round, unanchored and anchored at every node. **Engine tests:** 143/143.

**Found besides:** `discoverReference` finds none of these occurrences, with F85 or without it: it does not meet a
rest of points (F28), so it cannot be the oracle for a pattern with one. It should be widened to meet rests, or each
test using it should say that it holds only for patterns without them.

**For the spec:** `Plan.lean` plans "one matcher, keyed and link-directed" (F27). Link-directed should include
upward: a node reached by a link determines its ancestors, so a plan may meet a subtree from any node of it that is
reachable by a bound link.

### F86. Regions joined by the redex's links are local, and a seeded region is met first (changed; performance)

**Came up:** TCTG13 again. Military technology spreads between neighbouring cells in whatever polities they stand,
so its rule has two regions joined by the link: `(~e :: Adj | ?c = Cell[adj = (~e | ?ca) | m1 = 1]) ||
(?d = Cell[adj = (~e | ?da) | m1 = 0])`. Discovery held every rule of more than one region not local (`local`), so it
searched these five rules over the whole world after every firing: 245 ms a step, whatever fired.

**Changed:** (1) `incremental.ts`: a redex whose regions are all joined by its closed edges is local (`regionsLinked`).
Every occurrence is one match connected by its links, so a commit makes or breaks one only by changing a node it
meets, which anchored search finds, as for one region. It is the argument `local` already makes for a negative tied
to the match by a link. (2) `plan.ts`: that alone was slower (600 ms a step), as the plan met regions in index order
even when the anchor stood in the second: the first region's cell was met from all 2,647. A region holding a seeded
node is now met first, and the others are reached from it by their links. Together: 245 ms → 2–12 ms a firing.

**Tests:** the engine tests (143/143), and cycle's TCTG13 probe: the same 3,060 firings over 300 years, step for step,
before and after.

**For the spec:** `discover_local`'s cost law (what is beside the state and not asked about costs nothing) holds for a
multi-region redex exactly where its regions are linked. The spec could state locality as connectivity of the
redex (through places or closed links) rather than as one region.

### F87. A rule that held few occurrences is found again by its anchors, not whole (changed; performance)

**Came up:** TCTG13 (cycle). Discovery searched a local rule over the whole state whenever a commit cost it more than
half its occurrences. A rule holding one occurrence (`vanish`, a polity emptied by conquest) loses all of it whenever
that one fires, so each firing searched all 2,647 polities for it: a cost that grew with how often conquest happened.

**Changed:** a local rule is found again whole only where it lost at least 16 occurrences (`WHOLE_AFTER`) and more
than half. Below that, its anchors (the change and what holds it) find everything anyway, as the rule is local.

### F88. A changed value is a change of what meets only for the rules that read it (changed; performance)

**Came up:** TCTG13. A trait spreading to a cell rewrites one of the cell's values (`m1`), which `spread1`'s literal
reads. Discovery decided value-sensitivity across all rules at once: any rule's literal or guard at a key made a
change at that key a change of what meets for every rule, so the cell was searched again by all 25 rules.

**Changed (`update`, `refind`, `rulesAt`):** a scalar rewritten in place is rated again for every rule, as before,
and searched again (at its holder and what holds it) only for the rules whose literals or guards read that key.

### F89. A literal is rewritten in place, a literal restated is kept, and a variadic port is a multiset (changed; performance)

**Came up:** TCTG13, three ways in one firing of `spread1`:
1. `m1 = 0 ⇒ m1 = 1` removed the matched scalar and made a fresh one. In-place writing (`World.apply`, `inPlace`)
   covered values whose redex held a site at the key, not a literal.
2. `active = true ⇒ active = true` did the same: a restated literal was a new scalar.
3. A reactum writing `adj = (~e | ?ca)` puts its own point first and the rest after, renumbered, so discovery,
   comparing ports as JSON, saw both cells relinked (and every neighbour on their links changed).

Each made a cell's every rule search again.

**Changed:** (1) `World.apply` writes a reactum value at a key of a kept node into the scalar the redex met there by
a literal, as it did where it met a site (`revalued`). (2) `buildRule` keeps a literal the reactum restates
unchanged: the same scalar, in both paths. (3) `update` compares a variadic group's points as a multiset
(D-points-keyed-or-anonymous), a fixed-arity group's in order. With F88: a `spread` firing 5 ms → 0.5 ms.

### F90. A lazy site is lazy beside a closed edge, unless the edge is joined (changed; performance)

**Came up:** TCTG13's `annex` meets two polities by the link between their border cells (a closed edge). The plan
ignored lazy sites wherever a redex had a closed edge, since what sites hold must not touch one. That check reads
site contents only for an edge joined to an inner name: an unjoined closed edge holds exactly the points the redex
binds (`finish` counts them), all on nodes it meets.

**Changed (`plan.ts`):** lazy unless some closed edge is joined. An anchored search at a polity of n cells: quadratic
→ linear (2.2 ms at 25 cells, 10.6 ms at 400).

**And, found with it, a defect in F85:** plans were cached by the first root holding a seed. `Discovery.fresh` seeds
every node, so its plan (no root met upward) was handed to anchored searches seeding one root, which then met the
other root from every node of its type: 4–5 ms where 0.1 ms was due. Plans are now cached by every seeded root.
Firings moving a cell: 6 ms → 1.3–1.5 ms.

### F91. A sum tree of rates (changed; performance)

**Came up:** with updates cheap, a step's choice cost as much: `live()` lists and filters every spot each step, and
a policy then scans them (0.6 ms a step at 20,000 spots).

**Changed (`RateTree` in `incremental.ts`):** discovery keeps its plain spots' rates in a Fenwick tree, updated where
a rate is set: `totalRate(g)` in O(1), `spotAt(g, u)` in O(log n). Rebuilt exactly every 65,536 changes against float
drift. Not for encounter rules held factored (`null`: list them). `test/ratetree.test.ts`.

### F92. Acceptance: a rule's rate as a bound and a probability (changed; semantics, PROVISIONAL)

**Came up:** TCTG13's attack succeeds with a probability read from both polities' trait sums. As a rate, every
change of a polity's sum (a trait drifting, a cell taken) re-rated all its border spots, in 2 annex rules and 18 sea
rules: a fifth of an update. TCTG13 itself attempts at a fixed rate and accepts with that probability.

**Changed:** a rule node may have `accept` beside `rate` (`annex[rate = 0.125 | accept = …]`): an occurrence is chosen
at `rate`, and its reaction made with probability `accept`, worked out then; otherwise only its time passes. This is
thinning (Lewis & Shedler 1979): the process with rate × accept. `accept` never reads a lazy site (`lazySites`), so a
rejection is decided on the occurrence as held, without finding it again. `policy.step` loops over rejected attempts,
summing their times, and draws in the old order where no rule has an acceptance. `test/accept.test.ts`: rate 2 with
accept 0.25 fires as rate 0.5, and an acceptance reading a changing value fires as that rate would.

**For the spec:** G7 (rate as a rule attribute) could carry it: a propensity as a bound and an acceptance is the
standard way to keep a stochastic simulation's cost to what changes when rates read aggregates
(R-aggregates-in-rates-maintained).

### F93. A site put back where it stood is never found nor touched (changed; performance)

**Came up:** TCTG13 with a cell as a polity (cycle C8). A lone cell is matched standing in Earth,
`?w = Earth(?c = Cell[…] | ?rest)`, so `?rest` is all of Earth's other members. It is lazy in discovery (F26, F90),
but a chosen occurrence was found again whole (`fresh`, every member of Earth), and `World.apply` stringified each of
its roots' ports and walked its whole subtree for points on the closed edge. O(world) per reaction.

**Changed (`stillSites` in `rule.ts`):** a rule's still sites are statically known: a node's one anonymous site, the
node kept and placed once as that same node's one anonymous site, in a redex no closed edge of which is joined. What
such a site holds keeps its place, and nothing in it can be on a closed redex edge (F90). `World.apply` leaves them
untouched, and `Discovery.fresh(…, { inPlace: true })` need not find an occurrence whose lazy sites are all still.
The functional `react` still gets them found, as it builds the state anew.

### F94. A subtree is met seed first, then by links, then upward, then nearest the seed (changed; performance)

**Came up:** TCTG13 again. F85 met a later *root* upward from a linked member. A realm beside a lone cell is not a
root (both stand in Earth), so `Earth(?c | ?q = Realm(?d | …) | ?rest)` met ?q from every member of Earth: 716 ms to
find nothing. And anchored at a new realm (seeded with Earth), the plan met ?c, in written order, from every member
of Earth before ?q's cell, from which ?c is one link away: 240 ms a reaction.

**Changed (`planFor`):** within a subtree, of the nodes whose parent is met, the plan takes a seeded one first; then
one a bound link reaches; then one holding a node a bound link reaches (met upward, F85, now for any node and not only
roots); else the one whose parent is deepest, nearest the seed, whose candidates are the fewest. Plans are cached by
the exact set of seeded nodes. A realm's creation: 240 → 25 ms.

### F95. What cannot absorb a change, indexed apart (changed; performance)

**Came up:** after F94, a realm's creation still cost 25 ms, nearly none of it searching. Earth is affected by any
change to a lone cell, and the drop loop walked every occurrence meeting Earth (~20,000: every lone shape and drift),
recomputing the changed children for each, to keep almost all of them (their lazy site absorbs the change).

**Changed:** discovery keeps, beside `byNode`, the occurrences that cannot absorb a change below a node they meet
(`byNodeStrict`: a rule not lazy, or met there by a node holding no lazy site), and walks only those where the change
below is absorbable (the node not changed, no changed attribute among its children). A node's changed children are
worked out once. 25 → 4.5 ms. And F88's `refind` visits only nodes an occurrence of the rule could meet (a type one
of its redex nodes admits): a realm's size changing re-finds `collapse` at the realm, never walking Earth.

### F96. Port groups by key, and the plan cache first (changed; performance)

`groupOf` built every group's key string for every lookup (a tenth of a search, with a cell's ten port groups);
groups are now mapped once per node object (a node changed in place is a new object). `planFor` built its prelude
(children, subtrees, seeded roots) before looking in its cache; it looks first.

**Engine tests:** 147/147 throughout. cycle's `run/tctg13-same.ts`: incremental and fresh discovery agree at 81
checks over 2,000 reactions (183 dissolutions, collapses, every shape of conquest).
