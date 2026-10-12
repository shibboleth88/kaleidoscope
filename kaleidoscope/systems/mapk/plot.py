"""Plotting + animation for the MAPK BRS example.

Five outputs per run, saved under ``<out_dir>/`` with the
configured ``filename`` prefix:

0. ``<filename>_viz.png``       initial bigraph place graph
1. ``<filename>_timeseries.png`` substrate populations per compartment
2. ``<filename>_snapshots.png``  structural snapshots
3. ``<filename>_trace.png``      one example firing per rule
4. ``<filename>_animation.gif``  smooth cubic ease-in-out animation
"""
import math
import os
import json

from bigraph_schema.schema import Site
from bigraph_schema.assembly import LinkVar, Absent

from kaleidoscope.systems.mapk.rules import mapk_rules
from kaleidoscope.systems.mapk.types import register_mapk_types
from kaleidoscope.systems.mapk.analysis import (
    count_substrates_per_compartment, infer_firing)


RULE_COLORS = {
    'phosphorylate':        '#7570b3',
    'dissociate':           '#d95f02',
    'dephosphorylate':      '#a6611a',
    'translocate_erk_in':   '#1b9e77',
    'translocate_erk_out':  '#5fbf94',
    'translocate_perk_in':  '#117a59',
    'translocate_perk_out': '#66c2a5',
}


