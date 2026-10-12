"""Reaction rules for the MAPK BRS.

Each rule is a parametric bigraph rewrite (Milner-style):
the redex describes both the place-graph nesting and the
link-graph wiring that must be matched; the reactum rewrites
those — flipping controls, minting or destroying edges, moving
nodes between compartments. Rates are propensity coefficients
under Gillespie SSA:

    propensity(R) = R.rate * |matches(R)|
"""
from bigraph_schema.schema import Site
from bigraph_schema.assembly import ReactionRule, LinkVar, Absent


def rule_phosphorylate():
    """Free MEK + free ERK in the same compartment form the
    Michaelis complex.

    Biology:
        Pre:   MEK (free, no substrate in active site)
             + ERK (free, unphosphorylated)
        Post:  MEK·pERK   (covalently transferred phosphate, drawn
                          here as a shared link-graph edge)

    Bigraph encoding:
        - The redex restricts both ports with ``Absent()`` — so
          the rule cannot fire on a MEK that's already in complex
          (active-site stoichiometry).
        - The reactum re-introduces both ports wired to a single
          ``LinkVar('bond')``.  ``e`` is unbound on the redex side,
          so ``instantiate`` mints a *fresh* anchor path under
          ``_edges`` and links both ports to it.
        - The substrate's control flips ``ERK → pERK``.
    """
    return ReactionRule(
        redex={
            'compartment': {
                '_type': 'Compartment',
                'enzyme': {
                    '_type': 'MEK',
                    'outputs': Absent()},
                'substrate': {
                    '_type': 'ERK',
                    'name': Site(),
                    'outputs': Absent()},
                'bystanders': Site()}},
        reactum={
            'compartment': {
                '_type': 'Compartment',
                'enzyme': {
                    '_type': 'MEK',
                    'outputs': {'enzyme_port': LinkVar('bond')}},
                'substrate': {
                    '_type': 'pERK',
                    'name': Site(),
                    'outputs': {'substrate_port': LinkVar('bond')}},
                'bystanders': Site()}},
        instantiation={'bystanders': 'bystanders', 'name': 'name'},
        rate=2.0,
        label='phosphorylate')


def rule_dissociate():
    """The MEK·pERK complex dissociates inside its compartment.

    Biology:
        Pre:   MEK·pERK
        Post:  free MEK   +   free pERK
                              (both stay in this compartment;
                               pERK can subsequently translocate)

    Bigraph encoding:
        - The redex requires both ports wired to the same edge
          (``LinkVar('bond')``) — so the rule fires exactly when MEK
          and a pERK are in complex.
        - The reactum drops the ``outputs`` keys on both nodes,
          so the bond's two endpoints are gone — the edge is
          effectively destroyed.
    """
    return ReactionRule(
        redex={
            'compartment': {
                '_type': 'Compartment',
                'enzyme': {
                    '_type': 'MEK',
                    'outputs': {'enzyme_port': LinkVar('bond')}},
                'substrate': {
                    '_type': 'pERK',
                    'name': Site(),
                    'outputs': {'substrate_port': LinkVar('bond')}},
                'bystanders': Site()}},
        reactum={
            'compartment': {
                '_type': 'Compartment',
                'enzyme': {'_type': 'MEK'},
                'substrate': {'_type': 'pERK', 'name': Site()},
                'bystanders': Site()}},
        instantiation={'bystanders': 'bystanders', 'name': 'name'},
        rate=0.5,
        label='dissociate')


def rule_dephosphorylate():
    """A nuclear MAP-kinase phosphatase removes the phosphate from
    a free pERK in the nucleus, returning it to ERK.

    Biology:
        Pre:   pERK (free, NOT in MEK complex) inside the nucleus
        Post:  ERK in the same nucleus

    Real biology: nuclear DUSP/MKP phosphatases (DUSP1, DUSP5, …)
    dephosphorylate the Thr-X-Tyr motif and reset the kinase to its
    inactive form. We collapse the phosphatase machinery into a
    single first-order rate. Only nuclear pERK is dephosphorylated;
    cytoplasmic pERK is shielded by ongoing MEK activity.

    The dephosphorylated ERK can then leave via
    ``translocate_erk_out``, get re-phosphorylated by MEK in the
    cytoplasm, and re-import — closing the signalling cycle. This
    is the rule that keeps events firing past steady state."""
    return ReactionRule(
        redex={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'kind': {'_type': 'Nucleus'},
                    'substrate': {
                        '_type': 'pERK',
                        'name': Site(),
                        'outputs': Absent()},
                    'inner_rest': Site()},
                'outer_rest': Site()},
        },
        reactum={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'kind': {'_type': 'Nucleus'},
                    'substrate': {'_type': 'ERK', 'name': Site()},
                    'inner_rest': Site()},
                'outer_rest': Site()},
        },
        instantiation={
            'outer_rest': 'outer_rest',
            'inner_rest': 'inner_rest',
            'name': 'name'},
        rate=0.4,
        label='dephosphorylate')


def rule_translocate_erk_in():
    """A free unphosphorylated ERK descends from cytoplasm into a
    child compartment (nucleus or ER lumen).

    Biology:
        Pre:   ERK in cytoplasm body, child compartment present
        Post:  ERK inside that child compartment

    A coarse-grained model of facilitated diffusion across the
    nuclear envelope or ER membrane. The redex doesn't restrict
    the child's kind — it fires for any nested Compartment, and
    the matcher will independently find each child.
    """
    return ReactionRule(
        redex={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'substrate': {
                    '_type': 'ERK',
                    'name': Site()},
                'inner': {
                    '_type': 'Compartment',
                    'inner_rest': Site()},
                'outer_rest': Site()},
        },
        reactum={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'inner_rest': Site(),
                    'substrate': {'_type': 'ERK', 'name': Site()}},
                'outer_rest': Site()},
        },
        instantiation={
            'outer_rest': 'outer_rest',
            'inner_rest': 'inner_rest',
            'name': 'name'},
        rate=1.0,
        label='translocate_erk_in')


