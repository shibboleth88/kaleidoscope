"""Standalone runner for the MAPK BRS example.

Builds the document, runs a ``Composite`` under Gillespie SSA,
and writes all five output figures to ``--out``.
"""
import argparse
import os

from process_bigraph import allocate_core
from process_bigraph.composite import Composite
from process_bigraph.emitter import gather_emitter_results

from kaleidoscope.systems.mapk.doc import get_brs_mapk_doc
from kaleidoscope.systems.mapk.plot import plot_brs_mapk
from kaleidoscope.systems.mapk.report import generate_html_report


def parse_args():
    p = argparse.ArgumentParser(
        description='Run the MAPK BRS example and produce plots.')
    p.add_argument('--time', type=float, default=80.0,
                   help='simulation duration in ticks (default 80)')
    p.add_argument('--out', default='out',
                   help='output directory (default out/)')
    p.add_argument('--seed', type=int, default=42,
                   help='RNG seed for Gillespie SSA (default 42)')
    p.add_argument('--interval', type=float, default=1.0,
                   help='emit interval in ticks (default 1.0)')
    p.add_argument('--mode', default='gillespie',
                   choices=['gillespie', 'stochastic', 'deterministic'],
                   help='BRS firing mode (default gillespie)')
    p.add_argument('--name', default='brs_mapk',
                   help='output filename prefix (default brs_mapk)')
    return p.parse_args()


def run(time=80.0, out='out', seed=42, interval=1.0,
        mode='gillespie', name='brs_mapk'):
    """Programmatic entry point — same as the CLI, callable from
    Python."""
    os.makedirs(out, exist_ok=True)

    core = allocate_core()
    document = get_brs_mapk_doc(
        core=core,
        config={'mode': mode, 'seed': seed, 'interval': interval})

    sim = Composite(document, core=core)
    print(f'⏱ Simulating MAPK BRS for {time} ticks (mode={mode}, seed={seed})…')
    sim.run(time)
    results = gather_emitter_results(sim)[('emitter',)]
    print(f'✅ Simulation complete: {len(results)} emitted steps')

    plot_brs_mapk(
        results, document['state']['cell'],
        config={'filename': name, 'out_dir': out, 'n_snapshots': 6})
    report_path = generate_html_report(
        out, filename=name,
        run_config={
            'mode': mode, 'seed': seed, 'time': time,
            'interval': interval})
    print(f'📂 Wrote outputs under {out}/{name}_*')
    print(f'📰 Report → {report_path}')
    return results


def main():
    args = parse_args()
    run(
        time=args.time, out=args.out, seed=args.seed,
        interval=args.interval, mode=args.mode, name=args.name)


if __name__ == '__main__':
    main()