def plot_brs_mapk(results, state, config=None):
    """Plot a five-view summary of the MAPK BRS trace, all using
    suggestive bilobal-kinase silhouettes for MEK/ERK/pERK and an
    eight-fold symmetric NPC for the pore.
    """
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    config = config or {}
    filename = config.get('filename', 'brs_mapk')
    out_dir = config.get('out_dir', 'out')
    os.makedirs(out_dir, exist_ok=True)

    times = [step['global_time'] for step in results]
    states = [step['cell'] for step in results]

    compartment_names = []
    for s in states:
        for name, _ in _iter_compartments(s):
            if name not in compartment_names:
                compartment_names.append(name)

    # Per-compartment time series, split by control state
    erk_series = {c: [] for c in compartment_names}
    perk_free_series = {c: [] for c in compartment_names}
    perk_bound_series = {c: [] for c in compartment_names}
    for s in states:
        per_comp = count_substrates_per_compartment(s)
        for c in compartment_names:
            free, perk_free, bound = per_comp.get(c, (0, 0, 0))
            erk_series[c].append(free)
            perk_free_series[c].append(perk_free)
            perk_bound_series[c].append(bound)

    firings = []
    for i in range(1, len(states)):
        rule = infer_firing(states[i - 1], states[i])
        if rule is not None:
            firings.append((times[i], rule, states[i - 1], states[i]))

    # 0. Initial bigraph diagram + explainer markdown + state JSON
    _replot_initial_bigraph(filename, out_dir, states[0])
    _save_explainer_markdown(filename, out_dir)
    _save_state_json(filename, out_dir, states[0])

    # 1. Population trajectories
    fig, ax = plt.subplots(figsize=(8, 4))
    palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b']
    for i, c in enumerate(compartment_names):
        col = palette[i % len(palette)]
        total = [
            e + pf + pb
            for e, pf, pb
            in zip(erk_series[c], perk_free_series[c], perk_bound_series[c])]
        ax.plot(times, total, color=col, label=f'{c} (total)', linewidth=2)
        bound_or_perk = [
            pf + pb
            for pf, pb
            in zip(perk_free_series[c], perk_bound_series[c])]
        if any(bound_or_perk):
            ax.plot(times, bound_or_perk, color=col, linestyle=':',
                    label=f'{c} (pERK)', linewidth=1.2)
    if firings:
        ymin, ymax = ax.get_ylim()
        tick_top = ymax + 0.05 * (ymax - ymin) if ymax > ymin else 0.5
        tick_height = 0.06 * (ymax - ymin) if ymax > ymin else 0.1
        for t, rule, _, _ in firings:
            color = RULE_COLORS.get(rule, '#888')
            ax.vlines(t, tick_top, tick_top + tick_height,
                      color=color, linewidth=2.5)
        ax.set_ylim(ymin, tick_top + tick_height + 0.15 * (ymax - ymin))
        rule_handles = [
            mpatches.Patch(color=RULE_COLORS[r], label=r)
            for r in RULE_COLORS]
        ax.legend(
            handles=(
                [plt.Line2D([0], [0], color=palette[i % len(palette)],
                            linewidth=2, label=f'{c} (total)')
                 for i, c in enumerate(compartment_names)]
                + [plt.Line2D([0], [0], color=palette[i % len(palette)],
                              linestyle=':', linewidth=1.2,
                              label=f'{c} (pERK)')
                   for i, c in enumerate(compartment_names)
                   if any(pf + pb for pf, pb in zip(
                       perk_free_series[c], perk_bound_series[c]))]
                + rule_handles),
            fontsize=7, loc='upper right', ncol=3)
    else:
        ax.legend(fontsize=8, loc='upper right', ncol=2)
    ax.set_xlabel('time (ticks)')
    ax.set_ylabel('substrates per compartment')
    ax.set_title('MAPK BRS — substrate populations '
                 '(top: rule firings)')
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, f'{filename}_timeseries.png'),
                dpi=150)
    plt.close(fig)

    # 2. Structural snapshots
    n_snapshots = config.get('n_snapshots', 6)
    if len(states) >= n_snapshots:
        idx = [round(i * (len(states) - 1) / (n_snapshots - 1))
               for i in range(n_snapshots)]
    else:
        idx = list(range(len(states)))
    n_cols = config.get('snapshot_cols', 3)
    n_rows = (len(idx) + n_cols - 1) // n_cols
    fig, axes = plt.subplots(
        n_rows, n_cols, figsize=(4.0 * n_cols, 4.0 * n_rows),
        squeeze=False)
    flat_axes = [a for row in axes for a in row]
    for ax, j in zip(flat_axes, idx):
        _draw_cell_snapshot(
            ax, states[j], compartment_names,
            title=f't={times[j]:.0f}')
    for ax in flat_axes[len(idx):]:
        ax.set_visible(False)
    legend_handles = _legend_handles()
    fig.legend(handles=legend_handles, loc='lower center',
               ncol=len(legend_handles), fontsize=8.5,
               bbox_to_anchor=(0.5, -0.02))
    fig.suptitle(
        'MAPK BRS — kinase, substrate, phospho-substrate across compartments',
        fontsize=11)
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, f'{filename}_snapshots.png'),
                dpi=150, bbox_inches='tight')
    plt.close(fig)

    # 3. Transition trace — one example per rule
    if firings:
        import matplotlib.image as mpimg
        seen = set()
        unique_firings = []
        for entry in firings:
            rule_label = entry[1]
            if rule_label in seen:
                continue
            seen.add(rule_label)
            unique_firings.append(entry)
        rule_order = {r.label: i for i, r in enumerate(mapk_rules())}
        unique_firings.sort(
            key=lambda e: rule_order.get(e[1], len(rule_order)))
        trace_firings = unique_firings
        n_pairs = len(trace_firings)

        rule_pattern_imgs = {}
        rules_by_label = {r.label: r for r in mapk_rules()}
        for _, rule_label, _, _ in trace_firings:
            if rule_label in rule_pattern_imgs:
                continue
            rule = rules_by_label.get(rule_label)
            if rule is None:
                rule_pattern_imgs[rule_label] = (None, None)
                continue
            redex_path = _render_rule_pattern(
                rule_label, rule.redex, out_dir, 'redex')
            reactum_path = _render_rule_pattern(
                rule_label, rule.reactum, out_dir, 'reactum')
            rule_pattern_imgs[rule_label] = (redex_path, reactum_path)

        fig = plt.figure(figsize=(15.0, 3.2 * n_pairs))
        gs = fig.add_gridspec(
            n_pairs, 7,
            width_ratios=[1, 0.28, 1, 0.45, 1, 0.28, 1],
            wspace=0.06, hspace=0.4)
        for i, (t_after, rule, before, after) in enumerate(trace_firings):
            color = RULE_COLORS.get(rule, '#444')

            ax_redex = fig.add_subplot(gs[i, 0])
            ax_arrow_rule = fig.add_subplot(gs[i, 1])
            ax_reactum = fig.add_subplot(gs[i, 2])
            redex_path, reactum_path = rule_pattern_imgs.get(
                rule, (None, None))
            for ax_p, path, kind_label in (
                    (ax_redex, redex_path, 'redex'),
                    (ax_reactum, reactum_path, 'reactum')):
                ax_p.set_xticks([])
                ax_p.set_yticks([])
                for spine in ax_p.spines.values():
                    spine.set_visible(False)
                if path:
                    try:
                        img = mpimg.imread(path)
                        ax_p.imshow(img)
                    except Exception:
                        pass
                ax_p.set_title(
                    kind_label, fontsize=9, color='#444',
                    style='italic')
            _draw_rule_arrow(ax_arrow_rule, color, label=rule)

            ax_b = fig.add_subplot(gs[i, 4])
            ax_arrow_state = fig.add_subplot(gs[i, 5])
            ax_a = fig.add_subplot(gs[i, 6])
            _draw_cell_snapshot(
                ax_b, before, compartment_names,
                title=f't={t_after - 1:.0f} (before)')
            _draw_cell_snapshot(
                ax_a, after, compartment_names,
                title=f't={t_after:.0f} (after)')
            _draw_rule_arrow(ax_arrow_state, color, label=rule)

        fig.suptitle(
            f'MAPK BRS — rule catalog (one example per rule, '
            f'{n_pairs} of {len(rule_order)} rules covered by the '
            f'{len(firings)}-firing run). Left: rule redex → reactum. '
            'Right: state before → after.',
            fontsize=11, y=0.995)
        fig.savefig(os.path.join(out_dir, f'{filename}_trace.png'),
                    dpi=150, bbox_inches='tight')
        plt.close(fig)

    # 4. Smooth animation across rule firings
    if len(states) > 1:
        _make_smooth_animation(
            filename, out_dir, states, times, compartment_names,
            firings)


