/**
 * Issue #17 (Edward 2026-11-16): 「A>B o，但因為 B 有拇指、A 沒拇指，梅林派 A 沒派 B，A 其實就是莫德雷德。」
 *
 * From Merlin's own view: B is a red he sees, holder A declared B good, A is not one of the reds he sees. Under A0 (a good
 * holder declares the truth) A is red, and with every other red visible A is Mordred. Merlin's own certainty layer already
 * knows this (the must-fail gate keeps A off his loyal-style R3 / R5 teams); the gap was the R3+ re-proposal of a successful
 * mission (`merlinReuseNorm` ≥ 2): its open seats were filled from the public view (only the reds he SEES excluded) and the
 * team was checked by the public gate only, so the fill could add A. Fixtures are synthetic (no real game records).
 */
import { describe, expect, it } from 'vitest';
import { AVALON_CONFIG } from '@avalon/shared';
import type { PlayerObservation } from './types';
import { DEFAULT_AGENT_TUNING } from './AgentTuning';
import { HeuristicAgent } from './HeuristicAgent';
import { ForwardAgent } from './forward/ForwardAgent';
import { certaintyFor } from './LogicGates';
import { merlinKnownReds, merlinReuseNormTeam, merlinReuseProposal } from './MerlinLoyalStyle';

const IDS = Array.from({ length: 10 }, (_, i) => `P${i + 1}`);

/**
 * Merlin P1 sees P8 / P9 / P10; Mordred is P5 (A). R1 P1 P8 P7 succeeded (P8 = B, a red Merlin sees, did not fail);
 * R2 P2 P9 P1 P5 failed with one card; the R2 lake: P5 lakes P8 and declares good. Merlin leads R3 (4 seats).
 */
const merlinObs = (over: Partial<PlayerObservation> = {}): PlayerObservation => ({
  myPlayerId: 'P1', myRole: 'merlin', myTeam: 'good', playerCount: 10, allPlayerIds: IDS, knownEvils: ['P9', 'P8', 'P10'],
  currentRound: 3, currentLeader: 'P1', failCount: 0, questResults: ['success', 'fail'], gamePhase: 'team_select',
  questHistory: [
    { round: 1, team: ['P1', 'P8', 'P7'], result: 'success', failCount: 0 },
    { round: 2, team: ['P2', 'P9', 'P1', 'P5'], result: 'fail', failCount: 1 },
  ],
  voteHistory: [
    { round: 1, attempt: 1, leader: 'P1', team: ['P1', 'P8', 'P7'], approved: true, votes: {} },
    { round: 2, attempt: 1, leader: 'P2', team: ['P2', 'P9', 'P1', 'P5'], approved: true, votes: {} },
  ],
  proposedTeam: [],
  lakeHistory: [{ round: 2, holderId: 'P5', targetId: 'P8', declaredClaim: 'good' }],
  ...over,
} as unknown as PlayerObservation);

const decideTeam = (obs: PlayerObservation): string[] => {
  const d = new ForwardAgent('P1', new HeuristicAgent('P1')).decide(obs);
  if (d.action.type !== 'team_select') throw new Error(d.action.type);
  return d.action.teamIds;
};

