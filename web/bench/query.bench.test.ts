import { it } from 'vitest';
import { readProgram } from '../src/engine';
import { msPerReaction } from './reactions';

/**
 * F105: a query over a place costs the place. A disease fades by the people of its community's region: written as
 * cycle's approximation (the community's own people times the communities the region holds) or exactly, as a query
 * (`sum[Settlement(n = ?x) in ?g -> ?x]`). People change in place at most reactions. ms a reaction, at two sizes.
 */
const program = (regions: number, per: number, exact: boolean) => `Program(
  module = (
    Earth = Type()
    Region = Type()
    Settlement[n :: Int = 10 | sick :: Int = 0 | wealth :: Int = 0] = Type()
    grow[rate = 0.1] = ?s = Settlement[n = ?n] where ?n < 30 => ?s = Settlement[n = ?n + 1]
    shrink[rate = 0.1] = ?s = Settlement[n = ?n] where ?n > 5 => ?s = Settlement[n = ?n - 1]
    earn[rate = 0.2] = ?s = Settlement[wealth = ?w] where ?w < 50 => ?s = Settlement[wealth = ?w + 1]
    lose[rate = 0.2] = ?s = Settlement[wealth = ?w] where ?w > 0 => ?s = Settlement[wealth = ?w - 1]
    catch[rate = 0.01] = ?s = Settlement[sick = 0] => ?s = Settlement[sick = 1]
    die_out[rate = ${exact ? '1.0 / (1.0 + sum[Settlement(n = ?x) in ?g -> ?x] / 30.0)' : '1.0 / (1.0 + ?n * (1.0 + count[?ss Settlement]) / 30.0)'}] =
      ?g = Region(?s = Settlement[sick = 1 | n = ?n] | ?ss) => ?g = Region(?s = Settlement[sick = 0 | n = ?n] | ?ss)
  )
  world = (Earth(${Array.from({ length: regions }, (_, r) => `Region(${Array.from({ length: per }, (_, i) => `Settlement[n = ${5 + ((r + i) % 20)} | sick = ${i % 5 === 0 ? 1 : 0}]`).join(' | ')})`).join(' | ')}))
)`;

it('queries over a place', () => {
  for (const [regions, per] of [[20, 10], [80, 10]]) {
    const row: string[] = [];
    for (const exact of [false, true]) {
      const p = readProgram(program(regions, per, exact));
      msPerReaction(p, 300);
      row.push(`${exact ? 'query' : 'approximation'} ${msPerReaction(p, 3000, 2).ms.toFixed(3)} ms`);
    }
    console.log(`query: ${regions} regions × ${per} communities   ${row.join('   ')}`);
  }
}, 600_000);
