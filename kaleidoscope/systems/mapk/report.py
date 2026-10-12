"""Standalone HTML report for one MAPK BRS run.

Inlines the biology + bigraph encoding + rule semantics overview,
the five output figures (viz / timeseries / snapshots / trace /
animation), and a per-rule redex→reactum pattern grid into a
single self-contained page.
"""
import os
import re
from html import escape
from pathlib import Path


def generate_html_report(out_dir, filename='brs_mapk', run_config=None):
    """Write ``<out_dir>/report.html`` summarising one MAPK BRS run.

    Expects ``plot_brs_mapk`` to have already written its outputs
    under ``out_dir`` with the given ``filename`` prefix.
    """
    out_dir = Path(out_dir)
    report_path = out_dir / 'report.html'

    overview_md = _read_optional(out_dir / f'{filename}_overview.md')
    rule_patterns = _collect_rule_patterns(out_dir)

    sections = [
        _html_head(),
        _header_block(filename, run_config),
        _overview_block(overview_md),
        _figure_block(
            'Initial bigraph',
            f'{filename}_viz.png',
            'Place graph of the starting cell. '
            'Sorts are tinted by molecule type (MEK blue, ERK green, '
            'pERK orange); compartments by kind '
            '(cytoplasm pale green, nucleus pale beige, ER pale peach).'),
        _figure_block(
            'Population trajectories',
            f'{filename}_timeseries.png',
            'Substrate counts per compartment over the run. Vertical '
            'ticks at the top mark individual rule firings, colored '
            'by rule (see legend).'),
        _figure_block(
            'Structural snapshots',
            f'{filename}_snapshots.png',
            'Cell cartoon at six time points across the run. Bonds '
            'are drawn as dark-green double lines between paired '
            'MEK and pERK molecules.'),
        _figure_block(
            'Rule catalog (one example per rule)',
            f'{filename}_trace.png',
            'For each rule that fired during the run, the left half '
            'shows the redex → reactum pattern (parametric bigraph '
            'rewrite) and the right half shows a concrete before → '
            'after cell snapshot where that rule actually fired.'),
        _animation_block(filename),
        _rule_pattern_grid(rule_patterns),
        _footer_meta_block(filename, run_config),
        _html_foot(),
    ]

    report_path.write_text('\n'.join(sections))
    return report_path


# ── Section builders ───────────────────────────────────────────────


def _html_head():
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MAPK as a bigraphical reactive system</title>
<style>
  :root {
    --bg: #fcfcfc;
    --fg: #222;
    --muted: #555;
    --rule-line: #d0d0d0;
    --card-bg: #fff;
    --card-border: #e6e6e6;
    --tag-bg: #f4f4f4;
  }
  html { scroll-behavior: smooth; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                 system-ui, sans-serif;
    background: var(--bg);
    color: var(--fg);
    max-width: 1100px;
    margin: 0 auto;
    padding: 28px 24px 80px 24px;
    line-height: 1.5;
  }
  h1 { margin: 0 0 18px 0; }
  h2 {
    margin-top: 2em;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--rule-line);
  }
  h3 { margin-top: 1.4em; }
  .meta {
    color: var(--muted);
    font-size: 14px;
  }
  .tag {
    display: inline-block;
    margin-right: 6px;
    padding: 2px 8px;
    background: var(--tag-bg);
    border-radius: 999px;
    font-size: 12px;
    color: #333;
  }
  figure {
    margin: 12px 0 8px 0;
    padding: 12px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
  }
  figure img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  figcaption {
    margin-top: 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .rule-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 12px;
  }
  .rule-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 10px;
  }
  .rule-card h4 {
    margin: 0 0 4px 0;
    font-size: 14px;
    color: var(--muted);
  }
  .rule-pair {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 6px;
  }
  .rule-pair img { max-width: 100%; height: auto; }
  .rule-pair .arrow {
    font-size: 22px;
    color: var(--muted);
  }
  code, pre {
    background: #f4f4f4;
    border-radius: 4px;
  }
  code { padding: 1px 5px; }
  pre {
    padding: 10px;
    overflow-x: auto;
    border: 1px solid var(--card-border);
  }
  details > summary {
    cursor: pointer;
    font-weight: 600;
    margin: 8px 0;
  }
  .overview {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 16px 20px;
    margin-top: 16px;
  }
  .overview h3 { margin-top: 1em; }
  .overview ul { padding-left: 22px; }
  .report-footer {
    margin-top: 56px;
    padding-top: 18px;
    border-top: 1px solid var(--rule-line);
    text-align: center;
  }
  .report-footer .footer-subhead {
    margin: 0 0 10px 0;
    color: var(--muted);
    font-size: 14px;
    font-style: italic;
  }
  .report-footer .meta { margin: 0; }
</style>
</head>
<body>"""


def _header_block(filename, run_config):
    return '<h1>MAPK as a bigraphical reactive system</h1>'


def _footer_meta_block(filename, run_config):
    cfg = run_config or {}
    tags = []
    if 'mode' in cfg:
        tags.append(f'mode = {cfg["mode"]}')
    if 'seed' in cfg:
        tags.append(f'seed = {cfg["seed"]}')
    if 'time' in cfg:
        tags.append(f'time = {cfg["time"]} ticks')
    if 'interval' in cfg:
        tags.append(f'interval = {cfg["interval"]}')
    tag_html = ''.join(f'<span class="tag">{escape(t)}</span>' for t in tags)
    return f"""<footer class="report-footer">
  <p class="footer-subhead">
    MAPK signalling cycle as a Bigraphical Reactive System.
  </p>
  <div class="meta">
    <code>{escape(filename)}</code>
    {tag_html}
  </div>
