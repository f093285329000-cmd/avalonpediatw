/**
 * 優化迴圈第 42 回合・藍方（第 3 階段）：湖的規則只用在第 2 湖（`goodLake41` 位元 256，只量）、
 * 宣告紅的持湖者第 3 局不上隊的較鬆版本（`loyalLakeHolderP42`：只在自己估持湖者是紅的機率夠高時才不帶）；
 * 梅林在隊上偶爾贊成有他看得到的紅的關鍵隊的條件（`merlinKeyApprove42`；專案負責人 11/12：場內可以偶爾投白、不能開外白）。全部預設關。
 */
import { describe, expect, it } from 'vitest';
import type { PlayerObservation } from './types';
import { DEFAULT_AGENT_TUNING, LEGACY_AGENT_TUNING, parseTuningFlag } from './AgentTuning';
import { goodLake41Pick, merlinKeyApprove41Now } from './BlueRound41';
import { HeuristicAgent } from './HeuristicAgent';
import { SelfPlayEngine } from './SelfPlayEngine';
import { ForwardAgent } from './forward/ForwardAgent';
import type { AgentAction, AvalonAgent } from './types';
import { lakeHolderBarred40 } from './BlueRound39';
import { percivalRead39 } from './BlueRound39Percival';
import { bayesOptionsOf, bayesRedShare } from './belief/BayesBelief';

const IDS = Array.from({ length: 10 }, (_, i) => `P${i + 1}`);
const asObs = (o: object) => o as unknown as PlayerObservation;
const T = (over: object) => ({ ...DEFAULT_AGENT_TUNING, ...over });
const vote = (round: number, attempt: number, leader: string, team: string[], yes: string[]) => ({
  round, attempt, leader, team, approved: yes.length > 5, votes: Object.fromEntries(IDS.map((id) => [id, yes.includes(id)])),
});
const base = {
  myPlayerId: 'P10', myRole: 'loyal', myTeam: 'good', seatTeam: 'good', playerCount: 10, allPlayerIds: IDS, knownEvils: [], evilCount: 4,
  lakeHistory: [], myLakeResults: [], proposedTeam: [], failCount: 0,
};
const R1 = [
  vote(1, 1, 'P1', ['P1', 'P2', 'P3'], ['P1', 'P2', 'P3']), vote(1, 2, 'P2', ['P2', 'P4', 'P6'], ['P2', 'P4', 'P6']),
  vote(1, 3, 'P3', ['P3', 'P5', 'P9'], ['P3', 'P5', 'P9']), vote(1, 4, 'P4', ['P4', 'P7', 'P10'], ['P4', 'P7', 'P10']),
  vote(1, 5, 'P5', ['P5', 'P1', 'P8'], IDS),
];
const R2 = [
  vote(2, 1, 'P6', ['P6', 'P2', 'P3', 'P4'], ['P6', 'P2', 'P3', 'P4']), vote(2, 2, 'P7', ['P7', 'P2', 'P3', 'P9'], ['P7', 'P2', 'P3', 'P9']),
  vote(2, 3, 'P8', ['P8', 'P4', 'P6', 'P9'], ['P8', 'P4', 'P6', 'P9']), vote(2, 4, 'P9', ['P9', 'P2', 'P4', 'P7'], ['P9', 'P2', 'P4', 'P7']),
  vote(2, 5, 'P10', ['P10', 'P1', 'P3', 'P4'], IDS),
];
const R3 = [vote(3, 1, 'P1', ['P1', 'P2', 'P6', 'P7'], ['P1', 'P2', 'P6', 'P7', 'P8', 'P9'])];
const VALID = IDS.filter((id) => id !== 'P10');
const QH1 = [{ round: 1, team: ['P5', 'P1', 'P8'], result: 'success', failCount: 0 }, { round: 2, team: ['P10', 'P1', 'P3', 'P4'], result: 'fail', failCount: 1 }];
const lake1 = asObs({ ...base, currentRound: 2, gamePhase: 'lake', questResults: ['success', 'fail'], voteHistory: [...R1, ...R2], questHistory: QH1 });
const lake2 = asObs({
  ...base, currentRound: 3, gamePhase: 'lake', questResults: ['success', 'fail', 'fail'], voteHistory: [...R1, ...R2, ...R3],
  questHistory: [...QH1, { round: 3, team: ['P1', 'P2', 'P6', 'P7'], result: 'fail', failCount: 1 }],
  lakeHistory: [{ round: 2, holderId: 'P9', targetId: 'P5', declaredClaim: 'good' }],
});

