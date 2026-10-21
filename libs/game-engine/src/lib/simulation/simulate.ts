import { Rng } from '../rng/rng';
import {
  createLinesContext,
  evaluateSpin,
  gridFromStops,
} from '../slots/lines';
import { playSlot } from '../slots/slot-engine';
import { LinesSlotConfig, SlotConfig } from '../slots/types';

/** Mergeable accumulator so simulations can be split across worker threads. */
export interface SimulationTotals {
  spins: number;
  totalBet: number;
  totalWin: number;
  hits: number;
  /** Sum of (win / bet)^2, for the variance of the per-spin return. */
  sumSquares: number;
  maxWinX: number;
  freeSpinTriggers: number;
  bonusTriggers: number;
  baseWin: number;
  freeSpinWin: number;
  bonusWin: number;
  cappedRounds: number;
}

export interface SimulationReport extends SimulationTotals {
  gameId: string;
  targetRtp: number;
  rtp: number;
  hitFrequency: number;
  /** Standard deviation of the per-spin return (in multiples of bet). */
  volatility: number;
  /** Half-width of the 95% confidence interval for the RTP estimate. */
  confidence95: number;
}

export const emptyTotals = (): SimulationTotals => ({
  spins: 0,
  totalBet: 0,
  totalWin: 0,
  hits: 0,
  sumSquares: 0,
  maxWinX: 0,
  freeSpinTriggers: 0,
  bonusTriggers: 0,
  baseWin: 0,
  freeSpinWin: 0,
  bonusWin: 0,
  cappedRounds: 0,
});

export function runSpins(
  config: SlotConfig,
  spins: number,
  rng: Rng,
  bet = config.betOptions[0],
): SimulationTotals {
  const t = emptyTotals();
  for (let i = 0; i < spins; i++) {
    const r = playSlot(config, bet, rng);
    const x = r.totalWin / bet;
    t.spins++;
    t.totalBet += bet;
    t.totalWin += r.totalWin;
    t.sumSquares += x * x;
    if (r.totalWin > 0) t.hits++;
    if (x > t.maxWinX) t.maxWinX = x;
    if (r.capped) t.cappedRounds++;
    if (r.kind === 'lines') {
      t.baseWin += r.base.win;
      if (r.freeSpins) {
        t.freeSpinTriggers++;
        t.freeSpinWin += r.freeSpins.win;
      }
      if (r.bonus) {
        t.bonusTriggers++;
        t.bonusWin += r.bonus.win;
      }
    } else {
      t.baseWin += r.totalWin;
    }
  }
  return t;
}

export function mergeTotals(
  a: SimulationTotals,
  b: SimulationTotals,
): SimulationTotals {
  return {
    spins: a.spins + b.spins,
    totalBet: a.totalBet + b.totalBet,
    totalWin: a.totalWin + b.totalWin,
    hits: a.hits + b.hits,
    sumSquares: a.sumSquares + b.sumSquares,
    maxWinX: Math.max(a.maxWinX, b.maxWinX),
    freeSpinTriggers: a.freeSpinTriggers + b.freeSpinTriggers,
    bonusTriggers: a.bonusTriggers + b.bonusTriggers,
    baseWin: a.baseWin + b.baseWin,
    freeSpinWin: a.freeSpinWin + b.freeSpinWin,
    bonusWin: a.bonusWin + b.bonusWin,
    cappedRounds: a.cappedRounds + b.cappedRounds,
  };
}

export function toReport(
  config: SlotConfig,
  t: SimulationTotals,
): SimulationReport {
  const rtp = t.totalBet === 0 ? 0 : t.totalWin / t.totalBet;
  const meanSquare = t.spins === 0 ? 0 : t.sumSquares / t.spins;
  const volatility = Math.sqrt(Math.max(0, meanSquare - rtp * rtp));
  return {
    ...t,
    gameId: config.id,
    targetRtp: config.targetRtp,
    rtp,
    hitFrequency: t.spins === 0 ? 0 : t.hits / t.spins,
    volatility,
    confidence95:
      t.spins === 0 ? Infinity : (1.96 * volatility) / Math.sqrt(t.spins),
  };
}

export const simulate = (
  config: SlotConfig,
  spins: number,
  rng: Rng,
): SimulationReport => toReport(config, runSpins(config, spins, rng));

/**
 * Exact base-game RTP of a fixed-grid lines slot by enumerating every stop
 * combination (feasible for small games such as the classic 3-reel). Feature
 * wins (free spins, bonus) are excluded; scatter pays are included.
 */
export function exactLinesBaseRtp(config: LinesSlotConfig): {
  rtp: number;
  hitFrequency: number;
  combinations: number;
} {
  const ctx = createLinesContext(config);
  const bet = config.betOptions[0];
  const lengths = config.reels.map((r) => r.length);
  const combinations = lengths.reduce((a, b) => a * b, 1);
  const stops = new Array<number>(lengths.length).fill(0);
  let totalWin = 0;
  let hits = 0;
  for (let n = 0; n < combinations; n++) {
    let rem = n;
    for (let r = lengths.length - 1; r >= 0; r--) {
      stops[r] = rem % lengths[r];
      rem = Math.floor(rem / lengths[r]);
    }
    const spin = evaluateSpin(ctx, stops, gridFromStops(config, stops), bet, 1);
    totalWin += spin.win;
    if (spin.win > 0) hits++;
  }
  return {
    rtp: totalWin / (combinations * bet),
    hitFrequency: hits / combinations,
    combinations,
  };
}
