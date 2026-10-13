import { checkRule, parseRule, parseState, readRule, ruleText, stateText, type Term } from '../src/engine';
import * as ops from '../src/edit/ops';
import { sig } from '../src/systems/mapk';

const terms = (regions: ReturnType<typeof parseState>) => [...ops.walk(regions)].map((w) => w.item);
const term = (regions: ReturnType<typeof parseState>, head: string) =>
  terms(regions).find((i) => i.value.k === 'term' && i.value.head === head)!;

describe('edits to the tree', () => {
  it('adds, nests and moves', () => {
    const s = parseState('Cell(Cytoplasm(Nucleus() | MEK))');
    ops.add({ term: term(s, 'Nucleus').value as Term }, ops.newTerm(sig, 'ERK', 'state'));
    expect(stateText(s)).toBe('Cell(Cytoplasm(Nucleus(ERK[name = ""]) | MEK))');
    ops.move(s, term(s, 'MEK'), { term: term(s, 'Nucleus').value as Term });
    expect(stateText(s)).toBe('Cell(Cytoplasm(Nucleus(ERK[name = ""] | MEK)))');
    // never into itself
    expect(ops.move(s, term(s, 'Cytoplasm'), { term: term(s, 'Nucleus').value as Term })).toBe(false);
  });

  it('keeps a redex node in the reactum, once', () => {
    const r = parseRule('MEK | ERK => ()');
    const target = { region: r.rhs[0] };
    ops.keep(r, term(r.lhs, 'MEK'), target);
    ops.keep(r, term(r.lhs, 'MEK'), target);
    expect(ruleText(r)).toBe('?k1 = MEK | ERK\n  => ?k1 = MEK');
  });

  it('links ports, merging links, a redex bond closed', () => {
    const r = parseRule('MEK | ERK => ()');
    ops.link(r, 'redex', { t: term(r.lhs, 'MEK').value as Term, port: 'e', contract: 'Link' }, { t: term(r.lhs, 'ERK').value as Term, port: 's' });
    expect(ruleText(r)).toBe('~b1 :: Link | MEK[e = ~b1] | ERK[s = ~b1]\n  => ()');
    const s = parseState('MEK[e = ~a] | ERK[s = ~a] | MEK[e = ~c] | pERK[s = ~c]');
    const meks = terms(s).filter((i) => i.value.k === 'term' && i.value.head === 'MEK');
    ops.link(s, 'state', { t: meks[0].value as Term, port: 'e', contract: 'Link' }, { t: meks[1].value as Term, port: 'e' });
    expect(stateText(s)).toBe('MEK[e = ~a]\nERK[s = ~a]\nMEK[e = ~a]\npERK[s = ~a]');
  });

  it('takes a redex node out with its kept counterpart and its sites', () => {
    const r = parseRule('?m = MEK | Nucleus(?x) => ?m = MEK | Nucleus(?x)');
    ops.dropFromRedex(r, term(r.lhs, 'MEK'));
    ops.dropFromRedex(r, term(r.lhs, 'Nucleus'));
    expect(ruleText(r)).toBe('()\n  => MEK | Nucleus()');
  });

  it('builds phosphorylation, edit by edit, into a rule that checks', () => {
    const r = parseRule('() => ()');
    ops.add({ region: r.lhs[0] }, ops.newTerm(sig, 'MEK', 'redex'));
    ops.add({ region: r.lhs[0] }, ops.newTerm(sig, 'ERK', 'redex'));
    ops.keep(r, term(r.lhs, 'MEK'), { region: r.rhs[0] });
    ops.add({ region: r.rhs[0] }, ops.newTerm(sig, 'pERK', 'reactum'));
    ops.link(r, 'reactum', { t: term(r.rhs, 'MEK').value as Term, port: 'e', contract: 'Link' }, { t: term(r.rhs, 'pERK').value as Term, port: 's' });
    ops.unlink(term(r.lhs, 'MEK').value as Term, 'e', 'redex');
    ops.unlink(term(r.lhs, 'ERK').value as Term, 's', 'redex');
    ops.setAttr(term(r.lhs, 'ERK').value as Term, 'name', { k: 'site', name: 'n' });
    ops.setAttr(term(r.rhs, 'pERK').value as Term, 'name', { k: 'site', name: 'n' });
    const rule = readRule('phos', ruleText(r), sig);
    expect(checkRule(rule)).toEqual([]);
    expect(ruleText(r)).toBe('?k1 = MEK[e = !] | ERK[s = ! | name = ?n]\n  => ?k1 = MEK[e = ~b1] | pERK[s = ~b1 | name = ?n]');
  });
});
