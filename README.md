# kaleidoscope

Cellular interactions as Bigraphical Reactive Systems (BRS).

The long-term aim is to characterise everything that happens
inside a cell as a bigraphical rewrite system — populated
through systematic literature search and automated extraction
of molecular interactions into bigraph rules. Each biological
subsystem lives under `kaleidoscope.systems` as its own
self-contained module: rule set, signature, initial state,
analysis, plots.

The first prototype is MAPK signalling
(`kaleidoscope.systems.mapk`), a worked example that re-casts
the textbook MEK / ERK phosphorylation cycle as a
structural-rewriting bigraph under Gillespie SSA. It defines
the shape every other system will follow.

The BRS engine itself — `BigraphicalReactiveSystem`, a
`process-bigraph` Process that fires Milner-style reaction
rules on each tick — lives upstream in
`process_bigraph.processes.bigraphical_reactive_system` and is
re-exported from `kaleidoscope` for convenience.

## Layout

```
kaleidoscope/
└── systems/
    └── mapk/                   # the first system; template for others
        ├── types.py            # bigraph signature (Cell, Compartment, MEK, ERK, pERK, …)
        ├── rules.py            # 7 reaction rules (phosphorylate, dissociate, translocate, …)
        ├── state.py            # initial nested-compartment cell state
        ├── analysis.py         # substrate counting + firing inference for plots
        ├── doc.py              # get_brs_mapk_doc(): wire BRS into a process-bigraph document
        ├── plot.py             # plot_brs_mapk(): timeseries + snapshots + trace + animation
        ├── cli.py              # `python -m kaleidoscope.systems.mapk` / `kaleidoscope` entry
        └── references.md       # bibliography (formalism + biology)
```

## Run

```sh
pip install -e .

# Once installed, either form works:
kaleidoscope --time 80 --out out/
python -m kaleidoscope.systems.mapk --time 80 --out out/
```

Flags: `--time` (ticks, default 80), `--out` (dir, default `out/`),
`--seed` (default 42), `--interval` (emit interval, default 1.0),
`--mode` (`gillespie` | `stochastic` | `deterministic`),
`--name` (filename prefix, default `brs_mapk`).

Outputs (in `out/`):

- `report.html` — **single-page report bundling everything below**
- `brs_mapk_viz.png` — initial bigraph place graph
- `brs_mapk_timeseries.png` — substrate populations per compartment
- `brs_mapk_snapshots.png` — structural snapshots at 6 timepoints
- `brs_mapk_trace.png` — one example firing per rule, redex/reactum next to before/after
- `brs_mapk_animation.gif` — smooth cubic ease-in-out animation
- `brs_mapk_overview.md` — biology + bigraph encoding + rule semantics
- `_rule_<label>_{redex,reactum}.png` — per-rule pattern PNGs (inlined into the report)

## The MAPK biology, in one paragraph

MEK1 (cytoplasmic Ser/Thr kinase, PDB `3EQH`) dual-phosphorylates
ERK2 (PDB `1ERK` / `2ERK`) on its Thr-X-Tyr activation motif.
Phospho-ERK translocates through nuclear pore complexes into the
nucleus, where it phosphorylates downstream transcription factors.
Nuclear DUSP/MKP phosphatases reset ERK; the cycle continues. MEK
is active-site limited — at most one ERK per cleft.

See `kaleidoscope/systems/mapk/references.md` for the formalism
and biology citations.

## Why bigraphs?

Compartment-only models say *where* a molecule is but not *what
it's bound to*. Reaction-network models capture binding but lose
the spatial dimension. Bigraphs unify both — one redex
constrains place *and* link in the same step. The same machinery
should scale from MAPK to any catalogue of cellular interactions
literature gives us.

## Adding a new system

A new system is a sibling directory under `kaleidoscope/systems/`.
At minimum it should provide:

- a signature (controls / `_type`s the rules will pattern over)
- a list of `ReactionRule`s with Gillespie rates
- an initial state function
- a `get_*_doc(core, config)` that returns a process-bigraph
  document wiring `BigraphicalReactiveSystem` against that state

Mirror the layout in `kaleidoscope/systems/mapk/` for the visual
analysis pipeline (`analysis.py`, `plot.py`, `report.py`,
`cli.py`).