# ── State traversal helpers ────────────────────────────────────────


def _iter_compartments(state):
    """Yield ``(name, compartment_dict)`` for every Compartment in
    the cell tree, including nested ones (cytoplasm contains
    nucleus and er_lumen as children)."""
    if not isinstance(state, dict):
        return
    for k, v in state.items():
        if isinstance(v, dict):
            if v.get('_type') == 'Compartment':
                yield k, v
            yield from _iter_compartments(v)


def _legend_handles():
    import matplotlib.patches as mpatches
    import matplotlib.lines as mlines
    return [
        mpatches.Patch(color='#9ecae1', label='MEK  (kinase)'),
        mpatches.Patch(color='#7fbf7b', label='ERK  (substrate)'),
        mpatches.Patch(color='#ef8a62', label='pERK  (phospho-substrate)'),
        mpatches.Patch(facecolor='#fff7e6', edgecolor='#7d5b3a',
                       label='nuclear envelope (with NPCs)'),
        mpatches.Patch(facecolor='#fde4cf', edgecolor='#a96a3a',
                       label='ER lumen'),
        mlines.Line2D([0], [0], color='#2ca02c', linewidth=2.4,
                      label='shared edge  (MEK·pERK bond)'),
    ]


# ── Cell-anatomy layout coordinates (figure-coords) ────────────────

CELL_BOUNDS = (0.04, 0.06, 0.96, 0.92)
NUCLEUS_CENTER = (0.30, 0.54)
NUCLEUS_RADIUS = 0.17
ER_CENTER = (0.72, 0.55)
ER_HALF_W = 0.18
ER_HALF_H = 0.22


def _draw_cell(ax):
    import matplotlib.patches as mpatches
    x0, y0, x1, y1 = CELL_BOUNDS
    ax.add_patch(mpatches.FancyBboxPatch(
        (x0, y0), x1 - x0, y1 - y0,
        boxstyle='round,pad=0.018,rounding_size=0.06',
        linewidth=0, facecolor='#f4f7f0', zorder=0))
    ax.add_patch(mpatches.FancyBboxPatch(
        (x0 - 0.004, y0 - 0.004),
        x1 - x0 + 0.008, y1 - y0 + 0.008,
        boxstyle='round,pad=0.018,rounding_size=0.06',
        linewidth=1.4, edgecolor='#3a5b3a', facecolor='none',
        zorder=1))
    ax.add_patch(mpatches.FancyBboxPatch(
        (x0, y0), x1 - x0, y1 - y0,
        boxstyle='round,pad=0.018,rounding_size=0.06',
        linewidth=1.0, edgecolor='#5a7a5a', facecolor='none',
        zorder=1))


def _draw_nucleus(ax, label='nucleus'):
    import matplotlib.patches as mpatches
    cx, cy = NUCLEUS_CENTER
    r = NUCLEUS_RADIUS
    ax.add_patch(mpatches.Circle(
        (cx, cy), r, facecolor='#fff7e6',
        edgecolor='none', zorder=2))
    ax.add_patch(mpatches.Circle(
        (cx, cy), r,
        facecolor='none', edgecolor='#7d5b3a', linewidth=1.5,
        zorder=3))
    ax.add_patch(mpatches.Circle(
        (cx, cy), r - 0.012,
        facecolor='none', edgecolor='#a8835a', linewidth=0.8,
        zorder=3))
    n_pores = 6
    for k in range(n_pores):
        a = 2 * math.pi * k / n_pores + math.pi / 8
        nx = cx + r * math.cos(a)
        ny = cy + r * math.sin(a)
        _draw_npc_glyph(ax, nx, ny, radius=0.022)
    ax.add_patch(mpatches.Circle(
        (cx + 0.025, cy - 0.018), 0.024,
        facecolor='#d4a673', edgecolor='#7d5b3a',
        linewidth=0.6, zorder=3, alpha=0.7))
    ax.text(cx, cy - r - 0.020, label,
            ha='center', va='top', fontsize=6.6, style='italic',
            color='#7d5b3a', zorder=6)


