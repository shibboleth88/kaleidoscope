import { it } from 'vitest';
import { readProgram } from '../src/engine';
import { msPerReaction } from './reactions';

/**
 * F101: what a fold across links costs a world that changes values in place. Realms hold their communities by many-point
 * `holds` ports, communities share a faith (a link of a hundred points) and trade; most reactions rewrite a community's
 * value in place. One rule's rate folds over the realm's communities (`sum[?hs ?hs.tax * ?hs.n * ?hs.coin]`), another
 * over a community's trade partners (`sum[?tr ?tr.n]`). With and without them, ms a reaction should be close.
 */
export const acrossProgram = (realms: number, per: number, folds: boolean) => {
  const towns: string[] = [];
  const decl: string[] = [];
  const holds: string[][] = Array.from({ length: realms }, () => []);
  const faiths = 3;
  const creeds: string[][] = Array.from({ length: faiths }, () => []);
  let t = 0;
  for (let r = 0; r < realms; r++)
    for (let i = 0; i < per; i++, t++) {
      decl.push(`~r${t} :: Rule`);
      holds[r].push(`~r${t}`);
      const trade = [`~t${t}`, `~t${t - 1}`].filter((x) => x !== '~t-1');
      if (i < per - 1) decl.push(`~t${t} :: Trade`);
      const own = i < per - 1 ? trade : trade.slice(1);
      towns.push(`Settlement[ruler = ~r${t} | creed = ~f${t % faiths}${own.length ? ` | trade = (${own.join(' | ')})` : ''} | n = ${5 + (t % 20)} | sick = ${t % 7 === 0 ? 1 : 0}]`);
    }
  // (one creed link per faith, of many points: each community's creed is the faith's link)
  for (let f = 0; f < faiths; f++) (decl.push(`~f${f} :: Creed`), creeds[f].push(`~f${f}`));
  const text = `Program(
  module = (
    Rule = Type(<: Link)
    Creed = Type(<: Link)
    Trade = Type(<: Link)
    Earth = Type()
    Realms = Type()
    Faiths = Type()
    Realm[holds :: Rule * | treasury :: Int = 0] = Type()
    Settlement[ruler :: Rule * | creed :: Creed * | trade :: Trade * | n :: Int = 10 | tax :: Int = 3 | coin :: Int = 1 | wealth :: Int = 0 | immune :: Int = 0 | sick :: Int = 0] = Type()
    Faith[creed :: Creed * | zeal :: Int = 50] = Type()
    grow[rate = 0.1] = ?s = Settlement[n = ?n] where ?n < 30 => ?s = Settlement[n = ?n + 1]
    shrink[rate = 0.1] = ?s = Settlement[n = ?n] where ?n > 5 => ?s = Settlement[n = ?n - 1]
    earn[rate = 0.3] = ?s = Settlement[wealth = ?w] where ?w < 50 => ?s = Settlement[wealth = ?w + 1]
    lose[rate = 0.3] = ?s = Settlement[wealth = ?w] where ?w > 0 => ?s = Settlement[wealth = ?w - 1]
    wane[rate = 0.2] = ?s = Settlement[immune = ?i] where ?i > 0 => ?s = Settlement[immune = ?i - 1]
    gain[rate = 0.2] = ?s = Settlement[immune = ?i] where ?i < 9 => ?s = Settlement[immune = ?i + 1]
    fervor[rate = 0.05] = ?f = Faith[zeal = ?z] where ?z < 90 => ?f = Faith[zeal = ?z + 1]
    ${folds ? `levy[rate = 0.0001 * sum[?hs ?hs.tax * ?hs.n * ?hs.coin]] = ?k = Realm[holds = ?hs | treasury = ?m] => ?k = Realm[holds = ?hs | treasury = ?m + 1]
    fade[rate = 1.0 / (1.0 + sum[?tr ?tr.n] / 30.0)] = ?s = Settlement[trade = ?tr | sick = 1] => ?s = Settlement[trade = ?tr | sick = 0]
    catch[rate = 0.01] = ?s = Settlement[sick = 0] => ?s = Settlement[sick = 1]` : `levy[rate = 0.0001 * ?m] = ?k = Realm[holds = ?hs | treasury = ?m] => ?k = Realm[holds = ?hs | treasury = ?m + 1]
    fade[rate = 1.0] = ?s = Settlement[trade = ?tr | sick = 1] => ?s = Settlement[trade = ?tr | sick = 0]
    catch[rate = 0.01] = ?s = Settlement[sick = 0] => ?s = Settlement[sick = 1]`}
  )
  world = (${decl.join(' | ')}
    | Realms(${holds.map((h) => `Realm[holds = (${h.join(' | ')})]`).join(' | ')})
    | Faiths(${creeds.map((c) => `Faith[creed = ${c[0]}]`).join(' | ')})
    | Earth(${towns.join(' | ')}))
)`;
  return text;
};

it('folds across links', () => {
  for (const [realms, per] of [[4, 25], [8, 50]]) {
    const row: string[] = [];
    for (const folds of [false, true]) {
      const p = readProgram(acrossProgram(realms, per, folds));
      msPerReaction(p, 300);
      const { ms } = msPerReaction(p, 3000, 2);
      row.push(`${folds ? 'with folds' : 'without'} ${ms.toFixed(3)} ms`);
    }
    console.log(`across: ${realms} realms × ${per} communities   ${row.join('   ')}`);
  }
}, 600_000);
