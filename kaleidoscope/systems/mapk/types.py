"""MAPK bigraph signature: sorts and schema-type registration."""


# Bigraph signature for the MAPK model. Each name is a sort that
# tags a place-graph node via ``_type`` — sharing one namespace
# with the typesystem's schema registry, so these labels can later
# carry typed methods (serialization, value-update behaviour, etc.)
# without changing the matcher.
MAPK_SORTS = (
    'Cell', 'Compartment', 'NPC', 'MEK', 'ERK', 'pERK',
    'Cytoplasm', 'Nucleus', 'ERLumen')

# Minimal schema entries — each sort inherits the base ``node`` type,
# which is a permissive tree-shaped schema with no value semantics.
# Future work can replace these with richer schemas that attach typed
# methods (e.g. a ``MEK`` schema with a catalytic-rate update_method)
# without changing rule application — the matcher only reads the
# label, not the schema body.
MAPK_TYPE_SCHEMAS = {sort: {'_inherit': 'node'} for sort in MAPK_SORTS}


def register_mapk_types(core):
    """Register the MAPK bigraph signature as schema types on ``core``.

    The matcher works on string equality alone and does not require
    these registrations, but registering them makes the signature a
    first-class citizen of the typesystem: future ``update_method``,
    serialization, and validation hooks can be attached to e.g. the
    ``MEK`` type and will compose with the BRS rules without further
    plumbing.
    """
    core.register_types(MAPK_TYPE_SCHEMAS)
    return core
