"""
MAPK signalling cycle as a Bigraphical Reactive System
======================================================

This module re-casts a textbook compartmentalised
phosphorylation cycle as a structural-rewriting bigraph.
References for both the formalism and the biology are collected
in ``references.md``.

The biology
-----------
The MAP-kinase cascade is the canonical signal-transduction relay
in mammalian cells. We model just its last catalytic step:

    free MEK + free ERK   →   MEK·pERK   →   free MEK + free pERK

* **MEK1** (MAP2K1) is a 43 kDa serine/threonine kinase that sits
  in the cytoplasm and dual-phosphorylates ERK on its activation
  loop (Thr-Glu-Tyr motif).  PDB **3EQH** (Ohren et al. 2004).
* **ERK2** (MAPK1) has the classic bilobal kinase fold.  PDB
  **1ERK** (Zhang et al. 1994, inactive form).  After dual
  phosphorylation it adopts the active conformation **2ERK**
  (Canagarajah et al. 1997).  In our cycle ERK is treated strictly
  as MEK's substrate — its own kinase activity is downstream.
* **NPC** (nuclear pore complex) is the gateway to the nucleus
  for phospho-ERK; we draw it with the canonical eight-fold
  symmetry (Lin & Hoelz 2019).
* Crucially MEK is *active-site limited*: it has one catalytic
  cleft, so it can be in complex with at most one ERK at a time.

Mapping the biology onto a bigraph (Milner 2009)
------------------------------------------------
A bigraph has two graphs sharing a common node set: a **place
graph** for spatial nesting, and a **link graph** for
connectivity.  We use one node per molecule / compartment, with a
``_type`` label (Milner's *control* in the bigraph signature, but
written here in the same field the typesystem uses so signature
labels and schema types share one namespace):

================  =================================================
Sort (``_type``)  Biology
================  =================================================
``Cell``          The whole cell — outer container.
``Compartment``   Subcellular volume — cytoplasm, nucleus, ER lumen.
``Cytoplasm``     Compartment-kind tag, child of cytoplasm.
``Nucleus``       Compartment-kind tag, child of nucleus.
``ERLumen``       Compartment-kind tag, child of er_lumen.
``NPC``           Nuclear-pore-complex-like channel at every
                  compartment boundary.
``MEK``           The kinase; lives in the cytoplasm.
``ERK``           Free substrate (unphosphorylated).
``pERK``          Phospho-substrate (carries the Thr183/Tyr185
                  phosphates).
================  =================================================

Place graph: ``Cell ⊃ Compartments ⊃ {NPC, MEK, ERK, pERK}``.
Link graph: a single shared edge between MEK's catalytic port and
the substrate's docking port whenever they're in complex.

Why bigraphs?
-------------
Compartment-only models capture *where* a molecule is, but not
*what it is bound to*: they cannot say which copy of MEK is
currently in complex with which copy of ERK. Reaction-network
models capture binding (S + E ⇌ SE) but collapse the spatial
dimension — "MEK in cytoplasm vs. nucleus" is invisible.

Bigraphs are the structure that has *both*. A single redex can
constrain place *and* link in the same step.
"""

from kaleidoscope.systems.mapk.types import (
    MAPK_SORTS, MAPK_TYPE_SCHEMAS, register_mapk_types)
from kaleidoscope.systems.mapk.rules import mapk_rules
from kaleidoscope.systems.mapk.state import initial_mapk_state
from kaleidoscope.systems.mapk.doc import get_brs_mapk_doc
from kaleidoscope.systems.mapk.plot import plot_brs_mapk

__all__ = [
    'MAPK_SORTS',
    'MAPK_TYPE_SCHEMAS',
    'register_mapk_types',
    'mapk_rules',
    'initial_mapk_state',
    'get_brs_mapk_doc',
    'plot_brs_mapk',
]