</footer>"""


def _figure_block(title, img_name, caption):
    return f"""<h2>{escape(title)}</h2>
<figure>
  <img src="{escape(img_name)}" alt="{escape(title)}">
  <figcaption>{escape(caption)}</figcaption>
</figure>"""


def _animation_block(filename):
    gif_name = f'{filename}_animation.gif'
    return f"""<h2>Animation</h2>
<figure>
  <img src="{escape(gif_name)}" alt="Smooth animation of the run">
  <figcaption>
    Cubic-eased frame interpolation across every state transition;
    rule firings annotate the title bar in their per-rule color.
  </figcaption>
</figure>"""


def _rule_pattern_grid(patterns):
    if not patterns:
        return ''
    cards = []
    for label, (redex, reactum) in patterns.items():
        redex_img = (
            f'<img src="{escape(redex)}" alt="{escape(label)} redex">'
            if redex else '<em>(no image)</em>')
        reactum_img = (
            f'<img src="{escape(reactum)}" alt="{escape(label)} reactum">'
            if reactum else '<em>(no image)</em>')
        cards.append(f"""
<div class="rule-card">
  <h4>{escape(label)}</h4>
  <div class="rule-pair">
    <div>{redex_img}</div>
    <div class="arrow">&rarr;</div>
    <div>{reactum_img}</div>
  </div>
</div>""".strip())
    return f"""<h2>Rule patterns</h2>
<p>Each rule's redex (left) and reactum (right) — parametric
bigraph rewrites. <code>Site</code> nodes are open contexts; wire
endpoints (yellow) are paired by their shared link-graph
anchor.</p>
<div class="rule-grid">
{chr(10).join(cards)}
</div>"""


def _overview_block(overview_md):
    if not overview_md:
        return ''
    html = _markdown_to_html(overview_md)
    return f"""<div class="overview">
{html}
</div>"""


def _html_foot():
    return """</body>
</html>"""


# ── Helpers ────────────────────────────────────────────────────────


def _read_optional(path):
    try:
        return path.read_text()
    except FileNotFoundError:
        return None


def _collect_rule_patterns(out_dir):
    """Return ``{rule_label: (redex_png, reactum_png)}`` for every
    ``_rule_<label>_redex.png`` / ``_rule_<label>_reactum.png``
    pair present in ``out_dir``. Filenames are returned relative
    to ``out_dir`` so the report can link them directly."""
    redexes = {}
    reacta = {}
    pattern = re.compile(r'^_rule_(?P<label>.+?)_(redex|reactum)\.png$')
    for entry in sorted(os.listdir(out_dir)):
        m = pattern.match(entry)
        if not m:
            continue
        label, kind = m.group('label'), m.group(2)
        (redexes if kind == 'redex' else reacta)[label] = entry
    return {
        label: (redexes.get(label), reacta.get(label))
        for label in sorted(set(redexes) | set(reacta))}


def _markdown_to_html(text):
    """Tiny markdown → HTML for the overview file. Handles only the
    constructs the overview actually uses (### headings, **bold**,
    `code`, hyphen lists, paragraphs). Brittle by design — extend
    only if the overview grows new syntax."""
    lines = text.splitlines()
    out = []
    in_list = False

    def close_list():
        nonlocal in_list
        if in_list:
            out.append('</ul>')
            in_list = False

    paragraph = []

    def flush_paragraph():
        if paragraph:
            joined = ' '.join(paragraph)
            out.append(f'<p>{_inline_md(joined)}</p>')
            paragraph.clear()

    for raw in lines:
        line = raw.rstrip()
        if not line:
            flush_paragraph()
            close_list()
            continue
        if line.startswith('### '):
            flush_paragraph()
            close_list()
            out.append(f'<h3>{_inline_md(line[4:].strip())}</h3>')
            continue
        if line.startswith('- '):
            flush_paragraph()
            if not in_list:
                out.append('<ul>')
                in_list = True
            out.append(f'<li>{_inline_md(line[2:].strip())}</li>')
            continue
        # Continuation of a list item (indented) — append to last <li>
        if in_list and line.startswith('  ') and out and out[-1].startswith('<li>') and out[-1].endswith('</li>'):
            inner = out[-1][len('<li>'):-len('</li>')]
            out[-1] = f'<li>{inner} {_inline_md(line.strip())}</li>'
            continue
        paragraph.append(line.strip())

    flush_paragraph()
    close_list()
    return '\n'.join(out)


_INLINE_CODE = re.compile(r'`([^`]+)`')
_INLINE_BOLD = re.compile(r'\*\*([^*]+)\*\*')


def _inline_md(text):
    # Escape HTML first, then re-introduce <code> and <strong> spans.
    text = escape(text)
    text = _INLINE_CODE.sub(r'<code>\1</code>', text)
    text = _INLINE_BOLD.sub(r'<strong>\1</strong>', text)
    return text