def _draw_er_lumen(ax, label='ER lumen'):
    import matplotlib.patches as mpatches
    cx, cy = ER_CENTER
    for dy, tilt in [(+0.07, 8), (-0.07, -8)]:
        ax.add_patch(mpatches.Ellipse(
            (cx, cy + dy), 2 * ER_HALF_W * 0.95, 0.075,
            angle=tilt, linewidth=1.2,
            edgecolor='#a96a3a', facecolor='#fde4cf', zorder=2))
        ax.add_patch(mpatches.Ellipse(
            (cx, cy + dy), 2 * ER_HALF_W * 0.78, 0.045,
            angle=tilt, linewidth=0.6,
            edgecolor='#c98a5a', facecolor='none', zorder=3))
    ax.add_patch(mpatches.FancyBboxPatch(
        (cx - 0.018, cy - 0.05),
        0.036, 0.10,
        boxstyle='round,pad=0.0,rounding_size=0.018',
        linewidth=1.0, edgecolor='#a96a3a',
        facecolor='#fde4cf', zorder=2))
    for dy, tilt in [(+0.07, 8), (-0.07, -8)]:
        for k in range(4):
            t = -1 + k * 0.66
            rx = cx + (ER_HALF_W * 0.85) * t
            ry = cy + dy + 0.030 * math.cos(t * math.pi)
            ax.add_patch(mpatches.Circle(
                (rx, ry), 0.005,
                facecolor='#5a3a20', edgecolor='none',
                zorder=4))
    ax.text(cx, cy - ER_HALF_H + 0.005, label,
            ha='center', va='top', fontsize=6.6, style='italic',
            color='#a96a3a', zorder=6)


def _draw_npc_glyph(ax, cx, cy, radius=0.022):
    import matplotlib.patches as mpatches
    r = radius
    ax.add_patch(mpatches.Circle(
        (cx, cy), r,
        linewidth=0.8, edgecolor='#555', facecolor='#cfcfcf',
        zorder=4))
    ax.add_patch(mpatches.Circle(
        (cx, cy), r * 0.42,
        linewidth=0.6, edgecolor='#555', facecolor='#fdfdf9',
        zorder=5))
    for k in range(8):
        a = k * math.pi / 4
        ax.plot(
            [cx + r * 0.42 * math.cos(a), cx + r * math.cos(a)],
            [cy + r * 0.42 * math.sin(a), cy + r * math.sin(a)],
            color='#888', linewidth=0.4, zorder=4)


def _draw_kinase_bilobal(
        ax, cx, cy, label, *,
        face_n='#9ecae1', face_c='#74a9cf', edge='#1c4a78',
        scale=1.0, p_in_cleft=False, label_color='#1c4a78',
        label_weight='bold'):
    import matplotlib.patches as mpatches
    s = scale
    ax.add_patch(mpatches.Ellipse(
        (cx - 0.002 * s, cy - 0.018 * s),
        0.085 * s, 0.058 * s, angle=-6,
        linewidth=1.0, edgecolor=edge, facecolor=face_c, zorder=3))
    ax.add_patch(mpatches.Ellipse(
        (cx - 0.005 * s, cy + 0.024 * s),
        0.058 * s, 0.043 * s, angle=12,
        linewidth=1.0, edgecolor=edge, facecolor=face_n, zorder=3))
    ax.plot(
        [cx - 0.030 * s, cx - 0.020 * s],
        [cy + 0.005 * s, cy + 0.000 * s],
        color=edge, linewidth=0.6, alpha=0.5, zorder=3)
    if p_in_cleft:
        px = cx + 0.038 * s
        py = cy + 0.005 * s
        ax.add_patch(mpatches.Circle(
            (px, py), 0.012 * s,
            edgecolor='#7c4a00', facecolor='#fde047',
            linewidth=0.8, zorder=4))
        ax.text(px, py, 'P', ha='center', va='center',
                fontsize=4.6, weight='bold', color='#5a3500',
                zorder=5)
    if label:
        ax.text(cx, cy - 0.072 * s, str(label),
                ha='center', va='top', fontsize=6.6,
                weight=label_weight,
                color=label_color, zorder=5)


def _draw_mek(ax, cx, cy, label, bound=False, scale=1.0):
    _draw_kinase_bilobal(
        ax, cx, cy, label,
        face_n='#9ecae1', face_c='#74a9cf', edge='#1c4a78',
        scale=scale, p_in_cleft=bound,
        label_color='#1c4a78', label_weight='bold')


