/**
 * MAPK signalling: the Python prototype's seven rules (`kaleidoscope/systems/mapk/rules.py`), in the carrier.
 *
 * What changed in the move:
 * - compartment kinds are types, within `Compartment` by `≤`, not a `kind` child tag;
 * - a free port is a port on a closed edge of its own (`!`), not an absent key;
 * - a bond is broken by meeting it closed (`~b :: Link`), so the edge goes with it;
 * - an ERK's identity is an attribute, `name`, carried across a phosphorylation by an attribute site.
 * ERK and pERK are distinct types, so phosphorylation replaces one node with another.
 */

import { type Rule, Signature, readRule, readState } from '../engine';

export const sig = Signature.of({
  Cell: {},
  Compartment: {},
  Cytoplasm: { supers: ['Compartment'] },
  Nucleus: { supers: ['Compartment'] },
  ERLumen: { supers: ['Compartment'] },
  MEK: { ports: { e: 'Link' } },
  ERK: { ports: { s: 'Link' }, attrs: { name: 'Text' } },
  pERK: { ports: { s: 'Link' }, attrs: { name: 'Text' } },
});

export const initial = readState(
  `Cell(Cytoplasm(
     MEK
     pERK[name = "erk0"]
     ERK[name = "erk1"]
     ERK[name = "erk2"]
     Nucleus()
     ERLumen(ERK[name = "erk3"])))`,
  sig,
);

const r = (name: string, src: string, rate: number) => readRule(name, src, sig, { rate });

export const rules: Rule[] = [
  // free MEK and free ERK in one place form the complex; ERK becomes pERK
  r('phosphorylate', `?m = MEK[e = !] | ERK[s = ! | name = ?n] => ?m = MEK[e = ~b] | pERK[s = ~b | name = ?n]`, 2.0),
  // the complex comes apart where it is
  r('dissociate', `~b :: Link | ?m = MEK[e = ~b] | ?p = pERK[s = ~b] => ?m = MEK[e = !] | ?p = pERK[s = !]`, 0.5),
  // a nuclear phosphatase resets free pERK to ERK
  r('dephosphorylate', `?k = Nucleus(pERK[s = ! | name = ?n] | ?r) => ?k = Nucleus(ERK[name = ?n] | ?r)`, 0.4),
  // ERK diffuses between the cytoplasm and any compartment within it
  r('translocate_erk_in', `?c = Cytoplasm(?e = ERK | ?k = Compartment(?i) | ?o) => ?c = Cytoplasm(?k = Compartment(?e = ERK | ?i) | ?o)`, 1.0),
  r('translocate_erk_out', `?c = Cytoplasm(?k = Compartment(?e = ERK | ?i) | ?o) => ?c = Cytoplasm(?e = ERK | ?k = Compartment(?i) | ?o)`, 1.0),
  // free pERK is imported to the nucleus fast, and leaks back slowly
  r('translocate_perk_in', `?c = Cytoplasm(?e = pERK[s = !] | ?k = Nucleus(?i) | ?o) => ?c = Cytoplasm(?k = Nucleus(?e = pERK | ?i) | ?o)`, 2.0),
  r('translocate_perk_out', `?c = Cytoplasm(?k = Nucleus(?e = pERK[s = !] | ?i) | ?o) => ?c = Cytoplasm(?e = pERK | ?k = Nucleus(?i) | ?o)`, 0.1),
];
