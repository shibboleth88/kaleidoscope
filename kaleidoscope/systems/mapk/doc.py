"""Process-bigraph document builder for the MAPK BRS example."""

from kaleidoscope.systems.mapk.rules import mapk_rules
from kaleidoscope.systems.mapk.state import initial_mapk_state
from kaleidoscope.systems.mapk.types import register_mapk_types


def get_brs_mapk_doc(core=None, config=None):
    """Build a process-bigraph document for the MAPK BRS example.

    The document wires a single ``BigraphicalReactiveSystem``
    Process against a typed ``cell`` store. Each tick advances
    simulation time by ``interval`` and fires zero or more rule
    matches (under Gillespie SSA). An explicit emitter is included
    so the standard composite plumbing knows what to record.

    If ``core`` is provided, the MAPK bigraph signature is also
    registered onto it as schema types — making the controls
    first-class typesystem citizens that can later carry methods.
    """
    from process_bigraph.emitter import emitter_from_wires
    config = config or {}
    if core is not None:
        register_mapk_types(core)
    return {
        'schema': {'cell': 'tree[node]'},
        'state': {
            'cell': initial_mapk_state(),
            'brs': {
                '_type': 'process',
                'address': (
                    'local:!process_bigraph.processes'
                    '.bigraphical_reactive_system'
                    '.BigraphicalReactiveSystem'),
                'config': {
                    'rules': mapk_rules(),
                    'mode': config.get('mode', 'gillespie'),
                    'seed': config.get('seed', 42),
                    'max_per_tick': config.get('max_per_tick', 10**6),
                },
                'inputs': {'state': ['cell']},
                'outputs': {'state': ['cell']},
                'interval': config.get('interval', 1.0),
            },
            'emitter': emitter_from_wires(
                {'global_time': ['global_time'], 'cell': ['cell']}),
        }}