def _draw_erk(ax, cx, cy, label, phosphorylated=False, scale=1.0):
    import matplotlib.patches as mpatches
    s = 0.7 * scale
    face_n = '#abdb98' if not phosphorylated else '#f6a285'
    face_c = '#7fbf7b' if not phosphorylated else '#ef8a62'
    edge = '#3a7d3a' if not phosphorylated else '#a04020'
    ax.add_patch(mpatches.Ellipse(
        (cx + 0.003 * s, cy - 0.014 * s),
        0.075 * s, 0.052 * s, angle=8,
        linewidth=1.0, edgecolor=edge, facecolor=face_c, zorder=3))
    ax.add_patch(mpatches.Ellipse(
        (cx + 0.006 * s, cy + 0.021 * s),
        0.052 * s, 0.038 * s, angle=-12,
        linewidth=1.0, edgecolor=edge, facecolor=face_n, zorder=3))
    ax.plot(
        [cx + 0.028 * s, cx + 0.018 * s],
        [cy + 0.004 * s, cy + 0.000 * s],
        color=edge, linewidth=0.6, alpha=0.5, zorder=3)
    if phosphorylated:
        for i, (dx, dy) in enumerate([(0.038, 0.005), (0.044, -0.012)]):
            px = cx + dx * s
            py = cy + dy * s
            ax.add_patch(mpatches.Circle(
                (px, py), 0.010 * s,
                edgecolor='#7c4a00', facecolor='#fde047',
                linewidth=0.7, zorder=4))
            ax.text(px, py, 'P', ha='center', va='center',
                    fontsize=4.0, weight='bold', color='#5a3500',
                    zorder=5)
    if label:
        ax.text(cx, cy - 0.060 * s, str(label),
                ha='center', va='top', fontsize=6.3,
                color='#222', zorder=5)


def _draw_bond(ax, x1, y1, x2, y2, alpha=1.0):
    L = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    if L < 1e-6:
        return
    ox = -(y2 - y1) / L * 0.005
    oy = (x2 - x1) / L * 0.005
    for sgn in (1, -1):
        ax.plot([x1 + sgn * ox, x2 + sgn * ox],
                [y1 + sgn * oy, y2 + sgn * oy],
                color='#2ca02c', linewidth=1.5, zorder=4,
                alpha=alpha, solid_capstyle='round')


def _position_in_compartment(comp_name, entity_name, control):
    if control == 'MEK':
        return (0.50, 0.50)
    if comp_name == 'cytoplasm':
        slots = [
            (0.50, 0.18),
            (0.50, 0.84),
            (0.10, 0.50),
        ]
    elif comp_name == 'nucleus':
        cx, cy = NUCLEUS_CENTER
        slots = [
            (cx - 0.078, cy + 0.005),
            (cx - 0.020, cy + 0.075),
            (cx - 0.020, cy - 0.075),
        ]
    elif comp_name == 'er_lumen':
        ex, ey = ER_CENTER
        slots = [
            (ex - 0.085, ey + 0.06),
            (ex + 0.085, ey + 0.05),
            (ex - 0.060, ey - 0.07),
        ]
    else:
        return (0.5, 0.5)
    name_to_slot = {'erk1': 0, 'erk2': 1, 'erk3': 2}
    idx = name_to_slot.get(entity_name, abs(hash(entity_name)) % 3)
    return slots[idx]


def _layout_state(state, compartment_names=None):
    layout = {}

    def walk(node, comp_name):
        if not isinstance(node, dict):
            return
        for k, v in node.items():
            if not isinstance(v, dict):
                continue
            ctrl = v.get('_type', '')
            if ctrl == 'Compartment':
                walk(v, comp_name=k)
                continue
            if ctrl in ('MEK', 'ERK', 'pERK'):
                label = v.get('name', k)
                cx, cy = _position_in_compartment(comp_name, label, ctrl)
                outs = v.get('outputs')
                wire = None
                if isinstance(outs, dict) and outs:
                    first = next(iter(outs.values()))
                    if isinstance(first, list):
                        wire = tuple(first)
                layout[label] = (cx, cy, ctrl, wire, comp_name)
                continue
            walk(v, comp_name)

    walk(state, comp_name=None)

    by_wire = {}
    for nm, (cx, cy, ctrl, wire, _) in layout.items():
        if wire is None:
            continue
        by_wire.setdefault(wire, []).append((nm, cx, cy, ctrl))
    for endpoints in by_wire.values():
        if len(endpoints) != 2:
            continue
        mek = next(((n, x, y) for n, x, y, c in endpoints if c == 'MEK'),
                   None)
        sub = next(((n, x, y) for n, x, y, c in endpoints if c == 'pERK'),
                   None)
        if mek is None or sub is None:
            continue
        sub_name = sub[0]
        mek_cx, mek_cy = mek[1], mek[2]
        cleft_x = mek_cx + 0.045
        cleft_y = mek_cy - 0.005
        old = layout[sub_name]
        layout[sub_name] = (
            cleft_x, cleft_y, old[2], old[3], old[4])
    return layout


