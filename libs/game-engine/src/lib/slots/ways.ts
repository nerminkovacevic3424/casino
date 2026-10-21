import { Minor, mulMinor } from '../money';
import { Rng, randomInt, weightedIndex } from '../rng/rng';
import {
  Cascade,
  Grid,
  SymbolId,
  WaysRoundResult,
  WaysSlotConfig,
  WaysWin,
} from './types';

export interface WaysContext {
  readonly config: WaysSlotConfig;
  readonly wild: SymbolId | undefined;
  /** Symbols that have a paytable entry, in a stable order. */
  readonly paying: readonly SymbolId[];
}

export function createWaysContext(config: WaysSlotConfig): WaysContext {
  return {
    config,
    wild: config.symbols.find((s) => s.kind === 'wild')?.id,
    paying: config.symbols
      .filter((s) => s.kind === 'regular' && config.paytable[s.id])
      .map((s) => s.id),
  };
}

/**
 * Evaluates every paying symbol: consecutive reels from the left that contain
 * the symbol (or a wild); ways = product of matching cells per reel.
 */
export function evaluateWays(
  ctx: WaysContext,
  grid: Grid,
  unit: Minor,
  multiplier: number,
): WaysWin[] {
  const { config, wild, paying } = ctx;
  const wins: WaysWin[] = [];
  for (const symbol of paying) {
    let ways = 1;
    let reels = 0;
    for (const column of grid) {
      let matches = 0;
      for (const s of column) if (s === symbol || s === wild) matches++;
      if (matches === 0) break;
      ways *= matches;
      reels++;
    }
    const pay = config.paytable[symbol][reels] ?? 0;
    if (pay === 0) continue;
    const cells: [number, number][] = [];
    for (let reel = 0; reel < reels; reel++) {
      grid[reel].forEach((s, row) => {
        if (s === symbol || s === wild) cells.push([reel, row]);
      });
    }
    wins.push({
      symbol,
      reels,
      ways,
      cells,
      win: mulMinor(unit, pay * ways * multiplier),
    });
  }
  return wins;
}

/**
 * Removes winning cells; survivors fall down and new symbols enter from the
 * strip above each reel's window (deterministic — no extra randomness).
 * `tops[reel]` is the strip index of the top visible cell and is updated.
 */
export function tumble(
  config: WaysSlotConfig,
  grid: Grid,
  wins: readonly WaysWin[],
  tops: number[],
): Grid {
  const remove = grid.map((column) => column.map(() => false));
  for (const w of wins)
    for (const [reel, row] of w.cells) remove[reel][row] = true;
  return grid.map((column, reel) => {
    const survivors = column.filter((_, row) => !remove[reel][row]);
    const missing = column.length - survivors.length;
    if (missing === 0) return column;
    const strip = config.reels[reel];
    const len = strip.length;
    const incoming: SymbolId[] = [];
    for (let k = missing; k >= 1; k--)
      incoming.push(strip[(((tops[reel] - k) % len) + len) % len]);
    tops[reel] = (((tops[reel] - missing) % len) + len) % len;
    return [...incoming, ...survivors];
  });
}

export function playWaysRound(
  ctx: WaysContext,
  totalBet: Minor,
  rng: Rng,
): WaysRoundResult {
  const { config } = ctx;
  const unit = totalBet / config.betDivisor;
  const rows = config.reels.map(
    () => config.minRows + weightedIndex(rng, config.rowWeights),
  );
  const stops = config.reels.map((strip) => randomInt(rng, strip.length));
  let grid: Grid = config.reels.map((strip, reel) =>
    Array.from(
      { length: rows[reel] },
      (_, row) => strip[(stops[reel] + row) % strip.length],
    ),
  );

  const tops = [...stops];
  const cascades: Cascade[] = [];
  let raw = 0;
  for (let step = 0; step <= config.maxCascades; step++) {
    const multiplier = 1 + step * config.multiplierStep;
    const wins = evaluateWays(ctx, grid, unit, multiplier);
    const win = wins.reduce((sum, w) => sum + w.win, 0);
    cascades.push({ grid, multiplier, wins, win });
    raw += win;
    if (wins.length === 0 || step === config.maxCascades) break;
    grid = tumble(config, grid, wins, tops);
  }

  const cap = mulMinor(totalBet, config.maxWinMultiplier);
  return {
    kind: 'ways',
    gameId: config.id,
    totalBet,
    rows,
    stops,
    cascades,
    totalWin: Math.min(raw, cap),
    capped: raw > cap,
  };
}

/** Number of ways for a given set of row counts (shown in the UI). */
export const waysCount = (rows: readonly number[]): number =>
  rows.reduce((a, b) => a * b, 1);