describe('Issue #17 — Merlin and the holder who declared a red he sees as good', () => {
  it('Merlin\'s own certainty proves A red (A0 + sight); A is the one red he cannot see', () => {
    const obs = merlinObs();
    const v = certaintyFor(obs);
    expect(v.l1Empty).toBe(false);
    expect(v.isCertRed('P5')).toBe(true);
    expect([...merlinKnownReds(obs)].sort()).toEqual(['P10', 'P5', 'P8', 'P9']);
  });

  it('the R3 re-proposal of the successful R1 team never fills an open seat with A (fail before the fix)', () => {
    const obs = merlinObs();
    const reuse = merlinReuseNormTeam(DEFAULT_AGENT_TUNING, obs, 4);
    expect(reuse).not.toBeNull();
    expect(reuse).toEqual(expect.arrayContaining(['P1', 'P8', 'P7']));
    expect(reuse).not.toContain('P5');
    // The full live pipeline (HeuristicAgent → ForwardAgent, default tuning).
    expect(decideTeam(obs)).not.toContain('P5');
  });

  it('the invariant exemption (照派成功的隊) no longer covers a proven red added from outside the successful team', () => {
    const obs = merlinObs();
    expect(merlinReuseProposal(obs, ['P1', 'P8', 'P7', 'P5'])).toBe(false);
    expect(merlinReuseProposal(obs, ['P1', 'P8', 'P7', 'P3'])).toBe(true);
  });

  it('a successful team that already held A is still re-proposed as it was (the 11/01 ruling: 照派成功的隊算順應局勢)', () => {
    const obs = merlinObs({
      questHistory: [
        { round: 1, team: ['P1', 'P8', 'P5'], result: 'success', failCount: 0 },
        { round: 2, team: ['P2', 'P9', 'P1', 'P4'], result: 'fail', failCount: 1 },
      ],
    } as Partial<PlayerObservation>);
    expect(certaintyFor(obs).isCertRed('P5')).toBe(true);
    expect(merlinReuseProposal(obs, ['P1', 'P8', 'P5', 'P3'])).toBe(true);
  });

  it('B not a red Merlin sees: no hard inference that A is Mordred', () => {
    // P8 is now outside Merlin's sight (good or Mordred from his seat); A → P8 good says nothing certain about A.
    const obs = merlinObs({ knownEvils: ['P9', 'P10', 'P6'] } as Partial<PlayerObservation>);
    expect(certaintyFor(obs).isCertRed('P5')).toBe(false);
    expect(merlinKnownReds(obs).has('P5')).toBe(false);
  });

  it('a loyal (no sight) never marks A red from A → B good, and Percival\'s thumbs never reach other seats', () => {
    const loyal = merlinObs({ myRole: 'loyal', knownEvils: [] } as Partial<PlayerObservation>);
    expect(certaintyFor(loyal).isCertRed('P5')).toBe(false);
    // Percival's private thumbs (P8 = Morgana / P3 = Merlin, he cannot tell which) do not make A certainly red either.
    const perc = merlinObs({ myRole: 'percival', knownEvils: [], knownWizards: ['P8', 'P3'] } as Partial<PlayerObservation>);
    expect(certaintyFor(perc).isCertRed('P5')).toBe(false);
    // And Merlin's observation carries no thumbs: the inference comes from his own sight only.
    expect(merlinObs().knownWizards).toBeUndefined();
  });

  it('sweep: no Merlin team in a one-fail round (R3 / R5) holds the proven A unless he sat on the successful team re-proposed', () => {
    let seed = 1;
    const rnd = (): number => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    const pick = <T,>(a: readonly T[], k: number): T[] => { const c = [...a]; const o: T[] = []; while (o.length < k) o.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return o; };
    let checked = 0;
    for (let s = 1; s <= 400; s++) {
      seed = s * 7919;
      const reds = pick(IDS.slice(1), 4);
      const A = reds[3];
      const seen = reds.slice(0, 3);
      const B = seen[Math.floor(rnd() * 3)];
      const round = rnd() < 0.5 ? 3 : 5;
      const questHistory: { round: number; team: string[]; result: 'success' | 'fail'; failCount: number }[] = [];
      for (let q = 1; q < round; q++) {
        const team = pick(IDS, AVALON_CONFIG[10].questTeams[q - 1]);
        const on = team.filter((x) => reds.includes(x)).length;
        const fc = on === 0 ? 0 : Math.floor(rnd() * (on + 1));
        questHistory.push({ round: q, team, result: fc >= AVALON_CONFIG[10].questFailsRequired[q - 1] ? 'fail' : 'success', failCount: fc });
      }
      const questResults = questHistory.map((q) => q.result);
      if (questResults.filter((r) => r === 'fail').length >= 3 || questResults.filter((r) => r === 'success').length >= 3) continue;
      const obs = merlinObs({
        knownEvils: seen, currentRound: round, questResults, questHistory,
        voteHistory: questHistory.map((q) => ({ round: q.round, attempt: 1, leader: q.team[0], team: q.team, approved: true, votes: {} })),
        lakeHistory: [{ round: 2, holderId: A, targetId: B, declaredClaim: 'good' }],
      } as Partial<PlayerObservation>);
      if (!certaintyFor(obs).isCertRed(A)) continue;
      const team = decideTeam(obs);
      checked++;
      if (!team.includes(A)) continue;
      const reusedWithA = questHistory.some((q) => q.result === 'success' && q.team.includes(A) && q.team.every((x) => team.includes(x)));
      expect({ seed: s, team, A, reusedWithA }).toEqual({ seed: s, team, A, reusedWithA: true });
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);
});