def _draw_cell_snapshot(ax, state, compartment_names=None, title=''):
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.04)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_aspect('equal')
    for spine in ax.spines.values():
        spine.set_visible(False)
    if title:
        ax.set_title(title, fontsize=9)

    _draw_cell(ax)
    ax.text(0.5, 0.97, 'cell', ha='center', va='bottom',
            fontsize=8, color='#3a5b3a', style='italic', zorder=6)

    have_nucleus = any(
        c.get('kind', {}).get('_type') == 'Nucleus'
        for _, c in _iter_compartments(state))
    have_er = any(
        c.get('kind', {}).get('_type') == 'ERLumen'
        for _, c in _iter_compartments(state))
    if have_nucleus:
        _draw_nucleus(ax)
    if have_er:
        _draw_er_lumen(ax)

    layout = _layout_state(state)
    for label, (cx, cy, ctrl, wire, _) in layout.items():
        bound = wire is not None
        if ctrl == 'MEK':
            _draw_mek(ax, cx, cy, label, bound=bound)
        elif ctrl == 'ERK':
            _draw_erk(ax, cx, cy, label, phosphorylated=False)
        elif ctrl == 'pERK':
            _draw_erk(ax, cx, cy, label, phosphorylated=True)

    by_wire = {}
    for label, (cx, cy, ctrl, wire, _) in layout.items():
        if wire is None:
            continue
        by_wire.setdefault(wire, []).append((cx, cy))
    for endpoints in by_wire.values():
        if len(endpoints) < 2:
            continue
        for i in range(len(endpoints)):
            for j in range(i + 1, len(endpoints)):
                (ax_, ay_), (bx, by) = endpoints[i], endpoints[j]
                _draw_bond(ax, ax_, ay_, bx, by)


# ── Initial-bigraph diagram + explainer markdown + state JSON ──────


_BRS_EXPLAINER_MARKDOWN = """\
### Biology

MAP-kinase signalling: the cytoplasmic kinase **MEK1** (PDB
`3EQH`) phosphorylates **ERK2** (PDB `1ERK` / `2ERK`) on its
Thr-X-Tyr activation motif. Phospho-ERK then translocates
through nuclear pore complexes (NPCs; Lin & Hoelz 2019) into
the nucleus, where it phosphorylates downstream transcription
factors. MEK is active-site limited — at most one ERK may
occupy its catalytic cleft at a time.

### Bigraph encoding

- **Place graph** (nested):
  `Cell ⊃ Cytoplasm ⊃ {Nucleus, ERLumen, MEK, ERK, pERK}`
- **Link graph**: one shared edge per MEK·pERK complex.
- **Sorts** (`_type`): `Cell`, `Compartment`, `MEK`, `ERK`,
  `pERK`, plus the compartment-kind tags `Cytoplasm`,
  `Nucleus`, `ERLumen`. Each sort is registered as a schema
  type so it can later carry typed methods that compose with
  the rewrite rules.

### Rules (Gillespie SSA, propensity = `k × |matches|`)

- **`phosphorylate`** (k = 2.0): ERK + MEK co-located in the
  cytoplasm, both unbound (`Absent` preimage), bind via a
  fresh shared edge.
- **`dissociate`** (k = 0.5): MEK·pERK → free MEK + free
  pERK; the bond is destroyed.
- **`dephosphorylate`** (k = 0.4): free pERK in the nucleus
  → free ERK. Models nuclear MAP-kinase phosphatases (DUSPs)
  resetting the kinase. Closes the cycle so the system keeps
  firing instead of stalling at "all pERK in nucleus".
- **`translocate_erk_in`** (k = 1.0): free ERK,
  cytoplasm → child compartment.
- **`translocate_erk_out`** (k = 1.0): free ERK,
  child → cytoplasm. Symmetric diffusion.
- **`translocate_perk_in`** (k = 2.0): free pERK,
  cytoplasm → nucleus. Active import.
- **`translocate_perk_out`** (k = 0.1): free pERK,
  nucleus → cytoplasm. Slow leak.

The **20-fold in/out asymmetry** for pERK is the structural
source of nuclear pERK accumulation — the signal itself.
Nesting also makes nucleus ↔ ER direct transit
inexpressible: it isn't a parent/child pair, so no rule
redex names it.

### Why bigraphs?

Compartment-only models capture which pool a molecule is in,
but not which kinase is bound to which substrate.
Reaction-network (mass-action) models capture binding
(S + E ⇌ SE) but lose the spatial dimension. Bigraphs unify
both: a single redex constrains place AND link in one step
— e.g. `phosphorylate` requires co-location AND no prior
bond.

See `kaleidoscope/systems/mapk/references.md` for
structural and biological citations (Milner 2009; Archibald
et al. 2024; Zhang et al. 1994; Canagarajah et al. 1997;
Ohren et al. 2004; Lin & Hoelz 2019; Plotnikov et al. 2011).
"""