describe('round 42 tuning fields', () => {
  it('off in the legacy table and the default; flags parse', () => {
    expect(LEGACY_AGENT_TUNING.loyalLakeHolderP42).toBe(0);
    expect(DEFAULT_AGENT_TUNING.loyalLakeHolderP42).toBe(0);
    expect(parseTuningFlag('loyalLakeHolderP42')).toEqual({ loyalLakeHolderP42: 0.3 });
    expect(parseTuningFlag('loyalLakeHolderP42=0.45')).toEqual({ loyalLakeHolderP42: 0.45 });
    expect(() => parseTuningFlag('loyalLakeHolderP42=1.5')).toThrow();
    expect(parseTuningFlag('goodLake41=259')).toEqual({ goodLake41: 259 });
  });
});

describe('goodLake41 bit 256: the lake rule at lake 2 only', () => {
  it('lake 1 falls back to the old rule (null); lake 2 picks as goodLake41=3 does', () => {
    expect(goodLake41Pick(T({ goodLake41: 3 }), lake1, VALID)).not.toBeNull();
    expect(goodLake41Pick(T({ goodLake41: 259 }), lake1, VALID)).toBeNull();
    const full = goodLake41Pick(T({ goodLake41: 3 }), lake2, VALID);
    expect(full).not.toBeNull();
    expect(goodLake41Pick(T({ goodLake41: 259 }), lake2, VALID)).toBe(full);
  });
  it('a last lake (lake 3) also falls back', () => {
    const lake3 = asObs({
      ...(lake2 as object), currentRound: 4, questResults: ['success', 'fail', 'fail', 'success'],
      questHistory: [...(lake2.questHistory as object[]), { round: 4, team: ['P1', 'P2', 'P3', 'P6', 'P7'], result: 'success', failCount: 0 }],
      lakeHistory: [...(lake2.lakeHistory ?? []), { round: 3, holderId: 'P5', targetId: 'P8', declaredClaim: 'good' }],
    });
    expect(goodLake41Pick(T({ goodLake41: 259 }), lake3, VALID)).toBeNull();
  });
});

describe('loyalLakeHolderP42: the failed-mission holder is barred only when own P(holder red) reaches the bar', () => {
  const obs = asObs({
    ...base, myPlayerId: 'P1', currentRound: 3, gamePhase: 'team_select', questResults: ['success', 'fail'], voteHistory: [...R1, ...R2], questHistory: QH1,
    lakeHistory: [{ round: 2, holderId: 'P10', targetId: 'P5', declaredClaim: 'evil' }],
  });
  it('0 = bit 2 as before; a bar at or below P(holder red) bars; above it keeps the holder', () => {
    const pH = bayesRedShare(obs, bayesOptionsOf(T({ loyalLakePair: 3 }))).get('P10')!;
    expect(pH).toBeGreaterThan(0.01);
    expect(pH).toBeLessThan(0.99);
    expect(lakeHolderBarred40(T({ loyalLakePair: 2 }), obs)).toBe('P10');
    expect(lakeHolderBarred40(T({ loyalLakePair: 2, loyalLakeHolderP42: Math.max(0.001, pH - 0.01) }), obs)).toBe('P10');
    expect(lakeHolderBarred40(T({ loyalLakePair: 2, loyalLakeHolderP42: Math.min(1, pH + 0.01) }), obs)).toBeNull();
    // without bit 2 the knob does nothing
    expect(lakeHolderBarred40(T({ loyalLakeHolderP42: 0.001 }), obs)).toBeNull();
  });
});

describe('goodLake41, Percival: lakes as a loyal holding the thumb fact (INV-PL2), except the read-confident Morgana (ruling (4))', () => {
  it('same pick as the loyal clone for every mode and lake, or the clone picked the guarded thumb', () => {
    for (const thumbs of [['P3', 'P4'], ['P1', 'P5'], ['P2', 'P9']]) {
      for (const o of [lake1, lake2]) {
        const perc = asObs({ ...(o as object), myRole: 'percival', knownWizards: thumbs });
        const clone = asObs({ ...(perc as object), myRole: 'loyal' });
        for (const mode of [1, 2, 3]) {
          const a = goodLake41Pick(T({ goodLake41: mode }), perc, VALID);
          const b = goodLake41Pick(T({ goodLake41: mode }), clone, VALID);
          if (a !== b) {
            const rd = percivalRead39(perc);
            expect(rd?.unfav).toBe(b);
            expect(rd!.conf).toBeGreaterThanOrEqual(0.7);
          }
        }
      }
    }
  });
});

