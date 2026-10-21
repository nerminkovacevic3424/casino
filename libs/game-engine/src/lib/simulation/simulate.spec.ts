import { SeededRng } from '../rng/rng';
import { CLASSIC_3_REEL, MEGAWAYS, VIDEO_5_REEL } from '../slots/configs';
import {
  emptyTotals,
  exactLinesBaseRtp,
  mergeTotals,
  runSpins,
  simulate,
  toReport,
} from './simulate';

describe('simulation', () => {
  it('converges on the exact classic RTP', () => {
    const report = simulate(CLASSIC_3_REEL, 200_000, new SeededRng(1));
    const exact = exactLinesBaseRtp(CLASSIC_3_REEL).rtp;
    expect(Math.abs(report.rtp - exact)).toBeLessThan(3 * report.confidence95);
    expect(report.hitFrequency).toBeCloseTo(0.4077, 2);
    expect(report.freeSpinTriggers + report.bonusTriggers).toBe(0);
  });

  it('tracks feature contributions for the video slot', () => {
    const t = runSpins(VIDEO_5_REEL, 20_000, new SeededRng(2));
    expect(t.spins).toBe(20_000);
    expect(t.freeSpinTriggers).toBeGreaterThan(0);
    expect(t.bonusTriggers).toBeGreaterThan(0);
    expect(t.baseWin + t.freeSpinWin + t.bonusWin).toBeGreaterThanOrEqual(
      t.totalWin,
    );
  });

  it('runs ways games', () => {
    const r = simulate(MEGAWAYS, 5_000, new SeededRng(3));
    expect(r.gameId).toBe('megaways');
    expect(r.rtp).toBeGreaterThan(0);
    expect(r.baseWin).toBe(r.totalWin);
  });

  it('merges totals from parallel workers', () => {
    const a = runSpins(CLASSIC_3_REEL, 1000, new SeededRng(4));
    const b = runSpins(CLASSIC_3_REEL, 1000, new SeededRng(5));
    const merged = mergeTotals(a, b);
    expect(merged.spins).toBe(2000);
    expect(merged.totalWin).toBe(a.totalWin + b.totalWin);
    expect(merged.maxWinX).toBe(Math.max(a.maxWinX, b.maxWinX));
    expect(mergeTotals(merged, emptyTotals())).toEqual(merged);
  });

  it('reports zeros for an empty run', () => {
    const r = toReport(CLASSIC_3_REEL, emptyTotals());
    expect(r).toMatchObject({
      rtp: 0,
      hitFrequency: 0,
      volatility: 0,
      confidence95: Infinity,
    });
  });
});