def _save_explainer_markdown(filename, out_dir):
    path = os.path.join(out_dir, f'{filename}_overview.md')
    with open(path, 'w') as f:
        f.write(_BRS_EXPLAINER_MARKDOWN)


def _save_state_json(filename, out_dir, state):
    path = os.path.join(out_dir, f'{filename}_state.json')
    with open(path, 'w') as f:
        json.dump({'cell': state}, f, indent=2, default=str)


_BIGRAPH_FILL_COLORS = {
    'MEK':  '#9ecae1',
    'ERK':  '#abdb98',
    'pERK': '#f6a285',
    'Site': '#d8d8d8',
    'Compartment_Cytoplasm': '#e3edd7',
    'Compartment_Nucleus':   '#f5e6c4',
    'Compartment_ERLumen':   '#f4d3a8',
    'Cell':                  '#f5efde',
}

_BIGRAPH_DEFAULT_FILL = '#dde2e8'
_BIGRAPH_WIRE_FILL = '#fff3b0'


def _bigraph_fill_colors_for_state(state, prefix=()):
    fills = {}

    def walk(node, path):
        if isinstance(node, (list, tuple)):
            if (path and len(node) >= 2 and node and node[0] == '_edges'):
                fills[path] = _BIGRAPH_WIRE_FILL
            return
        if not isinstance(node, dict):
            if path:
                fills[path] = _BIGRAPH_DEFAULT_FILL
            return

        ctrl = node.get('_type', '')
        color = None
        if ctrl == 'Compartment':
            kind = node.get('kind', {}).get('_type', '')
            color = _BIGRAPH_FILL_COLORS.get(f'Compartment_{kind}')
        elif ctrl in _BIGRAPH_FILL_COLORS:
            color = _BIGRAPH_FILL_COLORS[ctrl]
        if path:
            fills[path] = color or _BIGRAPH_DEFAULT_FILL

        for k, v in node.items():
            if isinstance(k, str) and not k.startswith('_'):
                walk(v, path + (k,))

    walk(state, prefix)
    return fills


def _draw_rule_arrow(ax, color, label=None):
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.annotate(
        '', xy=(0.95, 0.5), xytext=(0.05, 0.5),
        arrowprops=dict(arrowstyle='->', linewidth=2, color=color))
    if label:
        ax.text(
            0.5, 0.62, label, ha='center', va='bottom',
            fontsize=9, weight='bold', color=color)


def _redex_pattern_to_state(node, edge_anchors=None):
    if edge_anchors is None:
        edge_anchors = set()
    if isinstance(node, Site):
        return {'_type': 'Site'}
    if isinstance(node, LinkVar):
        edge_anchors.add(node.name)
        return ['_edges', node.name.lstrip('~')]
    if isinstance(node, Absent):
        return None
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if isinstance(k, str) and k == '_type':
                out[k] = v
                continue
            converted = _redex_pattern_to_state(v, edge_anchors)
            if converted is None:
                continue
            out[k] = converted
        return out
    if isinstance(node, list):
        return [_redex_pattern_to_state(v, edge_anchors) for v in node]
    return node


def _render_rule_pattern(label, pattern, out_dir, suffix):
    try:
        from bigraph_viz import plot_bigraph
        from process_bigraph import allocate_core
    except ImportError:
        return None
    edge_anchors = set()
    state = _redex_pattern_to_state(pattern, edge_anchors)
    if not isinstance(state, dict):
        return None
    core = allocate_core()
    register_mapk_types(core)
    fname = f'_rule_{label}_{suffix}'
    fills = _bigraph_fill_colors_for_state(state)
    plot_bigraph(
        state=state,
        core=core,
        out_dir=out_dir,
        filename=fname,
        dpi='120',
        show_values=False,
        show_compiled_state=False,
        node_fill_colors=fills)
    return os.path.join(out_dir, f'{fname}.png')


def _replot_initial_bigraph(filename, out_dir, state):
    try:
        from bigraph_viz import plot_bigraph
        from process_bigraph import allocate_core
    except ImportError:
        return
    core = allocate_core()
    register_mapk_types(core)
    fills = _bigraph_fill_colors_for_state(state, prefix=('cell',))
    plot_bigraph(
        state={'cell': state},
        core=core,
        out_dir=out_dir,
        filename=f'{filename}_viz',
        dpi='150',
        show_values=True,
        show_compiled_state=False,
        node_fill_colors=fills)


# ── Smooth animation ───────────────────────────────────────────────


def _ease_in_out_cubic(t):
    return 3 * t * t - 2 * t * t * t


