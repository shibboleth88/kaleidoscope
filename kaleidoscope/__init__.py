"""kaleidoscope: cellular interactions as Bigraphical Reactive Systems.

The long-term aim is to characterise everything that happens
inside a cell as a bigraphical rewrite system — populated
through systematic literature search and automated extraction
of molecular interactions into bigraph rules.

Each biological subsystem lives under ``kaleidoscope.systems``.
The first prototype is MAPK signalling
(``kaleidoscope.systems.mapk``); more will follow.

The engine that fires reaction rules —
``BigraphicalReactiveSystem`` — lives upstream in
``process_bigraph.processes.bigraphical_reactive_system``.
It's re-exported here for convenience."""

from process_bigraph.processes.bigraphical_reactive_system import (
    BigraphicalReactiveSystem)

__all__ = ['BigraphicalReactiveSystem']