describe('merlinKeyApprove42: where Merlin may approve on the team (owner 2026-11-12)', () => {
  const key = asObs({
    ...base, myPlayerId: 'P3', myRole: 'merlin', knownEvils: ['P5', 'P8', 'P9'], currentRound: 3, gamePhase: 'team_vote',
    questResults: ['fail', 'fail'], proposedTeam: ['P2', 'P3', 'P5', 'P6'], currentLeader: 'P2', failCount: 0,
  });
  it('off in the legacy table and the default; flags parse', () => {
    expect(LEGACY_AGENT_TUNING.merlinKeyApprove42).toBe(0);
    expect(DEFAULT_AGENT_TUNING.merlinKeyApprove42).toBe(0);
    expect(parseTuningFlag('merlinKeyApprove42')).toEqual({ merlinKeyApprove42: 7 });
    expect(() => parseTuningFlag('merlinKeyApprove42=16')).toThrow();
  });
  it('bit 1 = round 3 only, bit 2 = exactly one seen red on the team, bit 4 = first proposal of the round', () => {
    const on = (c: number, o: object = {}) => merlinKeyApprove41Now(T({ merlinKeyApprove41: 1, merlinKeyApprove42: c }), asObs({ ...(key as object), ...o }));
    expect(on(7)).toBe(true);
    expect(on(1, { currentRound: 4, proposedTeam: ['P2', 'P3', 'P5', 'P8', 'P6'] })).toBe(false);
    expect(on(0, { currentRound: 4, proposedTeam: ['P2', 'P3', 'P5', 'P8', 'P6'] })).toBe(true);
    expect(on(2, { proposedTeam: ['P3', 'P5', 'P8', 'P6'] })).toBe(false);
    expect(on(0, { proposedTeam: ['P3', 'P5', 'P8', 'P6'] })).toBe(true);
    expect(on(4, { failCount: 1 })).toBe(false);
    expect(on(0, { failCount: 1 })).toBe(true);
    // never off the team
    expect(on(15, { proposedTeam: ['P2', 'P4', 'P5', 'P6'] })).toBe(false);
  });
  it('self-play: Merlin never approves a team he is not on that holds a red he sees, from round 3 (non-forced), with every Merlin vote knob on', async () => {
    const tuning = {
      ...DEFAULT_AGENT_TUNING, beliefPendingProposal: true, vote40KeyOnL: 0.6, vote40KeyOnP: 0.6, vote40KeyOnM: 0.6, vote40R5OnL: 0.5, vote40R5OnP: 0.5,
      vote40R5OffL: 0.95, vote40R5OffP: 0.95, vote40R5OffM: 0.95, merlinKeyApprove41: 1, merlinKeyApprove42: 8,
    };
    let offSeen = 0, offSeenApprove = 0, onSeenApprove = 0;
    class Probe implements AvalonAgent {
      readonly agentType = 'heuristic' as const;
      readonly inner: HeuristicAgent;
      readonly fwd: ForwardAgent;
      // the ForwardAgent called directly (as the invariant harness's AuditAgent does): under vitest the HeuristicAgent's lazy require of it fails
      constructor(readonly agentId: string) { this.inner = new HeuristicAgent(agentId, undefined, undefined, { ...tuning }); this.fwd = new ForwardAgent(agentId, this.inner); }
      onGameStart(obs: PlayerObservation): void { this.fwd.onGameStart(obs); }
      act(obs: PlayerObservation): AgentAction {
        const a = this.fwd.act(obs);
        if (obs.myRole === 'merlin' && a.type === 'team_vote' && (obs.currentRound ?? 1) >= 3 && (obs.failCount ?? 0) < 4) {
          const team = obs.proposedTeam ?? [];
          const seen = team.some((id) => obs.knownEvils.includes(id));
          if (seen && !team.includes(obs.myPlayerId)) { offSeen++; if (a.vote) offSeenApprove++; }
          if (seen && team.includes(obs.myPlayerId) && a.vote) onSeenApprove++;
        }
        return a;
      }
      pickLakeTarget(obs: PlayerObservation, valid?: readonly string[]): string { return this.inner.pickLakeTarget(obs, valid); }
      declareLake(obs: PlayerObservation, t: string, f: 'good' | 'evil' | undefined): 'good' | 'evil' | null { return this.inner.declareLake(obs, t, f); }
      onGameEnd(obs: PlayerObservation, won: boolean): void { this.inner.onGameEnd(obs, won); }
    }
    const engine = new SelfPlayEngine();
    for (let g = 0; g < 80; g++) await engine.runGame(Array.from({ length: 10 }, (_, i) => new Probe(`H-${i + 1}`)), false);
    process.stdout.write(`merlin R3+ votes: off-team seen-red ${offSeen} (approve ${offSeenApprove}), on-team seen-red approve ${onSeenApprove}\n`);
    expect(offSeen).toBeGreaterThan(0);
    expect(offSeenApprove).toBe(0);
    expect(onSeenApprove).toBeGreaterThan(0);
  }, 240000);
});