def _make_smooth_animation(
        filename, out_dir, states, times, compartment_names, firings,
        n_intermediate=8, fps=10):
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation, PillowWriter

    layouts = [_layout_state(s) for s in states]
    has_nuc = [
        any(c.get('kind', {}).get('_type') == 'Nucleus'
            for _, c in _iter_compartments(s))
        for s in states]
    has_er = [
        any(c.get('kind', {}).get('_type') == 'ERLumen'
            for _, c in _iter_compartments(s))
        for s in states]
    firing_at = {}
    for t_after, rule, _, _ in firings:
        for i, t in enumerate(times):
            if abs(t - t_after) < 1e-6:
                firing_at[i - 1] = rule
                break

    schedule = []
    for i in range(len(states) - 1):
        for k in range(n_intermediate):
            schedule.append((i, k))
    for _ in range(max(n_intermediate // 2, 2)):
        schedule.append((len(states) - 1, 0))

    fig, ax = plt.subplots(figsize=(7.2, 4.2))

    def _interp_layout(i, tau_eased):
        la = layouts[i]
        lb = layouts[i + 1] if i + 1 < len(layouts) else layouts[i]
        out = {}
        names = set(la.keys()) | set(lb.keys())
        for nm in names:
            a = la.get(nm)
            b = lb.get(nm)
            if a is None and b is None:
                continue
            if a is None:
                a = b
            if b is None:
                b = a
            xa, ya, ca, wa, _ = a
            xb, yb, cb, wb, _ = b
            x = xa + tau_eased * (xb - xa)
            y = ya + tau_eased * (yb - ya)
            ctrl = cb if tau_eased >= 0.5 else ca
            wire = wb if tau_eased >= 0.5 else wa
            out[nm] = (x, y, ctrl, wire)
        return out

    def _draw_at(layout, label_top='', frame_idx=None):
        ax.clear()
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1.04)
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_aspect('equal')
        for spine in ax.spines.values():
            spine.set_visible(False)
        _draw_cell(ax)
        ax.text(0.5, 0.97, 'cell', ha='center', va='bottom',
                fontsize=8, color='#3a5b3a', style='italic', zorder=6)
        idx = frame_idx if frame_idx is not None else 0
        idx = min(idx, len(has_nuc) - 1)
        if has_nuc[idx]:
            _draw_nucleus(ax)
        if has_er[idx]:
            _draw_er_lumen(ax)
        for nm, (cx, cy, ctrl, wire) in layout.items():
            if ctrl == 'MEK':
                _draw_mek(ax, cx, cy, nm, bound=(wire is not None))
            elif ctrl == 'ERK':
                _draw_erk(ax, cx, cy, nm, phosphorylated=False)
            elif ctrl == 'pERK':
                _draw_erk(ax, cx, cy, nm, phosphorylated=True)
        by_wire = {}
        for nm, (cx, cy, ctrl, wire) in layout.items():
            if wire is None:
                continue
            by_wire.setdefault(wire, []).append((cx, cy))
        for endpoints in by_wire.values():
            if len(endpoints) < 2:
                continue
            for i in range(len(endpoints)):
                for j in range(i + 1, len(endpoints)):
                    (ax_, ay_), (bx, by) = endpoints[i], endpoints[j]
                    _draw_bond(ax, ax_, ay_, bx, by)
        ax.set_title(label_top, fontsize=10)

    def render(item):
        i, k = item
        if i >= len(states) - 1:
            last = layouts[-1]
            simple = {nm: (cx, cy, ctrl, wire)
                      for nm, (cx, cy, ctrl, wire, _) in last.items()}
            _draw_at(simple, label_top=f't = {times[-1]:.1f}',
                     frame_idx=len(states) - 1)
            return
        tau = (k + 1) / (n_intermediate + 1)
        eased = _ease_in_out_cubic(tau)
        layout = _interp_layout(i, eased)
        rule = firing_at.get(i)
        t = times[i] + tau * (times[i + 1] - times[i])
        if rule:
            color = RULE_COLORS.get(rule, '#444')
            ax_title = f't ≈ {t:.1f}    →  {rule}'
        else:
            color = '#444'
            ax_title = f't ≈ {t:.1f}'
        idx_for_organelles = i + 1 if eased >= 0.5 else i
        _draw_at(layout, label_top=ax_title, frame_idx=idx_for_organelles)
        if rule:
            ax.set_title(
                ax_title, fontsize=10, color=color, weight='bold')

    anim = FuncAnimation(
        fig, render, frames=schedule,
        interval=int(1000 / fps), repeat=True)
    gif_path = os.path.join(out_dir, f'{filename}_animation.gif')
    try:
        anim.save(gif_path, writer=PillowWriter(fps=fps))
    except Exception as e:
        print(f'⚠ animation save failed: {e}')
    plt.close(fig)