def rule_translocate_erk_out():
    """A free unphosphorylated ERK ascends from a child compartment
    back into cytoplasm.

    Biology:
        Pre:   ERK inside a child compartment (nucleus / ER lumen)
        Post:  ERK in cytoplasm body

    Symmetric counterpart of ``translocate_erk_in``; the same rate
    in both directions makes raw ERK distribution diffusive.
    """
    return ReactionRule(
        redex={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'substrate': {
                        '_type': 'ERK',
                        'name': Site()},
                    'inner_rest': Site()},
                'outer_rest': Site()},
        },
        reactum={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'inner_rest': Site()},
                'substrate': {'_type': 'ERK', 'name': Site()},
                'outer_rest': Site()},
        },
        instantiation={
            'outer_rest': 'outer_rest',
            'inner_rest': 'inner_rest',
            'name': 'name'},
        rate=1.0,
        label='translocate_erk_out')


def rule_translocate_perk_in():
    """Active nuclear import of free phospho-ERK.

    Biology:
        Pre:   pERK in cytoplasm body (NOT in complex), nucleus
               present as a child compartment of cytoplasm
        Post:  pERK inside the nucleus

    Phospho-ERK accumulates in the nucleus where it
    phosphorylates downstream transcription factors. Import is
    importin-mediated and biased: the steady state has most pERK
    inside the nucleus (Plotnikov et al. 2011).  We encode this
    as a single fast forward rule, with a slow leak rule
    (``translocate_perk_out``) for the reverse direction.

    Bigraph encoding:
        - The nesting (Cytoplasm ⊃ Nucleus) is matched structurally
          via the place-graph parent/child relation, not a string
          property.
        - ``outputs: Absent()`` keeps bound complexes pinned in the
          cytoplasm (MEK is not nuclear).
    """
    return ReactionRule(
        redex={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'substrate': {
                    '_type': 'pERK',
                    'name': Site(),
                    'outputs': Absent()},
                'inner': {
                    '_type': 'Compartment',
                    'kind': {'_type': 'Nucleus'},
                    'inner_rest': Site()},
                'outer_rest': Site()},
        },
        reactum={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'kind': {'_type': 'Nucleus'},
                    'inner_rest': Site(),
                    'substrate': {'_type': 'pERK', 'name': Site()}},
                'outer_rest': Site()},
        },
        instantiation={
            'outer_rest': 'outer_rest',
            'inner_rest': 'inner_rest',
            'name': 'name'},
        rate=2.0,
        label='translocate_perk_in')


def rule_translocate_perk_out():
    """Slow nuclear export / leak of free phospho-ERK.

    Biology:
        Pre:   pERK in nucleus (NOT in complex), nucleus is a
               child of cytoplasm
        Post:  pERK back in cytoplasm body

    Real export typically requires MAPK dephosphorylation in the
    nucleus followed by ERK translation back, but at this
    abstraction level we encode it directly as a slow first-order
    process. The asymmetry between the import (k=2.0) and export
    (k=0.1) rates is what produces the steady-state nuclear
    accumulation that defines the biological signal.
    """
    return ReactionRule(
        redex={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'kind': {'_type': 'Nucleus'},
                    'substrate': {
                        '_type': 'pERK',
                        'name': Site(),
                        'outputs': Absent()},
                    'inner_rest': Site()},
                'outer_rest': Site()},
        },
        reactum={
            'outer': {
                '_type': 'Compartment',
                'kind': {'_type': 'Cytoplasm'},
                'inner': {
                    '_type': 'Compartment',
                    'kind': {'_type': 'Nucleus'},
                    'inner_rest': Site()},
                'substrate': {'_type': 'pERK', 'name': Site()},
                'outer_rest': Site()},
        },
        instantiation={
            'outer_rest': 'outer_rest',
            'inner_rest': 'inner_rest',
            'name': 'name'},
        rate=0.1,
        label='translocate_perk_out')


def mapk_rules():
    """All seven rules together — the MAPK BRS we simulate.

    With nesting (cytoplasm ⊃ {nucleus, ER lumen}), translocation
    is expressed structurally as parent ↔ child compartment moves;
    nucleus ↔ ER lumen direct transit becomes inexpressible.

    The cycle keeps moving because nuclear pERK is dephosphorylated
    back to ERK, exported, and re-phosphorylated by MEK — i.e.,
    a steady stream of events rather than a one-shot transient.
    The asymmetry between ``translocate_perk_in`` (k=2.0) and
    ``translocate_perk_out`` (k=0.1) still produces a nuclear pERK
    accumulation at steady state — the actual biological *point*
    of the signalling cycle."""
    return [
        rule_phosphorylate(),       # MEK + ERK → MEK·pERK
        rule_dissociate(),          # MEK·pERK → free MEK + free pERK
        rule_dephosphorylate(),     # nuclear pERK → nuclear ERK
        rule_translocate_erk_in(),  # cyto → child compartment
        rule_translocate_erk_out(), # child → cyto
        rule_translocate_perk_in(), # cyto → nucleus, fast
        rule_translocate_perk_out(),# nucleus → cyto, slow leak
    ]
