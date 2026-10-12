"""Initial MAPK cell state."""


def _erk(name):
    """Free ERK substrate: an ``ERK``-control node carrying its
    individual identity in the ``name`` field. No ``outputs``
    means no docking bond — i.e. unbound."""
    return {'_type': 'ERK', 'name': name}


def initial_mapk_state(seed=0):
    """Nested-compartment cell with MEK in the cytoplasm and an
    assortment of ERK / pERK copies seeded to drive the cycle.

    Place graph (nested — nucleus and ER lumen are spatially
    contained inside cytoplasm, matching cell biology)::

        Cell
        └── cytoplasm    (MEK, erk1, erk2, erk0)
            ├── nucleus  (empty initially; pERK accumulates here)
            └── er_lumen (erk3)

    A pre-existing free ``pERK`` (``erk0``) is included in the
    cytoplasm so that the initial bigraph diagram shows at least
    one node of every sort — including phospho-substrate. It will
    translocate into the nucleus on the first import event.

    NPCs are not separate entities — they live in the nuclear
    envelope and are rendered as part of the nucleus visualization.

    Link graph: empty initially. Bonds are minted by
    ``phosphorylate`` and destroyed by ``dissociate``.
    """
    return {
        '_type': 'Cell',
        'cytoplasm': {
            '_type': 'Compartment',
            'kind': {'_type': 'Cytoplasm'},
            'mek':  {'_type': 'MEK'},
            'erk0': {'_type': 'pERK', 'name': 'erk0'},
            'erk1': _erk('erk1'),
            'erk2': _erk('erk2'),
            'nucleus': {
                '_type': 'Compartment',
                'kind': {'_type': 'Nucleus'},
            },
            'er_lumen': {
                '_type': 'Compartment',
                'kind': {'_type': 'ERLumen'},
                'erk3': _erk('erk3'),
            },
        },
    }
