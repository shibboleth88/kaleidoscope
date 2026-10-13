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
