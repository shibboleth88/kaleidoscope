"""Analysis helpers for MAPK BRS traces: substrate enumeration,
compartment counting, and rule-firing inference from emitted
state snapshots."""


def list_substrates(state):
    """Return ``[(name, compartment, control, bound)]`` for every
    ERK / pERK node in the cell. ``bound`` is True iff the node
    has any ``outputs`` wire."""
    out = []

    def walk(node, comp_name=None):
        if not isinstance(node, dict):
            return
        ctrl = node.get('_type', '')
        if ctrl in ('ERK', 'pERK'):
            name = node.get('name', '?')
            outs = node.get('outputs')
            bound = isinstance(outs, dict) and bool(outs)
            out.append((name, comp_name, ctrl, bound))
            return
        for k, v in node.items():
            if isinstance(v, dict):
                next_comp = (
                    k if v.get('_type') == 'Compartment' else comp_name)
                walk(v, comp_name=next_comp)

    walk(state)
    return out


def count_substrates_per_compartment(state):
    """Return ``{compartment_name: (free_count, bound_count, perk_count)}``
    summary for the state — convenient for plotting trajectories."""
    counts = {}
    for name, comp, ctrl, bound in list_substrates(state):
        if comp is None:
            continue
        free, perk_free, bound_count = counts.get(comp, (0, 0, 0))
        if ctrl == 'ERK':
            free += 1
        elif ctrl == 'pERK' and bound:
            bound_count += 1
        elif ctrl == 'pERK':
            perk_free += 1
        counts[comp] = (free, perk_free, bound_count)
    return counts


def infer_firing(before, after):
    """Compare two consecutive emitted states and infer which rule
    fired between them.

    For our seven-rule nested MAPK system:

    - ``phosphorylate``        : ``ERK → pERK`` AND becomes bound.
    - ``dissociate``           : stays ``pERK``, same compartment,
                                  but ``outputs`` disappears.
    - ``dephosphorylate``      : ``pERK → ERK`` while still in
                                  the nucleus.
    - ``translocate_erk_in``   : ``ERK`` moves cytoplasm → child
                                  compartment (nucleus / ER lumen).
    - ``translocate_erk_out``  : ``ERK`` moves child → cytoplasm.
    - ``translocate_perk_in``  : free ``pERK`` moves
                                  cytoplasm → nucleus.
    - ``translocate_perk_out`` : free ``pERK`` moves
                                  nucleus → cytoplasm.
    """
    pre = {n: (c, ctrl, b) for n, c, ctrl, b in list_substrates(before)}
    post = {n: (c, ctrl, b) for n, c, ctrl, b in list_substrates(after)}
    for name, (cm_post, ctrl_post, b_post) in post.items():
        if name not in pre:
            continue
        cm_pre, ctrl_pre, b_pre = pre[name]
        if ctrl_pre == 'ERK' and ctrl_post == 'pERK' and b_post and not b_pre:
            return 'phosphorylate'
        if ctrl_pre == 'pERK' and ctrl_post == 'pERK' \
                and cm_pre == cm_post and b_pre and not b_post:
            return 'dissociate'
        if ctrl_pre == 'pERK' and ctrl_post == 'ERK' \
                and cm_pre == cm_post and cm_post == 'nucleus':
            return 'dephosphorylate'
        if ctrl_pre == 'ERK' and ctrl_post == 'ERK' and cm_pre != cm_post:
            if cm_pre == 'cytoplasm':
                return 'translocate_erk_in'
            if cm_post == 'cytoplasm':
                return 'translocate_erk_out'
            return 'translocate_erk_in'
        if ctrl_pre == 'pERK' and ctrl_post == 'pERK' \
                and cm_pre != cm_post and not b_pre and not b_post:
            if cm_pre == 'cytoplasm' and cm_post == 'nucleus':
                return 'translocate_perk_in'
            if cm_pre == 'nucleus' and cm_post == 'cytoplasm':
                return 'translocate_perk_out'
            return 'translocate_perk_in'
    return None
